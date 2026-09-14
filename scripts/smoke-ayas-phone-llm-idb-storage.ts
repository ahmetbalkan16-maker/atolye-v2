/**
 * AYAS phone-local LLM — chunked IndexedDB storage smoke suite (Cache
 * Storage blocker closure sprint).
 *
 * No browser: `scripts/lib/FakeIndexedDb.ts` is a faithful minimal fake of
 * the exact `indexedDB` operations `phoneLlmIdbStorage.ts` uses (open +
 * upgrade, get/put/delete by exact key — no cursors/indexes, matching that
 * module's own deliberately simple usage).
 *
 * The 10 scenarios the closure sprint's item 12 asks for, plus the direct
 * proof that a stored file streams back out correctly for
 * `phoneLlmIdbCache.ts`'s `match()`:
 *  1. empty storage
 *  2. chunk write
 *  3. metadata
 *  4. incomplete state
 *  5. complete state
 *  6. reload simulation
 *  7. corrupt chunk
 *  8. recovery
 *  9. delete model
 *  10. offline retrieval
 */

import assert from "node:assert/strict";

import { installFakeIndexedDb, resetFakeIndexedDb } from "./lib/FakeIndexedDb";
import {
  deleteModelFile,
  getChunk,
  getFileIdbStatus,
  getMeta,
  isIndexedDbAvailable,
  isResumePointIntact,
  putChunk,
  putMeta,
  buildResponseFromStoredChunks,
} from "../src/components/brain/voice/localLlm/phoneLlmIdbStorage";

// `phoneLlmIdbStorage.ts` only touches the `indexedDB` global lazily,
// inside function bodies (`isIndexedDbAvailable()`, `openPhoneLlmDb()`) —
// never at module-evaluation time — so installing the fake here, before
// `run()`, is early enough regardless of import order above.
installFakeIndexedDb();

type PhoneLlmIdbMeta = Awaited<ReturnType<typeof getMeta>>;

const URL_A = "https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx";
const CHUNK_SIZE = 8 * 1024 * 1024;

