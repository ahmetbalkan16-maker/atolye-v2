import type { ImageMimeType } from "@/types/asset";
import type { AnimationMotionPlanScene } from "@/types/animation";
import type {
  VideoGenerationMode,
  VideoProviderName,
} from "@/types/video";

export interface VideoProviderSceneInput {
  sceneId: number;
  sourceImageAssetId: string;
  animationAssetId: string;
  imageFilePath: string;
  imageMimeType: ImageMimeType | "image/mock";
  motionPlan: AnimationMotionPlanScene;
}

export interface VideoGenerationInput {
  projectId: string;
  projectSlug: string;
  scenes: VideoProviderSceneInput[];
}

export interface VideoSceneGenerationSuccess {
  sceneId: number;
  sourceImageAssetId: string;
  animationAssetId: string;
  provider: VideoProviderName | string;
  model?: string;
  generationMode: VideoGenerationMode;
  filePath: string;
  url: string;
  mimeType: "video/mp4" | "video/mock";
  byteLength: number;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  transition: string;
  status: "generated";
  createdAt: string;
}

export type VideoGenerationResult =
  | {
      success: true;
      provider: VideoProviderName | string;
      generationMode: VideoGenerationMode;
      scenes: VideoSceneGenerationSuccess[];
    }
  | {
      success: false;
      provider: VideoProviderName | string;
      error: string;
    };

export interface VideoProvider {
  readonly name: string;
  generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult>;
}
