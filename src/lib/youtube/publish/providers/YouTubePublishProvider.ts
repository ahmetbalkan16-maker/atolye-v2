import type {
  YouTubePublishProviderName,
  YouTubePublishProviderResult,
  YouTubePublishRequest,
} from "@/types/youtubePublish";

export const YOUTUBE_PUBLISH_ERROR = "YouTube publish failed." as const;

export interface YouTubePublishProvider {
  readonly name: YouTubePublishProviderName;
  readonly model?: string;
  publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult>;
}
