/**
 * AYAS Execution Bridge — the one path from an AYAS intent to a real action
 * (spec §2, §7, §8, §9, §12–§16, §23).
 *
 *   raw request  ──▶ POLICY  ──── DENY: unknown / malformed / unsafe / shell-like / write-disabled
 *        │
 *        ▼  gate.readStateFailClosed()  ──── DENY: gate not OPEN (the default)
 *        │
 *        ▼  authorization.consume(id)   ──── DENY: unknown / expired / replay / binding-mismatch
 *        │
 *        ▼  gate.transition("begin-execution")  → EXECUTING
 *        │
 *        ▼  executor (read-only, after exact capability admission)
 *        │
 *        ▼  gate.transition("complete-execution") → COMPLETED → "settle" → READY
 *
 * On ANY failure after `begin-execution`: `gate.transition("fault")` → CLOSED +
 * `authorization.settle({ ok:false })`. Raw model text never leaves the request
 * object; no shell, no arbitrary fs.
 *
 * WRITE actions (`resume-stage`) are refused with `write-execution-disabled`
 * by default. Even a true code switch requires an existing owner capability
 * adapter, currently absent: REQUIRE_OWNER, with no project/pipeline dispatch.
 */

import crypto from "node:crypto";

import { AyasExecutionGateStore } from "./AyasExecutionGateStore";
import {
  AyasExecutionAuthorizationStore,
  AyasExecutionAuthorizationError,
  type AyasExecutionGrantDescriptor,
} from "./AyasExecutionAuthorization";
import {
  validateAyasExecutionRequest,
  canonicalAyasExecutionRequest,
  type AyasExecutionPolicyDenyReason,
  type AyasExecutionRequest,
} from "./AyasExecutionPolicy";
import {
  validateAyasResumeStageRequest,
  isAyasWriteActionId,
} from "./AyasWriteActionPolicy";
import { resolveAyasExecutor, type AyasExecutorResult } from "./AyasSafeExecutors";
import type { AyasWriteExecutor } from "./AyasWriteExecutor";
import { createAyasReadActionFirewall } from "./AyasActionRuntime";

export type AyasExecutionDenyStage = "policy" | "gate" | "authorization" | "executor" | "internal";

export type AyasExecutionOutcome =
  | {
      readonly ok: true;
      readonly executionId: string;
      readonly authorizationId: string;
      readonly gateStateAfter: string;
      readonly result: AyasExecutorResult;
    }
  | {
      readonly ok: false;
      readonly denied: true;
      readonly stage: AyasExecutionDenyStage;
      readonly reason: AyasExecutionPolicyDenyReason | string;
      readonly detail: string;
      readonly gateStateAfter: string;
    };

export interface AyasExecutionBridgeDeps {
  readonly gate: AyasExecutionGateStore;
  readonly authorizations: AyasExecutionAuthorizationStore;
  /** Test seam — defaults to the real read-only executor registry. */
  readonly resolveExecutor?: typeof resolveAyasExecutor;
  /**
   * `false` (default) → every write action (`resume-stage`) is denied
   * `write-execution-disabled`. Only a future operator + activation step sets it.
   */
  readonly writeActionsEnabled?: boolean;
  /** Test seam — the resume-stage write executor. */
  readonly resumeStageExecutor?: AyasWriteExecutor;
  /**
   * Supplies the project's current resume-plan stages for the `stage-not-in-plan`
   * check. Omit → the check is skipped (schema-only). The route wires the real
   * `PipelineRecoveryPlanner`.
   */
  readonly resumePlanStages?: (projectSlug: string) => Promise<readonly string[]>;
  /** Bounded budget for a write action (ms). */
  readonly writeMaxDurationMs?: number;
}

export interface RequestAyasExecutionInput {
  readonly rawRequest: unknown;
  /** A single-use authorization minted by the deterministic layer (never the LLM). */
  readonly authorizationId: string;
}


