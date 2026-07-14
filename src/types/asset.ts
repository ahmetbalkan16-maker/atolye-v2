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

export type ImageProviderName = "mock" | "openai";

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
  | ImageGenerationFailure;
