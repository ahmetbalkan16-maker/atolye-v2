import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import manifestJson from "../docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
import { gradeAyasEvalTrial, isAyasEvalManifest, summarizeAyasEvalTrials, verifyAyasEvalPins, type AyasEvalSuite, type AyasEvalTrial } from "../src/lib/ayas/observability/AyasEvalGovernance";

let count = 0;
function scenario(name: string, test: () => void) { test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
const candidate: unknown = manifestJson;
assert.ok(isAyasEvalManifest(candidate)); const manifest = candidate;
const cognitive = manifest.suites.find((suite) => suite.id === "cognitive-quality")!;
const developer = manifest.suites.find((suite) => suite.id === "developer-intelligence")!;
const regression = manifest.suites[0]!;
const grade = (suite: AyasEvalSuite, stdout: string, exitCode: number | null = 0) => gradeAyasEvalTrial(suite, { stdout, stderr: "private fixture body", exitCode, durationMs: 12 });
const limitation = { id: "heldout-free-text", knownLimitation: true, error: false };
const cognitiveReport = { caseCount: 55, passed: 54, heldOut: { passed: 4, total: 5 }, failures: [limitation], knownLimitations: [limitation], unexpectedFailures: [] };
const developerReport = { flow: { mainPass: "39/39", heldOut: "10/10" }, components: { safety: "5/5" }, componentHeldOut: "2/2", integration: "3/3" };

scenario("versioned manifest separates suite kinds, pins graders and exposes exclusions/calibration", () => {
  assert.equal(manifest.suites.length, 132); assert.equal(new Set(manifest.suites.map((s) => s.kind)).size, 3);
  for (const id of ["revenue-adapter-standard", "revenue-adapter-standard-mutations", "revenue-account-boundary", "revenue-account-boundary-mutations", "revenue-spend-policy", "revenue-spend-policy-mutations", "revenue-ledger", "revenue-ledger-mutations", "revenue-free-first-validation", "revenue-free-first-validation-mutations", "revenue-offer-factory", "revenue-offer-factory-mutations", "revenue-fulfillment-gate", "revenue-fulfillment-gate-mutations"])
    assert.ok(manifest.suites.some((suite) => suite.id === id), `missing declared suite ${id}`);
  for (const id of ["production-fault-repair", "production-fault-repair-mutations", "production-quality-gate", "production-quality-gate-mutations", "production-quality-collector", "production-quality-collector-mutations", "youtube-ready-export", "owner-constitution", "owner-constitution-mutations", "constitution-run-binding", "constitution-run-binding-mutations",
    "golden-vault", "golden-vault-operator", "golden-vault-mutations", "golden-vault-run", "golden-experiment-gate", "golden-experiment-gate-mutations", "golden-sandbox-run", "golden-video-projects", "golden-video-projects-mutations", "source-evidence", "source-evidence-mutations", "resource-governor", "resource-governor-mutations", "on-demand-lifecycle", "on-demand-lifecycle-mutations", "resource-occupancy", "resource-occupancy-mutations", "safe-mode", "safe-mode-mutations"]) assert.ok(manifest.suites.some((suite) => suite.id === id), `missing declared suite ${id}`);
  assert.equal(manifest.modelGrader, "NONE"); assert.equal(manifest.definitionReview, "SOURCE_REVIEWED_OWNER_CALIBRATION_PENDING"); assert.equal(manifest.excluded.length, 4);
  const files = new Set(manifest.suites.flatMap((s) => s.pins.map((p) => p.file)));
  assert.ok(files.has("scripts/lib/AyasRetrievalEvaluation.ts")); assert.ok(files.has("scripts/fixtures/ayas-retrieval-evaluation-cases.ts"));
  assert.deepEqual(verifyAyasEvalPins(manifest, (file) => fs.readFileSync(file)), []);
});
scenario("path escape, unknown fields, duplicate ids and weak grader args are rejected", () => {
  const first = manifest.suites[0]!;
  const variants = [null, {}, { ...manifest, granted: true }, { ...manifest, modelGrader: "AUTO_APPROVED" },
    { ...manifest, suites: [{ ...first, script: "scripts/../live.ts" }] }, { ...manifest, suites: [{ ...first, args: ["--baseline"] }] },
    { ...manifest, suites: [first, first] }, { ...manifest, suites: [{ ...first, pins: [] }] }, { ...manifest, suites: [{ ...first, pins: [{ file: "../secret", sha256: "a".repeat(64) }] }] }];
  for (const bad of variants) assert.equal(isAyasEvalManifest(bad), false);
});
scenario("missing or changed grader bytes refuse verification", () => {
  const file = manifest.suites[0]!.script;
  assert.ok(verifyAyasEvalPins(manifest, (name) => name === file ? Buffer.from("weakened assertion") : fs.readFileSync(name)).includes(file));
  assert.ok(verifyAyasEvalPins(manifest, () => { throw new Error("missing"); }).length > 0);
});
scenario("nonzero exit, timeout and missing structured grade never pass", () => {
  for (const code of [1, null]) assert.equal(grade(regression, "PASS", code).outcome, "FAIL");
  assert.equal(grade(cognitive, "PASS").outcome, "FAIL"); assert.equal(grade(developer, "PASS").outcome, "FAIL");
});
scenario("known quality limits are visible and distinct from complete success", () => {
  const result = grade(cognitive, JSON.stringify(cognitiveReport)); assert.equal(result.outcome, "PASS_WITH_KNOWN_LIMITATIONS");
  assert.deepEqual(result.quality, { passed: 54, total: 55, heldOutPassed: 4, heldOutTotal: 5, knownLimitations: ["heldout-free-text"] });
  assert.equal(JSON.stringify(result).includes("private fixture body"), false); assert.match(result.stderrDigest, /^[a-f0-9]{64}$/);
});
scenario("unexpected, errored or inconsistent known failures refuse even with exit zero", () => {
  for (const report of [{ ...cognitiveReport, unexpectedFailures: [{ id: "new-defect" }] }, { ...cognitiveReport, passed: 55 },
    { ...cognitiveReport, knownLimitations: [{ ...limitation, error: true }] }, { ...cognitiveReport, knownLimitations: [{ ...limitation, knownLimitation: false }] },
    { ...cognitiveReport, heldOut: { passed: 6, total: 5 } }, { ...cognitiveReport, caseCount: 0, passed: 0, failures: [], knownLimitations: [] }]) assert.equal(grade(cognitive, JSON.stringify(report)).outcome, "FAIL");
});
scenario("frozen held-out failures cannot hide behind the developer script's exit success", () => {
  assert.equal(grade(developer, JSON.stringify(developerReport) + "\nPASS fixture").outcome, "PASS");
  for (const report of [{ ...developerReport, flow: { mainPass: "39/39", heldOut: "9/10" } }, { ...developerReport, componentHeldOut: "1/2" }, { ...developerReport, components: {} }]) assert.equal(grade(developer, JSON.stringify(report)).outcome, "FAIL");
});
scenario("pass@1 and pass^k are empirical measurements, with unknown for missing trials", () => {
  const pass = grade(regression, "PASS"); const fail = grade(regression, "FAIL", 1);
  assert.deepEqual([summarizeAyasEvalTrials([pass, pass], 2).passAt1, summarizeAyasEvalTrials([pass, pass], 2).passPowerK], [1, 1]);
  assert.equal(summarizeAyasEvalTrials([pass, fail], 2).passPowerK, 0); assert.equal(summarizeAyasEvalTrials([pass], 2).status, "NOT_RUN");
  assert.equal(summarizeAyasEvalTrials([], 1).passAt1, null);
  assert.equal(summarizeAyasEvalTrials([{ ...pass, outcome: "NOT_RUN" } as AyasEvalTrial], 1).passPowerK, null);
  for (const k of [0, 4, NaN, 1.5]) assert.throws(() => summarizeAyasEvalTrials([], k), /BOUND_INVALID/);
});
scenario("known-limitation gate results never become raw quality PASS", () => {
  const trial = grade(cognitive, JSON.stringify(cognitiveReport)); const summary = summarizeAyasEvalTrials([trial], 1);
  assert.equal(summary.status, "PASS_WITH_KNOWN_LIMITATIONS"); assert.equal(summary.rawQualityPassedAllTrials, false);
});
scenario("governance is pure and the runner is an isolated developer operator only", () => {
  const pure = fs.readFileSync("src/lib/ayas/observability/AyasEvalGovernance.ts", "utf8"); assert.doesNotMatch(pure, /node:fs|child_process|Date\.now/);
  const script = fs.readFileSync("scripts/ayas-eval-baseline.ts", "utf8"); assert.match(script, /remote", "remove", "origin/); assert.match(script, /SOURCE_REPO_MUTATED/);
  assert.ok(!manifest.suites.some((s) => /live|autostart|local-coding/.test(s.id)));
  assert.equal(path.isAbsolute(regression.script), false);
});
console.log(`Stage 15F.4 eval governance: PASS (${count} scenarios; model/network/production actions 0)`);
