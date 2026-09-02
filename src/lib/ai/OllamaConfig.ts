/**
 * Local, $0 LLM backend — Ollama (OpenAI-compatible `/v1/chat/completions`).
 *
 * Every text stage (research / script / scenes / visual-plan / audio-plan /
 * assembly-plan / seo), the animation motion-plan and the YouTube package can
 * run against a local Ollama server instead of `api.openai.com`, eliminating the
 * per-call OpenAI cost. Nothing here changes the default: `mock` stays the
 * router default and `openai` stays available — Ollama is opt-in via
 * `AI_PROVIDER=ollama` (and `ANIMATION_PROVIDER=ollama` / `YOUTUBE_PROVIDER=ollama`).
 *
 * Env:
 *  - `OLLAMA_HOST`        base URL of the Ollama server (default 127.0.0.1:11434)
 *  - `OLLAMA_MODEL`       model tag (default `qwen2.5:3b` — fits a 4 GB GPU at Q4)
 *  - `OLLAMA_TIMEOUT_MS`  per-request timeout (default 180 000 — a small local
 *                         model on modest hardware is much slower than the API)
 *  - `OLLAMA_MAX_TOKENS`  completion cap (default 4096)
 *  - `OLLAMA_TEMPERATURE` sampling temperature (default 0.4, matching OpenAI)
 *  - `OLLAMA_FORMAT`      `json` (default — this pipeline's every LLM call wants
 *                         one JSON object) or `text`
 */

export interface OllamaConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly temperature: number;
  readonly format: "json" | "text";
  /** Context window (`num_ctx`), or `undefined` to leave it at whatever the
   * Ollama server / Modelfile decides (its default is small — often 4096 — which
   * can cut a research-grounded script/scenes reply mid-object). Opt in per host
   * with `OLLAMA_NUM_CTX`; a bigger value needs a bigger KV cache, so only raise
   * it where the GPU has the headroom. */
  readonly numCtx?: number;
  /** Extra attempts when a reply comes back truncated (`done_reason: "length"`)
   * or empty — a small local model is not deterministic, so a re-roll (with a
   * lower temperature each time) often lands a complete JSON object. `0` keeps
   * the single-shot behaviour. */
  readonly maxRetries: number;
}

export const OLLAMA_DEFAULTS = Object.freeze({
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen2.5:3b",
  // Generous: a small model on a GPU-starved / CPU-only box can take minutes per
  // call. Lower it with OLLAMA_TIMEOUT_MS when the model runs fully on the GPU.
  timeoutMs: 600_000,
  maxTokens: 4_096,
  temperature: 0.4,
  format: "json" as const,
  // Unset by default: let the Ollama server pick. Set OLLAMA_NUM_CTX (qwen2.5
  // supports up to 32k) where a large prompt + full JSON reply needs the room
  // AND the GPU can hold the larger KV cache.
  numCtx: undefined as number | undefined,
  // One re-roll on a truncated/empty reply. Raise with OLLAMA_MAX_RETRIES for a
  // flakier small model on constrained hardware.
  maxRetries: 1,
});

const SAFE_MODEL = /^[a-zA-Z0-9._:\/-]{1,200}$/;

export class OllamaConfigurationError extends Error {
  readonly code = "OLLAMA_CONFIGURATION_INVALID";
  constructor(message = "Ollama configuration is invalid.") {
    super(message);
    this.name = "OllamaConfigurationError";
    this.stack = undefined;
  }
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new OllamaConfigurationError();
  }
  return n;
}

/** Like `integer`, but an unset/empty value yields `undefined` (no fallback). */
function optionalInteger(value: string | undefined, min: number, max: number): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new OllamaConfigurationError();
  }
  return n;
}

function float(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value.trim());
  if (!Number.isFinite(n) || n < min || n > max) throw new OllamaConfigurationError();
  return n;
}

/** Normalise `OLLAMA_HOST` to an `http(s)://host:port` base URL with no trailing slash. */
export function resolveOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OLLAMA_HOST?.trim();
  if (!raw) return OLLAMA_DEFAULTS.baseUrl;
  // A scheme, if present, must be http(s).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    throw new OllamaConfigurationError();
  }
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new OllamaConfigurationError();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OllamaConfigurationError();
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function resolveOllamaConfig(env: NodeJS.ProcessEnv = process.env): OllamaConfig {
  const model = env.OLLAMA_MODEL?.trim() || OLLAMA_DEFAULTS.model;
  if (!SAFE_MODEL.test(model)) throw new OllamaConfigurationError();
  const format = (env.OLLAMA_FORMAT?.trim().toLowerCase() || OLLAMA_DEFAULTS.format);
  if (format !== "json" && format !== "text") throw new OllamaConfigurationError();
  return Object.freeze({
    baseUrl: resolveOllamaBaseUrl(env),
    model,
    timeoutMs: integer(env.OLLAMA_TIMEOUT_MS, OLLAMA_DEFAULTS.timeoutMs, 1_000, 1_800_000),
    maxTokens: integer(env.OLLAMA_MAX_TOKENS, OLLAMA_DEFAULTS.maxTokens, 64, 32_768),
    temperature: float(env.OLLAMA_TEMPERATURE, OLLAMA_DEFAULTS.temperature, 0, 2),
    format,
    numCtx: optionalInteger(env.OLLAMA_NUM_CTX, 2_048, 131_072),
    maxRetries: integer(env.OLLAMA_MAX_RETRIES, OLLAMA_DEFAULTS.maxRetries, 0, 6),
  });
}
