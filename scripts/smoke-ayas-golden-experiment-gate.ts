/**
 * Stage 15O.2 — the golden vault inside the improvement flow: baseline -> candidate -> held-out -> golden regression -> review.
 * Real experiments in TEMP fixture repositories and TEMP stores; the repository is only read. No model, provider or network.
 *
 * AYAS_GOLDEN_GATE_ONLY=<key,key> runs some scenarios only (the negative-control suite uses it); without it every one runs.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ayasGoldenVaultDigest, evaluateAyasGoldenRegression, type AyasGoldenRegressionResult, type AyasGoldenVault } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import {
  ayasExperimentEvidenceGoldenHeld, compareAyasExperimentBeforeGolden, evaluateAyasExperiment, hashAyasExperimentEvidence, verifyAyasExperimentEvidence,
  type AyasBenchmarkMeasurement, type AyasExperimentEvaluationInput, type AyasExperimentEvidence,
} from "../src/lib/brain/autonomy/AyasResearchExperimentEvaluation";
import { AYAS_GOLDEN_CASE_MIN_START_MS, createAyasResearchExperimentSandbox, destroyAyasResearchExperimentSandbox, runAyasGoldenVaultInSandbox } from "../src/lib/brain/autonomy/AyasResearchExperimentSandbox";
import { createAyasResearchExperimentStore, type AyasExperimentRecord } from "../src/lib/brain/autonomy/AyasResearchExperimentStore";
import { measureAyasLocalGapSnapshot, runAyasResearchImprovementCycle } from "../src/lib/brain/autonomy/AyasResearchImprovementCycle";
import { AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, buildAyasImprovementHypothesis } from "../src/lib/brain/autonomy/AyasResearchImprovementLoop";
import { discoverAyasResearchExperimentProposalCandidates } from "../src/lib/brain/autonomy/AyasResearchProposalBridge";
import { runAyasRegisteredImprovementExperiment } from "../src/lib/brain/autonomy/AyasRegisteredImprovementExperiment";
import { fixtureGoldenVault, heldGoldenEvidence } from "./fixtures/ayas-golden-fixtures";
import { behaviorStrategy, createFixtureRepo, FIXTURE_BASE_BEHAVIOR, FIXTURE_NOW, fixtureRegistry, tempDir, type FixtureRepo } from "./fixtures/ayas-research-improvement-fixtures";

const NODE_MODULES = path.join(process.cwd(), "node_modules");
const OPPORTUNITY_ID = `ayas-evo-${"a".repeat(32)}`;
const GUARD = "scripts/smoke-fixture-guard.ts";
const GOLDEN = "scripts/smoke-fixture-golden.ts";
/** A second suite of the fixture repository that no strategy lists as a regression suite: only the vault runs it. */
const GOLDEN_SOURCE = `import fs from "node:fs";
import { behavior } from "../src/fixture/behavior";
if (behavior.goldenWrites === true) fs.writeFileSync("src/fixture/golden-cache.txt", "cache");
if (behavior.goldenBroken === true) { console.error("golden case failed"); process.exitCode = 1; } else console.log("PASS (1 scenario)");
`;
const only = (process.env.AYAS_GOLDEN_GATE_ONLY ?? "").split(",").map((key) => key.trim()).filter(Boolean);
let count = 0;
async function scenario(key: string, name: string, run: () => void | Promise<void>) {
  if (only.length > 0 && !only.includes(key)) return;
  await run(); count++;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: [${key}] ${name}`);
}

interface Outcome { readonly verdict: string; readonly reasonCodes: readonly string[]; readonly evidence: AyasExperimentEvidence; readonly evidenceHash: string; readonly retained: boolean; readonly head: string; readonly vault: AyasGoldenVault; readonly store: ReturnType<typeof createAyasResearchExperimentStore> }

/** One real experiment in a fresh fixture repository: benchmark, regression suite, the change, and whatever the flow does after. */
async function experiment(options: { readonly behavior?: Readonly<Record<string, boolean | string>>; readonly overrides: Readonly<Record<string, boolean | string>>;
  readonly vault?: (repo: FixtureRepo) => AyasGoldenVault | undefined; readonly afterVault?: (repo: FixtureRepo) => void }, inspect: (outcome: Outcome, repo: FixtureRepo) => void | Promise<void>): Promise<void> {
  const repo = createFixtureRepo(options.behavior ?? FIXTURE_BASE_BEHAVIOR); const storeDir = tempDir("ayas-golden-gate-store-");
  try {
    repo.commit(GOLDEN, GOLDEN_SOURCE, "golden fixture suite");
    const vault = options.vault ? options.vault(repo) : fixtureGoldenVault(repo.root, [GUARD, GOLDEN]);
    options.afterVault?.(repo);
    const head = repo.head(); const store = createAyasResearchExperimentStore({ rootDir: storeDir });
    const strategy = behaviorStrategy("golden-gate", options.overrides);
    const benchmark = fixtureRegistry([strategy]).benchmarks[0]!;
    const snapshot = await measureAyasLocalGapSnapshot({ repoRoot: repo.root, head, benchmark, timeoutMs: 20_000, nodeModulesDir: NODE_MODULES, nowIso: FIXTURE_NOW });
    assert.ok(snapshot, "the fixture HEAD must have a measured gap");
    const hypothesis = buildAyasImprovementHypothesis({ status: "MAPPED", capability: strategy.capability, component: strategy.component, benchmarkId: benchmark.benchmarkId,
      dimension: "REFERENCE_RESOLUTION", targetCaseIds: ["ref-follow-up", "ref-ordinal"], snapshot }, strategy, []);
    const record: AyasExperimentRecord = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId: `ayas-experiment-${crypto.randomUUID()}`, hypothesisId: hypothesis.hypothesisId,
      attemptKey: crypto.randomBytes(32).toString("hex"), attempt: 1, baseHead: head, strategyId: strategy.strategyId, strategyVersion: strategy.version, inputsDigest: "c".repeat(64), status: "RESERVED",
      reservedAt: FIXTURE_NOW, updatedAt: FIXTURE_NOW, owner: { pid: process.pid, processStartEpochMs: Date.now() - 1_000, runId: crypto.randomUUID() }, leaseExpiresAt: "2026-09-22T00:00:00.000Z" };
    store.writeExperiment(record);
    const result = await runAyasRegisteredImprovementExperiment({ deps: { repoRoot: repo.root, nodeModulesDir: NODE_MODULES, ...(vault ? { goldenVault: vault } : {}) },
      observation: { now: FIXTURE_NOW, head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" }, store, record, hypothesis, strategy, benchmark,
      sourceIds: [], sourceBindings: [{ kind: "EVOLUTION_OPPORTUNITY", id: OPPORTUNITY_ID }], remainingMs: () => 120_000, clock: () => FIXTURE_NOW });
    const evidenceHash = result.record.evidenceHash!; const evidence = store.readEvidence(evidenceHash)!;
    assert.ok(evidence && verifyAyasExperimentEvidence(evidence, evidenceHash), "the runner's own evidence verifies");
    assert.equal(evidence.verdict, result.verdict); assert.equal(evidence.risk.sandboxDiscarded, true); assert.equal(evidence.risk.liveWorkspaceUnchanged, true);
    await inspect({ verdict: result.verdict, reasonCodes: result.reasonCodes, evidence, evidenceHash, retained: result.retainedSource !== undefined, head, vault: vault ?? AYAS_GOLDEN_VAULT, store }, repo);
  } finally { repo.remove(); fs.rmSync(storeDir, { recursive: true, force: true }); }
}
const IMPROVE = { "ref-follow-up": true, "ref-ordinal": true } as const;
const proposals = (outcome: Outcome) => discoverAyasResearchExperimentProposalCandidates([{ evidence: outcome.evidence, evidenceHash: outcome.evidenceHash }], [], outcome.head).length;

/** A comparison that everything before the vault calls improved: two target cases fixed, nothing else moved. */
function improvedInput(): AyasExperimentEvaluationInput {
  const measurement = (failing: readonly string[]): AyasBenchmarkMeasurement => ({ benchmarkId: "fixture-quality", evaluatorSha256: "2".repeat(64), caseCount: 4, passed: 4 - failing.length, heldOut: { passed: 1, total: 1 },
    dimensions: { REFERENCE_RESOLUTION: { passed: 3 - failing.length, total: 3 } }, failing: failing.map((id) => ({ id, dimension: "REFERENCE_RESOLUTION", heldOut: false, knownLimitation: false })), durationMs: 10 });
  const strategy = behaviorStrategy("pure", IMPROVE, { regressionSuites: [GUARD] });
  const snapshot = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, benchmarkId: "fixture-quality", evaluatorSha256: "2".repeat(64), measuredAtHead: "1".repeat(40), measuredAt: FIXTURE_NOW,
    caseCount: 4, passed: 2, heldOut: { passed: 1, total: 1 }, dimensions: {}, failing: [{ id: "ref-follow-up", dimension: "REFERENCE_RESOLUTION", heldOut: false, knownLimitation: false }, { id: "ref-ordinal", dimension: "REFERENCE_RESOLUTION", heldOut: false, knownLimitation: false }] };
  const hypothesis = buildAyasImprovementHypothesis({ status: "MAPPED", capability: strategy.capability, component: strategy.component, benchmarkId: "fixture-quality", dimension: "REFERENCE_RESOLUTION", targetCaseIds: ["ref-follow-up", "ref-ordinal"], snapshot }, strategy, []);
  const suite = { script: GUARD, pass: true, timedOut: false, durationMs: 5 };
  return { hypothesis, baseline: { ok: true, measurement: measurement(["ref-follow-up", "ref-ordinal"]) }, experiment: { ok: true, measurement: measurement([]) }, baselineSuites: [suite], experimentSuites: [suite] };
}
/** A two-case vault and the decisions it can give, built by the gate itself. */
function goldenDecisions() {
  const vault: AyasGoldenVault = { schemaVersion: "1", version: 1, previousDigest: null,
    cases: (["CONVERSATION", "MEMORY_RETRIEVAL"] as const).map((domain, index) => ({ id: `golden.fixture.case-${index + 1}`, domain, script: `scripts/smoke-fixture-${index + 1}.ts`, covers: "fixture", pins: [{ file: `scripts/smoke-fixture-${index + 1}.ts`, sha256: "a".repeat(64) }] })),
    gaps: (["CODING_REPAIR", "SECURITY_ADVERSARIAL", "PRODUCTION_RECOVERY", "HISTORICAL_VIDEO", "REVENUE_DRY_RUN", "BRAIN_UI"] as const).map((domain) => ({ domain, missing: "fixture", reevaluateWhen: "never" })) };
  const run = (red: readonly string[] = []) => ({ vaultDigest: ayasGoldenVaultDigest(vault), pinDrift: [], results: vault.cases.map((item) => ({ id: item.id, pass: !red.includes(item.id), timedOut: false })) });
  const second = vault.cases[1]!.id;
  return { vault, second,
    held: evaluateAyasGoldenRegression({ vault, candidate: run() }),
    regressed: evaluateAyasGoldenRegression({ vault, candidate: run([second]), baseline: { ...run(), results: [{ id: second, pass: true, timedOut: false }] } }),
    redBefore: evaluateAyasGoldenRegression({ vault, candidate: run([second]), baseline: { ...run(), results: [{ id: second, pass: false, timedOut: false }] } }),
    unknownBefore: evaluateAyasGoldenRegression({ vault, candidate: run([second]) }),
    notMeasured: evaluateAyasGoldenRegression({ vault, candidate: { ...run(), results: run().results.slice(1) } }),
    moved: evaluateAyasGoldenRegression({ vault, candidate: { ...run(), pinDrift: [vault.cases[0]!.script] } }) };
}

async function main(): Promise<void> {
  await scenario("verdict", "the vault can only take IMPROVED away, and only a held vault leaves it standing", () => {
    const input = improvedInput(); const golden = goldenDecisions();
    assert.equal(compareAyasExperimentBeforeGolden(input).verdict, "IMPROVED");
    const verdict = (value: AyasGoldenRegressionResult | null | undefined) => { const result = evaluateAyasExperiment({ ...input, ...(value === undefined ? {} : { golden: value }) }); return [result.verdict, result.reasonCodes]; };
    assert.deepEqual(verdict(golden.held), ["IMPROVED", ["TARGET_IMPROVED"]]);
    // One metric improved and a golden case the change broke: promotion stops as a regression.
    assert.deepEqual(verdict(golden.regressed), ["REGRESSED", ["GOLDEN_REGRESSION"]]);
    assert.deepEqual(verdict(golden.redBefore), ["INCONCLUSIVE", ["GOLDEN_NOT_HELD"]]);
    assert.deepEqual(verdict(golden.unknownBefore), ["INCONCLUSIVE", ["GOLDEN_NOT_HELD"]]);
    assert.deepEqual(verdict(golden.notMeasured), ["INCONCLUSIVE", ["GOLDEN_NOT_MEASURED"]]);
    assert.deepEqual(verdict(golden.moved), ["INVALID_EXPERIMENT", ["GOLDEN_VAULT_CHANGED"]]);
    // No answer is not a held answer, and neither is one that only says so.
    for (const missing of [undefined, null, "GOLDEN_HELD" as unknown as AyasGoldenRegressionResult, { ...golden.held, authority: "OWNER" } as unknown as AyasGoldenRegressionResult,
      { ...golden.held, failingCaseIds: [golden.second] }, { ...golden.held, cases: 0 }, { ...golden.held, vaultDigest: null }, { ...golden.held, decision: "APPROVED" } as unknown as AyasGoldenRegressionResult]) {
      assert.deepEqual(verdict(missing), ["INCONCLUSIVE", ["GOLDEN_NOT_MEASURED"]], JSON.stringify(missing)?.slice(0, 80));
    }
    // The measured numbers stay what they were; only the verdict and its reason change.
    const stopped = evaluateAyasExperiment({ ...input, golden: golden.regressed }); assert.deepEqual([stopped.targetGain, stopped.fixedCaseIds, stopped.newlyFailingCaseIds], [2, ["ref-follow-up", "ref-ordinal"], []]);
    // A change that was not going to be promoted is not made better or worse by the vault.
    const neutral = { ...input, experiment: input.baseline }; assert.equal(compareAyasExperimentBeforeGolden(neutral).verdict, "NEUTRAL");
    for (const value of [golden.held, golden.regressed, golden.moved, null]) assert.equal(evaluateAyasExperiment({ ...neutral, golden: value }).verdict, "NEUTRAL");
    const failedSuite = { ...input, experimentSuites: [{ script: GUARD, pass: false, timedOut: false, durationMs: 5 }] };
    assert.deepEqual([evaluateAyasExperiment({ ...failedSuite, golden: golden.held }).verdict, evaluateAyasExperiment({ ...failedSuite, golden: golden.held }).reasonCodes], ["REGRESSED", ["REGRESSION_SUITE_FAILED"]]);
    assert.equal(evaluateAyasExperiment({ ...input, golden: golden.held, abortCode: "SANDBOX_ESCAPE" }).verdict, "UNSAFE");
  });

  await scenario("evidence", "a golden block is well-formed, agrees with its verdict, and is held only against the vault it names", () => {
    const { vault } = goldenDecisions(); const held = heldGoldenEvidence(vault); const digest = ayasGoldenVaultDigest(vault);
    const base = { schemaVersion: AYAS_RESEARCH_IMPROVEMENT_SCHEMA_VERSION, experimentId: "ayas-experiment-fixture", attemptKey: "e".repeat(64), baseHead: "1".repeat(40), findingIds: [], sourceIds: [],
      hypothesis: improvedInput().hypothesis, baseline: null, experiment: null, environment: { node: "v0", platform: "fixture", arch: "fixture", tsx: null, typescript: null }, change: null,
      regressions: { newlyFailingCaseIds: [], heldOutDelta: 0, suites: [] }, performance: { baselineMs: null, experimentMs: null, ratio: null },
      risk: { riskClass: "REVIEW_REQUIRED", isolation: "fixture", liveWorkspaceUnchanged: true, sandboxDiscarded: true }, analysisRoute: null, verdict: "IMPROVED", reasonCodes: ["TARGET_IMPROVED"],
      targetGain: 2, fixedCaseIds: ["ref-follow-up", "ref-ordinal"], remainingTargetFailures: 0, completedAt: FIXTURE_NOW, authority: "NONE" } as unknown as AyasExperimentEvidence;
    const verifies = (evidence: AyasExperimentEvidence) => verifyAyasExperimentEvidence(evidence, hashAyasExperimentEvidence(evidence));
    const withGolden = (golden: unknown, over: Partial<AyasExperimentEvidence> = {}) => ({ ...base, golden, ...over }) as AyasExperimentEvidence;
    assert.ok(verifies(withGolden(held))); assert.ok(ayasExperimentEvidenceGoldenHeld(withGolden(held), digest, vault.cases.length));
    // Evidence from before the vault still verifies as what it is; it is simply not held.
    assert.ok(verifies(base)); assert.equal(ayasExperimentEvidenceGoldenHeld(base, digest, vault.cases.length), false);
    assert.equal(ayasExperimentEvidenceGoldenHeld(null, digest, vault.cases.length), false);
    // Held against another vault, or against fewer cases than the vault has, is not held against this one.
    assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden(held), "f".repeat(64), vault.cases.length), false);
    assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden(held), digest, vault.cases.length + 1), false);
    assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden({ ...held, cases: held.cases.slice(1) }), digest, vault.cases.length), false);
    assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden(held), "not-a-digest", vault.cases.length), false);
    const red = { ...held, decision: "PROMOTION_STOPPED", reasonCodes: ["GOLDEN_CASE_FAILED", "REGRESSED_BY_CHANGE"], cases: held.cases.map((row, index) => (index === 1 ? { ...row, pass: false } : row)), failingCaseIds: [held.cases[1]!.id], regressedCaseIds: [held.cases[1]!.id] };
    // A stopped block next to an IMPROVED verdict is a contradiction, whatever the hash says; next to the verdict it caused it is evidence.
    assert.equal(verifies(withGolden(red)), false); assert.ok(verifies(withGolden(red, { verdict: "REGRESSED", reasonCodes: ["GOLDEN_REGRESSION"] })));
    assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden(red, { verdict: "REGRESSED" }), digest, vault.cases.length), false);
    for (const [name, malformed] of Object.entries({
      extraField: { ...held, approved: true }, unknownDecision: { ...held, decision: "APPROVED" }, heldWithRedRow: { ...held, cases: held.cases.map((row, index) => (index === 0 ? { ...row, pass: false } : row)) },
      heldWithTimeout: { ...held, cases: held.cases.map((row, index) => (index === 0 ? { ...row, timedOut: true } : row)) }, heldWithNoCases: { ...held, cases: [] }, heldWithoutDigest: { ...held, vaultDigest: null },
      failingNotARow: { ...red, failingCaseIds: [held.cases[0]!.id] }, regressedNotFailing: { ...red, regressedCaseIds: [held.cases[0]!.id] }, duplicateRow: { ...held, cases: [held.cases[0], held.cases[0]] },
      rowExtraField: { ...held, cases: held.cases.map((row) => ({ ...row, note: "x" })) }, scriptOutsideScripts: { ...held, cases: held.cases.map((row) => ({ ...row, script: "src/run-live.ts" })) }, notAnObject: "GOLDEN_HELD", array: [held],
    })) {
      assert.equal(verifies(withGolden(malformed, { verdict: "NEUTRAL" })), false, name); assert.equal(ayasExperimentEvidenceGoldenHeld(withGolden(malformed), digest, vault.cases.length), false, name);
    }
  });

  await scenario("held", "an improvement that leaves every golden case green is IMPROVED, with the vault's answer in its evidence", async () => {
    await experiment({ overrides: IMPROVE }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes, outcome.retained], ["IMPROVED", ["TARGET_IMPROVED"], true]);
      assert.ok(outcome.evidence.golden, "the evidence carries no golden block"); const golden = outcome.evidence.golden;
      assert.deepEqual([golden.decision, golden.reasonCodes, golden.vaultVersion, golden.vaultDigest, golden.failingCaseIds, golden.regressedCaseIds], ["GOLDEN_HELD", ["ALL_GOLDEN_CASES_HELD"], 1, ayasGoldenVaultDigest(outcome.vault), [], []]);
      // The guard suite is also the regression suite: its result in this tree is reused, not run a second time.
      assert.deepEqual(golden.cases, [{ id: "golden.fixture.case-1", script: GUARD, pass: true, timedOut: false, reused: true }, { id: "golden.fixture.case-2", script: GOLDEN, pass: true, timedOut: false, reused: false }]);
      assert.deepEqual(golden.gapDomains, outcome.vault.gaps.map((gap) => gap.domain)); assert.equal(golden.gapDomains.length, 6);
      assert.ok(ayasExperimentEvidenceGoldenHeld(outcome.evidence, ayasGoldenVaultDigest(outcome.vault), outcome.vault.cases.length));
      assert.equal(ayasExperimentEvidenceGoldenHeld(outcome.evidence, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT), AYAS_GOLDEN_VAULT.cases.length), false, "held against the fixture vault is not held against the vault of record");
      assert.equal(proposals(outcome), 1);
      assert.equal(outcome.evidence.authority, "NONE");
    });
  });

  await scenario("regressed", "one metric improves and the change breaks a golden case: REGRESSED, nothing retained, nothing proposed", async () => {
    await experiment({ overrides: { ...IMPROVE, goldenBroken: true } }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes, outcome.retained], ["REGRESSED", ["GOLDEN_REGRESSION"], false]);
      // Everything before the vault said improved: both targets fixed, no case lost, the regression suite green.
      assert.deepEqual([outcome.evidence.targetGain, outcome.evidence.regressions.newlyFailingCaseIds, outcome.evidence.regressions.heldOutDelta, outcome.evidence.regressions.suites], [2, [], 0, [{ script: GUARD, baselinePass: true, experimentPass: true }]]);
      assert.ok(outcome.evidence.golden, "the evidence carries no golden block"); const golden = outcome.evidence.golden;
      assert.deepEqual([golden.decision, golden.failingCaseIds, golden.regressedCaseIds, golden.reasonCodes], ["PROMOTION_STOPPED", ["golden.fixture.case-2"], ["golden.fixture.case-2"], ["GOLDEN_CASE_FAILED", "REGRESSED_BY_CHANGE"]]);
      assert.deepEqual(golden.cases.map((row) => [row.id, row.pass]), [["golden.fixture.case-1", true], ["golden.fixture.case-2", false]]);
      assert.equal(ayasExperimentEvidenceGoldenHeld(outcome.evidence, ayasGoldenVaultDigest(outcome.vault), outcome.vault.cases.length), false);
      assert.equal(proposals(outcome), 0); assert.equal(outcome.store.readExperiment(outcome.evidence.experimentId)?.verdict, "REGRESSED");
    });
  });

  await scenario("red-before", "a golden case that was already red is not blamed on the change, and still nothing is promoted", async () => {
    await experiment({ behavior: { ...FIXTURE_BASE_BEHAVIOR, goldenBroken: true }, overrides: IMPROVE }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes, outcome.retained], ["INCONCLUSIVE", ["GOLDEN_NOT_HELD"], false]);
      assert.ok(outcome.evidence.golden, "the evidence carries no golden block"); const golden = outcome.evidence.golden;
      assert.deepEqual([golden.decision, golden.failingCaseIds, golden.regressedCaseIds, golden.reasonCodes], ["PROMOTION_STOPPED", ["golden.fixture.case-2"], [], ["GOLDEN_CASE_FAILED", "NOT_GOLDEN_AT_BASELINE"]]);
      assert.equal(proposals(outcome), 0);
    });
  });

  await scenario("moved", "a vault whose pinned bytes are not the ones in the tree measures nothing", async () => {
    // The vault was pinned, then the golden suite's bytes changed: the yardstick is not the one that was frozen.
    await experiment({ overrides: IMPROVE, afterVault: (repo) => { repo.commit(GOLDEN, `${GOLDEN_SOURCE}// weakened after the vault was pinned\n`, "golden suite edited"); } }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes, outcome.retained], ["INVALID_EXPERIMENT", ["GOLDEN_VAULT_CHANGED"], false]);
      assert.ok(outcome.evidence.golden, "the evidence carries no golden block"); const golden = outcome.evidence.golden;
      assert.deepEqual([golden.decision, golden.reasonCodes, golden.cases, golden.failingCaseIds], ["GOLDEN_VAULT_CHANGED", ["CANDIDATE_PIN_DRIFT"], [], []]);
      assert.equal(proposals(outcome), 0);
    });
  });

  await scenario("record", "without an injected vault the vault of record is asked, and a tree that does not hold it is not improved", async () => {
    await experiment({ overrides: IMPROVE, vault: () => undefined }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes], ["INVALID_EXPERIMENT", ["GOLDEN_VAULT_CHANGED"]]);
      assert.ok(outcome.evidence.golden, "the evidence carries no golden block");
      assert.deepEqual([outcome.evidence.golden.vaultVersion, outcome.evidence.golden.vaultDigest, outcome.evidence.golden.reasonCodes], [AYAS_GOLDEN_VAULT.version, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT), ["CANDIDATE_PIN_DRIFT"]]);
    });
  });

  await scenario("escape", "a golden case that writes into the tree is the same breach as a benchmark that does", async () => {
    await experiment({ behavior: { ...FIXTURE_BASE_BEHAVIOR, goldenWrites: true }, overrides: IMPROVE }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes, outcome.retained], ["UNSAFE", ["SANDBOX_ESCAPE"], false]);
      assert.equal(proposals(outcome), 0);
    });
  });

  await scenario("not-asked", "a change the comparison does not call improved is not measured against the vault", async () => {
    // goldenBroken would stop a promotion; here nothing is being promoted, so the vault is not run and the verdict is what it was.
    await experiment({ overrides: { unrelated: true, goldenBroken: true } }, (outcome) => {
      assert.deepEqual([outcome.verdict, outcome.reasonCodes], ["NEUTRAL", ["NO_MEASURED_CHANGE"]]);
      assert.equal(outcome.evidence.golden, undefined); assert.equal(proposals(outcome), 0);
    });
  });

  await scenario("budget", "a case that cannot start inside the remaining time is left out, and an incomplete run is never held", async () => {
    const repo = createFixtureRepo(); let sandbox: Awaited<ReturnType<typeof createAyasResearchExperimentSandbox>> | undefined;
    try {
      repo.commit(GOLDEN, GOLDEN_SOURCE, "golden fixture suite");
      const vault = fixtureGoldenVault(repo.root, [GUARD, GOLDEN]);
      sandbox = await createAyasResearchExperimentSandbox({ repoRoot: repo.root, baseHead: repo.head(), nodeModulesDir: NODE_MODULES, timeoutMs: 60_000 });
      const reuse = [{ script: GUARD, pass: true, timedOut: false, durationMs: 1 }];
      const short = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse, caseTimeoutMs: () => 20_000, remainingMs: () => AYAS_GOLDEN_CASE_MIN_START_MS - 1 });
      // The reused result costs no time; the case that needed a run did not get one.
      assert.deepEqual([short.run.results, short.reusedCaseIds, short.run.pinDrift], [[{ id: "golden.fixture.case-1", pass: true, timedOut: false }], ["golden.fixture.case-1"], []]);
      assert.deepEqual([evaluateAyasGoldenRegression({ vault, candidate: short.run }).decision, evaluateAyasGoldenRegression({ vault, candidate: short.run }).reasonCodes], ["GOLDEN_NOT_MEASURED", ["CANDIDATE_RESULTS_INCOMPLETE"]]);
      const full = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse, caseTimeoutMs: () => 20_000, remainingMs: () => 60_000 });
      assert.deepEqual([full.run.results.map((result) => [result.id, result.pass]), evaluateAyasGoldenRegression({ vault, candidate: full.run }).decision], [[["golden.fixture.case-1", true], ["golden.fixture.case-2", true]], "GOLDEN_HELD"]);
      // A reused result is the suite's result: a regression suite that failed here is a red golden case.
      const failed = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse: [{ script: GUARD, pass: false, timedOut: false, durationMs: 1 }], caseTimeoutMs: () => 20_000, remainingMs: () => 60_000 });
      assert.deepEqual(evaluateAyasGoldenRegression({ vault, candidate: failed.run }).failingCaseIds, ["golden.fixture.case-1"]);
      // Asking about one case only answers for that case.
      const one = await runAyasGoldenVaultInSandbox(sandbox, vault, { caseTimeoutMs: () => 20_000, remainingMs: () => 60_000, onlyCaseIds: ["golden.fixture.case-2"] });
      assert.deepEqual(one.run.results, [{ id: "golden.fixture.case-2", pass: true, timedOut: false }]);
      // Drift first: with a pinned byte changed in the tree, no case is run at all.
      fs.appendFileSync(path.join(sandbox.repoDir, GOLDEN), "// changed in the tree\n");
      const drifted = await runAyasGoldenVaultInSandbox(sandbox, vault, { reuse, caseTimeoutMs: () => 20_000, remainingMs: () => 60_000 });
      assert.deepEqual([drifted.run.pinDrift, drifted.run.results, evaluateAyasGoldenRegression({ vault, candidate: drifted.run }).decision], [[GOLDEN], [], "GOLDEN_VAULT_CHANGED"]);
    } finally { if (sandbox) assert.equal(await destroyAyasResearchExperimentSandbox(sandbox), true); repo.remove(); }
  });

  await scenario("cycle", "the cycle offers evidence for a proposal only when it is held against the vault the cycle was given", async () => {
    await experiment({ overrides: IMPROVE }, async (outcome, repo) => {
      const cycle = (goldenVault?: AyasGoldenVault) => runAyasResearchImprovementCycle({ repoRoot: repo.root, store: outcome.store, registry: fixtureRegistry([]), findings: [], nodeModulesDir: NODE_MODULES, clock: () => FIXTURE_NOW,
        observation: { now: FIXTURE_NOW, head: outcome.head, repoClean: true, graphifyFresh: true, machineAction: "ALLOW" }, ...(goldenVault ? { goldenVault } : {}) });
      assert.deepEqual((await cycle(outcome.vault)).proposalEvidence.map((entry) => entry.evidenceHash), [outcome.evidenceHash]);
      // The same evidence, the vault of record: measured against another vault, so it proposes nothing.
      assert.deepEqual((await cycle()).proposalEvidence, []);
      // IMPROVED evidence from before the vault existed: it still verifies, and it proposes nothing either.
      const { golden: _golden, ...legacy } = outcome.evidence; void _golden;
      const legacyEvidence = { ...legacy, experimentId: `ayas-experiment-${crypto.randomUUID()}` } as AyasExperimentEvidence;
      const legacyHash = outcome.store.writeEvidence(legacyEvidence);
      assert.ok(verifyAyasExperimentEvidence(outcome.store.readEvidence(legacyHash), legacyHash));
      outcome.store.writeExperiment({ ...outcome.store.readExperiment(outcome.evidence.experimentId)!, experimentId: legacyEvidence.experimentId, attemptKey: "9".repeat(64), evidenceHash: legacyHash });
      assert.deepEqual((await cycle(outcome.vault)).proposalEvidence.map((entry) => entry.evidenceHash), [outcome.evidenceHash]);
      assert.equal(discoverAyasResearchExperimentProposalCandidates([{ evidence: legacyEvidence, evidenceHash: legacyHash }], [], outcome.head).length, 0);
    });
  });

  assert.ok(only.length === 0 ? count === 11 : count === only.length, `scenarios run: ${count}`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-experiment-gate", scenarios: count, ...(only.length > 0 ? { only } : {}), modelRuns: 0 }));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
