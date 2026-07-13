import type { ProductionWorkerLifecycleState } from "./productionWorkerLifecycle";

export const productionRuntimeStatusSchemaVersion = "1" as const;

export interface ProductionRuntimeInitializationFailureStatus {
  readonly reasonCode: string;
  readonly failedProjectSlug?: string;
}

export interface ProductionRuntimeStatus {
  readonly schemaVersion: typeof productionRuntimeStatusSchemaVersion;
  readonly writeFree: true;
  readonly lifecycleState: ProductionWorkerLifecycleState;
  readonly activeExecutionCount: number;
  readonly acceptingExecutions: boolean;
  readonly initialized: boolean;
  readonly recoveryCompleted: boolean;
  readonly workerReady: boolean;
  readonly draining: boolean;
  readonly startupTimestamp: string | null;
  readonly lastStateTransitionTimestamp: string | null;
  readonly initializationFailure: ProductionRuntimeInitializationFailureStatus | null;
}
