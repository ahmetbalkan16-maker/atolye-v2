export interface AssemblyScene {
  sceneId: number;

  duration: string;

  visualReference: string;

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
  scenes: AssemblyScene[];

  totalDuration: string;

  style: string;

  render?: AssemblyRenderInfo;

  createdAt: string;
}
