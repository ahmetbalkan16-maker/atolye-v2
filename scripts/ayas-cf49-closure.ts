/** Exact clean-HEAD CF49 gate. Local deterministic children only, frozen pins preserved. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import manifest from "../docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json";
import { isAyasEvalManifest, verifyAyasEvalPins } from "../src/lib/ayas/observability/AyasEvalGovernance";
const sha = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const git = (args: string[]) => execFileSync("git", ["-c", `safe.directory=${path.resolve(process.cwd())}`, "-c", "core.fsmonitor=false", ...args], { encoding: "utf8", windowsHide: true }).trim();
const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME"])
  if (process.env[key]) env[key] = process.env[key];
const files = ["scripts/smoke-ayas-cognitive-quality.ts", "scripts/smoke-ayas-cf49-remediation.ts", "scripts/smoke-ayas-cf49-frozen-review.ts",
  "scripts/smoke-ayas-cf49-review-contract.ts", "scripts/smoke-ayas-cf49-remediation-mutations.ts", "scripts/smoke-ayas-memory.ts",
  "scripts/smoke-ayas-memory-temporal.ts", "scripts/smoke-ayas-memory-integrity.ts", "scripts/smoke-ayas-context.ts",
  "scripts/smoke-ayas-chat-stream.ts", "scripts/smoke-ayas-revenue-memory.ts", "scripts/smoke-ayas-revenue-memory-mutations.ts"];
function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || args.length === 2 && args[0] === "--output", "CF49_ARGUMENT_INVALID");
  const head = git(["rev-parse", "HEAD"]);
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.equal(git(["status", "--porcelain"]), "", "CF49_CLEAN_SOURCE_REQUIRED");
  assert.ok(isAyasEvalManifest(manifest));
  assert.deepEqual(verifyAyasEvalPins(manifest, f => fs.readFileSync(f)), []);
  const startedAt = new Date().toISOString();
  const sourceSha256 = sha(fs.readFileSync("src/lib/ayas/memory/AyasMemoryTemporal.ts"));
  const results = files.map(file => {
    const start = performance.now();
    const r = spawnSync(process.execPath, ["--import", "tsx", file], { env, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 1000000 });
    assert.ok(!r.error, "CF49_CHILD_EXECUTION_FAILED:" + file);
    if (r.status !== 0) console.error(JSON.stringify({ finding: "CF49_CHILD_FAILED", file, head, exitCode: r.status, stdoutSha256: sha(r.stdout), stderrSha256: sha(r.stderr), diagnostic: r.stderr.split(/\r?\n/).find(line => line.startsWith("CF49_FROZEN_REVIEW_REFUSED:")) ?? null }));
    assert.equal(r.status, 0, "CF49_CHILD_FAILED:" + file);
    const json = r.stdout.trim().split(/\r?\n/).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(x => x && (x.status === "PASS" || x.caseCount));
    if (file.includes("cognitive-quality")) {
      assert.equal(json?.passed, 55); assert.equal(json?.caseCount, 55);
      assert.deepEqual(json?.heldOut, { passed: 5, total: 5 }); assert.deepEqual(json?.failures, []);
    }
    if (file.includes("cf49-")) assert.equal(json?.status, "PASS");
    if (file.endsWith("smoke-ayas-cf49-remediation.ts")) { assert.equal(json?.primary, 30); assert.equal(json?.heldOut, 12); assert.equal(json?.endToEnd, 4); assert.equal(json?.results.length, 46); assert.ok(json.results.every((row: { ok: boolean }) => row.ok === true)); }
    if (file.endsWith("smoke-ayas-cf49-remediation-mutations.ts")) { assert.equal(json?.controls, 12); assert.equal(json?.caught, 12); }
    if (file.endsWith("smoke-ayas-cf49-review-contract.ts")) assert.equal(json?.negativeControls, 16);
    if (file.includes("frozen-review")) { assert.equal(json?.sourceHead, head); assert.equal(json?.worktreeDirty, false); assert.equal(json?.cases, 12); assert.equal(json?.guards, 228); }
    return { file, sourceHead: head, exitCode: r.status, durationMs: Math.round(performance.now() - start), stdoutSha256: sha(r.stdout), stderrSha256: sha(r.stderr), ...(json ? { report: json } : {}) };
  });
  assert.equal(git(["rev-parse", "HEAD"]), head); assert.equal(git(["status", "--porcelain"]), "");
  assert.equal(sha(fs.readFileSync("src/lib/ayas/memory/AyasMemoryTemporal.ts")), sourceSha256);
  assert.deepEqual(verifyAyasEvalPins(manifest, f => fs.readFileSync(f)), []);
  const result = { schemaVersion: "1", sourceHead: head, sourceSha256, startedAt, completedAt: new Date().toISOString(),
    status: "CLOSED_PASS", scope: "CF49_BOUNDED_COMPUTER_PURCHASE_READER_ONLY", frozenPinsUnchanged: true,
    historicalGate: "RAW_FAIL_PRESERVED_EXACT_12_IMPROVEMENTS_EXPLICITLY_REVIEWED", allRetrievalQualityClaim: false,
    fixture: "TEMP_LOCAL_NO_MODEL_NETWORK_LIVE_MEMORY_AUTHORITY_OR_CREDENTIAL_ENV", results, grantsAuthority: false };
  if (args[1]) {
    const output = path.resolve(args[1]), parent = fs.realpathSync(path.dirname(output)), temp = fs.realpathSync(os.tmpdir());
    const relative = path.relative(temp, parent);
    assert.ok(output.endsWith(".json") && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
    assert.ok(!fs.existsSync(output)); fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  }
  console.log(JSON.stringify({ status: result.status, sourceHead: head, suites: results.length, output: args[1] ?? null }));
}
try { main(); } catch (e) { console.error(e instanceof assert.AssertionError ? e.message : "CF49_CLOSURE_REFUSED"); process.exitCode = 1; }
