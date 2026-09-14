/**
 * AYAS phone-local LLM — chunked IndexedDB model-weight storage (Cache
 * Storage blocker closure sprint).
 *
 * WHY THIS EXISTS: real iPhone evidence proved `Cache.put()` cannot
 * reliably persist a ~460MB response body — `cache.put("onnx/model_q4f16.onnx")`
 * timed out at exactly the 180s bound after DOWNLOAD completed
 * successfully. Cache Storage is a one-shot "hand me the whole response"
 * API — there is no way to write it incrementally. IndexedDB is not: it is
 * a transactional key/value store where nothing stops us writing many
 * small, independent records instead of one huge one. This module never
 * asks IndexedDB to store anything bigger than `CHUNK_SIZE_BYTES` (8 MiB)
 * in a single `put()` — the full ~460MB file is ~58 such records, each a
 * fast, unremarkable write.
 *
 * Two object stores, both keyed by a plain string (no IndexedDB indexes,
 * no cursors, no key ranges — deliberately: every operation here is a
 * single exact-key get/put/delete, which keeps both this module and its
 * test double simple and predictable):
 *   - "meta"   — one record per file, keyed by the file's exact resolve
 *     URL (see `phoneLlmModelResources.ts`'s `buildRemoteResourceUrl` —
 *     same key convention Cache Storage used, just a different backend).
 *   - "chunks" — one record per (url, chunkIndex) pair, keyed by
 *     `${url}::${chunkIndex}`.
 *
 * `complete` on a meta record is set true ONLY after every chunk has been
 * written and the summed byte count matches the server-reported total
 * (`phoneLlmPrecacheDownloader.ts`'s VERIFYING phase) — a half-downloaded
 * file can never be read back as "ready" (`getModelIdbStatus` below
 * distinguishes none/partial/complete exactly like the old Cache Storage
 * checker did).
 *
 * PROCESS-DEATH DIAGNOSTIC PASS: two isolated real-device tests (one 8MB
 * network+IndexedDB round trip, one pure IndexedDB round trip) both
 * PASSED, while the full ~58-chunk download loop still died — consistently
 * right after a chunk's reader finished, before its write completed. That
 * pattern (single unit fine, many units in a row fail) pointed at
 * per-chunk resource accumulation, and this module previously opened TWO
 * separate `IDBTransaction`s per chunk (one via `putChunk()`, one via a
 * separately-called `putMeta()`) — ~116 for a 58-chunk file, all on one
 * long-lived connection that's never closed mid-download. `putChunkAndMeta()`
 * below combines both writes into ONE transaction, halving that count —
 * a minimal, architecture-preserving change targeting this specific,
 * measured hypothesis (not a chunk-size change, not a new storage
 * backend). `getIdbTransactionCount()` exposes the running total so it can
 * be correlated against the checkpoint trail's death point.
 */

export interface PhoneLlmIdbMeta {
  readonly key: string; // the file's exact resolve URL — also the "url" everywhere below
  readonly modelId: string;
  readonly file: string;
  readonly totalBytes: number;
  readonly chunkSize: number;
  readonly chunkCount: number;
  readonly downloadedBytes: number;
  readonly downloadedChunkCount: number;
  readonly etag: string | null;
  readonly complete: boolean;
  readonly updatedAt: number;
}

