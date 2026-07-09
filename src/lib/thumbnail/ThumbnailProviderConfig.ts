import type { ThumbnailProviderName } from "@/types/thumbnail";

export type ThumbnailProviderConfig = {
  provider: ThumbnailProviderName;
};

export const defaultThumbnailProviderConfig: ThumbnailProviderConfig = {
  provider: "mock",
};
