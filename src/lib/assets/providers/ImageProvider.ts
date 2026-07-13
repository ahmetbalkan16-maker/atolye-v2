import type {
  ImageGenerationResult,
  ImageProviderName,
} from "@/types/asset";

export interface ImageGenerationInput {
  prompt: string;

  style?: string;

  size?: string;

  sceneId: number;

  projectSlug?: string;
}

export interface ImageProvider {
  readonly name: ImageProviderName;

  generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationResult>;
}
