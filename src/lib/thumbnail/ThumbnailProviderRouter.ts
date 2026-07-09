import type { ThumbnailProviderName } from "@/types/thumbnail";
import { MockThumbnailProvider } from "./providers/MockThumbnailProvider";
import type { ThumbnailProvider } from "./providers/ThumbnailProvider";
import {
  defaultThumbnailProviderConfig,
  type ThumbnailProviderConfig,
} from "./ThumbnailProviderConfig";

export class ThumbnailProviderRouter {
  private readonly providers: Record<ThumbnailProviderName, ThumbnailProvider>;
  private readonly config: ThumbnailProviderConfig;

  constructor(
    providers?: Partial<Record<ThumbnailProviderName, ThumbnailProvider>>,
    config: ThumbnailProviderConfig = defaultThumbnailProviderConfig,
  ) {
    this.providers = {
      mock: providers?.mock ?? new MockThumbnailProvider(),
    };
    this.config = config;
  }

  getProvider(providerName = this.config.provider): ThumbnailProvider {
    return this.providers[providerName] ?? this.providers.mock;
  }
}
