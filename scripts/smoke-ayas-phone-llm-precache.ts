/**
 * AYAS phone-local LLM — chunked Range-fetch → IndexedDB downloader smoke
 * suite (Cache Storage blocker closure sprint, sixth pass over this test
 * file — Cache Storage is retired; this now proves the IndexedDB design).
 *
 * No browser: `scripts/lib/FakeIndexedDb.ts` backs `indexedDB`; a fake
 * `env.fetch` simulates the real, empirically-verified HF CDN behavior
 * (206 Partial Content + `Content-Range: bytes start-end/total` — see
 * `phoneLlmPrecacheDownloader.ts`'s header for the actual `curl` proof this
 * mirrors) by slicing an in-memory buffer per requested Range.
 *
 * Proves:
 *  1. `buildRemoteResourceUrl` still matches the library's own URL
 *     construction byte-for-byte (unchanged from the Cache Storage design —
 *     this key format is storage-backend-agnostic).
 *  2. A full download never asks `env.fetch` for more than `CHUNK_SIZE_BYTES`
 *     at once (direct proof via the Range headers actually sent), and never
 *     asks IndexedDB to store more than one chunk at once — the exact
 *     property that failed with a single ~460MB `cache.put()` on-device.
 *  3. Every chunk is verified readable back before the file is marked
 *     complete, and `getFileIdbStatus` only ever reports "complete" then.
 *  4. Resumable: an interrupted download picks up from the last INTACT
 *     chunk, not from scratch, and does not re-fetch chunks already done.
 *  5. A corrupted resume point is detected and the file restarts cleanly
 *     rather than building on top of bad data.
 *  6. Every real-world failure mode (network error, fetch timeout, a
 *     server that stops honoring Range mid-file, storage write failure/
 *     timeout, IndexedDB entirely unavailable) resolves to a typed,
 *     specific outcome — never a silent success, never an unbounded hang.
 */

import assert from "node:assert/strict";

import { env } from "@huggingface/transformers";

import { installFakeIndexedDb, resetFakeIndexedDb, uninstallFakeIndexedDb } from "./lib/FakeIndexedDb";

installFakeIndexedDb();

import { AYAS_PHONE_LLM_MODELS, buildRemoteResourceUrl } from "../src/components/brain/voice/localLlm/phoneLlmModelResources";
import { getModelCacheStatus } from "../src/components/brain/voice/localLlm/phoneLlmRunner";
import { CHUNK_SIZE_BYTES, fetchOneChunk, precacheModelFiles } from "../src/components/brain/voice/localLlm/phoneLlmPrecacheDownloader";
import { getFileIdbStatus, getIdbTransactionCount, getMeta } from "../src/components/brain/voice/localLlm/phoneLlmIdbStorage";
import { readAndClearStalePhoneLlmCheckpoints, type PhoneLlmCheckpointName } from "../src/components/brain/voice/localLlm/phoneLlmDiagnostics";
import type { AyasPhoneLlmLoadProgress } from "../src/components/brain/voice/localLlm/phoneLlmRunner";

// Looked up by `id`, NOT by array index — `AYAS_PHONE_LLM_MODELS`'s order is
// a UI concern (which model the Lab defaults to / unlocks first), not a
// stable identity for this test file's Qwen-specific assertions (gateway
// paths, exact HF URLs, etc., all hardcoded to Qwen below). SmolLM2-135M-
// Instruct was later inserted at index 0 for the Lab UI — this test still
// means "the Qwen 0.5B model" regardless of where it sits in the array.
const MODEL_05B = AYAS_PHONE_LLM_MODELS.find((m) => m.id === "onnx-community/Qwen2.5-0.5B-Instruct")!;
assert.ok(MODEL_05B, "sanity: onnx-community/Qwen2.5-0.5B-Instruct must exist in AYAS_PHONE_LLM_MODELS for this test file to mean anything");
const WEIGHT_FILE = "onnx/model_q4f16.onnx";

// ---- ayas-phone-gateway wiring test config (round 3) ----
const GATEWAY_ORIGIN = "https://ayas-phone-gateway.example.workers.dev";
const GATEWAY_MODEL_PATH = "/phone-llm-model/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx";
/** Mirrors the REAL production path — `cloudflare/ayas-phone-gateway/src/modelProxyConfig.ts`'s `SMOLLM2_MODEL_PROXY_PATH`, byte-for-byte. */
const GATEWAY_SMOLLM2_MODEL_PATH = "/phone-llm-model/HuggingFaceTB/SmolLM2-135M-Instruct/resolve/main/onnx/model_q4f16.onnx";
const PHONE_KEY = "phone-test-key-0123456789";

/** Temporarily configures NEXT_PUBLIC_AYAS_WORKER_URL + a fake window.localStorage carrying a bootstrapped phone key, runs `fn`, then restores both — mirrors a real device that has completed the one-time `?ayasPhoneKey=...` bootstrap. */
function withGatewayConfigured<T>(fn: () => Promise<T>): Promise<T> {
  const originalEnvUrl = process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
  const originalWindow = (globalThis as { window?: unknown }).window;
  process.env.NEXT_PUBLIC_AYAS_WORKER_URL = GATEWAY_ORIGIN;
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => (k === "ayasPhoneKey" ? PHONE_KEY : null) },
  };
  return fn().finally(() => {
    if (originalEnvUrl === undefined) delete process.env.NEXT_PUBLIC_AYAS_WORKER_URL;
    else process.env.NEXT_PUBLIC_AYAS_WORKER_URL = originalEnvUrl;
    (globalThis as { window?: unknown }).window = originalWindow;
  });
}

