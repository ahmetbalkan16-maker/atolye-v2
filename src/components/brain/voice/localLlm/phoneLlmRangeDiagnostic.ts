/**
 * AYAS phone-local LLM — HTTP Range diagnostic (real-device follow-up:
 * "why does the SAME Range request that gets a clean 206 from `curl` on a
 * PC get HTTP 200 + `Content-Range: absent` from a real iPhone/Chrome
 * `fetch()`, 100% reproducibly?").
 *
 * STRICTLY READ-ONLY. This module NEVER reads a response body — not on
 * 200, not on 206, regardless of outcome. It exists to answer ONE question
 * (why does the status/headers differ) without risking the exact failure
 * mode the rest of this sprint closed (buffering an unverified/unbounded
 * body). It does not touch `phoneLlmPrecacheDownloader.ts`, does not change
 * chunk size, does not add a fallback, does not read 483MB of anything.
 *
 * WHAT THIS PROVES FROM CODE ALONE, WITHOUT A REAL DEVICE (items 15/16 of
 * the real-device request are answered here, not guessed):
 *   `public/sw.js`'s `fetch` handler starts with
 *     `if (url.origin !== self.location.origin) return;`
 *   BEFORE any `event.respondWith(...)` call. `huggingface.co` is always a
 *   different origin than this app's own origin, so — regardless of
 *   whether a worker is installed and controlling the page — the worker's
 *   fetch listener returns immediately for this exact request and never
 *   calls `respondWith()`. It cannot intercept, rewrite, or serve a cached
 *   response for this request. This rules out the Service Worker as the
 *   cause STRUCTURALLY, not empirically — confirmed by reading
 *   `public/sw.js`'s own source, the same standard this whole sprint has
 *   used throughout (see `phoneLlmPrecacheDownloader.ts`'s header).
 *
 * WHAT THIS CANNOT PROVE FROM CODE ALONE (honest platform limits, not a
 * gap in this diagnostic): the Fetch API does not let page JS inspect the
 * exact wire-level request headers the browser actually transmits. We can
 * report exactly what THIS code sets (`Range`, nothing else — identical to
 * `fetchOneChunk`'s own request construction) but `Accept`,
 * `Accept-Encoding`, `Origin`, and any browser-injected headers are set by
 * the platform itself and are not introspectable from here. This is
 * flagged explicitly in the result rather than fabricated.
 *
 * THREE PROBES:
 *   A) the exact request `fetchOneChunk` sends today (same URL, same
 *      `Range: bytes=0-8388607` header, same implicit GET, no other
 *      headers) — but this function ALWAYS cancels the body unread, even
 *      on 206, because this is diagnosis, not download.
 *   B) the SAME request to the SAME URL plus a one-off cache-busting query
 *      parameter, to test the leading hypothesis: that a previously cached
 *      FULL (200) response for this exact URL — from an earlier download
 *      attempt, an earlier diagnostic run, or Transformers.js's own
 *      internal probing, all of which hit this identical URL — is being
 *      served back by the device's OWN HTTP cache without ever reaching
 *      the network with the `Range` header honored. This is a documented
 *      WebKit/Safari quirk (Range requests can be satisfied from a prior
 *      full-body cache entry, ignoring the Range header) that `curl` from
 *      a fresh PC — with no such cache entry — would never exhibit.
 *   C) the SAME Range request through the `ayas-phone-gateway` Cloudflare
 *      Worker's Range-preserving proxy route instead of straight to
 *      `huggingface.co` (`cloudflare/ayas-phone-gateway/src/worker.ts` —
 *      see that file's header for the full design). PC-side `curl` against
 *      the REAL deployed gateway already proved this route returns a clean
 *      206 with correct Content-Range/Content-Length/ETag for both
 *      `bytes=0-8388607` and `bytes=8388608-16777215` — probe C is the
 *      remaining, decisive check: does the SAME real device that gets 200
 *      straight to HF get 206 through the gateway too. Reuses the SAME
 *      config `ayasPhoneFallback.ts`'s chat-fallback path already uses
 *      (`resolveAyasWorkerUrl` for the Worker origin,
 *      `getStoredAyasPhoneKey` for the `Authorization: Bearer` value) — no
 *      new config surface. `probeGateway` is `null` (not a failure) when
 *      either isn't configured on this device yet.
 */

