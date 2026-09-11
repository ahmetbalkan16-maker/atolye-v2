/**
 * AYAS phone gateway — Cloudflare Worker (Phase 2 · P0-A.4 · Option A).
 *
 * The ONLY thing this Worker does: while the PC is off (cloudflared / Next /
 * Ollama all down), give the installed phone PWA a stable, always-up
 * `POST /api/ayas/chat/stream` endpoint that answers with a cloud LLM instead.
 *
 * It is deliberately a THIN GATEWAY — no reasoning, no context assembly, no
 * long-term memory, no studio/project awareness. Those all require the PC
 * (filesystem, Ollama, `data/brain/`) and stay there; a Worker cannot see any
 * of it and must not try to fake it. It reuses two PURE, dependency-free
 * modules from the main app rather than re-implementing them:
 *
 *   - `createCloudAyasProvider` (src/lib/ayas/model/CloudAyasProvider.ts) —
 *     the exact same OpenAI-compatible SSE client the PC-side cloud fallback
 *     uses. Only `fetch`/`AbortController`/`TextDecoder` — no Node/Next import,
 *     so it bundles into the Workers runtime unchanged.
 *   - `isUsableAyasReply` / `ayasReplyClaimsExecution`
 *     (src/components/brain/brainCore.ts) — the same safety backstops the PC
 *     path applies, so a degraded cloud reply still can never claim to have
 *     written a file, run a command, pushed git, or deployed anything.
 *
 * SECURITY:
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
 *   - Exactly one route is served: `POST /api/ayas/chat/stream`. Everything
 *     else is 404/405, generic body, no version/stack leak.
 *   - This Worker holds NO reference to the PC's IP, `localhost`, Ollama, or
 *     cloudflared — it cannot depend on any of them being up. That is the
 *     entire point of it existing.
 */

import { createCloudAyasProvider } from "../../../src/lib/ayas/model/CloudAyasProvider";
import { isUsableAyasReply, ayasReplyClaimsExecution } from "../../../src/components/brain/brainCore";

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

function json(status: number, body: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
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
