/** Negative controls for the Stage 15O golden vault. Only a TEMP copy changes; the repository is read. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-golden-audit-")); const link = path.join(temp, "node_modules");
const contractTest = "scripts/smoke-ayas-golden-vault.ts"; const operatorTest = "scripts/smoke-ayas-golden-vault-operator.ts";
const contract = "src/lib/ayas/golden/AyasGoldenVault.ts"; const safety = "src/lib/brain/selfheal/BrainPatchSafety.ts";
const files = "scripts/lib/AyasGoldenVaultFiles.ts"; const operator = "scripts/ayas-golden-vault.ts";
const copied = new Set<string>();
function copy(file: string, withImports = true) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file);
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!withImports || !/\.tsx?$/.test(file)) return;
  for (const match of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)) {
    const spec = match[1]!; const base = spec.startsWith("@/") ? path.join(repo, "src", spec.slice(2)) : path.resolve(path.dirname(path.join(repo, file)), spec);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const relative = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!relative.startsWith("..") && !path.isAbsolute(relative)); copy(relative); }
  }
}
// name, file, exact text, replacement, the suite that must catch it
const mutants: readonly (readonly [string, string, string, string, string])[] = [
  ["a canonical domain may disappear", contract, "return AYAS_GOLDEN_DOMAINS.every((domain) => covered.has(domain) || gapDomains.has(domain));", "return true;", contractTest],
  ["a golden script need not be pinned", contract, "if (!files.has(item.script)) return false;", "", contractTest],
  ["unknown vault fields are accepted", contract, "!exact(raw, [\"schemaVersion\", \"version\", \"previousDigest\", \"cases\", \"gaps\"]) || ", "", contractTest],
  ["version and predecessor need not agree", contract, "(raw.version === 1 ? raw.previousDigest !== null : typeof raw.previousDigest !== \"string\" || !HASH.test(raw.previousDigest))", "false", contractTest],
  ["one script may be two cases", contract, " || scripts.has(item.script)", "", contractTest],
  ["a pin may be any path", contract, "!PIN_FILE.test(pin.file) || ", "", contractTest],
  ["a gap may waive itself with extra fields", contract, "!exact(gap, [\"domain\", \"missing\", \"reevaluateWhen\"]) || ", "", contractTest],
  ["the digest ignores what is pinned", contract, "`AYAS_GOLDEN_VAULT_V1\\n${canonical(vault)}`", "`AYAS_GOLDEN_VAULT_V1\\n${canonical({ ...vault, cases: vault.cases.map((item) => item.id) })}`", contractTest],
  ["a published version may be edited in place", contract, "if (index === 0 ? vault.previousDigest !== null : !prior || vault.previousDigest !== ayasGoldenVaultDigest(prior)) problems.add(\"PREVIOUS_DIGEST_MISMATCH\");", "", contractTest],
  ["a version number may be skipped", contract, "if (vault.version !== index + 1) problems.add(\"VERSION_NOT_CONTIGUOUS\");", "", contractTest],
  ["a golden case may vanish silently", contract, "if ([...before].some((id) => !now.has(id) && !Object.hasOwn(named, id))) problems.add(\"CASE_REMOVED_WITHOUT_RECORD\");", "", contractTest],
  ["a retirement needs no reason and no real case", contract, "if (Object.entries(named).some(([id, reason]) => !before.has(id) || now.has(id) || !text(reason, 400))) problems.add(\"RETIREMENT_RECORD_INVALID\");", "", contractTest],
  ["changed grader bytes are not drift", contract, "if (crypto.createHash(\"sha256\").update(read(pin.file)).digest(\"hex\") !== pin.sha256) drift.add(pin.file);", "read(pin.file);", contractTest],
  ["a missing grader is not drift", contract, "catch { drift.add(pin.file); }", "catch { /* unreadable */ }", contractTest],
  ["a failing case is golden", contract, "result !== undefined && result.pass === true && result.timedOut === false;", "result !== undefined;", contractTest],
  ["a timed-out case is golden", contract, " && result.timedOut === false;", ";", contractTest],
  ["results for other cases count as measured", contract, "return vault.cases.every((item) => byId.has(item.id)) ? byId : null;", "return byId;", contractTest],
  ["a malformed result counts as measured", contract, "typeof result.pass !== \"boolean\" || typeof result.timedOut !== \"boolean\" || byId.has(result.id)) return null;\n    byId.set(result.id, { id: result.id, pass: result.pass, timedOut: result.timedOut });\n  }\n  return vault.cases.every(",
    "typeof result.timedOut !== \"boolean\" || byId.has(result.id)) return null;\n    byId.set(result.id, { id: result.id, pass: result.pass, timedOut: result.timedOut });\n  }\n  return vault.cases.every(", contractTest],
  ["no candidate run is held", contract, "if (!plain(candidate)) return { decision: \"GOLDEN_NOT_MEASURED\"", "if (!plain(candidate)) return { decision: \"GOLDEN_HELD\"", contractTest],
  ["an invalid vault is evaluated", contract, "if (!isAyasGoldenVault(input.vault)) return {", "if (false) return {", contractTest],
  ["results from another vault are compared", contract, "if (candidate.vaultDigest !== digest || (plain(baseline) && baseline.vaultDigest !== digest)) moved.push(\"VAULT_DIGEST_MISMATCH\");", "", contractTest],
  ["candidate pin drift is ignored", contract, "if (!Array.isArray(candidate.pinDrift) || candidate.pinDrift.length > 0) moved.push(\"CANDIDATE_PIN_DRIFT\");", "", contractTest],
  ["baseline pin drift is ignored", contract, "if (plain(baseline) && (!Array.isArray(baseline.pinDrift) || baseline.pinDrift.length > 0)) moved.push(\"BASELINE_PIN_DRIFT\");", "", contractTest],
  ["a red case that was already red is held", contract, "const failing = vault.cases.filter((item) => !golden(after.get(item.id)));", "const early = plain(baseline) ? baselineResults(vault, baseline) : null; const failing = vault.cases.filter((item) => !golden(after.get(item.id)) && (!early?.has(item.id) || golden(early.get(item.id))));", contractTest],
  ["a malformed baseline still explains a red case", contract, "if (!Array.isArray(run.results) || run.results.length > vault.cases.length) return null;\n  const byId = new Map<string, AyasGoldenCaseResult>();\n  for (const result of run.results as readonly unknown[]) {\n    if (!plain(result) || typeof result.id !== \"string\" || typeof result.pass !== \"boolean\" || typeof result.timedOut !== \"boolean\" || byId.has(result.id)) return null;",
    "if (!Array.isArray(run.results)) return null;\n  const byId = new Map<string, AyasGoldenCaseResult>();\n  for (const result of run.results as readonly unknown[]) {\n    if (!plain(result) || typeof result.id !== \"string\") return null;", contractTest],
  ["a stopped promotion is reported as held", contract, "return { decision: \"PROMOTION_STOPPED\", ...shared, reasonCodes, authority", "return { decision: \"GOLDEN_HELD\", ...shared, reasonCodes, authority", contractTest],
  ["declared gaps are hidden from a decision", contract, "gapDomains: vault.gaps.map((gap) => gap.domain) };", "gapDomains: [] };", contractTest],
  ["the vault and yardstick are not protected", safety, "test: (p) => p.toLowerCase().startsWith(AYAS_GOLDEN_VAULT_MODULE_DIR.toLowerCase()) || YARDSTICK_FILES.has(p.toLowerCase()),", "test: () => false,", contractTest],
  ["pinned graders are not protected", safety, "  ...AYAS_GOLDEN_VAULT_PINNED_FILES,\n", "", contractTest],
  ["the vault modules are not protected", safety, "p.toLowerCase().startsWith(AYAS_GOLDEN_VAULT_MODULE_DIR.toLowerCase()) || ", "", contractTest],
  ["another spelling escapes the protection", safety, "YARDSTICK_FILES.has(p.toLowerCase())", "YARDSTICK_FILES.has(p)", contractTest],
  ["the owner constitution is not protected", safety, "test: (p) => p.toLowerCase().startsWith(\"src/lib/ayas/governance/\") || p.toLowerCase().startsWith(\"app/brain/constitution/\"),", "test: () => false,", contractTest],
  ["the constitution page is not protected", safety, " || p.toLowerCase().startsWith(\"app/brain/constitution/\")", "", contractTest],
  ["a grader's fixtures are not part of its closure", files, "if (found) stack.push(found);", "", contractTest],
  ["a non-zero exit is a pass", files, "pass: !timedOut && !run.error && run.status === 0", "pass: !timedOut", operatorTest],
  ["a timeout is an ordinary failure", files, "const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === \"ETIMEDOUT\" || run.signal !== null;", "const timedOut = false;", operatorTest],
  ["the operator hides a changed vault", operator, "const intact = chainProblems.length === 0 && pinDrift.length === 0 && unpinned.length === 0;", "const intact = true;", operatorTest],
  ["the operator does not name an unpinned import", operator, "unpinnedGraderFiles: [...new Set(unpinned)].sort(),", "unpinnedGraderFiles: [],", operatorTest],
  ["the draft keeps the old pins", operator, "pins: ayasGoldenPinsFor(repoRoot, item.script)", "pins: item.pins", operatorTest],
  ["the operator accepts any argument", operator, "if (args.some((arg) => arg !== \"--run\" && arg !== \"--draft-next\") || new Set(args).size !== args.length || args.length > 1) throw new Error(\"ARGUMENT_INVALID\");", "", operatorTest],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
