export type VideoStatus =
  | "planned"
  | "generating"
  | "generated"
  | "failed";

export type VideoProviderName =
  | "mock"
  | "ffmpeg";

export type VideoGenerationMode = "mock" | "production";

export interface VideoScene {
  sceneId: number;

  sourceAnimationAssetId: string;

  sourceImageAssetId?: string;

  animationAssetId?: string;

  outputAssetId?: string;

  videoAssetId?: string;

  provider?: VideoProviderName | string;

  model?: string;

  status: VideoStatus;

  duration?: number;

  durationSeconds?: number;

  filePath?: string;

  url?: string;

  mimeType?: "video/mp4" | "video/mock";

  byteLength?: number;

  width?: number;

  height?: number;

  frameRate?: number;

  transition?: string;

  generationMode?: VideoGenerationMode;

  artifactType?: "scene-video";
}

export interface VideoData {
  projectId: string;

  schemaVersion?: "2";

  artifactType?: "scene-video";

  outputAssetId?: string;

  provider?: VideoProviderName | string;

  model?: string;

  status: VideoStatus;

  scenes: VideoScene[];

  createdAt: string;
}
