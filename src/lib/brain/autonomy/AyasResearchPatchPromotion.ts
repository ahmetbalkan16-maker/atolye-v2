import crypto from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { AyasDaemonCandidate, AyasDaemonObservation } from "./AyasAutonomyDaemon";
import { AYAS_UNRESOLVED_STRUCTURED_IMPACT } from "./AyasProposalImpact";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "./AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "./AyasNovelPatchDiscovery";
import { AYAS_GOLDEN_VAULT } from "../../ayas/golden/AyasGoldenVaultRegistry";
import { ayasGoldenVaultDigest } from "../../ayas/golden/AyasGoldenVault";
import { measureAyasGraphifyImportCount } from "./AyasBatchGraphifyCheck";
import { applyAyasPatchReplacementsInSandbox, captureAyasPatchSandboxDiff, createAyasPatchSandbox, destroyAyasPatchSandbox, runAyasPatchSandboxValidators } from "./AyasPatchSandbox";
import { AyasValidatorFailedError } from "./AyasMutationValidators";
import { classifyPatchSet } from "../selfheal/BrainPatchSafety";
import { createAyasExactPatchSafetyProof, verifyAyasReviewedExactPatch } from "../selfheal/AyasExactPatchSafety";
import { ayasExperimentEvidenceGoldenHeld, verifyAyasExperimentEvidence, type AyasExperimentEvidence } from "./AyasResearchExperimentEvaluation";
import { ayasImprovementRegistryDigest, validateAyasImprovementStrategy, type AyasImprovementRegistry } from "./AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore, resolveAyasResearchImprovementRoot, type AyasResearchExperimentStore } from "./AyasResearchExperimentStore";

const execFileAsync = promisify(execFile);
const HEX64 = /^[0-9a-f]{64}$/;
const FULL_HEAD = /^[0-9a-f]{40}$/;
const SMOKE = /^scripts\/smoke-[a-z0-9-]+\.ts$/;
const sha256 = (value: string | Buffer): string => crypto.createHash("sha256").update(value).digest("hex");
const EXACT_READ_SIDE_IMPACT = { dependencyImpact: "none", externalServiceImpact: "none", estimatedCost: "zero-cost", paidCommitmentRequired: false, licensingImpact: "none", licensingStatus: "not-applicable", securityImpact: "none", authorityImpact: "none", storageImpact: "none", productionImpact: "low", reversibility: "fully-reversible", validationConfidence: "high" } as const;

export interface AyasResearchPatchPromotionDeps {
  readonly repoRoot: string;
  readonly observation: AyasDaemonObservation;
  readonly registry: AyasImprovementRegistry;
  readonly experimentStore?: AyasResearchExperimentStore;
  readonly artifactStore?: AyasPatchArtifactStore;
  readonly existingProposals: readonly Pick<AyasDaemonCandidate, "sourceReference">[];
  readonly evidences: readonly { readonly evidence: AyasExperimentEvidence; readonly evidenceHash: string }[];
}

export interface AyasResearchPatchPromotionResult {
  readonly candidate: AyasDaemonCandidate | null;
  readonly rejection: string | null;
}

async function git(repoRoot: string, ...args: string[]): Promise<string> {
  return (await execFileAsync("git", ["--no-optional-locks", ...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 })).stdout.trim();
}

async function gitFile(repoRoot: string, revisionPath: string): Promise<string> {
  return (await execFileAsync("git", ["--no-optional-locks", "show", revisionPath], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 2_000_000 })).stdout;
}
function summarizeDiff(diff: string): readonly { readonly filePath: string; readonly addedLines: number; readonly removedLines: number }[] {
  const rows: { filePath: string; addedLines: number; removedLines: number }[] = [];
  let current: { filePath: string; addedLines: number; removedLines: number } | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      current = { filePath: line.slice(6), addedLines: 0, removedLines: 0 };
      rows.push(current);
    } else if (current && line.startsWith("+") && !line.startsWith("+++")) current.addedLines += 1;
    else if (current && line.startsWith("-") && !line.startsWith("---")) current.removedLines += 1;
  }
  return rows;
}
/**
 * Reifies only a CLOSED, server-owned strategy whose exact output is bound to a
 * verified research experiment. The result is a sandbox-validated immutable
 * patch candidate; this function never writes the live source tree or approves
 * or executes the resulting proposal.
 */
