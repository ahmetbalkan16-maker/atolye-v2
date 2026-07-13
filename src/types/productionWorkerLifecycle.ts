import type { ProductionRuntimeInitializationSuccess } from "./productionRuntimeInitialization";

export const productionWorkerLifecycleSchemaVersion = "1" as const;

export type ProductionWorkerLifecycleState = "created" | "starting" | "ready" | "draining" | "stopped" | "failed";
export type ProductionWorkerLifecycleReasonCode =
  | "WORKER_LIFECYCLE_STARTED"
  | "WORKER_LIFECYCLE_START_REPLAYED"
  | "WORKER_LIFECYCLE_DRAINING"
  | "WORKER_LIFECYCLE_DRAIN_REPLAYED"
  | "WORKER_LIFECYCLE_STOPPED"
  | "WORKER_LIFECYCLE_STOP_REPLAYED"
  | "WORKER_LIFECYCLE_NOT_READY"
  | "WORKER_LIFECYCLE_START_INVALID"
  | "WORKER_LIFECYCLE_TRANSITION_INVALID"
  | "WORKER_LIFECYCLE_FAILED";

export interface ProductionWorkerLifecycleSnapshot {
  schemaVersion: typeof productionWorkerLifecycleSchemaVersion;
  state: ProductionWorkerLifecycleState;
  activeExecutions: number;
  acceptingExecutions: boolean;
  initializedAt?: string;
  failureReasonCode?: string;
}

export interface ProductionWorkerLifecycleResult {
  schemaVersion: typeof productionWorkerLifecycleSchemaVersion;
  ok: boolean;
  decision: "started" | "draining" | "stopped" | "replayed" | "deny" | "failed";
  reasonCode: ProductionWorkerLifecycleReasonCode;
  snapshot: ProductionWorkerLifecycleSnapshot;
  evidence: readonly string[];
}

export interface ProductionWorkerLifecycleStartRequest {
  initialization: ProductionRuntimeInitializationSuccess;
}

