import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AyasDaemonCandidate } from "../../brain/autonomy/AyasAutonomyDaemon";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../../brain/autonomy/AyasNovelPatchDiscovery";
import { AYAS_UNRESOLVED_STRUCTURED_IMPACT } from "../../brain/autonomy/AyasProposalImpact";
import type { AyasPatchArtifactStore } from "../../brain/autonomy/AyasPatchArtifact";
import { validAyasExperimentSourceBindings, verifyAyasExperimentEvidence } from "../../brain/autonomy/AyasResearchExperimentEvaluation";
import { ayasImprovementRegistryDigest, validateAyasImprovementStrategy, type AyasImprovementRegistry } from "../../brain/autonomy/AyasResearchExperimentRegistry";
import type { AyasResearchExperimentStore } from "../../brain/autonomy/AyasResearchExperimentStore";
import { classifyPatchSet } from "../../brain/selfheal/BrainPatchSafety";
import type { AyasControlledEvolutionCandidate } from "./AyasControlledSelfEvolution";

const execFileAsync = promisify(execFile);
const FULL_HEAD = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify(a) === JSON.stringify(b);

async function currentWorkspace(repoRoot: string): Promise<{ readonly branch: string; readonly head: string; readonly clean: boolean }> {
  const git = async (...args: string[]) => (await execFileAsync("git", ["--no-optional-locks", ...args], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000,
  })).stdout.trim();
  return { branch: await git("branch", "--show-current"), head: await git("rev-parse", "HEAD"), clean: (await git("status", "--porcelain")) === "" };
}

export interface AyasControlledEvolutionBridgeInput {
  readonly repoRoot: string;
  readonly candidate: AyasControlledEvolutionCandidate;
  readonly registry: AyasImprovementRegistry;
  readonly experimentId: string;
  readonly artifactId: string;
  readonly experimentStore: AyasResearchExperimentStore;
  readonly artifactStore: AyasPatchArtifactStore;
}

