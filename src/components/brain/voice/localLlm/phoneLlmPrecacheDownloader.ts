/**
 * AYAS phone-local LLM — chunked Range-fetch → IndexedDB downloader
 * (Cache Storage blocker closure sprint; this pass: PROVEN root cause +
 * fix for the "dies right after chunk:reader_complete" process-death
 * pattern — see below, not another round of memory-pressure diagnostics).
 *
 * REAL DEVICE PROOF THAT ENDED THE Cache Storage APPROACH FOR GOOD:
 *   DOWNLOAD → completed successfully
 *   PERSIST  → `cache.put("onnx/model_q4f16.onnx")` → 180000ms → cache-put-timeout
 * Cache Storage's `put()` is a single "hand me the whole response, I'll
 * write it as one unit" call — no partial-write API exists in that spec.
 * Cache Storage stays retired for model weights.
 *
 * PROVEN ROOT CAUSE OF THE FOLLOW-UP "dies after chunk:reader_complete"
 * FAILURE (fine-grained checkpoints finally made this legible instead of a
 * guess): on a real device, chunk 0's checkpoint trail showed
 * `chunk:reader_complete chunk=0 [483003582]` — 483,003,582 being the
 * EXACT known total file size — and `chunk:bytes_progress` for chunk 0
 * climbing 373MB → 482MB → 483MB, for a request that asked for
 * `bytes=0-8388607` (8MB). Both values are `loaded`, a variable LOCAL to
 * ONE `fetchOneChunk()` call (confirmed by re-reading this file's own
 * source, not assumed) — so this was not a global-progress artifact, it
 * was one single Range request's response being read in its entirety.
 * The PRIOR version of `fetchOneChunk()` never checked `response.status`
 * before reading the body — it read whatever came back, sized purely by
 * the response's own `content-length` header, and only the CALLER checked
 * status (200 vs 206) AFTER the read had already happened. So when THIS
 * particular chunk-0 request received a non-partial response (status 200,
 * full file), the function still buffered the entire ~460MB into one
 * `Uint8Array` before anyone decided that was even the right thing to do.
 * The process died in the narrow window right after that buffer finished
 * materializing (`chunk:reader_complete` fired — JS was still alive at
 * that exact synchronous point) and before the caller's next line ran.
 * This is the DIRECT, foreseeable cause — not an unexplained iOS/WebKit
 * memory-pressure mystery to keep hypothesizing about.
 *
 * WHY did chunk 0 get a non-206 response here when `curl` (see below) and
 * this app's OWN isolated "8MB Ağ + IndexedDB Testi" diagnostic (real
 * device, same URL, same Range header, PASSED) both got a clean 206?
 * Genuinely not confirmed — flagged honestly as a hypothesis, not fact:
 * HuggingFace's `resolve` endpoint 302-redirects to a FRESH, time-limited
 * signed CloudFront URL on every hit (verified via curl -L — a new
 * `Signature=`/`Expires=` each time), so a Range request during a real
 * multi-file download may land on a different edge/cache state than an
 * isolated one-off diagnostic call did moments earlier — CDNs are known to
 * sometimes "collapse" a Range request into a full origin fetch (200, full
 * body) on an edge cache MISS, only honoring Range cleanly once that edge
 * has the object cached. This is NOT confirmed from this codebase alone —
 * the fix below is correct and necessary regardless of which explanation
 * is right.
 *
 * THE FIX (round 1): `fetchOneChunk()` now checks `response.status`
 * against what THIS request actually expects BEFORE reading any of the
 * body — a mismatch cancels the body unread (`response.body?.cancel()`)
 * and returns `bodyConsumed: false`.
 *
 * ROUND 2 — REAL DEVICE PROVED ROUND 1 WAS NECESSARY BUT NOT SUFFICIENT:
 * a follow-up on-device retest showed the SAME death recurring —
 * `chunk:reader_complete chunk=0 [483003582]` again — despite the status
 * gate working exactly as designed: the trail showed
 * `chunk:aborted_unexpected_status [expected 206, got 200]` fire correctly
 * (this iPhone's `fetch()` gets `HTTP 200` + `Content-Range: absent` for
 * `bytes=0-8388607` on this URL, consistently — not an intermittent CDN
 * edge-cache-miss as round 1 speculated; ~100% reproducible on this
 * device). The gate did its job: `fetchOneChunk`'s OWN body was never
 * read. But the CALLER then did exactly what round 1's fix explicitly
 * still allowed: it treated a non-206 chunk-0 probe as "Range must not be
 * supported here" and DELIBERATELY made a second, unranged request
 * (`handleWholeFileFallback`, `fetchOneChunk({ range: null, ... })`) —
 * and that second request's body WAS read in full, because status 200 is
 * exactly what an unranged request expects. The vulnerability didn't
 * survive inside `fetchOneChunk` — it moved one call frame up, into the
 * caller's own deliberate choice to fall back to an unbounded read. Round
 * 1's fix was real and still necessary (it closes the "read an
 * UNVERIFIED body" bug); it was never sufficient on its own to close the
 * "deliberately read a VERIFIED-but-unbounded whole-file body" bug, which
 * is a separate decision made one level up.
 *
 * WHY THE FALLBACK ITSELF IS THE DANGEROUS PART: on this device/URL, Range
 * isn't an occasionally-missed edge case — every probe for this file
 * returns 200 with no `Content-Range`, so "whole-file fallback" was not a
 * rare tolerated path, it was THE path every single download attempt took,
 * unconditionally. `handleWholeFileFallback` held that ~483MB response in
 * one `Uint8Array` (the only way to slice a body the server insists on
 * sending as one unit, with no streaming/backpressure architecture in this
 * codebase to avoid it) — guaranteeing the exact process death this whole
 * sprint exists to eliminate, on every attempt, not occasionally.
 *
 * THE FIX (round 2): the whole-file fallback is REMOVED, not hardened.
 * `handleWholeFileFallback()` and its `persistChunkOnly()` helper no
 * longer exist in this file. `fetchOneChunk()`'s `range` parameter is now
 * non-nullable — there is no code path left, anywhere in this file, that
 * can construct a request without a `Range` header, so the previous
 * `"no-range (whole-file fallback)"` checkpoint text is gone because that
 * branch is gone, structurally, not just behaviorally avoided. When chunk
 * 0's probe returns anything other than 206, `downloadFileToIdb` now SAFE
 * ABORTS — returns the same typed `"range-not-supported"` failure a LATER
 * chunk losing Range support mid-download already produced (see the main
 * loop below) — instead of ever making a second, unranged request. No
 * production code path can read more than `CHUNK_SIZE_BYTES` into memory,
 * period; if this device/URL genuinely never honors Range, downloads on it
 * fail loudly and immediately instead of buffering the whole file once.
 *
 * CHECKPOINT RETENTION FIX (same real-device report): the trail's ~100
 * history slots were almost entirely `chunk:bytes_progress` entries from
 * this one runaway read, evicting every other checkpoint — including
 * earlier ones from the SAME chunk (`chunk:response_status`,
 * `chunk:content_range`) that would have made this diagnosis immediate
 * instead of requiring this second round-trip. `phoneLlmDiagnostics.ts`
 * now routes high-frequency progress ticks to their own small, separate
 * buffer that can never evict a milestone checkpoint — see that file's
 * header.
 *
 * Every sub-step of every chunk that actually proceeds to a read is still
 * checkpointed (`chunk:start` → `chunk:fetch_start` [always
 * `bytes=start-end` now — a Range header is no longer optional, see round
 * 2 above] → `chunk:response_received` → `chunk:response_status` →
 * `chunk:content_range` → [`chunk:aborted_unexpected_status`, on a
 * mismatch — SAFE ABORT, see `downloadFileToIdb`] → `chunk:reader_start` →
 * `chunk:memory_sample` [pre-read] → `chunk:first_bytes` →
 * `chunk:bytes_progress` (own retention channel) → `chunk:reader_complete`
 * → `chunk:memory_sample` [pre-write, in `persistChunkAndMeta`] →
 * `chunk:idb_write_start` → `chunk:idb_write_complete` →
 * `chunk:memory_sample` [post-write] → `chunk:buffer_finalized` OR
 * `chunk:finalization_unsupported` [per-chunk] → `chunk:complete`) — this
 * is exactly the guaranteed per-chunk summary set the real-device report
 * asked for.
 *
 * MEMORY/COPY AUDIT (still holds, re-confirmed this pass): `fetchOneChunk()`
 * allocates exactly ONE `Uint8Array`, now provably bounded to what was
 * actually verified as this ONE request's real partial-content size (not
 * merely "whatever `content-length` claimed", which was the gap that let
 * the bug through) — filled via a manual `reader.read()` loop, handed once
 * to `putChunkAndMeta()`. Nothing accumulates across chunks; no chunk's
 * bytes outlive their own loop iteration.
 *
 * `curl` proof the SERVER supports Range for this URL (does not by itself
 * prove what a real on-device `fetch()` receives on every attempt — see
 * above):
 *   curl -sI -L -H "Range: bytes=0-8388607" \
 *     https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/resolve/main/onnx/model_q4f16.onnx
 *   → HTTP/1.1 206 Partial Content
 *   → content-range: bytes 0-8388607/483003582
 *   → access-control-allow-origin: *
 *   → etag: "927c2ad9b83d24e09f498fe7eb2760a9c07cffd3f86ef24792b13cc14cda6de2"
 *
 * `CHUNK_SIZE_BYTES` stays at 8 MiB this pass — this fix does not depend
 * on the chunk size, and the sprint instruction is explicit: don't change
 * it without proof it's the problem (it isn't — the problem was reading an
 * unverified, unbounded body, not the size chosen for a verified one).
 *
 * ROUND 3 — GATEWAY WIRED IN (real-device PROVEN, not hypothesized): the
 * in-app "Range Teşhisi" tool's three-probe comparison confirmed on a real
 * iPhone that direct `huggingface.co` Range requests for
 * `GATEWAY_MODEL_ID`'s `GATEWAY_MODEL_FILE` get `200` (Range ignored) —
 * both straight (probe A) and cache-busted (probe B) — while the SAME
 * request through the deployed `ayas-phone-gateway` Cloudflare Worker gets
 * a clean `206` (probe C). `resolvePhoneLlmNetworkFetch` (below) now routes
 * ONLY that one file's ACTUAL NETWORK FETCH through the gateway when it's
 * configured on this device (`NEXT_PUBLIC_AYAS_WORKER_URL` +
 * a bootstrapped `ayasPhoneKey`, the SAME mechanism already used for the
 * chat-fallback route — see `ayasPhoneFallback.ts`); every other file, and
 * this file when the gateway isn't configured, is completely unaffected —
 * same direct HF URL as always. Critically, the STORAGE KEY (IndexedDB
 * `meta.key`/chunk keys, and what Transformers.js's own
 * `env.customCache.match()` looks up during model load) is UNCHANGED —
 * still `buildRemoteResourceUrl`'s plain HF-shaped URL. Only the wire-level
 * `fetch()` target differs; nothing about what gets stored, or how
 * `phoneLlmRunner.ts` finds it later, changes. `fetchOneChunk` gained one
 * new, strictly additive parameter (`extraHeaders`, used only to carry the
 * gateway's `Authorization: Bearer <phone key>`) — every other call site
 * omits it and is byte-for-byte unaffected. The chunk/Range/SAFE-ABORT
 * mechanics inside `fetchOneChunk` are completely untouched: it has no idea
 * whether the URL it was given is HF or the gateway.
 *
 * ROUND 4 — SMALL METADATA FILES DON'T NEED RANGE AT ALL (real-device
 * follow-up to round 3): with the ONNX weight file routed through the
 * gateway and getting a clean 206, the NEXT real-device attempt failed
 * differently — `range-not-supported: config.json: chunk 0 probe: server
 * returned HTTP 200 instead of 206 Partial Content`. ROOT CAUSE, confirmed
 * by re-reading this file's own prior structure, not assumed: EVERY
 * required file — including the tiny `config.json`/`tokenizer.json`/
 * `tokenizer_config.json` (bytes to a few hundred KB, never remotely close
 * to `CHUNK_SIZE_BYTES`) — was being pushed through the SAME chunked
 * `fetchOneChunk()` path as the ~460MB weight file, unconditionally
 * requiring a `Range` header and a `206` response. This iPhone doesn't
 * honor `Range` for direct `huggingface.co` requests AT ALL on this device
 * (already proven for the weight file via the "Range Teşhisi" tool's
 * probes A/B) — so the SAME thing now surfaced for `config.json`, which was
 * never routed through the gateway (out of the gateway's scope by design —
 * see round 3) and so still hits direct HF, still gets `200`, and SAFE
 * ABORTS exactly as designed. The SAFE ABORT fired correctly — the bug was
 * requiring `Range`/`206` for a file that never needed chunking in the
 * first place, not a defect in the abort logic itself.
 *
 * THE FIX (round 4): routing through this file's TWO fetch strategies is
 * now explicit and deterministic BY FILE IDENTITY (`isChunkedWeightFile`,
 * checking the `.onnx` suffix `getRequiredModelCacheFiles` always uses for
 * exactly one file per model) — never by a runtime byte-size check:
 *   - The ONNX weight file → UNCHANGED: `fetchOneChunk()`'s chunked
 *     `Range`/`206`/SAFE-ABORT path, through the gateway when configured
 *     (round 3) or direct HF chunked otherwise. Every line of that logic,
 *     every checkpoint, the removed-whole-file-fallback guarantee (round
 *     2) — all untouched.
 *   - `config.json`/`tokenizer.json`/`tokenizer_config.json` → NEW:
 *     `fetchWholeFile()`, a plain, single, un-Ranged GET expecting a plain
 *     `200` — the normal way to fetch a small file, which these always
 *     were. It is NOT a reintroduction of the removed whole-file fallback:
 *     that term specifically meant "probe expecting 206, get 200 instead,
 *     then DELIBERATELY re-fetch the ~460MB weight file unranged and
 *     buffer all of it" — a bug born from treating an UNEXPECTED response
 *     to a LARGE file as license to buffer it. `fetchWholeFile()` is the
 *     OPPOSITE: an INTENTIONAL, ALWAYS-used strategy for files that were
 *     NEVER large, gated by an explicit defensive size ceiling
 *     (`CHUNK_SIZE_BYTES`) so even a surprising oversized response for a
 *     file this codebase never expects to be large still fails closed
 *     before being read, rather than ever buffering an unbounded body.
 *   Both strategies persist through the SAME `persistChunkAndMeta()` /
 *   IndexedDB storage shape (`chunkCount: 1` for a whole-file fetch is
 *   exactly what a small file already produced when Range WAS honored —
 *   no storage-format change, no `phoneLlmIdbCache.ts`/model-load change).
 *
 * ROUND 6 — REAL-DEVICE `TypeError` ON THE GATEWAY FETCH ITSELF, WITH THE
 * GATEWAY'S RESPONSE INDEPENDENTLY PROVEN CORRECT: a real device reported
 * `network-error: onnx/model_q4f16.onnx: Type error` for the SmolLM2
 * gateway route AFTER round 5's CORS-header fix was live. One real,
 * authenticated request to the deployed gateway this pass (key read from
 * the local secret file, used only in-memory, never logged) confirmed the
 * server-side response is byte-perfect: `Content-Length: 8388608` exactly
 * matches the actual bytes received, no `Content-Encoding`/compression
 * artifact, every CORS header correct for the real production Origin. With
 * the response independently proven correct, `TypeError: Type error` —
 * thrown by `env.fetch()` itself, before any response is received (its
 * promise settles once headers arrive, well before the read loop runs) —
 * is WebKit's own generic message for a rejected cross-origin,
 * Range+Authorization-bearing preflighted fetch; this project has already
 * hit one other WebKit Range-handling quirk (the whole reason the gateway
 * exists) and this reads as the same class of "iOS's fetch() layer, not
 * the server, behaves inconsistently" issue, not reproducible from `curl`
 * (curl performs no CORS enforcement at all). Fixed the only way available
 * without real-device tooling: (1) `fetchOneChunk`'s initial `env.fetch()`
 * call now retries up to 2 extra times on a genuine rejection (never on a
 * timeout, never on a received-but-wrong-status response — both stay
 * exactly as before), each attempt logged via `chunk:fetch_retry`
 * (attempt number + the rejection's own generic error message — never
 * anything from the Authorization header); (2) a real, separate gap found
 * while auditing this same function for the user's iOS-compatibility
 * checklist: `reader.read()`'s mid-stream rejection was previously
 * UNCAUGHT here, contradicting `precacheModelFiles`'s own "never throws"
 * contract — now converted to the same typed outcome instead of an
 * unhandled rejection. Both changes preserve every existing
 * SAFE-ABORT/status-gate guarantee unchanged; a persistent (non-transient)
 * failure still ends in the exact same typed outcome as before, just after
 * up to 2 extra bounded attempts instead of 1.
 *
 * ROUND 5 — SECOND GATEWAY-SCOPED MODEL (SmolLM2-135M-Instruct added as the
 * phone-fallback model, `AYAS_PHONE_LLM_MODELS[0]`): its weight file hit the
 * SAME `range-not-supported: ... chunk 0 probe: server returned HTTP 200
 * instead of 206 Partial Content` signature the Qwen file originally did —
 * expected, since `resolvePhoneLlmNetworkFetch` (below) only ever routed the
 * ONE (model, file) pair hardcoded via round 3 through the gateway; every
 * other model/file, SmolLM2's weight file included, silently took the
 * direct-HF path already proven broken for large ONNX files on this device
 * class. `phoneLlmGatewayConfig.ts`'s single trio of constants
 * (`GATEWAY_MODEL_ID`/`GATEWAY_MODEL_FILE`/`GATEWAY_MODEL_PROXY_PATH`) is
 * now a small, closed route list (`AYAS_PHONE_LLM_GATEWAY_ROUTES` +
 * `findAyasPhoneLlmGatewayRoute`) — SmolLM2's weight file added as a SECOND
 * fixed entry, mirroring `MODEL_PROXY_ROUTES` in the Worker's own
 * `modelProxyConfig.ts`. Nothing about the chunk/Range/SAFE-ABORT mechanics
 * in this file changed — `resolvePhoneLlmNetworkFetch` still resolves to a
 * typed `ok`/`not-ok` BEFORE any network call, still never silently falls
 * back to a direct-HF URL for a gateway-scoped file, and every OTHER model's
 * behavior (the original Qwen route) is byte-for-byte unchanged.
 */