/** A fake `env.fetch` that behaves like the REAL, curl-verified HF CDN: honors `Range`, returns 206 + `Content-Range: bytes start-end/total`, exposes an `etag`. `bodies` maps url → full file bytes; every request is recorded so tests can assert on exactly what was requested. */
function fakeRangeFetch(bodies: Map<string, Uint8Array>, requests: Array<{ url: string; range: string | null }>) {
  return (async (url: string, init?: RequestInit) => {
    const full = bodies.get(url);
    if (!full) return new Response("not found", { status: 404 });
    const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    requests.push({ url, range: rangeHeader });
    if (!rangeHeader) {
      return new Response(full as BodyInit, { status: 200, headers: { "content-length": String(full.byteLength) } });
    }
    const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
    assert.ok(match, `malformed Range header: ${rangeHeader}`);
    const start = Number(match![1]);
    const end = Math.min(Number(match![2]), full.byteLength - 1);
    const slice = full.slice(start, end + 1);
    assert.ok(slice.byteLength <= CHUNK_SIZE_BYTES, `a single request must never ask for more than one chunk (${slice.byteLength} > ${CHUNK_SIZE_BYTES})`);
    return new Response(slice, {
      status: 206,
      headers: {
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${start}-${end}/${full.byteLength}`,
        etag: '"fake-etag"',
      },
    });
  }) as typeof env.fetch;
}

function fillBuffer(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = i % 256;
  return bytes;
}

/** Minimal in-memory `Storage` so `recordPhoneLlmCheckpoint`/`readAndClearStalePhoneLlmCheckpoints` have something to write to — Node has no global `sessionStorage`. */
function fakeSessionStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}
(globalThis as { sessionStorage?: Storage }).sessionStorage = fakeSessionStorage();

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  resetFakeIndexedDb();
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  env.useBrowserCache = false; // this app never relies on Cache Storage for model weights any more — see phoneLlmRunner.ts header

  await scenario("buildRemoteResourceUrl matches the library's own URL construction, byte-for-byte", () => {
    assert.equal(
      buildRemoteResourceUrl(MODEL_05B, "config.json"),
      "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/config.json",
    );
    assert.equal(
      buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE),
      `https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/${WEIGHT_FILE}`,
    );
  });

  await scenario("PROVEN BUG FIX: a Range request answered with 200 (full file) instead of 206 is NEVER read into a buffer — the exact real-device scenario (chunk:reader_complete chunk=0 [483003582] for an 8MB request) is reproduced and shown not to recur", async () => {
    const originalFetch = env.fetch;
    let cancelWasCalled = false;
    let readerReadWasCalled = false;
    const hugeFile = fillBuffer(50 * 1024 * 1024); // stand-in "whole file", much bigger than one 8MB chunk
    env.fetch = (async () => {
      // Simulates exactly what real-device evidence showed: a Range
      // request answered with a non-partial 200 carrying the WHOLE file.
      // NOTE: a ReadableStream's `pull()` can fire eagerly on construction
      // per spec (to fill its internal queue), independent of whether any
      // consumer ever calls `.getReader().read()` — so `pull` firing is
      // NOT a reliable "was this body consumed" signal. `cancel()` firing,
      // and the reader's own `read()` NOT being called, are the direct,
      // positive proofs of what `fetchOneChunk` actually does.
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(hugeFile);
          controller.close();
        },
        cancel() {
          cancelWasCalled = true;
        },
      });
      // Content-Length lies about the real file's exact known total size
      // (483003582) even though the mocked body itself stays small — the
      // fix never reads far enough to notice the difference, which is
      // exactly the point: no header value, true or false, can make this
      // function read an unverified body.
      const response = new Response(stream, { status: 200, headers: { "content-length": "483003582" } });
      // Monkey-patch via `any` — the real `getReader`/`read` overload set
      // (BYOB vs default) makes a faithfully-typed wrapper unnecessarily
      // noisy for a test double; the runtime behavior below is what's
      // actually under test, not the type shape.
      const body = response.body as unknown as { getReader: (...args: unknown[]) => { read: (...args: unknown[]) => Promise<unknown> } };
      const originalGetReader = body.getReader.bind(body);
      body.getReader = (...args: unknown[]) => {
        const reader = originalGetReader(...args);
        const originalRead = reader.read.bind(reader);
        reader.read = (...readArgs: unknown[]) => {
          readerReadWasCalled = true;
          return originalRead(...readArgs);
        };
        return reader;
      };
      return response;
    }) as typeof env.fetch;

    try {
      const result = await fetchOneChunk({
        url: buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE),
        index: 0,
        range: { start: 0, end: CHUNK_SIZE_BYTES - 1 },
        fetchTimeoutMs: 5000,
        modelId: MODEL_05B.id,
        file: WEIGHT_FILE,
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.status, 200);
        assert.equal(result.bodyConsumed, false, "the fix: body must NOT be consumed when status doesn't match what a Range request expects");
        assert.equal(result.bytes.byteLength, 0, "no bytes should have been buffered — this is the exact bug that killed the real device");
      }
      assert.equal(readerReadWasCalled, false, "reader.read() must never be called on a status mismatch — the exact read loop that buffered 483MB on-device");
      assert.equal(cancelWasCalled, true, "the fix: response.body.cancel() must be called instead, releasing the connection without reading it");

      const stale = readAndClearStalePhoneLlmCheckpoints();
      assert.ok(stale);
      assert.equal(stale!.latest.name, "chunk:aborted_unexpected_status");
      assert.match(stale!.latest.detail ?? "", /expected 206, got 200/);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario(
    "REGRESSION FIX PROOF (integration level): even through the gateway, a chunk-0 probe answering 200 instead of 206 — reproducing the exact real-device signature (Content-Length 483003582, Content-Range absent) — never enters the removed whole-file fallback: the URL is fetched exactly ONCE, its body is never read, and the download fails closed with a typed range-not-supported error instead of buffering the whole file",
    async () => {
      const originalFetch = env.fetch;
      const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
      let weightFetchCount = 0;
      let readerReadWasCalled = false;
      let cancelWasCalled = false;
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      ]);
      env.fetch = (async (fetchUrl: string, init?: RequestInit) => {
        if (fetchUrl !== gatewayWeightUrl) return fakeRangeFetch(bodies, [])(fetchUrl, init);
        weightFetchCount += 1;
        // Every single request for this URL — Range header present or not
        // — gets this exact real-device signature: 200, Content-Range
        // absent, Content-Length claiming the real total file size. If the
        // removed whole-file fallback ever fired again, its second
        // (unranged) request would land here too and get the SAME
        // never-honors-Range response — there is no "eventually gets a
        // 206" escape hatch in this test. This now happens at the GATEWAY
        // URL (not direct HF) since the weight file is routed through it
        // when configured — proves the SAME safe-abort protection holds
        // one hop later in the chain, regardless of which URL answers 200.
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(fillBuffer(1024));
            controller.close();
          },
          cancel() {
            cancelWasCalled = true;
          },
        });
        const response = new Response(stream, { status: 200, headers: { "content-length": "483003582" } });
        const body = response.body as unknown as { getReader: (...args: unknown[]) => { read: (...args: unknown[]) => Promise<unknown> } };
        const originalGetReader = body.getReader.bind(body);
        body.getReader = (...args: unknown[]) => {
          const reader = originalGetReader(...args);
          const originalRead = reader.read.bind(reader);
          reader.read = (...readArgs: unknown[]) => {
            readerReadWasCalled = true;
            return originalRead(...readArgs);
          };
          return reader;
        };
        return response;
      }) as typeof env.fetch;

      try {
        const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.equal(outcome.reason, "range-not-supported", "the real-device 200-instead-of-206 signature must fail closed as range-not-supported, not silently fall back to a whole-file read");
          assert.equal(outcome.file, WEIGHT_FILE);
          assert.match(outcome.detail, /200 instead of 206/);
        }
        assert.equal(weightFetchCount, 1, "the removed whole-file fallback must NEVER fire — exactly one request for the weight file's URL, never a second unranged re-fetch");
        assert.equal(readerReadWasCalled, false, "the body must never be read — no Uint8Array of ANY size, let alone the full 483003582-byte file, may ever be materialized from this response");
        assert.equal(cancelWasCalled, true, "the response body must be released via cancel(), not read");

        const stale = readAndClearStalePhoneLlmCheckpoints();
        assert.ok(stale);
        const weightEntries = stale!.history.filter((e) => e.file === WEIGHT_FILE);
        const weightNames = weightEntries.map((e) => e.name);
        assert.ok(weightNames.includes("chunk:aborted_unexpected_status"), "the status gate must fire for the weight file's chunk-0 probe");
        assert.ok(!weightNames.includes("chunk:reader_start"), "the reader must never even start for the weight file's chunk 0 — SAFE ABORT happens before any reading");
        assert.ok(!weightNames.includes("chunk:reader_complete"), "reader_complete must never fire — no read loop ever ran for this chunk");
        const downloadEnd = weightEntries.find((e) => e.name === "download:end");
        assert.equal(downloadEnd?.detail, "range_not_supported_abort", "download:end must record the distinct SAFE ABORT reason, not the removed range_not_honored_fallback");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  await scenario("a single chunk records the FULL fine-grained checkpoint trail, in order (the exact instrumentation the process-death diagnostic sprint added) — the ONNX weight file, through the gateway (round 4: small metadata files no longer carry this chunked instrumentation at all — see the dedicated small-file scenario below)", async () => {
    const originalFetch = env.fetch;
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, fillBuffer(1234)],
    ]);
    env.fetch = fakeRangeFetch(bodies, []);
    try {
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.reason}: ${outcome.detail}`);
      const stale = readAndClearStalePhoneLlmCheckpoints();
      assert.ok(stale, "checkpoints must have been recorded");
      // Isolate the WEIGHT file's own trail — the 3 small metadata files
      // recorded their own (deliberately different, whole-file) trail
      // entries first, interleaved in the same history. Keep the filtered
      // ENTRIES (not just names) so index-based lookups below stay
      // consistent with this filtered view, not the unfiltered history.
      const weightEntries = stale!.history.filter((e) => e.file === WEIGHT_FILE);
      const names = weightEntries.map((e) => e.name);
      const expectedTrail: PhoneLlmCheckpointName[] = [
        "download:start",
        "chunk:start",
        "chunk:fetch_start",
        "chunk:response_received",
        "chunk:response_status",
        "chunk:content_range",
        "chunk:reader_start",
        "chunk:memory_sample",
        "chunk:first_bytes",
        "chunk:reader_complete",
        "chunk:idb_write_start",
        "chunk:idb_write_complete",
        "chunk:complete",
        "download:end",
        "verify:start",
        "verify:end",
      ];
      for (const step of expectedTrail) assert.ok(names.includes(step), `missing checkpoint "${step}" in weight-file trail: ${names.join(", ")}`);
      // Order matters: reader_start must precede first_bytes, which must precede reader_complete, which must precede idb_write_start.
      const at = (n: PhoneLlmCheckpointName) => names.indexOf(n);
      assert.ok(at("chunk:reader_start") < at("chunk:first_bytes"));
      assert.ok(at("chunk:first_bytes") < at("chunk:reader_complete"));
      assert.ok(at("chunk:reader_complete") < at("chunk:idb_write_start"));
      assert.ok(at("chunk:idb_write_start") < at("chunk:idb_write_complete"));

      // The real proof this sprint asked for: response_status and
      // content_range carry the ACTUAL captured HTTP values, not placeholders.
      const statusEntry = weightEntries.find((e) => e.name === "chunk:response_status");
      assert.equal(statusEntry?.detail, "206");
      const rangeEntry = weightEntries.find((e) => e.name === "chunk:content_range");
      assert.match(rangeEntry?.detail ?? "", /^bytes 0-1233\/1234$/);

      // Process-death diagnostic follow-up: a memory sample must exist
      // BEFORE the read starts, at the reader_complete → idb_write_start
      // boundary the real-device death consistently occurred at (both
      // before AND after the write, so a trend is observable across many
      // chunks) — three samples per chunk total — and the
      // combined-transaction write (putChunkAndMeta) must show in the
      // running transaction count.
      const memorySampleIndices = names.reduce<number[]>((acc, n, i) => {
        if (n === "chunk:memory_sample") acc.push(i);
        return acc;
      }, []);
      assert.equal(memorySampleIndices.length, 3, "one pre-read, one pre-write and one post-write memory sample per chunk");
      const [preReadIdx, preWriteIdx, postWriteIdx] = memorySampleIndices;
      assert.ok(at("chunk:reader_start") < preReadIdx, "pre-read sample must come after reader_start");
      assert.ok(preReadIdx < at("chunk:first_bytes"), "pre-read sample must come before first_bytes");
      const preReadDetail = weightEntries[preReadIdx].detail ?? "";
      assert.match(preReadDetail, /^pre-read /, `pre-read sample must be labeled: "${preReadDetail}"`);
      assert.ok(at("chunk:reader_complete") < preWriteIdx, "pre-write sample must come after reader_complete");
      assert.ok(preWriteIdx < at("chunk:idb_write_start"), "pre-write sample must come before idb_write_start");
      assert.ok(at("chunk:idb_write_complete") < postWriteIdx, "post-write sample must come after idb_write_complete");
      const preWriteDetail = weightEntries[preWriteIdx].detail ?? "";
      assert.match(preWriteDetail, /^pre-write .*tx=\d+$/, `pre-write sample must carry a live tx= count: "${preWriteDetail}"`);

      // Finalization tracking: either it registered (detail proves it ran,
      // even though the actual callback firing isn't guaranteed within one
      // synchronous test) or the environment honestly reported it's
      // unsupported — never silently neither.
      const finalizationUnsupported = names.includes("chunk:finalization_unsupported");
      if (!finalizationUnsupported) {
        // FinalizationRegistry IS supported in this test runtime (Node
        // does support it) — the absence of "unsupported" plus a clean
        // pass through chunk:complete is itself consistent with
        // registration having been attempted without throwing.
        assert.ok(names.includes("chunk:complete"));
      }
    } finally {
      env.fetch = originalFetch;
    }
  });

  /* ---------------- Round 4: small metadata files use plain fetch, no Range/206 required ---------------- */

  await scenario(
    "ROUND 4 FIX PROOF: config.json / tokenizer.json / tokenizer_config.json send NO Range header at all and accept a plain 200 — the real-device bug (`range-not-supported: config.json: ... server returned HTTP 200 instead of 206`) is structurally impossible for these files now, while the ONNX weight file still sends Range and requires 206",
    async () => {
      const originalFetch = env.fetch;
      const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(210)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(340)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(180)],
        [gatewayWeightUrl, fillBuffer(1234)],
      ]);
      const requestsByUrl = new Map<string, Array<string | null>>();
      env.fetch = (async (url: string, init?: RequestInit) => {
        const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
        const seen = requestsByUrl.get(url) ?? [];
        seen.push(rangeHeader);
        requestsByUrl.set(url, seen);
        return fakeRangeFetch(bodies, [])(url, init);
      }) as typeof env.fetch;

      try {
        const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
        assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.reason}: ${outcome.detail}`);

        for (const file of ["config.json", "tokenizer.json", "tokenizer_config.json"]) {
          const url = buildRemoteResourceUrl(MODEL_05B, file);
          const ranges = requestsByUrl.get(url);
          assert.ok(ranges && ranges.length === 1, `${file} must be fetched exactly once (a single whole-file GET, not a chunk loop)`);
          assert.equal(ranges![0], null, `${file} must NEVER send a Range header — this is the exact fix`);
          assert.equal(await getFileIdbStatus(url), "complete");
        }

        // The weight file, unaffected by this round, still sends Range on every request.
        const weightRanges = requestsByUrl.get(gatewayWeightUrl);
        assert.ok(weightRanges && weightRanges.length >= 1);
        assert.ok(weightRanges!.every((r) => r !== null), "the weight file must still send a Range header on every request — this round changes nothing about it");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  await scenario("ROUND 4: a small metadata file with an implausibly large declared Content-Length is safely rejected BEFORE being read — defense in depth, same discipline as the chunked path", async () => {
    const originalFetch = env.fetch;
    const url = buildRemoteResourceUrl(MODEL_05B, "config.json");
    let arrayBufferWasCalled = false;
    env.fetch = (async (fetchUrl: string) => {
      if (fetchUrl !== url) return new Response("not found", { status: 404 });
      // Claims to be bigger than a small metadata file could ever
      // legitimately be — must be refused before `.arrayBuffer()` ever runs.
      // NOTE: a `ReadableStream`'s `pull()` can fire eagerly on
      // construction per spec, independent of whether any consumer reads
      // it — NOT a reliable "was this body read" signal (see
      // `fetchOneChunk`'s own regression test elsewhere in this file for
      // the same lesson). Monkey-patching the EXACT method
      // `fetchWholeFile` calls (`response.arrayBuffer()`) is the direct,
      // positive proof instead.
      const response = new Response(fillBuffer(10) as BodyInit, { status: 200, headers: { "content-length": String(CHUNK_SIZE_BYTES + 1) } });
      const originalArrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = () => {
        arrayBufferWasCalled = true;
        return originalArrayBuffer();
      };
      return response;
    }) as typeof env.fetch;
    try {
      const outcome = await precacheModelFiles(MODEL_05B);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.equal(outcome.file, "config.json");
        assert.match(outcome.detail, /unexpectedly large metadata file/);
      }
      assert.equal(arrayBufferWasCalled, false, "response.arrayBuffer() must never be called when the declared Content-Length alone is enough to refuse it");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("resource-accumulation fix: putChunkAndMeta opens exactly ONE IndexedDB transaction per call, not two (isolated from precacheModelFiles's own read transactions)", async () => {
    const { putChunkAndMeta } = await import("../src/components/brain/voice/localLlm/phoneLlmIdbStorage");
    const url = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
    const baseMeta = {
      key: url,
      modelId: MODEL_05B.id,
      file: WEIGHT_FILE,
      totalBytes: 100,
      chunkSize: CHUNK_SIZE_BYTES,
      chunkCount: 3,
      downloadedBytes: 0,
      downloadedChunkCount: 0,
      etag: null,
      complete: false,
      updatedAt: Date.now(),
    };
    const txBefore = getIdbTransactionCount();
    await putChunkAndMeta(url, 0, fillBuffer(10), { ...baseMeta, downloadedBytes: 10, downloadedChunkCount: 1 });
    await putChunkAndMeta(url, 1, fillBuffer(10), { ...baseMeta, downloadedBytes: 20, downloadedChunkCount: 2 });
    await putChunkAndMeta(url, 2, fillBuffer(10), { ...baseMeta, downloadedBytes: 30, downloadedChunkCount: 3 });
    const txAfter = getIdbTransactionCount();
    // The OLD design (separate putChunk() + a separately-called putMeta())
    // would have taken 6 transactions for these 3 calls; this is the
    // direct, numeric proof it now takes exactly 3 — one per call, not two.
    assert.equal(txAfter - txBefore, 3, `expected exactly 1 transaction per putChunkAndMeta call (3 calls → 3), got ${txAfter - txBefore}`);
  });

  await scenario("full precache of all 4 required files: every fetch is Range-bounded to one chunk, every chunk verified, status becomes complete (weight file routed through the gateway — see round 3)", async () => {
    const originalFetch = env.fetch;
    // A "big" weight file spanning several chunks, small files for the rest.
    const weightBytes = fillBuffer(CHUNK_SIZE_BYTES * 2 + 12345);
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, weightBytes],
    ]);
    const requests: Array<{ url: string; range: string | null }> = [];
    env.fetch = fakeRangeFetch(bodies, requests);

    try {
      const events: AyasPhoneLlmLoadProgress[] = [];
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B, (p) => events.push(p)));
      assert.equal(outcome.ok, true);

      // Storage key stays the plain HF URL regardless of the gateway.
      const weightUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
      const weightRequests = requests.filter((r) => r.url === gatewayWeightUrl);
      assert.equal(weightRequests.length, 3, "a 2×chunkSize+12345 file must take exactly 3 chunk requests");
      assert.ok(weightRequests.every((r) => r.range !== null), "every weight-file request must carry a Range header — never a single whole-file fetch");

      assert.equal(await getFileIdbStatus(weightUrl), "complete");
      const meta = await getMeta(weightUrl);
      assert.equal(meta?.downloadedBytes, weightBytes.byteLength);
      assert.equal(meta?.etag, '"fake-etag"');

      assert.equal(await getModelCacheStatus(MODEL_05B), "complete");

      const doneEvents = events.filter((e) => e.status === "done");
      assert.equal(doneEvents.length, 4);
      const weightProgress = events.filter((e) => e.file === WEIGHT_FILE && e.status === "progress");
      assert.ok(weightProgress.length >= 3, "real, chunk-granular progress events, not a fake jump to 100%");
      assert.ok(weightProgress[weightProgress.length - 1].percent! > 99, "final progress event must reflect true completion");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("ROUND 6: a single transient fetch() rejection is retried and absorbed — does not fail the whole chunk", async () => {
    const originalFetch = env.fetch;
    const weightBytes = fillBuffer(CHUNK_SIZE_BYTES - 1);
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, weightBytes],
    ]);
    let weightAttempts = 0;
    env.fetch = (async (fetchUrl: string, init?: RequestInit) => {
      if (fetchUrl === gatewayWeightUrl) {
        weightAttempts += 1;
        if (weightAttempts === 1) throw new TypeError("Type error"); // the exact real-device signature
      }
      return fakeRangeFetch(bodies, [])(fetchUrl, init);
    }) as typeof env.fetch;
    try {
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(outcome.ok, true, outcome.ok ? "" : `${(outcome as { reason: string }).reason}`);
      assert.equal(weightAttempts, 2, "exactly one retry after the single transient rejection, then success");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("ROUND 6: a PERSISTENT fetch() rejection (all attempts fail) still ends in the same typed network-error as before — retry doesn't mask a real, lasting failure", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async (fetchUrl: string) => {
      if (fetchUrl.includes(WEIGHT_FILE)) throw new TypeError("Type error");
      return fakeRangeFetch(
        new Map([
          [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
          [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
          [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
        ]),
        [],
      )(fetchUrl);
    }) as typeof env.fetch;
    try {
      const startedAt = Date.now();
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.equal(outcome.reason, "network-error");
        assert.equal(outcome.detail, "Type error");
      }
      // 2 retries * 400ms = bounded, not an unbounded hang.
      assert.ok(Date.now() - startedAt < 5000);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("ROUND 6: a mid-stream reader.read() rejection is a typed network-error, not an unhandled promise rejection", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(10));
        },
        pull() {
          throw new TypeError("Type error");
        },
      });
      return new Response(stream, {
        status: 206,
        headers: { "content-range": "bytes 0-8388607/117691126", "content-length": "8388608" },
      });
    }) as typeof env.fetch;
    try {
      const result = await fetchOneChunk({
        url: "https://example.test/weight.onnx",
        index: 0,
        range: { start: 0, end: CHUNK_SIZE_BYTES - 1 },
        fetchTimeoutMs: 5000,
        modelId: "test-model",
        file: WEIGHT_FILE,
      });
      assert.equal(result.ok, false, "must resolve to a typed failure, never throw/reject uncaught");
      if (!result.ok) {
        assert.equal(result.reason, "network-error");
        assert.match(result.detail, /Type error/);
      }
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("resumable: an interrupted download picks up from the last chunk, does not re-fetch what's already done (weight file routed through the gateway)", async () => {
    const originalFetch = env.fetch;
    const weightBytes = fillBuffer(CHUNK_SIZE_BYTES * 3);
    const url = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE); // storage key
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, weightBytes],
    ]);
    // Every file downloads normally EXCEPT the weight file drops the
    // connection right after its first chunk. `fetchOneChunk` now retries a
    // genuine `fetch()` rejection up to 2 extra times (round 6) before
    // giving up on that chunk — so a PERSISTENT drop covering all 3
    // attempts (requests 2, 3, 4) is what's needed to still exercise "this
    // chunk's fetch ultimately fails, the file's meta stops at 1 completed
    // chunk, a later resume picks up cleanly" the way a single-shot throw
    // used to before the retry existed.
    let weightRequestsSeen = 0;
    env.fetch = (async (fetchUrl: string, init?: RequestInit) => {
      if (fetchUrl === gatewayWeightUrl) {
        weightRequestsSeen += 1;
        if (weightRequestsSeen >= 2 && weightRequestsSeen <= 4) throw new Error("simulated network drop");
      }
      return fakeRangeFetch(bodies, [])(fetchUrl, init);
    }) as typeof env.fetch;

    try {
      const first = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(first.ok, false, "the simulated drop must actually fail the first attempt");

      const midMeta = await getMeta(url);
      assert.ok(midMeta, "the weight file's meta record must exist after its first chunk succeeded");
      assert.equal(midMeta!.downloadedChunkCount, 1, "exactly the one chunk that succeeded before the drop must be recorded");
      // The 3 small files, downloaded before the drop, must already be complete.
      assert.equal(await getFileIdbStatus(buildRemoteResourceUrl(MODEL_05B, "config.json")), "complete");

      // Second attempt: unlimited fetch, but count how many requests the WEIGHT FILE takes.
      const requests: Array<{ url: string; range: string | null }> = [];
      env.fetch = fakeRangeFetch(bodies, requests);
      const second = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(second.ok, true);
      const weightRequestsOnResume = requests.filter((r) => r.url === gatewayWeightUrl);
      assert.equal(weightRequestsOnResume.length, 2, "must fetch only the 2 REMAINING weight-file chunks, not all 3 again");
      const smallFileRequestsOnResume = requests.filter((r) => r.url !== gatewayWeightUrl);
      assert.equal(smallFileRequestsOnResume.length, 0, "the 3 already-complete small files must not be re-fetched at all");
      assert.equal(await getFileIdbStatus(url), "complete");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("corrupt resume point is detected and the file restarts cleanly instead of building on bad data (weight file routed through the gateway)", async () => {
    const originalFetch = env.fetch;
    const weightBytes = fillBuffer(CHUNK_SIZE_BYTES * 2);
    const url = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE); // storage key
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;

    // Seed a meta record claiming chunk 0 is done, but store a WRONG-SIZED chunk 0 (corruption).
    const { putMeta, putChunk } = await import("../src/components/brain/voice/localLlm/phoneLlmIdbStorage");
    await putMeta({
      key: url,
      modelId: MODEL_05B.id,
      file: WEIGHT_FILE,
      totalBytes: weightBytes.byteLength,
      chunkSize: CHUNK_SIZE_BYTES,
      chunkCount: 2,
      downloadedBytes: CHUNK_SIZE_BYTES,
      downloadedChunkCount: 1,
      etag: null,
      complete: false,
      updatedAt: Date.now(),
    });
    await putChunk(url, 0, new Uint8Array(CHUNK_SIZE_BYTES - 1)); // one byte short — corrupt

    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, weightBytes],
    ]);
    const requests: Array<{ url: string; range: string | null }> = [];
    env.fetch = fakeRangeFetch(bodies, requests);
    try {
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(outcome.ok, true);
      // Corruption detected → restarted from chunk 0 → both chunks re-fetched.
      const weightRequests = requests.filter((r) => r.url === gatewayWeightUrl);
      assert.equal(weightRequests.length, 2, "a corrupt resume point must cause a full re-fetch of this file, not a partial one");
      assert.equal(await getFileIdbStatus(url), "complete");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("network failure on a chunk → typed network-error naming the file", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => {
      throw new Error("network down");
    }) as typeof env.fetch;
    try {
      const outcome = await precacheModelFiles(MODEL_05B);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.equal(outcome.reason, "network-error");
        assert.equal(outcome.file, "config.json");
      }
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("fetch() that never settles → typed fetch-timeout within the injected bound, does not hang the caller", async () => {
    const originalFetch = env.fetch;
    env.fetch = (() => new Promise<Response>(() => {})) as typeof env.fetch;
    try {
      const startedAt = Date.now();
      const outcome = await precacheModelFiles(MODEL_05B, undefined, { fetchTimeoutMs: 50 });
      assert.ok(Date.now() - startedAt < 2000);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, "fetch-timeout");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("a server that stops honoring Range mid-file (200 instead of 206 on a later chunk) → typed range-not-supported, not silently misinterpreted (weight file routed through the gateway)", async () => {
    const originalFetch = env.fetch;
    const gatewayWeightUrl = `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`;
    const weightBytes = fillBuffer(CHUNK_SIZE_BYTES * 3);
    const bodies = new Map<string, Uint8Array>([
      [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
      [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      [gatewayWeightUrl, weightBytes],
    ]);
    let weightRequestsSeen = 0;
    env.fetch = (async (fetchUrl: string, init?: RequestInit) => {
      if (fetchUrl === gatewayWeightUrl) {
        weightRequestsSeen += 1;
        if (weightRequestsSeen === 2) {
          // The weight file's SECOND request (chunk 1) inexplicably
          // returns the whole file as 200 instead of honoring Range.
          return new Response(weightBytes as BodyInit, { status: 200, headers: { "content-length": String(weightBytes.byteLength) } });
        }
      }
      return fakeRangeFetch(bodies, [])(fetchUrl, init);
    }) as typeof env.fetch;
    try {
      const outcome = await withGatewayConfigured(() => precacheModelFiles(MODEL_05B));
      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.equal(outcome.reason, "range-not-supported");
        assert.equal(outcome.file, WEIGHT_FILE);
      }
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("IndexedDB entirely unavailable → hard, explicit LOCAL_MODEL_STORAGE_UNAVAILABLE — no silent success, no Cache Storage fallback", async () => {
    uninstallFakeIndexedDb();
    const originalFetch = env.fetch;
    env.fetch = fakeRangeFetch(new Map([[buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(5)]]), []);
    try {
      const outcome = await precacheModelFiles(MODEL_05B);
      assert.equal(outcome.ok, false);
      if (!outcome.ok) assert.equal(outcome.reason, "storage-unavailable");
      assert.match(outcome.ok ? "" : outcome.detail, /LOCAL_MODEL_STORAGE_UNAVAILABLE/);
    } finally {
      env.fetch = originalFetch;
      installFakeIndexedDb();
    }
  });

  /* ---------------- Round 3: ayas-phone-gateway wiring (real-device closure) ---------------- */

  await scenario(
    "gateway wiring: when configured, ONLY the weight file's network requests go to the gateway (with Authorization) — small files still go straight to HF, and the storage key (meta.key, IndexedDB) stays the plain HF URL",
    async () => {
      const originalFetch = env.fetch;
      const weightBytes = fillBuffer(CHUNK_SIZE_BYTES + 12345);
      const hfWeightUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      ]);
      const gatewayRequests: Array<{ range: string | null; auth: string | null }> = [];
      env.fetch = (async (url: string, init?: RequestInit) => {
        if (url === hfWeightUrl) {
          throw new Error(`REGRESSION: the weight file must never be fetched directly from HF when the gateway is configured — got a direct request to ${url}`);
        }
        if (url.startsWith(GATEWAY_ORIGIN)) {
          assert.equal(url, `${GATEWAY_ORIGIN}${GATEWAY_MODEL_PATH}`, "the gateway request must hit the exact fixed proxy path");
          const headers = init?.headers as Record<string, string>;
          gatewayRequests.push({ range: headers.Range ?? null, auth: headers.Authorization ?? null });
          const match = /bytes=(\d+)-(\d+)/.exec(headers.Range);
          assert.ok(match, "the gateway request must carry a Range header");
          const start = Number(match![1]);
          const end = Math.min(Number(match![2]), weightBytes.byteLength - 1);
          const slice = weightBytes.slice(start, end + 1);
          return new Response(slice as BodyInit, {
            status: 206,
            headers: { "content-length": String(slice.byteLength), "content-range": `bytes ${start}-${end}/${weightBytes.byteLength}`, etag: '"fake-etag"' },
          });
        }
        return fakeRangeFetch(bodies, [])(url, init);
      }) as typeof env.fetch;

      try {
        await withGatewayConfigured(async () => {
          const outcome = await precacheModelFiles(MODEL_05B);
          assert.equal(outcome.ok, true, outcome.ok ? "" : `${outcome.reason}: ${outcome.detail}`);
        });
        assert.ok(gatewayRequests.length >= 2, "the weight file must actually be fetched, in chunks, through the gateway");
        for (const r of gatewayRequests) assert.equal(r.auth, `Bearer ${PHONE_KEY}`, "every gateway request must carry the bootstrapped phone key");

        // The STORAGE key must still be the plain HF URL — this is what
        // Transformers.js's own env.customCache.match() will look up during
        // model load, and it has no idea a gateway exists.
        const meta = await getMeta(hfWeightUrl);
        assert.ok(meta, "meta must be stored under the plain HF URL, not the gateway URL");
        assert.equal(meta!.key, hfWeightUrl);
        assert.equal(meta!.complete, true);
        assert.equal(await getFileIdbStatus(hfWeightUrl), "complete");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  await scenario(
    "gateway wiring: NOT configured on this device → the weight file fails closed with gateway-not-configured BEFORE any network call for it (no silent fall-through to the direct HF URL already proven broken)",
    async () => {
      const originalFetch = env.fetch;
      let weightFileFetchAttempted = false;
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(MODEL_05B, "config.json"), fillBuffer(2)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer.json"), fillBuffer(3)],
        [buildRemoteResourceUrl(MODEL_05B, "tokenizer_config.json"), fillBuffer(4)],
      ]);
      const hfWeightUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
      env.fetch = (async (url: string, init?: RequestInit) => {
        if (url === hfWeightUrl || url.includes("phone-llm-model")) weightFileFetchAttempted = true;
        return fakeRangeFetch(bodies, [])(url, init);
      }) as typeof env.fetch;
      try {
        // Deliberately NOT calling withGatewayConfigured — this is this
        // test process's default state (no NEXT_PUBLIC_AYAS_WORKER_URL, no
        // window/localStorage), matching a device that never bootstrapped.
        const outcome = await precacheModelFiles(MODEL_05B);
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.equal(outcome.reason, "gateway-not-configured");
          assert.equal(outcome.file, WEIGHT_FILE);
          assert.match(outcome.detail, /ayasPhoneKey/);
        }
        assert.equal(weightFileFetchAttempted, false, "no network call — direct HF or gateway — may ever be attempted for the weight file when the gateway isn't configured");
        // The 3 small files, which don't need the gateway, must still have succeeded.
        assert.equal(await getFileIdbStatus(buildRemoteResourceUrl(MODEL_05B, "config.json")), "complete");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  await scenario(
    "ROUND 7: the 1.5B model's weight file has NO gateway route → hard gateway-not-configured failure, NEVER a silent direct-HF fetch (even though its 3 small metadata files still succeed straight from HF, unaffected)",
    async () => {
      // Looked up by `id`, same reasoning as MODEL_05B above — array index is
      // not stable identity.
      const MODEL_15B = AYAS_PHONE_LLM_MODELS.find((m) => m.id === "onnx-community/Qwen2.5-1.5B-Instruct")!;
      assert.ok(MODEL_15B, "sanity: the 1.5B model must exist in AYAS_PHONE_LLM_MODELS for this test to mean anything");
      const originalFetch = env.fetch;
      const hfWeightUrl15b = buildRemoteResourceUrl(MODEL_15B, WEIGHT_FILE);
      let gatewayHitFor15b = false;
      let hfWeightHitFor15b = false;
      const weightBytes15b = fillBuffer(CHUNK_SIZE_BYTES + 999);
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(MODEL_15B, "config.json"), fillBuffer(2)],
        [buildRemoteResourceUrl(MODEL_15B, "tokenizer.json"), fillBuffer(3)],
        [buildRemoteResourceUrl(MODEL_15B, "tokenizer_config.json"), fillBuffer(4)],
        [hfWeightUrl15b, weightBytes15b],
      ]);
      env.fetch = (async (url: string, init?: RequestInit) => {
        if (url.startsWith(GATEWAY_ORIGIN)) gatewayHitFor15b = true;
        if (url === hfWeightUrl15b) hfWeightHitFor15b = true;
        return fakeRangeFetch(bodies, [])(url, init);
      }) as typeof env.fetch;
      try {
        await withGatewayConfigured(async () => {
          const outcome = await precacheModelFiles(MODEL_15B);
          assert.equal(outcome.ok, false, "a weight file with no gateway route must now be a hard failure, not a silent HF fallback");
          if (!outcome.ok) {
            assert.equal(outcome.reason, "gateway-not-configured");
            assert.equal(outcome.file, WEIGHT_FILE);
            assert.match(outcome.detail, /route-not-configured|tanımlı bir route yok/);
          }
        });
        assert.equal(gatewayHitFor15b, false, "the gateway must never be hit for a model it isn't scoped to");
        assert.equal(hfWeightHitFor15b, false, "ROUND 7: the weight file's direct-HF URL must NEVER be fetched either — no silent fallback");
        // The 3 small metadata files are NOT weight files — they still go straight to HF, unaffected.
        assert.equal(await getFileIdbStatus(buildRemoteResourceUrl(MODEL_15B, "config.json")), "complete");
        assert.equal(await getFileIdbStatus(hfWeightUrl15b), "none", "the weight file must never even be attempted, let alone stored");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  await scenario(
    "ROUND 8: the REAL production model (SmolLM2-135M-Instruct, the app's default/selected model) — its weight file request targets the EXACT real gateway URL, never huggingface.co, and Authorization is present",
    async () => {
      const SMOLLM2 = AYAS_PHONE_LLM_MODELS.find((m) => m.id === "HuggingFaceTB/SmolLM2-135M-Instruct")!;
      assert.ok(SMOLLM2, "sanity: SmolLM2-135M-Instruct must exist in AYAS_PHONE_LLM_MODELS — this IS the app's real default model");
      assert.equal(SMOLLM2, AYAS_PHONE_LLM_MODELS[0], "sanity: SmolLM2 must still be the default/first model — this test exercises the REAL production selection, not a substitute");

      const originalFetch = env.fetch;
      const hfWeightUrl = buildRemoteResourceUrl(SMOLLM2, WEIGHT_FILE);
      const expectedGatewayUrl = `${GATEWAY_ORIGIN}${GATEWAY_SMOLLM2_MODEL_PATH}`;
      let hfWeightHit = false;
      let gatewayWeightHit = false;
      let gatewayAuthHeaderSeen: string | null = null;
      let gatewayRangeHeaderSeen: string | null = null;
      const weightBytes = fillBuffer(CHUNK_SIZE_BYTES + 4321);
      const bodies = new Map<string, Uint8Array>([
        [buildRemoteResourceUrl(SMOLLM2, "config.json"), fillBuffer(2)],
        [buildRemoteResourceUrl(SMOLLM2, "tokenizer.json"), fillBuffer(3)],
        [buildRemoteResourceUrl(SMOLLM2, "tokenizer_config.json"), fillBuffer(4)],
        [expectedGatewayUrl, weightBytes],
      ]);
      env.fetch = (async (url: string, init?: RequestInit) => {
        if (url === hfWeightUrl) hfWeightHit = true;
        if (url === expectedGatewayUrl) {
          gatewayWeightHit = true;
          const headers = init?.headers as Record<string, string> | undefined;
          gatewayAuthHeaderSeen = headers?.Authorization ?? null;
          gatewayRangeHeaderSeen = headers?.Range ?? null;
        }
        return fakeRangeFetch(bodies, [])(url, init);
      }) as typeof env.fetch;
      try {
        const outcome = await withGatewayConfigured(() => precacheModelFiles(SMOLLM2));
        assert.equal(outcome.ok, true, outcome.ok ? "" : `${(outcome as { reason: string; detail: string }).reason}: ${(outcome as { detail: string }).detail}`);
        assert.equal(hfWeightHit, false, "PRODUCTION PATH PROOF: huggingface.co must NEVER be hit for SmolLM2's weight file");
        assert.equal(gatewayWeightHit, true, "PRODUCTION PATH PROOF: the real gateway URL must be hit for SmolLM2's weight file");
        assert.equal(gatewayAuthHeaderSeen, `Bearer ${PHONE_KEY}`, "Authorization: Bearer <stored phone key> must be present on the gateway request");
        assert.match(gatewayRangeHeaderSeen ?? "", /^bytes=\d+-\d+$/, "Range header must still be sent to the gateway, unchanged (captured from the LAST chunk — file downloads in more than one)");
        assert.equal(await getFileIdbStatus(hfWeightUrl), "complete", "storage key stays the plain HF-shaped URL regardless of the wire-level target — unchanged design");
      } finally {
        env.fetch = originalFetch;
      }
    },
  );

  console.log(`AYAS phone LLM precache smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-precache", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM precache smoke FAILED:", error);
  process.exitCode = 1;
});
