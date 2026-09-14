/**
 * AYAS Action Runtime — real READ-ONLY tool execution (Action Runtime sprint).
 *
 * A **deliberately separate, narrower** path from `AyasExecutionBridge.ts`.
 * That bridge governs the global `AyasExecutionGate` — a *mutation/write*
 * authorization ceremony (arm → ready → operator-authorized open → execute →
 * settle), correctly heavyweight for a real pipeline write and, today,
 * permanently CLOSED (no operator activation has ever been granted). Gating a
 * pure, structurally-guaranteed-safe READ behind that SAME ceremony would mean
 * "AYAS can never read a file until an operator arms a write-execution flow" —
 * not a safety requirement, just an accidental conflation this sprint is
 * explicitly asked to narrow.
 *
 * This module does NOT touch `AyasExecutionGateStore` or
 * `AyasExecutionAuthorizationStore` at all — the write path, its gate, and its
 * authorization ceremony are completely untouched and equally protected. This
 * runtime instead:
 *
 *   raw request ──▶ validateAyasExecutionRequest()  (existing, unchanged policy)
 *        │               DENY: unknown / reserved / malformed / shell-like / oversize
 *        ▼
 *   assert spec.write === false                     (hard-coded defense-in-depth —
 *        │                                            never trust the allowlist alone)
 *        ▼
 *   resolveAyasExecutor()  (existing registry)
 *        │
 *        ▼  bounded timeout, exactly one attempt, no retry
 *   real executor (AyasSafeExecutors.ts) — its OWN semantic input validation
 *        │  (AyasActionValidationError) is a distinct, reported denial, not a
 *        │  generic crash
 *        ▼
 *   structured AyasActionRuntimeOutcome — `executed: true|false` is the ONLY
 *   source of truth for "did a real read happen"; nothing upstream may claim
 *   execution the outcome does not report.
 *
 * A write/reserved action reaching this function is refused before anything
 * runs — `write` is checked as a hard boolean gate, not inferred from a name.
 */

import {
  validateAyasExecutionRequest,
  type AyasExecutionActionId,
  type AyasExecutionPolicyDenyReason,
} from "./AyasExecutionPolicy";
import { resolveAyasExecutor, AyasActionValidationError, type AyasExecutorResult } from "./AyasSafeExecutors";

/** Structural ceiling this sprint enforces: one real dispatch per user turn. `AyasChatStream.ts` calls this function at most once per turn — never in a loop. */
export const AYAS_ACTION_RUNTIME_MAX_PER_TURN = 1;

export type AyasActionRuntimeDenyStage = "policy" | "safety" | "executor" | "timeout";

export type AyasActionRuntimeOutcome =
  | {
      readonly executed: true;
      readonly action: AyasExecutionActionId;
      readonly result: AyasExecutorResult;
      readonly durationMs: number;
    }
  | {
      readonly executed: false;
      /** The raw requested action string — may be unknown/invalid, kept for the trace. */
      readonly action: string;
      readonly stage: AyasActionRuntimeDenyStage;
      readonly reason: AyasExecutionPolicyDenyReason | string;
      readonly detail: string;
      readonly durationMs: number;
    };

export interface RunAyasReadOnlyActionInput {
  readonly rawRequest: unknown;
  /** Test seam — defaults to the real read-only executor registry. */
  readonly resolveExecutor?: typeof resolveAyasExecutor;
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

function denied(action: string, stage: AyasActionRuntimeDenyStage, reason: AyasExecutionPolicyDenyReason | string, detail: string, durationMs: number): AyasActionRuntimeOutcome {
  return { executed: false, action, stage, reason, detail, durationMs };
}

/**
 * The one entry point. Exactly one bounded attempt — no retry, no recursion.
 * Never throws: every failure mode (policy denial, tool-level validation
 * denial, executor error, timeout) becomes a structured `executed: false`
 * outcome the caller can report honestly.
 */
export async function runAyasReadOnlyAction(input: RunAyasReadOnlyActionInput): Promise<AyasActionRuntimeOutcome> {
  const started = Date.now();
  const resolveExecutor = input.resolveExecutor ?? resolveAyasExecutor;
  const rawAction = (input.rawRequest as { action?: unknown } | null)?.action;
  const actionLabel = typeof rawAction === "string" ? rawAction : "(unknown)";

  const validation = validateAyasExecutionRequest(input.rawRequest);
  if (!validation.ok) {
    return denied(actionLabel, "policy", validation.reason, validation.detail, Date.now() - started);
  }

  // Defense in depth: even though every entry currently on the allowlist is
  // read-only, this runtime must NEVER dispatch anything else — checked as an
  // explicit boolean, not inferred from the allowlist's current contents.
  if (validation.spec.write !== false) {
    return denied(validation.request.action, "safety", "not-read-only", "action is not classified read-only — Action Runtime never dispatches a write", Date.now() - started);
  }

  const executor = resolveExecutor(validation.request.action);
  if (!executor) {
    return denied(validation.request.action, "policy", "unknown-action", "allowlisted action has no registered executor", Date.now() - started);
  }

  try {
    const result = await withTimeout(executor(validation.request), validation.spec.maxDurationMs, validation.request.action);
    return { executed: true, action: validation.request.action, result, durationMs: Date.now() - started };
  } catch (error) {
    if (error instanceof AyasActionValidationError) {
      return denied(validation.request.action, "safety", error.reasonCode, error.message, Date.now() - started);
    }
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /exceeded \d+ms budget/.test(message);
    return denied(validation.request.action, isTimeout ? "timeout" : "executor", isTimeout ? "timeout" : "executor-failed", message, Date.now() - started);
  }
}
