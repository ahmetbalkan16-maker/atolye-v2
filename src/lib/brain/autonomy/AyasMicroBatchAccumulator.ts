import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { applyAyasBoundedFileReplacements } from "./AyasBoundedFileWrite";
import { findAyasErrorCodeContractGaps, generateAyasErrorCodeContractPatch, checkAyasNovelPatchLimits } from "./AyasPatchDetectors";
import { classifyAyasMicroCandidate } from "./AyasMicroClassifier";
import { ensureAyasMicroBatchWorktree, isAyasMicroBatchWorktreeCurrent, captureAyasMicroBatchWorktreeDiff, type AyasMicroBatchWorktreeHandle } from "./AyasMicroBatchWorktree";
import { createAyasSandboxTypecheckValidator } from "./AyasPatchSandbox";
import { runAyasValidators, createAyasSmokeTestValidator, AyasValidatorFailedError } from "./AyasMutationValidators";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore, type AyasPatchArtifact } from "./AyasPatchArtifact";
import { createAyasMicroItemStore, type AyasMicroItemStore, type AyasMicroItem } from "./AyasMicroItem";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle, type AyasMicroBatch, type AyasMicroBatchItemRef } from "./AyasMicroBatch";
import { evaluateAyasMicroBatchReadiness, AYAS_MICRO_BATCH_MAX_ITEMS, AYAS_MICRO_BATCH_MAX_ATTEMPTS_PER_TICK } from "./AyasMicroBatchLimits";
import { supersedeStaleBatchOrphans } from "./AyasMicroBatchStaleness";
import type { AyasDaemonObservation } from "./AyasAutonomyDaemon";

/**
 * M18 — the batch accumulator. Runs alongside (not instead of)
 * `AyasNovelPatchDiscovery`'s existing M17 individual-proposal pipeline:
 * both share the SAME detector (`findAyasErrorCodeContractGaps`), but a
 * candidate classified `MICRO_SAFE` is handled here (accumulated into the
 * persistent batch worktree, never an individual human-facing proposal);
 * anything else (`PRIORITY_SAFE`) is left for `AyasNovelPatchDiscovery` to
 * propose individually, unchanged — see the classification check added
 * there. This module never creates an `AyasInboxProposal`, never opens a
 * gate, never reserves, never executes real source — it only ever writes
 * into the disposable/persistent WORKTREE (outside the real repo) and this
 * module's own micro-item/batch stores.
 */
export interface AyasMicroBatchAccumulationRejection { readonly semanticKey: string; readonly reason: string; }

export interface AyasMicroBatchAccumulationResult {
  readonly itemsAdded: readonly AyasMicroItem[];
  readonly batch: AyasMicroBatch | null;
  readonly rejections: readonly AyasMicroBatchAccumulationRejection[];
  readonly readyForReview: boolean;
  readonly staledPreviousBatchId: string | null;
}

export interface AyasMicroBatchAccumulatorDeps {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
  readonly itemStore?: AyasMicroItemStore;
  readonly batchStore?: AyasMicroBatchStoreHandle;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly maxAttemptsPerTick?: number;
}

function totalLinesOf(content: string): number {
  return content.split("\n").length;
}

async function validateInWorktree(handle: AyasMicroBatchWorktreeHandle, targetFile: string): Promise<readonly { readonly validator: string; readonly pass: boolean; readonly summary: string }[]> {
  const validators = [createAyasSandboxTypecheckValidator(), createAyasSmokeTestValidator(targetFile)];
  return runAyasValidators(handle.worktreeRoot, validators);
}

