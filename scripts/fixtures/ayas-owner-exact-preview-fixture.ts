import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAyasExactPatchSafetyProof, ayasExactPatchSha256 } from "../../src/lib/brain/selfheal/AyasExactPatchSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest, generateAyasRenderToolSupersessionPatch } from "../../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { createAyasPatchArtifactStore } from "../../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasApprovalInboxStore } from "../../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasResearchExperimentStore } from "../../src/lib/brain/autonomy/AyasResearchExperimentStore";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION } from "../../src/lib/brain/autonomy/AyasResearchImprovementLoop";
import { AYAS_EXPERIMENT_ISOLATION } from "../../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";
import { heldGoldenEvidence } from "./ayas-golden-fixtures";

/** Synthetic exact reviewed source/evidence, using the preserved historical strategy. No live execution. */
export function createOwnerExactReviewedPreviewFixture(vault: Parameters<typeof heldGoldenEvidence>[0]) {
const file = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
const sourceRoot = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exact-proposal-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
git("init", "-q");
git("config", "user.email", "smoke@example.invalid");
git("config", "user.name", "Smoke");
fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
// The strategy is bound to the source it was reviewed against. That is immutable history (the commit just before
// the governed patch was applied), not HEAD: the patch has landed and the file has changed again since.
const REVIEWED_BASE_COMMIT = "71f554eb72e6f5aaafb272f31bff402664f602cc";
const before = execFileSync("git", ["show", `${REVIEWED_BASE_COMMIT}:${file}`], { cwd: sourceRoot, encoding: "utf8", windowsHide: true, maxBuffer: 16_000_000 });
fs.writeFileSync(path.join(root, file), before);
fs.writeFileSync(path.join(root, ".gitignore"), "data/\n");
git("add", "-A");
git("commit", "-qm", "immutable fixture base");
const baseHead = git("rev-parse", "HEAD");
const after = generateAyasRenderToolSupersessionPatch(before);
const strategy = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.strategies.find((item) => item.strategyId === "exp-memory-render-tool-supersession");
assert.ok(strategy?.reviewedExactPatch);
const registryDigest = ayasImprovementRegistryDigest(AYAS_DEFAULT_IMPROVEMENT_REGISTRY);
const experimentId = `ayas-experiment-${crypto.randomUUID()}`;
const experiments = createAyasResearchExperimentStore({ rootDir: path.join(root, "data", "brain", "self-improvement", "research-improvement") });
const replacement = { filePath: file, expectedHash: ayasExactPatchSha256(before), content: after, allowCreate: false };
const replacementDigest = ayasExactPatchSha256(JSON.stringify([{ filePath: file, expectedHash: replacement.expectedHash, content: after }]));
const measurement = { benchmarkId: "cognitive-quality-master", evaluatorSha256: "a".repeat(64), caseCount: 55,
  passed: 53, heldOut: { passed: 4, total: 5 }, dimensions: [], failingCaseIds: ["stale-free-text-seed", "heldout-free-text"], durationMs: 100 };
const evidence = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId, attemptKey: "b".repeat(64), baseHead,
  findingIds: [], sourceIds: [], sourceBindings: [{ kind: "EVOLUTION_OPPORTUNITY", id: `ayas-evo-${"c".repeat(16)}` }],
  replacementDigest, hypothesis: { findingIds: [], riskClass: "REVIEW_REQUIRED" }, baseline: measurement,
  experiment: { ...measurement, passed: 54, failingCaseIds: ["heldout-free-text"] },
  environment: { node: process.version, platform: process.platform, arch: process.arch, tsx: null, typescript: null },
  change: { strategyId: strategy.strategyId, strategyVersion: strategy.version, diffSha256: "d".repeat(64), files: [{ filePath: file }] },
  regressions: { newlyFailingCaseIds: [], heldOutDelta: 0,
    suites: strategy.regressionSuites.map((script) => ({ script, baselinePass: true, experimentPass: true })) },
  golden: heldGoldenEvidence(vault, strategy.regressionSuites),
  performance: { baselineMs: 100, experimentMs: 100, ratio: 1 },
  risk: { riskClass: "REVIEW_REQUIRED", isolation: AYAS_EXPERIMENT_ISOLATION, liveWorkspaceUnchanged: true, sandboxDiscarded: true },
  analysisRoute: null, verdict: "IMPROVED", reasonCodes: [], targetGain: 1, fixedCaseIds: ["stale-free-text-seed"],
  remainingTargetFailures: 1, completedAt: "2026-09-29T00:00:00.000Z", authority: "NONE" };
