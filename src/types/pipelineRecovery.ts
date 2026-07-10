import type { PackageStatus, ProductionStepKey } from "./project";

export type PipelineRecoveryStageKey = ProductionStepKey;

export type PipelineRecoveryPlanType = "resume" | "retry";

export interface PipelineDependencyStatus {
  stage: PipelineRecoveryStageKey;
  status: PackageStatus | "unknown";
  completed: boolean;
  fileReady: boolean;
  ready: boolean;
  reason?: string;
}

export interface PipelineRecoveryPlan {
  projectSlug: string;
  type: PipelineRecoveryPlanType;
  startStage: PipelineRecoveryStageKey | null;
  stagesToRun: PipelineRecoveryStageKey[];
  blocked: boolean;
  reason?: string;
  dependencies: PipelineDependencyStatus[];
  createdAt: string;
}

export interface PipelineResumeResult {
  success: boolean;
  projectSlug: string;
  resumedFrom: PipelineRecoveryStageKey | null;
  completedStages: PipelineRecoveryStageKey[];
  blocked: boolean;
  reason?: string;
  plan: PipelineRecoveryPlan;
}

export interface PipelineRetryResult {
  success: boolean;
  projectSlug: string;
  retriedStage: PipelineRecoveryStageKey;
  completedStages: PipelineRecoveryStageKey[];
  blocked: boolean;
  reason?: string;
  plan: PipelineRecoveryPlan;
}

export interface PipelineJobRetryExecutionResult {
  success: boolean;
  status: 200 | 404 | 409;
  projectSlug: string;
  jobId: string;
  retriedStage?: PipelineRecoveryStageKey;
  completedStages: PipelineRecoveryStageKey[];
  blocked: boolean;
  reason?: string;
  plan?: PipelineRecoveryPlan;
}
