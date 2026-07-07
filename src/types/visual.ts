export type VisualStyle =
  | "cinematic"
  | "realistic"
  | "photorealistic"
  | "documentary"
  | "historical"
  | "concept-art";

export interface VisualPrompt {
  id: string;

  sceneId: string;

  title: string;

  prompt: string;

  negativePrompt?: string;

  aspectRatio: "16:9" | "9:16" | "1:1";

  style: VisualStyle;

  camera?: string;

  lighting?: string;

  lens?: string;

  mood?: string;

  colorPalette?: string;

  createdAt: string;
}

export interface VisualScene {
  sceneId: number;

  visualPrompt: string;

  animationPrompt: string;

  style: string;
}

export interface ThumbnailConcept {
  title: string;

  prompt: string;

  composition: string;

  mood: string;
}

export interface VisualData {
  projectId: string;

  scenes: VisualScene[];

  thumbnail: ThumbnailConcept;

  createdAt: string;

  prompts?: VisualPrompt[];

  generatedAt?: string;
}
