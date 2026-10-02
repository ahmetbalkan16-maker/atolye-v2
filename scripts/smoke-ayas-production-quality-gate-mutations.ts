/** Negative controls for the canonical Stage 15M gate. Only TEMP copies change. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const repo = process.cwd(); const temp = fs.mkdtempSync(path.join(os.tmpdir(), "quality-gate-audit-"));
const test = "scripts/smoke-ayas-production-quality-gate.ts"; const file = "src/lib/production/ProductionQualityGate.ts";
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
const mutants: readonly (readonly [string, string, string])[] = [
  ["canonical hook omitted", '"HOOK", "PACING"', '"OTHER", "PACING"'],
  ["missing observation passes", 'let state: ProductionQualityEvidenceState = "UNMEASURED";', 'let state: ProductionQualityEvidenceState = "PASS";'],
  ["stale receipt accepted", 'observation && observation.revision !== revision', 'false'],
  ["head not bound", 'head: input.repositoryHead', 'head: "constant"'],
  ["facts not bound", 'facts: input.factsDigest', 'facts: "constant"'],
  ["project not bound", 'project: input.projectSlug', 'project: "constant"'],
  ["characteristics not bound", 'characteristics: input.characteristics', 'characteristics: {}'],
  ["render bytes not bound", '.filter((a) => a.id !== "QUALITY_REPORT")', '.filter((a) => a.id !== "QUALITY_REPORT" && a.id !== "MP4")'],
  ["inapplicable check can waive anything", '!notApplicable(criterion, input.characteristics)', 'false'],
  ["unknown applicability counts as absent", 'c.syntheticReconstruction === false', 'c.syntheticReconstruction !== true'],
  ["unmeasured count ignored", 'counts.UNMEASURED > 0 || ', ''],
  ["failed check ignored", 'counts.FAIL > 0 || ', ''],
  ["delivery missing ignored", 'missingArtifacts.length > 0 || ', ''],
  ["unknown gates ignored", '|| problems.length > 0;', ';'],
  ["rights block ignored", '|| input.rightsGate === "BLOCKED"', ''],
  ["cost block ignored", '|| input.costGate === "BLOCKED"', ''],
  ["N/A artifact waived beyond tags", 'id === "TAGS" && a?.state === "NOT_APPLICABLE"', 'a?.state === "NOT_APPLICABLE"'],
  ["model evidence accepted", '["DETERMINISTIC_CHECK", "MEASUREMENT"]', '["DETERMINISTIC_CHECK", "MEASUREMENT", "MODEL_CONCLUSION"]'],
  ["extra approval accepted", '!keys(value, ["projectSlug", "repositoryHead", "factsDigest", "characteristics", "observations", "artifacts", "rightsGate", "costGate"])', 'false'],
  ["duplicate criteria accepted", '|| observed.has(String(o.criterion))', ''],
  ["duplicate artifacts accepted", '|| artifacts.has(String(a.id))', ''],
  ["invalid receipt digest accepted", '|| !HASH.test(o.receiptDigest)', ''],
  ["unknown project fact identity accepted", '|| !HASH.test(value.factsDigest)', ''],
];
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) if (process.env[key]) env[key] = process.env[key];
const run = () => spawnSync(process.execPath, ["--import", "tsx", test], { cwd: temp, env, encoding: "utf8", windowsHide: true, timeout: 20_000 });
try {
  copy(test); copy("tsconfig.json"); fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr); const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
  for (const [name, before, after] of mutants) {
    assert.equal(original.split(before).length - 1, 1, `${name}: exact mutation`); fs.writeFileSync(target, original.replace(before, () => after)); const r = run(); fs.writeFileSync(target, original);
    assert.equal(r.signal, null, `${name}: timeout`); assert.notEqual(r.status, 0, `${name}: survived`); assert.match(r.stderr, /AssertionError/, `${name}: assertion not syntax/import failure`);
  }
  console.log(`Stage 15M quality gate mutation audit: PASS (${mutants.length}/${mutants.length} caught)`);
} finally { assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("quality-gate-audit-")); fs.rmSync(temp, { recursive: true, force: true }); }
