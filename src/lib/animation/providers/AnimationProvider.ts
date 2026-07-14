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
  requestIdentity?: string;
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
  error:
    | "ANIMATION_PROVIDER_REQUEST_FAILED"
    | "ANIMATION_PROVIDER_TIMEOUT"
    | "ANIMATION_PROVIDER_RESPONSE_INVALID";
};

export type AnimationGenerationResult =
  | AnimationGenerationSuccess
  | AnimationGenerationFailure;

export interface AnimationRequestIdentity {
  readonly assetId: string;
  readonly requestIdentity: string;
  readonly promptDigest: string;
  readonly model: string;
}

export interface AnimationProvider {
  readonly name: string;
  getRequestIdentity?(
    input: AnimationGenerationInput,
  ): AnimationRequestIdentity;
  generateAnimation(
    input: AnimationGenerationInput,
  ): Promise<AnimationGenerationResult>;
}
