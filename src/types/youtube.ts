export type YouTubeProviderName = "mock" | "openai";

export interface YouTubeChapter {
  startSeconds: number;
  title: string;
}

export interface YouTubePackageDraft {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: YouTubeChapter[];
  pinnedComment: string;
  thumbnailText: string;
}

export interface YouTubePublishingPackage extends YouTubePackageDraft {
  schemaVersion: "1";
  projectId: string;
  slug: string;
  provider: YouTubeProviderName;
  model?: string;
  status: "generated";
  videoAssetId: string;
  thumbnailAssetId: string;
  generatedAt: string;
}
