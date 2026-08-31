/**
 * Documentary media effort — Faz 5: the single deterministic price table for
 * every paid AI call the pipeline makes, plus pure cost calculators.
 *
 * Rules (see the Faz 5 sprint entry):
 *  - Prices are explicit per model. An unknown model / provider is NEVER assumed
 *    free — the calculators return `{ status: "unknown" }` and the caller must
 *    fail closed.
 *  - `mock` (and any non-billable provider) is explicitly `{ status: "free" }`.
 *  - Token calls price input + output separately.
 *  - Image calls price per generated image, keyed by (size, quality).
 *  - TTS prices per character of synthesised text.
 *
 * The USD figures below are approximate OpenAI list prices as of the 2026-01
 * knowledge cutoff. They are a deterministic estimate, not a billing source of
 * truth — keep them current, and prefer to *over*-estimate when unsure so the
 * `$1` production budget guard stays conservative.
 */

export type AiPricingStatus = "known" | "unknown" | "free";

export interface AiCostEstimate {
  readonly status: AiPricingStatus;
  /** USD. Present (and finite, >= 0) only when `status === "known"` or `"free"`. */
  readonly costUsd: number;
  /** What was metered. */
  readonly unitKind: "tokens" | "characters" | "images";
  readonly unitCount: number;
  /** The model the estimate was resolved against (normalised). */
  readonly model: string;
}

interface TokenPrice {
  readonly kind: "token";
  /** USD per 1,000,000 input (prompt) tokens. */
  readonly inputPerMillion: number;
  /** USD per 1,000,000 output (completion) tokens. */
  readonly outputPerMillion: number;
}

interface ImagePrice {
  readonly kind: "image";
  /** USD per image, keyed `"<size>|<quality>"` (quality "auto" resolves to "medium"). */
  readonly perImage: Readonly<Record<string, number>>;
}

interface TtsPrice {
  readonly kind: "tts";
  /** USD per 1,000,000 characters of synthesised text. */
  readonly perMillionCharacters: number;
}

type ModelPrice = TokenPrice | ImagePrice | TtsPrice;

/** Providers whose calls are always free (no external billing). */
const FREE_PROVIDERS = new Set([
  "mock",
  "local",
  "music-library",
  // Local / self-hosted backends — no per-call cost.
  "ollama",
  "piper",
]);

/**
 * Explicit price table. Keys are the exact model identifiers the providers
 * report. Add a row here when a new model is configured — a missing row is a
 * deliberate fail-closed signal, not an oversight to paper over with `0`.
 */
