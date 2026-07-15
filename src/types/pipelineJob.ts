import type { ProductionStepKey } from "./project";
import type { PipelineErrorEvidence } from "./errorEvidence";

export type PipelineJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineJobAction = "cancel" | "retry";
export type PipelineJobHistoryStatus = Extract<
  PipelineJobStatus,
  "completed" | "failed" | "cancelled"
>;

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
  cancelRequestedAt?: string;
  error?: string;
  errorEvidence?: PipelineErrorEvidence;
}

export interface PipelineJobList {
  projectSlug: string;
  jobs: PipelineJob[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineJobHistoryEvent {
  id: string;
  jobId: string;
  stage: ProductionStepKey;
  status: PipelineJobHistoryStatus;
  startedAt?: string;
  completedAt?: string;
  jobCreatedAt: string;
  jobUpdatedAt: string;
  recordedAt: string;
  errorCode?: string;
  errorEvidence?: PipelineErrorEvidence;
}

export interface PipelineJobHistory {
  projectSlug: string;
  events: PipelineJobHistoryEvent[];
  createdAt: string;
  updatedAt: string;
}
