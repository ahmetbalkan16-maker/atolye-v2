import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { runAyasBoundedMutationWithValidators } from "./AyasMutationRegistry";
import type { AyasMutationImplementation } from "./AyasMutationRegistry";
import { createAyasCognitiveEvidenceValidator, createAyasRetrievalResolutionValidator, createAyasSmokeTestValidator } from "./AyasMutationValidators";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";
import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { verifyAyasExecutedExactPatch } from "../selfheal/AyasExactPatchSafety";
import { verifyAyasExactProposalSafety } from "./AyasExactProposalSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "./AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore, type AyasResearchExperimentStore } from "./AyasResearchExperimentStore";

/**
 * M17 — the one, generic resolution path for every `mutationKind:
 * "patch-artifact:v1"` proposal. Unlike `AyasMutationRegistry`'s static
 * `Map` (whose `exactFiles` is fixed per entry, reviewed at author time),
 * a patch-artifact proposal's content varies per artifact — so instead of
 * a registry lookup, this re-derives the frozen artifact from durable
 * storage and cross-checks every binding (`patchHash`, `baseHead`,
 * `exactFiles`, safety) before ever returning something Package C can run.
 * `AyasProposalExecutionService` calls this INSTEAD of `resolveAyasMutation`
 * only when `proposal.mutationKind === AYAS_PATCH_ARTIFACT_MUTATION_KIND` —
 * every other mutationKind keeps using the static registry, completely
 * unchanged. Same downstream authority: `daemon.executeApproved()` remains
 * the sole reservation/journal/gate/finalization authority either way.
 */
export class AyasPatchArtifactMutationError extends Error {
  constructor(readonly code:
    | "AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED"
    | "AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH"
    | "AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", message: string) {
    super(message);
    this.name = "AyasPatchArtifactMutationError";
    this.stack = undefined;
  }
}

function sameOrderedFiles(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function resolveAyasPatchArtifactMutation(proposal: AyasInboxProposal, store?: AyasPatchArtifactStore,
  repoRoot = process.cwd(), experimentStore?: AyasResearchExperimentStore): AyasMutationImplementation {
  if (proposal.mutationKind !== AYAS_PATCH_ARTIFACT_MUTATION_KIND) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED", `not a patch-artifact proposal: ${proposal.mutationKind ?? "(none)"}`);
  }
  if (!proposal.patchArtifactId || !proposal.patchHash) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_NOT_REFERENCED", "proposal is missing patchArtifactId/patchHash");
  }
  const artifactStore = store ?? createAyasPatchArtifactStore();
  // `loadVerified` already re-derives the artifact's own hash from its own
  // content and throws on tamper/corruption — this is the SECOND, independent
  // check that the proposal's recorded `patchHash` still matches that
  // artifact, so neither the artifact file nor the proposal record can be
  // swapped without detection.
  const artifact = artifactStore.loadVerified(proposal.patchArtifactId);
  if (artifact.patchHash !== proposal.patchHash) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_HASH_MISMATCH", "artifact patchHash does not match the proposal's recorded patchHash");
  }
  if (artifact.baseHead !== proposal.baseHead) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_HEAD_MISMATCH", "artifact baseHead does not match the proposal's baseHead");
  }
  if (!sameOrderedFiles(artifact.exactFiles, proposal.exactFiles)) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH", "artifact exactFiles does not match the proposal's exactFiles");
  }
  if (artifact.safetyClassification !== "SAFE") {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", `artifact safety classification is not SAFE: ${artifact.safetyClassification}`);
  }
  const exactReview = classifyPatchSet(proposal.exactFiles).level === "REVIEW_REQUIRED";
  if (exactReview && !verifyAyasExactProposalSafety(proposal, { repoRoot, artifactStore, experimentStore })) {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", "exact reviewed patch evidence does not match the current proposal, artifact and HEAD");
  }
  if (classifyPatchSet(proposal.exactFiles).level === "FORBIDDEN_AUTONOMOUS") {
    throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", "forbidden path cannot inherit artifact approval");
  }
  return {
    exactFiles: artifact.exactFiles,
    run: (executionRoot: string) => {
      if (exactReview && !verifyAyasExactProposalSafety(proposal, { repoRoot: executionRoot, artifactStore, experimentStore })) {
        throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", "exact proof changed before execution");
      }
      const proof = proposal.exactPatchSafetyProof;
      const evidence = exactReview && proof ? (experimentStore ?? createAyasResearchExperimentStore()).readEvidence(proof.evidenceHash) : undefined;
      const expectedMeasurement = evidence?.experiment;
      const cognitiveMeasurement = expectedMeasurement && "benchmarkId" in expectedMeasurement ? expectedMeasurement : null;
      const retrievalDiffSha256 = evidence?.change?.diffSha256;
      if (exactReview && (!evidence || evidence.verdict !== "IMPROVED" || evidence.experimentId !== proof?.experimentId
        || cognitiveMeasurement?.benchmarkId !== "cognitive-quality" || !retrievalDiffSha256)) {
        throw new AyasPatchArtifactMutationError("AYAS_PATCH_ARTIFACT_MUTATION_UNSAFE", "bound cognitive evidence is missing or mismatched");
      }
      const manifest = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.find((strategy) => strategy.strategyId === proof?.strategyId
        && strategy.version === proof.strategyVersion)?.reviewedExactPatch;
      const base = exactReview && proof && proposal.exactFiles[0]
        ? execFileSync("git", ["show", `${proof.baseHead}:${proposal.exactFiles[0]}`],
          { cwd: executionRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 }) : null;
      const exactValidator = exactReview ? [async (root: string) => {
        const file = proposal.exactFiles[0];
        if (!file || !proof || !manifest || base === null) return { validator: "exact-patch-effect-proof", pass: false, summary: "missing exact proof" };
        try {
          const actual = fs.readFileSync(path.join(root, file), "utf8");
          const expected = artifact.replacements[0]?.content;
          const pass = actual === expected && verifyAyasExecutedExactPatch(proof, manifest, file, base, actual);
          return { validator: "exact-patch-effect-proof", pass, summary: pass ? "actual replacement matches reviewed effect" : "actual replacement differs from reviewed effect" };
        } catch { return { validator: "exact-patch-effect-proof", pass: false, summary: "actual replacement cannot be verified" }; }
      }] : [];
      return runAyasBoundedMutationWithValidators(executionRoot, artifact.allowedRoots, artifact.replacements,
        [...exactValidator, ...artifact.validatorScripts.map((script) => exactReview && script === "scripts/smoke-ayas-cognitive-quality.ts"
          ? createAyasCognitiveEvidenceValidator(cognitiveMeasurement!)
          : exactReview && script === "scripts/smoke-ayas-retrieval-evaluation.ts"
            ? createAyasRetrievalResolutionValidator(proof!.afterSha256, retrievalDiffSha256!)
            : createAyasSmokeTestValidator(script))]);
    },
  };
}
