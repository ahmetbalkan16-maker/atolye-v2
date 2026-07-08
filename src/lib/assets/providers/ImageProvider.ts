import type { ImageGenerationResult } from "@/types/asset";

export interface ImageGenerationInput {
  prompt: string;

  style?: string;

  size?: string;

  sceneId?: number;
}

export interface ImageProvider {
  generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult>;
}