const DB_NAME = "ayas-phone-llm-storage";
const DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const META_STORE = "meta";

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function chunkKey(url: string, index: number): string {
  return `${url}::${index}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openPhoneLlmDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) db.createObjectStore(CHUNKS_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB.open failed"));
  });
  return dbPromise;
}

/**
 * Diagnostic only: forces the NEXT storage call to open a genuinely fresh
 * `indexedDB.open()` connection instead of reusing the memoized one — a
 * real proxy for "does this survive a page reload" without requiring an
 * actual navigation. A real reload trivially clears the memoized
 * `dbPromise` too (it's a plain module-level variable, not persisted) —
 * this function exists purely so a same-session diagnostic can exercise
 * that same cold-open path deliberately.
 */
export async function reopenPhoneLlmDbForDiagnostics(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
  }
  dbPromise = null;
}

function reqToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/**
 * Counts every `IDBTransaction` this module opens on the shared connection
 * (process-death diagnostic pass, item 4/5: "transaction/connection
 * nesnelerinin chunk'lar arasında birikmediğini kontrol et"). This module
 * has no JS-visible growing structure tied to it — re-audited this pass,
 * still true (see `phoneLlmPrecacheDownloader.ts`'s header) — this counter
 * exists purely to make the RAW COUNT itself part of the checkpoint trail,
 * so a real-device death can be correlated against "how many transactions
 * had this connection opened by then" even though what WebKit does
 * internally with that count is outside JS visibility (see
 * `phoneLlmMemoryProbe.ts`'s header for that boundary).
 */
let transactionCount = 0;
export function getIdbTransactionCount(): number {
  return transactionCount;
}

async function getStore(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openPhoneLlmDb();
  transactionCount += 1;
  return db.transaction(name, mode).objectStore(name);
}

export async function putChunk(url: string, index: number, bytes: Uint8Array): Promise<void> {
  const store = await getStore(CHUNKS_STORE, "readwrite");
  await reqToPromise(store.put({ key: chunkKey(url, index), bytes }));
}

/**
 * Writes a chunk AND updates the file's meta record in ONE `IDBTransaction`
 * spanning both object stores, instead of two separate transactions (the
 * previous design: `putChunk()` then a separate `putMeta()` call from the
 * caller — 2 transactions per chunk, ~116 for a 58-chunk file). Minimal,
 * architecture-preserving change targeting the specific resource-count
 * hypothesis this diagnostic pass investigates — NOT a chunk-size change,
 * NOT a new storage backend. Both writes commit together: if either fails,
 * the whole transaction aborts (IndexedDB's own atomicity), which is
 * strictly safer than the old two-separate-transactions design (previously,
 * a chunk write could succeed while its paired meta update failed
 * independently, leaving them inconsistent).
 */
export async function putChunkAndMeta(url: string, index: number, bytes: Uint8Array, meta: PhoneLlmIdbMeta): Promise<void> {
  const db = await openPhoneLlmDb();
  transactionCount += 1;
  const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
  const chunkStore = tx.objectStore(CHUNKS_STORE);
  const metaStore = tx.objectStore(META_STORE);
  await Promise.all([
    reqToPromise(chunkStore.put({ key: chunkKey(url, index), bytes })),
    reqToPromise(metaStore.put(meta)),
  ]);
}

export async function getChunk(url: string, index: number): Promise<Uint8Array | undefined> {
  const store = await getStore(CHUNKS_STORE, "readonly");
  const record = (await reqToPromise(store.get(chunkKey(url, index)))) as { bytes: Uint8Array } | undefined;
  return record?.bytes;
}

export async function deleteChunk(url: string, index: number): Promise<void> {
  const store = await getStore(CHUNKS_STORE, "readwrite");
  await reqToPromise(store.delete(chunkKey(url, index)));
}

export async function getMeta(url: string): Promise<PhoneLlmIdbMeta | undefined> {
  const store = await getStore(META_STORE, "readonly");
  return (await reqToPromise(store.get(url))) as PhoneLlmIdbMeta | undefined;
}

export async function putMeta(meta: PhoneLlmIdbMeta): Promise<void> {
  const store = await getStore(META_STORE, "readwrite");
  await reqToPromise(store.put(meta));
}

export async function deleteMeta(url: string): Promise<void> {
  const store = await getStore(META_STORE, "readwrite");
  await reqToPromise(store.delete(url));
}

/** Deletes every known chunk for `url` (per `meta.chunkCount`, or `fallbackChunkCount` when no meta exists — e.g. a write that died before any meta was ever recorded) plus the meta record itself. Used for "delete model" and for corrupt-storage recovery (spec: never leave a corrupt/partial record lying around to be mistaken for real progress). */
export async function deleteModelFile(url: string, fallbackChunkCount = 0): Promise<void> {
  const meta = await getMeta(url).catch(() => undefined);
  const chunkCount = meta?.chunkCount ?? fallbackChunkCount;
  const store = await getStore(CHUNKS_STORE, "readwrite");
  await Promise.all(
    Array.from({ length: chunkCount }, (_, index) => reqToPromise(store.delete(chunkKey(url, index))).catch(() => undefined)),
  );
  await deleteMeta(url).catch(() => undefined);
}

/**
 * Streams the stored chunks back out as a `Response`, in order, ONE CHUNK
 * AT A TIME (`pull`, not an eager `start` that enqueues everything) — so
 * reading a cached file back never holds more than the one chunk currently
 * in flight, matching the "never re-buffer the whole file" constraint this
 * entire storage layer exists to satisfy. `Content-Length` is set from the
 * verified `meta.totalBytes` so Transformers.js's own `readResponse()`
 * (which still, unavoidably, builds ONE final buffer from this stream —
 * see `phoneLlmRunner.ts`'s header) can size its buffer correctly.
 */
export function buildResponseFromStoredChunks(url: string, meta: PhoneLlmIdbMeta): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= meta.chunkCount) {
        controller.close();
        return;
      }
      const bytes = await getChunk(url, index);
      if (!bytes) {
        controller.error(new Error(`missing chunk ${index}/${meta.chunkCount} for ${url} — storage is corrupt`));
        return;
      }
      controller.enqueue(bytes);
      index += 1;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-length": String(meta.totalBytes) } });
}

export type PhoneLlmIdbStatus = "none" | "partial" | "complete";

/** Tri-state readiness for ONE file's meta record — mirrors the old Cache Storage `getModelCacheStatus`'s contract exactly (see `phoneLlmRunner.ts`), just reading from IndexedDB instead. */
export async function getFileIdbStatus(url: string): Promise<PhoneLlmIdbStatus> {
  if (!isIndexedDbAvailable()) return "none";
  try {
    const meta = await getMeta(url);
    if (!meta) return "none";
    return meta.complete ? "complete" : "partial";
  } catch {
    return "none";
  }
}

/**
 * Validates that a file's believed-downloaded progress is actually intact
 * before trusting it for a resume — reads back the LAST chunk the meta
 * record claims is done and checks its byte length is what that chunk
 * index should be (every chunk is exactly `chunkSize` bytes except the
 * final one). A mismatch (or the chunk being entirely missing) means the
 * record is corrupt — this app doesn't have a scenario for repairing a
 * single bad chunk without knowing which specific write failed, so the
 * safe recovery is the same one full-download-again everywhere else in
 * this file already uses for "not present": the caller deletes the file's
 * storage and restarts it from chunk 0 (cheap — resuming losslessly from
 * a genuinely corrupt point isn't something this design can prove is safe,
 * starting over is).
 */
export async function isResumePointIntact(meta: PhoneLlmIdbMeta): Promise<boolean> {
  if (meta.downloadedChunkCount === 0) return true; // nothing to validate yet
  const lastIndex = meta.downloadedChunkCount - 1;
  const expectedLength = lastIndex === meta.chunkCount - 1 ? meta.totalBytes - lastIndex * meta.chunkSize : meta.chunkSize;
  const bytes = await getChunk(meta.key, lastIndex).catch(() => undefined);
  return bytes !== undefined && bytes.byteLength === expectedLength;
}
