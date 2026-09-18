import { execFileSync } from "node:child_process";
import path from "node:path";

import { runAyasControlledOperation, baselineAyasPreconditions, type AyasRuntimeStabilityGuardDeps } from "./AyasRuntimeStabilityGuard";
import { createAyasStabilityTransactionStore, AYAS_STABILITY_TERMINAL_STATES, type AyasStabilityTransaction, type AyasStabilityTransactionStore } from "./AyasRuntimeStabilityTransaction";
import type { AyasRuntimeStabilitySnapshot, AyasRuntimeStabilitySnapshotDeps } from "./AyasRuntimeStabilitySnapshot";
import { classifyAyasRuntimeImpact, deriveAyasPublicationScope, type AyasRuntimeImpactDecision } from "./AyasProposalRuntimeImpact";
import { createAyasExecutionJournal } from "./AyasExecutionJournal";
import { classifyAyasRestartRecovery } from "./AyasExecutionRecoveryPolicy";
import type { AyasApprovalInboxHandle } from "./AyasApprovalInboxStore";

/**
 * THE guarded-publication boundary.
 *
 * Commit 2c7a4ac added the Runtime Stability Guard and its supporting parts,
 * but nothing in the real mutation lifecycle called them: a proposal could be
 * approved, executed, tested, committed and pushed (commit 4d848c6) without
 * a single stability transaction, snapshot or health decision existing
 * afterwards. The guard was a library callers MAY use rather than a step the
 * pipeline MUST take, and "we checked" was therefore unfalsifiable.
 *
 * This module closes that gap by being the one and only way an owner-approved
 * AYAS mutation reaches Git. Both publication lanes —
 * `AyasProposalApprovalService` (individual "ONAYLA VE UYGULA", including the
 * owner-approval resume path) and `AyasMicroBatchApprovalService` ("BATCH
 * ONAYLA VE UYGULA") — hand their existing, unmodified publish pipeline to
 * `runGuardedAyasPublication` as an opaque `publish` callback. There is one
 * integration, not two, so the two lanes cannot drift apart.
 *
 * What this module deliberately is NOT:
 *
 *   - It is not a second authority. It never decides, approves, reserves or
 *     executes anything; it receives an ALREADY-authorised publication and
 *     supervises it. The owner's click remains the only thing that starts a
 *     mutation, and `AyasApprovalInboxStore` remains the only thing that can
 *     record an approval.
 *
 *   - It is not a second Git transaction engine. Each lane's pipeline already
 *     owns its own pre-commit recovery (`git reset` + `revertToHead`) and
 *     already refuses to auto-reset after a commit. This module performs NO
 *     Git mutation of its own — its `rollback` hook only VERIFIES that the
 *     composed mechanism actually restored the baseline, and escalates to a
 *     human-visible terminal state when it cannot prove that. An automatic
 *     history rewrite triggered by a failed probe would be far more dangerous
 *     than the failure it claimed to fix.
 *
 *   - It is not a staleness authority. HEAD-drift detection stays inside
 *     Package C's own execution-time revalidation (`AyasProposalStaleness` +
 *     the daemon's stale-head guard), which durably transitions the subject
 *     to STALE and explains itself. Re-checking it here would create a second,
 *     divergent definition of "stale" that reports the same condition with a
 *     different code depending on which check happened to run first.
 */

export type AyasPublicationLane = "proposal" | "micro-batch";

/** Stable, parseable operation name. The subject id is embedded so a durable transaction can be traced back to exactly one proposal or batch. */
export function ayasPublicationOperationName(lane: AyasPublicationLane, subjectId: string): string {
  return `ayas-publication:${lane}:${subjectId}`;
}

export function isAyasPublicationOperationFor(operation: string, lane: AyasPublicationLane, subjectId: string): boolean {
  return operation === ayasPublicationOperationName(lane, subjectId);
}

/** Every port observed read-only around a publication. Nothing is started, stopped or signalled — observing is what lets an unexpected disturbance become a scope violation instead of a claim. */
export const AYAS_PUBLICATION_OBSERVED_PORTS: readonly number[] = Object.freeze([3000]);

export interface AyasGuardedPublicationGuardDeps extends AyasRuntimeStabilityGuardDeps {
  /** Overrides `AYAS_PUBLICATION_OBSERVED_PORTS`. Tests pass an isolated set so no scenario depends on, or is disturbed by, a real dev server. */
  readonly observedPorts?: readonly number[];
}

