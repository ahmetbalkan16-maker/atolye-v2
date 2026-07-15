import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { PipelineJob } from "@/types/pipelineJob";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionAttemptService } from "./ProductionExecutionDurableAttempt";
import {
  AdapterBackedProductionExecutionDurableLeaseService,
  defaultProductionExecutionDurableLeasePolicy,
} from "./ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionDurableStorage,
} from "./ProductionExecutionDurableStorage";
import { defaultProductionExecutionIdempotencyPolicy } from "./ProductionExecutionIdempotency";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";

const reconciliationTtlSeconds = 31_536_000;

export type ProductionPipelineRetryReconciliationReasonCode =
  | "PIPELINE_RETRY_RECONCILED"
  | "PIPELINE_RETRY_RECONCILIATION_REPLAYED"
  | "PIPELINE_RETRY_DURABLE_STATE_MISSING"
  | "PIPELINE_RETRY_DURABLE_CONFLICT"
  | "PIPELINE_RETRY_LEASE_CLEANUP_FAILED"
  | "PIPELINE_RETRY_CLAIM_CLEANUP_FAILED"
  | "PIPELINE_RETRY_IDEMPOTENCY_CONFLICT"
  | "PIPELINE_RETRY_COMPENSATION_FAILED";

export interface ProductionPipelineRetryReconciliationResult {
  readonly ok: boolean;
  readonly reasonCode: ProductionPipelineRetryReconciliationReasonCode;
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
}

