export type VideoStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type VideoProviderName =
  | "mock";

export interface VideoScene {
  sceneId: number;

  sourceAnimationAssetId: string;

  outputAssetId?: string;

  provider?: VideoProviderName | string;

  model?: string;

  status: VideoStatus;

  duration?: number;
}

export interface VideoData {
  projectId: string;

  outputAssetId?: string;

  provider?: VideoProviderName | string;

  model?: string;

  status: VideoStatus;

  scenes: VideoScene[];

  createdAt: string;
}
