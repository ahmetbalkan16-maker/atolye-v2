/**
 * AYAS phone gateway — Cloudflare Worker (Phase 2 · P0-A.4 · Option A +
 * Phone-LLM Range-blocker closure).
 *
 * TWO independent, unrelated routes live here — each documented and secured
 * on its own; neither imports or depends on the other:
 *
 * 1. `POST /api/ayas/chat/stream` — while the PC is off (cloudflared / Next /
 *    Ollama all down), gives the installed phone PWA a stable, always-up
 *    endpoint that answers with a cloud LLM instead. See the original design
 *    notes below (unchanged this pass).
 *
 * 2. `GET <MODEL_PROXY_PATH>` (see constant below) — the Phone-LLM Range
 *    blocker fix. Real-device evidence (see
 *    `src/components/brain/voice/localLlm/phoneLlmPrecacheDownloader.ts`'s
 *    header and `phoneLlmRangeDiagnostic.ts`) proved that on a real iPhone,
 *    a `Range` request straight to `huggingface.co` for this exact model's
 *    weight file gets `HTTP 200` + `Content-Range: absent` — 100%
 *    reproducibly, including with a cache-busting query, while the SAME
 *    request from `curl`/PC `fetch()`/this Worker's own server-side `fetch()`
 *    gets a clean `206 Partial Content` every time. This route puts a
 *    Cloudflare edge `fetch()` — the side of that gap proven to work — in
 *    front of the phone, so the phone's own `Range` request goes to THIS
 *    Worker's origin (which it has never cached anything under) instead of
 *    repeatedly hitting `huggingface.co` directly.
 *
 *    HARD CONSTRAINTS (this is a single-purpose proxy, not a general one):
 *      - Exactly ONE upstream URL is ever fetched — a hardcoded literal
 *        (`MODEL_UPSTREAM_URL`), not derived from any request input. There is
 *        no path parameter, no query parameter, nothing the caller supplies
 *        that changes which URL this Worker fetches. It cannot be used to
 *        proxy an arbitrary URL.
 *      - A `Range` header is REQUIRED on every request; its absence is a
 *        `400` (see `handleModelWeightProxy`) — this route never serves a
 *        whole-file download.
 *      - The upstream `Range` header is forwarded byte-for-byte. If upstream
 *        doesn't answer `206`, THIS Worker never reads that body (mirrors
 *        the app's own SAFE ABORT — see `fetchOneChunk`'s header) and
 *        returns a typed `502` instead of ever passing through an
 *        unverified/full body.
 *      - The response body is streamed straight through
 *        (`new Response(upstream.body, ...)`) — never `.arrayBuffer()`'d,
 *        never buffered. The ~460MB file is never materialized in this
 *        Worker's memory, at any chunk size.
 *      - `Content-Range` / `Content-Length` / `Accept-Ranges` / `ETag` are
 *        forwarded from upstream unchanged, plus
 *        `Access-Control-Expose-Headers` naming all four — without that,
 *        the browser hides them from the app's own `response.headers.get()`
 *        calls on a cross-origin response even when the wire response is
 *        perfect (`Content-Range`/`ETag`/`Accept-Ranges` are NOT in the
 *        CORS-safelisted response-header set).
 *      - Reuses the SAME `AYAS_PHONE_KEY` bearer-token gate as the chat
 *        route (`isAuthorized`) — the existing auth mechanism, not a new
 *        one — so this Worker can't be used as a free anonymous mirror.
 *
 * SECURITY (route 1, chat stream — unchanged from the original design):
 *   - `AYAS_CLOUD_API_KEY` is a Worker secret (`wrangler secret put`). Read only
 *     inside `CloudAyasProvider` for the `Authorization` header to the LLM. It
 *     is never logged, echoed, or put in an error/response body.
 *   - `AYAS_PHONE_KEY` is a SEPARATE Worker secret. The caller must present it
 *     as `Authorization: Bearer <key>` — this Worker does not reuse the PC's
 *     session-cookie gate (a cross-origin cookie would never reach it anyway).
 *     Compared in constant time. No key ⇒ 401 before anything else runs.
 *   - The client can never choose the provider, base URL, model, or API key —
 *     those come only from this Worker's own config (`AYAS_CLOUD_MODEL` /
 *     `AYAS_CLOUD_BASE_URL` vars + the `AYAS_CLOUD_API_KEY` secret). The
 *     request body is read for `text` / `history` / `seq` ONLY.
 *   - No arbitrary URL forwarding: the LLM base URL is fixed server-side.
 *   - Exactly two routes are served (see above). Everything else is
 *     404/405, generic body, no version/stack leak.
 *   - This Worker holds NO reference to the PC's IP, `localhost`, Ollama, or
 *     cloudflared — it cannot depend on any of them being up. That is the
 *     entire point of route 1 existing; route 2 is independent of the PC too
 *     (it talks only to `huggingface.co`).
 */