/** Read-only Stage 15 boundary: verified experiment + frozen SAFE patch become a candidate, never an approval. */
export async function buildAyasControlledEvolutionProposalCandidate(input: AyasControlledEvolutionBridgeInput): Promise<AyasDaemonCandidate | null> {
  const { candidate, registry } = input;
  if (!FULL_HEAD.test(candidate.baseHead) || candidate.qualification.readiness !== "EXPERIMENT_READY"
    || candidate.qualification.blockers.length > 0 || candidate.qualification.executionAuthority !== "NONE"
    || candidate.qualification.authority.granted !== "NONE"
    || candidate.qualification.mayExecute || candidate.qualification.mayInstall || candidate.qualification.maySpend || candidate.qualification.mayPublish
    || candidate.hypothesis.riskClass !== "SAFE" || validateAyasImprovementStrategy(candidate.strategy).length > 0
    || classifyPatchSet(candidate.strategy.exactFiles).level !== "SAFE"
    || candidate.registryDigest !== ayasImprovementRegistryDigest(registry)
    || candidate.strategy !== registry.strategies.find((item) => item.strategyId === candidate.strategy.strategyId && item.version === candidate.strategy.version)
    || candidate.benchmark !== registry.benchmarks.find((item) => item.benchmarkId === candidate.benchmark.benchmarkId)
    || !validAyasExperimentSourceBindings(candidate.sourceBindings, candidate.hypothesis.findingIds)
    || !candidate.sourceBindings.some((binding) => binding.kind === "EVOLUTION_OPPORTUNITY" && binding.id === candidate.opportunityId)) return null;

  const before = await currentWorkspace(input.repoRoot).catch(() => null);
  if (!before?.clean || !before.branch || before.head !== candidate.baseHead) return null;
  try {
    const record = input.experimentStore.readExperiment(input.experimentId);
    if (!record || record.status !== "COMPLETED" || record.verdict !== "IMPROVED" || !record.evidenceHash
      || record.baseHead !== candidate.baseHead || record.hypothesisId !== candidate.hypothesis.hypothesisId
      || record.strategyId !== candidate.strategy.strategyId || record.strategyVersion !== candidate.strategy.version) return null;
    const evidence = input.experimentStore.readEvidence(record.evidenceHash);
    if (!evidence || !verifyAyasExperimentEvidence(evidence, record.evidenceHash) || evidence.verdict !== "IMPROVED"
      || evidence.authority !== "NONE" || evidence.experimentId !== record.experimentId || evidence.attemptKey !== record.attemptKey
      || evidence.baseHead !== candidate.baseHead || JSON.stringify(evidence.hypothesis) !== JSON.stringify(candidate.hypothesis)
      || !same(evidence.sourceBindings?.map((binding) => `${binding.kind}:${binding.id}`) ?? [], candidate.sourceBindings.map((binding) => `${binding.kind}:${binding.id}`))
      || !evidence.change || evidence.change.strategyId !== candidate.strategy.strategyId || evidence.change.strategyVersion !== candidate.strategy.version
      || !HEX64.test(evidence.change.diffSha256) || !evidence.replacementDigest || !HEX64.test(evidence.replacementDigest)
      || evidence.risk.riskClass !== "SAFE" || !evidence.risk.liveWorkspaceUnchanged || !evidence.risk.sandboxDiscarded
      || evidence.targetGain < 1 || evidence.regressions.heldOutDelta < 0 || evidence.regressions.newlyFailingCaseIds.length > 0
      || evidence.regressions.suites.some((suite) => !suite.baselinePass || !suite.experimentPass)
      || !evidence.baseline || "error" in evidence.baseline || !evidence.experiment || "error" in evidence.experiment
      || evidence.baseline.evaluatorSha256 !== evidence.experiment.evaluatorSha256
      || evidence.baseline.evaluatorSha256 !== candidate.hypothesis.gapEvidence.evaluatorSha256
      || evidence.baseline.heldOut.total !== evidence.experiment.heldOut.total
      || evidence.experiment.heldOut.passed < evidence.baseline.heldOut.passed
      || evidence.fixedCaseIds.length !== evidence.targetGain || evidence.fixedCaseIds.length === 0
      || evidence.fixedCaseIds.some((id) => !candidate.hypothesis.targetCaseIds.includes(id) || (evidence.experiment && "failingCaseIds" in evidence.experiment && evidence.experiment.failingCaseIds.includes(id)))
      || !same(evidence.regressions.suites.map((suite) => suite.script), candidate.hypothesis.regressionSuites)
      || evidence.regressions.suites.length === 0) return null;

    const artifact = input.artifactStore.loadVerified(input.artifactId);
    const binding = artifact.controlledEvolutionBinding;
    if (!binding || artifact.artifactId !== input.artifactId || artifact.safetyClassification !== "SAFE"
      || artifact.baseHead !== candidate.baseHead || artifact.baseBranch !== before.branch
      || artifact.candidateId !== `controlled-evolution:${candidate.opportunityId}:${candidate.hypothesis.hypothesisId}`
      || artifact.generatorIdentity !== `controlled-self-evolution:v1:${candidate.strategy.strategyId}@${candidate.strategy.version}`
      || binding.opportunityId !== candidate.opportunityId || binding.experimentId !== record.experimentId
      || binding.evidenceHash !== record.evidenceHash || binding.hypothesisId !== candidate.hypothesis.hypothesisId
      || binding.strategyId !== candidate.strategy.strategyId || binding.strategyVersion !== candidate.strategy.version
      || binding.registryDigest !== candidate.registryDigest || !same(artifact.exactFiles, candidate.strategy.exactFiles)
      || artifact.graphifyEvidence.length === 0 || artifact.validatorScripts.length === 0
      || !artifact.validatorScripts.includes(candidate.benchmark.script)
      || candidate.hypothesis.regressionSuites.some((script) => !artifact.validatorScripts.includes(script))
      || artifact.replacements.length === 0 || new Set(artifact.replacements.map((item) => item.filePath)).size !== artifact.replacements.length
      || artifact.replacements.some((item) => item.allowCreate || !artifact.exactFiles.includes(item.filePath) || !HEX64.test(item.expectedHash ?? ""))
      || !same([...artifact.replacements.map((item) => item.filePath)].sort(), [...evidence.change.files.map((item) => item.filePath)].sort())
      || sha256(JSON.stringify(artifact.replacements.map(({ filePath, expectedHash, content }) => ({ filePath, expectedHash, content })))) !== evidence.replacementDigest
      || !HEX64.test(artifact.patchHash)) return null;

    const after = await currentWorkspace(input.repoRoot).catch(() => null);
    if (!after?.clean || after.head !== before.head || after.branch !== before.branch) return null;
    return {
      objective: `Measured ${candidate.hypothesis.capability} improvement for owner review`,
      currentProblem: `${candidate.benchmark.benchmarkId} has ${candidate.hypothesis.targetCaseIds.length} measured failing target cases at ${candidate.baseHead}.`,
      selectionReason: "Verified current-HEAD IMPROVED evidence and matching immutable SAFE patch artifact.",
      expectedUserBenefit: `${evidence.targetGain} target cases improved; held-out delta ${evidence.regressions.heldOutDelta}; no newly failing cases.`,
      expectedBehaviorChange: candidate.hypothesis.expectedImprovement.statement,
      unchangedBehavior: "Approval and execution remain exclusively governed by the existing owner, inbox and execution gates.",
      riskIfNotDone: "A measured, bounded improvement remains unapplied.",
      technicalRisk: `SAFE source-only scope; ${artifact.exactFiles.length} exact files, at most ${candidate.strategy.maxChangedLines} changed lines.`,
      productionImpact: "No production change before owner approval and guarded execution.",
      rationale: `Stage 15 opportunity ${candidate.opportunityId}; experiment ${record.experimentId}; hypothesis ${candidate.hypothesis.hypothesisId}; strategy ${candidate.strategy.strategyId}@${candidate.strategy.version}.`,
      evidence: [`opportunity:${candidate.opportunityId}`, `experiment:${record.experimentId}`, `evidenceSha256:${record.evidenceHash}`,
        `hypothesis:${candidate.hypothesis.hypothesisId}`, `strategy:${candidate.strategy.strategyId}@${candidate.strategy.version}`,
        `baseHead:${candidate.baseHead}`, `patchHash:${artifact.patchHash}`, `diffSha256:${evidence.change.diffSha256}`,
        `targetGain:${evidence.targetGain}`, `heldOutDelta:${evidence.regressions.heldOutDelta}`,
        `regressionSuites:${evidence.regressions.suites.map((suite) => suite.script).join(",")}`, "executionAuthority:NONE"],
      graphifyEvidence: artifact.graphifyEvidence,
      exactFiles: [...artifact.exactFiles],
      expectedDiffScope: `${artifact.exactFiles.join(", ")}; patch hash ${artifact.patchHash}`,
      testsPlanned: [...artifact.validatorScripts],
      risk: "SAFE artifact; owner approval and guarded execution required",
      rank: 10_000,
      mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
      patchArtifactId: artifact.artifactId,
      patchHash: artifact.patchHash,
      structuredImpact: AYAS_UNRESOLVED_STRUCTURED_IMPACT,
      discoverySource: "LOCAL_DISCOVERY",
      sourceReference: candidate.opportunityId,
    };
  } catch { return null; }
}
