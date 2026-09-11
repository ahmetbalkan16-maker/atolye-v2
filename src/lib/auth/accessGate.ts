/**
 * AYAS shared-passcode access gate (Master Sprint §24).
 *
 * A single app-level secret (`AYAS_ACCESS_KEY`) protects `/brain`, the studio
 * pages and every mutating `/api` route when AYAS is reached over the LAN. No
 * accounts, no external service, $0. A successful `/api/auth/login` sets an
 * HttpOnly, signed, short-lived session cookie; `middleware.ts` verifies it on
 * every protected request.
 *
 * Framework-free on purpose (Web Crypto + plain strings only) so it runs in the
 * Edge or Node middleware runtime unchanged and is trivially unit-tested.
 *
 * This gate is an authentication boundary in front of the app. It does NOT
 * touch the Execution Gate: a logged-in session still cannot run a pipeline,
 * approve an autonomous proposal or execute anything — that chain stays CLOSED.
 */

export const AYAS_SESSION_COOKIE = "ayas_session";
export const AYAS_ACCESS_KEY_ENV = "AYAS_ACCESS_KEY";

/** Minimum passcode length we will accept as "configured". */
export const AYAS_ACCESS_KEY_MIN_LENGTH = 12;
/** Session lifetime. Short — this is a home studio, re-entering the passcode is cheap. */
export const AYAS_SESSION_TTL_SECONDS = 12 * 60 * 60;
const CLOCK_SKEW_SECONDS = 60;
const SESSION_VERSION = 1;

export type AccessGateMode = "enforced" | "disabled-dev" | "misconfigured";

export interface AccessGateConfig {
  readonly mode: AccessGateMode;
  /** Present only when `mode === "enforced"`. */
  readonly key?: string;
  readonly reason: string;
}

type EnvLike = Readonly<Record<string, string | undefined>>;

export function resolveAccessGate(env: EnvLike = process.env): AccessGateConfig {
  const raw = env[AYAS_ACCESS_KEY_ENV];
  const key = typeof raw === "string" ? raw.trim() : "";
  const production = env.NODE_ENV === "production";

  if (key.length >= AYAS_ACCESS_KEY_MIN_LENGTH) {
    return { mode: "enforced", key, reason: "access key configured" };
  }
  if (key.length > 0) {
    return {
      mode: "misconfigured",
      reason: `${AYAS_ACCESS_KEY_ENV} is shorter than ${AYAS_ACCESS_KEY_MIN_LENGTH} characters`,
    };
  }
  if (production) {
    return {
      mode: "misconfigured",
      reason: `${AYAS_ACCESS_KEY_ENV} is not set (required in production)`,
    };
  }
  return { mode: "disabled-dev", reason: `${AYAS_ACCESS_KEY_ENV} not set — gate open for local dev` };
}

/* --------------------------------------------------------------- sessions --- */

interface SessionPayload {
  readonly v: number;
  readonly iat: number;
  readonly exp: number;
}

export async function issueSession(
  key: string,
  now: number = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    iat: issuedAt,
    exp: issuedAt + AYAS_SESSION_TTL_SECONDS,
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmacSha256(body, key));
  return `${body}.${signature}`;
}

export async function verifySession(
  token: string | undefined | null,
  key: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1 || token.indexOf(".", dot + 1) !== -1) {
    return false;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = base64UrlEncode(await hmacSha256(body, key));
  if (!timingSafeEqual(signature, expected)) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(body)),
    ) as SessionPayload;
  } catch {
    return false;
  }
  const seconds = Math.floor(now / 1000);
  return (
    payload.v === SESSION_VERSION &&
    Number.isFinite(payload.iat) &&
    Number.isFinite(payload.exp) &&
    payload.iat <= seconds + CLOCK_SKEW_SECONDS &&
    payload.exp > seconds
  );
}

/* --------------------------------------------------------------- routing ---- */

