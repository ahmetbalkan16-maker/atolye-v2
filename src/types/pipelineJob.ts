import type { ProductionStepKey } from "./project";

export type PipelineJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineJobAction = "cancel" | "retry";

export interface PipelineJob {
  id: string;
  projectSlug: string;
  stage: ProductionStepKey;
  title: string;
  status: PipelineJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PipelineJobList {
  projectSlug: string;
  jobs: PipelineJob[];
  createdAt: string;
  updatedAt: string;
}
