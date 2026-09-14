/**
 * AYAS phone-local LLM — standalone diagnostic tests (Cache Storage
 * blocker closure sprint: process-death diagnostic pass, items 5 and 7).
 *
 * Two tests, each isolated from the real download/persistence flow (both
 * write under a `::diagnostic-*` key suffix, never the real model's own
 * storage key, so running them can never corrupt or interfere with an
 * actual in-progress or completed download):
 *
 *  1. `runSingleChunkNetworkDiagnostic` — exercises the REAL network
 *     (`fetchOneChunk` from `phoneLlmPrecacheDownloader.ts`, the exact
 *     function the real downloader uses — not a re-implementation) against
 *     ONLY the first 8MB chunk of the actual weight file, then writes it to
 *     IndexedDB, reads it back, forces a fresh `indexedDB` connection
 *     (`reopenPhoneLlmDbForDiagnostics` — a real proxy for "does this
 *     survive a page reload"), reads it back again, then cleans up. This
 *     is what lets an operator prove, on the real device, in the UI
 *     (no devtools needed):
 *       8 MB Range GET → 206 + real headers → 8 MB IndexedDB write →
 *       verify → simulated reload → retrieve
 *     without first committing to the full ~460MB download (spec item 5).
 *     `curl` can prove the SERVER honors Range; it cannot prove a real
 *     Chrome-iOS `fetch()` (with its own CORS preflight handling) gets the
 *     same result — this closes exactly that gap (spec item 6).
 *
 *  2. `runIdbOnlyDiagnostic` — NO network at all: a synthetic 8MB
 *     `Uint8Array` → `IndexedDB.put()` → `.get()` → byte-length AND
 *     byte-content verification → `.delete()` → confirm gone. Isolates
 *     "is IndexedDB itself reliable on this device for an 8MB value" from
 *     "is the network/Range chain reliable" (spec item 7/9) — if the
 *     real download dies and this diagnostic ALSO fails, the fault is in
 *     IndexedDB, not networking; if this passes but the real download
 *     still dies, IndexedDB is exonerated.
 *
 * Neither test is wired into the production download path — both are
 * operator-triggered only (buttons in `PhoneLlmLabClient.tsx`'s "Tanı
 * Araçları" section), matching spec item 5's "bir üretim özelliği olarak
 * kalmak zorunda değil; diagnostic/test flag olabilir".
 */

import {
  buildRemoteResourceUrl,
  getRequiredModelCacheFiles,
  type AyasPhoneLlmModelSpec,
} from "./phoneLlmModelResources";
import { CHUNK_SIZE_BYTES, fetchOneChunk } from "./phoneLlmPrecacheDownloader";
import {
  deleteChunk,
  getChunk,
  isIndexedDbAvailable,
  putChunk,
  reopenPhoneLlmDbForDiagnostics,
} from "./phoneLlmIdbStorage";

