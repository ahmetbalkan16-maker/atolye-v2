import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasExactPatchSafetyProof, ayasExactPatchSha256, verifyAyasExecutedExactPatch } from "../src/lib/brain/selfheal/AyasExactPatchSafety";
import { verifyAyasExactProposalSafety } from "../src/lib/brain/autonomy/AyasExactProposalSafety";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY, ayasImprovementRegistryDigest,
  generateAyasRenderToolSupersessionPatch } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasResearchExperimentStore } from "../src/lib/brain/autonomy/AyasResearchExperimentStore";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION } from "../src/lib/brain/autonomy/AyasResearchImprovementLoop";
import { AYAS_EXPERIMENT_ISOLATION } from "../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";
import { runAyasBoundedMutationWithValidators } from "../src/lib/brain/autonomy/AyasMutationRegistry";
import { resolveAyasPatchArtifactMutation } from "../src/lib/brain/autonomy/AyasPatchArtifactMutation";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { evaluateAyasInternalDecision } from "../src/lib/brain/autonomy/AyasInternalDecision";
import { classifyPatchSet } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { approveAndExecuteAyasProposal, AyasProposalApprovalError } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { bindAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { decideAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";

async function main(): Promise<void> {
const file = "src/lib/ayas/memory/AyasMemoryTemporal.ts";
const sourceRoot = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exact-proposal-"));
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
git("init", "-q");
git("config", "user.email", "smoke@example.invalid");
git("config", "user.name", "Smoke");
fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
const before = execFileSync("git", ["show", `HEAD:${file}`], { cwd: sourceRoot, encoding: "utf8", windowsHide: true });
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
  artifactStore: artifacts, experimentStore: experiments });
const proposal = inbox.createProposal({ createdAt: evidence.completedAt, baseBranch: "fixture", baseHead,
  objective: "verify exact patch", currentProblem: "specific stale context", selectionReason: "measured local evidence",
  expectedUserBenefit: "one measured case improves", expectedBehaviorChange: "read-side supersession",
  unchangedBehavior: "persistent records stay unchanged", riskIfNotDone: "stale context remains",
  technicalRisk: "bounded exact patch", productionImpact: "none before approval", rationale: "measured fixture",
  evidence: [evidenceHash], graphifyEvidence: ["fresh graph"], candidateRank: 1, risk: "bounded",
  safetyClassification: "SAFE", exactFiles: [file], expectedDiffScope: "one reviewed replacement",
  testsPlanned: ["scripts/smoke-ayas-cognitive-quality.ts", ...strategy.regressionSuites], estimatedCost: "zero-cost",
  mutationKind: "patch-artifact:v1", patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash,
  exactPatchSafetyProof: proof });
const options = { repoRoot: root, artifactStore: artifacts, experimentStore: experiments };
assert.equal(classifyPatchSet([file]).level, "REVIEW_REQUIRED");
assert.equal(classifyPatchSet(["src/lib/brain/selfheal/AyasExactPatchSafety.ts"]).level, "FORBIDDEN_AUTONOMOUS");
assert.equal(classifyPatchSet(["src/lib/brain/autonomy/AyasExactProposalSafety.ts"]).level, "FORBIDDEN_AUTONOMOUS");
assert.equal(classifyPatchSet(["src/lib/ayas/execution/AyasExecutionGateStore.ts"]).level, "FORBIDDEN_AUTONOMOUS");
assert.equal(classifyPatchSet(["scripts/smoke-fixture.ts"]).level, "SAFE");
assert.equal(verifyAyasExactProposalSafety(proposal, options), true);
const daemon = createAyasAutonomyDaemon({ inbox, repoRoot: root, exactPatchArtifactStore: artifacts, exactExperimentStore: experiments });
const observation = { now: evidence.completedAt, branch: "fixture", head: baseHead, repoClean: true,
  graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
daemon.observe(observation);
const discovered = daemon.discover(observation, [{ ...proposal, rank: 1, mutationKind: "patch-artifact:v1" } as never]);
assert.equal(discovered.length, 1);
assert.equal(discovered[0]?.safetyClassification, "SAFE");
assert.equal(discovered[0]?.exactPatchSafetyProof?.digest, proof.digest);
const differentDiff = daemon.discover(observation, [{ ...proposal, rank: 1, mutationKind: "patch-artifact:v1",
  exactPatchSafetyProof: { ...proof, afterSha256: "f".repeat(64) } } as never]);
assert.equal(differentDiff[0]?.safetyClassification, "REVIEW_REQUIRED");
assert.equal(differentDiff[0]?.exactPatchSafetyProof, undefined);
const previousCwd = process.cwd();
try {
  process.chdir(root);
  assert.equal(evaluateAyasInternalDecision(proposal).decision, "RECOMMEND_FOR_APPROVAL");
} finally { process.chdir(previousCwd); }
await assert.rejects(approveAndExecuteAyasProposal(proposal.proposalId, proposal.proposalHash, {
  repoRoot: root, gateRoot: path.join(root, "data", "brain", "self-improvement"), inbox,
  artifactStore: artifacts, traceEnabled: false,
}), (error: unknown) => error instanceof AyasProposalApprovalError && error.code === "EXACT_PATCH_LOCAL_EXECUTION_ONLY");
assert.equal(inbox.load().decisions.length, 0, "publication refusal must not mint approval");
assert.equal(verifyAyasExactProposalSafety({ ...proposal, patchHash: "f".repeat(64) }, options), false);
assert.equal(verifyAyasExactProposalSafety({ ...proposal, patchArtifactId: "different" }, options), false);
assert.equal(verifyAyasExactProposalSafety({ ...proposal, exactFiles: [file, "src/extra.ts"] }, options), false);
assert.equal(verifyAyasExactProposalSafety({ ...proposal, baseHead: "f".repeat(40) }, options), false);
assert.equal(verifyAyasExactProposalSafety({ ...proposal, exactPatchSafetyProof: { ...proof, evidenceHash: "f".repeat(64) } }, options), false);
const extraValidatorArtifact = artifacts.freeze({ ...artifactInput, artifactId: `ayas-controlled-evolution-${crypto.randomUUID()}`,
  validatorScripts: [...artifactInput.validatorScripts, "scripts/smoke-unreviewed.ts"] });
assert.equal(verifyAyasExactProposalSafety({ ...proposal, patchArtifactId: extraValidatorArtifact.artifactId,
  patchHash: extraValidatorArtifact.patchHash }, options), false);
const extraRootArtifact = artifacts.freeze({ ...artifactInput, artifactId: `ayas-controlled-evolution-${crypto.randomUUID()}`,
  allowedRoots: [...artifactInput.allowedRoots, "src/lib/brain/"] });
assert.equal(verifyAyasExactProposalSafety({ ...proposal, patchArtifactId: extraRootArtifact.artifactId,
  patchHash: extraRootArtifact.patchHash }, options), false);
const artifactPath = path.join(artifacts.dir, `${artifact.artifactId}.json`);
const frozenBytes = fs.readFileSync(artifactPath, "utf8");
fs.writeFileSync(artifactPath, frozenBytes.replace('"risk": "fixture"', '"risk": "tampered"'));
assert.equal(verifyAyasExactProposalSafety(proposal, options), false, "on-disk artifact tamper must be detected");
fs.writeFileSync(artifactPath, frozenBytes);
const localDecision = await decideAyasOwnerApproval(bindAyasOwnerApproval(proposal, evidence.completedAt), "APPROVE", {
  repoRoot: root, gateRoot: path.join(root, "data", "brain", "self-improvement"), inbox,
  artifactStore: artifacts, exactExperimentStore: experiments,
  envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" },
});
assert.deepEqual(localDecision, { executed: false, reason: "APPROVED_PENDING_EXECUTION" });
assert.equal(inbox.load().proposals.find((item) => item.proposalId === proposal.proposalId)?.status, "APPROVED");
assert.equal((await resumeAyasOwnerApprovedProposals({ repoRoot: root,
  gateRoot: path.join(root, "data", "brain", "self-improvement"), inbox, artifactStore: artifacts,
  envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" } })).length, 0, "remote publisher must not resume exact proof");
assert.deepEqual(resolveAyasPatchArtifactMutation(proposal, artifacts, root, experiments).exactFiles, [file]);
fs.writeFileSync(path.join(root, file), `${before}\n// unexpected edit`);
assert.equal(verifyAyasExactProposalSafety(proposal, options), false);
assert.throws(() => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, baseHead, [file], "2026-09-29T00:02:00.000Z"));
fs.writeFileSync(path.join(root, file), before);
fs.writeFileSync(path.join(root, "fixture.txt"), "head advance\n");
git("add", "fixture.txt"); git("commit", "-qm", "advance head");
assert.equal(verifyAyasExactProposalSafety(proposal, options), false);
assert.throws(() => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, baseHead, [file], "2026-09-29T00:03:00.000Z"));
await assert.rejects(runAyasBoundedMutationWithValidators(root, ["src/lib/ayas/memory/"],
  [{ filePath: file, expectedHash: replacement.expectedHash, content: `${after}\n// injected wrong diff`, allowCreate: false }],
  [async (repoRoot) => ({ validator: "exact-patch-effect-proof",
    pass: verifyAyasExecutedExactPatch(proof, strategy.reviewedExactPatch, file, before,
      fs.readFileSync(path.join(repoRoot, file), "utf8")), summary: "actual diff check" })]));
assert.equal(fs.readFileSync(path.join(root, file), "utf8"), before, "invalid write must roll back");
console.log(JSON.stringify({ status: "PASS", suite: "ayas-exact-proposal-safety", scenarios: 28 }));
}
void main();
