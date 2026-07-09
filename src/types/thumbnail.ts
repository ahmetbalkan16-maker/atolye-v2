export type ThumbnailStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type ThumbnailProviderName =
  | "mock";

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

  imageUrl?: string;

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
