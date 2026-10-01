/** Stage 15F.3. Real stores and adversarial failures in TEMP; no live writes. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { createAyasLocalDiscoveryRunLedger } from "../src/lib/brain/autonomy/AyasLocalDiscoveryRunLedger";
import { AyasExecutionAuthorizationStore, AYAS_AUTHORIZATION_RETENTION_FLOOR_MS } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { auditAyasAuthorizationCompaction, applyAyasAuthorizationCompaction } from "../src/lib/ayas/observability/AyasAuthorizationCompaction";
import { deriveAyasLeaseEvidence, type AyasOperationEvidence } from "../src/lib/ayas/observability/AyasOperationEvidence";
import { createAyasOperationEvidenceStore } from "../src/lib/ayas/observability/AyasOperationEvidenceStore";
import { readAyasOperationalState, AYAS_OPERATIONAL_STATE_MAX_WINDOW_HOURS } from "../src/lib/ayas/observability/AyasOperationalState";
import { classifyAyasTelemetryOutcome, summarizeAyasOperationTelemetry, AYAS_TELEMETRY_MAX_ROWS, AYAS_TELEMETRY_OUTCOME_CLASSES } from "../src/lib/ayas/observability/AyasOperationTelemetry";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-telemetry-"));
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const OLD = NOW - 10 * 86_400_000;
const descriptor = { action: "inspect-source-file", requestedBy: "ayas-server", intent: "fixture", plan: {}, canonical: "fixture" };
let count = 0;
function scenario(name: string, test: () => void) { test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function fixture() {
  const rootDir = fs.mkdtempSync(path.join(temp, "root-"));
  let clock = OLD;
  const authorizations = new AyasExecutionAuthorizationStore({ rootDir, now: () => new Date(clock) });
  const evidence = createAyasOperationEvidenceStore({ rootDir });
  const grant = (state: "granted" | "consumed" | "completed" | "failed" | "revoked" = "completed") => {
    const record = authorizations.grant(descriptor);
    if (state === "consumed" || state === "completed" || state === "failed") authorizations.consume(record.authorizationId, descriptor);
    if (state === "completed") authorizations.settle(record.authorizationId, { ok: true, resultDigest: "a".repeat(64) });
    if (state === "failed") authorizations.settle(record.authorizationId, { ok: false, failureReason: "EXECUTOR_FAILED" });
    if (state === "revoked") authorizations.revoke(record.authorizationId);
    return authorizations.read(record.authorizationId);
  };
  return { rootDir, authorizations, evidence, grant, clock: (at: number) => { clock = at; }, options: () => ({ authorizations, evidence, nowMs: NOW }) };
}
function trace(over: Partial<AyasOperationEvidence> = {}): AyasOperationEvidence {
  return { schemaVersion: "1", source: "trace", id: crypto.randomUUID(), task: "chat-turn", agent: "ayas-server", startedAt: new Date(NOW - 1000).toISOString(), endedAt: new Date(NOW).toISOString(),
    durationMs: 1000, outcome: "ok", errorCode: null, model: { entryId: "llm.local-text.qwen", state: "PINNED", pin: "MATCH" },
    actions: [], approvalBinding: null, retries: 0, evidenceDigest: "a".repeat(64), ...over };
}
function bytes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string) => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full); else result[path.relative(root, full)] = fs.readFileSync(full).toString("base64");
  } };
  walk(root); return result;
}

try {
  scenario("trace and its durable lease count one dispatch, one task and preserve retries", () => {
    const f = fixture(); f.clock(NOW - 1000); const record = f.grant();
    const lease = deriveAyasLeaseEvidence(record, NOW)!;
    const turn = trace({ retries: 2, actions: [{ ...lease.actions[0]!, outcome: "error", durationMs: 999, attempt: 3 }] });
    const summary = summarizeAyasOperationTelemetry([turn, lease, turn, lease]);
    assert.deepEqual([summary.records, summary.tasks.length, summary.tasks[0]!.total, summary.actions[0]!.total, summary.actions[0]!.ok, summary.actions[0]!.failed, summary.retries], [2, 1, 1, 1, 1, 0, 2]);
    assert.equal(summary.actions[0]!.retries, 2);
    assert.deepEqual(summary.actions[0]!.retryDistribution, { none: 0, one: 0, two: 1, threeOrMore: 0 });
    assert.equal(summary.actions[0]!.latency.maxMs, lease.durationMs);
    assert.equal(summary.models[0]!.pinMatch, 1);
  });
  scenario("nearest-rank latency, error rate, and bounded error codes", () => {
    const input = Array.from({ length: 20 }, (_, i) => trace({ outcome: i % 2 ? "error" : "ok", durationMs: i + 1, errorCode: i % 2 ? `ERROR_${i}` : null }));
    const row = summarizeAyasOperationTelemetry(input).tasks[0]!;
    assert.deepEqual([row.total, row.ok, row.failed, row.successRate, row.latency.p50Ms, row.latency.p95Ms, row.latency.maxMs, Object.keys(row.errorCodes).length], [20, 10, 10, 0.5, 10, 19, 20, 8]);
  });
  scenario("denied, expired and unsettled never fabricate a success rate", () => {
    const f = fixture(); const lease = deriveAyasLeaseEvidence(f.grant("consumed"), NOW)!;
    const summary = summarizeAyasOperationTelemetry([lease, trace({ outcome: "denied", durationMs: null, model: null })]);
    assert.equal(summary.unsettled, 1); assert.equal(summary.actions[0]!.successRate, null);
    assert.equal(summary.tasks.find((row) => row.name === "chat-turn")!.denied, 1);
    assert.equal(summary.tasks.find((row) => row.name === "chat-turn")!.latency.samples, 0);
  });
  scenario("outcome classes: every sample in exactly one; a timeout is its own class and still counts against success", () => {
    const tool = (outcome: AyasOperationEvidence["outcome"], errorCode: string | null, attempt = 1) =>
      trace({ actions: [{ action: "inspect-source-file", outcome, errorCode, durationMs: 10, attempt, binding: null }] });
    const input = [tool("ok", null), tool("ok", null, 2), tool("error", "TOOL_EXECUTOR_FAILURE"), tool("error", "TOOL_TIMEOUT"), tool("error", "MODEL_TIMEOUT", 3),
      tool("error", "SOMETHING_NEVER_SEEN_BEFORE"), tool("error", null), tool("denied", "TOOL_POLICY_DENIED"), tool("cancelled", "ABORTED"), tool("unsettled", null), tool("fallback", null)];
    const row = summarizeAyasOperationTelemetry(input).actions[0]!;
    assert.deepEqual(row.classes, { success: 2, failure: 3, timeout: 2, denied: 1, requireOwner: 0, resourceAbort: 0, uncertain: 1, cancelled: 1, other: 1 });
    assert.equal(Object.values(row.classes).reduce((sum, n) => sum + n, 0), row.total);
    assert.deepEqual(Object.keys(row.classes), [...AYAS_TELEMETRY_OUTCOME_CLASSES]);
    // The recorded-outcome counts are unchanged: five errors, whatever their code.
    assert.deepEqual([row.total, row.ok, row.failed, row.denied, row.unsettled, row.other], [11, 2, 5, 1, 1, 2]);
    assert.equal(row.successRate, 2 / 7);
    // An unknown error code is a failure and stays visible; a retried sample keeps its own class.
    assert.equal(row.errorCodes.SOMETHING_NEVER_SEEN_BEFORE, 1); assert.equal(row.retried, 2); assert.equal(row.retries, 3);
    // A configuration code that merely contains the word is not a timeout.
    assert.equal(classifyAyasTelemetryOutcome("error", "ENDPOINT_OR_TIMEOUT_INVALID"), "failure");
    assert.equal(classifyAyasTelemetryOutcome("error", "TIMEOUT"), "timeout"); assert.equal(classifyAyasTelemetryOutcome("cancelled", "SUITE_TIMED_OUT"), "timeout");
  });
  scenario("an owner wait and a host-protection abort are never a failure and never move the success rate", () => {
    const tool = (outcome: AyasOperationEvidence["outcome"], errorCode: string | null) =>
      trace({ actions: [{ action: "inspect-source-file", outcome, errorCode, durationMs: 10, attempt: 1, binding: null }] });
    const clean = [tool("ok", null), tool("ok", null), tool("ok", null), tool("error", "TOOL_EXECUTOR_FAILURE")];
    const before = summarizeAyasOperationTelemetry(clean).actions[0]!;
    const after = summarizeAyasOperationTelemetry([...clean, tool("denied", "TOOL_REQUIRE_OWNER"), tool("denied", "AYAS_FIREWALL_OWNER_PROOF_REQUIRED"), tool("error", "RESOURCE_ABORT"),
      tool("error", "HOST_PROTECTION"), tool("cancelled", "AYAS_LOCAL_CODING_RESOURCE_ABORT")]).actions[0]!;
    assert.equal(before.successRate, 0.75); assert.equal(after.successRate, 0.75);
    assert.deepEqual([after.classes.requireOwner, after.classes.resourceAbort, after.classes.failure, after.classes.denied, after.classes.cancelled], [2, 3, 1, 0, 0]);
    // Only owner waits and aborts recorded: nothing settled, so no rate is invented.
    assert.equal(summarizeAyasOperationTelemetry([tool("denied", "TOOL_REQUIRE_OWNER"), tool("error", "RESOURCE_ABORT")]).actions[0]!.successRate, null);
    // The code decides before the outcome does, in a fixed order.
    assert.equal(classifyAyasTelemetryOutcome("ok", "HOST_PROTECTION"), "resourceAbort"); assert.equal(classifyAyasTelemetryOutcome("error", "OWNER_REQUIRED"), "requireOwner");
    assert.equal(classifyAyasTelemetryOutcome("denied", null), "denied"); assert.equal(classifyAyasTelemetryOutcome("expired", null), "other"); assert.equal(classifyAyasTelemetryOutcome("revoked", null), "other");
  });
  scenario("window boundaries, malformed records, and invalid clock windows", () => {
    assert.equal(summarizeAyasOperationTelemetry([trace()], { sinceMs: NOW, untilMs: NOW }).records, 1);
    assert.equal(summarizeAyasOperationTelemetry([trace()], { sinceMs: NOW + 1 }).records, 0);
    assert.equal(summarizeAyasOperationTelemetry([{}, trace({ task: "private body" })]).rejected, 2);
    for (const options of [{ sinceMs: NaN }, { untilMs: Infinity }, { sinceMs: NOW, untilMs: OLD }]) assert.throws(() => summarizeAyasOperationTelemetry([], options), /WINDOW_INVALID/);
  });
  scenario("rows and model labels are bounded, pin drift remains visible", () => {
    const records = Array.from({ length: 70 }, (_, i) => trace({ task: `fixture:${i}`, model: { entryId: `llm.fixture.${i}`, state: "PINNED", pin: "MISMATCH" } }));
    const summary = summarizeAyasOperationTelemetry(records);
    assert.equal(summary.tasks.length, AYAS_TELEMETRY_MAX_ROWS); assert.equal(summary.models.length, AYAS_TELEMETRY_MAX_ROWS);
    assert.ok(summary.truncated); assert.equal(summary.models[0]!.pinMismatch, 1);
  });
  scenario("read-only view of missing stores creates nothing", () => {
    const f = fixture(); const before = bytes(f.rootDir);
    const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
    assert.equal(state.leases.status, "ok"); assert.equal(state.telemetry.status, "ok");
    assert.deepEqual(bytes(f.rootDir), before);
    assert.throws(() => readAyasOperationalState({ nowMs: NaN }), /CLOCK_INVALID/);
    assert.equal(readAyasOperationalState({ rootDir: f.rootDir, windowHours: 99999 }).windowHours, AYAS_OPERATIONAL_STATE_MAX_WINDOW_HOURS);
  });
  scenario("live leases distinguish outstanding, running and lost, with byte-identical sources", () => {
    const f = fixture(); const lost = f.grant("consumed"); f.grant(); f.clock(NOW); f.grant("granted"); f.grant("consumed");
    const before = bytes(f.rootDir); const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
    assert.equal(state.leases.status, "ok"); if (state.leases.status !== "ok") return;
    assert.deepEqual(state.leases.value.counts, { outstanding: 1, running: 1, unsettledPastExpiry: 1, unreadable: 0, compactable: 1 });
    assert.equal(state.leases.value.unsettledPastExpiry[0]!.authorizationId, lost.authorizationId);
    assert.deepEqual(bytes(f.rootDir), before);
  });
  scenario("failed sections report unavailable and safe reasons independently", () => {
    const f = fixture(); const throwPrivate = () => { throw Object.assign(new Error("C:/owner/secret private body"), { code: "not a stable code" }); };
    const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW, authorizations: { scan: throwPrivate }, discoveryLedger: { read: throwPrivate } });
    assert.deepEqual(state.leases, { status: "unavailable", reason: "READ_FAILED" });
    assert.deepEqual(state.telemetry, state.leases); assert.equal(state.evidence.status, "ok"); assert.equal(state.gate.status, "ok");
    assert.equal(JSON.stringify(state).includes("secret"), false);
  });
  scenario("real evidence directory and day IO failures cannot become zero telemetry", () => {
    for (const kind of ["directory", "day"]) {
      const f = fixture(); fs.mkdirSync(path.dirname(f.evidence.dir), { recursive: true });
      if (kind === "directory") fs.writeFileSync(f.evidence.dir, "blocked");
      else { fs.mkdirSync(f.evidence.dir); fs.mkdirSync(path.join(f.evidence.dir, "2026-10-01.jsonl")); }
      const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
      assert.deepEqual(state.evidence, { status: "unavailable", reason: "AYAS_EVIDENCE_READ_FAILED" });
      assert.deepEqual(state.telemetry, state.evidence);
      assert.throws(() => auditAyasAuthorizationCompaction(f.options()), /unreadable/);
    }
  });
  scenario("authorization enumeration IO failure is unavailable", () => {
    const f = fixture(); fs.mkdirSync(path.join(f.rootDir, "execution")); fs.writeFileSync(path.join(f.rootDir, "execution", "authorizations"), "blocked");
    const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
    assert.deepEqual(state.leases, { status: "unavailable", reason: "AYAS_EXEC_AUTH_IO" });
  });
  scenario("corrupt and invalid-name records stay in place and are reported without raw names", () => {
    const f = fixture(); const good = f.grant(); const dir = path.join(f.rootDir, "execution", "authorizations");
    fs.writeFileSync(path.join(dir, "authz-11111111.json"), "bad"); fs.writeFileSync(path.join(dir, "private-body.json"), "bad");
    const before = bytes(f.rootDir); const scan = f.authorizations.scan();
    assert.deepEqual(scan.records.map((r) => r.authorizationId), [good.authorizationId]);
    assert.deepEqual(scan.unreadable, ["authz-11111111", "invalid-name"]); assert.deepEqual(bytes(f.rootDir), before);
  });
  scenario("observer overdue, running and future-window exclusion use real ledger", () => {
    const f = fixture(); const ledger = createAyasLocalDiscoveryRunLedger({ rootDir: path.join(f.rootDir, "self-improvement", "discovery-runs") });
    ledger.start({ startedAt: new Date(NOW - 3_600_000).toISOString(), baseHead: "a".repeat(40), nextExpectedAt: new Date(NOW - 1_800_000).toISOString() });
    const state = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
    assert.equal(state.observer.status, "ok"); if (state.observer.status !== "ok") return;
    assert.equal(state.observer.value.stuckRuns, 1); assert.equal(state.observer.value.overdue, true); assert.equal(state.observer.value.runsInWindow.running, 1);
    ledger.start({ startedAt: new Date(NOW + 3_600_000).toISOString(), baseHead: "b".repeat(40) });
    const future = readAyasOperationalState({ rootDir: f.rootDir, nowMs: NOW });
    assert.equal(future.observer.status, "ok"); if (future.observer.status === "ok") assert.equal(future.observer.value.runsInWindow.running, 1);
  });
  scenario("compaction dry-run changes no bytes, including evidence", () => {
    const f = fixture(); f.grant(); f.clock(NOW); const before = bytes(f.rootDir);
    assert.equal(auditAyasAuthorizationCompaction(f.options()).eligible.length, 1); assert.deepEqual(bytes(f.rootDir), before);
  });
  scenario("compaction preserves exact evidence before removing inert records and cannot revive authority", () => {
    const f = fixture(); const record = f.grant(); f.clock(NOW); const expected = deriveAyasLeaseEvidence(record, NOW)!;
    assert.deepEqual(applyAyasAuthorizationCompaction(f.options()).compacted, [record.authorizationId]);
    assert.deepEqual(f.evidence.read().records, [expected]); assert.equal(f.authorizations.scan().records.length, 0);
    assert.throws(() => f.authorizations.consume(record.authorizationId, descriptor), /no authorization/);
    assert.equal(applyAyasAuthorizationCompaction(f.options()).compacted.length, 0);
  });
  scenario("young and consumed-unsettled records, including revoked ones, never compact", () => {
    const f = fixture(); const consumed = f.grant("consumed"); const revoked = f.grant("consumed"); f.authorizations.revoke(revoked.authorizationId);
    f.clock(NOW); const young = f.grant(); const plan = auditAyasAuthorizationCompaction(f.options());
    assert.equal(plan.eligible.length, 0); assert.equal(plan.retainedYoung, 1); assert.equal(plan.retainedUnsettled.length, 2);
    for (const id of [consumed.authorizationId, revoked.authorizationId, young.authorizationId]) assert.throws(() => f.authorizations.removeInert(id, () => true), /retention floor/);
    f.authorizations.settle(consumed.authorizationId, { ok: true, resultDigest: "a".repeat(64) });
    assert.deepEqual(applyAyasAuthorizationCompaction(f.options()).compacted, [consumed.authorizationId]);
  });
  scenario("failed or throwing evidence writes retain the original record", () => {
    for (const throws of [false, true]) {
      const f = fixture(); const record = f.grant(); f.clock(NOW);
      const result = applyAyasAuthorizationCompaction({ ...f.options(), evidence: { read: () => f.evidence.read(), append: () => { if (throws) throw new Error("disk full"); return false; } } });
      assert.deepEqual(result.failed, [{ authorizationId: record.authorizationId, reason: "EVIDENCE_NOT_WRITTEN" }]); assert.ok(f.authorizations.read(record.authorizationId));
    }
  });
  scenario("an append claiming success without readable evidence is refused", () => {
    const f = fixture(); const record = f.grant(); f.clock(NOW);
    const result = applyAyasAuthorizationCompaction({ ...f.options(), evidence: { read: () => f.evidence.read(), append: () => true } });
    assert.equal(result.failed.length, 1); assert.equal(result.failed[0]!.reason, "EVIDENCE_NOT_WRITTEN"); assert.ok(f.authorizations.read(record.authorizationId));
  });
  scenario("a stale evidence line for the same id cannot authorize deletion", () => {
    const f = fixture(); const record = f.grant(); f.clock(NOW);
    const evidence = deriveAyasLeaseEvidence(record, NOW)!; assert.ok(f.evidence.append({ ...evidence, evidenceDigest: "b".repeat(64) }));
    const result = applyAyasAuthorizationCompaction(f.options()); assert.equal(result.compacted.length, 0); assert.equal(result.failed[0]!.reason, "EVIDENCE_NOT_WRITTEN"); assert.ok(f.authorizations.read(record.authorizationId));
  });
  scenario("record drift between planning and locked removal is refused", () => {
    const f = fixture(); const record = f.grant("granted"); f.clock(NOW);
    const result = applyAyasAuthorizationCompaction({ ...f.options(), authorizations: { scan: () => f.authorizations.scan(), removeInert: (id, preserve) => {
      f.authorizations.revoke(id); return f.authorizations.removeInert(id, preserve);
    } } });
    assert.equal(result.failed.length, 1); assert.equal(result.failed[0]!.reason, "EVIDENCE_NOT_WRITTEN"); assert.equal(f.authorizations.read(record.authorizationId).state, "revoked"); assert.equal(f.evidence.read().records.length, 0);
  });
  scenario("the evidence callback runs under the existing mutation lock", () => {
    const f = fixture(); const record = f.grant("granted"); f.clock(NOW);
    f.authorizations.removeInert(record.authorizationId, () => { assert.throws(() => f.authorizations.revoke(record.authorizationId), /lock unavailable/); return true; });
  });
  scenario("interruption after evidence writing resumes without duplicate evidence", () => {
    const f = fixture(); const record = f.grant(); f.clock(NOW);
    const result = applyAyasAuthorizationCompaction({ ...f.options(), authorizations: { scan: () => f.authorizations.scan(), removeInert: (id, preserve) => {
      assert.ok(preserve(f.authorizations.read(id))); throw new Error("interrupted before unlink");
    } } });
    assert.equal(result.failed.length, 1); assert.equal(result.failed[0]!.reason, "REMOVE_REFUSED"); assert.ok(f.authorizations.read(record.authorizationId)); assert.equal(f.evidence.read().records.length, 1);
    assert.deepEqual(applyAyasAuthorizationCompaction(f.options()).compacted, [record.authorizationId]); assert.equal(f.evidence.read().records.length, 1);
  });
  scenario("retention and compaction clocks fail closed below the floor", () => {
    const f = fixture(); f.grant(); f.clock(NOW);
    for (const minAgeMs of [0, -1, 1.5, NaN, AYAS_AUTHORIZATION_RETENTION_FLOOR_MS - 1]) assert.throws(() => auditAyasAuthorizationCompaction({ ...f.options(), minAgeMs }), /BELOW_FLOOR/);
    assert.throws(() => applyAyasAuthorizationCompaction({ ...f.options(), nowMs: NaN }), /CLOCK_INVALID/);
  });
  scenario("operator defaults to dry run, view writes nothing, unknown flags fail", () => {
    const f = fixture(); f.grant(); const before = bytes(f.rootDir);
    for (const script of ["ayas-operational-state", "ayas-authorization-compaction"]) {
      const run = spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, "--root", f.rootDir], { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout);
      if (script.includes("compaction")) assert.equal(result.mode, "DRY_RUN");
      assert.deepEqual(bytes(f.rootDir), before);
      assert.equal(spawnSync(process.execPath, ["--import", "tsx", `scripts/${script}.ts`, "--oops"], { cwd: process.cwd(), encoding: "utf8" }).status, 1);
    }
  });
  console.log(`Stage 15F.3 telemetry/state/compaction: PASS (${count} scenarios; TEMP only; model/network/production actions 0)`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temp).startsWith("ayas-telemetry-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