export interface AyasGuardedPublicationRequest<T extends { readonly ok: boolean }> {
  readonly lane: AyasPublicationLane;
  /** The exact proposalId / batchId the human authorised. */
  readonly subjectId: string;
  /** The authorised file scope, already bound into the approved hash. The runtime impact class is derived from this and nothing else. */
  readonly exactFiles: readonly string[];
  readonly repoRoot: string;
  readonly gateRoot: string;
  /** Bound into the snapshot so the guard observes the SAME approval ledger the publication mutates, in production and in an isolated test alike. */
  readonly inbox?: AyasApprovalInboxHandle;
  /** The lane's existing publish pipeline, unmodified. An `ok: false` result is treated as a failed apply; an exception is re-surfaced to the caller unchanged. */
  readonly publish: () => Promise<T>;
  readonly guard?: AyasGuardedPublicationGuardDeps;
}

export type AyasGuardedPublicationResult<T extends { readonly ok: boolean }> =
  /** The publication succeeded and every stability invariant held. */
  | { readonly state: "COMPLETED"; readonly value: T; readonly impact: AyasRuntimeImpactDecision; readonly transaction: AyasStabilityTransaction }
  /** Refused before anything was touched. No mutation was attempted. */
  | { readonly state: "REFUSED"; readonly reasons: readonly string[]; readonly impact: AyasRuntimeImpactDecision }
  /** The publication failed and the guard PROVED the lane's own recovery restored the baseline. `value` carries the lane's own structured failure. */
  | { readonly state: "ROLLED_BACK"; readonly value: T; readonly reasons: readonly string[]; readonly impact: AyasRuntimeImpactDecision; readonly transaction: AyasStabilityTransaction }
  /** Something is real and unverified — a commit that could not be proven rolled back, a postcondition failure after a successful push, or a rollback verification that itself failed. Never auto-resolved. */
  | { readonly state: "RECOVERY_REQUIRED" | "FAILED"; readonly value?: T; readonly reasons: readonly string[]; readonly impact: AyasRuntimeImpactDecision; readonly transaction: AyasStabilityTransaction };

/** Thrown across the guard's `apply` boundary to turn a lane's structured `ok: false` outcome into a failed apply without losing the outcome itself. Never escapes this module. */
class GuardedPublicationFailure<T> extends Error {
  constructor(readonly outcome: T, reason: string) {
    super(reason);
    this.name = "GuardedPublicationFailure";
    this.stack = undefined;
  }
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000 }).trim();
}

/**
 * Journal phases that mean an execution attempt for this subject is neither
 * finished nor provably un-started. `NEVER_STARTED`, `COMPLETED` and `FAILED`
 * are all definite answers already owned by the approval ledger, so they are
 * not listed: refusing on them would strand a subject the ledger considers
 * legitimately retryable.
 */
const UNRESOLVED_JOURNAL_CLASSES: readonly string[] = Object.freeze(["RESERVED_ONLY", "PRE_MUTATION_GATE", "MUTATION_UNCERTAIN", "MUTATION_COMPLETED_UNFINALIZED", "RECOVERY_REQUIRED"]);

/**
 * The guard/journal reconciliation (fail-closed in both directions).
 *
 * Two independent durable records describe the same mutation: the guard's
 * stability transaction log and Package C's execution journal. If they can
 * disagree silently, neither can be trusted. So before a publication may
 * start, BOTH must say this subject has nothing in flight:
 *
 *   - Guard side: no transaction for this subject is still non-terminal
 *     (someone else is publishing it right now, in this or another live
 *     process) and none is `RECOVERY_REQUIRED` (a previous attempt left
 *     something real and unverified). Note that `runAyasControlledOperation`
 *     runs its crash-recovery sweep BEFORE preconditions, so a transaction
 *     orphaned by a dead process has already been resolved to `ABANDONED`
 *     (provably untouched, no block) or `RECOVERY_REQUIRED` (blocks) by the
 *     time this runs.
 *
 *   - Journal side: no execution journal entry for this subject classifies as
 *     an interrupted attempt. This is defence in depth — it catches a crash
 *     that killed the process between the journal write and the guard's own
 *     state transition, the one window where the two records could diverge.
 *
 * An unreadable ledger is itself a refusal, never "no history": silently
 * treating a corrupt store as empty is precisely how an interrupted
 * transaction disappears.
 */
