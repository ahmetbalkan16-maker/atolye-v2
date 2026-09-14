/**
 * AYAS chat token-streaming smoke suite (spec §4).
 *
 * Deterministic / $0 / no network (Ollama's NDJSON stream is a mock). Covers:
 *  - incremental `delta` events then one terminal `done`; the concatenated
 *    deltas equal the final text for a clean reply;
 *  - the safety backstop: a completed reply that claims/offers execution, or an
 *    unusable one, terminates `corrected: true` + the deterministic fallback;
 *  - empty input, a non-200 Ollama response, a thrown fetch, an aborted signal,
 *    and a malformed NDJSON line — all terminate with a `fallback` `done`;
 *  - the prompt is built in `format: "text"` (no `{ reply }` envelope).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  streamAyasChat as productionStreamAyasChat,
  ayasChatStreamEventToSse,
  type StreamAyasChatInput,
} from "../src/lib/ayas/AyasChatStream";
import { buildAyasChatPrompt } from "../src/components/brain/brainCore";
import { createAyasMemoryStore } from "../src/lib/ayas/memory/AyasMemoryStore";
import { buildBrainMemoryRecord } from "../src/lib/brain/BrainMemoryModel";
import type { BrainConsoleSnapshot } from "../src/lib/brain/ui/BrainConsoleSnapshot";

let count = 0;
async function scenario(name: string, test: () => Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function snap(): BrainConsoleSnapshot {
  return {
    generatedAt: "2026-09-09T03:00:00.000Z",
    executionGate: "CLOSED",
    connected: { tasks: false, cycles: false, experience: false },
    errors: [],
    tasks: {
      total: 0,
      byStatus: { queued: 0, running: 0, "blocked-on-dependency": 0, "blocked-on-approval": 0, succeeded: 0, failed: 0, cancelled: 0, "skipped-unsafe": 0 },
      pendingApproval: 0, skippedUnsafe: 0, items: [],
    },
    cyclesRecorded: 0,
    experience: { total: 0 },
    safety: { decision: "proceed-with-constraints", snapshotSource: "unavailable", reasons: [], hardwareProfileId: "gtx-1650-4gb" },
  };
}

/**
 * A URL-aware mock `fetch`: the model router first probes `GET /api/tags`
 * (health) — always answer that "healthy" so Ollama is the routed provider —
 * then `POST /api/chat` behaves per `opts` (the streamed reply, or a failure).
 */
function mockOllamaStream(pieces: string[], opts: { status?: number; noBody?: boolean; throwErr?: boolean } = {}): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    }
    if (opts.throwErr) throw new Error("ECONNREFUSED");
    if (opts.noBody) return new Response(null, { status: opts.status ?? 200 });
    if ((opts.status ?? 200) !== 200) return new Response("err", { status: opts.status });
    const lines = [
      ...pieces.map((p) => JSON.stringify({ message: { content: p }, done: false })),
      "{ this is a malformed line }",
      JSON.stringify({ done: true, done_reason: "stop" }),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l + "\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

async function collect(gen: AsyncGenerator<{ type: string } & Record<string, unknown>>) {
  const events: ({ type: string } & Record<string, unknown>)[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** Same as `mockOllamaStream`, but also captures the REAL `/api/chat` request body (the actual prompt sent) into `capturedBodies` — for asserting what the model would really receive, not just what the mocked reply says back. */
function capturingMockOllamaStream(pieces: string[], capturedBodies: string[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/tags")) {
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    }
    if (String(url).includes("/api/chat") && init?.body) {
      capturedBodies.push(String(init.body));
    }
    const lines = [
      ...pieces.map((p) => JSON.stringify({ message: { content: p }, done: false })),
      JSON.stringify({ done: true, done_reason: "stop" }),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const l of lines) controller.enqueue(enc.encode(l + "\n"));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
  }) as unknown as typeof fetch;
}

const testMemoryRoots = new Set<string>();

function tmpMemRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-chatstream-mem-"));
  testMemoryRoots.add(root);
  return root;
}

async function* streamAyasChat(input: StreamAyasChatInput) {
  if (input.memoryStore) {
    yield* productionStreamAyasChat(input);
    return;
  }
  yield* productionStreamAyasChat({ ...input, memoryStore: { rootDir: tmpMemRoot() } });
}