const run = (test: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 90_000 });
try {
  copy(contractTest); copy(operatorTest); copy(operator); copy("tsconfig.json");
  // What the suites read but do not import: every pinned grader and fixture, the design text, and the protected files whose existence is asserted.
  const registry = fs.readFileSync(path.join(repo, "src/lib/ayas/golden/AyasGoldenVaultRegistry.ts"), "utf8");
  for (const match of registry.matchAll(/file: "(scripts\/[^"]+)"/g)) copy(match[1]!, false);
  for (const file of ["docs/ayas-execution/2026-09-27-master/00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md", "docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json",
    "scripts/smoke-ayas-golden-vault-mutations.ts", "scripts/smoke-ayas-golden-vault-run.ts", "scripts/fixtures/ayas-golden-fixtures.ts", "scripts/smoke-ayas-golden-experiment-gate.ts",
    "scripts/smoke-ayas-golden-experiment-gate-mutations.ts", "scripts/smoke-ayas-golden-sandbox-run.ts", "scripts/ayas-eval-baseline.ts", "src/lib/ayas/observability/AyasEvalGovernance.ts",
    "src/lib/ayas/governance/AyasOwnerConstitution.ts", "src/lib/ayas/governance/AyasOwnerConstitutionReader.ts", "src/lib/ayas/governance/AyasOwnerConstitutionStore.ts",
    "app/brain/constitution/page.tsx", "app/brain/constitution/actions.ts"]) copy(file, false);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  for (const test of [contractTest, operatorTest]) { const baseline = run(test); assert.equal(baseline.status, 0, `${test}: ${baseline.stderr}${baseline.stdout}`); }
  for (const [name, file, before, after, test] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, () => after)); const result = run(test); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${name}: timeout`); assert.notEqual(result.status, 0, `${name}: survived`);
    // Caught by a check of the suite, not by the mutated file failing to load.
    assert.doesNotMatch(result.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${result.stderr.slice(0, 400)}`);
    assert.match(result.stderr, /AssertionError|ERR_ASSERTION/, `${name}: must fail an assertion: ${result.stderr.slice(0, 400)}`);
    if (process.env.SMOKE_TRACE === "1") console.log(`CAUGHT ${name}`);
  }
  console.log(`Stage15O golden vault mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally {
  // The junction goes first, so the recursive removal can never follow it into the real node_modules.
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-golden-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