export function findUnresolvedAyasPublicationState(
  lane: AyasPublicationLane,
  subjectId: string,
  deps: { readonly transactionStore: AyasStabilityTransactionStore; readonly gateRoot: string },
): readonly string[] {
  const reasons: string[] = [];

  try {
    for (const transaction of deps.transactionStore.load().transactions) {
      if (!isAyasPublicationOperationFor(transaction.operation, lane, subjectId)) continue;
      if (!AYAS_STABILITY_TERMINAL_STATES.includes(transaction.state)) {
        reasons.push(`stability transaction ${transaction.transactionId} for this ${lane} is still ${transaction.state} under live pid ${transaction.ownerPid}`);
      } else if (transaction.state === "RECOVERY_REQUIRED") {
        reasons.push(`stability transaction ${transaction.transactionId} for this ${lane} is RECOVERY_REQUIRED and must be resolved by a human first`);
      }
    }
  } catch (error) {
    reasons.push(`stability transaction log unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    for (const entry of createAyasExecutionJournal({ rootDir: deps.gateRoot }).list()) {
      if (entry.proposalId !== subjectId) continue;
      const decision = classifyAyasRestartRecovery(entry);
      if (UNRESOLVED_JOURNAL_CLASSES.includes(decision.classification)) {
        reasons.push(`execution journal entry ${entry.executionId} for this ${lane} is ${decision.classification} — an interrupted attempt must be resolved before another one starts`);
      }
    }
  } catch (error) {
    reasons.push(`execution journal unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return Object.freeze(reasons);
}

/**
 * Verifies — without mutating anything — that the lane's own recovery put the
 * repository back where the preflight snapshot found it. Throwing here is the
 * correct outcome, not a bug: it moves the guard transaction to
 * `RECOVERY_REQUIRED`, which is exactly what "a commit exists that we could
 * not prove was intended" should look like. The alternative, resetting or
 * reverting, would make this module a competing recovery authority and could
 * destroy a commit the lane deliberately preserved for human inspection.
 */
function assertAyasPublicationBaselineRestored(repoRoot: string, before: AyasRuntimeStabilitySnapshot | undefined): void {
  if (!before) throw new Error("no preflight snapshot is available, so baseline restoration cannot be proven");
  const head = git(repoRoot, ["rev-parse", "HEAD"]);
  if (head !== before.repo.head) {
    throw new Error(`HEAD moved ${before.repo.head.slice(0, 7)} -> ${head.slice(0, 7)}: the publication is real and is never rewritten automatically`);
  }
  const porcelain = git(repoRoot, ["status", "--porcelain"]);
  if (porcelain.length > 0) {
    const entries = porcelain.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    throw new Error(`working tree still holds ${entries} uncommitted entr${entries === 1 ? "y" : "ies"}: the failed publication was not fully undone`);
  }
}

/**
 * Runs one owner-approved publication under the Runtime Stability Guard.
 *
 * Lifecycle, composed with (never duplicating) what each lane already does:
 *
 *   caller: fresh binding revalidation -> owner decision validation
 *     -> [this module] impact classification
 *     -> [this module] guard preconditions + guard/journal reconciliation
 *     -> guard PREPARED (snapshot + declared scope persisted)
 *     -> APPLYING: the lane's unmodified reserve -> mutate -> test -> commit -> push
 *     -> VERIFYING: health + out-of-scope diff against the preflight snapshot
 *     -> COMPLETED, or ROLLING_BACK -> (verified) ROLLED_BACK / (unproven) RECOVERY_REQUIRED
 *
 * Every terminal state writes a durable transaction record. A publication
 * that reaches a real mutation without one is, after this module, not
 * expressible: the mutation only runs inside `apply`, and `apply` only runs
 * after `store.begin()`.
 */
export async function runGuardedAyasPublication<T extends { readonly ok: boolean }>(request: AyasGuardedPublicationRequest<T>): Promise<AyasGuardedPublicationResult<T>> {
  const impact = classifyAyasRuntimeImpact(request.exactFiles);
  const guard = request.guard ?? {};

  if (!impact.publishable) {
    // Refused without opening a transaction at all: nothing was snapshotted
    // because nothing may be attempted. The lane surfaces this as its own
    // structured refusal.
    return {
      state: "REFUSED",
      impact,
      reasons: Object.freeze([`declared runtime impact ${impact.impactClass} is not publishable through the one-click lane — ${impact.summary}`]),
    };
  }

  const transactionStore = guard.store ?? createAyasStabilityTransactionStore({ rootDir: path.join(request.gateRoot, "stability") });

  const snapshotDeps: AyasRuntimeStabilitySnapshotDeps = {
    repoRoot: request.repoRoot,
    ports: guard.observedPorts ?? AYAS_PUBLICATION_OBSERVED_PORTS,
    // Derived, not assumed: only a class this lane refuses could ever restart
    // a service, so for everything it accepts, process-identity fingerprinting
    // is explicitly not applicable and port+pid continuity is the proof.
    probeCommandLine: impact.serviceRestartApplicable,
    ...(request.inbox === undefined ? {} : { inbox: request.inbox }),
    ...guard.snapshot,
  };

  let before: AyasRuntimeStabilitySnapshot | undefined;
  let laneOutcome: T | undefined;
  let unexpectedError: unknown;

  const outcome = await runAyasControlledOperation<T>(
    {
      operation: ayasPublicationOperationName(request.lane, request.subjectId),
      scope: deriveAyasPublicationScope(ayasPublicationOperationName(request.lane, request.subjectId), impact),
      preconditions: (snapshot) => {
        before = snapshot;
        return [
          // A dirty tree means the mutation would be mixed with unrelated
          // in-flight work and the exact-scope staging check could no longer
          // prove what was published.
          ...baselineAyasPreconditions({ requireCleanRepo: true })(snapshot),
          ...findUnresolvedAyasPublicationState(request.lane, request.subjectId, { transactionStore, gateRoot: request.gateRoot }),
        ];
      },
      apply: async () => {
        try {
          const result = await request.publish();
          laneOutcome = result;
          if (!result.ok) throw new GuardedPublicationFailure(result, "the publication pipeline reported a failure");
          return result;
        } catch (error) {
          // An exception is not a lane outcome — it is a defect or an
          // unexpected environment failure. Record it under the guard, then
          // re-surface it unchanged to the caller so existing throw semantics
          // are preserved exactly.
          if (!(error instanceof GuardedPublicationFailure)) unexpectedError = error;
          throw error;
        }
      },
      expectations: (snapshot) => ({
        // The gate must be exactly what it was: a publication that flipped
        // autonomous execution on or off has changed the rules under which it
        // was itself authorised.
        expectAutonomousExecutionEnabled: snapshot.gate.autonomousExecutionEnabled,
        // Only meaningful when the scheduler WAS operational beforehand.
        // Demanding a live cadence from an installation that never configured
        // one would fail a publication for a subsystem it has no relationship
        // with; when a cadence does exist, losing it is a real regression and
        // is caught here.
        requireSchedulerOperational: snapshot.scheduler.stateFilePresent && snapshot.scheduler.nextLightAt !== undefined && snapshot.scheduler.nextDeepAt !== undefined,
      }),
      rollback: () => { assertAyasPublicationBaselineRestored(request.repoRoot, before); },
    },
    {
      store: transactionStore,
      snapshot: snapshotDeps,
      ...(guard.captureSnapshot === undefined ? {} : { captureSnapshot: guard.captureSnapshot }),
      ...(guard.now === undefined ? {} : { now: guard.now }),
      ...(guard.skipRecovery === undefined ? {} : { skipRecovery: guard.skipRecovery }),
    },
  );

  if (unexpectedError !== undefined) throw unexpectedError;

  if (outcome.ok) return { state: "COMPLETED", value: outcome.value, impact, transaction: outcome.transaction };
  if (outcome.state === "REFUSED") return { state: "REFUSED", reasons: outcome.reasons, impact };
  if (outcome.state === "ROLLED_BACK" && laneOutcome !== undefined) {
    return { state: "ROLLED_BACK", value: laneOutcome, reasons: outcome.reasons, impact, transaction: outcome.transaction };
  }
  return {
    state: outcome.state === "ROLLED_BACK" ? "FAILED" : outcome.state,
    ...(laneOutcome === undefined ? {} : { value: laneOutcome }),
    reasons: outcome.reasons,
    impact,
    transaction: outcome.transaction,
  };
}
