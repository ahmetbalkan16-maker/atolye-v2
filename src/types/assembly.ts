export type AssemblyStatus =
  | "planned"
  | "assembled"
  | "failed";

export interface AssemblyScene {
  sceneId: number;

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

  format?: "mp4";
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
