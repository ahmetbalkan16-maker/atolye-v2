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
    mimeType: ImageMimeType;
    timeoutMs: number;
    maximumResponseBytes: number;
  };
}

export const imageProviderConfig: ImageProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: "gpt-image-1",
    size: "1024x1024",
    mimeType: "image/png",
    timeoutMs: 60_000,
    maximumResponseBytes: 96 * 1024 * 1024,
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