/** Close the previous durable execution before a failed job is queued again. */
export async function reconcileFailedPipelineExecution(
  job: PipelineJob,
  now: () => string = () => new Date().toISOString(),
): Promise<ProductionPipelineRetryReconciliationResult> {
  if (job.status !== "failed") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", "job:not-failed");
  }

  const identity = buildProductionPipelineExecutionIdentity(
    {
      projectSlug: job.projectSlug,
      stage: job.stage,
      runType: job.attempts === 0 ? "initial" : "retry",
    },
    { id: job.id, attempts: job.attempts },
  );
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: `${ProjectReader.getProjectFolder(job.projectSlug)}/production-execution`,
    createRootDirectory: false,
  });
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  const evaluatedAt = now();

  const [recordRead, attemptAssessment, claimAssessment] = await Promise.all([
    storage.read(identity.recordId),
    attempts.evaluateExecutionAttemptRecovery(identity.attemptId, evaluatedAt),
    claims.evaluateExecutionClaimRecovery(identity.claimId, evaluatedAt),
  ]);
  const noRecord = !recordRead.record && recordRead.reasonCode === "DURABLE_STORAGE_RECORD_MISSING";
  const noAttempt = attemptAssessment.classification === "no-attempt";
  const noClaim = claimAssessment.classification === "no-claim";

  if (noRecord && noAttempt && noClaim) {
    return success("PIPELINE_RETRY_RECONCILIATION_REPLAYED", true, "durable:none");
  }
  if (!recordRead.record || !attemptAssessment.attempt || !claimAssessment.claim) {
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:partial");
  }
  if (attemptAssessment.attempt.state !== "failed") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", `attempt:${attemptAssessment.classification}`);
  }

  let wrote = false;
  let record = recordRead.record;
  const lease = record.durableLease;
  if (!lease) return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "lease:missing");
  if (lease.status === "active") {
    const released = await leases.release({
      recordId: record.recordId,
      expectedVersion: record.recordVersion,
      evaluatedAt,
      releasedAt: evaluatedAt,
      worker: {
        schemaVersion: "1",
        workerId: lease.identity.workerId,
        workerType: "server",
        operationScope: [record.operation],
        identitySource: "trusted-server",
      },
      session: {
        schemaVersion: "1",
        workerSessionId: lease.identity.workerSessionId,
        workerId: lease.identity.workerId,
        startedAt: lease.acquiredAt,
        identitySource: "trusted-server",
      },
      leaseId: lease.identity.leaseId,
    }, {
      policyVersion: defaultProductionExecutionDurableLeasePolicy.policyVersion,
      reservationTtlSeconds: reconciliationTtlSeconds,
      minimumLeaseDurationSeconds: 1,
      maximumLeaseDurationSeconds: reconciliationTtlSeconds,
      maximumRenewalWindowSeconds: reconciliationTtlSeconds,
    });
    if (!released.ok || !released.record) {
      return failure("PIPELINE_RETRY_LEASE_CLEANUP_FAILED", `lease:${released.reasonCode}`);
    }
    record = released.record;
    wrote = released.decision !== "replayed";
  } else if (lease.status !== "released") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", `lease:${lease.status}`);
  }

  const claim = claimAssessment.claim;
  if (claim.state === "active") {
    const abandoned = await claims.abandonExecutionClaim({
      claimId: claim.identity.claimId,
      workerId: claim.identity.workerId,
      workerSessionId: claim.identity.workerSessionId,
      leaseId: claim.identity.leaseId,
      expectedClaimVersion: claim.claimVersion,
      evaluatedAt,
      reason: "coordination-recovery",
    });
    if (!abandoned.ok) {
      return failure(
        wrote ? "PIPELINE_RETRY_COMPENSATION_FAILED" : "PIPELINE_RETRY_CLAIM_CLEANUP_FAILED",
        `claim:${abandoned.reasonCode}`,
        !wrote,
      );
    }
    wrote ||= abandoned.decision !== "replayed";
  } else if (claim.state !== "abandoned" && claim.state !== "released") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", `claim:${claim.state}`);
  }

  const latest = await storage.read(record.recordId);
  if (!latest.record) {
    return failure("PIPELINE_RETRY_IDEMPOTENCY_CONFLICT", `record:${latest.reasonCode}`);
  }
  record = latest.record;
  if (record.state === "reserved") {
    const idempotencyPolicy = {
      ...defaultProductionExecutionIdempotencyPolicy,
      enabled: true,
      reservationTtlSeconds: reconciliationTtlSeconds,
      leaseTtlSeconds: reconciliationTtlSeconds,
    };
    const released = await storage.releaseReservation(record.recordId, {
      schemaVersion: "1",
      recordId: record.recordId,
      idempotencyKey: record.idempotencyKey,
      fromState: "reserved",
      toState: "cancelled",
      expectedVersion: record.recordVersion,
      attempt: record.attempt,
      transitionedAt: evaluatedAt,
      actorId: record.actorId,
      reasonCode: "PIPELINE_RETRY_RECONCILIATION",
      recovery: {
        mode: "reconcile",
        previousRecordId: record.recordId,
        confirmationSingleUseConsumed: false,
      },
      evidence: ["pipeline-retry:failed-attempt", "reconciliation:forward-only"],
    }, { evaluatedAt, policy: idempotencyPolicy });
    if (!released.ok || released.record?.state !== "cancelled") {
      return failure(
        wrote ? "PIPELINE_RETRY_COMPENSATION_FAILED" : "PIPELINE_RETRY_IDEMPOTENCY_CONFLICT",
        `record:${released.reasonCode}`,
        !wrote,
      );
    }
    wrote = true;
  } else if (record.state !== "cancelled" && record.state !== "failed") {
    return failure("PIPELINE_RETRY_IDEMPOTENCY_CONFLICT", `record:${record.state}`);
  }

  const finalAttempt = await attempts.evaluateExecutionAttemptRecovery(identity.attemptId, evaluatedAt);
  const finalClaim = await claims.evaluateExecutionClaimRecovery(identity.claimId, evaluatedAt);
  const finalRecord = await storage.read(identity.recordId);
  if (
    finalAttempt.attempt?.state !== "failed" ||
    finalClaim.claim?.state === "active" ||
    finalRecord.record?.durableLease?.status === "active" ||
    !["cancelled", "failed"].includes(finalRecord.record?.state ?? "")
  ) {
    return failure("PIPELINE_RETRY_COMPENSATION_FAILED", "reconciliation:incomplete", !wrote);
  }

  return success(
    wrote ? "PIPELINE_RETRY_RECONCILED" : "PIPELINE_RETRY_RECONCILIATION_REPLAYED",
    !wrote,
    "attempt:immutable",
  );
}

function success(
  reasonCode: "PIPELINE_RETRY_RECONCILED" | "PIPELINE_RETRY_RECONCILIATION_REPLAYED",
  writeFree: boolean,
  evidence: string,
): ProductionPipelineRetryReconciliationResult {
  return { ok: true, reasonCode, writeFree, evidence: [`reason:${reasonCode}`, evidence] };
}

function failure(
  reasonCode: Exclude<ProductionPipelineRetryReconciliationReasonCode, "PIPELINE_RETRY_RECONCILED" | "PIPELINE_RETRY_RECONCILIATION_REPLAYED">,
  evidence: string,
  writeFree = true,
): ProductionPipelineRetryReconciliationResult {
  return { ok: false, reasonCode, writeFree, evidence: [`reason:${reasonCode}`, evidence] };
}
