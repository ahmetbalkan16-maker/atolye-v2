export type AssetType =
  | "image"
  | "animation"
  | "video"
  | "audio"
  | "thumbnail";

export type AssetStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export interface Asset {
  id: string;

  projectId: string;

  projectSlug?: string;

  sceneId?: number;

  type: AssetType;

  status: AssetStatus;

  provider: string;

  model?: string;

  prompt: string;

  filePath?: string;

  url?: string;

  mimeType?: string;

  byteLength?: number;

  durationSeconds?: number;

  artifactType?: "motion-plan" | "scene-video";

  sourceAssetId?: string;

  animationAssetId?: string;

  generationMode?: "mock" | "production";

  width?: number;

  height?: number;

  frameRate?: number;

  transition?: string;

  /** Real-photo sourcing only: which external archive/library provided the image. */
  sourceName?: string;

  /** Real-photo sourcing only: the source's page URL for the image (provenance/attribution). */
  sourceUrl?: string;

  /** Real-photo sourcing only: the license identifier reported by the source. */
  license?: string;

  /** Real-photo sourcing only: required attribution/credit line, when the license demands one. */
  attribution?: string;

  /** Real-photo sourcing only: 0-1 title/query word-overlap score of the chosen candidate. */
  selectionScore?: number;

  /** Real-photo sourcing only: 1-based rank of the chosen candidate among eligible candidates
   *  (2+ means earlier-ranked candidates failed download and this one was used instead). */
  selectionRank?: number;

  /** Real-photo sourcing only: how many eligible candidates were considered in total. */
  candidateCount?: number;

  error?: string;

  createdAt: string;

  updatedAt?: string;
}

export interface ProjectAssets {
  projectId: string;

  projectSlug?: string;

  assets: Asset[];

  createdAt: string;

  updatedAt: string;
}

export type ImageProviderName = "mock" | "openai" | "real";

export type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type VideoMimeType = "video/mp4";

type ImageGenerationResultBase = {
  id?: string;
  sceneId: number;
  provider: ImageProviderName;
  model?: string;
  createdAt: string;
};

export type ImageGenerationMockSuccess = ImageGenerationResultBase & {
  success: true;
  provider: "mock";
  filePath: "";
  url: "";
  mimeType: "image/mock";
  error?: never;
};

type ImageGenerationFileLocator = {
  filePath: string;
  url?: string;
};

type ImageGenerationUrlLocator = {
  filePath?: string;
  url: string;
};

export type ImageGenerationRealSuccess = ImageGenerationResultBase &
  (ImageGenerationFileLocator | ImageGenerationUrlLocator) & {
    success: true;
    provider: "openai";
    mimeType: ImageMimeType;
    error?: never;
  };

export type ImageGenerationRealPhotoSuccess = ImageGenerationResultBase &
  (ImageGenerationFileLocator | ImageGenerationUrlLocator) & {
    success: true;
    provider: "real";
    mimeType: ImageMimeType;
    sourceName: string;
    sourceUrl: string;
    license: string;
    attribution?: string;
    selectionScore: number;
    selectionRank: number;
    candidateCount: number;
    width: number;
    height: number;
    error?: never;
  };

export type ImageGenerationFailure = ImageGenerationResultBase & {
  success: false;
  error: string;
  filePath?: never;
  url?: never;
  mimeType?: never;
};

export type ImageGenerationResult =
  | ImageGenerationMockSuccess
  | ImageGenerationRealSuccess
  | ImageGenerationRealPhotoSuccess
  | ImageGenerationFailure;
