import { execFileSync } from "node:child_process";

import type { AyasApprovalInboxHandle, AyasApprovalInboxState, AyasInboxProposal, AyasInboxProposalStatus, AyasInboxDecisionRecord, AyasInboxResultRecord } from "./AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "./AyasAutonomyDaemon";
import { reconcileAyasMicroBatchStaleness } from "./AyasMicroBatchStaleness";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatch } from "./AyasMicroBatch";
import { createAyasMicroItemStore, type AyasMicroItemStore } from "./AyasMicroItem";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { runAyasBoundedMutationWithValidators } from "./AyasMutationRegistry";
import { createAyasSmokeTestValidator } from "./AyasMutationValidators";

/**
 * M18 — batch execution, entirely reusing `AyasAutonomyDaemon.executeApproved`
 * (M15's Package C authority) UNCHANGED. `executeApproved` is written
 * against the `AyasApprovalInboxHandle` interface (reservation/journal/gate/
 * authority-lock/revalidation/finalization all live there, untouched); a
 * batch is durably a different shape (`AyasMicroBatch`, multiple items) so
 * it is never force-fit into `AyasInboxProposal` directly. Instead this
 * module builds a thin, read-through ADAPTER that projects the CURRENT
 * batch + its latest decision into exactly the `AyasApprovalInboxHandle`
 * shape `executeApproved`/`revalidateAyasExecution` actually read from —
 * every method that matters (`reserveApproval`, `finalizeApproval`,
 * `recordResult`, `load`) delegates straight through to the real
 * `AyasMicroBatchStoreHandle`, so the SAME one-shot-reservation, fail-closed
 * guarantees apply. Methods `executeApproved` never calls
 * (`save`/`createProposal`/`decide`/`markStale`/`consumeApproval`) throw if
 * ever reached — a structural proof they are unreachable on this path.
 */
export class AyasMicroBatchExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AyasMicroBatchExecutionError";
    this.stack = undefined;
  }
}

function mapBatchStatusToProposalStatus(status: AyasMicroBatch["status"]): AyasInboxProposalStatus {
  switch (status) {
    case "APPROVED": case "RESERVED": case "COMPLETED": case "FAILED": case "STALE": case "ABANDONED": case "RECOVERY_REQUIRED":
      return status;
    default:
      // ACCUMULATING/READY_FOR_REVIEW must never reach the execution adapter — only a RESERVED-or-later batch does.
      throw new AyasMicroBatchExecutionError("AYAS_MICRO_BATCH_ADAPTER_UNEXPECTED_STATUS", `unexpected batch status reached the execution adapter: ${status}`);
  }
}

function createAyasMicroBatchAsInboxAdapter(batchStore: AyasMicroBatchStoreHandle, batchId: string): AyasApprovalInboxHandle {
  const unsupported = (name: string) => (): never => { throw new AyasMicroBatchExecutionError("AYAS_MICRO_BATCH_ADAPTER_UNSUPPORTED", `${name} must never be called via the batch execution adapter — structurally unreachable`); };
  return {
    stateFile: batchStore.stateFile,
    load(): AyasApprovalInboxState {
      const raw = batchStore.load();
      const batch = raw.batches.find((b) => b.batchId === batchId);
      const decision = [...raw.decisions].reverse().find((d) => d.batchId === batchId);
      const proposals: readonly AyasInboxProposal[] = batch ? [{
        schemaVersion: "1", proposalId: batch.batchId, createdAt: batch.createdAt, lastUpdatedAt: batch.lastUpdatedAt,
        baseBranch: batch.baseBranch, baseHead: batch.baseHead, objective: `micro batch (${batch.items.length} item(s))`,
        rationale: batch.aggregateRisk, evidence: batch.validationSummary, graphifyEvidence: [], candidateRank: 1,
        risk: batch.aggregateRisk, safetyClassification: "SAFE", exactFiles: batch.exactFilesUnion,
        expectedDiffScope: `${batch.items.length} micro item(s)`, testsPlanned: batch.validatorUnion,
        estimatedCost: "zero-cost", proposalHash: batch.batchHash, status: mapBatchStatusToProposalStatus(batch.status),
        createdBy: "ayas-daemon", mutationKind: "micro-batch:v1",
      }] : [];
      const decisions: readonly AyasInboxDecisionRecord[] = decision ? [{
        decisionId: decision.decisionId, proposalId: decision.batchId, proposalHash: decision.batchHash,
        decision: decision.decision, decidedAt: decision.decidedAt, authorizationId: decision.authorizationId,
        reservationId: decision.reservationId, reservedAt: decision.reservedAt, finalizedAt: decision.finalizedAt,
        finalizationOutcome: decision.finalizationOutcome, evidenceFingerprint: decision.batchHash,
      }] : [];
      return { schemaVersion: "1", revision: raw.revision, proposals, decisions, results: [] };
    },
    save: unsupported("save"),
    createProposal: unsupported("createProposal"),
    decide: unsupported("decide") as AyasApprovalInboxHandle["decide"],
    markStale: unsupported("markStale") as AyasApprovalInboxHandle["markStale"],
    consumeApproval: unsupported("consumeApproval") as AyasApprovalInboxHandle["consumeApproval"],
    reserveApproval(_proposalId, proposalHashValue, baseHead, _exactFiles, now) {
      return batchStore.reserveApproval(batchId, proposalHashValue, baseHead, now);
    },
    finalizeApproval(reservationId, outcome, now) {
      batchStore.finalizeApproval(reservationId, outcome, now);
    },
    recordResult(result: AyasInboxResultRecord, status) {
      batchStore.recordResult({ resultId: result.resultId, batchId, authorizationId: result.authorizationId, startedAt: result.startedAt, completedAt: result.completedAt, changedFiles: result.changedFiles, testsRun: result.testsRun, testResults: result.testResults, outcome: status }, status);
    },
  };
}

