import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";

import { streamAyasChat, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";
import { BoundedAyasTraceStore, readAyasTraceSnapshot, startAyasTrace, AYAS_TRACE_MAX_EVENTS, AYAS_TRACE_MAX_SPANS, type AyasTraceHandle, type AyasTraceSnapshot, type AyasTraceStore } from "../src/lib/ayas/trace/AyasUnifiedTrace";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";
import { AYAS_SESSION_COOKIE, issueSession } from "../src/lib/auth/accessGate";
import { GET as readTrace } from "../app/api/ayas/trace/[traceId]/route";
import { ayasTraceErrorCode, ayasTraceSessionScope, ayasTraceStore, isAyasTraceId } from "../src/lib/ayas/trace/AyasUnifiedTrace";

let passed = 0;
async function scenario(name: string, run: () => void | Promise<void>): Promise<void> {
  await run();
  passed += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${passed}: ${name}`);
}

function snapshot(): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-09T03:00:00.000Z", executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false }, errors: [],
    tasks: { total: 0, byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 }, pendingApproval: 0, skippedUnsafe: 0, items: [] },
    cyclesRecorded: 0, experience: { total: 0 },
    safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
  };
}

function mockProvider(reply: string, fail: boolean | "abort" = false): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    if (fail) {
      const error = new Error("Bearer SECRET_API_KEY=trace-must-never-store-this");
      if (fail === "abort") error.name = "AbortError";
      throw error;
    }
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ message: { content: reply }, done: false }) + "\n"));
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ done: true }) + "\n"));
      controller.close();
    } });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

const roots: string[] = [];
function tempMemory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-trace-memory-"));
  roots.push(root);
  return root;
}

async function chat(trace: AyasTraceHandle | undefined, reply = "Merhaba, sana nasıl yardımcı olabilirim?", fail: boolean | "abort" = false, memoryRoot = tempMemory()): Promise<AyasChatStreamEvent[]> {
  const events: AyasChatStreamEvent[] = [];
  for await (const event of streamAyasChat({ text: "selam SECRET_API_KEY=private-turn-body", snapshot: snapshot(), seq: 1, fetcher: mockProvider(reply, fail), memoryStore: { rootDir: memoryRoot }, ...(trace ? { trace } : {}) })) events.push(event);
  return events;
}

/** Every span/event belongs to this trace, every parent exists in it, nothing is left running. */
function assertCausallyClosed(record: AyasTraceSnapshot): void {
  const ids = new Set(record.spans.map((span) => span.spanId));
  assert.equal(ids.size, record.spans.length, "span IDs are unique");
  assert.ok(record.spans.every((span) => span.parentSpanId === null || ids.has(span.parentSpanId)), "no dangling parent");
  assert.ok(record.spans.every((span) => span.status !== "running" && typeof span.endedAt === "string" && Number.isFinite(span.durationMs)), "no dangling span");
  assert.ok(record.events.every((event) => event.traceId === record.traceId && (event.spanId === null || ids.has(event.spanId))), "no event bleed");
}

async function main(): Promise<void> {
  const store = new BoundedAyasTraceStore();
  await scenario("real chat turn has one causal context → memory → model → answer trace", async () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "session-a", store });
    const events = await chat(trace);
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    trace.finish(done.source === "llm" ? "ok" : "fallback");
    const record = store.get(trace.traceId, "session-a");
    assert.ok(record);
    assert.equal(record.status, done.source === "llm" ? "ok" : "fallback");
    const conversation = record.spans.find((span) => span.kind === "conversation");
    assert.ok(conversation);
    assert.ok(record.spans.some((span) => span.kind === "context" && span.parentSpanId === conversation.spanId));
    assert.ok(record.spans.some((span) => span.kind === "memory" && span.parentSpanId === conversation.spanId));
    assert.ok(record.spans.some((span) => span.kind === "model" && span.operation === "stream" && span.parentSpanId === conversation.spanId));
    assert.ok(record.spans.every((span) => span.status !== "running" && Number.isFinite(span.durationMs)));
    assert.ok(!JSON.stringify(record).includes("private-turn-body"));
    assert.equal(store.get(trace.traceId, "session-b"), undefined, "another session cannot read this trace");
  });

  await scenario("provider transport failure keeps domain fallback and safe error code", async () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "session-a", store });
    const events = await chat(trace, "unused", true);
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    assert.equal(done.source, "fallback");
    trace.finish("fallback");
    const record = store.get(trace.traceId, "session-a")!;
    assert.ok(record.spans.some((span) => span.kind === "model" && span.status === "error" && span.errorCode === "PROVIDER_FAILURE"));
    assert.ok(!JSON.stringify(record).includes("trace-must-never-store-this"));
  });

  await scenario("aborted model call is marked cancelled without leaking the transport error", async () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "cancel", store });
    const events = await chat(trace, "unused", "abort");
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    assert.equal(done.source, "fallback");
    trace.finish("fallback");
    const record = store.get(trace.traceId, "cancel")!;
    assert.ok(record.spans.some((span) => span.kind === "model" && span.status === "cancelled" && span.errorCode === "ABORTED"));
    assert.ok(!JSON.stringify(record).includes("trace-must-never-store-this"));
  });

  await scenario("parallel children, domain accounting code and completion exactly once", () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "parallel", store });
    const parent = trace.startSpan("conversation", "ayas-chat", "stream-turn");
    const memory = trace.startSpan("memory", "ayas-memory", "recall", parent.spanId);
    const model = trace.startSpan("model", "ayas-model", "stream", parent.spanId);
    memory.end("ok", { candidateCount: 3, selectedCount: 2 });
    model.end("error", undefined, "AI_USAGE_PERSISTENCE_FAILED");
    model.end("ok");
    parent.end("fallback");
    trace.finish("fallback");
    trace.finish("ok");
    const record = store.get(trace.traceId, "parallel")!;
    assert.equal(record.status, "fallback");
    assert.equal(record.spans.find((span) => span.spanId === model.spanId)?.status, "error");
    assert.equal(record.spans.find((span) => span.spanId === model.spanId)?.errorCode, "AI_USAGE_PERSISTENCE_FAILED");
    assert.deepEqual(record.spans.filter((span) => span.parentSpanId === parent.spanId).map((span) => span.kind), ["memory", "model"]);
    assert.equal(trace.startSpan("tool", "ayas-tool", "dispatch", "forged-parent").spanId, null);
  });

  await scenario("a process-local trace does not pretend to survive restart", () => {
    const firstProcess = new BoundedAyasTraceStore();
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "restart", store: firstProcess });
    trace.finish("ok");
    assert.ok(firstProcess.get(trace.traceId, "restart"));
    assert.equal(new BoundedAyasTraceStore().get(trace.traceId, "restart"), undefined);
  });

  await scenario("correction retry stays in the original causal trace", async () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "session-a", store });
    const events = await chat(trace, "Yürütme kapısını açıyorum ve başlatıyorum.");
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    if (done?.type !== "done") return;
    trace.finish(done.source === "llm" ? "ok" : "fallback");
    const record = store.get(trace.traceId, "session-a")!;
    assert.ok(record.events.some((event) => event.type === "retry"));
    assert.ok(record.spans.some((span) => span.kind === "model" && span.operation === "correction" && span.attempt === 2 && span.status !== "running"));
    assert.equal(new Set(record.spans.map((span) => span.spanId)).size, record.spans.length);
  });

  await scenario("a correction retry cancelled by the client is recorded as cancelled, not as a provider failure", async () => {
    let modelCalls = 0;
    const firstOkThenAbort = (async (url: string) => {
      if (String(url).includes("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
      modelCalls += 1;
      if (modelCalls > 1) {
        const abort = new Error("client went away");
        abort.name = "AbortError";
        throw abort;
      }
      return mockProvider("Yürütme kapısını açıyorum ve başlatıyorum.")(url);
    }) as unknown as typeof fetch;
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "correction-abort", store });
    const events: AyasChatStreamEvent[] = [];
    for await (const event of streamAyasChat({ text: "selam", snapshot: snapshot(), seq: 1, fetcher: firstOkThenAbort, memoryStore: { rootDir: tempMemory() }, trace })) events.push(event);
    assert.equal(events.at(-1)?.type, "done", "the domain still answers with its safe fallback");
    trace.finish("fallback");
    const record = store.get(trace.traceId, "correction-abort")!;
    const correction = record.spans.find((span) => span.operation === "correction");
    assert.deepEqual([correction?.status, correction?.errorCode, correction?.attempt], ["cancelled", "ABORTED", 2]);
    assertCausallyClosed(record);
  });

  await scenario("parallel turns never share a trace or parent span", async () => {
    const left = startAyasTrace({ rootKind: "chat-turn", scope: "left", store });
    const right = startAyasTrace({ rootKind: "chat-turn", scope: "right", store });
    await Promise.all([chat(left), chat(right)]);
    left.finish("ok"); right.finish("ok");
    const a = store.get(left.traceId, "left")!;
    const b = store.get(right.traceId, "right")!;
    assert.notEqual(a.traceId, b.traceId);
    assert.ok(a.spans.every((span) => !span.parentSpanId || a.spans.some((parent) => parent.spanId === span.parentSpanId)));
    assert.ok(b.spans.every((span) => !span.parentSpanId || b.spans.some((parent) => parent.spanId === span.parentSpanId)));
    assert.ok(a.spans.every((span) => !b.spans.some((other) => other.spanId === span.spanId)));
  });

  await scenario("disabled and failing trace store leave the answer unchanged", async () => {
    const noTrace = await chat(undefined);
    const disabled = startAyasTrace({ rootKind: "chat-turn", enabled: false });
    const withDisabled = await chat(disabled);
    const broken: AyasTraceStore = { put() { throw new Error("trace store failed"); }, get() { throw new Error("trace store failed"); }, latest() { throw new Error("trace store failed"); } };
    const failing = startAyasTrace({ rootKind: "chat-turn", store: broken });
    const withFailure = await chat(failing);
    assert.deepEqual(withDisabled, noTrace);
    assert.deepEqual(withFailure, noTrace);
  });

  await scenario("metadata, codes and schema reader cannot disclose raw payloads", () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "privacy", store });
    const span = trace.startSpan("model", "secret-component", "secret-operation");
    span.event("failed", "error", { candidateCount: 2, secretBody: "do-not-emit" } as never, "TOKEN_PRIVATE");
    span.end("error", { secretBody: "do-not-emit" } as never, "TOKEN_PRIVATE");
    span.end("ok");
    trace.finish("error");
    const record = store.get(trace.traceId, "privacy")!;
    assert.equal(record.spans[0]?.component, "unknown");
    assert.equal(record.spans[0]?.operation, "unknown");
    assert.equal(record.spans[0]?.status, "error");
    assert.ok(!JSON.stringify(record).includes("do-not-emit"));
    assert.equal(readAyasTraceSnapshot({ schemaVersion: 2, traceId: "x", spans: [], events: [] }), undefined);
    const parsed = readAyasTraceSnapshot({ ...record, spans: [{ ...record.spans[0], kind: "future-kind", prompt: "do-not-emit" }], events: [{ ...record.events[0], type: "future-event", body: "do-not-emit" }] });
    assert.ok(parsed);
    assert.ok(!JSON.stringify(parsed).includes("do-not-emit"));
  });

  await scenario("retention, event and span caps bound memory", () => {
    let now = 1_000;
    const bounded = new BoundedAyasTraceStore(2, 10, () => now);
    const first = startAyasTrace({ rootKind: "chat-turn", scope: "s", store: bounded });
    const second = startAyasTrace({ rootKind: "chat-turn", scope: "s", store: bounded });
    const third = startAyasTrace({ rootKind: "chat-turn", scope: "s", store: bounded });
    assert.equal(bounded.get(first.traceId, "s"), undefined);
    assert.ok(bounded.get(second.traceId, "s"));
    for (let i = 0; i < AYAS_TRACE_MAX_SPANS + 20; i += 1) third.startSpan("context", "ayas-context", "assemble").end("ok");
    for (let i = 0; i < AYAS_TRACE_MAX_EVENTS + 20; i += 1) third.event("completed", "ok");
    assert.equal(bounded.get(third.traceId, "s")?.spans.length, AYAS_TRACE_MAX_SPANS);
    assert.equal(bounded.get(third.traceId, "s")?.events.length, AYAS_TRACE_MAX_EVENTS);
    now += 11;
    assert.equal(bounded.get(third.traceId, "s"), undefined);
  });

  await scenario("diagnostic endpoint: only the same live session reads; every other read fails closed and nothing private is returned", async () => {
    const previousKey = process.env.AYAS_ACCESS_KEY;
    const previousNodeEnv = process.env.NODE_ENV;
    const key = "fixture-access-key-for-trace-test";
    process.env.AYAS_ACCESS_KEY = key;
    try {
      const token = await issueSession(key);
      const otherToken = await issueSession(key, Date.now() - 2_000);
      const expiredToken = await issueSession(key, Date.now() - 13 * 60 * 60 * 1000);
      const dot = token.indexOf(".");
      const tamperedToken = `${token.slice(0, dot + 1)}${token.slice(dot + 1).split("").reverse().join("")}`;
      assert.notEqual(token, otherToken);
      assert.notEqual(tamperedToken, token);
      // A real traced chat turn whose input carries a secret-looking body.
      const trace = startAyasTrace({ rootKind: "chat-turn", scope: ayasTraceSessionScope(token), store: ayasTraceStore });
      await chat(trace);
      trace.finish("ok");
      const read = (traceId: string, cookie?: string) => readTrace(
        new NextRequest(`http://localhost/api/ayas/trace/${encodeURIComponent(traceId)}`, cookie ? { headers: { cookie: `${AYAS_SESSION_COOKIE}=${cookie}` } } : undefined),
        { params: Promise.resolve({ traceId }) },
      );

      for (const cookie of [undefined, tamperedToken, expiredToken, "not-a-session"]) {
        const denied = await read(trace.traceId, cookie);
        assert.equal(denied.status, 401, "unauthenticated, tampered, expired and garbage sessions are denied");
        assert.equal(denied.headers.get("cache-control"), "no-store");
      }
      assert.equal((await read(trace.traceId, otherToken)).status, 404, "another valid session cannot read this trace");
      for (const traceId of ["", "not-a-uuid", "../../etc/passwd", `${trace.traceId}x`, crypto.randomUUID()]) {
        const missing = await read(traceId, token);
        assert.equal(missing.status, 404, `malformed, forged or unknown ID ${JSON.stringify(traceId)} is indistinguishable from not-found`);
        assert.equal(missing.headers.get("cache-control"), "no-store");
      }
      assert.equal(isAyasTraceId(trace.traceId), true);

      const operatorTrace = startAyasTrace({ rootKind: "owner-approval", store: ayasTraceStore });
      operatorTrace.finish("ok");
      assert.equal((await read(operatorTrace.traceId, token)).status, 404, "owner-approval traces are never reachable from a browser session");

      const own = await read(trace.traceId, token);
      assert.equal(own.status, 200);
      assert.equal(own.headers.get("cache-control"), "no-store");
      const body = await own.text();
      assert.equal((JSON.parse(body) as { traceId: string }).traceId, trace.traceId);
      for (const secret of ["private-turn-body", "SECRET_API_KEY", "selam", token, ayasTraceSessionScope(token), key]) {
        assert.ok(!body.includes(secret), "the response carries no prompt text, session token, scope or access key");
      }

      process.env.AYAS_ACCESS_KEY = "short";
      assert.equal((await read(trace.traceId, token)).status, 401, "a misconfigured gate fails closed even for a previously valid session");
      delete process.env.AYAS_ACCESS_KEY;
      const devTrace = startAyasTrace({ rootKind: "chat-turn", scope: ayasTraceSessionScope(undefined), store: ayasTraceStore });
      devTrace.finish("ok");
      assert.equal((await read(devTrace.traceId)).status, 200, "local dev without a key reads its own cookie-less traces");
      assert.equal((await read(trace.traceId)).status, 404, "…but never a real session's traces");
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      assert.equal((await read(devTrace.traceId)).status, 401, "production without a key is misconfigured and fails closed");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv;
      if (previousNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
      if (previousKey === undefined) delete process.env.AYAS_ACCESS_KEY;
      else process.env.AYAS_ACCESS_KEY = previousKey;
    }
  });

  await scenario("one process-wide trace store is adopted by every module instance (chat route and trace route agree)", async () => {
    const claimed = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("atolye.ayas.unified-trace.store.v1"));
    assert.equal(claimed?.value, ayasTraceStore);
    assert.equal(claimed?.writable, false);
    const url = `${pathToFileURL(path.resolve("src/lib/ayas/trace/AyasUnifiedTrace.ts")).href}?instance=second`;
    const second = (await import(url)) as typeof import("../src/lib/ayas/trace/AyasUnifiedTrace");
    assert.notEqual(second.startAyasTrace, startAyasTrace, "a genuinely separate module instance");
    assert.equal(second.ayasTraceStore, ayasTraceStore, "…that adopts the already-claimed store");
    const trace = second.startAyasTrace({ rootKind: "chat-turn", scope: "cross-instance" });
    trace.finish("ok");
    assert.equal(ayasTraceStore.get(trace.traceId, "cross-instance")?.status, "ok");
  });

  await scenario("an unreadable memory store is visible in the trace and the answer stays identical", async () => {
    const brokenMemory = tempMemory();
    fs.mkdirSync(path.join(brokenMemory, "memory"), { recursive: true });
    fs.writeFileSync(path.join(brokenMemory, "memory", "records.json"), "{ not json", "utf8");
    const expected = await chat(undefined, undefined, false, brokenMemory);
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "memory-failure", store });
    const observed = await chat(trace, undefined, false, brokenMemory);
    trace.finish("ok");
    assert.deepEqual(observed, expected);
    const record = store.get(trace.traceId, "memory-failure")!;
    const memory = record.spans.find((span) => span.kind === "memory");
    assert.equal(memory?.status, "error");
    assert.equal(memory?.errorCode, "MEMORY_UNREADABLE");
    // Memory Temporal v2 adds the query-mode flags; an unreadable store reports no temporal counts.
    assert.deepEqual(memory?.metadata, { candidateCount: 0, selectedCount: 0, identityCount: 0, temporalAsOf: false, temporalHistory: false });
    assert.equal(fs.readFileSync(path.join(brokenMemory, "memory", "records.json"), "utf8"), "{ not json", "tracing never repairs or rewrites domain state");
    assertCausallyClosed(record);
  });

  await scenario("malformed trace input never throws, never leaks, and error-code extraction cannot replace a domain error", () => {
    const trace = startAyasTrace({ rootKind: "chat-turn", scope: "malformed", store });
    const span = trace.startSpan("model", "ayas-model", "stream");
    const hostile = Object.defineProperty({}, "candidateCount", { enumerable: true, get() { throw new Error("getter-secret"); } });
    const cyclic: Record<string, unknown> = { candidateCount: 1, body: "cyclic-secret" };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => span.event("completed", "ok", hostile as never));
    assert.doesNotThrow(() => span.event("not-a-type" as never, "ok"));
    assert.doesNotThrow(() => span.event("completed", "not-a-status" as never));
    assert.equal(trace.startSpan("not-a-kind" as never, "ayas-model", "stream").spanId, null);
    assert.doesNotThrow(() => span.end("ok", cyclic as never, { toString() { throw new Error("code-secret"); } } as never));
    trace.finish("ok");
    const record = store.get(trace.traceId, "malformed")!;
    assert.deepEqual(record.spans[0]?.metadata, { candidateCount: 1 });
    assert.equal(record.events.length, 1, "only the terminal event was accepted");
    assert.ok(!/secret/.test(JSON.stringify(record)));

    assert.equal(ayasTraceErrorCode({ code: "PROPOSAL_HASH_MISMATCH" }), "PROPOSAL_HASH_MISMATCH");
    assert.equal(ayasTraceErrorCode({ code: "AYAS_API_KEY_REJECTED" }), undefined, "secret-looking codes are dropped");
    assert.equal(ayasTraceErrorCode({ code: "lower-case" }), undefined);
    assert.equal(ayasTraceErrorCode(Object.defineProperty({}, "code", { get() { throw new Error("boom"); } })), undefined);
    assert.equal(ayasTraceErrorCode(new Proxy({}, { has() { throw new Error("boom"); } })), undefined);
    assert.equal(ayasTraceErrorCode(null), undefined);

    assert.equal(readAyasTraceSnapshot(null), undefined);
    assert.equal(readAyasTraceSnapshot({ schemaVersion: 1, traceId: crypto.randomUUID(), rootKind: "future-root", spans: [], events: [] }), undefined);
    assert.equal(readAyasTraceSnapshot({ schemaVersion: 1, traceId: crypto.randomUUID(), rootKind: "chat-turn", spans: "not-array", events: [] }), undefined);
    const garbage = readAyasTraceSnapshot({ schemaVersion: 1, traceId: crypto.randomUUID(), rootKind: "chat-turn", status: "exploded", spans: [null, 7, { spanId: "not-uuid" }, { spanId: crypto.randomUUID(), status: "odd", startedAt: "yesterday" }], events: [null, { type: "odd", status: "odd", at: 5 }] });
    assert.equal(garbage?.status, "error");
    assert.equal(garbage?.spans.length, 1);
    assert.equal(garbage?.spans[0]?.startedAt, new Date(0).toISOString());
    assert.equal(garbage?.events.length, 1);
  });

  await scenario("eight concurrent mixed turns (success, provider failure, abort) stay causally isolated", async () => {
    const modes = [false, true, "abort", false, true, false, "abort", false] as const;
    const traces = modes.map((_, index) => startAyasTrace({ rootKind: "chat-turn", scope: `concurrent-${index}`, store }));
    const results = await Promise.all(modes.map((mode, index) => chat(traces[index], undefined, mode)));
    const seenSpans = new Set<string>();
    modes.forEach((mode, index) => {
      const done = results[index]!.at(-1);
      assert.equal(done?.type, "done");
      traces[index]!.finish(mode === false ? "ok" : mode === "abort" ? "cancelled" : "fallback");
      const record = store.get(traces[index]!.traceId, `concurrent-${index}`)!;
      assertCausallyClosed(record);
      const model = record.spans.find((span) => span.kind === "model" && span.operation === "stream")!;
      if (mode === false) assert.equal(model.status, "ok");
      else if (mode === "abort") assert.deepEqual([model.status, model.errorCode], ["cancelled", "ABORTED"]);
      else assert.deepEqual([model.status, model.errorCode], ["error", "PROVIDER_FAILURE"]);
      for (const span of record.spans) {
        assert.ok(!seenSpans.has(span.spanId), "no span is shared between concurrent traces");
        seenSpans.add(span.spanId);
      }
    });
    assert.equal(new Set(traces.map((trace) => trace.traceId)).size, traces.length);
  });

  await scenario("measured observer overhead on a TEMP chat fixture (interleaved, warmed up) without changing answers", async () => {
    const memoryRoot = tempMemory();
    const perfStore = new BoundedAyasTraceStore();
    const expected = await chat(undefined, undefined, false, memoryRoot);
    for (let i = 0; i < 20; i += 1) {
      await chat(undefined, undefined, false, memoryRoot);
      await chat(startAyasTrace({ rootKind: "chat-turn", scope: "warmup", store: perfStore }), undefined, false, memoryRoot);
    }
    const disabled: number[] = [];
    const enabled: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const runDisabled = async () => {
        const start = performance.now();
        const events = await chat(startAyasTrace({ rootKind: "chat-turn", enabled: false }), undefined, false, memoryRoot);
        disabled.push(performance.now() - start);
        assert.deepEqual(events, expected);
      };
      const runEnabled = async () => {
        const start = performance.now();
        const events = await chat(startAyasTrace({ rootKind: "chat-turn", scope: "benchmark", store: perfStore }), undefined, false, memoryRoot);
        enabled.push(performance.now() - start);
        assert.deepEqual(events, expected);
      };
      // Alternate order so neither arm systematically runs first.
      if (i % 2 === 0) { await runDisabled(); await runEnabled(); } else { await runEnabled(); await runDisabled(); }
    }
    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
      return { meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)), medianMs: Number(at(0.5).toFixed(4)), p95Ms: Number(at(0.95).toFixed(4)) };
    };
    const off = stats(disabled);
    const on = stats(enabled);

    // Real (uncapped) span cost: rotate to a fresh trace before the per-trace span cap is reached.
    const primitiveStore = new BoundedAyasTraceStore();
    let primitiveTrace = startAyasTrace({ rootKind: "chat-turn", scope: "primitive", store: primitiveStore });
    let recorded = 0;
    const primitiveStart = performance.now();
    for (let i = 0; i < 10_000; i += 1) {
      if (i % (AYAS_TRACE_MAX_SPANS - 1) === 0) primitiveTrace = startAyasTrace({ rootKind: "chat-turn", scope: "primitive", store: primitiveStore });
      const span = primitiveTrace.startSpan("context", "ayas-context", "assemble");
      span.end("ok", { historyCount: i });
      if (span.spanId) recorded += 1;
    }
    const perSpanUs = ((performance.now() - primitiveStart) / 10_000) * 1000;
    assert.equal(recorded, 10_000, "every measured span was a real recorded span, not a capped no-op");

    console.log(JSON.stringify({
      benchmark: "chat-turn-trace-overhead",
      iterationsPerArm: disabled.length,
      traceOff: off,
      traceOn: on,
      medianOverheadMs: Number((on.medianMs - off.medianMs).toFixed(4)),
      medianOverheadPct: Number((((on.medianMs - off.medianMs) / off.medianMs) * 100).toFixed(2)),
      spanStartEndMicroseconds: Number(perSpanUs.toFixed(3)),
    }));
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-unified-trace", scenarios: passed }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  const temp = path.resolve(os.tmpdir()) + path.sep;
  for (const root of roots) if (path.resolve(root).startsWith(temp)) fs.rmSync(root, { recursive: true, force: true });
});