export interface DiagnosticStep {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SingleChunkNetworkDiagnosticResult {
  readonly ok: boolean;
  readonly steps: readonly DiagnosticStep[];
  readonly httpStatus: number | null;
  readonly contentRangeHeader: string | null;
  readonly contentLengthHeader: string | null;
  readonly corsOriginHeader: string | null;
  readonly etagHeader: string | null;
  readonly bytesWritten: number | null;
  readonly bytesReadBackBeforeReload: number | null;
  readonly bytesReadBackAfterReload: number | null;
  readonly totalMs: number;
}

const DIAGNOSTIC_KEY_SUFFIX = "::diagnostic-single-chunk";

/** Fetches ONLY the weight file's first 8MB chunk (real network) and round-trips it through IndexedDB, including a simulated reload — see file header. Never touches the real model's own storage key. */
export async function runSingleChunkNetworkDiagnostic(model: AyasPhoneLlmModelSpec): Promise<SingleChunkNetworkDiagnosticResult> {
  const startedAt = performance.now();
  const steps: DiagnosticStep[] = [];
  const step = (name: string, ok: boolean, detail: string) => steps.push({ name, ok, detail });

  const files = getRequiredModelCacheFiles(model);
  const weightFile = files.find((f) => f.endsWith(".onnx")) ?? files[files.length - 1];
  const realUrl = buildRemoteResourceUrl(model, weightFile);
  const diagnosticKey = `${realUrl}${DIAGNOSTIC_KEY_SUFFIX}`;

  const empty: SingleChunkNetworkDiagnosticResult = {
    ok: false,
    steps,
    httpStatus: null,
    contentRangeHeader: null,
    contentLengthHeader: null,
    corsOriginHeader: null,
    etagHeader: null,
    bytesWritten: null,
    bytesReadBackBeforeReload: null,
    bytesReadBackAfterReload: null,
    totalMs: 0,
  };

  await deleteChunk(diagnosticKey, 0).catch(() => {}); // clean slate from any prior diagnostic run

  const result = await fetchOneChunk({
    url: realUrl,
    index: 0,
    range: { start: 0, end: CHUNK_SIZE_BYTES - 1 },
    fetchTimeoutMs: 45_000,
    modelId: model.id,
    file: `${weightFile} (diagnostic)`,
  });

  if (!result.ok) {
    step("network_fetch", false, `${result.reason}: ${result.detail}`);
    return { ...empty, totalMs: performance.now() - startedAt };
  }
  step("network_fetch", true, `HTTP ${result.status}`);
  // Explicit, unambiguous split (real-device follow-up asked for this):
  // Range request → 206 → normal chunk (body read, written to IndexedDB
  // below) vs. Range request → 200 (or anything else) → SAFE ABORT (body
  // was never read — `fetchOneChunk` cancelled it unread; see
  // `bodyConsumed` below). Both are legitimate, typed outcomes of this
  // diagnostic — a SAFE ABORT here is exactly what the real production
  // downloader now does too, not a diagnostic-only special case.
  step(
    "range_honored",
    result.status === 206,
    result.status === 206
      ? "status=206 → normal chunk (Range honored, body read)"
      : `status=${result.status} → SAFE ABORT (Range NOT honored, body never read — see idb_write below)`,
  );
  step("cors_header_present", result.corsOriginHeader !== null, `Access-Control-Allow-Origin: ${result.corsOriginHeader ?? "(absent)"}`);
  step(
    "content_range_present",
    result.contentRangeHeader !== null,
    `Content-Range: ${result.contentRangeHeader ?? "(absent)"}`,
  );

  if (!result.bodyConsumed) {
    // `fetchOneChunk` deliberately did NOT read the body — status didn't
    // match what a Range request expects (206). Exactly the condition
    // proven on-device to matter: report it as a clear, distinct SAFE
    // ABORT rather than proceeding to write 0 bytes and calling it a pass.
    step("idb_write", false, "skipped — SAFE ABORT: response body was not a partial-content read, nothing was buffered or written (see range_honored above)");
    return {
      ...empty,
      httpStatus: result.status,
      contentRangeHeader: result.contentRangeHeader,
      contentLengthHeader: result.contentLengthHeader,
      corsOriginHeader: result.corsOriginHeader,
      etagHeader: result.etagHeader,
      totalMs: performance.now() - startedAt,
    };
  }

  try {
    await putChunk(diagnosticKey, 0, result.bytes);
    step("idb_write", true, `${result.bytes.byteLength} bytes`);
  } catch (error) {
    step("idb_write", false, describeError(error));
    return {
      ...empty,
      httpStatus: result.status,
      contentRangeHeader: result.contentRangeHeader,
      contentLengthHeader: result.contentLengthHeader,
      corsOriginHeader: result.corsOriginHeader,
      etagHeader: result.etagHeader,
      totalMs: performance.now() - startedAt,
    };
  }

  const readBackBefore = await getChunk(diagnosticKey, 0).catch(() => undefined);
  step(
    "idb_readback_before_reload",
    readBackBefore?.byteLength === result.bytes.byteLength,
    `${readBackBefore?.byteLength ?? "missing"} bytes (expected ${result.bytes.byteLength})`,
  );

  await reopenPhoneLlmDbForDiagnostics();

  const readBackAfter = await getChunk(diagnosticKey, 0).catch(() => undefined);
  step(
    "idb_readback_after_simulated_reload",
    readBackAfter?.byteLength === result.bytes.byteLength,
    `${readBackAfter?.byteLength ?? "missing"} bytes (expected ${result.bytes.byteLength})`,
  );

  await deleteChunk(diagnosticKey, 0).catch(() => {});
  const afterDelete = await getChunk(diagnosticKey, 0).catch(() => "error");
  step("cleanup", afterDelete === undefined, afterDelete === undefined ? "diagnostic record deleted" : "cleanup left a trace");

  return {
    ok: steps.every((s) => s.ok),
    steps,
    httpStatus: result.status,
    contentRangeHeader: result.contentRangeHeader,
    contentLengthHeader: result.contentLengthHeader,
    corsOriginHeader: result.corsOriginHeader,
    etagHeader: result.etagHeader,
    bytesWritten: result.bytes.byteLength,
    bytesReadBackBeforeReload: readBackBefore?.byteLength ?? null,
    bytesReadBackAfterReload: readBackAfter?.byteLength ?? null,
    totalMs: performance.now() - startedAt,
  };
}

export interface IdbOnlyDiagnosticResult {
  readonly ok: boolean;
  readonly steps: readonly DiagnosticStep[];
  readonly totalMs: number;
}

const IDB_ONLY_DIAGNOSTIC_KEY = "ayas-phone-llm-diagnostic::idb-only";

/** Pure IndexedDB round-trip, zero network — see file header for why this is kept separate from the network diagnostic. */
export async function runIdbOnlyDiagnostic(): Promise<IdbOnlyDiagnosticResult> {
  const startedAt = performance.now();
  const steps: DiagnosticStep[] = [];
  const step = (name: string, ok: boolean, detail: string) => steps.push({ name, ok, detail });

  if (!isIndexedDbAvailable()) {
    step("indexeddb_available", false, "indexedDB is not available in this browser/context");
    return { ok: false, steps, totalMs: performance.now() - startedAt };
  }
  step("indexeddb_available", true, "");

  const synthetic = new Uint8Array(CHUNK_SIZE_BYTES);
  for (let i = 0; i < synthetic.length; i += 1) synthetic[i] = i % 256;

  try {
    await putChunk(IDB_ONLY_DIAGNOSTIC_KEY, 0, synthetic);
    step("put", true, `${synthetic.byteLength} bytes`);
  } catch (error) {
    step("put", false, describeError(error));
    return { ok: false, steps, totalMs: performance.now() - startedAt };
  }

  const readBack = await getChunk(IDB_ONLY_DIAGNOSTIC_KEY, 0).catch(() => undefined);
  const lengthOk = readBack?.byteLength === synthetic.byteLength;
  step("get_length", lengthOk, `${readBack?.byteLength ?? "missing"} bytes (expected ${synthetic.byteLength})`);

  let contentOk = false;
  if (readBack) {
    contentOk = lengthOk;
    for (let i = 0; contentOk && i < readBack.length; i += 1) {
      if (readBack[i] !== synthetic[i]) contentOk = false;
    }
  }
  step("get_content", contentOk, contentOk ? "byte-for-byte match" : "content mismatch or missing");

  await deleteChunk(IDB_ONLY_DIAGNOSTIC_KEY, 0).catch(() => {});
  const afterDelete = await getChunk(IDB_ONLY_DIAGNOSTIC_KEY, 0).catch(() => "error");
  step("delete_confirmed", afterDelete === undefined, afterDelete === undefined ? "confirmed gone" : "still present after delete");

  return { ok: steps.every((s) => s.ok), steps, totalMs: performance.now() - startedAt };
}
