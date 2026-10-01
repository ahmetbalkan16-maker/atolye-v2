/** Reproducible negative controls over copied modules; actual checkout never changes. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const repo = process.cwd(), root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-slo-audit-"));
const test = "scripts/smoke-ayas-reliability-slo.ts", copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const content = fs.readFileSync(path.join(repo, file), "utf8"), target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content);
  for (const match of content.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), match[1]!);
    const found = [base + ".ts", base + ".tsx", path.join(base, "index.ts")].find((f) => fs.existsSync(f));
    if (found) { const rel = path.relative(repo, found); assert.ok(!rel.startsWith("..") && !path.isAbsolute(rel)); copy(rel); }
  }
}
const pure = "src/lib/ayas/observability/AyasReliabilitySlo.ts";
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["empty-is-zero", pure, 'sourceStatus === "AVAILABLE" && samples > 0 && unknownSamples === 0', 'sourceStatus === "AVAILABLE" && unknownSamples === 0'],
  ["legacy-is-covered", pure, 'samples++; scopeUnknown++; headUnknown++; regressionUnknown++; continue;', 'samples++; continue;'],
  ["hide-head-violation", pure, 'if (a.violation === "HEAD_CHANGED" || a.observedBaseHead !== null && a.observedBaseHead !== entry.baseHead) stale++;', 'if (false) stale++;'],
  ["hide-scope-violation", pure, 'a.violation === "UNAUTHORIZED_MUTATION" || lease?.state === "granted" || lease?.state === "revoked"', 'lease?.state === "granted" || lease?.state === "revoked"'],
  ["hide-regression-bypass", pure, 'if (a.completionRecorded && (a.regression === "FAIL" || a.regression === "INVALID")) bypass++;', 'if (false) bypass++;'],
  ["hide-missing-task", pure, 'if (fact.journal === "MISSING") missing++;', 'if (false) missing++;'],
  ["hide-duplicate-effect", pure, 'if (effects.has(fact.effectKeyDigest)) duplicates++;', 'if (false) duplicates++;'],
  ["allow-failed-completion", "src/lib/brain/autonomy/AyasAutonomyDaemon.ts", 'if (reliabilityAudit.regression === "FAIL" || reliabilityAudit.regression === "INVALID") throw new Error("AYAS_DAEMON_REGRESSION_REPORT_REFUSED");', 'if (false) throw new Error("AYAS_DAEMON_REGRESSION_REPORT_REFUSED");'],
  ["mutable-regression-report", "src/lib/brain/autonomy/AyasAutonomyDaemon.ts", 'testResults: Object.freeze(Array.isArray(callbackReport.testResults) ? [...callbackReport.testResults] : [])', 'testResults: callbackReport.testResults'],
];
const run = () => spawnSync(process.execPath, ["--import", "tsx", path.join(root, test)], { cwd: repo, encoding: "utf8", timeout: 45_000 });
try {
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"), "junction"); copy(test);
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(root, file), original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: unique mutation`);
    fs.writeFileSync(target, original.replace(before, after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: assertion must catch the mutation`);
  }
  console.log(`AYAS reliability SLO mutation audit: PASS (${mutants.length}/${mutants.length} caught; TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith("ayas-slo-audit-"));
  fs.rmSync(root, { recursive: true, force: true });
}
