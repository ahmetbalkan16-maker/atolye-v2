/** Reproducible Stage 15F.3 and post-freeze 15F negative controls. Only copied modules in TEMP change. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-15f3-audit-"));
const test = "scripts/smoke-ayas-operation-telemetry.ts";
const copied = new Set<string>();
function copy(file: string) {
  if (copied.has(file)) return;
  copied.add(file);
  const text = fs.readFileSync(path.join(repo, file), "utf8");
  const target = path.join(temp, file);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text);
  for (const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
    const base = path.resolve(path.dirname(path.join(repo, file)), match[1]!);
    const found = [base + ".ts", base + ".tsx", path.join(base, "index.ts")].find((f) => fs.existsSync(f));
    if (found) { assert.ok(path.relative(repo, found).split(path.sep)[0] !== ".."); copy(path.relative(repo, found)); }
  }
}
const evidenceTest = "scripts/smoke-ayas-operation-evidence.ts";
const telemetry = "src/lib/ayas/observability/AyasOperationTelemetry.ts";
/** id, mutated file, exact text, replacement, and the suite that must catch it (the telemetry suite unless named). */
const mutants: readonly (readonly [string, string, string, string, string?])[] = [
  // Post-freeze 15F: outcome classes and retry accounting.
  ["resource-abort-counted-as-failure", telemetry, 'if (errorCode !== null && RESOURCE_ABORT_CODE.test(errorCode)) return "resourceAbort";', 'if (false) return "resourceAbort";'],
  ["owner-wait-counted-as-denied", telemetry, 'if (errorCode !== null && REQUIRE_OWNER_CODE.test(errorCode)) return "requireOwner";', 'if (false) return "requireOwner";'],
  ["timeout-not-a-class", telemetry, 'if (errorCode !== null && TIMEOUT_CODE.test(errorCode)) return "timeout";', 'if (false) return "timeout";'],
  ["timeout-matched-anywhere-in-code", telemetry, "const TIMEOUT_CODE = /(?:^|_)(?:TIMEOUT|TIMED_OUT)$/;", "const TIMEOUT_CODE = /TIMEOUT|TIMED_OUT/;"],
  ["timeout-left-out-of-success-rate", telemetry, "const settled = classes.success + classes.failure + classes.timeout;", "const settled = classes.success + classes.failure;"],
  ["retried-counts-attempts-not-samples", telemetry, "retried: samples.filter((sample) => sample.retries > 0).length,", "retried: samples.reduce((sum, sample) => sum + sample.retries, 0),"],
  ["one-retry-counted-twice", "src/lib/ayas/observability/AyasOperationEvidence.ts", "retries: retriedSpans.size + loneRetryEvents,", 'retries: retriedSpans.size + snapshot.events.filter((event) => event.type === "retry").length,', evidenceTest],
  ["lone-retry-event-dropped", "src/lib/ayas/observability/AyasOperationEvidence.ts", "retries: retriedSpans.size + loneRetryEvents,", "retries: retriedSpans.size,", evidenceTest],
  ["double-dispatch", "src/lib/ayas/observability/AyasOperationTelemetry.ts", "if (leases.has(action.binding)) continue;", "if (false) continue;"],
  ["unbounded-rows", "src/lib/ayas/observability/AyasOperationTelemetry.ts", "all.slice(0, AYAS_TELEMETRY_MAX_ROWS)", "all"],
  ["hidden-evidence-io", "src/lib/ayas/observability/AyasOperationEvidenceStore.ts", 'throw Object.assign(new Error("evidence directory unreadable"), { code: "AYAS_EVIDENCE_READ_FAILED" });', "return [];"],
  ["hidden-auth-io", "src/lib/ayas/execution/AyasExecutionAuthorization.ts", 'throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_IO", "cannot enumerate authorizations");', "return { records: [], unreadable: [] };"],
  ["unsettled-removal", "src/lib/ayas/execution/AyasExecutionAuthorization.ts", "(record.consumedAt !== undefined && record.settledAt === undefined)) {", "false) {"],
  ["record-drift-removal", "src/lib/ayas/observability/AyasAuthorizationCompaction.ts", "if (!evidence || evidence.evidenceDigest !== item.evidence.evidenceDigest) return false;", "if (!evidence) return false;"],
  ["archive-not-verified", "src/lib/ayas/observability/AyasAuthorizationCompaction.ts", 'evidenceReady = options.evidence.read().records.some((record) => record.source === "lease" && record.id === authorizationId && record.evidenceDigest === evidence.evidenceDigest);', "evidenceReady = true;"],
  ["source-error-is-zero", "src/lib/ayas/observability/AyasOperationalState.ts", 'reason: typeof code === "string" && REASON.test(code) ? code : "READ_FAILED"', 'reason: "ZERO"'],
];
const run = (suite = test) => spawnSync(process.execPath, ["--import", "tsx", path.join(temp, suite)], { cwd: repo, encoding: "utf8", timeout: 30_000 });
try {
  // The evidence suite's import graph reaches a module that requires an installed package; resolve it as the repository does.
  fs.symlinkSync(path.join(repo, "node_modules"), path.join(temp, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  for (const suite of [test, evidenceTest]) { copy(suite); const baseline = run(suite); assert.equal(baseline.status, 0, baseline.stderr); }
  for (const [id, file, before, after, suite] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, after)); const result = run(suite); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  console.log(`Stage 15F.3 mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-15f3-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
