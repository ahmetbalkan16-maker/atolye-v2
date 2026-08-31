import type { ThumbnailProviderName } from "@/types/thumbnail";
import { MockThumbnailProvider } from "./providers/MockThumbnailProvider";
import { OpenAIThumbnailProvider } from "./providers/OpenAIThumbnailProvider";
import { LocalThumbnailProvider } from "./providers/LocalThumbnailProvider";
import type { ThumbnailProvider } from "./providers/ThumbnailProvider";
import {
  resolveThumbnailProviderName,
} from "./ThumbnailProviderConfig";

export class ThumbnailProviderRouter {
  private readonly providers: Record<ThumbnailProviderName, ThumbnailProvider>;
  constructor(
    providers?: Partial<Record<ThumbnailProviderName, ThumbnailProvider>>,
  ) {
    this.providers = {
      mock: providers?.mock ?? new MockThumbnailProvider(),
      openai: providers?.openai ?? new OpenAIThumbnailProvider(),
      local: providers?.local ?? new LocalThumbnailProvider(),
    };
  }

  getProvider(providerName?: string): ThumbnailProvider {
    return this.providers[resolveThumbnailProviderName(providerName)];
  }
}
