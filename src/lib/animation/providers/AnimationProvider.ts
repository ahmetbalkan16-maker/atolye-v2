import type { AnimationStatus } from "@/types/animation";

export interface AnimationGenerationInput {
  sceneId: number;

  animationPrompt: string;

  sourceImageAssetId?: string;

  duration?: number;

  style?: string;
}

export interface AnimationGenerationResult {
  provider: string;

  model?: string;

  url?: string;

  filePath?: string;

  status: AnimationStatus;

  error?: string;
}

export interface AnimationProvider {
  generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult>;
}