export async function accumulateAyasMicroBatchCandidates(deps: AyasMicroBatchAccumulatorDeps): Promise<AyasMicroBatchAccumulationResult> {
  const { repoRoot, observation } = deps;
  const itemStore = deps.itemStore ?? createAyasMicroItemStore();
  const batchStore = deps.batchStore ?? createAyasMicroBatchStore();
  const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore();
  const maxAttempts = deps.maxAttemptsPerTick ?? AYAS_MICRO_BATCH_MAX_ATTEMPTS_PER_TICK;

  if (!observation.repoClean || observation.machineAction === "PAUSE" || observation.machineAction === "STOP OWN WORKLOAD") {
    return { itemsAdded: [], batch: null, rejections: [], readyForReview: false, staledPreviousBatchId: null };
  }

  const state = batchStore.load();
  let activeBatch = state.batches.find((b) => b.status === "ACCUMULATING" || b.status === "READY_FOR_REVIEW") ?? null;
  let staledPreviousBatchId: string | null = null;

  // A non-accumulating, non-terminal batch (APPROVED/RESERVED — mid human-authority lifecycle) blocks starting a new one; report current state and do nothing further this tick.
  const blockingBatch = state.batches.find((b) => b.status === "APPROVED" || b.status === "RESERVED");
  if (blockingBatch && !activeBatch) {
    return { itemsAdded: [], batch: blockingBatch, rejections: [], readyForReview: false, staledPreviousBatchId: null };
  }

  const { handle, rebuilt } = await ensureAyasMicroBatchWorktree(repoRoot, observation.head);
  if (rebuilt && activeBatch && activeBatch.baseHead !== observation.head) {
    // Real branch moved on since this batch's baseHead — Phase 10: never silently carry an old approval/accumulation across a HEAD change. The worktree was already rebuilt fresh (empty) above; mark the old batch record STALE for audit and start clean. (Simplification, disclosed: still-valid items are not auto-replayed into the fresh worktree — a future tick naturally rediscovers any gap that's still real and re-accumulates it as new items.)
    if (activeBatch.status === "ACCUMULATING" || activeBatch.status === "READY_FOR_REVIEW") {
      activeBatch = batchStore.markStale(activeBatch.batchId, observation.now);
      staledPreviousBatchId = activeBatch.batchId;
      // Orphan reconciliation: the batch above is STALE now, but its own member
      // items are a separate durable record and are never implicitly staled by
      // that transition — without this, they would stay BATCHED forever and
      // permanently block their semanticKey from ever being rediscovered. Reuses
      // the exact same idempotent, crash-safe helper `reconcileAyasMicroBatchStaleness`
      // itself calls, rather than duplicating the reconciliation logic here.
      supersedeStaleBatchOrphans(batchStore, itemStore, observation.now);
    }
    activeBatch = null;
  }

  const currentItemCount = activeBatch?.items.length ?? 0;
  const capacity = Math.max(0, AYAS_MICRO_BATCH_MAX_ITEMS - currentItemCount);
  if (capacity === 0) {
    return { itemsAdded: [], batch: activeBatch, rejections: [], readyForReview: activeBatch?.status === "READY_FOR_REVIEW", staledPreviousBatchId };
  }

  const activeSemanticKeys = new Set((activeBatch?.items ?? []).map((i) => i.semanticKey));
  const gaps = findAyasErrorCodeContractGaps(repoRoot).filter((gap) => {
    const generated = generateAyasErrorCodeContractPatch(gap);
    if (fs.existsSync(path.join(repoRoot, generated.exactFiles[0]!))) return false; // completed-target detection
    if (activeSemanticKeys.has(generated.candidateId)) return false; // already in this batch
    const priorActive = itemStore.findBySemanticKey(generated.candidateId).some((item) => item.state !== "REJECTED" && item.state !== "SUPERSEDED");
    return !priorActive; // cross-restart/cross-tick dedup
  });

  const itemsAdded: AyasMicroItem[] = [];
  const rejections: AyasMicroBatchAccumulationRejection[] = [];
  const activeExactFiles = new Set((activeBatch?.items ?? []).flatMap((i) => i.exactFiles));

  for (const gap of gaps.slice(0, Math.min(maxAttempts, capacity))) {
    const generated = generateAyasErrorCodeContractPatch(gap);
    const classification = classifyAyasMicroCandidate({ exactFiles: generated.exactFiles, totalLines: totalLinesOf(generated.replacements[0]!.content), generatorIdentity: generated.generatorIdentity });
    if (classification.classification !== "MICRO_SAFE") continue; // PRIORITY_SAFE / NOT_SAFE belong to the other lane

    const limitViolations = checkAyasNovelPatchLimits(generated.replacements);
    if (limitViolations.length > 0) {
      rejections.push({ semanticKey: generated.candidateId, reason: `blast-radius/domain policy: ${limitViolations.map((v) => `${v.rule}: ${v.detail}`).join("; ")}` });
      continue;
    }
    if (generated.exactFiles.some((f) => activeExactFiles.has(f))) {
      rejections.push({ semanticKey: generated.candidateId, reason: "overlaps with a file already in this batch" });
      continue;
    }

    let validatorResults: Awaited<ReturnType<typeof validateInWorktree>>;
    try {
      // Apply + validate as ONE bounded, rollback-on-failure operation (the same applyAyasBoundedFileReplacements guarantee M17's runAyasBoundedMutationWithValidators already relies on) — a failing item never leaves debris in the persistent worktree.
      validatorResults = await applyAyasBoundedFileReplacements(handle.worktreeRoot, ["scripts/"], generated.replacements, async () => {
        const results = await validateInWorktree(handle, generated.exactFiles[0]!);
        if (results.some((r) => !r.pass)) throw new AyasValidatorFailedError(results);
        return results;
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rejections.push({ semanticKey: generated.candidateId, reason: `sandbox validation failed: ${reason}` });
      continue;
    }

    const artifactInput: Omit<AyasPatchArtifact, "schemaVersion" | "patchHash"> = {
      artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
      candidateId: generated.candidateId,
      generatorIdentity: generated.generatorIdentity,
      baseBranch: observation.branch,
      baseHead: observation.head,
      exactFiles: generated.exactFiles,
      allowedRoots: ["scripts/"],
      replacements: generated.replacements,
      validatorScripts: generated.validatorScripts,
      graphifyEvidence: generated.graphifyEvidence,
      safetyClassification: "SAFE",
      problemStatement: generated.currentProblem,
      rationale: generated.rationale,
      expectedUserBenefit: generated.expectedUserBenefit,
      expectedBehaviorChange: generated.expectedBehaviorChange,
      unchangedBehavior: generated.unchangedBehavior,
      risk: generated.riskIfNotDone,
      productionImpact: generated.productionImpact,
      sandboxValidationSummary: validatorResults!.map((r) => `${r.validator}: ${r.pass ? "PASS" : "FAIL"} — ${r.summary}`),
      generatedAt: observation.now,
    };
    const artifact = artifactStore.freeze(artifactInput);

    const item = itemStore.create({
      discoveryClass: "error-code-contract-gap",
      semanticKey: generated.candidateId,
      baseHead: observation.head,
      patchArtifactId: artifact.artifactId,
      patchHash: artifact.patchHash,
      exactFiles: generated.exactFiles,
      validatorScripts: generated.validatorScripts,
      safetyClassification: "SAFE",
      graphifyEvidence: generated.graphifyEvidence,
      reason: generated.currentProblem,
      expectedBenefit: generated.expectedUserBenefit,
      risk: generated.riskIfNotDone,
      generatedAt: observation.now,
      validatedAt: observation.now,
    });
    const validated = itemStore.transition(item.microItemId, "SANDBOX_VALIDATED", observation.now);
    itemsAdded.push(validated);
    for (const f of generated.exactFiles) activeExactFiles.add(f);
  }

  if (itemsAdded.length === 0) {
    return { itemsAdded: [], batch: activeBatch, rejections, readyForReview: activeBatch?.status === "READY_FOR_REVIEW", staledPreviousBatchId };
  }

  const allItems: AyasMicroBatchItemRef[] = [...(activeBatch?.items ?? []), ...itemsAdded.map((i): AyasMicroBatchItemRef => ({ microItemId: i.microItemId, semanticKey: i.semanticKey, patchArtifactId: i.patchArtifactId, patchHash: i.patchHash, exactFiles: i.exactFiles }))];
  const exactFilesUnion = [...new Set(allItems.flatMap((i) => i.exactFiles))];
  const combinedValidatorUnion = [...new Set([...(activeBatch?.validatorUnion ?? []), ...itemsAdded.flatMap((i) => i.validatorScripts)])];

  const batch = batchStore.createOrVersion({
    batchId: activeBatch?.batchId,
    batchVersion: (activeBatch?.batchVersion ?? 0) + 1,
    baseHead: observation.head,
    baseBranch: observation.branch,
    items: allItems,
    exactFilesUnion,
    validatorUnion: combinedValidatorUnion,
    worktreeBaseHead: handle.baseHead,
    createdAt: activeBatch?.createdAt ?? observation.now,
    validationSummary: itemsAdded.flatMap((i) => [`${i.microItemId}: SANDBOX_VALIDATED`]),
    aggregateRisk: `${allItems.length} micro item(s); each individually SAFE-classified and sandbox-validated`,
  });

  const batched = itemsAdded.map((item) => itemStore.transition(item.microItemId, "BATCHED", observation.now, { batchId: batch.batchId }));

  const readiness = evaluateAyasMicroBatchReadiness(allItems.length, batch.createdAt, observation.now);
  const finalBatch = readiness.ready && batch.status === "ACCUMULATING" ? batchStore.markReadyForReview(batch.batchId, observation.now) : batch;

  return { itemsAdded: batched, batch: finalBatch, rejections, readyForReview: finalBatch.status === "READY_FOR_REVIEW", staledPreviousBatchId };
}

export { captureAyasMicroBatchWorktreeDiff, isAyasMicroBatchWorktreeCurrent };
