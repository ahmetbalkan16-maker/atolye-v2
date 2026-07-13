import type { PipelineDependencyStatus, PipelineRecoveryStageKey } from "./pipelineRecovery";

export const productionExecutionRecoveryBootstrapSchemaVersion = "1" as const;

export type ProductionExecutionRecoveryBootstrapClassification =
  | "active"
  | "running"
  | "terminal"
  | "orphaned"
  | "expired-lease"
  | "replayable";

export type ProductionExecutionRecoveryBootstrapAction =
  | "resume-through-coordinator-worker"
  | "recover-expired-lease"
  | "wait-for-owner"
  | "manual-recovery"
  | "skip-terminal";

export interface ProductionExecutionRecoveryBootstrapRequest {
  evaluatedAt: string;
}

export interface ProductionExecutionRecoveryBootstrapAttempt {
  attemptId: string;
  state: "opened" | "active" | "outcome-proposed" | "succeeded" | "failed" | "cancelled" | "abandoned" | "unknown";
  primaryClassification: ProductionExecutionRecoveryBootstrapClassification;
  classifications: readonly ProductionExecutionRecoveryBootstrapClassification[];
  action: ProductionExecutionRecoveryBootstrapAction;
  reasonCode: string;
  attemptVersion: number;
  journalSequence: number;
  journalValid: boolean;
  versionChainValid: boolean;
  recoveryCandidate: boolean;
  terminal: boolean;
  projectSlug?: string;
  stage?: PipelineRecoveryStageKey;
  ownership?: { claimId: string; leaseId: string; workerId: string; workerSessionId: string };
  evidence: readonly string[];
}

export interface ProductionExecutionRecoveryBootstrapPlannerPlan {
  attemptId: string;
  projectSlug: string;
  stage: PipelineRecoveryStageKey;
  type: "retry";
  startStage: PipelineRecoveryStageKey | null;
  stagesToRun: readonly PipelineRecoveryStageKey[];
  blocked: boolean;
  reason?: string;
  dependencies: readonly PipelineDependencyStatus[];
  fingerprint: string;
}

export interface ProductionExecutionRecoveryBootstrapResult {
  schemaVersion: typeof productionExecutionRecoveryBootstrapSchemaVersion;
  bootstrapId: string;
  evaluatedAt: string;
  decision: "ready" | "recovery-required" | "indeterminate";
  writeFree: true;
  attempts: readonly ProductionExecutionRecoveryBootstrapAttempt[];
  plannerPlans: readonly ProductionExecutionRecoveryBootstrapPlannerPlan[];
  counts: Readonly<Record<ProductionExecutionRecoveryBootstrapClassification, number>>;
  evidence: readonly string[];
}

