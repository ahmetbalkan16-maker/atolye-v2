import type { YouTubePublishProviderName } from "@/types/youtubePublish";

export class YouTubePublishProviderConfigurationError extends Error {
  readonly code = "YOUTUBE_PUBLISH_PROVIDER_CONFIGURATION_INVALID";

  constructor() {
    super("YouTube publish provider configuration is invalid.");
    this.name = "YouTubePublishProviderConfigurationError";
    this.stack = undefined;
  }
}

export const youtubePublishProviderConfig = {
  defaultProvider: "mock" as YouTubePublishProviderName,
  youtubeDataApi: {
    timeoutMs: 120_000,
    maximumResponseBytes: 1024 * 1024,
    maximumThumbnailBytes: 64 * 1024 * 1024,
    model: "youtube-data-api-v3",
  },
};

export function resolveYouTubePublishProviderName(
  value: string | undefined = process.env.YOUTUBE_PUBLISH_PROVIDER,
): YouTubePublishProviderName {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return youtubePublishProviderConfig.defaultProvider;
  if (normalized === "mock" || normalized === "youtube-data-api") return normalized;
  throw new YouTubePublishProviderConfigurationError();
}
