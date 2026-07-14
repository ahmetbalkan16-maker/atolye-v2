import type { YouTubePublishProviderName } from "@/types/youtubePublish";
import { MockYouTubePublishProvider } from "./providers/MockYouTubePublishProvider";
import type { YouTubePublishProvider } from "./providers/YouTubePublishProvider";
import { YouTubeDataApiPublishProvider } from "./providers/YouTubeDataApiPublishProvider";
import { resolveYouTubePublishProviderName } from "./YouTubePublishProviderConfig";
import { YouTubePublishProviderConfigurationError } from "./YouTubePublishProviderConfig";

export class YouTubePublishProviderRouter {
  private readonly providers: Record<YouTubePublishProviderName, YouTubePublishProvider>;

  constructor(providers?: Partial<Record<YouTubePublishProviderName, YouTubePublishProvider>>) {
    this.providers = {
      mock: providers?.mock ?? new MockYouTubePublishProvider(),
      "youtube-data-api": providers?.["youtube-data-api"] ?? new YouTubeDataApiPublishProvider(),
    };
  }

  getProvider(name?: string) {
    const resolved = resolveYouTubePublishProviderName(name);
    if (resolved === "youtube-data-api" && !process.env.YOUTUBE_ACCESS_TOKEN?.trim()) {
      throw new YouTubePublishProviderConfigurationError();
    }
    return this.providers[resolved];
  }
}