import { createCloudAyasProvider } from "../../../src/lib/ayas/model/CloudAyasProvider";
import { isUsableAyasReply, ayasReplyClaimsExecution } from "../../../src/components/brain/brainCore";
import { MODEL_PROXY_ROUTES } from "./modelProxyConfig";

/** Worker bindings — set via `wrangler.toml` [vars] (non-secret) + `wrangler secret put` (secret). */
export interface AyasWorkerEnv {
  readonly AYAS_CLOUD_API_KEY?: string;
  readonly AYAS_CLOUD_MODEL?: string;
  readonly AYAS_CLOUD_BASE_URL?: string;
  readonly AYAS_CLOUD_TIMEOUT_MS?: string;
  readonly AYAS_PHONE_KEY?: string;
  /** Extra allowed CORS origin, e.g. a named tunnel domain added later. Non-secret. */
  readonly AYAS_EXTRA_ORIGIN?: string;
}

const ROUTE_PATH = "/api/ayas/chat/stream";
const MAX_BODY_CHARS = 32 * 1024; // matches app/api/ayas/chat/stream/route.ts MAX_BODY_BYTES
const MAX_TEXT = 4_000; // matches the Next.js route
const MAX_HISTORY = 12; // matches the Next.js route
const MAX_TOKENS = 420; // matches AYAS_MAX_REPLY_TOKENS

type ChatRole = "user" | "brain" | "system";

/** Mirrors `AyasChatStreamEvent` in src/lib/ayas/AyasChatStream.ts — kept in sync by hand (no runtime import: this Worker must not pull in Next.js server code). */
type PhoneStreamEvent =
  | { readonly type: "delta"; readonly text: string }
  | {
      readonly type: "done";
      readonly text: string;
      readonly source: "llm" | "fallback";
      readonly corrected: boolean;
      readonly reason?: string;
      readonly provider?: "cloud";
    };

function sse(event: PhoneStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Belt-and-suspenders scrub before any diagnostic text reaches `console.error` — never trust an error message by default. */
function redactSecrets(text: string): string {
  return String(text ?? "")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 300);
}

const TRYCLOUDFLARE_ORIGIN = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const LAN_ORIGIN = "https://192.168.2.74"; // deploy/Caddyfile primary site

function allowedOrigin(origin: string | null, env: AyasWorkerEnv): string | null {
  if (!origin) return null;
  if (origin === LAN_ORIGIN) return origin;
  if (TRYCLOUDFLARE_ORIGIN.test(origin)) return origin;
  if (env.AYAS_EXTRA_ORIGIN && origin === env.AYAS_EXTRA_ORIGIN) return origin;
  return null;
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

/**
 * Route 2's own CORS header set — kept separate from `corsHeaders()` above
 * rather than extending it, so route 1's (already real-device-verified)
 * CORS contract is never perturbed by this route's needs. `Range` must be
 * allow-listed (it is NOT a CORS-safelisted request header, so a
 * cross-origin `fetch()` with a `Range` header triggers a real preflight);
 * `Content-Range`/`Content-Length`/`Accept-Ranges`/`ETag` must be exposed
 * (none of the four are in the CORS-safelisted RESPONSE header set, so
 * without this the app's own `response.headers.get(...)` calls would see
 * `null` for all of them even on a perfect 206 from this Worker).
 */
function modelProxyCorsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Range",
    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, ETag",
    "Access-Control-Max-Age": "600",
  };
}