export function createAyasExecutionBridge(deps: AyasExecutionBridgeDeps) {
  const resolveExecutor = deps.resolveExecutor ?? resolveAyasExecutor;

  const gateState = () => deps.gate.readStateFailClosed().state;

  /** Shared core: from an OPEN gate + a valid authorization, run one action. */
  async function runFromOpenGate(
    descriptor: AyasExecutionGrantDescriptor,
    authorizationId: string,
    run: (admittedRead: AyasExecutionRequest) => Promise<AyasExecutorResult>,
    maxDurationMs: number,
    readRequest: AyasExecutionRequest,
  ): Promise<AyasExecutionOutcome> {
    const gateBefore = deps.gate.readStateFailClosed();
    if (gateBefore.degraded) {
      return deny("gate", "gate-degraded", gateBefore.detail ?? "gate store unreadable", "CLOSED");
    }
    if (gateBefore.state !== "OPEN") {
      return deny("gate", "gate-not-open", `execution gate is ${gateBefore.state}; a request is only run from OPEN`, gateBefore.state);
    }

    let consumed: { readonly executionId: string };
    let admittedRead: AyasExecutionRequest;
    try {
      const firewall = createAyasReadActionFirewall(deps.authorizations);
      const issued = firewall.issue(readRequest, authorizationId);
      if (!issued.allowed) return deny("authorization", issued.reason, issued.decision, gateState());
      const admission = firewall.admit(issued.lease, readRequest);
      if (!admission.allowed) return deny("authorization", admission.reason, admission.decision, gateState());
      consumed = { executionId: admission.executionId };
      admittedRead = admission.request;
    } catch (error) {
      const code = error instanceof AyasExecutionAuthorizationError ? error.code : "AYAS_EXEC_AUTH_UNKNOWN";
      return deny("authorization", code, error instanceof Error ? error.message : String(error), gateState());
    }

    let beginSeq: number;
    try {
      const before = deps.gate.read();
      const rec = deps.gate.transition({
        event: "begin-execution",
        expectedSequence: before.sequence,
        reason: `execute ${descriptor.action} (${consumed.executionId})`,
      });
      beginSeq = rec.sequence;
    } catch (error) {
      deps.authorizations.settle(authorizationId, { ok: false, failureReason: "gate begin-execution failed" });
      return deny("gate", "gate-transition-failed", error instanceof Error ? error.message : String(error), gateState());
    }

    try {
      const result = await withTimeout(run(admittedRead), maxDurationMs, descriptor.action);
      const completed = deps.gate.transition({
        event: "complete-execution",
        expectedSequence: beginSeq,
        reason: `done ${descriptor.action} (${consumed.executionId})`,
      });
      const settled = deps.gate.transition({
        event: "settle",
        expectedSequence: completed.sequence,
        reason: `settle ${consumed.executionId}`,
      });
      deps.authorizations.settle(authorizationId, { ok: true, resultDigest: sha256(JSON.stringify(result)) });
      return {
        ok: true,
        executionId: consumed.executionId,
        authorizationId,
        gateStateAfter: settled.state,
        result,
      };
    } catch (error) {
      try {
        deps.gate.transition({ event: "fault", reason: `fault during ${descriptor.action}` });
      } catch {
        /* the gate store itself is failing — the fail-closed read still returns CLOSED */
      }
      deps.authorizations.settle(authorizationId, { ok: false, failureReason: error instanceof Error ? error.message : String(error) });
      return deny("executor", "executor-failed", error instanceof Error ? error.message : String(error), gateState());
    }
  }

  async function requestExecution(input: RequestAyasExecutionInput): Promise<AyasExecutionOutcome> {
    const rawAction = (input.rawRequest as { action?: unknown })?.action;

    // ── WRITE actions ────────────────────────────────────────────────────────
    if (isAyasWriteActionId(rawAction)) {
      if (deps.writeActionsEnabled !== true) {
        return deny(
          "policy",
          "write-execution-disabled",
          `write action "${rawAction}" is not enabled — a future operator + activation step enables it`,
          gateState(),
        );
      }
      const wv = validateAyasResumeStageRequest(input.rawRequest);
      if (!wv.ok) {
        return deny("policy", wv.reason, wv.detail, gateState());
      }
      // The authorization must be the exact one the request names.
      if (wv.request.authorizationId !== input.authorizationId) {
        return deny("authorization", "authorization-id-mismatch", "request.authorizationId does not match the supplied id", gateState());
      }
      // A code switch or generic request-bound grant is not an owner capability.
      // This reserved production action has no owner lease adapter in this bridge;
      // preserve its current disabled activation boundary without invoking a pipeline.
      const ownerDecision = createAyasReadActionFirewall(deps.authorizations).classify(wv.request);
      return deny("authorization", "owner-capability-lease-required", ownerDecision === "REQUIRE_OWNER" ? ownerDecision : "DENY", gateState());
    }

    // ── READ-ONLY actions ────────────────────────────────────────────────────
    const validation = validateAyasExecutionRequest(input.rawRequest);
    if (!validation.ok) {
      return deny("policy", validation.reason, validation.detail, gateState());
    }
    const request: AyasExecutionRequest = validation.request;
    const descriptor: AyasExecutionGrantDescriptor = {
      action: request.action,
      requestedBy: request.requestedBy,
      intent: request.intent,
      ...(request.projectSlug ? { projectSlug: request.projectSlug } : {}),
      plan: request.plan,
      canonical: canonicalAyasExecutionRequest(request),
    };
    return runFromOpenGate(
      descriptor,
      input.authorizationId,
      async (admitted) => {
        if (!admitted) throw new Error("read capability admission missing");
        const executor = resolveExecutor(admitted.action);
        if (!executor) throw new Error(`no executor for allowlisted action ${admitted.action}`);
        return executor(admitted);
      },
      validation.spec.maxDurationMs,
      request,
    );
  }

  return { requestExecution };
}

function deny(stage: AyasExecutionDenyStage, reason: string, detail: string, gateStateAfter: string): AyasExecutionOutcome {
  return { ok: false, denied: true, stage, reason, detail, gateStateAfter };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms budget`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
