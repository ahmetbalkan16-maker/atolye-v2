/**
 * AYAS chat SSE client consumer smoke suite (spec §4).
 *
 * Deterministic / no DOM / no network (mock `fetch` returns an SSE stream).
 * Covers: incremental `onDelta` calls, terminal event capture, `streamed` flag,
 * a `corrected` terminal (guard replacement), and the fall-back signals —
 * non-OK response, missing body, network throw, abort, no terminal event,
 * frames split across chunk boundaries.
 */

import assert from "node:assert/strict";

import { runAyasChatStream } from "../src/components/brain/ayasChatStreamClient";
import { ayasChatStreamEventToSse, type AyasChatStreamEvent } from "../src/lib/ayas/AyasChatStream";

let count = 0;
async function scenario(name: string, test: () => Promise<void>) {
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function sseFetch(events: AyasChatStreamEvent[], opts: { status?: number; noBody?: boolean; throwErr?: string; chunkChars?: number; crlf?: boolean; omitFinalSeparator?: boolean } = {}): typeof fetch {
  return (async () => {
    if (opts.throwErr) {
      const e = new Error(opts.throwErr);
      if (opts.throwErr === "AbortError") e.name = "AbortError";
      throw e;
    }
    if (opts.noBody) return new Response(null, { status: opts.status ?? 200 });
    if ((opts.status ?? 200) !== 200) return new Response("nope", { status: opts.status });
    let text = events.map(ayasChatStreamEventToSse).join("");
    if (opts.crlf) text = text.replace(/\n/gu, "\r\n");
    if (opts.omitFinalSeparator) text = text.replace(/(?:\r?\n){2}$/u, "");
    const enc = new TextEncoder();
    const bytes = enc.encode(text);
    const chunk = opts.chunkChars ?? bytes.length;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as unknown as typeof fetch;
}

const base = { text: "selam", history: [] as const, seq: 1 };

async function run() {
  await scenario("clean stream — deltas fire in order, terminal captured, streamed=true", async () => {
    const deltas: string[] = [];
    const res = await runAyasChatStream({
      ...base,
      onDelta: (d) => deltas.push(d),
      fetcher: sseFetch([
        { type: "delta", text: "Merhaba, " },
        { type: "delta", text: "ben AYAS." },
        { type: "done", text: "Merhaba, ben AYAS.", source: "llm", corrected: false },
      ]),
    });
    assert.deepEqual(deltas, ["Merhaba, ", "ben AYAS."]);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.text, "Merhaba, ben AYAS.");
      assert.equal(res.source, "llm");
      assert.equal(res.corrected, false);
      assert.equal(res.streamed, true);
    }
  });

  await scenario("frames split across chunk boundaries are still parsed", async () => {
    const deltas: string[] = [];
    const res = await runAyasChatStream({
      ...base,
      onDelta: (d) => deltas.push(d),
      fetcher: sseFetch(
        [
          { type: "delta", text: "abc" },
          { type: "delta", text: "def" },
          { type: "done", text: "abcdef", source: "llm", corrected: false },
        ],
        { chunkChars: 7 },
      ),
    });
    assert.deepEqual(deltas, ["abc", "def"]);
    assert.equal(res.ok, true);
  });

  await scenario("CRLF SSE frames and a terminal frame without a trailing separator are parsed", async () => {
    const res = await runAyasChatStream({
      ...base,
      onDelta: () => {},
      fetcher: sseFetch(
        [{ type: "done", text: "Adın Eylultest.", source: "fallback", corrected: true, reason: "memory-identity-correction" }],
        { crlf: true, omitFinalSeparator: true, chunkChars: 5 },
      ),
    });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.text, "Adın Eylultest.");
  });

  await scenario("corrected terminal — streamed=false so the caller replaces", async () => {
    const res = await runAyasChatStream({
      ...base,
      onDelta: () => {},
      fetcher: sseFetch([
        { type: "delta", text: "yürütme kapısını açıyorum" },
        { type: "done", text: "Yürütme kapısı KAPALI.", source: "fallback", corrected: true, reason: "execution-claim" },
      ]),
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.corrected, true);
      assert.equal(res.streamed, false);
      assert.equal(res.text, "Yürütme kapısı KAPALI.");
    }
  });

  await scenario("non-OK response → ok:false http-<status>", async () => {
    const res = await runAyasChatStream({ ...base, onDelta: () => {}, fetcher: sseFetch([], { status: 401 }) });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "http-401");
  });

  await scenario("missing body → ok:false", async () => {
    const res = await runAyasChatStream({ ...base, onDelta: () => {}, fetcher: sseFetch([], { noBody: true }) });
    assert.equal(res.ok, false);
  });

  await scenario("network throw → ok:false network", async () => {
    const res = await runAyasChatStream({ ...base, onDelta: () => {}, fetcher: sseFetch([], { throwErr: "ECONNREFUSED" }) });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "network");
  });

  await scenario("abort throw → ok:false aborted", async () => {
    const res = await runAyasChatStream({ ...base, onDelta: () => {}, fetcher: sseFetch([], { throwErr: "AbortError" }) });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "aborted");
  });

  await scenario("stream ends with no `done` event → ok:false no-terminal-event", async () => {
    const res = await runAyasChatStream({
      ...base,
      onDelta: () => {},
      fetcher: sseFetch([{ type: "delta", text: "yarım" }]),
    });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "no-terminal-event");
  });

  console.log(`AYAS chat stream client smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-chat-stream-client", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS chat stream client smoke FAILED:", error);
  process.exitCode = 1;
});