export async function promoteAyasResearchExperimentEvidence(deps: AyasResearchPatchPromotionDeps): Promise<AyasResearchPatchPromotionResult> {
  const { repoRoot, observation, registry } = deps;
  const experimentStore = deps.experimentStore ?? createAyasResearchExperimentStore({ rootDir: resolveAyasResearchImprovementRoot(repoRoot) });
  const alreadyBridged = new Set(deps.existingProposals.map((item) => item.sourceReference).filter((id): id is string => Boolean(id)));
  const evidenceInput = deps.evidences.find(({ evidence, evidenceHash }) =>
    verifyAyasExperimentEvidence(evidence, evidenceHash) && evidence.verdict === "IMPROVED"
    && evidence.baseHead === observation.head && !alreadyBridged.has(evidence.experimentId));
  if (!evidenceInput) return { candidate: null, rejection: null };
  const { evidence, evidenceHash } = evidenceInput;
  const persistedEvidence = experimentStore.readEvidence(evidenceHash);
  if (!persistedEvidence || JSON.stringify(persistedEvidence) !== JSON.stringify(evidence)) return { candidate: null, rejection: "EVIDENCE_STORE_MISMATCH" };
  const reject = (reason: string): AyasResearchPatchPromotionResult => ({ candidate: null, rejection: reason });
  if (!observation.repoClean || !observation.graphifyFresh || observation.machineAction !== "ALLOW" || !FULL_HEAD.test(observation.head)) return reject("REPO_NOT_READY");
  if (!ayasExperimentEvidenceGoldenHeld(evidence, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT), AYAS_GOLDEN_VAULT.cases.length)
    || evidence.authority !== "NONE" || evidence.risk.riskClass === "FORBIDDEN_AUTONOMOUS"
    || !evidence.risk.liveWorkspaceUnchanged || !evidence.risk.sandboxDiscarded
    || evidence.targetGain < 1 || evidence.regressions.heldOutDelta < 0 || evidence.regressions.newlyFailingCaseIds.length > 0
    || evidence.regressions.suites.length === 0 || evidence.regressions.suites.some((suite) => suite.baselinePass !== true || suite.experimentPass !== true)
    || !evidence.change || !HEX64.test(evidence.change.diffSha256)) return reject("EVIDENCE_NOT_PROMOTABLE");
  const record = experimentStore.readExperiment(evidence.experimentId);
  if (!record || record.status !== "COMPLETED" || record.verdict !== "IMPROVED" || record.evidenceHash !== evidenceHash
    || record.baseHead !== observation.head || record.attemptKey !== evidence.attemptKey || record.hypothesisId !== evidence.hypothesis.hypothesisId
    || record.strategyId !== evidence.change.strategyId || record.strategyVersion !== evidence.change.strategyVersion) return reject("EXPERIMENT_RECORD_MISMATCH");
  const strategy = registry.strategies.find((item) => item.strategyId === record.strategyId && item.version === record.strategyVersion);
  const benchmark = registry.benchmarks.find((item) => item.benchmarkId === evidence.hypothesis.benchmarkId);
  if (!strategy || !benchmark || validateAyasImprovementStrategy(strategy).length > 0
    || strategy.benchmarkId !== benchmark.benchmarkId || strategy.benchmarkId !== evidence.hypothesis.benchmarkId
    || JSON.stringify(strategy.exactFiles) !== JSON.stringify(evidence.hypothesis.exactFiles)
    || JSON.stringify(strategy.regressionSuites) !== JSON.stringify(evidence.hypothesis.regressionSuites)
    || !benchmark.script.match(SMOKE) || strategy.regressionSuites.some((script) => !SMOKE.test(script))) return reject("STRATEGY_SCOPE_MISMATCH");
  const pathSafety = classifyPatchSet(strategy.exactFiles).level;
  const ordinarySafe = pathSafety === "SAFE" && evidence.hypothesis.riskClass === "SAFE";
  const exactReview = pathSafety === "REVIEW_REQUIRED" && evidence.hypothesis.riskClass === "REVIEW_REQUIRED" && Boolean(strategy.reviewedExactPatch);
  if (!ordinarySafe && !exactReview) return reject("PATCH_CLASSIFICATION_NOT_ALLOWED");

  const registryDigest = ayasImprovementRegistryDigest(registry);
  let before: { branch: string; head: string; clean: boolean };
  try { before = { branch: await git(repoRoot, "branch", "--show-current"), head: await git(repoRoot, "rev-parse", "HEAD"), clean: (await git(repoRoot, "status", "--porcelain")) === "" }; }
  catch { return reject("GIT_STATE_UNAVAILABLE"); }
  if (!before.clean || before.head !== observation.head || !before.branch) return reject("HEAD_OR_WORKTREE_CHANGED");

  let replacements: { filePath: string; expectedHash: string; content: string }[];
  try {
    const sourceByPath = new Map<string, string>();
    for (const file of strategy.exactFiles) sourceByPath.set(file, await gitFile(repoRoot, `${observation.head}:${file}`));
    const generated = strategy.generate({ readFile: (file) => sourceByPath.get(file) ?? null });
    if (generated.length === 0 || generated.length > strategy.exactFiles.length || new Set(generated.map((item) => item.filePath)).size !== generated.length
      || generated.some((item) => !strategy.exactFiles.includes(item.filePath))) return reject("GENERATOR_SCOPE_INVALID");
    replacements = generated.map((item) => ({ filePath: item.filePath, expectedHash: sha256(sourceByPath.get(item.filePath)!), content: item.content }));
  } catch { return reject("REGISTERED_STRATEGY_FAILED"); }
  if (JSON.stringify([...replacements.map((item) => item.filePath)].sort()) !== JSON.stringify([...evidence.change.files.map((item) => item.filePath)].sort())) return reject("REGENERATED_PATCH_MISMATCH");

  const validatorScripts = [...new Set([benchmark.script, ...strategy.regressionSuites])];
  const allowedRoots = [...new Set(strategy.exactFiles.map((file) => `${path.posix.dirname(file)}/`))].sort();
  const sandbox = await createAyasPatchSandbox(repoRoot, observation.head).catch(() => null);
  if (!sandbox) return reject("SANDBOX_CREATE_FAILED");
  let phase = "sandbox-apply";
  try {
    await applyAyasPatchReplacementsInSandbox(sandbox, allowedRoots, replacements.map((item) => ({ ...item, allowCreate: false })));
    const diff = await captureAyasPatchSandboxDiff(sandbox);
    if (!diff || sha256(diff) !== evidence.change.diffSha256) return reject("REGENERATED_DIFF_MISMATCH");
    const diffSummary = summarizeDiff(diff);
    const expectedSummary = evidence.change.files.map((item) => ({ filePath: item.filePath, addedLines: item.addedLines, removedLines: item.removedLines })).sort((a, b) => a.filePath.localeCompare(b.filePath));
    if (JSON.stringify(diffSummary) !== JSON.stringify(expectedSummary) || diffSummary.some((item) => !strategy.exactFiles.includes(item.filePath))) return reject("DIFF_FILE_SCOPE_MISMATCH");
    if (diffSummary.reduce((sum, item) => sum + item.addedLines + item.removedLines, 0) > strategy.maxChangedLines) return reject("DIFF_LINE_LIMIT_EXCEEDED");
    phase = "sandbox-validators";
    const validatorResults = await runAyasPatchSandboxValidators(sandbox, validatorScripts);
    const afterDiff = await captureAyasPatchSandboxDiff(sandbox);
    if (afterDiff !== diff) return reject("VALIDATOR_CHANGED_SANDBOX");
    const current = { branch: await git(repoRoot, "branch", "--show-current"), head: await git(repoRoot, "rev-parse", "HEAD"), clean: (await git(repoRoot, "status", "--porcelain")) === "" };
    if (!current.clean || current.head !== before.head || current.branch !== before.branch) return reject("LIVE_WORKSPACE_CHANGED");

    const exactPatchSafetyProof = exactReview && strategy.reviewedExactPatch && replacements.length === 1
      ? createAyasExactPatchSafetyProof({ manifest: strategy.reviewedExactPatch, file: replacements[0]!.filePath,
        before: (await gitFile(repoRoot, `${observation.head}:${replacements[0]!.filePath}`)), after: replacements[0]!.content,
        baseHead: observation.head, strategyId: strategy.strategyId, strategyVersion: strategy.version, registryDigest,
        experimentId: record.experimentId, evidenceHash }) : undefined;
    if (exactReview && (!exactPatchSafetyProof || !verifyAyasReviewedExactPatch(strategy.reviewedExactPatch!, replacements[0]!.filePath,
      await gitFile(repoRoot, `${observation.head}:${replacements[0]!.filePath}`), replacements[0]!.content))) return reject("EXACT_PATCH_PROOF_FAILED");
    phase = "graphify-measurement";
    const graphifyEvidence: string[] = [];
    const graphifyImportCounts: Record<string, number> = {};
    for (const replacement of replacements) {
      const measured = measureAyasGraphifyImportCount(replacement.content, replacement.filePath);
      graphifyEvidence.push(`${replacement.filePath}: Graphify imports_from=${measured.importEdgeCount}, nodes=${measured.nodeCount}, edges=${measured.edgeCount}`);
      graphifyImportCounts[replacement.filePath] = measured.importEdgeCount;
    }
    phase = "artifact-freeze";
    const artifactStore = deps.artifactStore ?? createAyasPatchArtifactStore({ rootDir: path.join(repoRoot, "data", "brain", "self-improvement", "patch-artifacts") });
    const artifact = artifactStore.freeze({
      artifactId: `ayas-research-patch-${crypto.randomUUID()}`,
      candidateId: `research-experiment:${record.experimentId}`,
      generatorIdentity: `research-registered-strategy:v1:${strategy.strategyId}@${strategy.version}`,
      baseBranch: before.branch, baseHead: observation.head, exactFiles: [...strategy.exactFiles], allowedRoots,
      replacements: replacements.map((item) => ({ ...item, allowCreate: false })), validatorScripts, graphifyEvidence, graphifyImportCounts,
      safetyClassification: "SAFE",
      controlledEvolutionBinding: { opportunityId: `research-experiment:${record.experimentId}`, experimentId: record.experimentId,
        evidenceHash, hypothesisId: evidence.hypothesis.hypothesisId, strategyId: strategy.strategyId,
        strategyVersion: strategy.version, registryDigest },
      ...(exactPatchSafetyProof ? { exactPatchSafetyProof } : {}),
      problemStatement: `Verified research experiment ${record.experimentId} measured ${evidence.hypothesis.targetDimension}.`,
      rationale: `Registered strategy ${strategy.strategyId}@${strategy.version}; current-HEAD evidence ${evidenceHash}.`,
      expectedUserBenefit: `${evidence.targetGain} target cases improved; held-out delta ${evidence.regressions.heldOutDelta}; no new failing cases.`,
      expectedBehaviorChange: evidence.hypothesis.expectedImprovement.statement,
      unchangedBehavior: "Owner approval, execution gate, mutation registry, production data and runtime authority remain unchanged.",
      risk: exactReview ? "Reviewed exact patch; owner approval and guarded execution required." : "Bounded SAFE source patch; owner approval and guarded execution required.",
      productionImpact: "No live production change during research or artifact creation.",
      sandboxValidationSummary: validatorResults.map((item) => `${item.validator}: ${item.pass ? "PASS" : "FAIL"} — ${item.summary}`),
      generatedAt: observation.now,
    });
    phase = "candidate-build";
    const verifiedArtifact = artifactStore.loadVerified(artifact.artifactId);
    return { candidate: {
      objective: `Araştırma deneyinde doğrulanan ${evidence.hypothesis.capability} iyileştirmesini incelemeye sun`,
      currentProblem: `${benchmark.benchmarkId} / ${evidence.hypothesis.targetDimension}: ${evidence.hypothesis.targetCaseIds.length} ölçülmüş hedef vaka.`,
      selectionReason: "Güncel HEAD üzerinde eşleşmiş deney, held-out ve golden kontrolleri ile tekrar doğrulandı.",
      expectedUserBenefit: `${evidence.targetGain} hedef vaka düzeldi; held-out farkı ${evidence.regressions.heldOutDelta}; yeni başarısız vaka yok.`,
      expectedBehaviorChange: evidence.hypothesis.expectedImprovement.statement,
      unchangedBehavior: "Uygulama, sahip onayı ve mevcut execution gate sonrasında gerçekleşir.",
      riskIfNotDone: "Ölçülmüş iyileştirme onay kuyruğunda bekler.",
      technicalRisk: `${exactReview ? "Exact-reviewed" : "SAFE"} kapsam; ${verifiedArtifact.exactFiles.length} dosya; değişiklik SHA256 ${evidence.change.diffSha256}.`,
      productionImpact: "Canlı sisteme onay öncesi değişiklik yok.",
      rationale: `Experiment ${record.experimentId}; strategy ${strategy.strategyId}@${strategy.version}; evidence ${evidenceHash}.`,
      evidence: [`experiment:${record.experimentId}`, `evidenceSha256:${evidenceHash}`, `hypothesis:${evidence.hypothesis.hypothesisId}`,
        ...evidence.findingIds.map((id) => `finding:${id}`), ...evidence.sourceIds.map((id) => `source:${id}`), `strategy:${strategy.strategyId}@${strategy.version}`,
        `baseHead:${observation.head}`, `patchHash:${verifiedArtifact.patchHash}`, `diffSha256:${evidence.change.diffSha256}`,
        `targetGain:${evidence.targetGain}`, `heldOutDelta:${evidence.regressions.heldOutDelta}`, "executionAuthority:NONE"],
      graphifyEvidence, exactFiles: [...verifiedArtifact.exactFiles],
      expectedDiffScope: `${verifiedArtifact.exactFiles.join(", ")}; patch ${verifiedArtifact.patchHash}`,
      testsPlanned: validatorScripts, risk: exactReview ? "Exact-reviewed; owner approval and guarded execution required" : "Owner approval and guarded execution required",
      rank: 20_000, mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
      patchArtifactId: verifiedArtifact.artifactId, patchHash: verifiedArtifact.patchHash,
      ...(exactPatchSafetyProof ? { exactPatchSafetyProof } : {}), structuredImpact: exactReview ? EXACT_READ_SIDE_IMPACT : AYAS_UNRESOLVED_STRUCTURED_IMPACT,
      discoverySource: "RESEARCH_DEEP", sourceReference: record.experimentId,
    }, rejection: null };
  } catch (error) {
    if (error instanceof AyasValidatorFailedError) return reject(`VALIDATOR_FAILED:${error.results.find((item) => !item.pass)?.validator ?? "unknown"}`);
    return reject(`PROMOTION_VALIDATION_FAILED:${phase}`);
  } finally {
    await destroyAyasPatchSandbox(sandbox);
  }
}