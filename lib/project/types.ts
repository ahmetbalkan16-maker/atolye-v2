export type ProjectStatus =
  | "research"
  | "script"
  | "scene"
  | "assets"
  | "thumbnail"
  | "seo"
  | "export";

export interface ProjectState {
  id: string;
  topic: string;

  currentStep: ProjectStatus;

  completedSteps: ProjectStatus[];

  createdAt: string;
  updatedAt: string;
}