/** Reproducible Stage 15H negative controls. Only copied modules in a TEMP overlay change; the overlay is also the working directory. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-independence-audit-"));
const test = "scripts/smoke-ayas-independence-certification.ts";
const copied = new Set<string>();
/** Copies a file byte for byte. */
function copyRaw(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, file), target);
}
/** Copies a module and everything it imports by relative path or by the `@/` alias. */
function copy(file: string) {
  if (copied.has(file)) return;
  copyRaw(file);
  if (!/\.tsx?$/.test(file)) return;
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), specifier);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}

const evaluator = "src/lib/ayas/certification/AyasIndependenceCertification.ts";
const map = "src/lib/ayas/certification/AyasIndependenceEvidenceMap.ts";
const collector = "src/lib/ayas/certification/AyasIndependenceCertificationCollector.ts";
const fetcher = "src/lib/brain/autonomy/AyasSafePublicFetch.ts";
const cli = "scripts/ayas-independence-certification.ts";
const manifestFile = "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["dirty-tree-not-a-gap", evaluator, 'if (body.git.treeState !== "CLEAN") gaps.push("GIT_TREE_DIRTY");', 'if (false) gaps.push("GIT_TREE_DIRTY");'],
  ["absent-baseline-not-a-gap", evaluator, 'if (body.baseline.state !== "PRESENT") gaps.push("BASELINE_ABSENT");', 'if (false) gaps.push("BASELINE_ABSENT");'],
  ["baseline-of-another-commit-not-a-gap", evaluator, 'if (body.baseline.sourceHead !== body.git.head) gaps.push("BASELINE_NOT_BOUND_TO_HEAD");', 'if (false) gaps.push("BASELINE_NOT_BOUND_TO_HEAD");'],
  ["baseline-of-another-commit-measures", evaluator, 'body.baseline.state === "PRESENT" && body.baseline.sourceHead === body.git.head && body.baseline.manifestDigest', 'body.baseline.state === "PRESENT" && body.baseline.manifestDigest'],
  ["baseline-of-another-manifest-measures", evaluator, "body.baseline.sourceHead === body.git.head && body.baseline.manifestDigest === body.evalManifest.digest;", "body.baseline.sourceHead === body.git.head;"],
  ["failed-baseline-accepted", evaluator, "if (!body.baseline.complete || body.baseline.failed > 0 || ", "if (!body.baseline.complete || "],
  ["incomplete-baseline-accepted", evaluator, "if (!body.baseline.complete || body.baseline.failed > 0 || ", "if (body.baseline.failed > 0 || "],
  ["zero-trials-accepted", evaluator, ".includes(body.baseline.outcome) || body.baseline.trials < 1)", ".includes(body.baseline.outcome))"],
  ["known-limitations-count-as-proof", evaluator, 'else if (proof.outcome !== "PASS") problems.push(', 'else if (proof.outcome !== "PASS" && proof.outcome !== "PASS_WITH_KNOWN_LIMITATIONS") problems.push('],
  ["unpinned-suite-accepted", evaluator, 'if (proof.pin !== "MATCH") problems.push(', "if (false) problems.push("],
  ["missing-scenario-accepted", evaluator, 'if (proof.scenarioPresent !== true) problems.push("SCENARIO_NOT_IN_SUITE");', 'if (false) problems.push("SCENARIO_NOT_IN_SUITE");'],
  ["missing-marker-accepted", evaluator, 'if (proof.markerPresent !== null && proof.markerPresent !== true) problems.push("MARKER_NOT_IN_SUITE");', 'if (false) problems.push("MARKER_NOT_IN_SUITE");'],
  ["one-proof-of-several-suffices", evaluator, ": [...new Set(requirement.proofs.flatMap(", ": [...new Set(requirement.proofs.slice(0, 1).flatMap("],
  ["proofless-requirement-proven", evaluator, '? ["NO_PROOF_DECLARED"]', "? []"],
  ["missing-requirement-ignored", evaluator, "if (found !== 1) gaps.push(", "if (found > 1) gaps.push("],
  ["unknown-requirement-ignored", evaluator, "if (!KINDS.includes(requirement.kind) || !CANONICAL[requirement.kind].includes(requirement.id)) gaps.push(", "if (false) gaps.push("],
  ["unproven-requirement-not-named", evaluator, 'if (requirement.status === "UNPROVEN") gaps.push(', "if (false) gaps.push("],
  ["no-coding-backend-ready", evaluator, 'if (!body.localCodingBackends.some((backend) => backend.mayServeAutonomousCoding === true)) gaps.push("LOCAL_CODING_BACKEND_NOT_QUALIFIED");', 'if (false) gaps.push("LOCAL_CODING_BACKEND_NOT_QUALIFIED");'],
  ["truthy-backend-flag-accepted", evaluator, "backend.mayServeAutonomousCoding === true))", "backend.mayServeAutonomousCoding))"],
  ["edited-record-accepted", evaluator, "sha256(canonicalAyasJson(sealed)) !== certificationDigest)", "false)"],
  ["relabelled-ready-accepted", evaluator, "if (canonicalAyasJson(evaluateAyasIndependence(body as AyasIndependenceCertificationBody)) !== canonicalAyasJson(evaluation)) problems.push(", "if (false) problems.push("],
  ["authority-relabel-accepted", evaluator, 'if (record.authority !== "NONE") problems.push("AUTHORITY");', 'if (false) problems.push("AUTHORITY");'],
  ["result-change-not-reported", evaluator, 'if (recorded.evaluation.result !== current.evaluation.result) drift.push("RESULT");', 'if (false) drift.push("RESULT");'],
  ["renamed-scenario-in-the-map", map, 'scenario: "a DNS-unresolvable host fails as a network error, not a hang" }', 'scenario: "a DNS-unresolvable host fails" }'],
  ["fault-missing-from-the-map", map, 'fault("REBOOT", ', 'fault("PROCESS_KILL", '],
  ["marker-not-in-the-suite", map, "marker: 'code: \"ENOSPC\"' }", "marker: 'code: \"EDQUOT\"' }"],
  ["pinned-fixture-drift-ignored", collector, "if (sha256(bytes) !== pin.sha256) match = false;", "if (false) match = false;"],
  ["scenario-read-from-unpinned-bytes", collector, ': { pin: "MISMATCH", text: null };', ': { pin: "MISMATCH", text: script ? script.toString("utf8") : null };'],
  ["scenario-substring-accepted", collector, "suite.text.includes(JSON.stringify(proof.scenario))", "suite.text.includes(proof.scenario)"],
  ["unlisted-suite-counted-as-passed", collector, 'outcome: baseline?.suites.get(proof.suite) ?? "ABSENT",', 'outcome: baseline?.suites.get(proof.suite) ?? "PASS",'],
  ["other-model-kinds-counted", collector, 'registry.filter((entry) => entry.kind === "coding-model")', "registry.filter(() => true)"],
  ["serving-rule-bypassed", collector, 'mayServeAutonomousCoding: ayasLifecycleMayServe(entry, "AUTONOMOUS_CODING")', 'mayServeAutonomousCoding: entry.state !== "RETIRED"'],
  ["malformed-baseline-result-accepted", collector, 'if (typeof result?.id !== "string" || suites.has(result.id) || !OUTCOMES.includes(status as AyasIndependenceSuiteOutcome)) throw', 'if (typeof result?.id !== "string") throw'],
  ["dirty-tree-recorded-clean", collector, 'treeState: dirtyPaths === 0 ? "CLEAN" : "DIRTY"', 'treeState: "CLEAN"'],
  ["invalid-manifest-accepted", collector, 'if (!isAyasEvalManifest(parsed)) throw new Error("AYAS_INDEPENDENCE_EVAL_MANIFEST_INVALID");', 'if (false) throw new Error("AYAS_INDEPENDENCE_EVAL_MANIFEST_INVALID");'],
  ["server-error-retried-inline", fetcher, '    case "AYAS_FETCH_HTTP_ERROR":\n    case "AYAS_FETCH_REDIRECT_MISSING_LOCATION":', '    case "AYAS_FETCH_HTTP_ERROR":\n      return "TRANSIENT";\n    case "AYAS_FETCH_REDIRECT_MISSING_LOCATION":'],
  ["existing-record-overwritten", cli, '{ flag: "wx" }', "{}"],
  ["verify-ignores-changes", cli, "if (!stored.ok || drift.length) process.exitCode = 1;", "if (!stored.ok) process.exitCode = 1;"],
];

const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 180_000 });
try {
  for (const file of [test, cli]) copy(file);
  // The suite reads the eval manifest of record, every file it pins for a cited suite, the master order and package.json.
  for (const file of [manifestFile, "docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md", "package.json", "tsconfig.json"]) copyRaw(file);
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, manifestFile), "utf8")) as { suites: readonly { pins: readonly { file: string }[] }[] };
  for (const suite of manifest.suites) for (const pin of suite.pins) copyRaw(pin.file);
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(); fs.copyFileSync(path.join(repo, file), target);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  for (const [, file] of mutants) assert.ok(fs.readFileSync(path.join(temp, file)).equals(fs.readFileSync(path.join(repo, file))), "the repository source was read, never written");
  console.log(`Stage 15H independence certification mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-independence-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
