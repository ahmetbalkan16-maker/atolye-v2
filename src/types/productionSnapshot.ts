import type { AIUsageStatus } from "./aiUsage";
import type { PipelineJobHistoryStatus, PipelineJobStatus } from "./pipelineJob";
import type {
  PackageStatus,
  ProductionStepKey,
  ProjectPackageRunType,
  ProjectPackageUsage,
  ProjectStatus,
} from "./project";

export const productionSnapshotSchemaVersion = 1 as const;

export type SnapshotValue<T> =
  | { state: "known"; value: T }
  | {
      state:
        | "not_recorded"
        | "source_missing"
        | "source_malformed"
        | "source_unreadable"
        | "inconsistent"
        | "not_applicable";
      reason?: string;
    };

export type ProductionSnapshotSourceName =
  | "project"
  | "manifest"
  | "jobs"
  | "history"
  | "aiUsage"
  | "stageOutputs";

export type ProductionSnapshotSourceStatus =
  | "available"
  | "missing"
  | "malformed"
  | "unreadable"
  | "stale"
  | "partial";

export interface ProductionSnapshotSourceState {
  status: ProductionSnapshotSourceStatus;
  updatedAt?: string;
  detail?: string;
}

export type ProjectCompletionConsistency =
  | "consistent_completed"
  | "consistent_incomplete"
  | "project_completed_manifest_not_completed"
  | "project_incomplete_manifest_completed"
  | "manifest_status_unknown";

export type EffectiveStageStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "missing"
  | "inconsistent"
  | "unknown";

export interface ProductionSnapshotProject {
  projectSlug: string;
  projectStatus: SnapshotValue<ProjectStatus>;
  isCompleted: SnapshotValue<boolean>;
  projectUpdatedAt: SnapshotValue<string>;
  manifestProjectStatus: SnapshotValue<ProjectStatus>;
  completionConsistency: ProjectCompletionConsistency;
}

export interface ProductionSnapshotPipeline {
  effectiveStatus: EffectiveStageStatus;
  completedStageCount: number;
  totalStageCount: number;
  failedStageCount: number;
  cancelledStageCount: number;
  queuedStageCount: number;
  runningStageCount: number;
  nextRunnableStage: SnapshotValue<ProductionStepKey>;
  blockedStage: SnapshotValue<ProductionStepKey>;
  isTerminal: boolean;
  hasActiveWork: boolean;
}

export interface ProductionSnapshotStage {
  stage: ProductionStepKey;
  manifestStatus: SnapshotValue<PackageStatus>;
  jobStatus: SnapshotValue<PipelineJobStatus>;
  effectiveStatus: EffectiveStageStatus;
  startedAt: SnapshotValue<string>;
  completedAt: SnapshotValue<string>;
  durationMs: SnapshotValue<number>;
  attempts: SnapshotValue<number>;
  retries: SnapshotValue<number>;
  lastRunType: SnapshotValue<ProjectPackageRunType>;
  dependencyReady: SnapshotValue<boolean>;
  outputReady: SnapshotValue<boolean>;
  latestJobId: SnapshotValue<string>;
  latestError: SnapshotValue<string>;
  latestUsage: SnapshotValue<ProjectPackageUsage>;
  consistency: ProductionSnapshotConsistencyFinding[];
}

export interface ProductionSnapshotQueue {
  derivedFrom: "jobs";
  queued: ProductionStepKey[];
  running: ProductionStepKey[];
  failed: ProductionStepKey[];
  cancelled: ProductionStepKey[];
  nextCandidate: SnapshotValue<ProductionStepKey>;
  blockedReason: SnapshotValue<string>;
  hasConflict: boolean;
  multipleRunningDetected: boolean;
}

export interface ProductionSnapshotStageHistorySummary {
  stage: ProductionStepKey;
  completedEvents: number;
  failedEvents: number;
  cancelledEvents: number;
  latestStatus: SnapshotValue<PipelineJobHistoryStatus>;
  latestEventAt: SnapshotValue<string>;
}

export interface ProductionSnapshotHistory {
  totalTerminalEvents: number;
  completedEvents: number;
  failedEvents: number;
  cancelledEvents: number;
  latestEventAt: SnapshotValue<string>;
  averageCompletedDurationMs: SnapshotValue<number>;
  successRate: SnapshotValue<number>;
  perStageSummary: Record<
    ProductionStepKey,
    ProductionSnapshotStageHistorySummary
  >;
}

export interface ProductionSnapshotDistribution {
  name: string;
  count: number;
}

export interface ProductionSnapshotCoverageMetric {
  value: SnapshotValue<number>;
  recordedRecords: number;
  totalRecords: number;
  coverage: number;
}

export interface ProductionSnapshotUsage {
  totalRequests: number;
  successfulRequests: number;
  fallbackRequests: number;
  failedRequests: number;
  totalDurationMs: number;
  providerDistribution: ProductionSnapshotDistribution[];
  modelDistribution: ProductionSnapshotDistribution[];
  availableInputTokens: ProductionSnapshotCoverageMetric;
  availableOutputTokens: ProductionSnapshotCoverageMetric;
  availableTotalTokens: ProductionSnapshotCoverageMetric;
  availableEstimatedCost: ProductionSnapshotCoverageMetric;
  tokenCoverage: number;
  costCoverage: number;
  latestUsageAt: SnapshotValue<string>;
  latestStatus: SnapshotValue<AIUsageStatus>;
}

export type ProductionSnapshotFindingSeverity =
  | "info"
  | "warning"
  | "critical";

export type ProductionSnapshotFindingScope =
  | "project"
  | "pipeline"
  | "stage"
  | "queue"
  | "history"
  | "usage"
  | "source";

export type ProductionSnapshotFindingCode =
  | "project_manifest_status_mismatch"
  | "manifest_job_status_mismatch"
  | "completed_stage_missing_output"
  | "multiple_running_jobs"
  | "completed_project_with_active_jobs"
  | "export_completed_project_not_completed"
  | "project_completed_export_not_completed"
  | "source_missing"
  | "source_malformed"
  | "source_unreadable"
  | "usage_data_partial";

export type ProductionSnapshotFindingEvidenceValue =
  | string
  | number
  | boolean
  | null;

export interface ProductionSnapshotConsistencyFinding {
  code: ProductionSnapshotFindingCode;
  severity: ProductionSnapshotFindingSeverity;
  scope: ProductionSnapshotFindingScope;
  stage?: ProductionStepKey;
  sources: ProductionSnapshotSourceName[];
  message: string;
  evidence: Record<string, ProductionSnapshotFindingEvidenceValue>;
  detectedAt: string;
}

export interface ProductionSnapshotSourceStates {
  project: ProductionSnapshotSourceState;
  manifest: ProductionSnapshotSourceState;
  jobs: ProductionSnapshotSourceState;
  history: ProductionSnapshotSourceState;
  aiUsage: ProductionSnapshotSourceState;
  stageOutputs: Record<ProductionStepKey, ProductionSnapshotSourceState>;
}

export interface ProductionSnapshot {
  schemaVersion: typeof productionSnapshotSchemaVersion;
  generatedAt: string;
  project: ProductionSnapshotProject;
  pipeline: ProductionSnapshotPipeline;
  stages: ProductionSnapshotStage[];
  queue: ProductionSnapshotQueue;
  history: ProductionSnapshotHistory;
  usage: ProductionSnapshotUsage;
  findings: ProductionSnapshotConsistencyFinding[];
  sourceState: ProductionSnapshotSourceStates;
}
