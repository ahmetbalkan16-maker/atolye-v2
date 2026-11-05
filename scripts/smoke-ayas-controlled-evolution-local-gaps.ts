/**
 * Controlled self-evolution switched on from measured gaps (owner, 2026-11-05: "kontrollü evrimi yap"): the Stage 13
 * register is derived from the current HEAD's Stage 8 gap snapshot instead of a hand-written file that goes stale with
 * every commit. Pure planning plus a TEMP store and status file; the measurement is a seam, no sandbox, model or Git
 * mutation runs. The cycle itself and its sandbox are pinned by smoke-ayas-controlled-self-evolution(-cycle).
 * Run: npx tsx scripts/smoke-ayas-controlled-evolution-local-gaps.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ayasControlledEvolutionMode, ayasControlledEvolutionStatusFile, buildAyasLocalGapEvolutionRegister, prepareAyasControlledEvolutionRegister,
  recordAyasControlledEvolutionOutcome, type AyasControlledEvolutionStatus,
} from "../src/lib/ayas/evolution/AyasControlledEvolutionLocalGaps";
import { planAyasControlledSelfEvolution } from "../src/lib/ayas/evolution/AyasControlledSelfEvolution";
import { createAyasEvolutionRegister } from "../src/lib/ayas/evolution/AyasEvolutionOpportunity";
import { qualifyAyasEvolutionRegister, type AyasEvolutionEnvironment } from "../src/lib/ayas/evolution/AyasEvolutionQualification";
import { inventoryAyasCapabilities } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { createAyasResearchExperimentStore } from "../src/lib/brain/autonomy/AyasResearchExperimentStore";
import type { AyasLocalGapSnapshot } from "../src/lib/brain/autonomy/AyasResearchImprovementLoop";

let count = 0;
async function scenario(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); } catch (error) { console.error(`FAIL ${name}`); throw error; }
  count += 1;
}

const HEAD = "1".repeat(40);
const EVALUATOR = "2".repeat(64);
const NOW = "2026-11-05T20:00:00.000Z";
// The same fixture strategy smoke-ayas-controlled-self-evolution uses (test only, never registered in production).
const strategy = {
  strategyId: "exp-fixture-context-continuity", version: 1, capability: "conversation-memory-context", benchmarkId: "cognitive-quality",
  dimensions: ["CONTEXT_CONTINUITY"], component: "AyasContextAssembly", summary: "fixture strategy (test only)",
  exactFiles: ["src/lib/brain/probe/BrainResourceProbe.ts"], maxChangedLines: 20, regressionSuites: ["scripts/smoke-ayas-context.ts"], generate: () => [],
};
const registry = { ...AYAS_DEFAULT_IMPROVEMENT_REGISTRY, strategies: [strategy] };
const snapshot = (failing: AyasLocalGapSnapshot["failing"], head = HEAD): AyasLocalGapSnapshot => ({
  schemaVersion: "1", benchmarkId: "cognitive-quality", evaluatorSha256: EVALUATOR, measuredAtHead: head, measuredAt: NOW,
  caseCount: 55, passed: 55 - failing.length, heldOut: { passed: 5 - failing.filter((row) => row.heldOut).length, total: 5 }, dimensions: {}, failing,
});
const GAPS = snapshot([
  { id: "ctx-older-correction", dimension: "CONTEXT_CONTINUITY", heldOut: false, knownLimitation: false },
  { id: "ctx-held-out-case", dimension: "CONTEXT_CONTINUITY", heldOut: true, knownLimitation: false },
  { id: "intent-ambiguous-ask", dimension: "INTENT_ACCURACY", heldOut: false, knownLimitation: false },
]);
const env = (snapshots: readonly AyasLocalGapSnapshot[], reg = registry): AyasEvolutionEnvironment => ({
  now: NOW, currentHead: HEAD, capabilities: inventoryAyasCapabilities({ availableModelIds: [], availableSkillIds: [], availableAgentIds: [] }),
  operatingMode: "UNKNOWN", improvementRegistry: reg, gapSnapshots: snapshots,
});
const observation = { now: NOW, branch: "fixture", head: HEAD, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] as string[] };

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-evolution-local-gaps-"));
  try {
    await scenario("on by default; AYAS_CONTROLLED_EVOLUTION=0 or an explicitly empty register path is off; a register path keeps it on", () => {
      assert.equal(ayasControlledEvolutionMode({}), "AUTO");
      assert.equal(ayasControlledEvolutionMode({ AYAS_CONTROLLED_EVOLUTION: "0" }), "OFF");
      assert.equal(ayasControlledEvolutionMode({ AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE: "" }), "OFF", "the old 'no register' meaning the discovery suites rely on");
      assert.equal(ayasControlledEvolutionMode({ AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE: "data/brain/evolution.json" }), "AUTO");
    });

    await scenario("each measured gap (capability × dimension, held-out excluded) is one LOCAL_EVALUATOR opportunity bound to the snapshot; ids are stable", () => {
      const register = buildAyasLocalGapEvolutionRegister(GAPS, registry);
      const again = buildAyasLocalGapEvolutionRegister(GAPS, registry);
      assert.deepEqual(register.opportunities.map((o) => o.opportunityId), again.opportunities.map((o) => o.opportunityId));
      const dims = register.opportunities.map((o) => o.evidence[0]!.benchmark!.dimension).sort();
      assert.deepEqual(dims, ["CONTEXT_CONTINUITY", "INTENT_ACCURACY"]);
      for (const o of register.opportunities) {
        assert.equal(o.origin, "LOCAL_EVALUATOR");
        assert.deepEqual([o.normalizationIssues, o.instructionSignals], [[], []], o.opportunityId);
        assert.deepEqual([o.evidence[0]!.benchmark!.measuredAtHead, o.evidence[0]!.benchmark!.evaluatorSha256], [HEAD, EVALUATOR]);
        assert.ok(!o.evidence[0]!.benchmark!.caseIds.includes("ctx-held-out-case"), "a held-out case is never a target");
      }
      assert.deepEqual(buildAyasLocalGapEvolutionRegister(snapshot([]), registry).opportunities, [], "no gap, no opportunity");
    });

    await scenario("the existing planner turns the gap with a registered strategy into the one experiment candidate; the other gap needs a design", () => {
      const register = buildAyasLocalGapEvolutionRegister(GAPS, registry);
      const plan = planAyasControlledSelfEvolution({ register, environment: env([GAPS]) });
      assert.ok(plan.candidate, "a candidate");
      assert.equal(plan.candidate.strategy.strategyId, "exp-fixture-context-continuity");
      assert.deepEqual(plan.candidate.hypothesis.targetCaseIds, ["ctx-older-correction"]);
      assert.equal(plan.candidate.qualification.executionAuthority, "NONE");
      const outcomes = qualifyAyasEvolutionRegister(register, env([GAPS])).map((q) => q.stage8.outcome).sort();
      assert.deepEqual(outcomes, ["HYPOTHESIS", "NEEDS_EXPERIMENT_DESIGN"]);
      assert.equal(planAyasControlledSelfEvolution({ register, environment: env([snapshot(GAPS.failing, "3".repeat(40))]) }).candidate, null, "a snapshot of another HEAD proves nothing");
    });

    await scenario("prepare: measures once per HEAD in the sandbox seam, reuses it, stops after two failed attempts, and never measures without the evaluator", async () => {
      const root = path.join(temp, "repo");
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      const store = createAyasResearchExperimentStore({ rootDir: path.join(temp, "research-improvement") });
      const calls: string[] = [];
      const base = { repoRoot: root, observation, fileRegister: null, remainingMs: () => 150_000, registry, experimentStore: store, now: () => NOW };
      // No evaluator script in the checkout: nothing is measured, the status says why.
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("measure"); return GAPS; } });
      assert.deepEqual(calls, []);
      const status = () => JSON.parse(fs.readFileSync(ayasControlledEvolutionStatusFile(root), "utf8")) as AyasControlledEvolutionStatus;
      assert.deepEqual([status().measurement, status().plan.reason], ["NOT_MEASURED", "benchmark not measured at this HEAD yet"]);
      fs.writeFileSync(path.join(root, "scripts", "smoke-ayas-cognitive-quality.ts"), "// fixture evaluator\n");
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("fail"); return null; } });
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("fail"); return null; } });
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("fail"); return null; } });
      assert.deepEqual(calls, ["fail", "fail"], "at most two measurement attempts per HEAD");
      fs.rmSync(ayasControlledEvolutionStatusFile(root));
      const register = await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("measure"); return GAPS; } });
      assert.equal(register.opportunities.length, 2);
      assert.deepEqual([status().measurement, status().snapshot], ["MEASURED", { benchmarkId: "cognitive-quality", passed: 52, caseCount: 55, failing: 3 }]);
      assert.equal(store.listGapSnapshots().filter((s) => s.measuredAtHead === HEAD).length, 1, "the snapshot is the research loop's own store");
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => { calls.push("again"); return GAPS; } });
      assert.equal(calls.filter((c) => c === "again").length, 0, "reused, not measured twice");
      assert.equal(status().measurement, "REUSED");
      assert.equal(status().plan.candidate, register.opportunities.find((o) => o.evidence[0]!.benchmark!.dimension === "CONTEXT_CONTINUITY")!.opportunityId);
      assert.equal(status().plan.strategyApplies, true, "a SAFE-path strategy needs no reviewed-patch match");
      assert.equal(status().executionAuthority, "NONE");
      recordAyasControlledEvolutionOutcome(root, null);
      assert.equal(status().proposalCandidate, null);
    });

    await scenario("the production registry: a saturated benchmark means nothing to evolve; its one strategy no longer applies to today's source", async () => {
      const root = path.join(temp, "prod");
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(root, "scripts", "smoke-ayas-cognitive-quality.ts"), "// fixture evaluator\n");
      const store = createAyasResearchExperimentStore({ rootDir: path.join(temp, "prod-research-improvement") });
      const base = { repoRoot: root, observation, fileRegister: null, remainingMs: () => 150_000, experimentStore: store, now: () => NOW };
      const status = () => JSON.parse(fs.readFileSync(ayasControlledEvolutionStatusFile(root), "utf8")) as AyasControlledEvolutionStatus;
      await prepareAyasControlledEvolutionRegister({ ...base, measure: async () => snapshot([]) });
      assert.match(status().plan.reason, /^no failing non-held-out case at this HEAD \(55\/55 pass\) — nothing to evolve$/);
      fs.rmSync(ayasControlledEvolutionStatusFile(root));
      const store2 = createAyasResearchExperimentStore({ rootDir: path.join(temp, "prod-research-improvement-2") });
      await prepareAyasControlledEvolutionRegister({ ...base, experimentStore: store2, measure: async () => snapshot([{ id: "stale-case", dimension: "STALE_CONTEXT_LEAKAGE", heldOut: false, knownLimitation: false }]) });
      assert.equal(status().plan.strategyApplies, false);
      assert.match(status().plan.reason, /strategy no longer applies/);
      assert.equal(status().opportunities.find((o) => o.stage8 === "HYPOTHESIS")?.origin, "LOCAL_EVALUATOR");
    });

    await scenario("an operator register file is kept beside the measured opportunities, never duplicated", async () => {
      const root = path.join(temp, "repo");
      const store = createAyasResearchExperimentStore({ rootDir: path.join(temp, "research-improvement") });
      const own = buildAyasLocalGapEvolutionRegister(GAPS, registry);
      const merged = await prepareAyasControlledEvolutionRegister({ repoRoot: root, observation, fileRegister: createAyasEvolutionRegister([own.opportunities[0]!]), remainingMs: () => 150_000, registry, experimentStore: store, now: () => NOW });
      assert.equal(merged.opportunities.length, 2, "the file's copy of a measured opportunity is not a second one");
    });

    console.log(`PASS (${count} scenarios)`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