export const AI_PRICE_TABLE: Readonly<Record<string, ModelPrice>> = Object.freeze({
  // --- text / reasoning models (USD per 1M tokens) ---
  "gpt-4.1": { kind: "token", inputPerMillion: 2.0, outputPerMillion: 8.0 },
  "gpt-4.1-mini": { kind: "token", inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { kind: "token", inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4o": { kind: "token", inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "gpt-4o-mini": { kind: "token", inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "o1": { kind: "token", inputPerMillion: 15.0, outputPerMillion: 60.0 },
  "o1-mini": { kind: "token", inputPerMillion: 1.1, outputPerMillion: 4.4 },
  "o3-mini": { kind: "token", inputPerMillion: 1.1, outputPerMillion: 4.4 },

  // --- image models (USD per generated image) ---
  "gpt-image-1": {
    kind: "image",
    perImage: {
      "1024x1024|low": 0.011,
      "1024x1024|medium": 0.042,
      "1024x1024|high": 0.167,
      "1536x1024|low": 0.016,
      "1536x1024|medium": 0.063,
      "1536x1024|high": 0.25,
      "1024x1536|low": 0.016,
      "1024x1536|medium": 0.063,
      "1024x1536|high": 0.25,
    },
  },
  "dall-e-3": {
    kind: "image",
    perImage: {
      "1024x1024|standard": 0.04,
      "1024x1024|hd": 0.08,
      "1792x1024|standard": 0.08,
      "1792x1024|hd": 0.12,
      "1024x1792|standard": 0.08,
      "1024x1792|hd": 0.12,
    },
  },

  // --- text-to-speech (USD per 1M characters) ---
  "tts-1": { kind: "tts", perMillionCharacters: 15.0 },
  "tts-1-hd": { kind: "tts", perMillionCharacters: 30.0 },
  "gpt-4o-mini-tts": { kind: "tts", perMillionCharacters: 12.0 },
});

/** Normalise a reported model string to a price-table key. */
export function normalizePricingModel(model: string | null | undefined): string {
  if (typeof model !== "string") return "";
  return model.trim().toLowerCase();
}

function freeEstimate(unitKind: AiCostEstimate["unitKind"], unitCount: number, model: string): AiCostEstimate {
  return { status: "free", costUsd: 0, unitKind, unitCount, model };
}

function unknownEstimate(unitKind: AiCostEstimate["unitKind"], unitCount: number, model: string): AiCostEstimate {
  return { status: "unknown", costUsd: Number.NaN, unitKind, unitCount, model };
}

function round(costUsd: number): number {
  // Six decimals — a single image is ~$0.01-0.25, a token call fractions of a cent.
  return Math.round(costUsd * 1e6) / 1e6;
}

/**
 * Cost of one token-metered call. `provider` lets `mock` short-circuit to free
 * without needing a price row.
 */
export function estimateTokenCost(input: {
  readonly provider?: string | null;
  readonly model: string | null | undefined;
  readonly promptTokens: number | null | undefined;
  readonly completionTokens: number | null | undefined;
}): AiCostEstimate {
  const model = normalizePricingModel(input.model);
  const promptTokens = safeCount(input.promptTokens);
  const completionTokens = safeCount(input.completionTokens);
  const unitCount = promptTokens + completionTokens;

  if (isFreeProvider(input.provider)) return freeEstimate("tokens", unitCount, model || "mock");

  const price = AI_PRICE_TABLE[model];
  if (!price || price.kind !== "token") return unknownEstimate("tokens", unitCount, model);
  if (input.promptTokens == null || input.completionTokens == null) {
    // Token counts are required to price a token call — missing counts fail closed.
    return unknownEstimate("tokens", unitCount, model);
  }

  const costUsd =
    (promptTokens / 1_000_000) * price.inputPerMillion +
    (completionTokens / 1_000_000) * price.outputPerMillion;
  return { status: "known", costUsd: round(costUsd), unitKind: "tokens", unitCount, model };
}

/** Cost of `count` generated images at `(size, quality)`. */
export function estimateImageCost(input: {
  readonly provider?: string | null;
  readonly model: string | null | undefined;
  readonly size: string | null | undefined;
  readonly quality?: string | null | undefined;
  readonly count: number | null | undefined;
}): AiCostEstimate {
  const model = normalizePricingModel(input.model);
  const count = Math.max(0, Math.trunc(safeCount(input.count)));

  if (isFreeProvider(input.provider)) return freeEstimate("images", count, model || "mock");

  const price = AI_PRICE_TABLE[model];
  if (!price || price.kind !== "image") return unknownEstimate("images", count, model);

  const size = normalizePricingModel(input.size);
  let quality = normalizePricingModel(input.quality) || "medium";
  if (quality === "auto") quality = "medium";
  const perImage = price.perImage[`${size}|${quality}`];
  if (perImage === undefined) return unknownEstimate("images", count, model);

  return {
    status: "known",
    costUsd: round(perImage * count),
    unitKind: "images",
    unitCount: count,
    model,
  };
}

/** Cost of synthesising `characters` characters of narration. */
export function estimateTtsCost(input: {
  readonly provider?: string | null;
  readonly model: string | null | undefined;
  readonly characters: number | null | undefined;
}): AiCostEstimate {
  const model = normalizePricingModel(input.model);
  const characters = Math.max(0, Math.trunc(safeCount(input.characters)));

  if (isFreeProvider(input.provider)) return freeEstimate("characters", characters, model || "mock");

  const price = AI_PRICE_TABLE[model];
  if (!price || price.kind !== "tts") return unknownEstimate("characters", characters, model);

  return {
    status: "known",
    costUsd: round((characters / 1_000_000) * price.perMillionCharacters),
    unitKind: "characters",
    unitCount: characters,
    model,
  };
}

/**
 * Map an estimate onto the additive `AIUsageRecord` cost fields. An `unknown`
 * estimate leaves `estimatedCost` undefined (never 0) so the budget guard can
 * fail closed.
 */
export function toUsageCostFields(estimate: AiCostEstimate): {
  estimatedCost?: number;
  pricingStatus: AiPricingStatus;
  costUnitKind: AiCostEstimate["unitKind"];
  costUnitCount: number;
} {
  return {
    estimatedCost: estimate.status === "unknown" ? undefined : estimate.costUsd,
    pricingStatus: estimate.status,
    costUnitKind: estimate.unitKind,
    costUnitCount: estimate.unitCount,
  };
}

/**
 * Conservative pre-dispatch token-cost ceiling for a text call, before the real
 * usage is known: prompt tokens ≈ chars/4, completion tokens ≈ the requested
 * `maxTokens` (or a generous default). Used by the budget guard to refuse a call
 * that *could* blow the budget rather than only reacting after the fact.
 */
export function estimateTokenCallCeiling(input: {
  readonly provider?: string | null;
  readonly model: string | null | undefined;
  readonly promptChars: number;
  readonly maxTokens?: number | null;
}): AiCostEstimate {
  const promptTokens = Math.max(1, Math.ceil(Math.max(0, input.promptChars) / 4));
  const completionTokens =
    typeof input.maxTokens === "number" && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? Math.ceil(input.maxTokens)
      : 8192;
  return estimateTokenCost({
    provider: input.provider,
    model: input.model,
    promptTokens,
    completionTokens,
  });
}

function isFreeProvider(provider: string | null | undefined): boolean {
  return typeof provider === "string" && FREE_PROVIDERS.has(provider.trim().toLowerCase());
}

function safeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