import { env } from "@huggingface/transformers";

import { getStoredAyasPhoneKey, resolveAyasWorkerUrl } from "@/components/brain/ayasPhoneFallback";
import {
  buildRemoteResourceUrl,
  getRequiredModelCacheFiles,
  type AyasPhoneLlmModelSpec,
} from "./phoneLlmModelResources";
import { findAyasPhoneLlmGatewayRoute } from "./phoneLlmGatewayConfig";
import { PROGRESS_THROTTLE_BYTES, recordPhoneLlmCheckpoint, type PhoneLlmCheckpointName } from "./phoneLlmDiagnostics";
import {
  deleteModelFile,
  getChunk,
  getIdbTransactionCount,
  getMeta,
  isIndexedDbAvailable,
  isResumePointIntact,
  putChunkAndMeta,
  putMeta,
  type PhoneLlmIdbMeta,
} from "./phoneLlmIdbStorage";
import {
  enterChunkInFlight,
  exitChunkInFlight,
  formatMemorySample,
  isFinalizationRegistrySupported,
  sampleMemoryMb,
  trackBufferFinalization,
} from "./phoneLlmMemoryProbe";
import { withTimeout } from "./phoneLlmTiming";
import type { AyasPhoneLlmLoadProgress } from "./phoneLlmRunner";

