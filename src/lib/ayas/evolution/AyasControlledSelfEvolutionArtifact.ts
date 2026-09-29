import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { measureAyasGraphifyImportCount } from "../../brain/autonomy/AyasBatchGraphifyCheck";
import { resolveAyasBoundedPath } from "../../brain/autonomy/AyasBoundedFileWrite";
import { type AyasPatchArtifact, type AyasPatchArtifactStore } from "../../brain/autonomy/AyasPatchArtifact";
import { validAyasExperimentSourceBindings, verifyAyasExperimentEvidence } from "../../brain/autonomy/AyasResearchExperimentEvaluation";
import { ayasImprovementRegistryDigest, type AyasImprovementRegistry } from "../../brain/autonomy/AyasResearchExperimentRegistry";
import type { AyasResearchExperimentStore } from "../../brain/autonomy/AyasResearchExperimentStore";
import type { AyasRegisteredExperimentResult } from "../../brain/autonomy/AyasRegisteredImprovementExperiment";
import { classifyPatchSet } from "../../brain/selfheal/BrainPatchSafety";
import { createAyasExactPatchSafetyProof } from "../../brain/selfheal/AyasExactPatchSafety";
import { ayasControlledEvolutionDedupeKey, type AyasControlledEvolutionCandidate } from "./AyasControlledSelfEvolution";

const execFileAsync = promisify(execFile);
const FULL_HEAD = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SMOKE = /^scripts\/smoke-[a-z0-9-]+\.ts$/;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

async function currentWorkspace(repoRoot: string): Promise<{ readonly branch: string; readonly head: string; readonly clean: boolean }> {
  const git = async (...args: string[]) => (await execFileAsync("git", ["--no-optional-locks", ...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 })).stdout.trim();
  return { branch: await git("branch", "--show-current"), head: await git("rev-parse", "HEAD"), clean: (await git("status", "--porcelain")) === "" };
}

/** Closed mapping from Stage 8 benchmark invocation to Package C's no-argument smoke validator. */
function validatorScripts(candidate: AyasControlledEvolutionCandidate): readonly string[] | null {
  const benchmark = candidate.benchmark;
  if (benchmark.benchmarkId !== "cognitive-quality" || benchmark.script !== "scripts/smoke-ayas-cognitive-quality.ts"
    || JSON.stringify(benchmark.args) !== JSON.stringify(["--baseline"]) || benchmark.reportFlag !== "--report"
    || candidate.hypothesis.regressionSuites.some((script) => !SMOKE.test(script))) return null;
  return [...new Set([benchmark.script, ...candidate.hypothesis.regressionSuites])];
}

export interface AyasControlledEvolutionArtifactInput {
  readonly repoRoot: string;
  readonly candidate: AyasControlledEvolutionCandidate;
  readonly registry: AyasImprovementRegistry;
  readonly result: AyasRegisteredExperimentResult;
  readonly experimentStore: AyasResearchExperimentStore;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly now: string;
}

