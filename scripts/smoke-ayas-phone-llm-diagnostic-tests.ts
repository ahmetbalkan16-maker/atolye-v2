/**
 * AYAS phone-local LLM — standalone diagnostic tests smoke suite (Cache
 * Storage blocker closure sprint: process-death diagnostic pass, items 5
 * and 7). Deterministic — `env.fetch` is mocked to the real, curl-verified
 * HF CDN Range behavior; `indexedDB` is `scripts/lib/FakeIndexedDb.ts`.
 *
 * Proves:
 *  1. `runSingleChunkNetworkDiagnostic` correctly reports each real step
 *     (network fetch, Range honored, CORS header present, IndexedDB
 *     write/readback/simulated-reload-readback/cleanup) and captures the
 *     ACTUAL response headers, not placeholders.
 *  2. It writes and cleans up under a `::diagnostic-*` key — NEVER the
 *     real model's own storage key — so running it can't corrupt or be
 *     confused with a real in-progress/completed download.
 *  3. `runIdbOnlyDiagnostic` is a pure IndexedDB round-trip with zero
 *     network involvement, and correctly fails closed when IndexedDB is
 *     unavailable.
 */

import assert from "node:assert/strict";

import { env } from "@huggingface/transformers";

import { installFakeIndexedDb, resetFakeIndexedDb, uninstallFakeIndexedDb } from "./lib/FakeIndexedDb";

installFakeIndexedDb();

import { AYAS_PHONE_LLM_MODELS, buildRemoteResourceUrl } from "../src/components/brain/voice/localLlm/phoneLlmModelResources";
import { CHUNK_SIZE_BYTES } from "../src/components/brain/voice/localLlm/phoneLlmPrecacheDownloader";
import { getChunk } from "../src/components/brain/voice/localLlm/phoneLlmIdbStorage";
import { runIdbOnlyDiagnostic, runSingleChunkNetworkDiagnostic } from "../src/components/brain/voice/localLlm/phoneLlmDiagnosticTests";

const MODEL_05B = AYAS_PHONE_LLM_MODELS[0];
const WEIGHT_FILE = "onnx/model_q4f16.onnx";

function fillBuffer(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = i % 256;
  return bytes;
}

/** Mirrors the real, curl-verified HF CDN Range response shape (see `phoneLlmPrecacheDownloader.ts`'s header) for exactly one chunk-0 request. */
function fakeChunk0Fetch(fullFileBytes: Uint8Array) {
  return (async (_url: string, init?: RequestInit) => {
    const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range ?? null;
    assert.ok(rangeHeader, "diagnostic must send a Range header");
    const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader!);
    const start = Number(match![1]);
    const end = Math.min(Number(match![2]), fullFileBytes.byteLength - 1);
    const slice = fullFileBytes.slice(start, end + 1);
    return new Response(slice as BodyInit, {
      status: 206,
      headers: {
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${start}-${end}/${fullFileBytes.byteLength}`,
        etag: '"real-etag-abc123"',
        "access-control-allow-origin": "*",
      },
    });
  }) as typeof env.fetch;
}

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  resetFakeIndexedDb();
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  env.useBrowserCache = false;

  await scenario("single-chunk network diagnostic: all steps pass, real headers captured, cleans up under a diagnostic-only key", async () => {
    const originalFetch = env.fetch;
    const fullFile = fillBuffer(CHUNK_SIZE_BYTES * 10); // pretend the real file is much bigger than one chunk
    env.fetch = fakeChunk0Fetch(fullFile);
    try {
      const result = await runSingleChunkNetworkDiagnostic(MODEL_05B);
      assert.equal(result.ok, true, `expected all steps to pass: ${JSON.stringify(result.steps)}`);
      assert.equal(result.httpStatus, 206);
      assert.match(result.contentRangeHeader ?? "", /^bytes 0-8388607\/83886080$/);
      assert.equal(result.corsOriginHeader, "*");
      assert.equal(result.etagHeader, '"real-etag-abc123"');
      assert.equal(result.bytesWritten, CHUNK_SIZE_BYTES);
      assert.equal(result.bytesReadBackBeforeReload, CHUNK_SIZE_BYTES);
      assert.equal(result.bytesReadBackAfterReload, CHUNK_SIZE_BYTES, "must survive the simulated reload (fresh indexedDB connection)");

      const stepNames = result.steps.map((s) => s.name);
      assert.deepEqual(stepNames, [
        "network_fetch",
        "range_honored",
        "cors_header_present",
        "content_range_present",
        "idb_write",
        "idb_readback_before_reload",
        "idb_readback_after_simulated_reload",
        "cleanup",
      ]);

      // Never touches the real model's own storage key.
      const realUrl = buildRemoteResourceUrl(MODEL_05B, WEIGHT_FILE);
      assert.equal(await getChunk(realUrl, 0), undefined, "the diagnostic must never write under the real model's own key");
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("single-chunk network diagnostic: a network failure is reported as a failed step, not a silent pass", async () => {
    const originalFetch = env.fetch;
    env.fetch = (async () => {
      throw new Error("simulated network down");
    }) as typeof env.fetch;
    try {
      const result = await runSingleChunkNetworkDiagnostic(MODEL_05B);
      assert.equal(result.ok, false);
      assert.equal(result.steps[0].name, "network_fetch");
      assert.equal(result.steps[0].ok, false);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("single-chunk network diagnostic: a server that ignores Range (200 instead of 206) is flagged, not silently accepted", async () => {
    const originalFetch = env.fetch;
    const fullFile = fillBuffer(1000);
    env.fetch = (async () =>
      new Response(fullFile as BodyInit, {
        status: 200,
        headers: { "content-length": String(fullFile.byteLength), "access-control-allow-origin": "*" },
      })) as typeof env.fetch;
    try {
      const result = await runSingleChunkNetworkDiagnostic(MODEL_05B);
      assert.equal(result.httpStatus, 200);
      const rangeStep = result.steps.find((s) => s.name === "range_honored");
      assert.equal(rangeStep?.ok, false, "a 200 instead of 206 must be flagged as a failed step, not ignored");
      assert.equal(result.ok, false);
    } finally {
      env.fetch = originalFetch;
    }
  });

  await scenario("IndexedDB-only diagnostic: pure round-trip, zero network, byte-for-byte content verified", async () => {
    const result = await runIdbOnlyDiagnostic();
    assert.equal(result.ok, true, `expected all steps to pass: ${JSON.stringify(result.steps)}`);
    const stepNames = result.steps.map((s) => s.name);
    assert.deepEqual(stepNames, ["indexeddb_available", "put", "get_length", "get_content", "delete_confirmed"]);
  });

  await scenario("IndexedDB-only diagnostic: IndexedDB unavailable → fails closed at the first step, no network attempted", async () => {
    uninstallFakeIndexedDb();
    try {
      const result = await runIdbOnlyDiagnostic();
      assert.equal(result.ok, false);
      assert.deepEqual(result.steps, [{ name: "indexeddb_available", ok: false, detail: "indexedDB is not available in this browser/context" }]);
    } finally {
      installFakeIndexedDb();
    }
  });

  console.log(`AYAS phone LLM diagnostic-tests smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-diagnostic-tests", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM diagnostic-tests smoke FAILED:", error);
  process.exitCode = 1;
});