const evidenceHash = experiments.writeEvidence(evidence as never);
experiments.writeExperiment({ schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId,
  hypothesisId: "fixture-hypothesis", attemptKey: evidence.attemptKey, attempt: 1, baseHead,
  strategyId: strategy.strategyId, strategyVersion: strategy.version, inputsDigest: "e".repeat(64), status: "COMPLETED",
  reservedAt: evidence.completedAt, updatedAt: evidence.completedAt,
  owner: { pid: process.pid, processStartEpochMs: Date.now(), runId: "fixture" }, leaseExpiresAt: evidence.completedAt,
  verdict: "IMPROVED", evidenceHash, completedAt: evidence.completedAt } as never);
const proof = createAyasExactPatchSafetyProof({ manifest: strategy.reviewedExactPatch, file, before, after,
  baseHead, strategyId: strategy.strategyId, strategyVersion: strategy.version, registryDigest, experimentId, evidenceHash });
assert.ok(proof);
const artifacts = createAyasPatchArtifactStore({ rootDir: path.join(root, "data", "brain", "self-improvement", "patch-artifacts") });
const artifactInput = { artifactId: `ayas-controlled-evolution-${crypto.randomUUID()}`, candidateId: "fixture",
  generatorIdentity: `controlled-self-evolution:v1:${strategy.strategyId}@${strategy.version}`,
  baseBranch: "fixture", baseHead, exactFiles: [file], allowedRoots: ["src/lib/ayas/memory/"], replacements: [replacement],
  validatorScripts: ["scripts/smoke-ayas-cognitive-quality.ts", ...strategy.regressionSuites],
  graphifyEvidence: ["fixture"], safetyClassification: "SAFE",
  controlledEvolutionBinding: { opportunityId: `ayas-evo-${"c".repeat(16)}`, experimentId, evidenceHash,
    hypothesisId: "fixture-hypothesis", strategyId: strategy.strategyId, strategyVersion: strategy.version, registryDigest },
  exactPatchSafetyProof: proof, problemStatement: "fixture", rationale: "fixture", expectedUserBenefit: "fixture",
  expectedBehaviorChange: "fixture", unchangedBehavior: "fixture", risk: "fixture", productionImpact: "none",
  sandboxValidationSummary: ["fixture"], generatedAt: evidence.completedAt } as const;
const artifact = artifacts.freeze(artifactInput);
assert.throws(() => artifacts.freeze({ ...artifactInput, artifactId: `ayas-controlled-evolution-${crypto.randomUUID()}`,
  problemStatement: `sk-${"x".repeat(24)}` }), "a real secret-like raw value still fails closed");
const inbox = createAyasApprovalInboxStore({ rootDir: path.join(root, "data", "brain"), repoRoot: root,
  artifactStore: artifacts, experimentStore: experiments, requireOwnerAdmission: true });
const proposal = inbox.createProposal({ createdAt: evidence.completedAt, baseBranch: "fixture", baseHead,
  objective: "verify exact patch", currentProblem: "specific stale context", selectionReason: "measured local evidence",
  expectedUserBenefit: "one measured case improves", expectedBehaviorChange: "read-side supersession",
  unchangedBehavior: "persistent records stay unchanged", riskIfNotDone: "stale context remains",
  technicalRisk: "bounded exact patch", productionImpact: "none before approval", rationale: "measured fixture",
  evidence: [evidenceHash], graphifyEvidence: ["fixture"], candidateRank: 1, risk: "bounded",
  safetyClassification: "SAFE", exactFiles: [file], expectedDiffScope: "one reviewed replacement",
  testsPlanned: ["scripts/smoke-ayas-cognitive-quality.ts", ...strategy.regressionSuites], estimatedCost: "zero-cost",
  mutationKind: "patch-artifact:v1", patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash,
  exactPatchSafetyProof: proof });
const options = { repoRoot: root, artifactStore: artifacts, experimentStore: experiments };

return { root, inbox, proposal, artifact, artifacts, experiments, options, before, after, file };
}
