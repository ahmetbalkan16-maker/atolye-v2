/**
 * Atölye Brain — AYAS cloud-model config (Phase 2 · P0-A).
 *
 * The OPTIONAL cloud fallback provider. It is an OpenAI-compatible
 * `/v1/chat/completions` endpoint, so the same config works with OpenAI,
 * OpenRouter, Groq, Together, a self-hosted vLLM, etc. — AYAS is not locked to
 * one vendor (decision #5).
 *
 * Env (server-side only — NEVER `NEXT_PUBLIC_*`, never logged, never in git,
 * never in a prompt, never in a returned object that gets serialised):
 *
 *   AYAS_CLOUD_API_KEY    the bearer token. Presence ⇒ the cloud provider is
 *                         "configured". Read ONLY by `getAyasCloudApiKey()`,
 *                         which is called ONLY inside `CloudAyasProvider` to
 *                         build the `Authorization` header.
 *   AYAS_CLOUD_BASE_URL   OpenAI-compatible base, no trailing slash.
 *                         Default `https://api.openai.com/v1`. Must be https://
 *                         (or http://127.0.0.1 / http://localhost for a local
 *                         proxy under test).
 *   AYAS_CLOUD_MODEL      model tag. Default `gpt-4o-mini`.
 *   AYAS_CLOUD_TIMEOUT_MS per-request timeout. Default 60000 (1–300 s).
 *
 * `resolveAyasCloudConfig()` returns a plain object that is SAFE to log or
 * serialise — it carries no key. `getAyasCloudApiKey()` is the only door to the
 * secret.
 */

const ENV = {
  key: "AYAS_CLOUD_API_KEY",
  baseUrl: "AYAS_CLOUD_BASE_URL",
  model: "AYAS_CLOUD_MODEL",
  timeoutMs: "AYAS_CLOUD_TIMEOUT_MS",
} as const;

export const AYAS_CLOUD_ENV = ENV;

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 60_000;

const SAFE_MODEL = /^[a-zA-Z0-9._:\/-]{1,200}$/;

/** SAFE to log / serialise — no key. */
export interface AyasCloudConfig {
  /** `true` iff `AYAS_CLOUD_API_KEY` is present AND the rest of the config validates. */
  readonly configured: boolean;
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  /** Set when a value was present but rejected — used for the operational trace, never a secret. */
  readonly ignored?: readonly string[];
}

function normaliseBaseUrl(raw: string | undefined): { baseUrl: string; ok: boolean } {
  const value = raw?.trim();
  if (!value) return { baseUrl: DEFAULT_BASE_URL, ok: true };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { baseUrl: DEFAULT_BASE_URL, ok: false };
  }
  const isLocal = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    return { baseUrl: DEFAULT_BASE_URL, ok: false };
  }
  // strip a trailing slash
  return { baseUrl: `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`, ok: true };
}

export function resolveAyasCloudConfig(env: NodeJS.ProcessEnv = process.env): AyasCloudConfig {
  const ignored: string[] = [];
  const hasKey = typeof env[ENV.key] === "string" && env[ENV.key]!.trim().length >= 8;

  const { baseUrl, ok: baseOk } = normaliseBaseUrl(env[ENV.baseUrl]);
  if (!baseOk) ignored.push(ENV.baseUrl);

  const rawModel = env[ENV.model]?.trim();
  let model = DEFAULT_MODEL;
  if (rawModel) {
    if (SAFE_MODEL.test(rawModel)) model = rawModel;
    else ignored.push(ENV.model);
  }

  const rawTimeout = env[ENV.timeoutMs]?.trim();
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (rawTimeout) {
    const n = Number(rawTimeout);
    if (Number.isInteger(n) && n >= 1_000 && n <= 300_000) timeoutMs = n;
    else ignored.push(ENV.timeoutMs);
  }

  return {
    configured: hasKey && baseOk,
    baseUrl,
    model,
    timeoutMs,
    ...(ignored.length ? { ignored } : {}),
  };
}

/**
 * The ONLY reader of the cloud API key. Returns `null` when unset. Callers use
 * it exclusively to build an `Authorization: Bearer …` header and must never
 * put the value anywhere else (log line, error message, response body, prompt).
 */
export function getAyasCloudApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[ENV.key];
  return typeof raw === "string" && raw.trim().length >= 8 ? raw.trim() : null;
}
