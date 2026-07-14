import type { YouTubeProviderName } from "@/types/youtube";

export const YOUTUBE_PROVIDER_CONFIGURATION_ERROR =
  "YouTube provider configuration is invalid.";

export class YouTubeProviderConfigurationError extends Error {
  readonly code = "YOUTUBE_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super(YOUTUBE_PROVIDER_CONFIGURATION_ERROR);
    this.name = "YouTubeProviderConfigurationError";
    this.stack = undefined;
  }
}

export type YouTubeProviderConfig = {
  defaultProvider: YouTubeProviderName;
  openai: {
    model: string;
    timeoutMs: number;
    maximumResponseBytes: number;
    maximumPromptBytes: number;
  };
};

export const youtubeProviderConfig: YouTubeProviderConfig = {
  defaultProvider: "mock",
  openai: {
    model: process.env.YOUTUBE_OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    timeoutMs: 30_000,
    maximumResponseBytes: 1024 * 1024,
    maximumPromptBytes: 256 * 1024,
  },
};

export function resolveYouTubeProviderName(
  value: string | undefined = process.env.YOUTUBE_PROVIDER,
): YouTubeProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return youtubeProviderConfig.defaultProvider;
  if (normalized === "mock" || normalized === "openai") return normalized;
  throw new YouTubeProviderConfigurationError();
}
