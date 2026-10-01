/**
 * Stage 15F — durable, privacy-bounded operation evidence. TEMP only: every
 * evidence store and authorization store lives under one TEMP directory. No
 * model, no network, no production action.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAyasReadOnlyAction, withAyasActionRuntimeAuthorizationStore } from "../src/lib/ayas/execution/AyasActionRuntime";
import { AyasExecutionAuthorizationStore, type AyasExecutionAuthorizationRecord } from "../src/lib/ayas/execution/AyasExecutionAuthorization";
import { AYAS_OPERATION_OUTCOMES, deriveAyasLeaseEvidence, deriveAyasTraceEvidence, isAyasOperationEvidence, type AyasOperationEvidence } from "../src/lib/ayas/observability/AyasOperationEvidence";
import { AYAS_EVIDENCE_MAX_LINE_BYTES, createAyasOperationEvidenceStore, createAyasTraceEvidenceSink } from "../src/lib/ayas/observability/AyasOperationEvidenceStore";
import { AYAS_TRACE_MAX_TOOL_ATTRIBUTES, BoundedAyasTraceStore, readAyasTraceSnapshot, startAyasTrace, type AyasTraceSnapshot } from "../src/lib/ayas/trace/AyasUnifiedTrace";
import { ayasApprovalBindingDigest, ayasApprovalEvidenceRoot } from "../src/lib/brain/autonomy/AyasProposalApprovalService";

const repo = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-evidence-"));
let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) { await test(); count++; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
const dir = (): string => fs.mkdtempSync(path.join(temp, "root-"));
const AUTHZ = "authz-11111111-2222-4333-8444-555555555555";
const MODEL = { entryId: "llm.local-text.qwen2.5-7b", state: "PINNED", pin: "MATCH" } as const;

/** One finished chat-turn trace with a routed model, one tool dispatch under a lease and one retry. */
function finishedTrace(root: string, status: "ok" | "error" | "denied" | "fallback" | "cancelled" = "ok", errorCode?: string) {
  const store = createAyasOperationEvidenceStore({ rootDir: root });
  const trace = startAyasTrace({ rootKind: "chat-turn", store: new BoundedAyasTraceStore(), evidence: createAyasTraceEvidenceSink(store) });
  const turn = trace.startSpan("conversation", "ayas-chat", "stream-turn");
  trace.startSpan("model", "ayas-model", "route", turn.spanId).end("ok");
  trace.annotate({ model: MODEL });
  const tool = trace.startSpan("tool", "ayas-tool", "dispatch", turn.spanId);
  tool.end("ok", { attempted: true, executed: true });
  trace.annotate({ tool: { action: "inspect-source-file", authorizationId: AUTHZ } });
  const correction = trace.startSpan("model", "ayas-model", "correction", turn.spanId, 2);
  correction.event("retry", "running", { attempt: 2 });
  correction.end("ok");
  turn.end(status, undefined, errorCode);
  trace.finish(status, errorCode);
  return { store, trace };
}
const leaseRecord = (over: Partial<AyasExecutionAuthorizationRecord> = {}): AyasExecutionAuthorizationRecord => ({
  schemaVersion: "1", authorizationId: AUTHZ, executionId: "exec-0123456789abcdef01234567", requestDigest: "a".repeat(64), action: "inspect-source-file", requestedBy: "ayas-chat",
  intent: "bounded inspection", plan: { filePath: "src/example.ts" }, createdAt: "2026-10-01T10:00:00.000Z", expiresAt: "2026-10-01T10:05:00.000Z", state: "completed",
  consumedAt: "2026-10-01T10:00:00.100Z", settledAt: "2026-10-01T10:00:00.350Z", resultDigest: "b".repeat(64), ...over,
});
const NOW = Date.parse("2026-10-01T10:01:00.000Z");
const LATER = Date.parse("2026-10-01T11:00:00.000Z");