/** Each network request and each IndexedDB write handles at most this many bytes. See file header for why 8 MiB. */
export const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

export type AyasPhoneLlmPrecacheFailureReason =
  /** `indexedDB` is not available in this browser/context at all — no fallback exists (Cache Storage is retired for model weights this sprint); reported verbatim as `LOCAL_MODEL_STORAGE_UNAVAILABLE` in `detail`. */
  | "storage-unavailable"
  /** `fetch()` rejected (offline, DNS, TLS, CORS) or returned an unexpected status. */
  | "network-error"
  /** Range wasn't honored — either the very first (size-discovery) probe came back non-206 (SAFE ABORT — there is deliberately no whole-file fallback any more, see file header round 2) or a LATER chunk mid-download did. Treated as a hard error rather than silently re-interpreting a full-file body as a partial chunk, or ever buffering the whole file to work around it. */
  | "range-not-supported"
  /** `fetch()` did not return headers within the timeout — a stalled connection, or the tab was backgrounded (see `PhoneLlmLabClient.tsx`'s wake-lock wiring). */
  | "fetch-timeout"
  /** `IndexedDB.put()` rejected — e.g. `QuotaExceededError`. */
  | "storage-write-failed"
  /** An individual chunk's `IndexedDB.put()` neither resolved nor rejected within the bound. */
  | "storage-write-timeout"
  /** VERIFYING: summed bytes don't match the server-reported total, or the final chunk isn't readable back — the corrupt record is deleted so a retry starts clean. */
  | "integrity-mismatch"
  /** This (model, file) pair is gateway-scoped (has a route in `AYAS_PHONE_LLM_GATEWAY_ROUTES`, see `phoneLlmGatewayConfig.ts`) but this device hasn't got the gateway configured yet (`NEXT_PUBLIC_AYAS_WORKER_URL` unset at build time, or no `ayasPhoneKey` bootstrapped in `localStorage` on this device) — checked BEFORE any network call, so this never silently falls back to the direct HF URL already proven broken on this device class. */
  | "gateway-not-configured";

export type AyasPhoneLlmPrecacheOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AyasPhoneLlmPrecacheFailureReason; readonly file: string | null; readonly detail: string };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ROUND 8 diagnostic: everything JS can safely extract from a `fetch()`
 * rejection — `.name` (e.g. "TypeError"), `.message`, and `.cause` (a newer,
 * spec-defined error-chaining field some engines populate with more detail
 * than `.message` for a fetch failure; WebKit's own support for this on
 * `fetch()` TypeErrors is inconsistent/limited, which is itself useful to
 * confirm rather than assume). Never includes anything from the request
 * (URL, headers, Authorization value) — purely the error object's own
 * fields. `.cause` is stringified defensively (it can be anything, including
 * another Error, a DOMException, or undefined).
 */
function describeErrorDetailed(error: unknown): string {
  if (!(error instanceof Error)) return `non-Error thrown: ${String(error)}`;
  const name = error.name || "Error";
  const message = error.message;
  const causeRaw = (error as { cause?: unknown }).cause;
  const cause =
    causeRaw === undefined
      ? "none"
      : causeRaw instanceof Error
        ? `${causeRaw.name}: ${causeRaw.message}`
        : String(causeRaw);
  return `name=${name} message=${message} cause=${cause}`;
}

const FETCH_TIMEOUT_MS = 45_000;
/** One 8MB IndexedDB write. Generous ceiling for a genuinely tiny operation relative to what timed out before. */
const STORAGE_WRITE_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 20_000;

/** Parses `"bytes 0-8388607/483003582"` → `483003582`. Returns `null` if the header is absent or malformed — callers fall back to `content-length` (valid only for a non-partial 200 response). */
function parseContentRangeTotal(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const match = /\/(\d+)$/.exec(headerValue.trim());
  return match ? Number(match[1]) : null;
}

