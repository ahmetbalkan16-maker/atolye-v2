import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ayasGoldenVaultDigest, type AyasGoldenVault } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { freezeAyasControlledEvolutionArtifact } from "../src/lib/ayas/evolution/AyasControlledSelfEvolutionArtifact";
import { buildAyasControlledEvolutionProposalCandidate } from "../src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge";
import { ayasControlledEvolutionDedupeKey, type AyasControlledEvolutionCandidate } from "../src/lib/ayas/evolution/AyasControlledSelfEvolution";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { evaluateAyasInternalDecision } from "../src/lib/brain/autonomy/AyasInternalDecision";
import { AYAS_EXPERIMENT_ISOLATION, type AyasExperimentEvidence } from "../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";
import { ayasImprovementRegistryDigest, AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore, type AyasExperimentRecord } from "../src/lib/brain/autonomy/AyasResearchExperimentStore";
import { buildAyasImprovementHypothesis, AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION } from "../src/lib/brain/autonomy/AyasResearchImprovementLoop";
import { runAyasRegisteredImprovementExperiment, type AyasRegisteredExperimentResult } from "../src/lib/brain/autonomy/AyasRegisteredImprovementExperiment";
import { measureAyasLocalGapSnapshot } from "../src/lib/brain/autonomy/AyasResearchImprovementCycle";
import { fixtureGoldenVault, heldGoldenEvidence } from "./fixtures/ayas-golden-fixtures";
import { behaviorStrategy, createFixtureRepo, FIXTURE_NOW, fixtureRegistry, tempDir } from "./fixtures/ayas-research-improvement-fixtures";

const hash = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const OPPORTUNITY_ID = "ayas-evo-" + "a".repeat(32);
const NODE_MODULES = path.join(process.cwd(), "node_modules");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

async function retainedSandboxSource(): Promise<void> {
  const repo = createFixtureRepo();
  const storeDir = tempDir("ayas-controlled-runner-store-");
  try {
    const store = createAyasResearchExperimentStore({ rootDir: storeDir });
    const head = repo.head();
    const strategy = behaviorStrategy("controlled-retention", { "ref-follow-up": true, "ref-ordinal": true });
    const benchmark = fixtureRegistry([strategy]).benchmarks[0]!;
    const snapshot = await measureAyasLocalGapSnapshot({ repoRoot: repo.root, head, benchmark, timeoutMs: 20_000, nodeModulesDir: NODE_MODULES, nowIso: FIXTURE_NOW });
    assert.ok(snapshot, "the current HEAD must have a measured fixture gap");
    const hypothesis = buildAyasImprovementHypothesis({ status: "MAPPED", capability: strategy.capability, component: strategy.component,
      benchmarkId: benchmark.benchmarkId, dimension: "REFERENCE_RESOLUTION", targetCaseIds: ["ref-follow-up", "ref-ordinal"], snapshot }, strategy, []);
    const record: AyasExperimentRecord = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId: `ayas-experiment-${crypto.randomUUID()}`,
      hypothesisId: hypothesis.hypothesisId, attemptKey: "b".repeat(64), attempt: 1, baseHead: head, strategyId: strategy.strategyId,
      strategyVersion: strategy.version, inputsDigest: "c".repeat(64), status: "RESERVED", reservedAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW,
      owner: { pid: process.pid, processStartEpochMs: Date.now() - 1_000, runId: crypto.randomUUID() }, leaseExpiresAt: "2026-09-22T00:00:00.000Z" };
    store.writeExperiment(record);
    const goldenVault = fixtureGoldenVault(repo.root);
    const result = await runAyasRegisteredImprovementExperiment({ deps: { repoRoot: repo.root, nodeModulesDir: NODE_MODULES, goldenVault },
      observation: { now: FIXTURE_NOW, head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" }, store, record, hypothesis, strategy, benchmark,
      sourceIds: [], sourceBindings: [{ kind: "EVOLUTION_OPPORTUNITY", id: OPPORTUNITY_ID }], remainingMs: () => 120_000, clock: () => FIXTURE_NOW });
    assert.equal(result.verdict, "IMPROVED", JSON.stringify({ reasons: result.reasonCodes, baseline: store.readEvidence(result.record.evidenceHash!)?.baseline, hypothesis: hypothesis.gapEvidence }));
    assert.ok(result.retainedSource, "exact source must survive sandbox cleanup in memory");
    assert.equal(result.retainedSource.replacements.length, 1);
    assert.equal(result.retainedSource.replacements[0]!.expectedHash, hash(fs.readFileSync(path.join(repo.root, "src/fixture/behavior.ts"), "utf8")));
    assert.match(result.retainedSource.replacements[0]!.content, /"ref-follow-up": true/);
    const evidence = store.readEvidence(result.record.evidenceHash!);
    assert.equal(evidence?.replacementDigest, hash(JSON.stringify(result.retainedSource.replacements)));
    assert.equal(evidence?.change?.diffSha256, result.retainedSource.diffSha256);
    assert.deepEqual(evidence?.sourceBindings, [{ kind: "EVOLUTION_OPPORTUNITY", id: OPPORTUNITY_ID }]);
    assert.equal(evidence?.risk.sandboxDiscarded, true);
    // Stage 15O: the improvement was also measured against the golden vault, in the same sandbox, and held.
    assert.deepEqual(evidence?.golden, heldGoldenEvidence(goldenVault, strategy.regressionSuites));
    assert.equal(git(repo.root, "status", "--porcelain"), "");
  } finally { repo.remove(); fs.rmSync(storeDir, { recursive: true, force: true }); }
}