async function main() {
  await scenario("a finished trace becomes one evidence line: task, agent, model version, tool and lease, retries, duration, outcome", () => {
    const { store, trace } = finishedTrace(dir());
    const read = store.read();
    assert.deepEqual([read.records.length, read.rejectedLines], [1, 0]);
    const evidence = read.records[0]!;
    assert.deepEqual([evidence.schemaVersion, evidence.source, evidence.id, evidence.task, evidence.agent, evidence.outcome, evidence.errorCode, evidence.approvalBinding], ["1", "trace", trace.traceId, "chat-turn", "ayas-server", "ok", null, null]);
    assert.deepEqual(evidence.model, MODEL);
    assert.equal(evidence.actions.length, 1);
    assert.deepEqual([evidence.actions[0]!.action, evidence.actions[0]!.binding, evidence.actions[0]!.outcome, evidence.actions[0]!.attempt], ["inspect-source-file", AUTHZ, "ok", 1]);
    // One retry event and one second-attempt span.
    assert.equal(evidence.retries, 2);
    assert.ok(evidence.durationMs !== null && evidence.durationMs >= 0 && Number.isInteger(evidence.durationMs));
    assert.match(evidence.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.ok(isAyasOperationEvidence(evidence));
    const file = fs.readdirSync(store.dir);
    assert.deepEqual(file, [`${evidence.endedAt!.slice(0, 10)}.jsonl`]);
  });

  await scenario("the outcome and its error code are recorded; a secret-shaped code is not", () => {
    for (const status of ["error", "denied", "fallback", "cancelled"] as const) {
      const { store } = finishedTrace(dir(), status, "PROVIDER_FAILURE");
      const evidence = store.read().records[0]!;
      assert.deepEqual([evidence.outcome, evidence.errorCode], [status, "PROVIDER_FAILURE"]);
    }
    for (const code of ["API_KEY_REJECTED", "OWNER_PASSWORD_WRONG", "lowercase", "has space", "X"]) assert.equal(finishedTrace(dir(), "error", code).store.read().records[0]!.errorCode, null, code);
  });

  await scenario("only well-formed identifiers become attributes: text, paths and claims are dropped", () => {
    const root = dir(); const store = createAyasOperationEvidenceStore({ rootDir: root });
    const traces = new BoundedAyasTraceStore();
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "s", store: traces, evidence: createAyasTraceEvidenceSink(store) });
    for (const model of [{ entryId: "Annemin doktor randevusu", state: "PINNED", pin: "MATCH" }, { entryId: MODEL.entryId, state: "OWNER_APPROVED", pin: "MATCH" }, { entryId: MODEL.entryId, state: "PINNED", pin: "TRUST_ME" }, null, "model"]) {
      trace.annotate({ model: model as never });
    }
    for (const tool of [{ action: "rm -rf /", authorizationId: AUTHZ }, { action: "Inspect", authorizationId: AUTHZ }, { action: "", authorizationId: AUTHZ }, null]) trace.annotate({ tool: tool as never });
    for (const approvalBinding of ["../../secrets", "ONAYLANDI", "short", "has space in it", "C:\\Users\\owner"]) trace.annotate({ approvalBinding });
    // A well-formed tool with a forged lease id keeps the tool and drops the id.
    trace.startSpan("tool", "ayas-tool", "dispatch").end("ok");
    trace.annotate({ tool: { action: "query-graphify", authorizationId: "owner-approved" } });
    trace.finish("ok");
    const evidence = store.read().records[0]!;
    assert.deepEqual([evidence.model, evidence.approvalBinding], [null, null]);
    assert.deepEqual(evidence.actions.map((action) => [action.action, action.binding]), [["query-graphify", null]]);
    // The trace itself (what the trace read route returns) holds no more than the evidence does.
    assert.deepEqual(traces.get(trace.traceId, "s")!.attributes, { tools: [{ action: "query-graphify", authorizationId: null }] });
    // The model and the approval binding are set once; tools are bounded.
    const bounded = startAyasTrace({ rootKind: "owner-approval", store: new BoundedAyasTraceStore(), evidence: createAyasTraceEvidenceSink(store) });
    bounded.annotate({ model: MODEL }); bounded.annotate({ model: { entryId: "llm.local-text.qwen2.5-3b", state: "PINNED", pin: "MISMATCH" } });
    bounded.annotate({ approvalBinding: "ayas-proposal-11111111-2222-4333-8444-555555555555" }); bounded.annotate({ approvalBinding: "ayas-proposal-99999999-2222-4333-8444-555555555555" });
    for (let index = 0; index < AYAS_TRACE_MAX_TOOL_ATTRIBUTES + 5; index++) { bounded.startSpan("tool", "ayas-tool", "dispatch").end("ok"); bounded.annotate({ tool: { action: "query-graphify", authorizationId: null } }); }
    bounded.finish("ok");
    const second = store.read().records.find((record) => record.task === "owner-approval")!;
    assert.deepEqual([second.model, second.approvalBinding], [MODEL, "ayas-proposal-11111111-2222-4333-8444-555555555555"]);
    assert.equal(second.actions.filter((action) => action.action === "query-graphify").length, AYAS_TRACE_MAX_TOOL_ATTRIBUTES);
    assert.equal(second.actions.filter((action) => action.action === "unknown").length, 5);
  });

  await scenario("nothing a conversation says reaches the evidence file", () => {
    const root = dir(); const store = createAyasOperationEvidenceStore({ rootDir: root });
    const secret = "sk-THIS-IS-A-FAKE-KEY-0123456789"; const body = "Annemin doktor randevusu yarın";
    const trace = startAyasTrace({ rootKind: "chat-turn", store: new BoundedAyasTraceStore(), evidence: createAyasTraceEvidenceSink(store) });
    const span = trace.startSpan("tool", body, secret);
    span.event("gate-result", "ok", { note: body, candidateCount: 2, token: secret } as never, body);
    span.end("error", { text: body } as never, secret);
    trace.event("failed", "error", { message: body } as never, "PRIVATE_KEY_LEAKED");
    trace.annotate({ model: { entryId: body, state: secret, pin: body } as never, tool: { action: body, authorizationId: secret } as never, approvalBinding: `${body} ${secret}` });
    trace.finish("error", secret);
    const bytes = fs.readFileSync(path.join(store.dir, fs.readdirSync(store.dir)[0]!), "utf8");
    for (const fragment of [secret, "FAKE-KEY", "Annemin", "randevusu", "doktor", "PRIVATE_KEY"]) assert.ok(!bytes.includes(fragment), fragment);
    const evidence = store.read().records[0]!;
    assert.deepEqual([evidence.outcome, evidence.errorCode, evidence.model, evidence.actions.length], ["error", null, null, 0]);
  });

  await scenario("the sink is best-effort: a failing sink, a running trace and a second finish change nothing", () => {
    let calls = 0;
    const failing = startAyasTrace({ rootKind: "chat-turn", store: new BoundedAyasTraceStore(), evidence: { record() { calls++; throw new Error("fixture sink failure"); } } });
    assert.doesNotThrow(() => failing.finish("ok"));
    assert.doesNotThrow(() => failing.finish("error"));
    assert.equal(calls, 1, "a finished trace is handed to the sink once");
    const traceStore = new BoundedAyasTraceStore(); const store = createAyasOperationEvidenceStore({ rootDir: dir() });
    const running = startAyasTrace({ rootKind: "chat-turn", scope: "s", store: traceStore, evidence: createAyasTraceEvidenceSink(store) });
    running.startSpan("model", "ayas-model", "route").end("ok");
    assert.deepEqual(store.read().records, []);
    assert.equal(deriveAyasTraceEvidence(traceStore.get(running.traceId, "s")!), undefined, "a running trace is not evidence");
    const disabled = startAyasTrace({ rootKind: "chat-turn", enabled: false, evidence: createAyasTraceEvidenceSink(store) });
    disabled.finish("ok");
    assert.deepEqual(store.read().records, []);
    // A read-only root: the append fails and the trace still finishes.
    const blocked = path.join(dir(), "blocked"); fs.writeFileSync(blocked, "a file where the audit root should be");
    const blockedStore = createAyasOperationEvidenceStore({ rootDir: blocked });
    assert.doesNotThrow(() => finishedTrace(blocked));
    assert.equal(blockedStore.append(finishedTrace(dir()).store.read().records[0]!), false);
  });

  await scenario("a lease becomes evidence from its identity, times and state, never from its plan or intent", () => {
    const completed = deriveAyasLeaseEvidence(leaseRecord({ capabilityScope: { agentId: "ayas-server" } as never }), NOW)!;
    assert.deepEqual([completed.source, completed.id, completed.task, completed.agent, completed.outcome, completed.errorCode, completed.durationMs, completed.endedAt],
      ["lease", AUTHZ, "tool:inspect-source-file", "ayas-server", "ok", null, 250, "2026-10-01T10:00:00.350Z"]);
    assert.deepEqual(completed.actions, [{ action: "inspect-source-file", outcome: "ok", errorCode: null, durationMs: 250, attempt: 1, binding: AUTHZ }]);
    const marker = "Annemin doktor randevusu";
    const withText = deriveAyasLeaseEvidence(leaseRecord({ capabilityScope: { agentId: "ayas-server" } as never, intent: marker, plan: { userText: marker, filePath: marker } }), NOW)!;
    assert.deepEqual(withText, completed, "plan and intent do not reach the evidence or its digest");
    assert.ok(!JSON.stringify(withText).includes("Annemin"));
    const cases: readonly [Partial<AyasExecutionAuthorizationRecord>, number, string, string | null][] = [
      [{ state: "failed", failureReason: "TOOL_INPUT_DENIED" }, NOW, "error", "TOOL_INPUT_DENIED"],
      [{ state: "failed", failureReason: "a raw error message with C:\\Users\\owner" }, NOW, "error", null],
      [{ state: "failed", failureReason: "API_KEY_REJECTED" }, NOW, "error", null],
      [{ state: "failed", failureReason: "OWNER_PASSWORD_WRONG" }, NOW, "error", null],
      [{ state: "revoked", revokedAt: "2026-10-01T10:00:00.200Z", settledAt: undefined }, NOW, "revoked", null],
      [{ state: "expired", consumedAt: undefined, settledAt: undefined }, LATER, "expired", null],
      [{ state: "granted", consumedAt: undefined, settledAt: undefined }, NOW, "unsettled", null],
      [{ state: "granted", consumedAt: undefined, settledAt: undefined }, LATER, "expired", null],
      [{ state: "consumed", settledAt: undefined }, NOW, "unsettled", null],
      // Consumed and never settled: the adapter may have run. That is not "expired" and not "ok".
      [{ state: "consumed", settledAt: undefined }, LATER, "unsettled", null],
    ];
    for (const [over, now, outcome, errorCode] of cases) {
      const evidence = deriveAyasLeaseEvidence(leaseRecord(over), now)!;
      assert.deepEqual([evidence.outcome, evidence.errorCode], [outcome, errorCode], JSON.stringify(over));
      assert.ok(isAyasOperationEvidence(evidence));
    }
    // A run lease is named after its own action; an unknown requester is not copied.
    const run = deriveAyasLeaseEvidence(leaseRecord({ action: "observer-discovery.run", requestedBy: "ayas-observer-discovery" }), NOW)!;
    assert.deepEqual([run.task, run.agent], ["observer-discovery.run", "ayas-observer-discovery"]);
    assert.equal(deriveAyasLeaseEvidence(leaseRecord({ requestedBy: "Owner Approved Me" }), NOW)!.agent, "unknown");
    for (const bad of [{ authorizationId: "owner-approved" }, { action: "rm -rf" }, { createdAt: "yesterday" }, { expiresAt: "" }]) assert.equal(deriveAyasLeaseEvidence(leaseRecord(bad as never), NOW), undefined, JSON.stringify(bad));
    assert.deepEqual([...AYAS_OPERATION_OUTCOMES], ["ok", "error", "denied", "fallback", "cancelled", "expired", "revoked", "unsettled"]);
  });

  await scenario("a real dispatch reports the lease that admitted it, and that lease is the durable record", async () => {
    const store = new AyasExecutionAuthorizationStore({ rootDir: dir() });
    const rawRequest = { schemaVersion: "1", action: "inspect-source-file", requestedBy: "ayas-chat", intent: "fixture", plan: { filePath: "src/example.ts" } };
    const ok = await withAyasActionRuntimeAuthorizationStore(store, () => runAyasReadOnlyAction({ rawRequest, resolveExecutor: () => async (request) => ({ action: request.action, write: false, summary: "fixture", data: {} }) }));
    assert.ok(ok.executed); if (ok.executed) assert.equal(ok.authorizationId, store.list()[0]!.authorizationId);
    const failingStore = new AyasExecutionAuthorizationStore({ rootDir: dir() });
    const failed = await withAyasActionRuntimeAuthorizationStore(failingStore, () => runAyasReadOnlyAction({ rawRequest, resolveExecutor: () => async () => { throw new Error("fixture executor failure"); } }));
    assert.equal(failed.executed, false); if (!failed.executed) assert.equal(failed.authorizationId, failingStore.list()[0]!.authorizationId);
    const refused = await withAyasActionRuntimeAuthorizationStore(store, () => runAyasReadOnlyAction({ rawRequest: { ...rawRequest, action: "resume-stage" } }));
    assert.equal(refused.executed, false); if (!refused.executed) assert.equal(refused.authorizationId, undefined, "a refused request has no lease");
    const evidence = deriveAyasLeaseEvidence(failingStore.list()[0]!, Date.now())!;
    assert.deepEqual([evidence.task, evidence.outcome, evidence.errorCode, evidence.agent], ["tool:inspect-source-file", "error", "EXECUTOR_FAILED", "ayas-server"]);
  });

  await scenario("the store keeps only valid evidence and reads back only what still fits the shape", () => {
    const root = dir(); const store = createAyasOperationEvidenceStore({ rootDir: root });
    const good = finishedTrace(dir()).store.read().records[0]!;
    assert.equal(store.append(good), true);
    const bad: readonly unknown[] = [
      null, {}, { ...good, extra: "field" }, { ...good, id: "not-a-uuid" }, { ...good, task: "Chat Turn With Text" }, { ...good, agent: "Owner" }, { ...good, durationMs: -1 }, { ...good, durationMs: 1.5 },
      { ...good, endedAt: "2020-01-01T00:00:00.000Z" }, { ...good, outcome: "approved" }, { ...good, errorCode: "lowercase text" }, { ...good, evidenceDigest: "short" }, { ...good, retries: -1 },
      { ...good, model: { entryId: "has spaces", state: "PINNED", pin: "MATCH" } }, { ...good, model: { ...MODEL, note: "text" } }, { ...good, approvalBinding: "x y" },
      { ...good, actions: [{ ...good.actions[0]!, action: "rm -rf" }] }, { ...good, actions: [{ ...good.actions[0]!, binding: "owner-approved" }] }, { ...good, actions: [{ ...good.actions[0]!, note: "text" }] },
      { ...good, source: "lease" }, { ...good, schemaVersion: "2" },
    ];
    for (const record of bad) { assert.equal(isAyasOperationEvidence(record), false, JSON.stringify(record)?.slice(0, 80)); assert.equal(store.append(record as AyasOperationEvidence), false); }
    assert.deepEqual(store.read().records, [good]);
    // Lines written by anything else are counted and skipped.
    const file = path.join(store.dir, fs.readdirSync(store.dir)[0]!);
    fs.appendFileSync(file, `not json\n${JSON.stringify({ ...good, task: "Annemin randevusu" })}\n${"x".repeat(AYAS_EVIDENCE_MAX_LINE_BYTES + 1)}\n${JSON.stringify(good)}\n`);
    const read = store.read();
    assert.deepEqual([read.records.length, read.rejectedLines], [1, 3], "a duplicate of a known record is not a new record and not an error");
    // A record moved into another day's file is not evidence of that day.
    fs.writeFileSync(path.join(store.dir, "2020-01-01.jsonl"), `${JSON.stringify({ ...good, id: crypto.randomUUID() })}\n`);
    assert.deepEqual([store.read().records.length, store.read().rejectedLines], [1, 4]);
    // The first record for an id stands.
    const rewritten = { ...good, outcome: "error" as const };
    assert.equal(store.append(rewritten), true);
    assert.equal(store.read().records.find((record) => record.id === good.id)!.outcome, "ok");
    assert.deepEqual(store.read({ sinceDay: "2999-01-01" }).records, []);
  });

  await scenario("retention removes whole old days, never today, and a dry run removes nothing", () => {
    const store = createAyasOperationEvidenceStore({ rootDir: dir() });
    const base = finishedTrace(dir()).store.read().records[0]!;
    const at = (day: string): AyasOperationEvidence => ({ ...base, id: crypto.randomUUID(), startedAt: `${day}T10:00:00.000Z`, endedAt: `${day}T10:00:01.000Z` });
    for (const day of ["2026-06-01", "2026-07-02", "2026-09-30", "2026-10-01"]) assert.equal(store.append(at(day)), true);
    fs.writeFileSync(path.join(store.dir, "notes.txt"), "not a day file");
    const nowMs = Date.parse("2026-10-01T12:00:00.000Z");
    assert.deepEqual(store.prune({ retentionDays: 90, nowMs, dryRun: true }), ["2026-06-01.jsonl", "2026-07-02.jsonl"]);
    assert.equal(fs.readdirSync(store.dir).length, 5);
    for (const invalid of [0, -1, 1.5, NaN]) assert.deepEqual(store.prune({ retentionDays: invalid, nowMs, dryRun: false }), []);
    assert.deepEqual(store.prune({ retentionDays: 90, nowMs: NaN, dryRun: false }), []);
    assert.deepEqual(store.prune({ retentionDays: 90, nowMs, dryRun: false }), ["2026-06-01.jsonl", "2026-07-02.jsonl"]);
    assert.deepEqual(fs.readdirSync(store.dir).sort(), ["2026-09-30.jsonl", "2026-10-01.jsonl", "notes.txt"]);
    // Even a one-day retention keeps today.
    assert.deepEqual(store.prune({ retentionDays: 1, nowMs, dryRun: false }), []);
    assert.deepEqual(store.prune({ retentionDays: 1, nowMs: nowMs + 2 * 86_400_000, dryRun: false }), ["2026-09-30.jsonl", "2026-10-01.jsonl"]);
    assert.equal(store.read().records.length, 0);
  });

  await scenario("an older trace snapshot without attributes still reads; unknown attribute keys are dropped", () => {
    const { trace } = finishedTrace(dir());
    void trace;
    const legacy = { schemaVersion: 1, traceId: crypto.randomUUID(), rootKind: "chat-turn", createdAt: "2026-10-01T10:00:00.000Z", endedAt: "2026-10-01T10:00:01.000Z", status: "ok", spans: [], events: [] };
    const read = readAyasTraceSnapshot(legacy) as AyasTraceSnapshot;
    assert.equal(read.attributes, undefined);
    assert.deepEqual(readAyasTraceSnapshot({ ...legacy, attributes: { model: MODEL, ownerApproved: true, note: "text", tools: [{ action: "query-graphify", authorizationId: AUTHZ, input: "secret" }] } })!.attributes,
      { model: MODEL, tools: [{ action: "query-graphify", authorizationId: AUTHZ }] });
    assert.equal(deriveAyasTraceEvidence(read)!.durationMs, 1000);
  });

  await scenario("wiring: the trace module stays free of storage, and the two trace roots hand their evidence to the audit root", () => {
    const trace = fs.readFileSync(path.join(repo, "src/lib/ayas/trace/AyasUnifiedTrace.ts"), "utf8");
    assert.deepEqual([...trace.matchAll(/^import [^;]+ from "([^"]+)";/gm)].map((match) => match[1]), ["node:crypto", "node:perf_hooks"]);
    const evidence = fs.readFileSync(path.join(repo, "src/lib/ayas/observability/AyasOperationEvidence.ts"), "utf8");
    assert.doesNotMatch(evidence, /node:fs|Date\.now|new Date\(\)/);
    assert.doesNotMatch(evidence, /record\.(?:plan|intent)\b/, "lease evidence must not read the plan or the intent");
    const route = fs.readFileSync(path.join(repo, "app/api/ayas/chat/stream/route.ts"), "utf8");
    assert.match(route, /startAyasTrace\(\{ rootKind: "chat-turn", scope: [^}]+, evidence: chatTraceEvidence \}\)/);
    const approval = fs.readFileSync(path.join(repo, "src/lib/brain/autonomy/AyasProposalApprovalService.ts"), "utf8");
    assert.match(approval, /createAyasOperationEvidenceStore\(\{ rootDir: ayasApprovalEvidenceRoot\(deps\) \}\)/);
    // The live gate root shares the one audit root; any other gate root keeps its evidence to itself, outside the repository.
    const live = path.join(temp, "live-repo");
    assert.equal(ayasApprovalEvidenceRoot({ repoRoot: live, gateRoot: path.join(live, "data", "brain", "self-improvement") }), path.join(live, "data", "brain"));
    assert.equal(ayasApprovalEvidenceRoot({ repoRoot: live, gateRoot: path.join(temp, "fixture-gate") }), path.join(temp, "fixture-gate"));
    assert.equal(ayasApprovalEvidenceRoot({ repoRoot: live, gateRoot: path.join(live, "data", "brain") }), path.join(live, "data", "brain"));
    // The approval binding is a digest: the trace never holds the proposal identifier (an existing trace invariant).
    assert.equal(approval.split("trace.annotate({ approvalBinding: ayasApprovalBindingDigest(proposalId, approvedProposalHash) })").length - 1, 2);
    assert.doesNotMatch(approval, /approvalBinding: proposalId\b/);
    const binding = ayasApprovalBindingDigest("ayas-proposal-11111111-2222-4333-8444-555555555555", "a".repeat(64));
    assert.match(binding, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(binding, ayasApprovalBindingDigest("ayas-proposal-11111111-2222-4333-8444-555555555555", "b".repeat(64)));
    const bound = startAyasTrace({ rootKind: "owner-approval", scope: "s", store: new BoundedAyasTraceStore() });
    bound.annotate({ approvalBinding: binding }); bound.finish("ok");
    // Evidence is written, never consulted: no module reads the stream to decide anything.
    const walk = (dirPath: string, out: string[] = []): string[] => { for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) { const full = path.join(dirPath, item.name);
      if (item.isDirectory()) { if (item.name !== "node_modules" && !item.name.startsWith(".")) walk(full, out); } else if (/\.(?:ts|tsx)$/.test(item.name)) out.push(full); } return out; };
    const readers = [...walk(path.join(repo, "src")), ...walk(path.join(repo, "app"))].filter((file) => /createAyasOperationEvidenceStore\([^)]*\)\s*\.read\(|\.read\(\{ sinceDay/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(repo, file).split(path.sep).join("/")).filter((file) => !file.startsWith("src/lib/ayas/observability/"));
    assert.deepEqual(readers, []);
  });

  console.log(`Stage 15F operation evidence: PASS (${count} scenarios; TEMP only; model/network/production actions 0)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
