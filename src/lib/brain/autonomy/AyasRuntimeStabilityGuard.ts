import crypto from "node:crypto";

import { captureAyasRuntimeStabilitySnapshot, type AyasRuntimeStabilitySnapshot, type AyasRuntimeStabilitySnapshotDeps } from "./AyasRuntimeStabilitySnapshot";
import { evaluateAyasRuntimeStabilityHealth, type AyasRuntimeHealthDecision, type AyasRuntimeHealthExpectations } from "./AyasRuntimeStabilityHealth";
import { findAyasOutOfScopeViolations, type AyasRuntimeImpactScope, type AyasScopeViolation } from "./AyasRuntimeStabilityScope";
import { createAyasStabilityTransactionStore, recoverInterruptedAyasStabilityTransactions, type AyasStabilityTransaction, type AyasStabilityTransactionStore } from "./AyasRuntimeStabilityTransaction";

/**
 * AYAS RUNTIME STABILITY GUARD — the supervisor (Parts E + G).
 *
 * Operating model, in one call:
 *
 *   preflight snapshot -> precondition gate -> APPLYING -> VERIFYING
 *     -> (health + scope invariants hold)  -> COMPLETED
 *     -> (anything fails)                  -> ROLLING_BACK -> ROLLED_BACK
 *
 * What this module deliberately does NOT do: decide, approve, reject,
 * reserve or execute an AYAS proposal. It is a supervisor around an
 * operation the caller supplies, never a second path into the mutation
 * pipeline — `AyasProposalApprovalService` remains the one and only
 * execute→test→commit→push primitive, and the owner's APPROVE remains the
 * one and only thing that starts it. A guard that could also execute would
 * be a second authority, which is the exact architectural failure this
 * sprint was commissioned to prevent.
 *
 * Rollback policy is intentionally narrow: the caller supplies a `rollback`
 * for its own runtime/config change and the guard invokes it on failure.
 * The guard never rewrites git history, never force-resets a working tree,
 * and never reverts anything it did not itself apply — an automatic
 * history rewrite triggered by a failed health probe is far more dangerous
 * than the failure it would be "fixing".
 */
export interface AyasControlledOperation<T> {
  readonly operation: string;
  readonly scope: AyasRuntimeImpactScope;
  /** Extra fail-closed preconditions evaluated against the preflight snapshot. Returning a non-empty list refuses the operation before anything is touched. */
  readonly preconditions?: (before: AyasRuntimeStabilitySnapshot) => readonly string[];
  readonly apply: () => Promise<T> | T;
  /** Post-change expectations. Given the preflight snapshot so a caller can express relational expectations (e.g. "HEAD must be what it was"). */
  readonly expectations?: (before: AyasRuntimeStabilitySnapshot) => AyasRuntimeHealthExpectations;
  /** Undo for whatever `apply` did. Invoked only when the guard has decided to roll back. */
  readonly rollback?: (applied: T | undefined) => Promise<void> | void;
}

export type AyasControlledOperationOutcome<T> =
  | { readonly ok: true; readonly state: "COMPLETED"; readonly value: T; readonly transaction: AyasStabilityTransaction; readonly health: AyasRuntimeHealthDecision; readonly before: AyasRuntimeStabilitySnapshot; readonly after: AyasRuntimeStabilitySnapshot }
  | { readonly ok: false; readonly state: "REFUSED"; readonly reasons: readonly string[]; readonly before: AyasRuntimeStabilitySnapshot }
  | { readonly ok: false; readonly state: "ROLLED_BACK" | "RECOVERY_REQUIRED" | "FAILED"; readonly reasons: readonly string[]; readonly transaction: AyasStabilityTransaction; readonly health?: AyasRuntimeHealthDecision; readonly violations?: readonly AyasScopeViolation[]; readonly before: AyasRuntimeStabilitySnapshot; readonly after?: AyasRuntimeStabilitySnapshot };

export interface AyasRuntimeStabilityGuardDeps {
  readonly store?: AyasStabilityTransactionStore;
  readonly snapshot?: AyasRuntimeStabilitySnapshotDeps;
  /** Replaces the whole capture step. The seam the regression suite uses to drive before/after states deterministically without a real repo, real ports or a real scheduler. */
  readonly captureSnapshot?: () => AyasRuntimeStabilitySnapshot;
  readonly now?: () => string;
  /** Skip the crash-recovery sweep (already done by the caller this tick). */
  readonly skipRecovery?: boolean;
}

/**
 * Baseline preconditions every controlled operation inherits. These encode
 * the sprint's fail-closed policy: a dirty tree means a mutation would be
 * mixed with unrelated in-flight work; an incomplete snapshot means the
 * guard cannot prove anything afterwards; an in-flight research run means a
 * restart would kill a scan mid-write.
 */
export function baselineAyasPreconditions(options: { readonly requireCleanRepo?: boolean; readonly requireExpectedHead?: string; readonly refuseWhileResearchRunning?: boolean } = {}) {
  return (before: AyasRuntimeStabilitySnapshot): readonly string[] => {
    const reasons: string[] = [];
    if (before.gaps.length > 0) reasons.push(`preflight snapshot incomplete: ${before.gaps.join("; ")}`);
    if (options.requireCleanRepo === true && !before.repo.clean) reasons.push(`working tree is dirty (${before.repo.dirtyEntryCount} entries)`);
    if (options.requireExpectedHead !== undefined && before.repo.head !== options.requireExpectedHead) reasons.push(`HEAD ${before.repo.head.slice(0, 7)} does not match expected ${options.requireExpectedHead.slice(0, 7)}`);
    if (options.refuseWhileResearchRunning === true && before.scheduler.runInFlight) reasons.push("a research run is in flight");
    return reasons;
  };
}

