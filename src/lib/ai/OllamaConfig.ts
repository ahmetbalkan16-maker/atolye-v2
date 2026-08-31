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
}

export const OLLAMA_DEFAULTS = Object.freeze({
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen2.5:3b",
  timeoutMs: 180_000,
  maxTokens: 4_096,
  temperature: 0.4,
  format: "json" as const,
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
  });
}
