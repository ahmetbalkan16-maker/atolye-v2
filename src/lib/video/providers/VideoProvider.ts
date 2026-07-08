import type { VideoProviderName, VideoStatus } from "@/types/video";

export interface VideoProviderSceneInput {
  sceneId: number;
  sourceAnimationAssetId: string;
}

export interface VideoGenerationInput {
  projectId: string;
  scenes: VideoProviderSceneInput[];
}

export interface VideoGenerationResult {
  provider: VideoProviderName | string;
  model?: string;
  url?: string;
  filePath?: string;
  mimeType?: string;
  status: VideoStatus;
  error?: string;
}

export interface VideoProvider {
  generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}
