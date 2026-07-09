export type YouTubeStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type YouTubeProviderName =
  | "mock";

export type YouTubeVisibility =
  | "private"
  | "unlisted"
  | "public";

export type YouTubeAudience =
  | "made-for-kids"
  | "not-made-for-kids";

export interface YouTubeChapter {
  startTime: string;

  title: string;

  sourceSceneId?: number;
}

export interface YouTubeMetadata {
  title: string;

  description: string;

  tags: string[];

  category: string;

  language: string;

  visibility: YouTubeVisibility;

  audience: YouTubeAudience;
}

export interface YouTubeAssetReferences {
  videoAssetId?: string;

  audioAssetId?: string;

  assemblyAssetId?: string;

  thumbnailVariantId?: string;

  thumbnailImageUrl?: string;
}

export interface YouTubePublishChecklist {
  hasVideo: boolean;

  hasAudio: boolean;

  hasAssembly: boolean;

  hasThumbnail: boolean;

  hasTitle: boolean;

  hasDescription: boolean;

  hasTags: boolean;

  readyToPublish: boolean;
}

export interface YouTubePublishingPackage {
  projectId?: string;

  slug?: string;

  provider?: YouTubeProviderName | string;

  model?: string;

  status: YouTubeStatus;

  metadata: YouTubeMetadata;

  chapters: YouTubeChapter[];

  assetReferences: YouTubeAssetReferences;

  checklist: YouTubePublishChecklist;

  notes: string[];

  createdAt: string;

  updatedAt?: string;
}
