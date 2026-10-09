import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ayasGoldenVaultDigest, type AyasGoldenVault } from "../../ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../../ayas/golden/AyasGoldenVaultRegistry";
import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { ayasExperimentEvidenceGoldenHeld } from "./AyasResearchExperimentEvaluation";
import { ayasExactPatchSha256, verifyAyasExactPatchSafetyProof, verifyAyasReviewedExactPatch } from "../selfheal/AyasExactPatchSafety";
import type { AyasInboxProposal } from "./AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest } from "./AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasResearchExperimentStore } from "./AyasResearchExperimentStore";

/** Fixed, read-only Git probes for the owner-visible exact snapshot. No arbitrary command adapter. */
export function readAyasExactPreviewSource(repoRoot: string, baseHead: string, files: readonly { readonly filePath: string; readonly expectedHash: string | null }[]): readonly (string | null)[] {
  if (!/^[0-9a-f]{40}$/.test(baseHead) || !files.length || files.some(file => !file.filePath || file.filePath.includes("..") || file.filePath.includes("\\")
    || path.posix.isAbsolute(file.filePath) || !/^(?:src|app|scripts)\//.test(file.filePath))) throw new Error("EXACT_PREVIEW_UNAVAILABLE");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 4_000_000 });
  if (git("rev-parse", "HEAD").trim() !== baseHead || git("status", "--porcelain").trim()) throw new Error("EXACT_PREVIEW_UNAVAILABLE");
  return files.map(file => {
    if (file.expectedHash !== null) return git("show", `${baseHead}:${file.filePath}`);
    if (git("ls-tree", "--name-only", baseHead, "--", file.filePath).trim()) throw new Error("EXACT_PREVIEW_UNAVAILABLE");
    return null;
  });
}

/** Keeps the path classifier authoritative while proving only one immutable reviewed replacement. */
export function verifyAyasExactProposalSafety(proposal: Pick<AyasInboxProposal,
  "baseHead" | "exactFiles" | "safetyClassification" | "mutationKind" | "patchArtifactId" | "patchHash" | "exactPatchSafetyProof">,
  options: { readonly repoRoot?: string; readonly artifactStore?: AyasPatchArtifactStore; readonly experimentStore?: AyasResearchExperimentStore; readonly requireUnchangedSource?: boolean;
    /** Stage 15O. Production callers leave it out: the vault of record. */ readonly goldenVault?: AyasGoldenVault } = {}): boolean {
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
      // Stage 15O: an exact proof also needs the golden vault held, against the vault as it is now.
      || !ayasExperimentEvidenceGoldenHeld(evidence, ayasGoldenVaultDigest(options.goldenVault ?? AYAS_GOLDEN_VAULT), (options.goldenVault ?? AYAS_GOLDEN_VAULT).cases.length)
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
