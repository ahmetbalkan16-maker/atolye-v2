/**
 * AYAS Execution Bridge — the one path from an AYAS intent to a real action
 * (spec §2, §7, §8, §9, §17, §23).
 *
 *     raw request (from AYAS' structured plan)
 *        │
 *        ▼  validateAyasExecutionRequest  ──── DENY: unknown / malformed / unsafe slug / shell-like / oversize
 *     typed AyasExecutionRequest
 *        │
 *        ▼  gate.readStateFailClosed()     ──── DENY: gate not OPEN  (the default)
 *        │
 *        ▼  authorization.consume(id, req) ──── DENY: unknown / expired / replay / binding-mismatch
 *        │
 *        ▼  gate.transition("begin-execution")  → EXECUTING
 *        │
 *        ▼  resolveAyasExecutor(action)   ── read-only executor, typed args only
 *        │
 *        ▼  gate.transition("complete-execution") → COMPLETED → "settle" → READY
 *        │
 *        ▼  authorization.settle(...)      → audited terminal record
 *
 * On ANY failure after `begin-execution`: `gate.transition("fault")` → CLOSED,
 * `authorization.settle({ ok:false })`. The raw model text never leaves the
 * request object; no shell, no arbitrary fs, no `PipelineRunner` (no write action
 * is allowlisted yet).
 *
 * The bridge does NOT open the gate. An operator activation flow does that
 * elsewhere; here the gate is read, and if it is not `OPEN` every request is
 * denied. So with no activation this module is exercised only through its DENY
 * paths — which is the point.
 */

import crypto from "node:crypto";

import { AyasExecutionGateStore } from "./AyasExecutionGateStore";
import {
  AyasExecutionAuthorizationStore,
  AyasExecutionAuthorizationError,
} from "./AyasExecutionAuthorization";
import {
  validateAyasExecutionRequest,
  type AyasExecutionPolicyDenyReason,
  type AyasExecutionRequest,
} from "./AyasExecutionPolicy";
import { resolveAyasExecutor, type AyasExecutorResult } from "./AyasSafeExecutors";

export type AyasExecutionDenyStage =
  | "policy"
  | "gate"
  | "authorization"
  | "executor"
  | "internal";

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
}

export interface RequestAyasExecutionInput {
  readonly rawRequest: unknown;
  /** A single-use authorization minted by the deterministic layer (never the LLM). */
  readonly authorizationId: string;
}

export function createAyasExecutionBridge(deps: AyasExecutionBridgeDeps) {
  const resolveExecutor = deps.resolveExecutor ?? resolveAyasExecutor;

  async function requestExecution(input: RequestAyasExecutionInput): Promise<AyasExecutionOutcome> {
    const gateState = () => deps.gate.readStateFailClosed().state;

    // 1 — POLICY (deterministic; LLM output is only data here)
    const validation = validateAyasExecutionRequest(input.rawRequest);
    if (!validation.ok) {
      return deny("policy", validation.reason, validation.detail, gateState());
    }
    const request: AyasExecutionRequest = validation.request;

    // 2 — GATE  (fail-closed: not OPEN → deny, nothing is touched)
    const gateBefore = deps.gate.readStateFailClosed();
    if (gateBefore.degraded) {
      return deny("gate", "gate-degraded", gateBefore.detail ?? "gate store unreadable", "CLOSED");
    }
    if (gateBefore.state !== "OPEN") {
      return deny(
        "gate",
        "gate-not-open",
        `execution gate is ${gateBefore.state}; a request is only run from OPEN`,
        gateBefore.state,
      );
    }

    // 3 — AUTHORIZATION  (single-use, bound, unexpired)
    let consumed;
    try {
      consumed = deps.authorizations.consume(input.authorizationId, request);
    } catch (error) {
      const code = error instanceof AyasExecutionAuthorizationError ? error.code : "AYAS_EXEC_AUTH_UNKNOWN";
      return deny("authorization", code, error instanceof Error ? error.message : String(error), gateState());
    }

    // 4 — EXECUTE  (from here on, any failure faults the gate to CLOSED)
    let beginSeq: number;
    try {
      const before = deps.gate.read();
      const rec = deps.gate.transition({
        event: "begin-execution",
        expectedSequence: before.sequence,
        reason: `execute ${request.action} (${consumed.executionId})`,
      });
      beginSeq = rec.sequence;
    } catch (error) {
      deps.authorizations.settle(input.authorizationId, {
        ok: false,
        failureReason: "gate begin-execution failed",
      });
      return deny("gate", "gate-transition-failed", error instanceof Error ? error.message : String(error), gateState());
    }

    try {
      const executor = resolveExecutor(request.action);
      if (!executor) {
        throw new Error(`no executor for allowlisted action ${request.action}`);
      }
      const result = await withTimeout(executor(request), validation.spec.maxDurationMs, request.action);

      const completed = deps.gate.transition({
        event: "complete-execution",
        expectedSequence: beginSeq,
        reason: `done ${request.action} (${consumed.executionId})`,
      });
      const settled = deps.gate.transition({
        event: "settle",
        expectedSequence: completed.sequence,
        reason: `settle ${consumed.executionId}`,
      });
      deps.authorizations.settle(input.authorizationId, {
        ok: true,
        resultDigest: sha256(JSON.stringify(result)),
      });
      return {
        ok: true,
        executionId: consumed.executionId,
        authorizationId: input.authorizationId,
        gateStateAfter: settled.state,
        result,
      };
    } catch (error) {
      // fault → CLOSED, always
      try {
        deps.gate.transition({ event: "fault", reason: `fault during ${request.action}` });
      } catch {
        /* the gate store itself is failing — the fail-closed read still returns CLOSED */
      }
      deps.authorizations.settle(input.authorizationId, {
        ok: false,
        failureReason: error instanceof Error ? error.message : String(error),
      });
      return deny("executor", "executor-failed", error instanceof Error ? error.message : String(error), gateState());
    }
  }

  return { requestExecution };
}

function deny(
  stage: AyasExecutionDenyStage,
  reason: string,
  detail: string,
  gateStateAfter: string,
): AyasExecutionOutcome {
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
