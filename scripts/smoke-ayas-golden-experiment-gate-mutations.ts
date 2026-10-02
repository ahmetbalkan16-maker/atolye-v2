/** Negative controls for the Stage 15O.2 golden gate in the improvement flow. Only a TEMP copy changes; the repository is read. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-golden-gate-audit-")); const link = path.join(temp, "node_modules");
const gate = "scripts/smoke-ayas-golden-experiment-gate.ts"; const artifactTest = "scripts/smoke-ayas-controlled-self-evolution-artifact.ts";
const evaluation = "src/lib/brain/autonomy/AyasResearchExperimentEvaluation.ts"; const runner = "src/lib/brain/autonomy/AyasRegisteredImprovementExperiment.ts";
const sandbox = "src/lib/brain/autonomy/AyasResearchExperimentSandbox.ts"; const cycle = "src/lib/brain/autonomy/AyasResearchImprovementCycle.ts";
const proposalBridge = "src/lib/brain/autonomy/AyasResearchProposalBridge.ts";
const artifact = "src/lib/ayas/evolution/AyasControlledSelfEvolutionArtifact.ts"; const evolutionBridge = "src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!; const base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
const HELD_CHECK = "ayasExperimentEvidenceGoldenHeld(evidence, ayasGoldenVaultDigest(input.goldenVault ?? AYAS_GOLDEN_VAULT), (input.goldenVault ?? AYAS_GOLDEN_VAULT).cases.length)";
// name, file, exact text, replacement, the suite that must catch it, the gate scenario to run (the whole suite when empty)
const mutants: readonly (readonly [string, string, string, string, string, string])[] = [
  ["improved without an answer from the vault", evaluation, "if (!golden || typeof golden !== \"object\" || golden.authority !== \"NONE\") return held(\"GOLDEN_NOT_MEASURED\", \"INCONCLUSIVE\");", "if (!golden || typeof golden !== \"object\" || golden.authority !== \"NONE\") return before;", gate, "verdict"],
  ["an answer that claims authority is accepted", evaluation, " || golden.authority !== \"NONE\") return held(", ") return held(", gate, "verdict"],
  ["a red vault leaves the verdict standing", evaluation, "return Array.isArray(golden.regressedCaseIds) && golden.regressedCaseIds.length > 0 ? held(\"GOLDEN_REGRESSION\", \"REGRESSED\") : held(\"GOLDEN_NOT_HELD\", \"INCONCLUSIVE\");", "return before;", gate, "verdict"],
  ["a broken golden case is only inconclusive", evaluation, "? held(\"GOLDEN_REGRESSION\", \"REGRESSED\") : held(\"GOLDEN_NOT_HELD\", \"INCONCLUSIVE\");", "? held(\"GOLDEN_NOT_HELD\", \"INCONCLUSIVE\") : held(\"GOLDEN_NOT_HELD\", \"INCONCLUSIVE\");", gate, "verdict"],
  ["a moved vault leaves the verdict standing", evaluation, "return held(\"GOLDEN_VAULT_CHANGED\", \"INVALID_EXPERIMENT\");", "return before;", gate, "verdict"],
  ["an unmeasured vault leaves the verdict standing", evaluation, "    default:\n      return held(\"GOLDEN_NOT_MEASURED\", \"INCONCLUSIVE\");", "    default:\n      return before;", gate, "verdict"],
  ["held is taken at its word", evaluation, "return Array.isArray(golden.failingCaseIds) && golden.failingCaseIds.length === 0 && golden.cases > 0 && HEX64.test(String(golden.vaultDigest ?? \"\")) ? before : held(\"GOLDEN_NOT_MEASURED\", \"INCONCLUSIVE\");", "return before;", gate, "verdict"],
  ["the vault is asked about every comparison", evaluation, "if (before.verdict !== \"IMPROVED\") return before;", "", gate, "verdict"],
  ["a stopped block may sit next to IMPROVED", evaluation, " || (candidate.verdict === \"IMPROVED\" && candidate.golden.decision !== \"GOLDEN_HELD\")", "", gate, "evidence"],
  ["a malformed golden block verifies", evaluation, "(!validAyasExperimentGoldenEvidence(candidate.golden) || ", "(", gate, "evidence"],
  ["held against any vault", evaluation, " && golden.vaultDigest === vaultDigest", "", gate, "evidence"],
  ["held with fewer cases than the vault has", evaluation, " && golden.cases.length === vaultCases", "", gate, "evidence"],
  ["a stopped block counts as held", evaluation, "validAyasExperimentGoldenEvidence(golden) && golden.decision === \"GOLDEN_HELD\" && ", "validAyasExperimentGoldenEvidence(golden) && ", gate, "evidence"],
  ["a block need not agree with itself", evaluation, "return JSON.stringify([...failing].sort()) === JSON.stringify([...red].sort()) && (golden.regressedCaseIds as readonly string[]).every((id) => failing.includes(id))\n    && ", "return ", gate, "evidence"],
  ["held without a case or a digest", evaluation, "\n    && (golden.decision !== \"GOLDEN_HELD\" || (red.length === 0 && golden.cases.length > 0 && golden.vaultDigest !== null && golden.vaultVersion !== null));", ";", gate, "evidence"],
  ["extra fields ride along in a golden block", evaluation, "Object.keys(golden).length !== keys.length || ", "", gate, "evidence"],
  ["the vault is never asked", runner, "if (!abortCode && compareAyasExperimentBeforeGolden({ hypothesis, baseline, experiment, baselineSuites, experimentSuites }).verdict === \"IMPROVED\") {", "if (false) {", gate, "held"],
  ["the answer is not passed to the verdict", runner, "baselineSuites, experimentSuites, golden, ...(abortCode ? { abortCode } : {}) });", "baselineSuites, experimentSuites, ...(abortCode ? { abortCode } : {}) });", gate, "held"],
  ["a regression suite that is a golden case runs twice", runner, "{ reuse: experimentSuites, caseTimeoutMs: cap, remainingMs: ctx.remainingMs }", "{ caseTimeoutMs: cap, remainingMs: ctx.remainingMs }", gate, "held"],
  ["the evidence omits the vault's answer", runner, "...(golden ? { golden: {", "...(golden && process.pid < 0 ? { golden: {", gate, "regressed"],
  ["a golden case may write into the tree", runner, "if (afterGolden.diff !== post.diff || afterGolden.changedPaths.join(\"\\n\") !== post.changedPaths.join(\"\\n\")) abortCode = \"SANDBOX_ESCAPE\";", "if (process.pid < 0) abortCode = \"SANDBOX_ESCAPE\";", gate, "escape"],
  ["the unchanged tree is never asked about a red case", runner, "golden = evaluateAyasGoldenRegression({ vault, candidate: candidateRun.run, baseline: baselineRun.run });", "", gate, "regressed"],
  ["the red case is asked again on the changed tree", runner, "await restoreAyasSandboxBase(sandbox, post.changedPaths);\n                if ((await captureAyasSandboxChange(sandbox)).changedPaths.length === 0) {", "if (true) {", gate, "red-before,regressed"],
  ["a red case that was red before is blamed on the change", runner, "baseline: baselineRun.run });", "baseline: { ...baselineRun.run, results: baselineRun.run.results.map((result) => ({ ...result, pass: true, timedOut: false })) } });", gate, "red-before"],
  ["cases run on a tree whose pinned bytes moved", sandbox, "if (pinDrift.length === 0) {", "if (pinDrift.length >= 0) {", gate, "budget"],
  ["drift is not looked for", sandbox, "const pinDrift = verifyAyasGoldenVaultPins(vault, (file) => fs.readFileSync(path.join(sandbox.repoDir, file)));", "const pinDrift: string[] = [];", gate, "moved"],
  ["a case is started with no time left", sandbox, "if (options.remainingMs() < AYAS_GOLDEN_CASE_MIN_START_MS) break;", "", gate, "budget"],
  ["a reused failure is a pass", sandbox, "results.push({ id: item.id, pass: earlier.pass && !earlier.timedOut, timedOut: earlier.timedOut });", "results.push({ id: item.id, pass: true, timedOut: false });", gate, "budget"],
  ["asking about one case answers for all", sandbox, "if (options.onlyCaseIds && !options.onlyCaseIds.includes(item.id)) continue;", "", gate, "budget"],
  ["a golden case that fails is a pass", sandbox, "results.push({ id: item.id, pass: outcome.pass && !outcome.timedOut, timedOut: outcome.timedOut });", "results.push({ id: item.id, pass: true, timedOut: false });", gate, "regressed"],
  ["the cycle offers evidence that is not held", cycle, " && ayasExperimentEvidenceGoldenHeld(evidence, goldenVaultDigest, goldenVault.cases.length)) proposalEvidence.push", ") proposalEvidence.push", gate, "cycle"],
  ["the cycle ignores the vault it was given", cycle, "const goldenVault: AyasGoldenVault = deps.goldenVault ?? AYAS_GOLDEN_VAULT;", "const goldenVault: AyasGoldenVault = AYAS_GOLDEN_VAULT;", gate, "cycle"],
  ["the bridge proposes evidence from before the vault", proposalBridge, "    .filter(({ evidence }) => evidence.golden?.decision === \"GOLDEN_HELD\" && evidence.golden.cases.length > 0 && evidence.golden.failingCaseIds.length === 0)\n", "", gate, "cycle"],
  ["an artifact is frozen without a held vault", artifact, `    || !${HELD_CHECK}\n`, "", artifactTest, ""],
  ["a frozen artifact bridges without a held vault", evolutionBridge, `      || !${HELD_CHECK}\n`, "", artifactTest, ""],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (test: string, only: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: { ...env, ...(only ? { AYAS_GOLDEN_GATE_ONLY: only } : {}) }, encoding: "utf8", windowsHide: true, timeout: 120_000 });
try {
  copy(gate); copy(artifactTest); copy("tsconfig.json");
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  for (const test of [gate, artifactTest]) { const baseline = run(test, ""); assert.equal(baseline.status, 0, `${test}: ${baseline.stderr}${baseline.stdout}`.slice(0, 2000)); }
  for (const [name, file, before, after, test, only] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(test, only); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    // Caught by a check of the suite, not by the mutated file failing to load.
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 400)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: must fail an assertion: ${result.stderr.slice(0, 400)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15O golden experiment gate mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  // The junction goes first, so the recursive removal can never follow it into the real node_modules.
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-golden-gate-audit-"));
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
