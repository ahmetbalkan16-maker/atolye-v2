import type { ProjectStatus } from "@/types/project";

export interface ProjectState {
  status: ProjectStatus;

  progress: number;

  completedSteps: ProjectStatus[];
}

export function createInitialState(): ProjectState {
  return {
    status: "draft",
    progress: 0,
    completedSteps: [],
  };
}