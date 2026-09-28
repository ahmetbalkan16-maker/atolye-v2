import assert from "node:assert/strict";
import { runAyasRegisteredImprovementExperiment, type AyasRegisteredExperimentDeps } from "../src/lib/brain/autonomy/AyasRegisteredImprovementExperiment";

// Invalid admission must stop before a sandbox, evidence write, or store read.
const forbiddenStore = new Proxy({}, { get: () => { throw new Error("STORE_ACCESSED"); } }) as AyasRegisteredExperimentDeps["store"];
const head = "a".repeat(40);
const valid: AyasRegisteredExperimentDeps = {
  deps: { repoRoot: process.cwd() },
  observation: { now: "2026-09-28T00:00:00.000Z", head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" },
  store: forbiddenStore,
  record: { experimentId: "test", baseHead: head, hypothesisId: "hypothesis", strategyId: "strategy", strategyVersion: 1 } as AyasRegisteredExperimentDeps["record"],
  hypothesis: { hypothesisId: "hypothesis", strategyId: "strategy", strategyVersion: 1, benchmarkId: "benchmark" } as AyasRegisteredExperimentDeps["hypothesis"],
  strategy: { strategyId: "strategy", version: 1, benchmarkId: "benchmark" } as AyasRegisteredExperimentDeps["strategy"],
  benchmark: { benchmarkId: "benchmark" } as AyasRegisteredExperimentDeps["benchmark"],
  sourceIds: [],
  sourceBindings: [{ kind: "RESEARCH_FINDING", id: "finding" }],
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
  console.log(`PASS (${refusals.length} generic experiment admission refusals; no store access)`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
