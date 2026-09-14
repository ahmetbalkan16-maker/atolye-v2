/**
 * AYAS phone-local LLM runner — storage-completeness smoke suite (Cache
 * Storage blocker closure sprint: `getModelCacheStatus`/`isModelCached` now
 * read chunked IndexedDB meta records — `phoneLlmIdbStorage.ts` — instead
 * of Cache Storage. Retains the exact tri-state contract this always had:
 * "none"/"partial"/"complete", never a false "complete" for a download cut
 * off mid-way).
 *
 * No browser: `scripts/lib/FakeIndexedDb.ts` backs `indexedDB`. Deterministic
 * — no network, no real model load, no GPU.
 */

import assert from "node:assert/strict";

import { installFakeIndexedDb, resetFakeIndexedDb } from "./lib/FakeIndexedDb";

installFakeIndexedDb();

import {
  AYAS_PHONE_LLM_MODELS,
  getModelCacheStatus,
  isModelCached,
} from "../src/components/brain/voice/localLlm/phoneLlmRunner";
import { buildRemoteResourceUrl, getRequiredModelCacheFiles } from "../src/components/brain/voice/localLlm/phoneLlmModelResources";
import { putMeta, type PhoneLlmIdbMeta } from "../src/components/brain/voice/localLlm/phoneLlmIdbStorage";

const MODEL_05B = AYAS_PHONE_LLM_MODELS[0];
const MODEL_15B = AYAS_PHONE_LLM_MODELS[1];

/** Seeds a "complete" IndexedDB meta record for `file` on `model`, matching exactly what `phoneLlmPrecacheDownloader.ts` would have written after a real successful download+verify. */
async function seedComplete(model: typeof MODEL_05B, file: string): Promise<void> {
  const url = buildRemoteResourceUrl(model, file);
  const meta: PhoneLlmIdbMeta = {
    key: url,
    modelId: model.id,
    file,
    totalBytes: 1000,
    chunkSize: 1000,
    chunkCount: 1,
    downloadedBytes: 1000,
    downloadedChunkCount: 1,
    etag: null,
    complete: true,
    updatedAt: Date.now(),
  };
  await putMeta(meta);
}

let count = 0;
async function scenario(name: string, test: () => void | Promise<void>) {
  resetFakeIndexedDb();
  await test();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

async function run() {
  const required = getRequiredModelCacheFiles(MODEL_05B);
  const onnxFile = required.find((f) => f.endsWith(".onnx"))!;

  await scenario("empty storage → none, never throws", async () => {
    assert.equal(await getModelCacheStatus(MODEL_05B), "none");
    assert.equal(await isModelCached(MODEL_05B), false);
  });

  await scenario("only the .onnx weight file complete (the old single-file check's blind spot) → partial, not complete", async () => {
    await seedComplete(MODEL_05B, onnxFile);
    assert.equal(await getModelCacheStatus(MODEL_05B), "partial");
    assert.equal(await isModelCached(MODEL_05B), false, "a partial download must never be reported as ready");
  });

  await scenario("every required file except the .onnx (crash mid weight-file write, the original reported bug) → partial", async () => {
    for (const file of required) {
      if (file === onnxFile) continue;
      await seedComplete(MODEL_05B, file);
    }
    assert.equal(await getModelCacheStatus(MODEL_05B), "partial");
  });

  await scenario("tokenizer_config.json complete but config.json missing → NOT falsely counted as config.json (per-file key isolation)", async () => {
    await seedComplete(MODEL_05B, "tokenizer.json");
    await seedComplete(MODEL_05B, "tokenizer_config.json");
    await seedComplete(MODEL_05B, onnxFile);
    // 3 of 4 required distinct files complete (config.json missing) → partial, never complete.
    assert.equal(await getModelCacheStatus(MODEL_05B), "partial");
  });

  await scenario("all 4 required files complete → complete", async () => {
    for (const file of required) await seedComplete(MODEL_05B, file);
    assert.equal(await getModelCacheStatus(MODEL_05B), "complete");
    assert.equal(await isModelCached(MODEL_05B), true);
  });

  await scenario("a file present but NOT yet marked complete (in-progress download) → partial, not complete", async () => {
    // Realistic scenario: the 3 small files finished first (files download
    // in a fixed order), the big weight file is still mid-flight.
    for (const file of required) {
      if (file !== onnxFile) await seedComplete(MODEL_05B, file);
    }
    const url = buildRemoteResourceUrl(MODEL_05B, onnxFile);
    await putMeta({
      key: url,
      modelId: MODEL_05B.id,
      file: onnxFile,
      totalBytes: 1000,
      chunkSize: 500,
      chunkCount: 2,
      downloadedBytes: 500,
      downloadedChunkCount: 1,
      etag: null,
      complete: false, // in flight
      updatedAt: Date.now(),
    });
    assert.equal(await getModelCacheStatus(MODEL_05B), "partial");
  });

  await scenario("another model's (1.5B) fully-downloaded files never count toward the 0.5B model's completeness (model-id isolation)", async () => {
    for (const file of getRequiredModelCacheFiles(MODEL_15B)) await seedComplete(MODEL_15B, file);
    assert.equal(await getModelCacheStatus(MODEL_05B), "none");
    assert.equal(await getModelCacheStatus(MODEL_15B), "complete");
  });

  await scenario("model size labels are the real, verified HF repo blob sizes — not placeholders", () => {
    // Guards against inventing a model ID/size: both labels were checked
    // against `GET /api/models/<id>?blobs=true`, not estimated.
    assert.match(MODEL_05B.approxSizeLabel, /^~[\d.]+ (MB|GB)$/);
    assert.match(MODEL_15B.approxSizeLabel, /^~[\d.]+ (MB|GB)$/);
    assert.equal(MODEL_05B.dtype, "q4f16");
    assert.equal(MODEL_15B.dtype, "q4f16");
  });

  console.log(`AYAS phone LLM runner smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-phone-llm-runner", scenarios: count }));
}

run().catch((error) => {
  console.error("AYAS phone LLM runner smoke FAILED:", error);
  process.exitCode = 1;
});
