export type AssemblyStatus =
  | "planned"
  | "assembled"
  | "failed";

export interface AssemblyScene {
  sceneId: number;

  chapterId?: number;

  duration: string;

  visualReference: string;

  animationAssetId?: string;

  videoAssetId?: string;

  audioAssetId?: string;

  audioReference: string;

  transition: string;

  cameraMovement: string;

  effects: string[];

  notes?: string;
}

export interface AssemblyRenderInfo {
  status: "planned" | "rendered" | "failed";

  outputUrl?: string;

  filePath?: string;

  format?: "mp4";

  mimeType?: "video/mp4";

  byteLength?: number;

  durationSeconds?: number;

  width?: number;

  height?: number;

  videoCodec?: string;

  audioCodec?: string;
}

export interface AssemblyPlanData {
  projectId?: string;

  slug?: string;

  title?: string;

  status?: AssemblyStatus;

  sourceVideoAssetId?: string;

  sourceAudioAssetId?: string;

  outputAssetId?: string;

  scenes: AssemblyScene[];

  totalDuration: string;

  style: string;

  render?: AssemblyRenderInfo;

  createdAt: string;

  updatedAt?: string;
}