export interface ChunkFetchSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
  /**
   * `false` when `status` didn't match what THIS request expected (206 for
   * a Range request, 200 for a plain one) — the body was cancelled UNREAD
   * in that case, `bytes` is empty. This is the fix for a real, proven
   * bug: on-device evidence showed a Range request's response being read
   * in full — `chunk:reader_complete chunk=0 [483003582]`, the exact total
   * file size, for what was requested as an 8MB slice — because the
   * previous version of this function read the body unconditionally,
   * before any status check. Callers must check this before trusting
   * `bytes`.
   */
  readonly bodyConsumed: boolean;
  readonly status: number;
  readonly contentRangeHeader: string | null;
  readonly contentLengthHeader: string | null;
  readonly etagHeader: string | null;
  readonly corsOriginHeader: string | null;
}
export interface ChunkFetchFailure {
  readonly ok: false;
  readonly reason: "network-error" | "fetch-timeout";
  readonly detail: string;
}
export type ChunkFetchResult = ChunkFetchSuccess | ChunkFetchFailure;

/**
 * Fetches ONE bounded `Range` request — for EVERY chunk, including the
 * size-discovery probe (chunk 0 is not special-cased to tolerate an
 * unbounded read). `range` is REQUIRED (not optional/nullable): round 2 of
 * the process-death fix removed the whole-file (no-Range) fallback this
 * function used to also support — see this file's header for why that
 * fallback, not just an unverified read, was the real danger. There is no
 * longer any way to call this function without a `Range` header; that
 * makes the old `"no-range (whole-file fallback)"` path structurally
 * unreachable, not merely unused.
 *
 * CRITICAL FIX (process-death diagnostic, round 1): checks
 * `response.status` against what a Range request expects (206) BEFORE
 * reading any of the body. A mismatch cancels the body unread
 * (`response.body?.cancel()`) and returns `bodyConsumed: false` — the body
 * is NEVER buffered "just in case" the status doesn't match. Previously,
 * this function read the body unconditionally and only the CALLER checked
 * status afterward — by which point a wrongly-large read had already
 * happened. Real-device proof this was live, not theoretical:
 * `chunk:reader_complete chunk=0 [483003582]` (483,003,582 — the exact
 * known total file size) for a request that asked for `bytes=0-8388607`
 * (8MB). The process died immediately after that read completed — the
 * direct, foreseeable consequence of this bug, not an unexplained
 * platform memory-pressure mystery. This gate is necessary but was proven
 * NOT sufficient on its own — see round 2 in the file header for why the
 * caller's fallback choice also had to be removed, not just hardened.
 *
 * Exported so `phoneLlmDiagnosticTests.ts` can drive the exact same,
 * fully-instrumented fetch for the on-device diagnostic without
 * duplicating this logic.
 *
 * `extraHeaders` (round 3, gateway wiring): strictly additive, optional,
 * merged alongside `Range` — used ONLY to carry the gateway's
 * `Authorization: Bearer <phone key>` when `resolvePhoneLlmNetworkFetch`
 * routes the one gateway-scoped weight file's request through
 * `ayas-phone-gateway` instead of straight to HF. Every other call site
 * omits it; the Range/status-gate/SAFE-ABORT logic below is completely
 * unaware of and unaffected by which URL/headers it was given.
 */
export async function fetchOneChunk(params: {
  readonly url: string;
  readonly index: number;
  readonly range: { readonly start: number; readonly end: number };
  readonly fetchTimeoutMs: number;
  readonly modelId: string;
  readonly file: string;
  readonly extraHeaders?: Record<string, string>;
}): Promise<ChunkFetchResult> {
  const { url, index, range, fetchTimeoutMs, modelId, file, extraHeaders } = params;
  const cp = (name: PhoneLlmCheckpointName, detail?: string) =>
    recordPhoneLlmCheckpoint(name, { modelId, file, chunkIndex: index, detail: detail ?? null });

  cp("chunk:start");
  cp("chunk:fetch_start", `bytes=${range.start}-${range.end}`);

  // ROUND 6 — bounded retry for a network-LEVEL fetch() rejection (real
  // gateway-request trace pass): a real device, with a verified-correct,
  // byte-perfect, CORS-correct gateway 206 response (confirmed this pass by
  // making one real authenticated request to the deployed gateway and
  // diffing Content-Length against the actual bytes received — exact
  // match, no Content-Encoding, every CORS header correct), still reported
  // `network-error: onnx/model_q4f16.onnx: Type error` — a generic
  // WebKit/Safari `TypeError` thrown by `fetch()` ITSELF, before any
  // response is received (this function's own `env.fetch()` call, not a
  // later body-read step — `fetch()`'s returned promise settles once
  // headers arrive, well before the body loop below runs). With the
  // server-side response independently proven correct, the remaining
  // explanation is WebKit's own CORS/network-stack handling of a
  // cross-origin, Range+Authorization-bearing preflighted request — a
  // documented class of Safari flakiness (this project has already hit a
  // DIFFERENT WebKit Range quirk once before; this is the same "iOS's
  // fetch() layer, not the server, behaves inconsistently" pattern). A
  // short bounded retry is the correct, minimal, iOS-compatible way to
  // absorb a transient rejection of this shape without weakening any
  // SAFE-ABORT guarantee: retries apply ONLY to a genuine `fetch()`
  // rejection (never to a received-but-wrong-status response, which is a
  // completely separate, already-handled path below), a timeout is NEVER
  // retried (it already waited the full ceiling once), and the final,
  // exhausted failure still returns the exact same typed outcome shape as
  // before — no change to any caller's contract.
  const FETCH_RETRY_ATTEMPTS = 3;
  const FETCH_RETRY_DELAY_MS = 400;

  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      response = await withTimeout(
        env.fetch(url, { headers: { Range: `bytes=${range.start}-${range.end}`, ...extraHeaders } }),
        fetchTimeoutMs,
        `fetch chunk ${index} of "${file}"`,
      );
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      const timedOut = describeError(error).includes("timed out");
      // Never retry a timeout (already waited the full ceiling) or the
      // final attempt — safe/secret-free diagnostic only: error
      // name/message/cause (ROUND 8, `describeErrorDetailed` — a generic
      // browser string like "name=TypeError message=Type error cause=none"
      // — never anything derived from the URL's Authorization header,
      // which is never logged anywhere in this codebase).
      cp("chunk:fetch_retry", `attempt ${attempt}/${FETCH_RETRY_ATTEMPTS} ${describeErrorDetailed(error)}${timedOut || attempt === FETCH_RETRY_ATTEMPTS ? " (not retrying)" : " — retrying"}`);
      if (timedOut || attempt === FETCH_RETRY_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
    }
  }
  if (!response) {
    const timedOut = describeError(lastError).includes("timed out");
    return { ok: false, reason: timedOut ? "fetch-timeout" : "network-error", detail: describeError(lastError) };
  }

  cp("chunk:response_received");
  cp("chunk:response_status", String(response.status));
  const contentRangeHeader = response.headers.get("content-range");
  cp("chunk:content_range", contentRangeHeader ?? "absent");
  const contentLengthHeader = response.headers.get("content-length");
  const etagHeader = response.headers.get("etag");
  const corsOriginHeader = response.headers.get("access-control-allow-origin");

  if (response.status !== 206) {
    // THE FIX (round 1): never proceed to read a body whose size we
    // haven't verified matches what we actually asked for. Cancel it
    // unread so the connection is released cleanly. Round 2: the caller
    // no longer has a "deliberately re-fetch without Range" option to
    // fall back to — see `downloadFileToIdb`'s SAFE ABORT on this same
    // signal (`bodyConsumed: false`) for both the size-discovery probe
    // and any later chunk.
    cp("chunk:aborted_unexpected_status", `expected 206, got ${response.status}`);
    await response.body?.cancel().catch(() => {});
    return {
      ok: true,
      bytes: new Uint8Array(0),
      bodyConsumed: false,
      status: response.status,
      contentRangeHeader,
      contentLengthHeader,
      etagHeader,
      corsOriginHeader,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // No streaming body exposed (shouldn't happen for a real fetch()
    // Response, but defensive) — status already verified above, so this
    // read is still bounded to what was actually expected.
    cp("chunk:reader_start", "no-streaming-body-fallback");
    const buffer = await response.arrayBuffer();
    cp("chunk:reader_complete", String(buffer.byteLength));
    return { ok: true, bytes: new Uint8Array(buffer), bodyConsumed: true, status: response.status, contentRangeHeader, contentLengthHeader, etagHeader, corsOriginHeader };
  }

  cp("chunk:reader_start");
  // Guaranteed per-chunk checkpoint set (user-specified): a memory sample
  // BEFORE the read loop starts, paired with `persistChunkAndMeta`'s
  // pre-write sample after it ends — so a stale trail can show whether
  // memory was already elevated walking into this chunk's read, not only
  // walking into its write. `sampleMemoryMb`/`formatMemorySample` are
  // feature-detected (see `phoneLlmMemoryProbe.ts`) — on this iPhone
  // (`performance.memory` unsupported in iOS WebKit/JavaScriptCore) this
  // records "unsupported", which is expected and NOT evidence of failure.
  cp("chunk:memory_sample", `pre-read ${formatMemorySample(sampleMemoryMb())}`);
  const expectedLength = Number(contentLengthHeader) || range.end - range.start + 1;
  let bytes = new Uint8Array(expectedLength);
  let loaded = 0;
  let sawFirstBytes = false;
  let lastProgressAt = 0;
  // ROUND 6: a mid-stream `reader.read()` rejection (a genuinely distinct
  // failure point from the initial `env.fetch()` call above — this one was
  // previously UNCAUGHT here, contradicting `precacheModelFiles`'s own
  // documented "never throws" contract) is now converted to the SAME typed
  // outcome shape instead of propagating as an unhandled rejection. Not
  // retried (unlike the initial fetch): a stream that has already started
  // delivering bytes and then errors is not safely resumable from byte 0
  // without re-issuing the whole Range request, which the OUTER per-chunk
  // retry in `downloadFileToIdb`'s caller already does correctly on any
  // typed failure.
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!sawFirstBytes) {
        cp("chunk:first_bytes", String(value.byteLength));
        sawFirstBytes = true;
      }
      if (loaded + value.byteLength > bytes.byteLength) {
        // Defensive: content-length under-reported the real size. Grow once,
        // the same "extend, don't discard" pattern Transformers.js's own
        // readResponse() uses — still bounded to this one chunk's actual
        // size, never the whole file.
        const grown = new Uint8Array(loaded + value.byteLength);
        grown.set(bytes.subarray(0, loaded));
        bytes = grown;
      }
      bytes.set(value, loaded);
      loaded += value.byteLength;
      if (loaded - lastProgressAt >= PROGRESS_THROTTLE_BYTES) {
        cp("chunk:bytes_progress", String(loaded));
        lastProgressAt = loaded;
      }
    }
  } catch (error) {
    cp("chunk:aborted_unexpected_status", `reader.read() rejected after ${loaded} bytes: ${describeError(error)}`);
    await reader.cancel().catch(() => {});
    const timedOut = describeError(error).includes("timed out");
    return { ok: false, reason: timedOut ? "fetch-timeout" : "network-error", detail: describeError(error) };
  }
  cp("chunk:reader_complete", String(loaded));
  const finalBytes = loaded === bytes.byteLength ? bytes : bytes.slice(0, loaded);
  return { ok: true, bytes: finalBytes, bodyConsumed: true, status: response.status, contentRangeHeader, contentLengthHeader, etagHeader, corsOriginHeader };
}