export async function runAyasControlledOperation<T>(operation: AyasControlledOperation<T>, deps: AyasRuntimeStabilityGuardDeps = {}): Promise<AyasControlledOperationOutcome<T>> {
  const store = deps.store ?? createAyasStabilityTransactionStore({ ...(deps.now === undefined ? {} : { now: deps.now }) });
  if (deps.skipRecovery !== true) recoverInterruptedAyasStabilityTransactions({ store });
  // ONE salt for the whole run. `AyasRuntimeStabilitySnapshot`'s salt contract
  // is that fingerprints are comparable within a single guard run and never
  // across runs, which only holds if both captures share a salt — and the salt
  // defaults to a fresh random value per capture. Pinning it here makes that
  // contract true by construction for every caller: without it, every tracked
  // env var and every process command line appears to have "changed" between
  // the before and after snapshots, turning a clean operation into an
  // out-of-scope runtime-config violation.
  const runSalt = deps.snapshot?.salt ?? crypto.randomUUID();
  const capture = deps.captureSnapshot ?? (() => captureAyasRuntimeStabilitySnapshot({ ...(deps.snapshot ?? {}), salt: runSalt }));

  const before = capture();

  const refusals = operation.preconditions?.(before) ?? [];
  if (refusals.length > 0) return { ok: false, state: "REFUSED", reasons: Object.freeze([...refusals]), before };

  let transaction = store.begin(operation.operation, operation.scope, before);

  let applied: T | undefined;
  try {
    transaction = store.transition(transaction.transactionId, "APPLYING");
    applied = await operation.apply();
  } catch (error) {
    const reason = `apply failed: ${error instanceof Error ? error.message : String(error)}`;
    return await rollbackOrEscalate(reason);
  }

  let after: AyasRuntimeStabilitySnapshot;
  let health: AyasRuntimeHealthDecision;
  let violations: readonly AyasScopeViolation[];
  try {
    transaction = store.transition(transaction.transactionId, "VERIFYING");
    after = capture();
    health = evaluateAyasRuntimeStabilityHealth(before, after, operation.expectations?.(before) ?? {});
    violations = findAyasOutOfScopeViolations(before, after, operation.scope);
  } catch (error) {
    return await rollbackOrEscalate(`verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (health.healthy && violations.length === 0) {
    transaction = store.transition(transaction.transactionId, "COMPLETED", { after, violations: [], healthFailures: [] });
    return { ok: true, state: "COMPLETED", value: applied as T, transaction, health, before, after };
  }

  const reasons = [...health.failures, ...violations.map((violation) => `${violation.reasonCode}: ${violation.dimension} — ${violation.detail}`)];
  return await rollbackOrEscalate(reasons.join(" | "), after, health, violations);

  async function rollbackOrEscalate(reason: string, afterSnapshot?: AyasRuntimeStabilitySnapshot, healthDecision?: AyasRuntimeHealthDecision, scopeViolations?: readonly AyasScopeViolation[]): Promise<AyasControlledOperationOutcome<T>> {
    const patch = {
      reason,
      ...(afterSnapshot === undefined ? {} : { after: afterSnapshot }),
      ...(healthDecision === undefined ? {} : { healthFailures: healthDecision.failures }),
      ...(scopeViolations === undefined ? {} : { violations: scopeViolations.map((violation) => `${violation.reasonCode}: ${violation.detail}`) }),
    };

    if (!operation.rollback) {
      // No undo was supplied, so the change stands and is unverified. That is
      // exactly RECOVERY_REQUIRED — a human-visible terminal state — not a
      // failure the guard may quietly swallow.
      transaction = store.transition(transaction.transactionId, "RECOVERY_REQUIRED", patch, "no rollback supplied");
      return { ok: false, state: "RECOVERY_REQUIRED", reasons: Object.freeze([reason]), transaction, ...(healthDecision === undefined ? {} : { health: healthDecision }), ...(scopeViolations === undefined ? {} : { violations: scopeViolations }), before, ...(afterSnapshot === undefined ? {} : { after: afterSnapshot }) };
    }

    transaction = store.transition(transaction.transactionId, "ROLLING_BACK", patch);
    try {
      await operation.rollback(applied);
    } catch (error) {
      const rollbackReason = `${reason} | rollback ALSO failed: ${error instanceof Error ? error.message : String(error)}`;
      transaction = store.transition(transaction.transactionId, "RECOVERY_REQUIRED", { reason: rollbackReason, rollbackPerformed: false }, "rollback failed");
      return { ok: false, state: "RECOVERY_REQUIRED", reasons: Object.freeze([rollbackReason]), transaction, ...(healthDecision === undefined ? {} : { health: healthDecision }), before, ...(afterSnapshot === undefined ? {} : { after: afterSnapshot }) };
    }

    transaction = store.transition(transaction.transactionId, "ROLLED_BACK", { rollbackPerformed: true });
    return { ok: false, state: "ROLLED_BACK", reasons: Object.freeze([reason]), transaction, ...(healthDecision === undefined ? {} : { health: healthDecision }), ...(scopeViolations === undefined ? {} : { violations: scopeViolations }), before, ...(afterSnapshot === undefined ? {} : { after: afterSnapshot }) };
  }
}
