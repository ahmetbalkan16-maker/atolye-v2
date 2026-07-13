import type { ProductionExecutionAttemptOpenRequest, ProductionExecutionAttemptPolicy, ProductionExecutionAttemptReasonCode, ProductionExecutionAttemptResult, ProductionExecutionDurableAttemptRecord } from "./productionExecutionDurableAttempt";
import type { ProductionExecutionClaimPolicy, ProductionExecutionClaimReasonCode, ProductionExecutionClaimRequest } from "./productionExecutionDurableClaim";
import type { ProductionExecutionDurableLeaseReasonCode } from "./productionExecutionDurableLease";

export const productionExecutionCoordinatorSchemaVersion = "1" as const;

export type ProductionExecutionCoordinatorStage = "claim" | "lease" | "attempt";
export type ProductionExecutionCoordinatorReasonCode = ProductionExecutionClaimReasonCode | ProductionExecutionDurableLeaseReasonCode | ProductionExecutionAttemptReasonCode;

export interface ProductionExecutionCoordinatorRequest {
  claim: ProductionExecutionClaimRequest;
  attempt: ProductionExecutionAttemptOpenRequest;
}

export interface ProductionExecutionCoordinatorPolicy {
  claim: ProductionExecutionClaimPolicy;
  attempt: ProductionExecutionAttemptPolicy;
}

export interface ProductionExecutionCoordinatorResult {
  schemaVersion: typeof productionExecutionCoordinatorSchemaVersion;
  ok: boolean;
  decision: "opened" | "replayed" | "deny" | "recovery-required" | "indeterminate";
  stage: ProductionExecutionCoordinatorStage;
  reasonCode: ProductionExecutionCoordinatorReasonCode;
  attempt?: ProductionExecutionDurableAttemptRecord;
  attemptResult?: ProductionExecutionAttemptResult;
  writeFree: boolean;
  evidence: readonly string[];
}

