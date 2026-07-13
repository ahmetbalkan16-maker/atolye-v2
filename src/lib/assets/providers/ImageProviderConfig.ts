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
  };
}

export const imageProviderConfig: ImageProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: "gpt-image-1",
    size: "1024x1024",
    mimeType: "image/png",
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