/**
 * True for the ONE chunked/Range-fetched file per model — the ONNX weight
 * file — matching `getRequiredModelCacheFiles`'s own convention
 * (`onnx/model<suffix>.onnx`, the only required file ending in `.onnx`).
 * Every OTHER required file (`config.json`, `tokenizer.json`,
 * `tokenizer_config.json`) is a small metadata file, fetched via
 * `fetchWholeFile` instead — see round 4 in this file's header. Explicit,
 * deterministic routing by file identity/path — NEVER a runtime byte-size
 * check (round 4's own instruction).
 */
function isChunkedWeightFile(file: string): boolean {
  return file.endsWith(".onnx");
}

export interface WholeFileFetchSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly status: number;
  readonly etagHeader: string | null;
  readonly corsOriginHeader: string | null;
}
export interface WholeFileFetchFailure {
  readonly ok: false;
  readonly reason: "network-error" | "fetch-timeout";
  readonly detail: string;
}
export type WholeFileFetchResult = WholeFileFetchSuccess | WholeFileFetchFailure;

/** A small file's declared size is never expected to approach this — the ceiling exists purely as a defensive backstop (round 4), not a real-world limit. */
const SMALL_FILE_MAX_BYTES = CHUNK_SIZE_BYTES;

/**
 * Plain, single, un-Ranged GET for a small metadata file — NO `Range`
 * header, NO `206` requirement, a normal `200` expected. See round 4 in
 * this file's header for why this exists and why it is NOT a
 * reintroduction of the removed whole-file fallback (that term specifically
 * meant deliberately re-fetching the ~460MB weight file unranged after an
 * unexpected probe response — this is an intentional, always-used strategy
 * for files that were never large). Defensively bounded by
 * `SMALL_FILE_MAX_BYTES` regardless — a surprising oversized response for a
 * file this codebase never expects to be large still fails closed before
 * being read, never buffered.
 */
async function fetchWholeFile(params: {
  readonly url: string;
  readonly fetchTimeoutMs: number;
  readonly modelId: string;
  readonly file: string;
  readonly extraHeaders?: Record<string, string>;
}): Promise<WholeFileFetchResult> {
  const { url, fetchTimeoutMs, modelId, file, extraHeaders } = params;
  const cp = (name: PhoneLlmCheckpointName, detail?: string) =>
    recordPhoneLlmCheckpoint(name, { modelId, file, chunkIndex: 0, detail: detail ?? null });

  cp("chunk:start");
  cp("chunk:fetch_start", "no-range (small metadata file — see round 4)");

  let response: Response;
  try {
    response = await withTimeout(
      env.fetch(url, extraHeaders ? { headers: extraHeaders } : {}),
      fetchTimeoutMs,
      `fetch "${file}"`,
    );
  } catch (error) {
    const timedOut = describeError(error).includes("timed out");
    return { ok: false, reason: timedOut ? "fetch-timeout" : "network-error", detail: describeError(error) };
  }

  cp("chunk:response_received");
  cp("chunk:response_status", String(response.status));
  const etagHeader = response.headers.get("etag");
  const corsOriginHeader = response.headers.get("access-control-allow-origin");

  if (response.status !== 200) {
    cp("chunk:aborted_unexpected_status", `expected 200, got ${response.status}`);
    await response.body?.cancel().catch(() => {});
    return { ok: false, reason: "network-error", detail: `HTTP ${response.status} (expected 200)` };
  }

  const contentLengthHeader = response.headers.get("content-length");
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (declaredLength !== null && declaredLength > SMALL_FILE_MAX_BYTES) {
    // Defense in depth (round 4): this codebase never expects a "small
    // metadata file" to approach CHUNK_SIZE_BYTES — if one ever claims to,
    // fail closed before reading rather than trust it, the same discipline
    // the chunked path already applies to the weight file.
    cp("chunk:aborted_unexpected_status", `refused: declared Content-Length ${declaredLength} exceeds ${SMALL_FILE_MAX_BYTES} bytes for a small metadata file`);
    await response.body?.cancel().catch(() => {});
    return { ok: false, reason: "network-error", detail: `unexpectedly large metadata file: Content-Length ${declaredLength} > ${SMALL_FILE_MAX_BYTES}` };
  }

  cp("chunk:reader_start", "whole-file (small metadata, bounded by design)");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > SMALL_FILE_MAX_BYTES) {
    // Content-Length was absent/understated — caught here instead, still
    // before this result is ever persisted.
    cp("chunk:aborted_unexpected_status", `refused: actual body ${buffer.byteLength} bytes exceeds ${SMALL_FILE_MAX_BYTES} bytes for a small metadata file`);
    return { ok: false, reason: "network-error", detail: `unexpectedly large metadata file: ${buffer.byteLength} bytes > ${SMALL_FILE_MAX_BYTES}` };
  }
  cp("chunk:reader_complete", String(buffer.byteLength));
  return { ok: true, bytes: new Uint8Array(buffer), status: response.status, etagHeader, corsOriginHeader };
}

