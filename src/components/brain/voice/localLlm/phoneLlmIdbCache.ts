/**
 * AYAS phone-local LLM — `env.customCache` adapter (Cache Storage blocker
 * closure sprint).
 *
 * `@huggingface/transformers`'s own `src/utils/cache.js` `getCache()`
 * checks `env.useCustomCache`/`env.customCache` FIRST, before
 * `env.useBrowserCache` (native Cache Storage) or `env.useFSCache` — this
 * is a real, public, documented extension point (source-verified, not
 * assumed): "Allow the user to specify a custom cache system... must
 * implement the `match` and `put` functions of the Web Cache API." Setting
 * `env.useCustomCache = true; env.customCache = phoneLlmIdbCache;`
 * (done once, in `phoneLlmRunner.ts`) makes EVERY `pipeline()` file lookup
 * go through this object instead of `caches.open(...)` — no fork, no
 * node_modules patch.
 *
 * `match(key)`: `key` is the exact resolve URL Transformers.js itself
 * constructed (`buildResourcePaths().remoteURL`/`proposedCacheKey` in the
 * library's `hub.js` — identical to what `buildRemoteResourceUrl` in
 * `phoneLlmModelResources.ts` independently reproduces, verified
 * byte-for-byte in `scripts/smoke-ayas-phone-llm-precache.ts`). Looks up
 * the IndexedDB meta record for that exact URL; returns `undefined` unless
 * it is `complete` — an incomplete/corrupt record is NEVER handed to
 * Transformers.js as if it were a real file (that was the whole failure
 * mode this closure sprint exists to close for good).
 *
 * `put(key, response)`: a DEFENSIVE FALLBACK, not the primary path.
 * `phoneLlmPrecacheDownloader.ts` always finishes writing every required
 * file to IndexedDB itself (chunked, Range-fetched, see that file's
 * header) BEFORE `pipeline()` is ever called — so in the expected flow,
 * `match()` always hits and `put()` is never reached at all. It's
 * implemented properly anyway (chunks the incoming stream itself, in
 * bounded `CHUNK_SIZE_BYTES` pieces — never buffers the whole body) so an
 * unexpected file Transformers.js asks for outside our own pre-fetch list
 * still persists correctly rather than silently failing.
 */

import {
  buildResponseFromStoredChunks,
  deleteModelFile,
  getMeta,
  isIndexedDbAvailable,
  putChunk,
  putMeta,
  type PhoneLlmIdbMeta,
} from "./phoneLlmIdbStorage";

/** Must match `phoneLlmPrecacheDownloader.ts`'s `CHUNK_SIZE_BYTES` — both files size their IndexedDB writes identically so a file started by one code path resumes correctly under the other. Re-declared here (not imported) to keep this adapter fully standalone/reusable; a shared-constant mismatch would only ever affect the fallback `put()` path, and both values are kept in sync by the same closure-sprint change. */
const FALLBACK_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

export interface AyasPhoneLlmCustomCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export const phoneLlmIdbCache: AyasPhoneLlmCustomCache = {
  async match(key: string): Promise<Response | undefined> {
    if (!isIndexedDbAvailable()) return undefined;
    try {
      const meta = await getMeta(key);
      if (!meta || !meta.complete) return undefined;
      return buildResponseFromStoredChunks(key, meta);
    } catch (error) {
      console.warn(`[ayas phone-llm] idb cache match() failed for "${key}"`, error);
      return undefined;
    }
  },

  async put(key: string, response: Response): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    const reader = response.body?.getReader();
    if (!reader) return;

    const total = Number(response.headers.get("content-length")) || null;
    let downloadedBytes = 0;
    let chunkIndex = 0;
    let accumulated: Uint8Array[] = [];
    let accumulatedLength = 0;

    const flush = async () => {
      if (accumulatedLength === 0) return;
      const combined = new Uint8Array(accumulatedLength);
      let offset = 0;
      for (const part of accumulated) {
        combined.set(part, offset);
        offset += part.length;
      }
      await putChunk(key, chunkIndex, combined);
      chunkIndex += 1;
      accumulated = [];
      accumulatedLength = 0;
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated.push(value);
      accumulatedLength += value.byteLength;
      downloadedBytes += value.byteLength;
      if (accumulatedLength >= FALLBACK_CHUNK_SIZE_BYTES) await flush();
    }
    await flush();

    const meta: PhoneLlmIdbMeta = {
      key,
      modelId: "unknown", // this fallback path has no model context — informational field only
      file: key,
      totalBytes: total ?? downloadedBytes,
      chunkSize: FALLBACK_CHUNK_SIZE_BYTES,
      chunkCount: chunkIndex,
      downloadedBytes,
      downloadedChunkCount: chunkIndex,
      etag: response.headers.get("etag"),
      complete: total === null || total === downloadedBytes,
      updatedAt: Date.now(),
    };
    if (!meta.complete) {
      // Never leave a half-written fallback record lying around as if it
      // were progress — same "never trust a partial write" rule the
      // primary downloader follows.
      await deleteModelFile(key, chunkIndex).catch(() => {});
      throw new Error(`fallback put(): incomplete write for "${key}" (${downloadedBytes}/${total ?? "unknown"} bytes)`);
    }
    await putMeta(meta);
  },
};
