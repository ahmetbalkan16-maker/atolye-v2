export type AnimationStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export interface AnimationScene {
  sceneId: number;

  animationPrompt: string;

  sourceImageAssetId?: string;

  outputAssetId?: string;

  provider?: string;

  model?: string;

  status: AnimationStatus;
}

export interface AnimationData {
  projectId: string;

  scenes: AnimationScene[];

  createdAt: string;
}
