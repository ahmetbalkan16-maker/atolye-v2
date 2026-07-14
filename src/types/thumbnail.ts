export type ThumbnailStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type ThumbnailProviderName =
  | "mock"
  | "openai";

export type ThumbnailMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type ThumbnailGenerationMode = "mock" | "production";

export type ThumbnailStyle =
  | "documentary"
  | "cinematic"
  | "dramatic"
  | "minimal"
  | "character-focus"
  | "mystery";

export interface ThumbnailVariant {
  id: string;

  title: string;

  concept: string;

  prompt: string;

  negativePrompt: string;

  style: ThumbnailStyle | string;

  composition: string;

  textOverlaySuggestion: string;

  priority: number;

  status: ThumbnailStatus;
}

export interface ThumbnailGenerationInfo {
  provider?: ThumbnailProviderName | string;

  model?: string;

  assetId?: string;

  fileName?: string;

  filePath?: string;

  imageUrl?: string;

  mimeType?: ThumbnailMimeType;

  width?: number;

  height?: number;

  byteLength?: number;

  generationMode?: ThumbnailGenerationMode;

  status: ThumbnailStatus;
}

export interface ThumbnailData {
  projectId?: string;

  slug?: string;

  provider?: ThumbnailProviderName | string;

  model?: string;

  status?: ThumbnailStatus;

  sourceAssemblyAssetId?: string;

  sourceVideoAssetId?: string;

  sourceAudioAssetId?: string;

  outputAssetId?: string;

  variants: ThumbnailVariant[];

  titleIdea: string;

  concept: string;

  mainSubject: string;

  composition: string;

  colorStyle: string;

  textSuggestion: string;

  imagePrompt: string;

  clickReason: string;

  generation?: ThumbnailGenerationInfo;

  createdAt: string;

  updatedAt?: string;
}