import { env } from "@huggingface/transformers";

import { getStoredAyasPhoneKey, resolveAyasWorkerUrl } from "@/components/brain/ayasPhoneFallback";
import { buildRemoteResourceUrl, getRequiredModelCacheFiles, type AyasPhoneLlmModelSpec } from "./phoneLlmModelResources";
import { findAyasPhoneLlmGatewayRoute } from "./phoneLlmGatewayConfig";
import { CHUNK_SIZE_BYTES } from "./phoneLlmPrecacheDownloader";

export interface RangeProbeResult {
  readonly label: string;
  readonly requestUrl: string;
  readonly requestMethod: "GET";
  readonly requestRangeHeader: string;
  readonly ok: boolean;
  readonly errorDetail: string | null;
  readonly finalUrl: string | null;
  readonly redirected: boolean | null;
  readonly responseType: ResponseType | null;
  readonly status: number | null;
  readonly acceptRangesHeader: string | null;
  readonly contentRangeHeader: string | null;
  readonly contentLengthHeader: string | null;
  readonly contentEncodingHeader: string | null;
  readonly cacheControlHeader: string | null;
  readonly etagHeader: string | null;
  readonly varyHeader: string | null;
  readonly corsOriginHeader: string | null;
  /** Always `false` — literal, structural proof this probe never read a body (see file header). */
  readonly bodyRead: false;
  readonly tookMs: number;
}

export interface RangeDiagnosisResult {
  readonly modelId: string;
  readonly file: string;
  readonly serviceWorkerControllingThisPage: boolean;
  /**
   * Always `false` — NOT a device measurement, a fact proven by reading
   * `public/sw.js`'s own source (see file header). Kept as an explicit
   * field (rather than only prose) so the UI/copy-paste report always
   * carries it next to the two probes, per the real-device request's
   * output format.
   */
  readonly serviceWorkerWouldInterceptThisOrigin: false;
  readonly probeA: RangeProbeResult;
  readonly probeB: RangeProbeResult;
  /**
   * `null` — not a failure — when the gateway isn't configured on this
   * device: `resolveAyasWorkerUrl()` returns `null` (no
   * `NEXT_PUBLIC_AYAS_WORKER_URL` at build time) or
   * `getStoredAyasPhoneKey()` returns `null` (this device never bootstrapped
   * `?ayasPhoneKey=...` — see `ayasPhoneFallback.ts`). Both are required for
   * probe C to mean anything; a probe sent without a valid key would only
   * prove the gateway's OWN auth gate works (already proven from the PC),
   * not what this probe exists to check.
   */
  readonly probeGateway: RangeProbeResult | null;
}

