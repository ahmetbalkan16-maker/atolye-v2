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

import { streamAyasChat, ayasChatStreamEventToSse } from "../src/lib/ayas/AyasChatStream";
import { buildAyasChatPrompt } from "../src/components/brain/brainCore";
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

/** A mock `fetch` that streams the given content pieces as Ollama NDJSON. */
function mockOllamaStream(pieces: string[], opts: { status?: number; noBody?: boolean; throwErr?: boolean } = {}): typeof fetch {
  return (async () => {
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
    const pieces = ["Merhaba, ", "ben AYAS. ", "Sana nasıl ", "yardımcı olabilirim?"];
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 1, fetcher: mockOllamaStream(pieces) }) as never,
    );
    const deltas = events.filter((e) => e.type === "delta");
    assert.equal(deltas.length, 4, "one delta per streamed piece");
    const done = events.at(-1)!;
    assert.equal(done.type, "done");
    assert.equal(done.source, "llm");
    assert.equal(done.corrected, false);
    assert.equal(deltas.map((d) => d.text).join(""), "Merhaba, ben AYAS. Sana nasıl yardımcı olabilirim?");
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
    assert.match(done.text as string, /KAPALI/);
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

  await scenario("Ollama non-200 → fallback done", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 5, fetcher: mockOllamaStream([], { status: 500 }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.match(String(events.at(-1)!.reason), /ollama-500/);
  });

  await scenario("Ollama 200 but no body → fallback done", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 6, fetcher: mockOllamaStream([], { noBody: true }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
  });

  await scenario("fetch throws → fallback done (reason fetch-failed)", async () => {
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 7, fetcher: mockOllamaStream([], { throwErr: true }) }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.equal(events.at(-1)!.reason, "fetch-failed");
  });

  await scenario("aborted signal → fallback done (reason aborted)", async () => {
    const ac = new AbortController();
    const slowFetcher = (async () => {
      ac.abort();
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch;
    const events = await collect(
      streamAyasChat({ text: "selam", snapshot: snap(), seq: 8, signal: ac.signal, fetcher: slowFetcher }) as never,
    );
    assert.equal(events.at(-1)!.source, "fallback");
    assert.equal(events.at(-1)!.reason, "aborted");
  });

  await scenario("SSE framing — one frame per event, JSON payload", async () => {
    const frame = ayasChatStreamEventToSse({ type: "delta", text: "merhaba" });
    assert.equal(frame, 'data: {"type":"delta","text":"merhaba"}\n\n');
  });

  console.log(`AYAS chat stream smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat-stream", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS chat stream smoke FAILED:", error);
  process.exitCode = 1;
});
