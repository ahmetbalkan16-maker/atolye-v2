import crypto from "node:crypto";

import type { AyasApprovalInboxHandle, AyasApprovalInboxState, AyasInboxDecisionRecord, AyasInboxProposal, AyasInboxRecoveryResolutionKind } from "./AyasApprovalInboxStore";
import type { AyasMicroBatch, AyasMicroBatchStoreHandle } from "./AyasMicroBatch";
import type { AyasMicroItemStore } from "./AyasMicroItem";
import type { AyasPatchArtifact, AyasPatchArtifactStore } from "./AyasPatchArtifact";

/**
 * The micro-batch lane's half of the publication self-heal (owner, 2026-11-05: "böyle hatalarda sistem kendi kendini
 * düzeltsin"). AyasMicroBatchApprovalService leaves a batch RECOVERY_REQUIRED when its one commit stood but the push
 * failed. These two adapters let the proposal lane's recovery proof (AyasRecoveryReconciliation) run over such a
 * batch unchanged: the batch appears as one RECOVERY_REQUIRED proposal whose artifact is the union of its items'
 * frozen artifacts, and a proven outcome closes it through the batch store's own `recordResult` — COMPLETED with its
 * items EXECUTED when the approved commit is on the remote, FAILED when nothing of it remains. Nothing here runs Git,
 * re-runs a batch, approves or reserves anything; every other inbox operation is refused.
 */

export const AYAS_MICRO_BATCH_RECOVERY_ARTIFACT_PREFIX = "micro-batch:";
const RECOVERY_EVIDENCE = /^[A-Za-z0-9._:-]{7,120}$/;

export class AyasMicroBatchRecoveryError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "AyasMicroBatchRecoveryError"; this.stack = undefined; }
}

const openRecoveries = (batchStore: AyasMicroBatchStoreHandle): readonly AyasMicroBatch[] => batchStore.load().batches.filter((batch) => batch.status === "RECOVERY_REQUIRED");

export function countAyasOpenMicroBatchRecoveries(batchStore: AyasMicroBatchStoreHandle): number {
  return openRecoveries(batchStore).length;
}

function asProposal(batch: AyasMicroBatch): AyasInboxProposal {
  return {
    schemaVersion: "1", proposalId: batch.batchId, createdAt: batch.createdAt, lastUpdatedAt: batch.lastUpdatedAt,
    baseBranch: batch.baseBranch, baseHead: batch.baseHead, objective: `micro batch (${batch.items.length} item(s))`,
    rationale: batch.aggregateRisk, evidence: batch.validationSummary, graphifyEvidence: [], candidateRank: 1,
    risk: batch.aggregateRisk, safetyClassification: "SAFE", exactFiles: batch.exactFilesUnion,
    expectedDiffScope: `${batch.items.length} micro item(s)`, testsPlanned: batch.validatorUnion,
    estimatedCost: "zero-cost", proposalHash: batch.batchHash, status: "RECOVERY_REQUIRED",
    createdBy: "ayas-daemon", mutationKind: "micro-batch:v1",
    patchArtifactId: `${AYAS_MICRO_BATCH_RECOVERY_ARTIFACT_PREFIX}${batch.batchId}`,
  };
}