interface DownloadFileParams {
  readonly model: AyasPhoneLlmModelSpec;
  readonly file: string;
  readonly onProgress?: (progress: AyasPhoneLlmLoadProgress) => void;
  readonly fetchTimeoutMs: number;
  readonly storageWriteTimeoutMs: number;
  readonly verifyTimeoutMs: number;
}

type PersistOutcome = { ok: true } | { ok: false; reason: "storage-write-failed" | "storage-write-timeout"; detail: string };

/**
 * Writes `bytes` for `index` AND the file's updated `meta` record together,
 * in ONE IndexedDB transaction (`putChunkAndMeta` — see
 * `phoneLlmIdbStorage.ts`'s header for why this replaced two separate
 * transactions), with the full process-death diagnostic instrumentation
 * around the EXACT boundary real-device testing pointed at
 * (`chunk:reader_complete` already happened in the caller; this covers
 * `→ chunk:idb_write_start`): a memory sample immediately before the write,
 * another immediately after, a `FinalizationRegistry` registration for
 * `bytes` so a LATER checkpoint can confirm the engine actually reclaimed
 * this specific chunk's buffer, and the running IndexedDB transaction
 * count. Paired with `fetchOneChunk` above as the second half of one
 * chunk's lifecycle.
 */
async function persistChunkAndMeta(
  url: string,
  index: number,
  bytes: Uint8Array,
  meta: PhoneLlmIdbMeta,
  storageWriteTimeoutMs: number,
  modelId: string,
  file: string,
): Promise<PersistOutcome> {
  const cp = (name: PhoneLlmCheckpointName, detail?: string) =>
    recordPhoneLlmCheckpoint(name, { modelId, file, chunkIndex: index, detail: detail ?? null });

  cp("chunk:memory_sample", `pre-write ${formatMemorySample(sampleMemoryMb())} tx=${getIdbTransactionCount()}`);
  cp("chunk:idb_write_start", String(bytes.byteLength));
  try {
    await withTimeout(putChunkAndMeta(url, index, bytes, meta), storageWriteTimeoutMs, `putChunkAndMeta ${index} of "${file}"`);
  } catch (error) {
    const timedOut = describeError(error).includes("timed out");
    return { ok: false, reason: timedOut ? "storage-write-timeout" : "storage-write-failed", detail: describeError(error) };
  }
  cp("chunk:idb_write_complete", `tx=${getIdbTransactionCount()}`);
  cp("chunk:memory_sample", `post-write ${formatMemorySample(sampleMemoryMb())}`);

  if (isFinalizationRegistrySupported()) {
    trackBufferFinalization(bytes, index, (finalizedIndex, elapsedMs) => {
      recordPhoneLlmCheckpoint("chunk:buffer_finalized", { modelId, file, chunkIndex: finalizedIndex, detail: `${elapsedMs}ms` });
    });
  } else {
    // User-specified guaranteed per-chunk checkpoint set requires either
    // `chunk:buffer_finalized` OR `chunk:finalization_unsupported` for
    // EVERY chunk, not just chunk 0 — and unlike `chunk:bytes_progress`
    // (many ticks per chunk), this fires at most once per chunk, the same
    // cardinality as `chunk:complete`, so it can never flood the history
    // channel. Recorded per-chunk so a stale trail can show, checkpoint by
    // checkpoint, that finalization tracking was consistently unavailable
    // (as expected on this device) rather than only asserting it once.
    cp("chunk:finalization_unsupported");
  }

  cp("chunk:complete");
  return { ok: true };
}

interface NetworkFetchResolution {
  readonly ok: true;
  readonly url: string;
  readonly headers: Record<string, string>;
}
interface NetworkFetchUnresolved {
  readonly ok: false;
  readonly detail: string;
}

/**
 * Resolves the ACTUAL network `fetch()` target (+ any extra headers) for
 * `file` — deliberately SEPARATE from the STORAGE key
 * (`buildRemoteResourceUrl`'s own return value, passed in as
 * `storageKeyUrl`). The storage key is what IndexedDB (`meta.key`/chunk
 * keys) and Transformers.js's own `env.customCache.match()` use to find
 * this file later during model load — that lookup constructs the plain
 * HF-shaped URL internally and has no idea a gateway exists, so the
 * storage key MUST stay exactly what `buildRemoteResourceUrl` produces,
 * unconditionally. Only the wire-level request target can safely differ.
 *
 * ROUND 7 — HARD, FILE-TYPE-SCOPED GUARANTEE (real-device trace insisting
 * the production downloader was still observed hitting `huggingface.co`
 * directly, `Range: bytes=0-8388607`, for the weight file): the fallback
 * branch below used to be GENERIC — "no gateway route matched → use the
 * direct HF URL" — correct and intentional for the 3 small metadata files
 * (`config.json`/`tokenizer.json`/`tokenizer_config.json`, which never need
 * Range/the gateway, see round 4), but that SAME generic branch also
 * silently applied to ANY `.onnx` weight file that, for whatever reason,
 * didn't have a matching entry in `AYAS_PHONE_LLM_GATEWAY_ROUTES` — a real
 * structural gap, not just a hypothetical one: nothing stopped a future
 * model (or a route-list/model-id typo) from silently falling back to the
 * exact direct-HF Range request already proven broken on this device
 * class. Now `isChunkedWeightFile(file)` is checked EXPLICITLY: a weight
 * file with no matching gateway route is a hard, typed
 * `gateway-not-configured` failure — same as a missing key/origin — NEVER
 * a fall-through to `storageKeyUrl`. Only a small metadata file may still
 * use the direct-HF no-op path. This makes "the weight file's network
 * fetch never targets huggingface.co, under any circumstance" a structural
 * property of this function, not an emergent one.
 *
 * For every file NOT in the gateway's closed route list
 * (`findAyasPhoneLlmGatewayRoute` — see `phoneLlmGatewayConfig.ts`) that is
 * ALSO not a weight file, this is a no-op: the network URL IS the storage
 * key, same as before round 5. For a listed (model, file) pair, when the
 * gateway is configured on this device (`resolveAyasWorkerUrl()` +
 * `getStoredAyasPhoneKey()` — the SAME mechanism already used for the
 * chat-fallback route, see `ayasPhoneFallback.ts`), the network target
 * becomes the deployed `ayas-phone-gateway`'s fixed proxy route instead —
 * real-device proven (see file header round 3) to get a clean 206 where
 * direct HF gets 200 for the Qwen route, and the same reasoning (same
 * CDN/redirect pattern) applies to every other route in the list (round
 * 5). When a listed file's gateway config is MISSING, OR the file is a
 * weight file with no listed route at all (round 7), this returns `ok:
 * false` — a clear, typed failure BEFORE any network call, never a silent
 * fall-through to the direct HF URL already proven broken on this device
 * class.
 */
function resolvePhoneLlmNetworkFetch(model: AyasPhoneLlmModelSpec, file: string, storageKeyUrl: string): NetworkFetchResolution | NetworkFetchUnresolved {
  const route = findAyasPhoneLlmGatewayRoute(model.id, file);
  if (!route) {
    if (isChunkedWeightFile(file)) {
      // ROUND 7: a weight file with NO gateway route at all is a hard,
      // typed failure — never a silent direct-HF fetch. This is the ONLY
      // difference from the pre-round-7 behavior; small metadata files
      // below are completely unaffected.
      return {
        ok: false,
        detail: `AYAS Gateway'de "${model.id}" / "${file}" için tanımlı bir route yok — güvenlik gereği doğrudan Hugging Face'e düşülmüyor (route-not-configured). Bu model/dosya çifti AYAS_PHONE_LLM_GATEWAY_ROUTES listesine eklenmeden bu cihazda indirilemez.`,
      };
    }
    return { ok: true, url: storageKeyUrl, headers: {} };
  }
  const gatewayOrigin = resolveAyasWorkerUrl();
  const phoneKey = getStoredAyasPhoneKey();
  if (!gatewayOrigin || !phoneKey) {
    return {
      ok: false,
      detail:
        "AYAS Gateway bu cihazda yapılandırılmamış (NEXT_PUBLIC_AYAS_WORKER_URL veya bootstrap edilmiş ayasPhoneKey eksik) — doğrudan Hugging Face isteği bu cihazda Range'i onurlandırmıyor (bkz. Range Teşhisi). Önce /brain?ayasPhoneKey=<key> ile bir kez açın.",
    };
  }
  return { ok: true, url: `${gatewayOrigin}${route.proxyPath}`, headers: { Authorization: `Bearer ${phoneKey}` } };
}

