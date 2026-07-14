import type { YouTubePublishingPackage } from "./youtube";

export type YouTubePublishProviderName = "mock" | "youtube-data-api";
export type YouTubePublishStatus = "publishing" | "published" | "failed";

export interface YouTubePublishMetadata {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: "private";
}

export interface YouTubePublishRequest {
  schemaVersion: "1";
  packageIdentity: string;
  publishingPackage: YouTubePublishingPackage;
  videoAbsolutePath: string;
  thumbnailAbsolutePath: string;
  metadata: YouTubePublishMetadata;
  signal?: AbortSignal;
}

export type YouTubePublishProviderResult =
  | {
      success: true;
      provider: YouTubePublishProviderName;
      model?: string;
      remoteVideoId: string;
      remoteVideoUrl: string;
      channelId?: string;
      providerRequestId?: string;
      error?: never;
    }
  | {
      success: false;
      provider: YouTubePublishProviderName;
      model?: string;
      outcome: "failed" | "indeterminate";
      error: "YouTube publish failed.";
      remoteVideoId?: never;
      remoteVideoUrl?: never;
    };

interface YouTubePublishRecordBase {
  schemaVersion: "1";
  projectId: string;
  slug: string;
  packageIdentity: string;
  videoAssetId: string;
  thumbnailAssetId: string;
  provider: YouTubePublishProviderName;
  model?: string;
  attemptId: string;
  createdAt: string;
}

export interface YouTubePublishingRecord extends YouTubePublishRecordBase {
  status: "publishing";
}

export interface YouTubePublishedRecord extends YouTubePublishRecordBase {
  status: "published";
  remoteVideoId: string;
  remoteVideoUrl: string;
  channelId?: string;
  providerRequestId?: string;
  publishedAt: string;
}

export interface YouTubePublishFailedRecord extends YouTubePublishRecordBase {
  status: "failed";
  failedAt: string;
}

export type YouTubePublishRecord =
  | YouTubePublishingRecord
  | YouTubePublishedRecord
  | YouTubePublishFailedRecord;
