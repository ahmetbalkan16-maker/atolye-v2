import { AdapterBackedProductionExecutionAttemptService } from "./ProductionExecutionDurableAttempt";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionLifecycleMutationRequest, ProductionExecutionLifecyclePolicy, ProductionExecutionLifecycleReasonCode, ProductionExecutionLifecycleResult } from "@/types/productionExecutionLifecycle";

export class ProductionExecutionLifecycle {
  private readonly attempts: AdapterBackedProductionExecutionAttemptService;
  constructor(adapter: ProductionExecutionPersistenceAdapter) { this.attempts = new AdapterBackedProductionExecutionAttemptService(adapter); }

  async mutate(request: ProductionExecutionLifecycleMutationRequest, policy: ProductionExecutionLifecyclePolicy): Promise<ProductionExecutionLifecycleResult> {
    const result = await this.attempts.transitionExecutionLifecycle(request, policy.attempt);
    const reasonCode = mapReason(result.reasonCode);
    return { schemaVersion: "1", ok: result.ok, decision: result.ok ? (result.decision === "replayed" ? "replayed" : "applied") : reasonCode === "LIFECYCLE_INDETERMINATE" ? "indeterminate" : "deny", reasonCode, ...(result.ok ? { state: request.transition } : {}), ...(result.attempt ? { attempt: result.attempt } : {}), writeFree: result.decision === "replayed" || !result.ok, evidence: [`reason:${reasonCode}`] };
  }
}

function mapReason(reason: string): ProductionExecutionLifecycleReasonCode {
  const mapped: Record<string, ProductionExecutionLifecycleReasonCode> = {
    JOURNAL_ENTRY_APPENDED: "LIFECYCLE_TRANSITION_APPLIED", JOURNAL_ENTRY_REPLAYED: "LIFECYCLE_TRANSITION_REPLAYED", JOURNAL_ENTRY_ID_CONFLICT: "LIFECYCLE_EVENT_ID_CONFLICT",
    ATTEMPT_STALE_WRITE: "LIFECYCLE_STALE_WRITE", ATTEMPT_VERSION_CONFLICT: "LIFECYCLE_VERSION_CONFLICT", JOURNAL_FINALIZED_ATTEMPT: "LIFECYCLE_TERMINAL_ATTEMPT",
    ATTEMPT_TRANSITION_INVALID: "LIFECYCLE_TRANSITION_INVALID", ATTEMPT_CLAIM_CONFLICT: "LIFECYCLE_CLAIM_MISMATCH", ATTEMPT_OWNER_MISMATCH: "LIFECYCLE_WORKER_MISMATCH",
    ATTEMPT_SESSION_MISMATCH: "LIFECYCLE_SESSION_MISMATCH", ATTEMPT_LEASE_MISMATCH: "LIFECYCLE_LEASE_MISMATCH", ATTEMPT_INDETERMINATE: "LIFECYCLE_INDETERMINATE",
  };
  return mapped[reason] ?? "LIFECYCLE_VALIDATION_FAILED";
}

