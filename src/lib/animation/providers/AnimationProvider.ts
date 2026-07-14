import type {
  AnimationGenerationMode,
  AnimationMotionFrame,
  AnimationMotionType,
  AnimationTransitionType,
} from "@/types/animation";

export interface AnimationGenerationInput {
  sceneId: number;
  animationPrompt: string;
  sourceImageAssetId: string;
  durationSeconds: number;
}

type AnimationGenerationResultBase = {
  sceneId: number;
  sourceImageAssetId: string;
  provider: string;
  model?: string;
  generationMode: AnimationGenerationMode;
};

export type AnimationGenerationSuccess = AnimationGenerationResultBase & {
  success: true;
  artifactType: "motion-plan";
  status: "generated";
  durationSeconds: number;
  motionType: AnimationMotionType;
  start: AnimationMotionFrame;
  end: AnimationMotionFrame;
  transition: AnimationTransitionType;
  error?: never;
};

export type AnimationGenerationFailure = AnimationGenerationResultBase & {
  success: false;
  error: string;
};

export type AnimationGenerationResult =
  | AnimationGenerationSuccess
  | AnimationGenerationFailure;

export interface AnimationProvider {
  readonly name: string;
  generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult>;
}