const OPEN_PREFIXES: readonly string[] = [
  "/login",
  "/api/auth/",
  "/_next/",
  "/__nextjs",
  // PWA icons — the browser fetches the manifest's icons for the install prompt
  // before any session exists.
  "/icons/",
  // On-device wake-engine assets: the static openWakeWord / "AYAS" ONNX models
  // (`/wake/`), the onnxruntime-web WASM runtime (`/ort/`), and the audio-capture
  // AudioWorklet (`/worklets/`). None are sensitive — the models only detect the
  // word "AYAS", the WASM is the public `onnxruntime-web` package, the worklet is
  // a ~3 KB frame slicer. They are loaded by `AudioWorklet.addModule` /
  // `WebAssembly.instantiateStreaming`, which choke on a 307 → /login HTML
  // redirect: gating them silently kills the wake engine on ANY expired session
  // (12 h TTL) and it never recovers without a full re-navigation + re-login.
  "/wake/",
  "/ort/",
  "/worklets/",
  // AYAS phone-local-LLM lab (Tier 2 prototype, isolated from production
  // chat/voice/memory/reasoning/self-heal — see the page's own header
  // comment). It must be reachable with NO AYAS session at all: the whole
  // point is a phone that can open it purely from its own local model +
  // browser cache while the PC (and therefore session verification) is
  // unreachable. Nothing sensitive lives behind this path — no chat history,
  // no project data, no secret; it never calls `/api/ayas/**`.
  "/brain/voice-lab/phone-llm",
];
const OPEN_EXACT: readonly string[] = [
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest",
  // PWA shell assets — the browser fetches these before a session exists
  // (install prompt, service-worker registration, offline fallback).
  "/sw.js",
  "/offline",
  "/ayas-icon.svg",
  "/ayas-icon-maskable.svg",
];

/** True when a request path must carry a valid session. */
export function isProtectedPath(pathname: string): boolean {
  if (OPEN_EXACT.includes(pathname)) return false;
  return !OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when a same-origin check should be enforced (state-changing request). */
export function requiresSameOrigin(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

/**
 * Whether the browser↔origin hop is HTTPS — used to decide the session cookie's
 * `Secure` flag when AYAS runs behind a TLS-terminating reverse proxy (the
 * documented remote-access setup). Trusting `x-forwarded-proto` here can only
 * make the cookie MORE restrictive (Secure), never less, so it is safe even when
 * the header is unset / spoofed. In production the cookie is always `Secure`
 * (production must be HTTPS); in local dev over plain `http://localhost` it is
 * not, so a dev login still works.
 */
export function isRequestOverHttps(input: {
  urlProtocol: string;
  forwardedProto: string | null;
  forwardedSsl: string | null;
  nodeEnv: string | undefined;
}): boolean {
  if (input.nodeEnv === "production") return true;
  if (input.urlProtocol === "https:") return true;
  const proto = (input.forwardedProto ?? "").split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  return (input.forwardedSsl ?? "").trim().toLowerCase() === "on";
}

/**
 * CSRF backstop: for a state-changing request, if the browser sent an `Origin`
 * (or `Referer`) it must match the request host. Absent headers pass (native
 * clients, same-origin fetches that omit them).
 */
export function isSameOriginRequest(input: {
  method: string;
  origin: string | null;
  referer: string | null;
  host: string | null;
}): boolean {
  if (!requiresSameOrigin(input.method)) return true;
  const source = input.origin ?? input.referer;
  if (!source || !input.host) return true;
  try {
    return new URL(source).host === input.host;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- brute-force limiter --- */

export interface AttemptLimiterState {
  count: number;
  resetAt: number;
}

export interface AttemptDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * Fixed-window per-key limiter. Process-local and best-effort — enough to blunt
 * online guessing of a home-studio passcode; not a distributed rate limiter.
 */
export function evaluateAttempt(
  store: Map<string, AttemptLimiterState>,
  bucketKey: string,
  options: { limit: number; windowSeconds: number },
  now: number = Date.now(),
): AttemptDecision {
  const existing = store.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    store.set(bucketKey, { count: 1, resetAt: now + options.windowSeconds * 1000 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  if (existing.count > options.limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearAttempts(
  store: Map<string, AttemptLimiterState>,
  bucketKey: string,
): void {
  store.delete(bucketKey);
}

/* --------------------------------------------------------------- crypto ----- */

async function hmacSha256(body: string, key: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(body),
  );
  return new Uint8Array(signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isPlausibleAccessKey(candidate: unknown): candidate is string {
  return (
    typeof candidate === "string" &&
    candidate.trim().length >= AYAS_ACCESS_KEY_MIN_LENGTH &&
    candidate.length <= 512
  );
}