/** Freezes one content-bound artifact only after the existing Stage 8 evidence and live Git truth agree. */
export async function freezeAyasControlledEvolutionArtifact(input: AyasControlledEvolutionArtifactInput): Promise<AyasPatchArtifact | null> {
  const { candidate, result, experimentStore, artifactStore } = input;
  const { record, retainedSource } = result;
  const pathSafety = classifyPatchSet(candidate.strategy.exactFiles).level;
  const ordinarySafe = pathSafety === "SAFE" && candidate.hypothesis.riskClass === "SAFE";
  const exactReview = pathSafety === "REVIEW_REQUIRED" && candidate.hypothesis.riskClass === "REVIEW_REQUIRED"
    && candidate.strategy.reviewedExactPatch !== undefined;
  if (result.verdict !== "IMPROVED" || record.status !== "COMPLETED" || record.verdict !== "IMPROVED" || !record.evidenceHash || !retainedSource
    || !FULL_HEAD.test(candidate.baseHead) || record.baseHead !== candidate.baseHead || record.hypothesisId !== candidate.hypothesis.hypothesisId
    || record.strategyId !== candidate.strategy.strategyId || record.strategyVersion !== candidate.strategy.version
    || retainedSource.replacements.length === 0 || !HEX64.test(retainedSource.diffSha256)
    || (!ordinarySafe && !exactReview)
    || candidate.registryDigest !== ayasImprovementRegistryDigest(input.registry)
    || candidate.strategy !== input.registry.strategies.find((strategy) => strategy.strategyId === record.strategyId && strategy.version === record.strategyVersion)
    || candidate.benchmark !== input.registry.benchmarks.find((benchmark) => benchmark.benchmarkId === candidate.hypothesis.benchmarkId)
    || candidate.dedupeKey !== ayasControlledEvolutionDedupeKey({ opportunityId: candidate.opportunityId, hypothesisId: candidate.hypothesis.hypothesisId, baseHead: candidate.baseHead, registryDigest: candidate.registryDigest })
    || !validAyasExperimentSourceBindings(candidate.sourceBindings, candidate.hypothesis.findingIds)
    || candidate.sourceBindings.filter((binding) => binding.kind === "EVOLUTION_OPPORTUNITY").length !== 1
    || !candidate.sourceBindings.some((binding) => binding.kind === "EVOLUTION_OPPORTUNITY" && binding.id === candidate.opportunityId)) return null;
  const evidence = experimentStore.readEvidence(record.evidenceHash);
  const baseline = evidence?.baseline;
  const experiment = evidence?.experiment;
  if (!evidence || !verifyAyasExperimentEvidence(evidence, record.evidenceHash) || evidence.verdict !== "IMPROVED"
    || evidence.experimentId !== record.experimentId || evidence.attemptKey !== record.attemptKey || evidence.baseHead !== candidate.baseHead
    || JSON.stringify(evidence.hypothesis) !== JSON.stringify(candidate.hypothesis) || evidence.change?.strategyId !== candidate.strategy.strategyId
    || evidence.change.strategyVersion !== candidate.strategy.version || evidence.change.diffSha256 !== retainedSource.diffSha256
    || evidence.replacementDigest !== sha256(JSON.stringify(retainedSource.replacements))
    || JSON.stringify(evidence.sourceBindings) !== JSON.stringify(candidate.sourceBindings)
    || !evidence.risk.liveWorkspaceUnchanged || !evidence.risk.sandboxDiscarded || evidence.risk.riskClass !== candidate.hypothesis.riskClass
    || evidence.targetGain < 1 || evidence.regressions.newlyFailingCaseIds.length > 0 || evidence.regressions.heldOutDelta < 0
    || !baseline || "error" in baseline || !experiment || "error" in experiment
    || baseline.benchmarkId !== candidate.benchmark.benchmarkId || experiment.benchmarkId !== candidate.benchmark.benchmarkId
    || baseline.evaluatorSha256 !== candidate.hypothesis.gapEvidence.evaluatorSha256
    || baseline.evaluatorSha256 !== experiment.evaluatorSha256
    || baseline.caseCount !== experiment.caseCount
    || baseline.heldOut.total !== experiment.heldOut.total
    || experiment.heldOut.passed < baseline.heldOut.passed
    || JSON.stringify(evidence.regressions.suites.map((suite) => suite.script)) !== JSON.stringify(candidate.hypothesis.regressionSuites)
    || evidence.regressions.suites.some((suite) => suite.baselinePass !== true || suite.experimentPass !== true)) return null;
  if (candidate.hypothesis.targetCaseIds.some((id) => !baseline.failingCaseIds.includes(id))
    || evidence.fixedCaseIds.length !== evidence.targetGain
    || evidence.fixedCaseIds.some((id) => !candidate.hypothesis.targetCaseIds.includes(id) || experiment.failingCaseIds.includes(id))) return null;
  const files = retainedSource.replacements.map((replacement) => replacement.filePath);
  if (new Set(files).size !== files.length || files.some((file) => !candidate.strategy.exactFiles.includes(file))
    || JSON.stringify([...files].sort()) !== JSON.stringify(evidence.change.files.map((file) => file.filePath).sort())
    || retainedSource.replacements.some((replacement) => !HEX64.test(replacement.expectedHash) || typeof replacement.content !== "string" || replacement.content.length > 400_000)) return null;
  const validators = validatorScripts(candidate);
  if (!validators || !Number.isFinite(Date.parse(input.now))) return null;
  const before = await currentWorkspace(input.repoRoot).catch(() => null);
  if (!before?.clean || before.head !== candidate.baseHead || !before.branch) return null;
  const allowedRoots = [...new Set(candidate.strategy.exactFiles.map((file) => `${path.posix.dirname(file)}/`))].sort();
  for (const replacement of retainedSource.replacements) {
    try {
      const baseBytes = fs.readFileSync(resolveAyasBoundedPath(input.repoRoot, replacement.filePath, allowedRoots));
      if (!Buffer.from(baseBytes.toString("utf8"), "utf8").equals(baseBytes) || sha256(baseBytes.toString("utf8")) !== replacement.expectedHash) return null;
    } catch { return null; }
  }
  const exactProof = exactReview ? (() => {
    if (retainedSource.replacements.length !== 1 || !candidate.strategy.reviewedExactPatch) return null;
    const replacement = retainedSource.replacements[0]!;
    try {
      return createAyasExactPatchSafetyProof({ manifest: candidate.strategy.reviewedExactPatch,
        file: replacement.filePath, before: fs.readFileSync(resolveAyasBoundedPath(input.repoRoot, replacement.filePath, allowedRoots), "utf8"),
        after: replacement.content, baseHead: candidate.baseHead, strategyId: candidate.strategy.strategyId,
        strategyVersion: candidate.strategy.version, registryDigest: candidate.registryDigest,
        experimentId: record.experimentId, evidenceHash: record.evidenceHash });
    } catch { return null; }
  })() : null;
  if (exactReview && !exactProof) return null;
  const graphifyImportCounts: Record<string, number> = {};
  const graphifyEvidence: string[] = [];
  for (const replacement of retainedSource.replacements) {
    const measured = measureAyasGraphifyImportCount(replacement.content, replacement.filePath);
    graphifyImportCounts[replacement.filePath] = measured.importEdgeCount;
    graphifyEvidence.push(`${replacement.filePath}: Graphify imports_from=${measured.importEdgeCount}, nodes=${measured.nodeCount}, edges=${measured.edgeCount}`);
  }
  const after = await currentWorkspace(input.repoRoot).catch(() => null);
  if (!after?.clean || after.head !== candidate.baseHead || after.branch !== before.branch) return null;
  const exactFiles = [...candidate.strategy.exactFiles];
  const artifact = artifactStore.freeze({
    artifactId: `ayas-controlled-evolution-${crypto.randomUUID()}`,
    candidateId: `controlled-evolution:${candidate.opportunityId}:${candidate.hypothesis.hypothesisId}`,
    generatorIdentity: `controlled-self-evolution:v1:${candidate.strategy.strategyId}@${candidate.strategy.version}`,
    baseBranch: before.branch, baseHead: candidate.baseHead, exactFiles, allowedRoots,
    replacements: retainedSource.replacements.map((replacement) => ({ ...replacement, allowCreate: false })),
    validatorScripts: validators, graphifyEvidence, graphifyImportCounts, safetyClassification: "SAFE",
    controlledEvolutionBinding: { opportunityId: candidate.opportunityId, experimentId: record.experimentId,
      evidenceHash: record.evidenceHash, hypothesisId: candidate.hypothesis.hypothesisId,
      strategyId: candidate.strategy.strategyId, strategyVersion: candidate.strategy.version,
      registryDigest: candidate.registryDigest },
    ...(exactProof ? { exactPatchSafetyProof: exactProof } : {}),
    problemStatement: `Measured gap for ${candidate.opportunityId}`,
    rationale: `Stage 15 sandbox improvement bound to ${record.experimentId} and evidence ${record.evidenceHash}`,
    expectedUserBenefit: "The measured target case improves without held-out or regression loss.",
    expectedBehaviorChange: `Target gain ${evidence.targetGain}; changed files ${files.join(", ")}`,
    unchangedBehavior: "Protected and held-out cases retain their baseline behavior.",
    risk: exactProof ? "Path REVIEW_REQUIRED; this immutable replacement has a verified exact read-side effect proof. Owner approval remains required."
      : "SAFE source-only scope; owner approval remains required before execution.",
    productionImpact: "No live production change during experiment or artifact freeze.",
    sandboxValidationSummary: [`Matched baseline: ${evidence.baseline !== null ? "recorded" : "missing"}`, `Target gain: ${evidence.targetGain}`, `Held-out delta: ${evidence.regressions.heldOutDelta}`, `Regression suites: ${evidence.regressions.suites.length}`, `Evidence SHA256: ${record.evidenceHash}`],
    generatedAt: input.now,
  });
  return artifactStore.loadVerified(artifact.artifactId);
}
