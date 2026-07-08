import type { ImageGenerationResult } from "@/types/asset";

export interface ImageGenerationInput {
  prompt: string;

  style?: string;

  size?: string;

  sceneId?: number;

  projectSlug?: string;
}

export interface ImageProvider {
  generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult>;
}
