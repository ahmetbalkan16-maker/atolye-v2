import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { ayasExactPatchSha256, verifyAyasExactPatchSafetyProof, verifyAyasReviewedExactPatch } from "../selfheal/AyasExactPatchSafety";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest } from "./AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasResearchExperimentStore } from "./AyasResearchExperimentStore";

/** Keeps the path classifier authoritative while proving only one immutable reviewed replacement. */
export function verifyAyasExactProposalSafety(proposal: Pick<AyasInboxProposal,
  "baseHead" | "exactFiles" | "safetyClassification" | "mutationKind" | "patchArtifactId" | "patchHash" | "exactPatchSafetyProof">,
  options: { readonly repoRoot?: string; readonly artifactStore?: AyasPatchArtifactStore; readonly experimentStore?: AyasResearchExperimentStore; readonly requireUnchangedSource?: boolean } = {}): boolean {
  if (classifyPatchSet(proposal.exactFiles).level !== "REVIEW_REQUIRED"
    || proposal.safetyClassification !== "SAFE" || proposal.mutationKind !== "patch-artifact:v1"
    || !proposal.patchArtifactId || !proposal.patchHash || !/^[0-9a-f]{64}$/.test(proposal.patchHash)
    || !proposal.exactPatchSafetyProof) return false;
  const root = path.resolve(options.repoRoot ?? process.cwd());
  const proof = proposal.exactPatchSafetyProof;
  const registry = AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
  const strategy = registry.strategies.find((item) => item.strategyId === proof.strategyId && item.version === proof.strategyVersion);
  const benchmark = strategy && registry.benchmarks.find((item) => item.benchmarkId === strategy.benchmarkId);
  if (!strategy?.reviewedExactPatch || !benchmark || !verifyAyasExactPatchSafetyProof(proof, strategy.reviewedExactPatch, {
    baseHead: proposal.baseHead, exactFiles: proposal.exactFiles,
    registryDigest: ayasImprovementRegistryDigest(registry), strategyId: strategy.strategyId, strategyVersion: strategy.version,
  })) return false;
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000 }).trim();
    if (head !== proposal.baseHead) return false;
    const file = proposal.exactFiles[0];
    if (!file || proposal.exactFiles.length !== 1) return false;
    const before = execFileSync("git", ["show", `${proposal.baseHead}:${file}`],
      { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 1_000_000 });
    if (ayasExactPatchSha256(before) !== proof.beforeSha256) return false;
    const store = options.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(root, "data", "brain", "self-improvement", "patch-artifacts") });
    const experiments = options.experimentStore ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(root) });
    const record = experiments.readExperiment(proof.experimentId);
    const evidence = experiments.readEvidence(proof.evidenceHash);
    if (!record || !evidence || record.status !== "COMPLETED" || record.verdict !== "IMPROVED"
      || record.evidenceHash !== proof.evidenceHash || record.baseHead !== proof.baseHead
      || record.strategyId !== proof.strategyId || record.strategyVersion !== proof.strategyVersion
      || evidence.experimentId !== record.experimentId || evidence.verdict !== "IMPROVED"
      || evidence.baseHead !== proof.baseHead || evidence.authority !== "NONE"
      || evidence.risk.riskClass !== "REVIEW_REQUIRED" || evidence.change?.strategyId !== proof.strategyId
      || evidence.change.strategyVersion !== proof.strategyVersion || evidence.targetGain < 1
      || evidence.regressions.newlyFailingCaseIds.length > 0 || evidence.regressions.heldOutDelta < 0
      || evidence.regressions.suites.length === 0
      || evidence.regressions.suites.some((suite) => suite.baselinePass !== true || suite.experimentPass !== true)
      || JSON.stringify(evidence.regressions.suites.map((suite) => suite.script)) !== JSON.stringify(strategy.regressionSuites)
      || !evidence.baseline || "error" in evidence.baseline || !evidence.experiment || "error" in evidence.experiment
      || evidence.baseline.evaluatorSha256 !== evidence.experiment.evaluatorSha256
      || evidence.experiment.heldOut.passed < evidence.baseline.heldOut.passed
      || evidence.fixedCaseIds.length !== evidence.targetGain) return false;
    const artifact = store.loadVerified(proposal.patchArtifactId);
    const replacement = artifact.replacements[0];
    const artifactProof = artifact.exactPatchSafetyProof;
    if (artifact.artifactId !== proposal.patchArtifactId || artifact.patchHash !== proposal.patchHash
      || artifact.baseHead !== proposal.baseHead || artifact.safetyClassification !== "SAFE"
      || JSON.stringify(artifact.exactFiles) !== JSON.stringify(proposal.exactFiles)
      || JSON.stringify(artifact.allowedRoots) !== JSON.stringify([`${path.posix.dirname(file)}/`])
      || JSON.stringify(artifact.validatorScripts) !== JSON.stringify([benchmark.script, ...strategy.regressionSuites])
      || !artifactProof || JSON.stringify(artifactProof) !== JSON.stringify(proof) || artifact.replacements.length !== 1
      || !replacement || replacement.filePath !== file || replacement.allowCreate || replacement.expectedHash !== proof.beforeSha256
      || artifact.controlledEvolutionBinding?.strategyId !== proof.strategyId
      || artifact.controlledEvolutionBinding.strategyVersion !== proof.strategyVersion
      || artifact.controlledEvolutionBinding.experimentId !== proof.experimentId
      || artifact.controlledEvolutionBinding.evidenceHash !== proof.evidenceHash
      || artifact.controlledEvolutionBinding.registryDigest !== proof.registryDigest
      || evidence.replacementDigest !== ayasExactPatchSha256(JSON.stringify(artifact.replacements.map(({ filePath, expectedHash, content }) => ({ filePath, expectedHash, content }))))
      || evidence.change.files.length !== 1 || evidence.change.files[0]?.filePath !== file
      || !verifyAyasReviewedExactPatch(strategy.reviewedExactPatch, file, before, replacement.content)
      || ayasExactPatchSha256(replacement.content) !== proof.afterSha256) return false;
    if (options.requireUnchangedSource !== false && fs.readFileSync(path.join(root, file), "utf8") !== before) return false;
    return crypto.timingSafeEqual(Buffer.from(proof.digest, "hex"), Buffer.from(artifactProof.digest, "hex"));
  } catch { return false; }
}
