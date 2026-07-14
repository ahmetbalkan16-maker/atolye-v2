export type AnimationStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export const animationMotionTypes = [
  "static",
  "zoom-in",
  "zoom-out",
  "pan-left",
  "pan-right",
] as const;

export const animationTransitionTypes = ["cut", "fade", "crossfade"] as const;

export type AnimationMotionType = (typeof animationMotionTypes)[number];
export type AnimationTransitionType = (typeof animationTransitionTypes)[number];
export type AnimationGenerationMode = "mock" | "production";

export interface AnimationCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnimationTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export interface AnimationMotionFrame {
  crop: AnimationCrop;
  transform: AnimationTransform;
}

/**
 * Legacy-compatible animation scene shape. New generated records also satisfy
 * AnimationMotionPlanScene; optional fields keep existing animation.json files readable.
 */
export interface AnimationScene {
  sceneId: number;
  animationPrompt: string;
  sourceImageAssetId?: string;
  outputAssetId?: string;
  animationAssetId?: string;
  durationSeconds?: number;
  motionType?: AnimationMotionType;
  start?: AnimationMotionFrame;
  end?: AnimationMotionFrame;
  transition?: AnimationTransitionType;
  provider?: string;
  model?: string;
  generationMode?: AnimationGenerationMode;
  artifactType?: "motion-plan";
  status: AnimationStatus;
}

export interface AnimationMotionPlanScene extends AnimationScene {
  sourceImageAssetId: string;
  outputAssetId: string;
  animationAssetId: string;
  durationSeconds: number;
  motionType: AnimationMotionType;
  start: AnimationMotionFrame;
  end: AnimationMotionFrame;
  transition: AnimationTransitionType;
  provider: string;
  generationMode: AnimationGenerationMode;
  artifactType: "motion-plan";
  status: "generated";
}

export interface AnimationData {
  projectId: string;
  schemaVersion?: "2";
  artifactType?: "motion-plan";
  scenes: AnimationScene[];
  createdAt: string;
}