function makeMeta(overrides: Partial<NonNullable<PhoneLlmIdbMeta>> = {}): NonNullable<PhoneLlmIdbMeta> {
  return {
    key: URL_A,
    modelId: "onnx-community/Qwen2.5-0.5B-Instruct",
    file: "onnx/model_q4f16.onnx",
    totalBytes: CHUNK_SIZE * 2 + 100,
    chunkSize: CHUNK_SIZE,
    chunkCount: 3,
    downloadedBytes: 0,
    downloadedChunkCount: 0,
    etag: "abc123",
    complete: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function bytesOfLength(n: number, fill = 7): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  resetFakeIndexedDb();
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  await scenario("1. empty storage → no meta, status 'none'", async () => {
    assert.equal(await getMeta(URL_A), undefined);
    assert.equal(await getFileIdbStatus(URL_A), "none");
  });

  await scenario("2. chunk write → readable back byte-for-byte", async () => {
    const bytes = bytesOfLength(1234, 9);
    await putChunk(URL_A, 0, bytes);
    const readBack = await getChunk(URL_A, 0);
    assert.ok(readBack);
    assert.deepEqual([...readBack!], [...bytes]);
    assert.equal(await getChunk(URL_A, 1), undefined, "a different chunk index must not exist yet");
  });

  await scenario("3. metadata round-trips every field", async () => {
    const meta = makeMeta({ downloadedBytes: 500, downloadedChunkCount: 1 });
    await putMeta(meta);
    const readBack = await getMeta(URL_A);
    assert.deepEqual(readBack, meta);
  });

  await scenario("4. incomplete state → status 'partial'", async () => {
    await putMeta(makeMeta({ complete: false, downloadedChunkCount: 1, downloadedBytes: CHUNK_SIZE }));
    assert.equal(await getFileIdbStatus(URL_A), "partial");
  });

  await scenario("5. complete state → status 'complete'", async () => {
    const meta = makeMeta({ complete: true, downloadedChunkCount: 3, downloadedBytes: meta_totalBytesOf() });
    await putMeta(meta);
    assert.equal(await getFileIdbStatus(URL_A), "complete");
  });

  await scenario("6. reload simulation: a fresh status read after 'closing the page' still finds the same complete record", async () => {
    await putMeta(makeMeta({ complete: true, downloadedChunkCount: 3, downloadedBytes: meta_totalBytesOf() }));
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 1, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 2, bytesOfLength(100));
    // "Reload" = nothing but time passing and re-reading fresh — no reset()
    // here (that would be the corruption/empty-storage case, not a reload).
    assert.equal(await getFileIdbStatus(URL_A), "complete");
    const response = buildResponseFromStoredChunks(URL_A, (await getMeta(URL_A))!);
    const body = await response.arrayBuffer();
    assert.equal(body.byteLength, meta_totalBytesOf());
  });

  await scenario("7. corrupt chunk detected: isResumePointIntact catches a wrong-length last chunk", async () => {
    const meta = makeMeta({ downloadedChunkCount: 2, downloadedBytes: CHUNK_SIZE * 2 });
    await putMeta(meta);
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 1, bytesOfLength(CHUNK_SIZE - 1)); // corrupt: one byte short
    assert.equal(await isResumePointIntact(meta), false);
  });

  await scenario("7b. corrupt chunk detected: isResumePointIntact catches a MISSING last chunk", async () => {
    const meta = makeMeta({ downloadedChunkCount: 2, downloadedBytes: CHUNK_SIZE * 2 });
    await putMeta(meta);
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    // chunk 1 never written — meta claims it is, storage disagrees.
    assert.equal(await isResumePointIntact(meta), false);
  });

  await scenario("7c. an intact resume point passes isResumePointIntact", async () => {
    const meta = makeMeta({ downloadedChunkCount: 2, downloadedBytes: CHUNK_SIZE * 2 });
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 1, bytesOfLength(CHUNK_SIZE)); // chunk 1 is NOT the last chunk overall (chunkCount=3), so full chunkSize is correct
    assert.equal(await isResumePointIntact(meta), true);
  });

  await scenario("8. recovery: deleteModelFile removes a corrupt record cleanly, leaving a fresh 'none' status", async () => {
    const meta = makeMeta({ downloadedChunkCount: 2, downloadedBytes: CHUNK_SIZE * 2 });
    await putMeta(meta);
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 1, bytesOfLength(10)); // corrupt

    await deleteModelFile(URL_A, meta.chunkCount);

    assert.equal(await getMeta(URL_A), undefined);
    assert.equal(await getChunk(URL_A, 0), undefined);
    assert.equal(await getChunk(URL_A, 1), undefined);
    assert.equal(await getFileIdbStatus(URL_A), "none", "must be able to start a clean re-download after recovery");
  });

  await scenario("9. delete model removes everything, including a fully complete one", async () => {
    const meta = makeMeta({ complete: true, downloadedChunkCount: 3, downloadedBytes: meta_totalBytesOf() });
    await putMeta(meta);
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 1, bytesOfLength(CHUNK_SIZE));
    await putChunk(URL_A, 2, bytesOfLength(100));

    await deleteModelFile(URL_A, meta.chunkCount);

    assert.equal(await getFileIdbStatus(URL_A), "none");
    assert.equal(await getChunk(URL_A, 0), undefined);
  });

  await scenario("10. offline retrieval: a complete record streams back out as a well-formed Response with no network involved", async () => {
    const meta = makeMeta({ complete: true, downloadedChunkCount: 3, downloadedBytes: meta_totalBytesOf() });
    await putMeta(meta);
    await putChunk(URL_A, 0, bytesOfLength(CHUNK_SIZE, 1));
    await putChunk(URL_A, 1, bytesOfLength(CHUNK_SIZE, 2));
    await putChunk(URL_A, 2, bytesOfLength(100, 3));

    const response = buildResponseFromStoredChunks(URL_A, meta);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(meta.totalBytes));
    const body = new Uint8Array(await response.arrayBuffer());
    assert.equal(body.byteLength, meta.totalBytes);
    // Spot-check ordering: first bytes come from chunk 0 (fill=1), last bytes from chunk 2 (fill=3).
    assert.equal(body[0], 1);
    assert.equal(body[body.length - 1], 3);
  });

  await scenario("isIndexedDbAvailable() reflects the global correctly", () => {
    assert.equal(isIndexedDbAvailable(), true);
  });

  console.log(`AYAS phone LLM IndexedDB storage smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-idb-storage", scenarios: count }));
}

function meta_totalBytesOf(): number {
  return CHUNK_SIZE * 2 + 100;
}

run().catch((error) => {
  console.error("AYAS phone LLM IndexedDB storage smoke FAILED:", error);
  process.exitCode = 1;
});
