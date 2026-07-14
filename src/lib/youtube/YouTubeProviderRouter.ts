import type { YouTubeProviderName } from "@/types/youtube";
import { MockYouTubeProvider } from "./providers/MockYouTubeProvider";
import { OpenAIYouTubeProvider } from "./providers/OpenAIYouTubeProvider";
import type { YouTubeProvider } from "./providers/YouTubeProvider";
import { resolveYouTubeProviderName } from "./YouTubeProviderConfig";

export class YouTubeProviderRouter {
  private readonly providers: Record<YouTubeProviderName, YouTubeProvider>;

  constructor(
    providers?: Partial<Record<YouTubeProviderName, YouTubeProvider>>,
  ) {
    this.providers = {
      mock: providers?.mock ?? new MockYouTubeProvider(),
      openai: providers?.openai ?? new OpenAIYouTubeProvider(),
    };
  }

  getProvider(providerName?: string): YouTubeProvider {
    return this.providers[resolveYouTubeProviderName(providerName)];
  }
}