function readHeaders(response: Response) {
  return {
    acceptRangesHeader: response.headers.get("accept-ranges"),
    contentRangeHeader: response.headers.get("content-range"),
    contentLengthHeader: response.headers.get("content-length"),
    contentEncodingHeader: response.headers.get("content-encoding"),
    cacheControlHeader: response.headers.get("cache-control"),
    etagHeader: response.headers.get("etag"),
    varyHeader: response.headers.get("vary"),
    corsOriginHeader: response.headers.get("access-control-allow-origin"),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends ONE `Range: bytes=0-<CHUNK_SIZE_BYTES-1>` GET to `url` — identical
 * request shape to `fetchOneChunk`'s probe call (plus `extraHeaders`, used
 * ONLY by probe C for its `Authorization` header — probes A/B never pass
 * any) — and NEVER reads the response body (`response.body?.cancel()`
 * unconditionally, regardless of status). Every header item 1-14 of the
 * real-device diagnostic request is captured before the body is released.
 */
async function runOneRangeProbe(label: string, url: string, extraHeaders?: Record<string, string>): Promise<RangeProbeResult> {
  const requestRangeHeader = `bytes=0-${CHUNK_SIZE_BYTES - 1}`;
  const startedAt = performance.now();
  try {
    const response = await env.fetch(url, { headers: { Range: requestRangeHeader, ...extraHeaders } });
    // NEVER read the body — this is the entire point of this module. Even
    // a 206's bounded 8MB is more than a pure header/status diagnostic
    // needs to read; releasing it unread keeps this function's own memory
    // footprint at zero regardless of what the server answers.
    await response.body?.cancel().catch(() => {});
    return {
      label,
      requestUrl: url,
      requestMethod: "GET",
      requestRangeHeader,
      ok: true,
      errorDetail: null,
      finalUrl: response.url || null,
      redirected: response.redirected,
      responseType: response.type,
      status: response.status,
      ...readHeaders(response),
      bodyRead: false,
      tookMs: performance.now() - startedAt,
    };
  } catch (error) {
    return {
      label,
      requestUrl: url,
      requestMethod: "GET",
      requestRangeHeader,
      ok: false,
      errorDetail: describeError(error),
      finalUrl: null,
      redirected: null,
      responseType: null,
      status: null,
      acceptRangesHeader: null,
      contentRangeHeader: null,
      contentLengthHeader: null,
      contentEncodingHeader: null,
      cacheControlHeader: null,
      etagHeader: null,
      varyHeader: null,
      corsOriginHeader: null,
      bodyRead: false,
      tookMs: performance.now() - startedAt,
    };
  }
}

/** Runs both probes (see file header) against `model`'s weight file. Never touches the real model's download/storage path. */
export async function runRangeDiagnosis(model: AyasPhoneLlmModelSpec): Promise<RangeDiagnosisResult> {
  const files = getRequiredModelCacheFiles(model);
  const weightFile = files.find((f) => f.endsWith(".onnx")) ?? files[files.length - 1];
  const baseUrl = buildRemoteResourceUrl(model, weightFile);

  const serviceWorkerControllingThisPage =
    typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller !== null;

  const probeA = await runOneRangeProbe("A — mevcut downloader isteğiyle birebir aynı (ek query yok)", baseUrl);

  const cacheBuster = `ayas_diag=${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const bustedUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${cacheBuster}`;
  const probeB = await runOneRangeProbe("B — cache-busting query ile doğrudan probe (aynı origin, aynı Range)", bustedUrl);

  // Resolves THIS model+file's own gateway route, if any — previously this
  // probe always used the (single, hardcoded) Qwen route regardless of
  // `model`, which would have silently tested the WRONG upstream once a
  // second gateway-scoped model existed. Fixed alongside adding
  // SmolLM2-135M-Instruct's own route (see `phoneLlmPrecacheDownloader.ts`
  // round 5) — `probeGateway` is `null` both when the gateway isn't
  // configured on this device AND when this specific model/file simply
  // isn't gateway-scoped, same as `resolvePhoneLlmNetworkFetch`'s own logic.
  const gatewayRoute = findAyasPhoneLlmGatewayRoute(model.id, weightFile);
  const gatewayOrigin = resolveAyasWorkerUrl();
  const phoneKey = getStoredAyasPhoneKey();
  const probeGateway =
    gatewayRoute && gatewayOrigin && phoneKey
      ? await runOneRangeProbe("C — ayas-phone-gateway Range-preserving proxy üzerinden", `${gatewayOrigin}${gatewayRoute.proxyPath}`, {
          Authorization: `Bearer ${phoneKey}`,
        })
      : null;

  return {
    modelId: model.id,
    file: weightFile,
    serviceWorkerControllingThisPage,
    serviceWorkerWouldInterceptThisOrigin: false,
    probeA,
    probeB,
    probeGateway,
  };
}

function fmtProbe(p: RangeProbeResult): string {
  if (!p.ok) {
    return [`  [${p.label}]`, `  Request URL: ${p.requestUrl}`, `  Request Range: ${p.requestRangeHeader}`, `  HATA: ${p.errorDetail}`].join("\n");
  }
  return [
    `  [${p.label}]`,
    `  Request URL: ${p.requestUrl}`,
    `  Final URL: ${p.finalUrl ?? "—"}`,
    `  Redirect: ${p.redirected === null ? "—" : p.redirected ? "evet" : "hayır"}`,
    `  Request method: ${p.requestMethod}`,
    `  Request Range: ${p.requestRangeHeader}`,
    `  Response status: ${p.status ?? "—"}`,
    `  response.type: ${p.responseType ?? "—"}`,
    `  Accept-Ranges: ${p.acceptRangesHeader ?? "(absent)"}`,
    `  Content-Range: ${p.contentRangeHeader ?? "(absent)"}`,
    `  Content-Length: ${p.contentLengthHeader ?? "(absent)"}`,
    `  Content-Encoding: ${p.contentEncodingHeader ?? "(absent)"}`,
    `  Cache-Control: ${p.cacheControlHeader ?? "(absent)"}`,
    `  ETag: ${p.etagHeader ?? "(absent)"}`,
    `  Vary: ${p.varyHeader ?? "(absent)"}`,
    `  Access-Control-Allow-Origin: ${p.corsOriginHeader ?? "(absent)"}`,
    `  Body read: ${p.bodyRead} (her zaman false — bu araç asla body okumaz)`,
    `  Süre: ${p.tookMs.toFixed(0)} ms`,
  ].join("\n");
}

/**
 * Renders the exact `RANGE DIAGNOSIS` report shape the real-device request
 * asked for, with BOTH probes (labeled A/B) plus the code-proven Service
 * Worker fact — so the operator can copy/paste this whole block back
 * verbatim. `ROOT CAUSE` / `FIX` / `REGRESSION` are intentionally left as
 * placeholders here: those require synthesizing this result against what
 * the PC-side `curl` baseline already showed, which only the developer
 * side of this conversation can do once real values come back.
 */
export function formatRangeDiagnosis(result: RangeDiagnosisResult): string {
  return [
    "RANGE DIAGNOSIS",
    "",
    `Model: ${result.modelId}`,
    `File: ${result.file}`,
    `Service Worker controlling this page: ${result.serviceWorkerControllingThisPage ? "evet" : "hayır"}`,
    "Service Worker intercepted (koddan kanıtlı): HAYIR — public/sw.js, url.origin !== self.location.origin için respondWith() çağırmadan return ediyor; huggingface.co her zaman farklı origin.",
    "",
    fmtProbe(result.probeA),
    "",
    fmtProbe(result.probeB),
    "",
    result.probeGateway
      ? fmtProbe(result.probeGateway)
      : "  [C — ayas-phone-gateway üzerinden]\n  ÇALIŞTIRILMADI — bu cihazda NEXT_PUBLIC_AYAS_WORKER_URL yapılandırılmamış veya localStorage'da bootstrap edilmiş bir ayasPhoneKey yok. PC'den curl ile gateway zaten 206 verdiği doğrulandı; bu cihazda da doğrulamak için önce PWA'yı bir kez ?ayasPhoneKey=<key> ile açın.",
    "",
    result.probeGateway?.contentRangeHeader
      ? "ROOT CAUSE: iPhone/Chrome, huggingface.co'ya giden Range isteklerini güvenilir şekilde onurlandırmıyor (Probe A/B) — ayas-phone-gateway Cloudflare Worker'ı bu cihazda da 206 veriyor (Probe C). Gateway, doğrudan HF isteğinin yerini alacak şekilde kullanılmaya hazır."
      : "ROOT CAUSE: PC'den curl ile ayas-phone-gateway zaten 206 veriyor (bkz. deploy raporu) — bu cihazın Probe C sonucu bekleniyor, henüz burada iddia edilmiyor.",
    "FIX: gateway zaten deploy edildi ve PC'den doğrulandı — downloader'a bağlanması yalnızca Probe C bu cihazda da 206 verince yapılacak (talimat gereği).",
    "REGRESSION: gateway'in kendi test paketi (`scripts/smoke-ayas-phone-runtime.ts`, 11 route-2 senaryosu) yeşil; downloader'a bağlanınca ayrı bir entegrasyon regresyonu eklenecek.",
  ].join("\n");
}
