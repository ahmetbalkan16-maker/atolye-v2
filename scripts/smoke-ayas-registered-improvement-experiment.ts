import assert from "node:assert/strict";
import { AYAS_EXPERIMENT_ISOLATION, hashAyasExperimentEvidence, verifyAyasExperimentEvidence, type AyasExperimentEvidence } from "../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION } from "../src/lib/brain/autonomy/AyasResearchImprovementLoop";
import { runAyasRegisteredImprovementExperiment, type AyasRegisteredExperimentDeps } from "../src/lib/brain/autonomy/AyasRegisteredImprovementExperiment";

// Invalid admission must stop before a sandbox, evidence write, or store read.
const forbiddenStore = new Proxy({}, { get: () => { throw new Error("STORE_ACCESSED"); } }) as AyasRegisteredExperimentDeps["store"];
const head = "a".repeat(40);
const findingId = "ayas-research-00000000-0000-4000-8000-000000000001";
const valid: AyasRegisteredExperimentDeps = {
  deps: { repoRoot: process.cwd() },
  observation: { now: "2026-09-28T00:00:00.000Z", head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" },
  store: forbiddenStore,
  record: { experimentId: "test", baseHead: head, hypothesisId: "hypothesis", strategyId: "strategy", strategyVersion: 1 } as AyasRegisteredExperimentDeps["record"],
  hypothesis: { hypothesisId: "hypothesis", findingIds: [findingId], strategyId: "strategy", strategyVersion: 1, benchmarkId: "benchmark" } as unknown as AyasRegisteredExperimentDeps["hypothesis"],
  strategy: { strategyId: "strategy", version: 1, benchmarkId: "benchmark" } as AyasRegisteredExperimentDeps["strategy"],
  benchmark: { benchmarkId: "benchmark" } as AyasRegisteredExperimentDeps["benchmark"],
  sourceIds: [],
  sourceBindings: [{ kind: "RESEARCH_FINDING", id: findingId }],
  remainingMs: () => 60_000,
  clock: () => "2026-09-28T00:00:00.000Z",
};

const refusals: readonly [string, Partial<AyasRegisteredExperimentDeps>][] = [
  ["invalid-head", { observation: { ...valid.observation, head: "short" } }],
  ["dirty-repo", { observation: { ...valid.observation, repoClean: false } }],
  ["stale-graph", { observation: { ...valid.observation, graphifyFresh: false } }],
  ["machine-not-allow", { observation: { ...valid.observation, machineAction: "PAUSE" } }],
  ["record-head-mismatch", { record: { ...valid.record, baseHead: "b".repeat(40) } }],
  ["strategy-mismatch", { strategy: { ...valid.strategy, strategyId: "other" } }],
  ["benchmark-mismatch", { benchmark: { ...valid.benchmark, benchmarkId: "other" } }],
  ["missing-binding", { sourceBindings: [] }],
  ["invalid-binding", { sourceBindings: [{ kind: "EVOLUTION_OPPORTUNITY", id: " " }] }],
];

async function main(): Promise<void> {
  for (const [name, override] of refusals) {
    await assert.rejects(runAyasRegisteredImprovementExperiment({ ...valid, ...override }), /EXPERIMENT_SOURCE_NOT_READY/, name);
  }
  const legacy: AyasExperimentEvidence = {
    schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION,
    experimentId: "test", attemptKey: "attempt", baseHead: head, findingIds: [findingId], sourceIds: [], hypothesis: valid.hypothesis,
    baseline: null, experiment: null,
    environment: { node: process.version, platform: process.platform, arch: process.arch, tsx: null, typescript: null },
    change: null,
    regressions: { newlyFailingCaseIds: [], heldOutDelta: 0, suites: [] },
    performance: { baselineMs: null, experimentMs: null, ratio: null },
    risk: { riskClass: "SAFE", isolation: AYAS_EXPERIMENT_ISOLATION, liveWorkspaceUnchanged: true, sandboxDiscarded: true },
    analysisRoute: null, verdict: "INCONCLUSIVE", reasonCodes: [], targetGain: 0, fixedCaseIds: [], remainingTargetFailures: 0,
    completedAt: "2026-09-28T00:00:00.000Z", authority: "NONE",
  };
  const verifies = (evidence: AyasExperimentEvidence): boolean => verifyAyasExperimentEvidence(evidence, hashAyasExperimentEvidence(evidence));
  assert.equal(verifies(legacy), true, "historical evidence without sourceBindings remains valid");
  const research = { ...legacy, sourceBindings: [{ kind: "RESEARCH_FINDING" as const, id: findingId }] };
  assert.equal(verifies(research), true, "research finding is bound");
  assert.equal(verifyAyasExperimentEvidence({ ...research, sourceBindings: [{ kind: "RESEARCH_FINDING", id: "ayas-research-00000000-0000-4000-8000-000000000002" }] }, hashAyasExperimentEvidence(research)), false, "tamper breaks hash");
  assert.equal(verifies({ ...research, sourceBindings: [{ kind: "UNKNOWN" as "RESEARCH_FINDING", id: findingId }] }), false, "unknown kind refused even with a recomputed hash");
  assert.equal(verifies({ ...research, sourceBindings: [{ kind: "RESEARCH_FINDING", id: "invalid" }] }), false, "invalid id refused");
  assert.equal(verifies({ ...research, sourceBindings: [...research.sourceBindings, ...research.sourceBindings] }), false, "duplicate binding refused");
  const opportunityId = "ayas-evo-" + "b".repeat(32);
  const opportunity = { ...legacy, findingIds: [], hypothesis: { ...legacy.hypothesis, findingIds: [] }, sourceBindings: [{ kind: "EVOLUTION_OPPORTUNITY" as const, id: opportunityId }] };
  assert.equal(verifies(opportunity), true, "opportunity needs no synthetic research finding");
  assert.equal(verifies({ ...opportunity, sourceBindings: [...opportunity.sourceBindings, { kind: "RESEARCH_FINDING", id: findingId }] }), false, "synthetic research finding refused");
  assert.equal(verifies({ ...research, sourceBindings: [...research.sourceBindings, { kind: "EVOLUTION_OPPORTUNITY", id: opportunityId }] }), true, "real research can accompany an opportunity");
  console.log(`PASS (${refusals.length} admission refusals with no store access; 9 evidence binding and legacy cases)`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
