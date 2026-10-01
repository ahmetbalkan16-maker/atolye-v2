/** Reproducible Stage 15F.3 negative controls. Only copied modules in TEMP change. */
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
const mutants: readonly (readonly [string, string, string, string])[] = [
  ["double-dispatch", "src/lib/ayas/observability/AyasOperationTelemetry.ts", "if (leases.has(action.binding)) continue;", "if (false) continue;"],
  ["unbounded-rows", "src/lib/ayas/observability/AyasOperationTelemetry.ts", "all.slice(0, AYAS_TELEMETRY_MAX_ROWS)", "all"],
  ["hidden-evidence-io", "src/lib/ayas/observability/AyasOperationEvidenceStore.ts", 'throw Object.assign(new Error("evidence directory unreadable"), { code: "AYAS_EVIDENCE_READ_FAILED" });', "return [];"],
  ["hidden-auth-io", "src/lib/ayas/execution/AyasExecutionAuthorization.ts", 'throw new AyasExecutionAuthorizationError("AYAS_EXEC_AUTH_IO", "cannot enumerate authorizations");', "return { records: [], unreadable: [] };"],
  ["unsettled-removal", "src/lib/ayas/execution/AyasExecutionAuthorization.ts", "(record.consumedAt !== undefined && record.settledAt === undefined)) {", "false) {"],
  ["record-drift-removal", "src/lib/ayas/observability/AyasAuthorizationCompaction.ts", "if (!evidence || evidence.evidenceDigest !== item.evidence.evidenceDigest) return false;", "if (!evidence) return false;"],
  ["archive-not-verified", "src/lib/ayas/observability/AyasAuthorizationCompaction.ts", 'evidenceReady = options.evidence.read().records.some((record) => record.source === "lease" && record.id === authorizationId && record.evidenceDigest === evidence.evidenceDigest);', "evidenceReady = true;"],
  ["source-error-is-zero", "src/lib/ayas/observability/AyasOperationalState.ts", 'reason: typeof code === "string" && REASON.test(code) ? code : "READ_FAILED"', 'reason: "ZERO"'],
];
const run = () => spawnSync(process.execPath, ["--import", "tsx", path.join(temp, test)], { cwd: repo, encoding: "utf8", timeout: 30_000 });
try {
  copy(test); const baseline = run(); assert.equal(baseline.status, 0, baseline.stderr);
  for (const [id, file, before, after] of mutants) {
    const target = path.join(temp, file); const original = fs.readFileSync(target, "utf8");
    assert.equal(original.split(before).length - 1, 1, `${id}: exact mutation`);
    fs.writeFileSync(target, original.replace(before, after)); const result = run(); fs.writeFileSync(target, original);
    assert.equal(result.signal, null, `${id}: timeout`); assert.notEqual(result.status, 0, `${id}: survived`);
    assert.match(result.stderr, /AssertionError/, `${id}: must fail an assertion, not imports or syntax`);
  }
  console.log(`Stage 15F.3 mutation audit: PASS (${mutants.length}/${mutants.length} caught; ${copied.size} files in TEMP overlay)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir())); assert.ok(path.basename(temp).startsWith("ayas-15f3-audit-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