async function frozenArtifact(): Promise<void> {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-controlled-artifact-test-"));
  try {
    const filePath = "src/lib/brain/probe/BrainResourceProbe.ts";
    const oldContent = "export const observed = 1;\n";
    const content = "export const observed = 2;\n";
    fs.mkdirSync(path.join(root, path.posix.dirname(filePath)), { recursive: true });
    fs.writeFileSync(path.join(root, filePath), oldContent);
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "fixture@example.invalid"); git(root, "config", "user.name", "AYAS Fixture"); git(root, "config", "commit.gpgsign", "false");
    git(root, "add", "."); git(root, "commit", "--quiet", "-m", "fixture");
    const head = git(root, "rev-parse", "HEAD");
    const benchmark = AYAS_DEFAULT_IMPROVEMENT_REGISTRY.benchmarks.find((item) => item.benchmarkId === "cognitive-quality")!;
    const strategy = { strategyId: "exp-fixture-safe-artifact", version: 1, capability: "conversation-memory-context", benchmarkId: benchmark.benchmarkId,
      dimensions: ["CONTEXT_CONTINUITY"], component: "AyasContextAssembly", summary: "fixture source change", exactFiles: [filePath], maxChangedLines: 10,
      regressionSuites: ["scripts/smoke-ayas-context.ts"], generate: () => [] };
    const registry = { ...AYAS_DEFAULT_IMPROVEMENT_REGISTRY, strategies: [strategy] };
    const evaluatorSha256 = "2".repeat(64);
    const snapshot = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, benchmarkId: benchmark.benchmarkId, evaluatorSha256, measuredAtHead: head,
      measuredAt: FIXTURE_NOW, caseCount: 2, passed: 1, heldOut: { passed: 1, total: 1 }, dimensions: {},
      failing: [{ id: "target", dimension: "CONTEXT_CONTINUITY", heldOut: false, knownLimitation: false }] };
    const hypothesis = buildAyasImprovementHypothesis({ status: "MAPPED", capability: strategy.capability, component: strategy.component,
      benchmarkId: benchmark.benchmarkId, dimension: "CONTEXT_CONTINUITY", targetCaseIds: ["target"], snapshot }, strategy, []);
    const registryDigest = ayasImprovementRegistryDigest(registry);
    const sourceBindings = [{ kind: "EVOLUTION_OPPORTUNITY" as const, id: OPPORTUNITY_ID }];
    const candidate: AyasControlledEvolutionCandidate = { opportunityId: OPPORTUNITY_ID, baseHead: head, registryDigest,
      dedupeKey: ayasControlledEvolutionDedupeKey({ opportunityId: OPPORTUNITY_ID, hypothesisId: hypothesis.hypothesisId, baseHead: head, registryDigest }),
      hypothesis, strategy, benchmark, sourceBindings, qualification: { readiness: "EXPERIMENT_READY", blockers: [], executionAuthority: "NONE",
        authority: { granted: "NONE" }, mayExecute: false, mayInstall: false, maySpend: false, mayPublish: false } as unknown as AyasControlledEvolutionCandidate["qualification"] };
    const replacements = [{ filePath, expectedHash: hash(oldContent), content }];
    const diffSha256 = "d".repeat(64);
    const evidence: AyasExperimentEvidence = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId: `ayas-experiment-${crypto.randomUUID()}`,
      attemptKey: "e".repeat(64), baseHead: head, findingIds: [], sourceIds: [], sourceBindings,
      replacementDigest: hash(JSON.stringify(replacements)), hypothesis,
      baseline: { benchmarkId: benchmark.benchmarkId, evaluatorSha256, caseCount: 2, passed: 1, heldOut: { passed: 1, total: 1 }, dimensions: {}, failingCaseIds: ["target"], durationMs: 1 },
      experiment: { benchmarkId: benchmark.benchmarkId, evaluatorSha256, caseCount: 2, passed: 2, heldOut: { passed: 1, total: 1 }, dimensions: {}, failingCaseIds: [], durationMs: 1 },
      environment: { node: process.version, platform: process.platform, arch: process.arch, tsx: null, typescript: null },
      change: { strategyId: strategy.strategyId, strategyVersion: strategy.version, files: [{ filePath, addedLines: 1, removedLines: 1 }], diffSha256, diffExcerpt: "bounded fixture diff" },
      regressions: { newlyFailingCaseIds: [], heldOutDelta: 0, suites: [{ script: strategy.regressionSuites[0]!, baselinePass: true, experimentPass: true }] },
      golden: heldGoldenEvidence(),
      performance: { baselineMs: 1, experimentMs: 1, ratio: 1 },
      risk: { riskClass: "SAFE", isolation: AYAS_EXPERIMENT_ISOLATION, liveWorkspaceUnchanged: true, sandboxDiscarded: true },
      analysisRoute: null, verdict: "IMPROVED", reasonCodes: [], targetGain: 1, fixedCaseIds: ["target"], remainingTargetFailures: 0,
      completedAt: FIXTURE_NOW, authority: "NONE" };
    const experimentStore = createAyasResearchExperimentStore({ rootDir: path.join(root, "private-experiment-store") });
    const artifactStore = createAyasPatchArtifactStore({ rootDir: path.join(root, "private-artifact-store") });
    // The test stores are under this TEMP root and ignored by the fixture Git repository.
    fs.writeFileSync(path.join(root, ".gitignore"), "private-experiment-store/\nprivate-artifact-store/\nprivate-inbox/\n");
    git(root, "add", ".gitignore"); git(root, "commit", "--quiet", "-m", "ignore isolated fixture stores");
    const boundHead = git(root, "rev-parse", "HEAD");
    const boundCandidate = { ...candidate, baseHead: boundHead, hypothesis: { ...hypothesis, gapEvidence: { ...hypothesis.gapEvidence, measuredAtHead: boundHead } },
      dedupeKey: ayasControlledEvolutionDedupeKey({ opportunityId: OPPORTUNITY_ID, hypothesisId: hypothesis.hypothesisId, baseHead: boundHead, registryDigest }) };
    const boundEvidence = { ...evidence, baseHead: boundHead, hypothesis: boundCandidate.hypothesis };
    const evidenceHash = experimentStore.writeEvidence(boundEvidence);
    const record = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId: evidence.experimentId, hypothesisId: hypothesis.hypothesisId,
      attemptKey: evidence.attemptKey, attempt: 1, baseHead: boundHead, strategyId: strategy.strategyId, strategyVersion: strategy.version,
      inputsDigest: "f".repeat(64), status: "COMPLETED" as const, reservedAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW,
      owner: { pid: process.pid, processStartEpochMs: Date.now() - 1_000, runId: crypto.randomUUID() }, leaseExpiresAt: FIXTURE_NOW,
      verdict: "IMPROVED" as const, evidenceHash, completedAt: FIXTURE_NOW };
    experimentStore.writeExperiment(record);
    const result: AyasRegisteredExperimentResult = { record, verdict: "IMPROVED", reasonCodes: [], retainedSource: { diffSha256, replacements } };
    const input = { repoRoot: root, candidate: boundCandidate, registry, result, experimentStore, artifactStore, now: FIXTURE_NOW };
    assert.equal(await freezeAyasControlledEvolutionArtifact({ ...input, result: { ...result, verdict: "NEUTRAL" } }), null);
    assert.equal(await freezeAyasControlledEvolutionArtifact({ ...input, result: { ...result, retainedSource: { diffSha256, replacements: [{ ...replacements[0]!, expectedHash: "0".repeat(64) }] } } }), null);
    // Stage 15O: improved without a golden block held against the current vault freezes nothing.
    const withEvidence = (changed: AyasExperimentEvidence) => { const hash = experimentStore.writeEvidence(changed); return { ...input, result: { ...result, record: { ...record, evidenceHash: hash } } }; };
    const { golden: heldGolden, ...beforeTheVault } = boundEvidence;
    assert.equal(await freezeAyasControlledEvolutionArtifact(withEvidence(beforeTheVault)), null, "evidence from before the vault");
    assert.equal(await freezeAyasControlledEvolutionArtifact(withEvidence({ ...boundEvidence, golden: { ...heldGolden!, vaultDigest: "f".repeat(64) } })), null, "held against another vault");
    assert.equal(await freezeAyasControlledEvolutionArtifact(withEvidence({ ...boundEvidence, golden: { ...heldGolden!, cases: heldGolden!.cases.slice(1) } })), null, "not every case asked");
    // The vault moved on by one version after the experiment: the evidence is held against the older one.
    const laterVault: AyasGoldenVault = { ...AYAS_GOLDEN_VAULT, version: AYAS_GOLDEN_VAULT.version + 1, previousDigest: ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT) };
    assert.equal(await freezeAyasControlledEvolutionArtifact({ ...input, goldenVault: laterVault }), null, "held against an older version of the vault");
    const artifact = await freezeAyasControlledEvolutionArtifact(input);
    assert.ok(artifact, "verified improvement should freeze exactly one artifact");
    assert.equal(artifact.baseHead, boundHead);
    assert.equal(artifact.safetyClassification, "SAFE");
    assert.deepEqual(artifact.exactFiles, [filePath]);
    assert.deepEqual(artifact.allowedRoots, ["src/lib/brain/probe/"]);
    assert.equal(artifact.replacements[0]?.content, content);
    assert.equal(artifact.replacements[0]?.expectedHash, hash(oldContent));
    assert.equal(artifact.graphifyImportCounts?.[filePath], 0);
    assert.deepEqual(artifact.validatorScripts, [benchmark.script, strategy.regressionSuites[0]]);
    assert.equal(artifactStore.loadVerified(artifact.artifactId).patchHash, artifact.patchHash);
    assert.deepEqual(artifact.controlledEvolutionBinding, { opportunityId: OPPORTUNITY_ID, experimentId: record.experimentId,
      evidenceHash, hypothesisId: hypothesis.hypothesisId, strategyId: strategy.strategyId, strategyVersion: strategy.version, registryDigest });
    const bridgeInput = { repoRoot: root, candidate: boundCandidate, registry, experimentId: record.experimentId,
      artifactId: artifact.artifactId, experimentStore, artifactStore };
    const proposal = await buildAyasControlledEvolutionProposalCandidate(bridgeInput);
    assert.ok(proposal, "verified evidence and frozen artifact must produce one candidate");
    assert.equal(proposal.mutationKind, AYAS_PATCH_ARTIFACT_MUTATION_KIND);
    assert.equal(proposal.patchArtifactId, artifact.artifactId);
    assert.equal(proposal.patchHash, artifact.patchHash);
    assert.equal(proposal.sourceReference, OPPORTUNITY_ID);
    assert.deepEqual(proposal.exactFiles, [filePath]);
    assert.ok(proposal.evidence.includes(`evidenceSha256:${evidenceHash}`));
    const inbox = createAyasApprovalInboxStore({ rootDir: path.join(root, "private-inbox") });
    const daemon = createAyasAutonomyDaemon({ inbox, repoRoot: root, now: () => FIXTURE_NOW });
    const observation = { now: FIXTURE_NOW, branch: "main", head: boundHead, repoClean: true, graphifyFresh: true,
      machineAction: "ALLOW" as const, gaps: [] };
    daemon.observe(observation);
    const discovered = daemon.discover(observation, [proposal]);
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0]?.status, "PENDING");
    assert.equal(discovered[0]?.mutationKind, AYAS_PATCH_ARTIFACT_MUTATION_KIND);
    assert.equal(discovered[0]?.patchHash, artifact.patchHash);
    assert.equal(evaluateAyasInternalDecision(discovered[0]!).decision, "DEFER", "unknown impact cannot reach owner recommendation");
    assert.equal(inbox.load().decisions.length, 0, "discovery must not grant owner approval");
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, experimentId: "missing" }), null);
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, artifactId: "missing" }), null);
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, candidate: { ...boundCandidate, baseHead: "0".repeat(40) } }), null);
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, candidate: { ...boundCandidate, qualification: { ...boundCandidate.qualification, readiness: "BLOCKED" } } }), null);
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, artifactStore: { ...artifactStore,
      loadVerified: () => ({ ...artifact, controlledEvolutionBinding: { ...artifact.controlledEvolutionBinding!, evidenceHash: "0".repeat(64) } }) } }), null);
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, experimentStore: { ...experimentStore,
      readEvidence: () => ({ ...boundEvidence, verdict: "NEUTRAL" }) } }), null);
    // Stage 15O: the bridge asks the same question again; a frozen artifact does not carry evidence past the vault.
    assert.equal(await buildAyasControlledEvolutionProposalCandidate({ ...bridgeInput, goldenVault: laterVault }), null);
    const artifactPath = path.join(artifactStore.dir, `${artifact.artifactId}.json`);
    const originalArtifact = fs.readFileSync(artifactPath, "utf8");
    fs.writeFileSync(artifactPath, originalArtifact.replace(evidenceHash, "0".repeat(64)), "utf8");
    assert.equal(await buildAyasControlledEvolutionProposalCandidate(bridgeInput), null, "hash-bound evidence identity cannot be edited on disk");
    fs.writeFileSync(artifactPath, originalArtifact, "utf8");
    assert.ok(await buildAyasControlledEvolutionProposalCandidate(bridgeInput), "restored immutable artifact still bridges");
    fs.writeFileSync(path.join(root, "dirty.txt"), "not committed");
    assert.equal(await freezeAyasControlledEvolutionArtifact(input), null, "dirty current workspace cannot freeze another artifact");
    assert.equal(await buildAyasControlledEvolutionProposalCandidate(bridgeInput), null, "dirty workspace cannot bridge an artifact");
  } finally {
    const resolved = path.resolve(root);
    const temp = fs.realpathSync(os.tmpdir());
    if (!resolved.startsWith(`${temp}${path.sep}`)) throw new Error("TEMP_CLEANUP_PATH_OUTSIDE_ROOT");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await retainedSandboxSource();
  await frozenArtifact();
  console.log("PASS (controlled evolution sandbox retention, SAFE artifact, verified proposal bridge and refusal cases)");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