async function downloadFileToIdb(params: DownloadFileParams): Promise<AyasPhoneLlmPrecacheOutcome> {
  const { model, file, onProgress, fetchTimeoutMs, storageWriteTimeoutMs, verifyTimeoutMs } = params;
  const storageKeyUrl = buildRemoteResourceUrl(model, file);

  const networkTarget = resolvePhoneLlmNetworkFetch(model, file, storageKeyUrl);
  if (!networkTarget.ok) {
    return { ok: false, reason: "gateway-not-configured", file, detail: networkTarget.detail };
  }
  const networkUrl = networkTarget.url;
  const networkHeaders = networkTarget.headers;

  // TEMPORARY diagnostic (gateway-routing trace pass, ROUND 8 widened per
  // an explicit real-device field list) — see `phoneLlmDiagnostics.ts`'s
  // `"chunk:network_target"` doc comment. Fired once per file, BEFORE any
  // fetch. `networkHeaders` (which carries the gateway's `Authorization:
  // Bearer <phoneKey>` when present) is NEVER included as a VALUE — only a
  // boolean for whether it's set. `origin`/`pathname` are parsed from
  // `networkUrl` so a real-device trail shows EXACTLY which host the
  // request targeted without needing to reconstruct it from the full URL
  // string by hand. `usingNativeFetch` records whether `env.fetch` is
  // still identically `globalThis.fetch` (confirmed true by reading
  // `@huggingface/transformers`'s own `env.js` — `DEFAULT_FETCH =
  // globalThis.fetch.bind(globalThis)` — but logged live too, in case
  // something in this app's own module graph ever rebinds `env.fetch` to
  // something else without this file's knowledge).
  let parsedOrigin = "unparseable";
  let parsedPathname = "unparseable";
  try {
    const parsed = new URL(networkUrl);
    parsedOrigin = parsed.origin;
    parsedPathname = parsed.pathname;
  } catch {
    /* leave as "unparseable" — never throw from a diagnostic */
  }
  const usingNativeFetch = typeof globalThis !== "undefined" && env.fetch === globalThis.fetch;
  recordPhoneLlmCheckpoint("chunk:network_target", {
    modelId: model.id,
    file,
    detail: [
      `origin=${parsedOrigin}`,
      `pathname=${parsedPathname}`,
      `method=GET`,
      `route=${findAyasPhoneLlmGatewayRoute(model.id, file)?.proxyPath ?? "direct-hf (no gateway route matched)"}`,
      `hasAuthHeader=${Object.prototype.hasOwnProperty.call(networkHeaders, "Authorization")}`,
      `usingNativeFetch=${usingNativeFetch}`,
      `fullUrl=${networkUrl}`,
    ].join(" "),
  });

  // ---- CHECK_STORAGE ----
  let meta = await getMeta(storageKeyUrl).catch(() => undefined);
  if (meta?.complete) {
    console.info(`[ayas phone-llm] idb: "${file}" already complete, skipping network`);
    onProgress?.({ status: "done", file, percent: 100, loadedBytes: meta.totalBytes, totalBytes: meta.totalBytes });
    return { ok: true };
  }
  if (meta && meta.downloadedChunkCount > 0) {
    const intact = await isResumePointIntact(meta).catch(() => false);
    if (!intact) {
      console.warn(`[ayas phone-llm] idb: "${file}" resume point failed integrity check — restarting this file from scratch`);
      await deleteModelFile(storageKeyUrl, meta.chunkCount);
      meta = undefined;
    }
  }

  onProgress?.({ status: "initiate", file, percent: null, loadedBytes: null, totalBytes: meta?.totalBytes ?? null });
  recordPhoneLlmCheckpoint("download:start", { modelId: model.id, file });

  let totalBytes = meta?.totalBytes ?? null;
  let chunkCount = meta?.chunkCount ?? null;
  let startIndex = meta?.downloadedChunkCount ?? 0;
  let downloadedBytes = meta?.downloadedBytes ?? 0;
  let etag = meta?.etag ?? null;

  // Learn the file's real size from chunk 0's own response headers — no
  // separate HEAD request needed. Round 4: which of the two fetch
  // strategies below applies is decided ONCE, deterministically, by file
  // identity (`isChunkedWeightFile`) — never by a runtime byte-size check.
  if (totalBytes === null || chunkCount === null) {
    const inFlight = enterChunkInFlight();
    if (inFlight > 1) {
      recordPhoneLlmCheckpoint("chunk:concurrency_violation", { modelId: model.id, file, chunkIndex: 0, detail: `inFlight=${inFlight}` });
      console.error(`[ayas phone-llm] CONCURRENCY VIOLATION: ${inFlight} chunks in flight for "${file}"`);
    }
    try {
      if (isChunkedWeightFile(file)) {
        // ---- THE ONNX WEIGHT FILE — chunked Range fetch, UNCHANGED from round 3 ----
        const probe: ChunkFetchResult = await fetchOneChunk({ url: networkUrl, index: 0, range: { start: 0, end: CHUNK_SIZE_BYTES - 1 }, fetchTimeoutMs, modelId: model.id, file, extraHeaders: networkHeaders });
        if (!probe.ok) return { ok: false, reason: probe.reason, file, detail: probe.detail };

        if (!probe.bodyConsumed) {
          // `fetchOneChunk`'s status gate already refused to read this
          // probe's body — nothing was buffered. Two distinct causes get two
          // distinct, typed outcomes (mirroring the pre-existing mid-download
          // branch further down):
          //  - status 200, Content-Range absent: the EXACT real-device
          //    signature (`aborted_unexpected_status [expected 206, got
          //    200]`) — Range genuinely not honored for this request. SAFE
          //    ABORT (round 2 of the process-death fix — see file header):
          //    there is deliberately NO whole-file fallback any more.
          //    Real-device evidence proved that path re-fetches the same URL
          //    without Range and reads the ENTIRE response into one
          //    `Uint8Array` — exactly the `chunk:reader_complete chunk=0
          //    [483003582]` process death this sprint exists to eliminate,
          //    on a device where this wasn't even a rare edge case (every
          //    probe for this URL got 200). Fail loudly and typed instead,
          //    the same way a LATER chunk losing Range support mid-download
          //    already does (see the main loop below) — a retry starts
          //    clean, and no production code path ever buffers more than one
          //    chunk.
          //  - anything else (404, 500, ...): a genuine server/network
          //    error, not a Range-support problem — stays classified as
          //    `network-error` so the UI's message stays accurate.
          if (probe.status === 200) {
            console.error(`[ayas phone-llm] idb: "${file}" — chunk 0 probe: server returned 200 instead of 206 Partial Content; Range not honored, refusing unbounded whole-file read`);
            recordPhoneLlmCheckpoint("download:end", { modelId: model.id, file, detail: "range_not_supported_abort" });
            return {
              ok: false,
              reason: "range-not-supported",
              file,
              detail: "chunk 0 probe: server returned HTTP 200 instead of 206 Partial Content — Range not honored, refusing to buffer the whole file",
            };
          }
          return { ok: false, reason: "network-error", file, detail: `HTTP ${probe.status} (expected 206 Partial Content)` };
        }
        totalBytes = parseContentRangeTotal(probe.contentRangeHeader) ?? (Number(probe.contentLengthHeader) || null);
        if (!totalBytes) {
          return { ok: false, reason: "network-error", file, detail: "could not determine total file size from Content-Range/Content-Length" };
        }
        chunkCount = Math.ceil(totalBytes / CHUNK_SIZE_BYTES);
        etag = probe.etagHeader;
        downloadedBytes = probe.bytes.byteLength;

        meta = {
          key: storageKeyUrl,
          modelId: model.id,
          file,
          totalBytes,
          chunkSize: CHUNK_SIZE_BYTES,
          chunkCount,
          downloadedBytes,
          downloadedChunkCount: 1,
          etag,
          complete: false,
          updatedAt: Date.now(),
        };
        const persisted = await persistChunkAndMeta(storageKeyUrl, 0, probe.bytes, meta, storageWriteTimeoutMs, model.id, file);
        if (!persisted.ok) return { ok: false, reason: persisted.reason, file, detail: persisted.detail };
        startIndex = 1;
        onProgress?.({ status: "progress", file, percent: (downloadedBytes / totalBytes) * 100, loadedBytes: downloadedBytes, totalBytes });
      } else {
        // ---- SMALL METADATA FILE — plain whole-file fetch, NEW in round 4 ----
        // No Range header, no 206 requirement — see file header round 4 for
        // why this is correct (and not a reintroduction of the removed
        // whole-file fallback, which only ever applied to the weight file).
        const whole = await fetchWholeFile({ url: networkUrl, fetchTimeoutMs, modelId: model.id, file, extraHeaders: networkHeaders });
        if (!whole.ok) return { ok: false, reason: whole.reason, file, detail: whole.detail };

        totalBytes = whole.bytes.byteLength;
        chunkCount = 1;
        etag = whole.etagHeader;
        downloadedBytes = whole.bytes.byteLength;

        meta = {
          key: storageKeyUrl,
          modelId: model.id,
          file,
          totalBytes,
          chunkSize: CHUNK_SIZE_BYTES,
          chunkCount,
          downloadedBytes,
          downloadedChunkCount: 1,
          etag,
          complete: false,
          updatedAt: Date.now(),
        };
        // SAME persist path as the chunked file — a whole-file fetch is
        // stored as exactly one chunk, identical to what a small file
        // already produced whenever Range happened to be honored for it.
        const persisted = await persistChunkAndMeta(storageKeyUrl, 0, whole.bytes, meta, storageWriteTimeoutMs, model.id, file);
        if (!persisted.ok) return { ok: false, reason: persisted.reason, file, detail: persisted.detail };
        startIndex = 1;
        onProgress?.({ status: "progress", file, percent: 100, loadedBytes: downloadedBytes, totalBytes });
      }
    } finally {
      exitChunkInFlight();
    }
  }

  for (let index = startIndex; index < chunkCount; index += 1) {
    const inFlight = enterChunkInFlight();
    if (inFlight > 1) {
      recordPhoneLlmCheckpoint("chunk:concurrency_violation", { modelId: model.id, file, chunkIndex: index, detail: `inFlight=${inFlight}` });
      console.error(`[ayas phone-llm] CONCURRENCY VIOLATION: ${inFlight} chunks in flight for "${file}"`);
    }
    try {
      const start = index * CHUNK_SIZE_BYTES;
      const end = Math.min(start + CHUNK_SIZE_BYTES, totalBytes) - 1;
      const result = await fetchOneChunk({ url: networkUrl, index, range: { start, end }, fetchTimeoutMs, modelId: model.id, file, extraHeaders: networkHeaders });
      if (!result.ok) return { ok: false, reason: result.reason, file, detail: result.detail };
      if (!result.bodyConsumed) {
        // `fetchOneChunk` already refused to read a body that didn't match
        // the expected 206 — no huge/wrong-sized read happened. Chunk 0
        // got a real 206 (we wouldn't be in this loop otherwise), but this
        // LATER one didn't — inconsistent server behavior mid-download.
        // Failing loudly rather than guessing how to interpret it means a
        // retry starts clean.
        return { ok: false, reason: "range-not-supported", file, detail: `chunk ${index}: server returned ${result.status} instead of 206 mid-download` };
      }

      downloadedBytes += result.bytes.byteLength;
      meta = { ...meta, downloadedBytes, downloadedChunkCount: index + 1, updatedAt: Date.now() } as PhoneLlmIdbMeta;
      const persisted = await persistChunkAndMeta(storageKeyUrl, index, result.bytes, meta, storageWriteTimeoutMs, model.id, file);
      if (!persisted.ok) return { ok: false, reason: persisted.reason, file, detail: persisted.detail };
      onProgress?.({ status: "progress", file, percent: (downloadedBytes / totalBytes) * 100, loadedBytes: downloadedBytes, totalBytes });
    } finally {
      exitChunkInFlight();
    }
  }

  recordPhoneLlmCheckpoint("download:end", { modelId: model.id, file });

  // ---- VERIFYING ----
  onProgress?.({ status: "verifying", file, percent: null, loadedBytes: downloadedBytes, totalBytes });
  recordPhoneLlmCheckpoint("verify:start", { modelId: model.id, file });
  let verifyOk: boolean;
  try {
    verifyOk = await withTimeout(
      (async () => {
        if (downloadedBytes !== totalBytes) return false;
        const lastChunk = await getChunk(storageKeyUrl, chunkCount! - 1);
        return lastChunk !== undefined;
      })(),
      verifyTimeoutMs,
      `verify "${file}"`,
    );
  } catch (error) {
    return { ok: false, reason: "integrity-mismatch", file, detail: `verify timed out: ${describeError(error)}` };
  }
  if (!verifyOk) {
    await deleteModelFile(storageKeyUrl, chunkCount ?? 0);
    return {
      ok: false,
      reason: "integrity-mismatch",
      file,
      detail: `expected ${totalBytes} bytes, got ${downloadedBytes} — corrupt record deleted, retry will re-download`,
    };
  }
  recordPhoneLlmCheckpoint("verify:end", { modelId: model.id, file });

  await putMeta({ ...(meta as PhoneLlmIdbMeta), complete: true, updatedAt: Date.now() });
  console.info(`[ayas phone-llm] idb: "${file}" verified and marked complete (${downloadedBytes} bytes, ${chunkCount} chunks)`);
  onProgress?.({ status: "done", file, percent: 100, loadedBytes: downloadedBytes, totalBytes });
  return { ok: true };
}