export interface AyasMicroBatchExecutionDeps {
  readonly repoRoot: string;
  readonly gateRoot: string;
  readonly batchStore?: AyasMicroBatchStoreHandle;
  readonly itemStore?: AyasMicroItemStore;
  readonly artifactStore?: AyasPatchArtifactStore;
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

/**
 * The one real batch execution entrypoint. Accepts only a `batchId` — every
 * other input (patch content, exactFiles, validators) is re-derived here
 * from durable state (the batch's own items, each independently
 * `loadVerified`) immediately before delegating to
 * `AyasAutonomyDaemon.executeApproved()` via the adapter above.
 */
export async function executeAyasApprovedMicroBatchWith(batchId: string, deps: AyasMicroBatchExecutionDeps): Promise<void> {
  if (typeof batchId !== "string" || !batchId.trim()) throw new AyasMicroBatchExecutionError("INVALID_INPUT", "batchId is required");
  const batchStore = deps.batchStore ?? createAyasMicroBatchStore();
  const itemStore = deps.itemStore ?? createAyasMicroItemStore();
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore();

  const batch = batchStore.load().batches.find((b) => b.batchId === batchId);
  if (!batch) throw new AyasMicroBatchExecutionError("NOT_FOUND", "batch not found");
  if (batch.status !== "APPROVED") throw new AyasMicroBatchExecutionError("NOT_APPROVED", `batch status is ${batch.status}`);

  // Re-derive and cross-check every item's frozen artifact BEFORE execution — no regeneration, no silent drift (M17 Phase 2 immutability, applied per-item here).
  const items = batch.items.map((ref) => {
    const artifact = artifactStore.loadVerified(ref.patchArtifactId);
    if (artifact.patchHash !== ref.patchHash) throw new AyasMicroBatchExecutionError("AYAS_MICRO_BATCH_ITEM_HASH_MISMATCH", `item ${ref.microItemId} artifact patchHash does not match the batch's recorded patchHash`);
    if (JSON.stringify(artifact.exactFiles) !== JSON.stringify(ref.exactFiles)) throw new AyasMicroBatchExecutionError("AYAS_MICRO_BATCH_ITEM_SCOPE_MISMATCH", `item ${ref.microItemId} artifact exactFiles does not match the batch record`);
    if (artifact.safetyClassification !== "SAFE") throw new AyasMicroBatchExecutionError("AYAS_MICRO_BATCH_ITEM_UNSAFE", `item ${ref.microItemId} artifact is not SAFE`);
    return { ref, artifact };
  });

  const currentHead = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const repoClean = git(deps.repoRoot, ["status", "--porcelain"]).length === 0;

  reconcileAyasMicroBatchStaleness(batchStore, currentHead, new Date().toISOString());
  const freshBatch = batchStore.load().batches.find((b) => b.batchId === batchId);
  if (!freshBatch || freshBatch.status !== "APPROVED") throw new AyasMicroBatchExecutionError("STALE_APPROVAL", "batch state changed since lookup");

  const adapter = createAyasMicroBatchAsInboxAdapter(batchStore, batchId);
  const daemon = createAyasAutonomyDaemon({ inbox: adapter, gateRoot: deps.gateRoot, repoRoot: deps.repoRoot });

  await daemon.executeApproved({
    proposalId: batch.batchId,
    proposalHash: batch.batchHash,
    baseHead: batch.baseHead,
    currentHead,
    exactFiles: batch.exactFilesUnion,
    currentExactFiles: freshBatch.exactFilesUnion,
    repoClean,
    applyWhileExecuting: async () => {
      // All items applied as ONE bounded, atomic, rollback-on-any-failure operation
      // (AyasBoundedFileWrite's own guarantee — Phase 23's "whole batch rollback,
      // never half-applied") — every item's replacements combined, every item's
      // validators combined, exactly the M17 runAyasBoundedMutationWithValidators
      // primitive, unmodified.
      const allReplacements = items.flatMap(({ artifact }) => artifact.replacements);
      const allValidatorScripts = [...new Set(items.flatMap(({ artifact }) => artifact.validatorScripts))];
      const run = await runAyasBoundedMutationWithValidators(deps.repoRoot, ["scripts/"], allReplacements, allValidatorScripts.map((s) => createAyasSmokeTestValidator(s)));
      return { changedFiles: run.changedFiles, diffFingerprint: "", testsRun: run.testsRun, testResults: run.testResults };
    },
  });

  for (const { ref } of items) {
    try { itemStore.transition(ref.microItemId, "EXECUTED", new Date().toISOString()); } catch { /* best-effort bookkeeping — the durable batch result above is the authoritative record */ }
  }
}

export { mapBatchStatusToProposalStatus };
