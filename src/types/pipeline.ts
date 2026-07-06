export type PipelineStep =
  | "topic"
  | "research"
  | "script"
  | "scenes"
  | "assets"
  | "animation"
  | "voice"
  | "seo"
  | "export";

export type PipelineStepStatus =
  | "locked"
  | "ready"
  | "running"
  | "completed"
  | "error";

export interface PipelineStepState {
  step: PipelineStep;
  label: string;
  status: PipelineStepStatus;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface PipelineProject {
  id: string;
  topic: string;
  title: string;
  status: PipelineStep;
  steps: PipelineStepState[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}