/**
 * Downloads and durably persists every file `model` needs into IndexedDB,
 * chunked (never a full-file JS buffer, never a single giant storage
 * write). Resumable per file, per chunk. Never throws — every failure
 * resolves to a typed outcome. See file header for the full design
 * rationale, the real-device evidence it responds to, and this pass's
 * memory/copy audit.
 *
 * Hard failure (`storage-unavailable`, detail `LOCAL_MODEL_STORAGE_UNAVAILABLE`)
 * when IndexedDB itself isn't available — there is deliberately NO
 * fallback to Cache Storage this sprint.
 */
export async function precacheModelFiles(
  model: AyasPhoneLlmModelSpec,
  onProgress?: (progress: AyasPhoneLlmLoadProgress) => void,
  timeouts: { fetchTimeoutMs?: number; storageWriteTimeoutMs?: number; verifyTimeoutMs?: number } = {},
): Promise<AyasPhoneLlmPrecacheOutcome> {
  if (!isIndexedDbAvailable()) {
    return {
      ok: false,
      reason: "storage-unavailable",
      file: null,
      detail: "LOCAL_MODEL_STORAGE_UNAVAILABLE: indexedDB is not available in this browser/context",
    };
  }

  const fetchTimeoutMs = timeouts.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;
  const storageWriteTimeoutMs = timeouts.storageWriteTimeoutMs ?? STORAGE_WRITE_TIMEOUT_MS;
  const verifyTimeoutMs = timeouts.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;

  for (const file of getRequiredModelCacheFiles(model)) {
    const outcome = await downloadFileToIdb({ model, file, onProgress, fetchTimeoutMs, storageWriteTimeoutMs, verifyTimeoutMs });
    if (!outcome.ok) return outcome;
  }
  return { ok: true };
}
