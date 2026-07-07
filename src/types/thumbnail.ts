export interface ThumbnailGenerationInfo {
  provider?: string;

  model?: string;

  imageUrl?: string;

  status: "planned" | "generated" | "failed";
}

export interface ThumbnailData {
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
}
