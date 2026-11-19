/**
 * AYAS's Content-Security-Policy (owner approval 2026-11-19: "onay bekleyenleri onaylıyorum, tasarım gerekenlerinde
 * yap; bir şeyi yaparken başka bir şeyi bozma"; open since the 14 Nov 2026 security audit).
 *
 * A fresh nonce per request, set by `middleware.ts` both on the response and on the request Next renders from: Next
 * reads the `'nonce-…'` out of the request's policy and stamps it on every script it emits (framework, page chunks,
 * the inline RSC payload). So a script runs only when it is one of ours — an injected `<script>` or an inline
 * `onclick=` from a rendered string is refused by the browser. Every page renders per request for this (the root
 * layout is `force-dynamic`): a page prerendered at build time carries no nonce and its scripts would be blocked.
 *
 * What each directive allows, and why (everything else falls back to `default-src 'self'`):
 * - `script-src`: our own files, the nonce, `'wasm-unsafe-eval'` (WebAssembly only: the on-device wake engine and the
 *   phone model lab run onnxruntime-web), and one pinned folder on jsDelivr — the onnxruntime-web build that
 *   Transformers.js imports for the phone model lab (`ONNXRUNTIME_WEB_FOR_TRANSFORMERS`). No `'unsafe-inline'`, no
 *   `'unsafe-eval'` outside `next dev` (React's dev tooling needs eval there).
 * - `style-src 'self' 'unsafe-inline'`: 158 components use React `style={…}` attributes, which a nonce cannot cover. A
 *   style cannot run code; scripts stay strict.
 * - `connect-src`: our own origin (fetch, the chat stream, same-origin WebSocket for dev HMR), the phone model's
 *   pinned Hugging Face files and their CDN redirects, the same pinned jsDelivr folder (the .wasm), and the phone LLM
 *   gateway Worker when `NEXT_PUBLIC_AYAS_WORKER_URL` is set (the same build-time value the client bundle uses).
 * - `img-src`/`media-src` add `data:` and `blob:` (generated previews, recorded audio); `worker-src 'self' blob:`
 *   (service worker, library workers); `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
 *   `frame-ancestors 'self'` (the same rule as the `X-Frame-Options: SAMEORIGIN` header).
 *
 * `AYAS_CSP=report-only` sends the same policy as `Content-Security-Policy-Report-Only` (the browser only reports in
 * its console) and `AYAS_CSP=off` sends none — an emergency switch the owner can set in `.env.local` without a code
 * change if a page ever breaks. Anything else, unset included, enforces.
 */

/**
 * The onnxruntime-web version `@huggingface/transformers` bundles and loads from jsDelivr when no `wasmPaths` is set
 * (`src/backends/onnx.js`). Pinned by version, not the whole CDN: jsDelivr serves any npm package, so allowing the
 * host would let an injected `<script src>` load attacker code. `scripts/smoke-ayas-content-security-policy.ts` fails
 * when the installed Transformers.js uses another version, so an update cannot silently break the phone model lab.
 */
export const ONNXRUNTIME_WEB_FOR_TRANSFORMERS = "1.31.0-dev.20260914-8d85527a0";
const JSDELIVR_ORT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_FOR_TRANSFORMERS}/dist/`;
/** Pinned phone-model files (`phoneLlmModelResources.ts`) and the hosts Hugging Face redirects their downloads to. */
const HUGGING_FACE = ["https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"];

export type ContentSecurityPolicyMode = "enforce" | "report-only" | "off";

type EnvLike = Readonly<Record<string, string | undefined>>;

export function resolveContentSecurityPolicyMode(env: EnvLike): ContentSecurityPolicyMode {
  const raw = (env.AYAS_CSP ?? "").trim();
  if (raw === "off") return "off";
  if (raw === "report-only") return "report-only";
  return "enforce";
}

/** 128 random bits, base64 — the nonce of one response. */
export function newContentSecurityPolicyNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** An `https:` origin, or `null` — the same rule as the client's `resolveAyasWorkerUrl`. */
function httpsOrigin(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function buildContentSecurityPolicy(input: {
  readonly nonce: string;
  readonly development: boolean;
  readonly phoneWorkerUrl?: string;
}): string {
  if (!/^[A-Za-z0-9+/]{16,}={0,2}$/.test(input.nonce)) throw new Error("invalid CSP nonce");
  const worker = httpsOrigin(input.phoneWorkerUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${input.nonce}'`, "'wasm-unsafe-eval'", JSDELIVR_ORT, ...(input.development ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["media-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'", "data:"],
    ["connect-src", "'self'", ...HUGGING_FACE, JSDELIVR_ORT, ...(worker ? [worker] : []), ...(input.development ? ["ws:", "wss:"] : [])],
    ["worker-src", "'self'", "blob:"],
    ["manifest-src", "'self'"],
    ["frame-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'self'"],
  ];
  return directives.map((parts) => parts.join(" ")).join("; ");
}

export interface ContentSecurityPolicyHeader {
  /** `content-security-policy` or `content-security-policy-report-only` (lower case, as Next reads request headers). */
  readonly name: string;
  readonly value: string;
  readonly nonce: string;
}

/** The header for one request, or `null` when `AYAS_CSP=off`. */
export function contentSecurityPolicyFor(env: EnvLike, phoneWorkerUrl: string | undefined): ContentSecurityPolicyHeader | null {
  const mode = resolveContentSecurityPolicyMode(env);
  if (mode === "off") return null;
  const nonce = newContentSecurityPolicyNonce();
  return {
    name: mode === "report-only" ? "content-security-policy-report-only" : "content-security-policy",
    value: buildContentSecurityPolicy({ nonce, development: env.NODE_ENV === "development", phoneWorkerUrl }),
    nonce,
  };
}
