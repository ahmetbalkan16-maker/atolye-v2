export type VideoAssemblyProviderName = "mock" | "ffmpeg";

export interface VideoAssemblyLegacySceneInput {
  inputType: "image";
  sceneId: number;
  chapterId?: number;
  imageFilePath: string;
  audioFilePath: string;
  audioStartSeconds?: number;
  durationSeconds: number;
}

export interface VideoAssemblySceneVideoInput {
  inputType: "scene-video";
  sceneId: number;
  videoAssetId: string;
  sourceImageAssetId: string;
  animationAssetId: string;
  filePath: string;
  url: string;
  durationSeconds: number;
  narrationDurationSeconds: number;
  chapterId?: number;
  audioStartSeconds?: number;
  byteLength: number;
  provider: "ffmpeg";
  generationMode: "production";
  status: "generated";
  audioFilePath: string;
}

export type VideoAssemblySceneInput =
  | VideoAssemblyLegacySceneInput
  | VideoAssemblySceneVideoInput;

export interface VideoAssemblyInput {
  projectSlug: string;
  scenes: VideoAssemblySceneInput[];
}

type VideoAssemblyResultBase = {
  provider: VideoAssemblyProviderName;
  createdAt: string;
};

export type VideoAssemblyMockSuccess = VideoAssemblyResultBase & {
  success: true;
  provider: "mock";
  status: "planned";
  filePath: "";
  url: "";
  mimeType: "video/mock";
  byteLength: 0;
  durationSeconds: 0;
  error?: never;
};

export type VideoAssemblyRealSuccess = VideoAssemblyResultBase & {
  success: true;
  provider: "ffmpeg";
  status: "rendered";
  model: "ffmpeg-h264-aac";
  filePath: string;
  url: string;
  mimeType: "video/mp4";
  byteLength: number;
  durationSeconds: number;
  width: 1920;
  height: 1080;
  videoCodec: "h264";
  audioCodec: "aac";
  error?: never;
};

export type VideoAssemblyFailure = VideoAssemblyResultBase & {
  success: false;
  error: "Video assembly failed.";
};

export type VideoAssemblyResult =
  | VideoAssemblyMockSuccess
  | VideoAssemblyRealSuccess
  | VideoAssemblyFailure;
