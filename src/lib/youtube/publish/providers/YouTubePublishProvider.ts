import type {
  YouTubePublishProviderName,
  YouTubePublishProviderResult,
  YouTubePublishReconciliationRequest,
  YouTubePublishReconciliationResult,
  YouTubePublishRequest,
} from "@/types/youtubePublish";

export const YOUTUBE_PUBLISH_ERROR = "YouTube publish failed." as const;
export const YOUTUBE_RECONCILIATION_ERROR =
  "YouTube publish reconciliation failed." as const;

export interface YouTubePublishProvider {
  readonly name: YouTubePublishProviderName;
  readonly model?: string;
  readonly reconciliationChannelId?: string;
  publish(request: YouTubePublishRequest): Promise<YouTubePublishProviderResult>;
  reconcilePublish?(
    request: YouTubePublishReconciliationRequest,
  ): Promise<YouTubePublishReconciliationResult>;
}
