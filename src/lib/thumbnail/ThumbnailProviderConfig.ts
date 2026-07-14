import type { ThumbnailProviderName } from "@/types/thumbnail";

export type ThumbnailProviderConfig = {
  defaultProvider: ThumbnailProviderName;
  openai: {
    model: "gpt-image-1";
    size: "1536x1024";
    mimeType: "image/png";
    timeoutMs: number;
    maximumResponseBytes: number;
  };
};

export const thumbnailProviderConfig: ThumbnailProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: "gpt-image-1",
    size: "1536x1024",
    mimeType: "image/png",
    timeoutMs: 60_000,
    maximumResponseBytes: 96 * 1024 * 1024,
  },
};

export const THUMBNAIL_PROVIDER_CONFIGURATION_ERROR =
  "Thumbnail provider configuration is invalid.";

export class ThumbnailProviderConfigurationError extends Error {
  readonly code = "THUMBNAIL_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(THUMBNAIL_PROVIDER_CONFIGURATION_ERROR);
    this.name = "ThumbnailProviderConfigurationError";
    this.stack = undefined;
  }
}

export function resolveThumbnailProviderName(
  value: string | undefined = process.env.THUMBNAIL_PROVIDER,
): ThumbnailProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return thumbnailProviderConfig.defaultProvider;
  if (normalized === "mock" || normalized === "openai") return normalized;
  throw new ThumbnailProviderConfigurationError();
}
