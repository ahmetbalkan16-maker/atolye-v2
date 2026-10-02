/** Stage 15O — the golden vault's operator script and case runner, in one TEMP copy. The repository is only read. No model, provider or network. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { auditAyasGoldenVaultChain, ayasGoldenVaultDigest, evaluateAyasGoldenRegression, isAyasGoldenVault, verifyAyasGoldenVaultPins, type AyasGoldenVault } from "../src/lib/ayas/golden/AyasGoldenVault";
import { AYAS_GOLDEN_VAULT, AYAS_GOLDEN_VAULT_PINNED_FILES, AYAS_GOLDEN_VAULT_RETIRED, AYAS_GOLDEN_VAULT_VERSIONS } from "../src/lib/ayas/golden/AyasGoldenVaultRegistry";
import { ayasGoldenPinsFor, runAyasGoldenVault } from "./lib/AyasGoldenVaultFiles";

let count = 0;
function scenario(name: string, run: () => void) { run(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const repo = process.cwd();
const sha = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-golden-vault-"));
const link = path.join(temp, "node_modules");
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[key]) env[key] = process.env[key];
/** Every file of the copy outside the junction, with its digest. */
const listing = (dir = ""): string[] => fs.readdirSync(path.join(temp, dir), { withFileTypes: true }).filter((entry) => !(dir === "" && entry.name === "node_modules")).flatMap((entry) => {
  const relative = dir ? `${dir}/${entry.name}` : entry.name;
  return entry.isDirectory() ? listing(relative) : [`${relative}:${sha(fs.readFileSync(path.join(temp, relative)))}`];
}).sort();
const operator = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/ayas-golden-vault.ts", ...args], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 60_000 });