function json(status: number, body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

/**
 * Route 2's own JSON-error responder — was missing; every non-206 response
 * from route 2 (400/401/403/405/502) was going through `json()` above,
 * which stamps route 1's CORS header set (`Access-Control-Allow-Headers:
 * Content-Type, Authorization`, no `Range`; no
 * `Access-Control-Expose-Headers` for Content-Range/Content-Length/
 * Accept-Ranges/ETag). The OPTIONS preflight for route 2 always used the
 * CORRECT `modelProxyCorsHeaders()` set (confirmed live via curl with the
 * real production Origin), so the preflight for a Range+Authorization
 * request succeeded — but any actual GET that then received a non-206
 * response (a real-device auth mismatch after `AYAS_PHONE_KEY` rotation
 * this session, for instance) got a response whose CORS headers didn't
 * match what route 2 actually needs, which is a real, confirmed defect
 * regardless of the exact browser-engine behavior it triggers. Fixed by
 * giving route 2 its own responder using `modelProxyCorsHeaders()` — every
 * error path below now uses this instead of `json()`.
 */
function modelProxyJson(status: number, body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...modelProxyCorsHeaders(origin) },
  });
}

/** Constant-time compare — avoids a timing side-channel on the phone-key check. */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const len = Math.max(ea.length, eb.length, 1);
  let diff = ea.length === eb.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  }
  return diff === 0;
}

function isAuthorized(request: Request, env: AyasWorkerEnv): boolean {
  const configured = typeof env.AYAS_PHONE_KEY === "string" && env.AYAS_PHONE_KEY.trim().length >= 12;
  if (!configured) return false; // fail closed: an unconfigured Worker answers no phone at all
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) return false;
  return timingSafeEqual(match[1].trim(), env.AYAS_PHONE_KEY!.trim());
}

const BYTES_RANGE_RE = /^bytes=\d+-\d+$/;

/**
 * Route 2 (Phone-LLM Range proxy) — see file header for the full design
 * rationale and hard constraints. Requires a single `bytes=<start>-<end>`
 * Range header, forwards it verbatim to `upstreamUrl` (the router below
 * resolves this from the closed `MODEL_PROXY_ROUTES` allowlist by matching
 * the request path — the only URL this function ever fetches for a given
 * request), and — ONLY if upstream answers `206` — streams that response
 * straight through without ever buffering it. Any other upstream status is
 * a fail-closed `502`, body cancelled unread.
 */
async function handleModelWeightProxy(request: Request, origin: string | null, upstreamUrl: string): Promise<Response> {
  const range = request.headers.get("range");
  if (!range) {
    return modelProxyJson(
      400,
      { error: "range_required", detail: "This gateway only serves bounded Range requests for a small, fixed set of phone-fallback weight files — no whole-file download is offered." },
      origin,
    );
  }
  if (!BYTES_RANGE_RE.test(range.trim())) {
    return modelProxyJson(400, { error: "invalid_range", detail: "Range must be exactly one 'bytes=<start>-<end>' window." }, origin);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { headers: { Range: range } });
  } catch {
    return modelProxyJson(502, { error: "upstream_unreachable" }, origin);
  }

  if (upstream.status !== 206) {
    // SAFE ABORT — mirrors fetchOneChunk's own fix exactly (see its header):
    // never read a body whose status doesn't match what a Range request
    // expects. Cancelled unread, never passed through.
    await upstream.body?.cancel().catch(() => {});
    return modelProxyJson(502, { error: "upstream_range_not_honored", detail: `upstream responded ${upstream.status}, expected 206` }, origin);
  }

  const headers = new Headers(modelProxyCorsHeaders(origin) as HeadersInit);
  headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const contentRange = upstream.headers.get("content-range");
  const contentLength = upstream.headers.get("content-length");
  const etag = upstream.headers.get("etag");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (contentLength) headers.set("Content-Length", contentLength);
  headers.set("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes");
  if (etag) headers.set("ETag", etag);
  // Live pass-through, not a cache — never let an intermediate cache key
  // on this Worker's own URL and serve a stale/wrong slice back.
  headers.set("Cache-Control", "no-store");

  // STREAM straight through: `upstream.body` is a ReadableStream, handed
  // directly to this Response. Cloudflare Workers pipe this without ever
  // materializing the bytes here — this is the entire point of route 2.
  return new Response(upstream.body, { status: 206, headers });
}

