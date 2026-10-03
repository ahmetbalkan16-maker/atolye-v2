/** Stage16.2 adversarial negative controls. Only a copied source closure in an owned gitless TEMP root is changed. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo = process.cwd(), parent = fs.realpathSync.native(os.tmpdir());
const temp = fs.mkdtempSync(path.join(parent, "ayas-revenue-ledger-audit-")), link = path.join(temp, "node_modules");
const test = "scripts/smoke-ayas-revenue-ledger.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return; copied.add(file); const to = path.join(temp, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(repo, file), to);
  if (!/\.tsx?$/.test(file)) return;
  for (const m of fs.readFileSync(to, "utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), m[1]!);
    const found = [base, base + ".ts", base + ".tsx", base + ".json", path.join(base, "index.ts")].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    if (found) { const rel = path.relative(repo, found).replace(/\\/g, "/"); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const LEDGER = "src/lib/ayas/revenue/AyasRevenueLedger.ts", STORE = "src/lib/ayas/revenue/AyasRevenueLedgerStore.ts", ECON = "src/lib/ayas/revenue/AyasRevenueEconomics.ts";
const mutants: readonly (readonly [string, string, string, string, string, number?])[] = [
  ["raw fields persisted", LEDGER, "hasExactAyasRevenueKeys(raw, INPUT_KEYS)", "INPUT_KEYS.every(k => Object.hasOwn(raw, k))", "P17"],
  ["nested economic authority field accepted", LEDGER, "!hasExactAyasRevenueKeys(a, [\"valueMinor\", \"currency\"])", "false", "P18"],
  ["negative money accepted", LEDGER, " || (a.valueMinor as number) < 0", "", "P20"],
  ["fractional money accepted", LEDGER, "!Number.isSafeInteger(a.valueMinor)", "!(typeof a.valueMinor === \"number\" && Number.isFinite(a.valueMinor))", "P21"],
  ["unknown currency accepted", LEDGER, "!(AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(a.currency)", "typeof a.currency !== \"string\"", "P22"],
  ["getter executed before snapshot refusal", LEDGER, "if (!validInput(raw) || !isAyasRevenueTimestamp(recordedAt))", "if (!isAyasRevenueTimestamp(recordedAt))", "P24"],
  ["hostile exception escapes typed refusal", LEDGER, "} catch { throw new AyasRevenueLedgerError(\"INVALID_INPUT\"); }", "} catch (e) { throw e; }", "P25"],
  ["changed money silently replayed", LEDGER, "if (!sameMaterialFact(existing, candidate))", "if (false)", "P04"],
  ["evidence digest silently upgraded", LEDGER, "v.evidence.evidenceDigest, v.reversesEntryId", "v.reversesEntryId", "P07"],
  ["reversal wrong magnitude accepted", LEDGER, " && v.amount.valueMinor === target.amount.valueMinor", "", "P39"],
  ["double reversal accepted", LEDGER, " && !reversed.has(target.entryId)", "", "P37"],
  ["reversal of reversal accepted", LEDGER, " && target.event !== \"REVERSAL\"", "", "P38"],
  ["owner import impersonates platform provenance", LEDGER, "else if (e.adapterId !== null || e.adapterVersion !== null) return false;", "else if (false) return false;", "P19"],
  ["revision mismatch accepted", LEDGER, " || raw.revision !== raw.entries.length", "", "P14"],
  ["fsync omitted before publish", STORE, " fs.fsyncSync(fd);", "", "P12"],
  ["write-free early replay removed", STORE, "if (early.kind === \"REPLAY\") return result(\"REPLAY\", before.revision, early.entry);", "", "P03"],
  ["safe mode all guards removed", STORE, "assertAyasSafeModeAllowsMutation(this.repoRoot);", "", "P33", 3],
  ["late safe mode guards removed", STORE, "assertAyasSafeModeAllowsMutation(this.repoRoot); this.checkRoot();", "this.checkRoot();", "P34", 2],
  ["capacity allows overflow", STORE, "if (before.entries.length >= this.maxEntries)", "if (false)", "P31"],
  ["under-lock capacity allows overflow", STORE, "if (current.entries.length >= this.maxEntries)", "if (false)", "P52"],
  ["regular atomic replacement misclassified unsafe", STORE, "if (opened.nlink === 0 || opened.ino !== stat.ino || opened.dev !== stat.dev) continue;", "if (opened.nlink === 0 || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new AyasRevenueLedgerError(\"STORAGE_UNSAFE\");", "P51"],
  ["aggregate overflow silently rounded", ECON, "if (!Number.isSafeInteger(sum)) throw new AyasRevenueLedgerError(\"AGGREGATE_OVERFLOW\");", "", "P48"],
  ["payout double counted as revenue", ECON, "const grossRevenueMinor = sum(\"GROSS_REVENUE\")", "const grossRevenueMinor = safeAdd(sum(\"GROSS_REVENUE\"), sum(\"PAYOUT_OBSERVED\"))", "P42"],
  ["missing fees assumed zero", ECON, "const incompleteEvidence = sales.length === 0 || sales.some", "const incompleteEvidence = false && sales.some", "P44"],
  ["time group resurrects reversed sale", ECON, " && !reversed.has(v.entryId)", "", "P47"],
  ["profit grants authority", ECON, "grantsAuthority: false });", "grantsAuthority: true });", "P49"],
  ["currency implicitly pooled by caller grouping", ECON, "if (!dimensions.includes(\"currency\")) dimensions.push(\"currency\");", "", "P41"],
  ["extended reversal ordered lexically", LEDGER, "Date.parse(v.occurredAt) >= Date.parse(target.occurredAt)", "v.occurredAt >= target.occurredAt", "P53"],
  ["extended fact times sorted lexically", ECON, "sort((a, b) => Date.parse(a) - Date.parse(b))", "sort()", "P53"],
  ["extended UTC day truncated", ECON, "const day = at.split(\"T\")[0]!;", "const day = at.slice(0, 10);", "P53"],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" }; for (const k of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"]) if (process.env[k]) env[k] = process.env[k];
const run = (selected?: string) => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env: selected ? { ...env, AYAS_REVENUE_LEDGER_MUTATION_CASE: selected } : env, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 });
try {
  copy(test); copy("scripts/fixtures/ayas-revenue-ledger-worker.ts"); for (const f of ["tsconfig.json", "package.json", ".gitignore"]) copy(f);
  fs.symlinkSync(fs.realpathSync(path.join(repo, "node_modules")), link, process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.signal, null); assert.equal(baseline.status, 0, `${baseline.stderr}${baseline.stdout}`.slice(0, 6000));
  const caught: string[] = [], equivalents: string[] = [];
  for (const [name, file, before, after, selected, occurrences = 1] of mutants) {
    const target = path.join(temp, file), original = fs.readFileSync(target, "utf8"); assert.equal(original.split(before).length - 1, occurrences, `${name}: exact mutation`);
    let r: ReturnType<typeof run>; try { fs.writeFileSync(target, original.replaceAll(before, () => after)); r = run(selected); } finally { fs.writeFileSync(target, original); }
    assert.equal(r.signal, null, `${name}: timeout`);
    // The early capacity check is an optimization: the authoritative under-lock check still rejects this sequential append.
    // Removing that under-lock check is NOT equivalent; P52's real race must catch it.
    if (name === "capacity allows overflow") {
      assert.equal(r.status, 0, `${name}: declared safety equivalent changed unexpectedly`); equivalents.push(name); continue;
    }
    assert.notEqual(r.status, 0, `${name}: survived`); assert.doesNotMatch(r.stderr, /SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/, `${name}: ${r.stderr.slice(0, 600)}`);
    assert.match(r.stderr, /AssertionError|ERR_ASSERTION/, `${name}: ${r.stderr.slice(0, 600)}`); caught.push(name);
  }
  console.log(JSON.stringify({ status: "PASS", baseline: JSON.parse(baseline.stdout), negativeControls: { total: mutants.length, caught, equivalents } }, null, 2));
} finally {
  if (fs.existsSync(link)) { if (process.platform === "win32") fs.rmdirSync(link); else fs.unlinkSync(link); }
  assert.ok(!fs.existsSync(link)); assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(), parent.toLowerCase()); assert.ok(path.basename(temp).startsWith("ayas-revenue-ledger-audit-")); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