try {
  for (const file of ["scripts/ayas-golden-vault.ts", "scripts/lib/AyasGoldenVaultFiles.ts", "src/lib/ayas/golden/AyasGoldenVault.ts", "src/lib/ayas/golden/AyasGoldenVaultRegistry.ts", "tsconfig.json", ...AYAS_GOLDEN_VAULT_PINNED_FILES]) {
    fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true }); fs.copyFileSync(path.join(repo, file), path.join(temp, file));
  }
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");

  scenario("operator: the vault of record is intact, nothing runs unless asked, unknown arguments are refused, nothing is written", () => {
    const before = listing();
    const intact = operator(); assert.equal(intact.status, 0, intact.stderr); const report = JSON.parse(intact.stdout) as Record<string, unknown>;
    assert.deepEqual([report.status, report.authority, report.version, report.digest, report.cases, report.chainProblems, report.pinDrift, report.unpinnedGraderFiles],
      ["VAULT_INTACT", "NONE", AYAS_GOLDEN_VAULT.version, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT), AYAS_GOLDEN_VAULT.cases.length, [], [], []]);
    assert.ok(!("run" in report), "no case runs unless asked");
    for (const args of [["--verify"], ["--run", "--draft-next"], ["--run", "--run"], ["--publish"]]) { const refused = operator(...args); assert.equal(refused.status, 1); assert.match(refused.stderr, /ARGUMENT_INVALID/); assert.equal(refused.stdout, ""); }
    assert.deepEqual(listing(), before, "verification wrote something");
  });

  scenario("runner: the exit status decides; a failure, a crash and a timeout are not a pass", () => {
    const script = (name: string, body: string) => { const file = `scripts/smoke-fixture-${name}.ts`; fs.writeFileSync(path.join(temp, file), body); return file; };
    const cases = ([["pass", "console.log(\"PASS\");\n"], ["fail", "console.log(\"PASS\"); process.exitCode = 1;\n"], ["throw", "throw new Error(\"fixture\");\n"],
      ["slow", "console.log(\"PASS\"); setTimeout(() => undefined, 600_000);\n"]] as const).map(([name, body], index) => {
      const file = script(name, body);
      return { id: `golden.fixture.${name}`, domain: (["CONVERSATION", "MEMORY_RETRIEVAL", "CODING_REPAIR", "SECURITY_ADVERSARIAL"] as const)[index]!, script: file, covers: `fixture ${name}`, pins: ayasGoldenPinsFor(temp, file) };
    });
    const vault: AyasGoldenVault = { schemaVersion: "1", version: 1, previousDigest: null, cases,
      gaps: (["PRODUCTION_RECOVERY", "HISTORICAL_VIDEO", "REVENUE_DRY_RUN", "BRAIN_UI"] as const).map((domain) => ({ domain, missing: "fixture", reevaluateWhen: "never" })) };
    assert.ok(isAyasGoldenVault(vault));
    const { results, durationsMs } = runAyasGoldenVault(temp, vault, env, 6_000);
    assert.deepEqual(results, [{ id: "golden.fixture.pass", pass: true, timedOut: false }, { id: "golden.fixture.fail", pass: false, timedOut: false },
      { id: "golden.fixture.throw", pass: false, timedOut: false }, { id: "golden.fixture.slow", pass: false, timedOut: true }]);
    assert.ok(durationsMs["golden.fixture.slow"]! >= 5_000 && durationsMs["golden.fixture.slow"]! < 30_000, "the bound is the bound");
    const decision = evaluateAyasGoldenRegression({ vault, candidate: { vaultDigest: ayasGoldenVaultDigest(vault), pinDrift: verifyAyasGoldenVaultPins(vault, (file) => fs.readFileSync(path.join(temp, file))), results } });
    assert.deepEqual([decision.decision, decision.failingCaseIds, decision.reasonCodes], ["PROMOTION_STOPPED", ["golden.fixture.fail", "golden.fixture.throw", "golden.fixture.slow"], ["GOLDEN_CASE_TIMEOUT", "GOLDEN_CASE_FAILED", "BASELINE_NOT_SUPPLIED"]]);
    for (const item of cases) fs.rmSync(path.join(temp, item.script));
  });

  scenario("operator: a weakened grader and an import nobody pinned are reported; the draft re-pins and publishes nothing", () => {
    const weakened = AYAS_GOLDEN_VAULT.cases[0]!.script; const importing = AYAS_GOLDEN_VAULT.cases[1]!.script;
    fs.appendFileSync(path.join(temp, weakened), "\n// weakened\n");
    fs.mkdirSync(path.join(temp, "scripts/fixtures"), { recursive: true }); fs.writeFileSync(path.join(temp, "scripts/fixtures/unpinned-fixture.ts"), "export const loose = 1;\n");
    fs.appendFileSync(path.join(temp, importing), "\nimport \"./fixtures/unpinned-fixture\";\n");
    const changed = operator(); assert.equal(changed.status, 2); const report = JSON.parse(changed.stdout) as Record<string, unknown>;
    assert.deepEqual([report.status, report.pinDrift, report.unpinnedGraderFiles], ["VAULT_CHANGED", [importing, weakened].sort(), ["scripts/fixtures/unpinned-fixture.ts"]]);

    // The draft is what a reviewer would append: next number, chained to the vault of record, pins as they are now.
    const before = listing();
    const draft = operator("--draft-next"); assert.equal(draft.status, 0, draft.stderr);
    const drafted = JSON.parse(draft.stdout) as { status: string; authority: string; valid: boolean; next: AyasGoldenVault };
    assert.deepEqual([drafted.status, drafted.authority, drafted.valid, drafted.next.version, drafted.next.previousDigest], ["DRAFT_NOT_PUBLISHED", "NONE", true, AYAS_GOLDEN_VAULT.version + 1, ayasGoldenVaultDigest(AYAS_GOLDEN_VAULT)]);
    assert.deepEqual(auditAyasGoldenVaultChain([...AYAS_GOLDEN_VAULT_VERSIONS, drafted.next], AYAS_GOLDEN_VAULT_RETIRED), []);
    assert.deepEqual(verifyAyasGoldenVaultPins(drafted.next, (file) => fs.readFileSync(path.join(temp, file))), []);
    assert.ok(drafted.next.cases[1]!.pins.some((pin) => pin.file === "scripts/fixtures/unpinned-fixture.ts"));
    assert.deepEqual(listing(), before, "drafting wrote something");
    // The vault of record in the copy is still the published one: a draft is printed, never applied.
    assert.equal(fs.readFileSync(path.join(temp, "src/lib/ayas/golden/AyasGoldenVaultRegistry.ts"), "utf8"), fs.readFileSync(path.join(repo, "src/lib/ayas/golden/AyasGoldenVaultRegistry.ts"), "utf8"));
    const still = operator(); assert.equal(still.status, 2); assert.equal((JSON.parse(still.stdout) as { status: string }).status, "VAULT_CHANGED");
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-golden-vault-operator", scenarios: count, modelRuns: 0 }));
} finally {
  // The junction goes first, so the recursive removal can never follow it into the real node_modules.
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-golden-vault-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