/**
 * A minimal, honest system framing. No project/studio/memory context — this
 * Worker has none. It says so, once, so AYAS doesn't pretend otherwise.
 */
function buildPhoneFallbackPrompt(text: string, history: readonly { role: ChatRole; text: string }[]): string {
  const lines: string[] = [
    "Sen AYAS'sın — Atölye V2 stüdyosunun sesli/metin asistanısın.",
    "Şu an BULUT YEDEK MODUNDASIN: ana bilgisayar kapalı ya da erişilemez durumda,",
    "bu yüzden proje geçmişine, kalıcı hafızaya veya stüdyo durumuna erişimin YOK.",
    "Gerekirse bunu kullanıcıya kısaca hatırlat.",
    "Hiçbir zaman bir eylemi (dosya yazma, komut çalıştırma, git, deploy, pipeline",
    "aşaması çalıştırma) gerçekleştirdiğini iddia etme — yalnızca konuşuyorsun.",
    "Kısa, doğal, Türkçe yanıt ver.",
    "",
  ];
  for (const turn of history.filter((t) => t.role !== "system").slice(-MAX_HISTORY)) {
    lines.push(`${turn.role === "user" ? "Kullanıcı" : "AYAS"}: ${turn.text}`);
  }
  lines.push(`Kullanıcı: ${text}`, "AYAS:");
  return lines.join("\n");
}