/** Pulls the real prompt text out of the captured Ollama `/api/chat` request body — `{model, messages:[{role:"user", content: <the real prompt>}], stream:true, options:{...}}`. */
function promptFromCapturedBody(body: string): string {
  const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
  return parsed.messages?.[0]?.content ?? "";
}

async function run() {
  await scenario("prompt — streaming uses format:text (no { reply } envelope)", async () => {
    const p = buildAyasChatPrompt({ userText: "selam", snapshot: snap(), history: [], format: "text" });
    assert.ok(!p.includes('{ "reply":'), "text-mode prompt must not ask for the JSON envelope");
    assert.match(p, /Doğrudan, düz metin/);
    // default still has the envelope (back-compat)
    const j = buildAyasChatPrompt({ userText: "selam", snapshot: snap(), history: [] });
    assert.match(j, /"reply":/);
  });

  await scenario("prompt — never cues a self-introduction; history is a continuation", async () => {
    // No literal "Ben AYAS ..." example phrase, and an explicit negative rule.
    const cold = buildAyasChatPrompt({ userText: "kaç proje var", snapshot: snap(), history: [], format: "text" });
    assert.doesNotMatch(cold, /Ben AYAS, Atölye'nin yapay zekâ çekirdeğiyim/);
    assert.match(cold, /ASLA yeniden tanıtma/);
    assert.match(cold, /Selamlama.*giriş cümlesi kurma|giriş cümlesi kurma/);

    // With prior turns, an explicit "this is a continuation, don't greet" line,
    // and the system welcome line is filtered OUT of the model history.
    const warm = buildAyasChatPrompt({
      userText: "peki kaçı bitti",
      snapshot: snap(),
      format: "text",
      history: [
        { role: "system", text: "Ben AYAS — Atölye'nin yapay zekâ çekirdeğiyim." },
        { role: "user", text: "kaç proje var" },
        { role: "brain", text: "16 proje var." },
      ],
    });
    assert.match(warm, /süren bir konuşmanın devamıdır/);
    assert.match(warm, /Önceki konuşma:/);
    assert.match(warm, /Kullanıcı: kaç proje var/);
    assert.match(warm, /AYAS: 16 proje var\./);
    assert.doesNotMatch(warm, /yapay zekâ çekirdeğiyim\.\nKullanıcı/); // welcome line not in the transcript
  });

  await scenario("clean reply — deltas arrive incrementally, concat == final text", async () => {
    const pieces = ["Merhaba, ", "sana nasıl ", "yardımcı ", "olabilirim?"];
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 1, fetcher: mockOllamaStream(pieces) }) as never,
    );
    const deltas = events.filter((e) => e.type === "delta");
    assert.equal(deltas.length, 1, "raw provider pieces stay internal; only validated output is emitted");
    const done = events.at(-1)!;
    assert.equal(done.type, "done");
    assert.equal(done.source, "llm");
    assert.equal(done.corrected, false);
    assert.equal(deltas.map((d) => d.text).join(""), "Merhaba, sana nasıl yardımcı olabilirim?");
    assert.equal(done.text, deltas.map((d) => d.text).join(""));
  });

  await scenario("safety — a completed reply that claims execution → corrected fallback", async () => {
    const events = await collect(
      streamAyasChat({
        text: "pipeline çalıştır",
        snapshot: snap(),
        seq: 2,
        fetcher: mockOllamaStream(["Tabii, ", "yürütme kapısını ", "açıyorum ", "ve başlatıyorum."]),
      }) as never,
    );
    const done = events.at(-1)!;
    assert.equal(done.type, "done");
    assert.equal(done.source, "fallback");
    assert.equal(done.corrected, true);
    assert.equal(done.reason, "execution-claim");
    assert.match(done.text as string, /kapalı/i);
  });

  await scenario("safety — an unusable (blank) reply → corrected fallback", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 3, fetcher: mockOllamaStream(["  ", " "]) }) as never,
    );
    const done = events.at(-1)!;
    assert.equal(done.source, "fallback");
    assert.equal(done.corrected, true);
    assert.equal(done.reason, "unusable-reply");
  });

  await scenario("empty input → immediate fallback done, no deltas", async () => {
    const events = await collect(streamAyasChat({ text: "  ", snapshot: snap(), seq: 4, fetcher: mockOllamaStream(["x"]) }) as never);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "done");
    assert.equal(events[0].reason, "empty-input");
  });

  await scenario("provider stream non-200 (health OK) → fallback done", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 5, fetcher: mockOllamaStream([], { status: 500 }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.match(String(events.at(-1)!.reason), /^ollama-/, "reason names the failed provider");
    assert.equal(events.at(-1)!.provider, "ollama");
  });

  await scenario("provider stream 200 but no body → fallback done", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 6, fetcher: mockOllamaStream([], { noBody: true }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
  });

  await scenario("provider fetch throws → fallback done (provider-prefixed reason)", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 7, fetcher: mockOllamaStream([], { throwErr: true }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.equal(events.at(-1)!.reason, "ollama-fetch-failed");
  });

  await scenario("aborted signal during the provider stream → fallback done (reason aborted)", async () => {
    const ac = new AbortController();
    const abortingFetcher = (async (url: string) => {
      if (String(url).includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [{}] }), { status: 200 });
      }
      ac.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 8, signal: ac.signal, fetcher: abortingFetcher }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.equal(events.at(-1)!.reason, "ollama-aborted");
  });

  await scenario("no model provider (Ollama down, cloud unset) → honest fallback, no config detail", async () => {
    const downFetcher = (async (url: string) => {
      if (String(url).includes("/api/tags")) return new Response("nope", { status: 503 });
      throw new Error("should not reach /api/chat");
    }) as unknown as typeof fetch;
    const events = await collect(
      streamAyasChat({
        text: "selam",
        snapshot: snap(),
        seq: 9,
        fetcher: downFetcher,
        env: { ...process.env, AYAS_CLOUD_API_KEY: "", OLLAMA_HOST: "127.0.0.1:11434" },
      }) as never,
    );
    assert.equal(events.length, 1, "no deltas — nothing to stream");
    assert.equal(events[0].source, "fallback");
    assert.equal(events[0].corrected, true);
    assert.match(String(events[0].text), /yapılandırılmamış/);
    assert.doesNotMatch(String(events[0].text), /http|key|token|127\.0\.0\.1/i, "no config/secret detail leaked");
  });

  /* ---------------- real-user-test bug: identity memory, end-to-end through streamAyasChat itself ---------------- */

  await scenario(
    "MEMORY E2E — TURN 1 & TURN 2 (exact real-user-test scenario), through the REAL streamAyasChat production function, a REAL on-disk store: Ahmet + ownership + purpose all reach the real Ollama prompt on a SEPARATE later turn",
    async () => {
      const root = tmpMemRoot();
      const bodies1: string[] = [];

      // TURN 1 — the exact real-user-test message.
      const turn1 = await collect(
        streamAyasChat({
          text: "Beni Ahmet olarak hatırla. Ben Atölye projesinin sahibiyim ve AYAS'ı kişisel yapay zekâ asistanım olarak geliştirmek istiyorum.",
          snapshot: snap(),
          seq: 20,
          fetcher: capturingMockOllamaStream(["Anladım, ", "Ahmet."], bodies1),
          memoryStore: { rootDir: root },
        }) as never,
      );
      const done1 = turn1.at(-1)!;
      assert.equal(done1.type, "done");
      assert.equal(done1.source, "llm");
      const trace1 = done1.memoryTrace as { candidateCount: number; persisted: boolean } | undefined;
      assert.ok(trace1, "TURN 1 done event must carry a memoryTrace");
      assert.ok(trace1!.candidateCount >= 1, `expected memoryCandidateCount >= 1, got ${trace1!.candidateCount}`);
      assert.equal(trace1!.persisted, true, "memoryPersisted must be true");

      // Verify the record REALLY is on disk (not just a self-reported count) —
      // and that it carries BOTH the name AND the ownership/purpose sentence
      // (extraction stores the FULL user message as the body, not just the
      // "Ahmet" clause — item 6 of the task).
      const onDisk = createAyasMemoryStore({ rootDir: root }).load();
      assert.equal(onDisk.length, 1);
      assert.equal(onDisk[0].kind, "user-preference");
      assert.equal(onDisk[0].importance, "durable");
      assert.ok(onDisk[0].tags.includes("kimlik"));
      assert.match(onDisk[0].body, /ahmet/i);
      assert.match(onDisk[0].body, /atölye|atolye/i, "ownership ('Atölye projesinin sahibiyim') must be in the stored body");
      assert.match(onDisk[0].body, /asistan/i, "purpose ('kişisel yapay zekâ asistanım') must be in the stored body");

      // TURN 2 — a genuinely SEPARATE streamAyasChat call (exactly how two
      // real HTTP requests to /api/ayas/chat/stream work), same store root.
      const bodies2: string[] = [];
      const turn2 = await collect(
        streamAyasChat({
          text: "Benim adım ne ve benimle ilgili ne hatırlıyorsun?",
          snapshot: snap(),
          seq: 21,
          fetcher: capturingMockOllamaStream(["Adın Ahmet."], bodies2),
          memoryStore: { rootDir: root },
        }) as never,
      );
      const done2 = turn2.at(-1)!;
      assert.equal(done2.type, "done");
      const trace2 = done2.memoryTrace as { candidateCount: number; recallCount: number; identityRecallCount: number; promptInjected: boolean } | undefined;
      assert.ok(trace2, "TURN 2 done event must carry a memoryTrace");
      assert.ok(trace2!.recallCount >= 1, `expected memoryRecallCount >= 1, got ${trace2!.recallCount}`);
      assert.ok(trace2!.identityRecallCount >= 1, `expected identityRecallCount >= 1, got ${trace2!.identityRecallCount}`);
      assert.equal(trace2!.promptInjected, true);
      // ROUND 2 regression guard: turn 2's OWN message ("Benim adım ne ve
      // benimle ilgili ne hatırlıyorsun?") must NOT itself be extracted as a
      // new identity candidate — it's a question, not a statement.
      assert.equal(trace2!.candidateCount, 0, "asking about one's own name must not itself become a new stored candidate");

      // THE decisive check: the REAL prompt text that was actually sent
      // toward Ollama for TURN 2 (not the mocked reply) really contains the
      // name, the ownership, and the purpose — not just "Ahmet" by accident.
      assert.equal(bodies2.length, 1, "exactly one /api/chat call for turn 2");
      const prompt2 = promptFromCapturedBody(bodies2[0]);
      assert.match(prompt2, /Kalıcı hafızadan hatırlananlar/, "the memory block header must be present in the real prompt");
      assert.match(prompt2, /ahmet/i, "the real Ollama prompt must contain the user's name");
      assert.match(prompt2, /atölye|atolye/i, "the real Ollama prompt must contain the ownership fact");
      assert.match(prompt2, /asistan/i, "the real Ollama prompt must contain the stated purpose");
    },
  );

  await scenario(
    "MEMORY E2E — an unrelated, pre-existing 'visuals' project-status memory does NOT suppress the identity recall",
    async () => {
      const root = tmpMemRoot();
      const store = createAyasMemoryStore({ rootDir: root });
      // Seed an irrelevant, older, normal-importance memory — the exact shape
      // the real user reported seeing surface instead of their own identity.
      store.append(
        buildBrainMemoryRecord({
          kind: "known-bug",
          title: "Bilinen sorun",
          body: "visuals aşamasında bir proje başarısız oldu ve kuyrukta o görev var",
          importance: "normal",
          confidence: "reported",
          tags: ["bug", "visuals"],
          observedAt: "2026-09-10T00:00:00.000Z",
          links: [],
        }),
      );

      const bodies1: string[] = [];
      await collect(
        streamAyasChat({
          text: "Beni Ahmet olarak hatırla. Ben Atölye projesinin sahibiyim ve AYAS'ı kişisel yapay zekâ asistanım olarak geliştirmek istiyorum.",
          snapshot: snap(),
          seq: 22,
          fetcher: capturingMockOllamaStream(["Tamam."], bodies1),
          memoryStore: { rootDir: root },
        }) as never,
      );

      const bodies2: string[] = [];
      const turn2 = await collect(
        streamAyasChat({
          text: "Benim adım ne?",
          snapshot: snap(),
          seq: 23,
          fetcher: capturingMockOllamaStream(["Adın Ahmet."], bodies2),
          memoryStore: { rootDir: root },
        }) as never,
      );
      const trace2 = turn2.at(-1)!.memoryTrace as { identityRecallCount: number } | undefined;
      assert.ok(trace2 && trace2.identityRecallCount >= 1, "identity must still be recalled with an unrelated note in the store");
      const prompt2 = promptFromCapturedBody(bodies2[0]);
      assert.match(prompt2, /ahmet/i, "identity must reach the real prompt even alongside the unrelated visuals note");
    },
  );

  await scenario(
    "MEMORY E2E — NEGATIVE: no identity memory stored → nothing is injected, no fabricated name in the real prompt",
    async () => {
      const root = tmpMemRoot(); // fresh, empty store — never seeded
      const bodies: string[] = [];
      const events = await collect(
        streamAyasChat({
          text: "Benim adım ne?",
          snapshot: snap(),
          seq: 24,
          fetcher: capturingMockOllamaStream(["Bilmiyorum."], bodies),
          memoryStore: { rootDir: root },
        }) as never,
      );
      const trace = events.at(-1)!.memoryTrace as { recallCount: number; identityRecallCount: number; promptInjected: boolean } | undefined;
      assert.ok(trace);
      assert.equal(trace!.recallCount, 0);
      assert.equal(trace!.identityRecallCount, 0);
      assert.equal(trace!.promptInjected, false);
      const prompt = promptFromCapturedBody(bodies[0]);
      assert.doesNotMatch(prompt, /Kalıcı hafızadan hatırlananlar/, "no memory block at all when nothing was ever stored");
      assert.doesNotMatch(prompt, /\bahmet\b/i, "the real prompt must never contain a name nobody ever stated");
    },
  );

  await scenario("FOLLOW-THROUGH — fresh unresolved pronoun asks for clarification before any provider call", async () => {
    let fetchCalls = 0;
    const fetcher = (async () => {
      fetchCalls += 1;
      throw new Error("provider must not be touched");
    }) as unknown as typeof fetch;
    const events = await collect(streamAyasChat({
      text: "Onu biraz sadeleştir.",
      snapshot: snap(),
      seq: 30,
      history: [],
      fetcher,
      memoryStore: { rootDir: tmpMemRoot() },
    }) as never);
    assert.equal(fetchCalls, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].reason, "clarification-required");
    assert.match(String(events[0].text), /Neyi kastettiğini/);
  });

  await scenario("FOLLOW-THROUGH — recent context is preserved in the real streamed provider prompt", async () => {
    const bodies: string[] = [];
    const events = await collect(streamAyasChat({
      text: "İkincisine bakalım.",
      snapshot: snap(),
      seq: 31,
      history: [
        { role: "user", text: "Konuşma tarafında prompt ve context olmak üzere iki alan var." },
        { role: "brain", text: "İkisini de değerlendirebiliriz." },
      ],
      fetcher: capturingMockOllamaStream(["Context tarafına bakalım."], bodies),
      memoryStore: { rootDir: tmpMemRoot() },
    }) as never);
    assert.equal(events.at(-1)!.source, "llm");
    const prompt = promptFromCapturedBody(bodies[0]);
    assert.match(prompt, /"ikinci seçenek" = context/);
    assert.match(prompt, /Kullanıcı: Konuşma tarafında prompt ve context/);
  });

  await scenario("MEMORY POLICY — current exclusion wins and unrelated long-term memory is not injected", async () => {
    const root = tmpMemRoot();
    createAyasMemoryStore({ rootDir: root }).append(buildBrainMemoryRecord({
      kind: "decision",
      title: "Memory çalışması",
      body: "Memory katmanını bugün genişletmek planlanıyor.",
      importance: "durable",
      confidence: "reported",
      tags: ["memory"],
      observedAt: "2026-09-10T00:00:00.000Z",
      links: [],
    }));
    const bodies: string[] = [];
    await collect(streamAyasChat({
      text: "Tamam, bunun dışında ne geliştirebiliriz?",
      snapshot: snap(),
      seq: 32,
      history: [
        { role: "user", text: "Memory tarafına bugün dokunmayalım." },
        { role: "brain", text: "Tamam, memory'yi kapsam dışında tutuyorum." },
      ],
      fetcher: capturingMockOllamaStream(["Context sürekliliğini geliştirebiliriz."], bodies),
      memoryStore: { rootDir: root },
    }) as never);
    const prompt = promptFromCapturedBody(bodies[0]);
    assert.match(prompt, /geçici konuşma kısıtları: Memory tarafına bugün dokunmayalım/i);
    assert.doesNotMatch(prompt, /Kalıcı hafızadan hatırlananlar/);
  });

  await scenario("MEMORY POLICY — a drifted name answer is corrected from isolated identity memory", async () => {
    const root = tmpMemRoot();
    await collect(streamAyasChat({
      text: "Beni Ahmet olarak hatırla.", snapshot: snap(), seq: 33,
      fetcher: capturingMockOllamaStream(["Tamam."], []), memoryStore: { rootDir: root },
    }) as never);
    const events = await collect(streamAyasChat({
      text: "Benim adım ne?", snapshot: snap(), seq: 34,
      history: [{ role: "user", text: "Beni Ahmet olarak hatırla." }, { role: "brain", text: "Tamam." }],
      fetcher: capturingMockOllamaStream(["Size nasıl yardımcı olabilirim?"], []), memoryStore: { rootDir: root },
    }) as never);
    const done = events.at(-1)!;
    assert.equal(done.text, "Adın Ahmet.");
    assert.equal(done.reason, "memory-identity-correction");
  });

  await scenario(
    "FOLLOW-THROUGH — adversarial-sweep finding: the context-correction prompt tells the model not to force an unrelated new turn back onto a stale topic",
    async () => {
      // A real live finding: after a technical multi-turn discussion, a
      // completely unrelated new question ("what should I eat for lunch")
      // kept getting pulled back to the stale topic once the FIRST draft
      // needed a correction retry — because the correction prompt gave the
      // model the recent history but no explicit permission to ignore it.
      // This asserts the fix: when there's no resolved referent/selected
      // option to preserve, the correction prompt explicitly says so.
      let call = 0;
      const capturedPrompts: string[] = [];
      const provider = {
        async *stream(opts: { prompt: string }) {
          capturedPrompts.push(opts.prompt);
          call += 1;
          // A bare "Selam" draft with no real content — always needs correction.
          yield { type: "delta" as const, text: "Selam" };
        },
        async chat(opts: { prompt: string }) {
          capturedPrompts.push(opts.prompt);
          call += 1;
          return { text: "Bugün öğle yemeğinde makarna güzel olur." };
        },
      };
      const events = await collect(
        streamAyasChat({
          text: "Bugün öğle yemeğinde ne yesem?",
          snapshot: snap(),
          seq: 1,
          history: [
            { role: "user", text: "Üç yaklaşım var: hız, kalite ve maliyet." },
            { role: "brain", text: "Bunlardan hangisiyle ilerlemek istersiniz?" },
          ],
          route: {
            decision: { complexity: "NORMAL", providerId: "ollama", providerKind: "local", model: "m", reason: "ok" },
            provider: provider as never,
          },
        }) as never,
      );
      const done = events.at(-1)!;
      assert.equal(call, 2, "one draft call + exactly one bounded correction call");
      assert.equal(capturedPrompts.length, 2);
      assert.match(
        capturedPrompts[1],
        /önceki konuyla[\s\S]*ilgisizse/i,
        "the correction prompt must tell the model it may ignore an unrelated stale topic when nothing is explicitly selected to preserve",
      );
      assert.equal(done.source, "llm");
      assert.equal(done.corrected, true);
    },
  );

  await scenario("SSE framing — one frame per event, JSON payload", async () => {
    const frame = ayasChatStreamEventToSse({ type: "delta", text: "merhaba" });
    assert.equal(frame, 'data: {"type":"delta","text":"merhaba"}\n\n');
  });

  console.log(`AYAS chat stream smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat-stream", scenarios: count }));
}

run()
  .catch((error) => {
    console.error("AYAS chat stream smoke FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const root of testMemoryRoots) fs.rmSync(root, { recursive: true, force: true });
  });
