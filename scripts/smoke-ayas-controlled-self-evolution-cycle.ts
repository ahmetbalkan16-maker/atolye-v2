import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { readAyasControlledEvolutionRegister, resolveAyasControlledEvolutionRegisterFile,
  runAyasControlledSelfEvolutionCycle } from "../src/lib/ayas/evolution/AyasControlledSelfEvolutionCycle";
import { createAyasEvolutionRegister, normalizeAyasEvolutionOpportunity, type AyasEvolutionOpportunityInput } from "../src/lib/ayas/evolution/AyasEvolutionOpportunity";
import { planAyasControlledSelfEvolution } from "../src/lib/ayas/evolution/AyasControlledSelfEvolution";
import { qualifyAyasEvolutionRegister } from "../src/lib/ayas/evolution/AyasEvolutionQualification";
import { AYAS_DEFAULT_IMPROVEMENT_REGISTRY } from "../src/lib/brain/autonomy/AyasResearchExperimentRegistry";
import { inventoryAyasCapabilities } from "../src/lib/ayas/routing/AyasAgenticRouting";
import { createFixtureRepo, behaviorStrategy, FIXTURE_NOW, FIXTURE_BEHAVIOR_FILE, renderBehavior } from "./fixtures/ayas-research-improvement-fixtures";
import { createAyasResearchExperimentStore } from "../src/lib/brain/autonomy/AyasResearchExperimentStore";
import { createAyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { measureAyasLocalGapSnapshot } from "../src/lib/brain/autonomy/AyasResearchImprovementCycle";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { reviewAyasPendingProposals } from "../src/lib/brain/autonomy/AyasAutonomousReview";

const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-evolution-cycle-test-"));
const HEAD = "1".repeat(40);
const register = createAyasEvolutionRegister();
const observation = { now: "2026-09-28T00:00:00.000Z", branch: "main", head: HEAD, repoClean: true,
  graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] };
const forbidden = new Proxy({}, { get: () => { throw new Error("CLOSED_GATE_TOUCHED_STORE"); } });
const fakeRegistry = { ...AYAS_DEFAULT_IMPROVEMENT_REGISTRY, strategies: [{ strategyId: "fixture-only" }] } as unknown as typeof AYAS_DEFAULT_IMPROVEMENT_REGISTRY;
const opportunityId = "ayas-evo-" + "a".repeat(32);
const evaluator = "2".repeat(64);
const strategy = { strategyId: "exp-fixture-context-continuity", version: 1, capability: "conversation-memory-context", benchmarkId: "cognitive-quality",
  dimensions: ["CONTEXT_CONTINUITY"], component: "AyasContextAssembly", summary: "fixture strategy", exactFiles: ["src/lib/brain/probe/BrainResourceProbe.ts"],
  maxChangedLines: 20, regressionSuites: ["scripts/smoke-ayas-context.ts"], generate: () => [] };
const activeRegistry = { ...AYAS_DEFAULT_IMPROVEMENT_REGISTRY, strategies: [strategy] };
const snapshot = { schemaVersion: "1" as const, benchmarkId: "cognitive-quality", evaluatorSha256: evaluator, measuredAtHead: HEAD,
  measuredAt: "2026-09-20T00:00:00.000Z", caseCount: 55, passed: 53, heldOut: { passed: 4, total: 5 }, dimensions: {},
  failing: [{ id: "ctx-older-correction", dimension: "CONTEXT_CONTINUITY", heldOut: false, knownLimitation: false }] };