async function handleChatStream(request: Request, env: AyasWorkerEnv, origin: string | null): Promise<Response> {
  const lengthHeader = request.headers.get("content-length");
  const declared = lengthHeader ? Number(lengthHeader) : NaN;
  if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
    return json(413, { error: "payload_too_large" }, origin);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { error: "invalid_body" }, origin);
  }
  if (raw.length > MAX_BODY_CHARS) {
    return json(413, { error: "payload_too_large" }, origin);
  }

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json(400, { error: "invalid_json" }, origin);
  }

  const b = (body ?? {}) as { text?: unknown; history?: unknown; seq?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > MAX_TEXT) {
    return json(400, { error: "invalid_text" }, origin);
  }
  const history: { role: ChatRole; text: string }[] = Array.isArray(b.history)
    ? (b.history as unknown[])
        .filter(
          (t): t is { role: ChatRole; text: string } =>
            !!t &&
            typeof t === "object" &&
            typeof (t as { text?: unknown }).text === "string" &&
            ["user", "brain", "system"].includes((t as { role?: unknown }).role as string),
        )
        .slice(-MAX_HISTORY)
    : [];

  const provider = createCloudAyasProvider(env as unknown as NodeJS.ProcessEnv, fetch);
  if (!provider.configured) {
    // Honest, config-free — never reveals which var is missing.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            sse({
              type: "done",
              text: "AYAS bulut yedeği şu an yapılandırılmamış.",
              source: "fallback",
              corrected: true,
              reason: "cloud-not-configured",
            }),
          ),
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        ...corsHeaders(origin),
      },
    });
  }

  const prompt = buildPhoneFallbackPrompt(text, history);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = "";
      try {
        for await (const chunk of provider.stream({ prompt, complexity: "NORMAL", maxTokens: MAX_TOKENS })) {
          if (chunk.type === "delta") {
            full += chunk.text;
            controller.enqueue(encoder.encode(sse({ type: "delta", text: chunk.text })));
          }
        }
      } catch (error) {
        // Transport failure only — never the provider's error body (may echo the key/org id).
        // Safe operational diagnostic only: error NAME/constructor + a redacted message —
        // never headers, never the request, never anything that could carry the key.
        const name = error instanceof Error ? error.name || error.constructor?.name : typeof error;
        const message = error instanceof Error ? redactSecrets(error.message) : "";
        const cause = error instanceof Error && error.cause ? redactSecrets(String(error.cause)) : "";
        console.error(`[ayas-phone-gateway] cloud fetch failed: ${name}${message ? ` — ${message}` : ""}${cause ? ` (cause: ${cause})` : ""}`);
        controller.enqueue(
          encoder.encode(
            sse({
              type: "done",
              text: "AYAS bulut yedeğine şu an ulaşılamıyor.",
              source: "fallback",
              corrected: true,
              reason: `cloud-fetch-failed:${name}`,
              provider: "cloud",
            }),
          ),
        );
        controller.close();
        return;
      }

      const finalText = full.trim();
      if (!isUsableAyasReply(finalText) || ayasReplyClaimsExecution(finalText)) {
        controller.enqueue(
          encoder.encode(
            sse({
              type: "done",
              text: "AYAS bulut yedeğinden kullanılabilir bir yanıt alınamadı.",
              source: "fallback",
              corrected: true,
              reason: !isUsableAyasReply(finalText) ? "unusable-reply" : "execution-claim",
              provider: "cloud",
            }),
          ),
        );
        controller.close();
        return;
      }

      controller.enqueue(
        encoder.encode(sse({ type: "done", text: finalText, source: "llm", corrected: false, provider: "cloud" })),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      ...corsHeaders(origin),
    },
  });
}

const ayasPhoneGatewayWorker = {
  async fetch(request: Request, env: AyasWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const origin = allowedOrigin(request.headers.get("origin"), env);

    // Route 2 — Phone-LLM Range proxy (see file header). Handled first and
    // entirely separately from route 1's logic/CORS/method rules below.
    // `MODEL_PROXY_ROUTES` is a closed, hardcoded allowlist (see
    // `modelProxyConfig.ts`) — matching by `===` against each entry's fixed
    // `path`, never a wildcard/prefix match, keeps the "only ever fetches
    // hardcoded upstream URLs" guarantee true for every entry.
    const modelRoute = MODEL_PROXY_ROUTES.find((r) => r.path === url.pathname);
    if (modelRoute) {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: modelProxyCorsHeaders(origin) });
      }
      if (request.method !== "GET") {
        return modelProxyJson(405, { error: "method_not_allowed" }, origin);
      }
      if (request.headers.get("origin") && !origin) {
        return modelProxyJson(403, { error: "origin_not_allowed" }, null);
      }
      if (!isAuthorized(request, env)) {
        return modelProxyJson(401, { error: "unauthorized" }, origin);
      }
      try {
        return await handleModelWeightProxy(request, origin, modelRoute.upstreamUrl);
      } catch {
        return modelProxyJson(502, { error: "gateway_error" }, origin);
      }
    }

    if (url.pathname !== ROUTE_PATH) {
      return new Response("not found", { status: 404 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return json(405, { error: "method_not_allowed" }, origin);
    }
    // A request whose Origin is present but not on the allow-list is refused
    // server-side too (defense in depth beyond the browser's own CORS block —
    // a non-browser caller ignores CORS headers entirely).
    if (request.headers.get("origin") && !origin) {
      return json(403, { error: "origin_not_allowed" }, null);
    }
    if (!isAuthorized(request, env)) {
      return json(401, { error: "unauthorized" }, origin);
    }

    try {
      return await handleChatStream(request, env, origin);
    } catch {
      return json(502, { error: "gateway_error" }, origin);
    }
  },
};

export default ayasPhoneGatewayWorker;
