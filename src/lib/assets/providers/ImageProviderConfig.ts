import type { ImageMimeType, ImageProviderName } from "@/types/asset";

export type { ImageProviderName } from "@/types/asset";

export const IMAGE_PROVIDER_CONFIGURATION_ERROR =
  "Image provider configuration is invalid.";

export class ImageProviderConfigurationError extends Error {
  readonly code = "IMAGE_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(IMAGE_PROVIDER_CONFIGURATION_ERROR);
    this.name = "ImageProviderConfigurationError";
    this.stack = undefined;
  }
}

export interface ImageProviderConfig {
  defaultProvider: ImageProviderName;
  openai: {
    model: string;
    size: string;
    quality: string;
    mimeType: ImageMimeType;
    timeoutMs: number;
    maximumResponseBytes: number;
    /**
     * Minimum wall-clock gap enforced between two consecutive image API calls
     * from the same provider instance. Multi-shot fires ~15 calls in a row;
     * without pacing that bunches against the account's images-per-minute
     * limit. Consistent with the "real" provider's minRequestIntervalMs.
     */
    requestIntervalMs: number;
  };
  real: {
    timeoutMs: number;
    maximumResponseBytes: number;
    searchResultLimit: number;
    minimumWidth: number;
    minimumHeight: number;
    retryDelayMs: number;
    candidateAttemptLimit: number;
    targetDownloadWidth: number;
    sceneBudgetMs: number;
    minRequestIntervalMs: number;
  };
}

/**
 * gpt-image-1 accepts these `size` values. Landscape 1536x1024 (3:2) is the
 * documentary default: the production video is 1920x1080 (16:9), so a landscape
 * source only loses ~11% width to the scene compositor's aspect fit instead of
 * the ~44% a 1024x1024 square loses vertically. Override with IMAGE_OPENAI_SIZE
 * (e.g. back to "1024x1024") if a provider account does not support it.
 */
export const OPENAI_IMAGE_SIZES = Object.freeze([
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "auto",
] as const);

/** gpt-image-1 rendering quality; "auto" lets the model pick (current behaviour). */
export const OPENAI_IMAGE_QUALITIES = Object.freeze([
  "auto",
  "low",
  "medium",
  "high",
] as const);

export const imageProviderConfig: ImageProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: "gpt-image-1",
    size: "1536x1024",
    quality: "auto",
    mimeType: "image/png",
    timeoutMs: 60_000,
    maximumResponseBytes: 96 * 1024 * 1024,
    requestIntervalMs: 1_200,
  },
  real: {
    timeoutMs: 15_000,
    maximumResponseBytes: 32 * 1024 * 1024,
    searchResultLimit: 10,
    minimumWidth: 640,
    minimumHeight: 360,
    retryDelayMs: 750,
    candidateAttemptLimit: 3,
    // 1920 matches the production video pipeline's 1920x1080 output (Sprint 129.40) — a larger
    // original only slows the download down for no downstream benefit.
    targetDownloadWidth: 1920,
    sceneBudgetMs: 60_000,
    minRequestIntervalMs: 1_000,
  },
};

export function resolveImageProviderName(
  value: string | undefined = process.env.IMAGE_PROVIDER,
): ImageProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return imageProviderConfig.defaultProvider;
  }

  switch (normalized) {
    case "mock":
    case "openai":
    case "real":
      return normalized;
    default:
      throw new ImageProviderConfigurationError();
  }
}

export function getOpenAIImageProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Object.freeze({
    ...imageProviderConfig.openai,
    size: enumValue(
      environment.IMAGE_OPENAI_SIZE,
      imageProviderConfig.openai.size,
      OPENAI_IMAGE_SIZES,
    ),
    quality: enumValue(
      environment.IMAGE_OPENAI_QUALITY,
      imageProviderConfig.openai.quality,
      OPENAI_IMAGE_QUALITIES,
    ),
    timeoutMs: integerValue(
      environment.IMAGE_OPENAI_TIMEOUT_MS,
      imageProviderConfig.openai.timeoutMs,
      100,
      300_000,
    ),
    maximumResponseBytes: integerValue(
      environment.IMAGE_OPENAI_MAX_RESPONSE_BYTES,
      imageProviderConfig.openai.maximumResponseBytes,
      1_024,
      128 * 1024 * 1024,
    ),
    requestIntervalMs: integerValue(
      environment.IMAGE_OPENAI_REQUEST_INTERVAL_MS,
      imageProviderConfig.openai.requestIntervalMs,
      0,
      30_000,
    ),
  });
}

function enumValue<T extends string>(
  value: string | undefined,
  fallback: T,
  allowed: readonly T[],
): T {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!(allowed as readonly string[]).includes(normalized)) {
    throw new ImageProviderConfigurationError();
  }
  return normalized as T;
}

export function getRealImageProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Object.freeze({
    ...imageProviderConfig.real,
    timeoutMs: integerValue(
      environment.IMAGE_REAL_SOURCE_TIMEOUT_MS,
      imageProviderConfig.real.timeoutMs,
      100,
      120_000,
    ),
    maximumResponseBytes: integerValue(
      environment.IMAGE_REAL_MAX_RESPONSE_BYTES,
      imageProviderConfig.real.maximumResponseBytes,
      1_024,
      64 * 1024 * 1024,
    ),
    minimumWidth: integerValue(
      environment.IMAGE_REAL_MIN_WIDTH,
      imageProviderConfig.real.minimumWidth,
      1,
      16_384,
    ),
    minimumHeight: integerValue(
      environment.IMAGE_REAL_MIN_HEIGHT,
      imageProviderConfig.real.minimumHeight,
      1,
      16_384,
    ),
    retryDelayMs: integerValue(
      environment.IMAGE_REAL_RETRY_DELAY_MS,
      imageProviderConfig.real.retryDelayMs,
      0,
      30_000,
    ),
    candidateAttemptLimit: integerValue(
      environment.IMAGE_REAL_CANDIDATE_ATTEMPT_LIMIT,
      imageProviderConfig.real.candidateAttemptLimit,
      1,
      10,
    ),
    targetDownloadWidth: integerValue(
      environment.IMAGE_REAL_TARGET_DOWNLOAD_WIDTH,
      imageProviderConfig.real.targetDownloadWidth,
      16,
      16_384,
    ),
    sceneBudgetMs: integerValue(
      environment.IMAGE_REAL_SCENE_BUDGET_MS,
      imageProviderConfig.real.sceneBudgetMs,
      1_000,
      300_000,
    ),
    minRequestIntervalMs: integerValue(
      environment.IMAGE_REAL_MIN_REQUEST_INTERVAL_MS,
      imageProviderConfig.real.minRequestIntervalMs,
      0,
      30_000,
    ),
  });
}

function integerValue(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return fallback;
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new ImageProviderConfigurationError();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ImageProviderConfigurationError();
  }
  return parsed;
}
