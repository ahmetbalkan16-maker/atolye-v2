import type { YouTubeProviderName } from "@/types/youtube";
import { MockYouTubeProvider } from "./providers/MockYouTubeProvider";
import type { YouTubeProvider } from "./providers/YouTubeProvider";
import {
  defaultYouTubeProviderConfig,
  type YouTubeProviderConfig,
} from "./YouTubeProviderConfig";

export class YouTubeProviderRouter {
  private readonly providers: Record<YouTubeProviderName, YouTubeProvider>;
  private readonly config: YouTubeProviderConfig;

  constructor(
    providers?: Partial<Record<YouTubeProviderName, YouTubeProvider>>,
    config: YouTubeProviderConfig = defaultYouTubeProviderConfig,
  ) {
    this.providers = {
      mock: providers?.mock ?? new MockYouTubeProvider(),
    };
    this.config = config;
  }

  getProvider(providerName = this.config.provider): YouTubeProvider {
    return this.providers[providerName] ?? this.providers.mock;
  }
}