/** The open batch recoveries as an inbox the recovery proof can read and close. */
export function createAyasMicroBatchRecoveryInbox(batchStore: AyasMicroBatchStoreHandle, itemStore: AyasMicroItemStore): AyasApprovalInboxHandle {
  const refused = (name: string) => (): never => { throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_UNSUPPORTED", `${name} is not part of a batch recovery`); };
  return {
    stateFile: batchStore.stateFile,
    load(): AyasApprovalInboxState {
      const raw = batchStore.load();
      const batches = raw.batches.filter((batch) => batch.status === "RECOVERY_REQUIRED");
      const ids = new Set(batches.map((batch) => batch.batchId));
      const decisions: AyasInboxDecisionRecord[] = raw.decisions.filter((decision) => ids.has(decision.batchId)).map((decision) => ({
        decisionId: decision.decisionId, proposalId: decision.batchId, proposalHash: decision.batchHash, decision: decision.decision,
        decidedAt: decision.decidedAt, authorizationId: decision.authorizationId, reservationId: decision.reservationId, reservedAt: decision.reservedAt,
        finalizedAt: decision.finalizedAt, finalizationOutcome: decision.finalizationOutcome, evidenceFingerprint: decision.batchHash,
      }));
      return { schemaVersion: "1", revision: raw.revision, proposals: batches.map(asProposal), decisions, results: [] };
    },
    resolveRecovery(proposalId: string, resolution: { readonly kind: AyasInboxRecoveryResolutionKind; readonly evidence: string }, now: string): AyasInboxProposal {
      const state = batchStore.load();
      const batch = state.batches.find((entry) => entry.batchId === proposalId);
      if (!batch) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_INVALID", "batch not found");
      if (batch.status !== "RECOVERY_REQUIRED") throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_INVALID", `batch is not RECOVERY_REQUIRED: ${batch.status}`);
      if (!["ROLLBACK_VERIFIED", "PUBLISHED_VERIFIED", "NO_MUTATION_REMAINS"].includes(resolution.kind)) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_INVALID", "unknown recovery resolution kind");
      if (!RECOVERY_EVIDENCE.test(resolution.evidence)) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_INVALID", "recovery evidence must be a record id or commit SHA");
      const decision = [...state.decisions].reverse().find((entry) => entry.batchId === proposalId && entry.finalizationOutcome === "RECOVERY_REQUIRED");
      if (!decision?.authorizationId) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_INVALID", "no RECOVERY_REQUIRED reservation for this batch");
      const published = resolution.kind === "PUBLISHED_VERIFIED";
      batchStore.recordResult({
        resultId: `ayas-micro-batch-recovery-${crypto.randomUUID()}`, batchId: batch.batchId, authorizationId: decision.authorizationId,
        startedAt: decision.reservedAt ?? decision.decidedAt, completedAt: now, changedFiles: published ? [...batch.exactFilesUnion] : [],
        testsRun: [], testResults: [`ayas-recovery-reconciliation ${resolution.kind}: ${resolution.evidence}`],
        outcome: published ? "COMPLETED" : resolution.kind === "ROLLBACK_VERIFIED" ? "ROLLED_BACK" : "FAILED",
      }, published ? "COMPLETED" : "FAILED");
      // The published items are done, as after an uninterrupted publication; an item already moved on is left as it is.
      if (published) for (const item of batch.items) {
        try { if (itemStore.load(item.microItemId).state === "BATCHED") itemStore.transition(item.microItemId, "EXECUTED", now); } catch { /* the batch result is the record */ }
      }
      return { ...asProposal(batch), status: published ? "COMPLETED" : "FAILED", lastUpdatedAt: now };
    },
    save: refused("save"),
    createProposal: refused("createProposal"),
    decide: refused("decide") as AyasApprovalInboxHandle["decide"],
    markStale: refused("markStale") as AyasApprovalInboxHandle["markStale"],
    reserveApproval: refused("reserveApproval") as AyasApprovalInboxHandle["reserveApproval"],
    consumeApproval: refused("consumeApproval") as AyasApprovalInboxHandle["consumeApproval"],
    finalizeApproval: refused("finalizeApproval") as AyasApprovalInboxHandle["finalizeApproval"],
    recordResult: refused("recordResult") as AyasApprovalInboxHandle["recordResult"],
  };
}

/**
 * A batch's approved content as one artifact: every item's frozen artifact, verified, with its patch hash as the batch
 * recorded it; no file in two items; together exactly the batch's files. Any other id is the ordinary artifact store's.
 */
export function createAyasMicroBatchArtifactView(batchStore: AyasMicroBatchStoreHandle, artifacts: AyasPatchArtifactStore): AyasPatchArtifactStore {
  return {
    dir: artifacts.dir,
    freeze: (artifact) => artifacts.freeze(artifact),
    load: (artifactId) => artifacts.load(artifactId),
    loadVerified(artifactId: string): AyasPatchArtifact {
      if (!artifactId.startsWith(AYAS_MICRO_BATCH_RECOVERY_ARTIFACT_PREFIX)) return artifacts.loadVerified(artifactId);
      const batchId = artifactId.slice(AYAS_MICRO_BATCH_RECOVERY_ARTIFACT_PREFIX.length);
      const batch = batchStore.load().batches.find((entry) => entry.batchId === batchId);
      if (!batch || !batch.items.length) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_ARTIFACT", "batch not found or empty");
      const loaded = batch.items.map((item) => {
        const artifact = artifacts.loadVerified(item.patchArtifactId);
        if (artifact.patchHash !== item.patchHash) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_ARTIFACT", `item ${item.microItemId} artifact hash differs from the batch`);
        return artifact;
      });
      const replacements = loaded.flatMap((artifact) => artifact.replacements);
      const files = replacements.map((replacement) => replacement.filePath);
      if (new Set(files).size !== files.length) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_ARTIFACT", "two items replace the same file");
      if (JSON.stringify([...files].sort()) !== JSON.stringify([...batch.exactFilesUnion].sort())) throw new AyasMicroBatchRecoveryError("AYAS_MICRO_BATCH_RECOVERY_ARTIFACT", "items do not cover exactly the batch's files");
      return { ...loaded[0]!, artifactId, exactFiles: [...batch.exactFilesUnion], replacements };
    },
  };
}
