import type { YouTubeProviderName } from "@/types/youtube";

export type YouTubeProviderConfig = {
  provider: YouTubeProviderName;
};

export const defaultYouTubeProviderConfig: YouTubeProviderConfig = {
  provider: "mock",
};