const opportunityInput: AyasEvolutionOpportunityInput = {
  opportunityId, createdAt: "2026-09-01T00:00:00.000Z", origin: "LOCAL_EVALUATOR", kind: "IMPROVEMENT",
  need: { summary: "Older corrections are lost after summary truncation", consequences: ["Context continuity fails"] },
  evidence: [{ source: "EVALUATION_FAILURE", reference: "benchmark:cognitive-quality#ctx-older-correction", statement: "Older correction lost to summary truncation.",
    benchmark: { benchmarkId: "cognitive-quality", dimension: "CONTEXT_CONTINUITY", caseIds: ["ctx-older-correction"], measuredAtHead: HEAD, evaluatorSha256: evaluator } }],
  target: { capability: { key: "memory.older-correction-recall", domain: "memory-context", knownCategory: "MEMORY_CONTEXT", capabilityClass: "OTHER",
    inputs: [{ kind: "TEXT" }], outputs: [{ kind: "TEXT" }], sideEffects: ["READS_LOCAL_FILES"], resources: [{ kind: "FREE_LOCAL", costClass: "local-zero-cost" }], trustLevel: "FIRST_PARTY_REVIEWED" },
    intendedOutcome: "Preserve older corrections", nonGoals: ["No automatic publication"] },
  prerequisites: [], impact: { affectedModules: ["src/lib/brain/probe/BrainResourceProbe.ts"], compatibility: "BACKWARD_COMPATIBLE" },
  risk: Object.fromEntries(["security", "privacy", "dataMutation", "execution", "externalDependency", "cost", "irreversibility", "authorityWidening"].map((dimension) => [dimension, "LOW"])),
  evaluation: { baselineStrategy: "EXISTING_BENCHMARK", benchmarkId: "cognitive-quality", acceptanceCriteria: ["Target case passes"], heldOutCriteria: ["Held-out count does not drop"], regressionSuites: ["scripts/smoke-ayas-cognitive-quality.ts"] },
};
let passed = 0;
async function expect(name: string, task: () => void | Promise<void>): Promise<void> {
  try { await task(); passed++; } catch (error) { throw new Error(`controlled evolution cycle ${name} failed`, { cause: error }); }
}

