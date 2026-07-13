import { AdapterBackedProductionExecutionAttemptService } from "./ProductionExecutionDurableAttempt";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionDurableLeaseService } from "./ProductionExecutionDurableLease";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionCoordinatorPolicy, ProductionExecutionCoordinatorReasonCode, ProductionExecutionCoordinatorRequest, ProductionExecutionCoordinatorResult, ProductionExecutionCoordinatorStage } from "@/types/productionExecutionCoordinator";

export class ProductionExecutionCoordinator {
  private readonly claims: AdapterBackedProductionExecutionClaimService;
  private readonly leases: AdapterBackedProductionExecutionDurableLeaseService;
  private readonly attempts: AdapterBackedProductionExecutionAttemptService;

  constructor(adapter: ProductionExecutionPersistenceAdapter) {
    this.claims = new AdapterBackedProductionExecutionClaimService(adapter);
    this.leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
    this.attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  }

  async coordinate(request: ProductionExecutionCoordinatorRequest, policy: ProductionExecutionCoordinatorPolicy): Promise<ProductionExecutionCoordinatorResult> {
    const claim = await this.claims.preflight(request.claim, policy.claim);
    if (!claim.ok || claim.reasonCode !== "CLAIM_REPLAYED") return denied("claim", claim.reasonCode);

    const lease = await this.leases.evaluate({ recordId: request.claim.recordId, evaluatedAt: request.claim.evaluatedAt, workerId: request.claim.workerId, workerSessionId: request.claim.workerSessionId, leaseId: request.claim.leaseId });
    if (lease.state !== "active") return denied("lease", lease.reasonCode);

    const attempt = await this.attempts.openExecutionAttempt(request.attempt, policy.attempt);
    return {
      schemaVersion: "1", ok: attempt.ok,
      decision: attempt.ok ? (attempt.decision === "replayed" ? "replayed" : "opened") : attempt.decision === "recovery-required" ? "recovery-required" : attempt.decision === "indeterminate" ? "indeterminate" : "deny",
      stage: "attempt", reasonCode: attempt.reasonCode,
      ...(attempt.attempt ? { attempt: attempt.attempt } : {}), attemptResult: attempt,
      writeFree: attempt.reasonCode === "ATTEMPT_REPLAYED",
      evidence: ["stage:attempt", `reason:${attempt.reasonCode}`],
    };
  }
}

function denied(stage: ProductionExecutionCoordinatorStage, reasonCode: ProductionExecutionCoordinatorReasonCode): ProductionExecutionCoordinatorResult {
  const indeterminate = reasonCode.endsWith("_INDETERMINATE"), recoveryRequired = reasonCode.endsWith("_RECOVERY_REQUIRED");
  return { schemaVersion: "1", ok: false, decision: recoveryRequired ? "recovery-required" : indeterminate ? "indeterminate" : "deny", stage, reasonCode, writeFree: true, evidence: [`stage:${stage}`, `reason:${reasonCode}`] };
}