async function main(): Promise<void> {
  try {
    const file = path.join(root, "register.json");
    fs.writeFileSync(file, JSON.stringify(register));
    await expect("canonical empty register", () => assert.deepEqual(readAyasControlledEvolutionRegister(file), register));
    await expect("optional source absent", () => assert.equal(resolveAyasControlledEvolutionRegisterFile(root, undefined), null));
    await expect("relative source resolved", () => assert.equal(resolveAyasControlledEvolutionRegisterFile(root, "register.json"), file));
    await expect("unknown top-level field refused", () => {
      fs.writeFileSync(file, JSON.stringify({ ...register, executionAuthority: "APPROVED" }));
      assert.throws(() => readAyasControlledEvolutionRegister(file), /FIELDS_INVALID/);
    });
    await expect("unknown schema refused", () => {
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: "2", opportunities: [] }));
      assert.throws(() => readAyasControlledEvolutionRegister(file));
    });
    await expect("malformed JSON refused", () => {
      fs.writeFileSync(file, "{"); assert.throws(() => readAyasControlledEvolutionRegister(file));
    });
    await expect("oversize refused", () => {
      fs.writeFileSync(file, " ".repeat(2 * 1024 * 1024 + 1));
      assert.throws(() => readAyasControlledEvolutionRegister(file), /SIZE_INVALID/);
    });
    const base = { repoRoot: root, observation, register, inbox: forbidden as never,
      experimentStore: forbidden as never, artifactStore: forbidden as never, remainingMs: () => 100_000 };
    await expect("unregistered strategy touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle(base), null));
    await expect("dirty repo touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...base, registry: fakeRegistry, observation: { ...observation, repoClean: false } }), null));
    await expect("stale Graphify touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...base, registry: fakeRegistry, observation: { ...observation, graphifyFresh: false } }), null));
    await expect("machine THROTTLE touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...base, registry: fakeRegistry, observation: { ...observation, machineAction: "THROTTLE" as const } }), null));
    await expect("short budget touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...base, registry: fakeRegistry, remainingMs: () => 1 }), null));
    await expect("invalid HEAD touches no store", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...base, registry: fakeRegistry, observation: { ...observation, head: "bad" } }), null));
    const measuredRegister = createAyasEvolutionRegister([normalizeAyasEvolutionOpportunity(opportunityInput)]);
    await expect("measured register really is eligible", () => assert.ok(planAyasControlledSelfEvolution({ register: measuredRegister,
      environment: { now: "2026-09-20T00:00:00.000Z", currentHead: HEAD, capabilities: inventoryAyasCapabilities({ availableModelIds: [] }),
        operatingMode: "UNKNOWN", improvementRegistry: activeRegistry, gapSnapshots: [snapshot] } }).candidate));
    const prior = { mutationKind: "patch-artifact:v1", sourceReference: opportunityId, baseHead: HEAD, status: "REJECTED" };
    const dedupeInput = { ...base, register: measuredRegister, registry: activeRegistry,
      now: () => "2026-09-20T00:00:00.000Z", experimentStore: { ...forbidden, listGapSnapshots: () => [snapshot] } as never,
      inbox: { load: () => ({ proposals: [prior] }) } as never };
    await expect("owner rejected opportunity not replayed", async () => assert.equal(await runAyasControlledSelfEvolutionCycle(dedupeInput), null));
    await expect("pending opportunity not duplicated", async () => assert.equal(await runAyasControlledSelfEvolutionCycle({ ...dedupeInput,
      inbox: { load: () => ({ proposals: [{ ...prior, status: "PENDING" }] }) } as never }), null));
    const repo = createFixtureRepo();
    const storeRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-evolution-cycle-state-"));
    try {
      const safeFile = "src/lib/brain/probe/BrainResourceProbe.ts";
      fs.mkdirSync(path.join(repo.root, path.dirname(safeFile)), { recursive: true });
      fs.copyFileSync(path.join(repo.root, FIXTURE_BEHAVIOR_FILE), path.join(repo.root, safeFile));
      for (const script of ["scripts/fixture-benchmark.ts", "scripts/smoke-fixture-guard.ts"]) {
        const file = path.join(repo.root, script);
        fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("../src/fixture/behavior", "../src/lib/brain/probe/BrainResourceProbe"));
      }
      fs.copyFileSync(path.join(repo.root, "scripts/fixture-benchmark.ts"), path.join(repo.root, "scripts/smoke-ayas-cognitive-quality.ts"));
      execFileSync("git", ["add", "-A"], { cwd: repo.root, windowsHide: true });
      execFileSync("git", ["commit", "--quiet", "-m", "move fixture behavior to safe scope"], { cwd: repo.root, windowsHide: true });
      const head = repo.head();
      const registered = { ...behaviorStrategy("cycle-run", { "ref-follow-up": true, "ref-ordinal": true }), benchmarkId: "cognitive-quality", exactFiles: [safeFile],
        generate: (context: { readonly readFile: (file: string) => string | null }) => {
          const current = context.readFile(safeFile);
          if (!current) return [];
          const base = JSON.parse(current.slice(current.indexOf("{"), current.lastIndexOf("}") + 1)) as Record<string, boolean | string>;
          return [{ filePath: safeFile, content: renderBehavior({ ...base, "ref-follow-up": true, "ref-ordinal": true }) }];
        } };
      const fixture = { ...AYAS_DEFAULT_IMPROVEMENT_REGISTRY, strategies: [registered] };
      const measured = await measureAyasLocalGapSnapshot({ repoRoot: repo.root, head, benchmark: fixture.benchmarks[0]!, timeoutMs: 20_000,
        nodeModulesDir: path.join(process.cwd(), "node_modules"), nowIso: FIXTURE_NOW });
      assert.ok(measured);
      const fixtureOpportunity = normalizeAyasEvolutionOpportunity({ ...opportunityInput, opportunityId: "ayas-evo-" + "b".repeat(32),
        createdAt: FIXTURE_NOW, evidence: [{ source: "EVALUATION_FAILURE", reference: "benchmark:cognitive-quality#ref-follow-up",
          statement: "A fixture reference is lost", benchmark: { benchmarkId: "cognitive-quality", dimension: "REFERENCE_RESOLUTION",
            caseIds: ["ref-follow-up", "ref-ordinal"], measuredAtHead: head, evaluatorSha256: measured.evaluatorSha256 } }],
        impact: { affectedModules: [safeFile], compatibility: "BACKWARD_COMPATIBLE" },
        evaluation: { baselineStrategy: "EXISTING_BENCHMARK", benchmarkId: "cognitive-quality", acceptanceCriteria: ["Reference cases pass"],
          heldOutCriteria: ["Held-out count does not drop"], regressionSuites: [registered.regressionSuites[0]!] } });
      const experimentStore = createAyasResearchExperimentStore({ rootDir: path.join(storeRoot, "experiments") });
      experimentStore.writeGapSnapshot(measured, 20);
      const artifactStore = createAyasPatchArtifactStore({ rootDir: path.join(storeRoot, "artifacts") });
      const inbox = createAyasApprovalInboxStore({ rootDir: path.join(storeRoot, "inbox") });
      const cycle = { repoRoot: repo.root, observation: { ...observation, now: FIXTURE_NOW, head },
        register: createAyasEvolutionRegister([fixtureOpportunity]), registry: fixture, experimentStore, artifactStore, inbox,
        nodeModulesDir: path.join(process.cwd(), "node_modules"), now: () => FIXTURE_NOW, remainingMs: () => 120_000 };
      const fixtureEnvironment = { now: FIXTURE_NOW, currentHead: head, capabilities: inventoryAyasCapabilities({ availableModelIds: [] }),
        operatingMode: "UNKNOWN" as const, improvementRegistry: fixture, gapSnapshots: [measured] };
      const fixturePlan = planAyasControlledSelfEvolution({ register: cycle.register, environment: fixtureEnvironment });
      assert.ok(fixturePlan.candidate, JSON.stringify(qualifyAyasEvolutionRegister(cycle.register, fixtureEnvironment)[0]));
      let candidate: Awaited<ReturnType<typeof runAyasControlledSelfEvolutionCycle>> = null;
      await expect("real TEMP experiment yields verified candidate", async () => {
        candidate = await runAyasControlledSelfEvolutionCycle(cycle);
        assert.ok(candidate);
        assert.equal(candidate.mutationKind, "patch-artifact:v1");
        assert.equal(candidate.sourceReference, fixtureOpportunity.opportunityId);
        assert.ok(candidate.patchArtifactId);
        assert.ok(candidate.patchHash);
        const records = experimentStore.listExperiments();
        assert.equal(records.length, 1);
        assert.equal(records[0]?.verdict, "IMPROVED");
        assert.equal(inbox.load().proposals.length, 0);
      });
      await expect("frozen artifact replay does not rerun experiment", async () => {
        const replay = await runAyasControlledSelfEvolutionCycle(cycle);
        assert.equal(replay?.patchArtifactId, candidate?.patchArtifactId);
        assert.equal(experimentStore.listExperiments().length, 1);
      });
      await expect("existing owner-flow proposal blocks duplicate", async () => {
        const daemon = createAyasAutonomyDaemon({ inbox, repoRoot: repo.root, now: () => FIXTURE_NOW });
        daemon.observe(cycle.observation);
        const proposed = daemon.discover(cycle.observation, [candidate!]);
        assert.equal(proposed.length, 1);
        assert.equal(proposed[0]?.status, "PENDING");
        assert.equal(await runAyasControlledSelfEvolutionCycle(cycle), null);
        assert.equal(experimentStore.listExperiments().length, 1);
        assert.equal(inbox.load().decisions.length, 0);
        const review = reviewAyasPendingProposals(inbox, () => FIXTURE_NOW);
        assert.equal(review.recommended.length, 0, "unresolved impact must not become owner approval");
        assert.equal(review.deferred.length, 1);
      });
    } finally {
      repo.remove();
      const temp = fs.realpathSync(os.tmpdir());
      if (!path.resolve(storeRoot).startsWith(`${temp}${path.sep}`)) throw new Error("TEMP_CLEANUP_PATH_OUTSIDE_ROOT");
      fs.rmSync(storeRoot, { recursive: true, force: true });
    }
    console.log(`PASS (${passed} controlled evolution source and closed-gate cases)`);
  } finally {
    const temp = fs.realpathSync(os.tmpdir());
    if (!path.resolve(root).startsWith(`${temp}${path.sep}`)) throw new Error("TEMP_CLEANUP_PATH_OUTSIDE_ROOT");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
