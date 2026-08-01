import { ProjectReader } from "@/lib/projects/ProjectReader";
import type { PipelineJob } from "@/types/pipelineJob";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionAttemptService,
  defaultProductionExecutionAttemptPolicy } from "./ProductionExecutionDurableAttempt";
import { defaultProductionExecutionClaimPolicy } from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionDurableLeasePolicy } from "./ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionDurableStorage,
} from "./ProductionExecutionDurableStorage";
import { defaultProductionExecutionIdempotencyPolicy } from "./ProductionExecutionIdempotency";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { validateProductionExecutionPersistencePayload } from
  "./ProductionExecutionPersistence";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { settleFailedProductionPipelineExecution } from "./ProductionPipelineTerminalSettlement";
import { classifyProductionDurableAttemptLineage } from
  "./ProductionDurableAttemptLineageClassifier";
import type { PipelineRetryReconciledLineageBinding } from
  "@/lib/pipeline/PipelineRetryAdmission";

const reconciliationTtlSeconds = 31_536_000;

export type ProductionPipelineRetryReconciliationReasonCode =
  | "PIPELINE_RETRY_RECONCILED"
  | "PIPELINE_RETRY_RECONCILIATION_REPLAYED"
  | "PIPELINE_RETRY_DURABLE_STATE_MISSING"
  | "PIPELINE_RETRY_DURABLE_CONFLICT"
  | "PIPELINE_RETRY_MAX_ATTEMPTS_EXCEEDED"
  | "PIPELINE_RETRY_QUEUED_EXHAUSTED_DRIFT_DETECTED"
  | "PIPELINE_RETRY_LEASE_CLEANUP_FAILED"
  | "PIPELINE_RETRY_CLAIM_CLEANUP_FAILED"
  | "PIPELINE_RETRY_IDEMPOTENCY_CONFLICT"
  | "PIPELINE_RETRY_COMPENSATION_FAILED";

export interface ProductionPipelineRetryReconciliationResult {
  readonly ok: boolean;
  readonly reasonCode: ProductionPipelineRetryReconciliationReasonCode;
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
  readonly lineageIdentity?: ReturnType<typeof buildProductionPipelineExecutionIdentity>;
  readonly lineageBinding?: PipelineRetryReconciledLineageBinding;
}

/** Close the previous durable execution before a failed job is queued again. */
export async function reconcileFailedPipelineExecution(
  job: PipelineJob,
  now: () => string = () => new Date().toISOString(),
  /** @internal Isolated-test dependency seam; production callers never provide it. */
  dependencies: {
    createAdapter?: (trustedRootDirectory: string) => ProductionExecutionPersistenceAdapter;
  } = {},
): Promise<ProductionPipelineRetryReconciliationResult> {
  if (job.status !== "failed") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", "job:not-failed");
  }

  const durableAttemptOrdinal = job.attempts;
  const identity = buildProductionPipelineExecutionIdentity(
    {
      projectSlug: job.projectSlug,
      stage: job.stage,
      runType: durableAttemptOrdinal === 0 ? "initial" : "retry",
    },
    { id: job.id, attempts: durableAttemptOrdinal },
  );
  const trustedRootDirectory =
    `${ProjectReader.getProjectFolder(job.projectSlug)}/production-execution`;
  const adapter = dependencies.createAdapter?.(trustedRootDirectory) ??
    new ProductionExecutionFilePersistenceAdapter({
      trustedRootDirectory,
      createRootDirectory: false,
    });
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const attempts = new AdapterBackedProductionExecutionAttemptService(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const evaluatedAt = now();

  const [recordReadResult, attemptAssessmentResult, claimAssessmentResult,
    lineageAssessmentResult] = await Promise.allSettled([
    storage.read(identity.recordId),
    attempts.evaluateExecutionAttemptRecovery(identity.attemptId, evaluatedAt),
    claims.evaluateExecutionClaimRecovery(identity.claimId, evaluatedAt),
    classifyProductionDurableAttemptLineage(
      adapter, job.projectSlug, job.stage, durableAttemptOrdinal, "exact",
    ),
  ]);
  if (recordReadResult.status === "rejected" || attemptAssessmentResult.status === "rejected" ||
    claimAssessmentResult.status === "rejected" || lineageAssessmentResult.status === "rejected" ||
    lineageAssessmentResult.value.status === "invalid") {
    if (lineageAssessmentResult.status === "fulfilled" &&
      lineageAssessmentResult.value.status === "invalid") {
      return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING",
        `durable:${lineageAssessmentResult.value.boundary}`);
    }
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:partial");
  }
  const lineageResult = lineageAssessmentResult.value;
  const recordRead = recordReadResult.value;
  const attemptAssessment = attemptAssessmentResult.value;
  const claimAssessment = claimAssessmentResult.value;
  const noRecord = !recordRead.record && recordRead.reasonCode === "DURABLE_STORAGE_RECORD_MISSING";
  const noAttempt = attemptAssessment.classification === "no-attempt";
  const noClaim = claimAssessment.classification === "no-claim";

  if (noRecord && noAttempt && noClaim) {
    if (lineageResult.status === "none" && job.attempts === 0) {
      return success("PIPELINE_RETRY_RECONCILIATION_REPLAYED", true, "durable:none", identity,
        { state: "none", operation: identity.core.attemptNumber === 0
          ? "pipeline.stage.initial" : "pipeline.stage.retry",
        durableOrdinal: job.attempts + 1, maxAttempts: 3, reservationId: "none",
        workerId: "none", workerSessionId: "none", recordVersion: 0,
        reservationVersion: 0, claimVersion: 0, attemptVersion: 0, leaseVersion: 0,
        reservationIdentityFingerprint: "none", recordIntegrityFingerprint: "none",
        recordIntegrityVersion: 0, leaseIntegrityFingerprint: "none",
        claimIntegrityFingerprint: "none", attemptIntegrityFingerprint: "none" });
    }
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:no-exact-lineage");
  }
  if (!recordRead.record || !attemptAssessment.attempt || !claimAssessment.claim) {
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:partial");
  }
  if (attemptAssessment.attempt.state !== "failed") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT",
      `durable:attempt:${attemptAssessment.classification}`);
  }

  const record = recordRead.record;
  const attempt = attemptAssessment.attempt;
  const claim = claimAssessment.claim;
  const lease = record.durableLease;
  if (!lease || !attempt.finalizedAt) {
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:terminal-binding-missing");
  }
  const worker = { schemaVersion: "1" as const, workerId: lease.identity.workerId,
    workerType: "server" as const, operationScope: [record.operation],
    identitySource: "trusted-server" as const };
  const session = { schemaVersion: "1" as const,
    workerSessionId: lease.identity.workerSessionId, workerId: lease.identity.workerId,
    startedAt: lease.acquiredAt, identitySource: "trusted-server" as const };
  const idempotencyPolicy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true,
    reservationTtlSeconds: reconciliationTtlSeconds, leaseTtlSeconds: reconciliationTtlSeconds };
  const request = {
    coordinator: {
      claim: {
        claimId: claim.identity.claimId, recordId: record.recordId,
        reservationId: attempt.identity.reservationId, requestId: record.requestId,
        idempotencyKey: record.idempotencyKey, operation: record.operation,
        executionFingerprint: record.executionFingerprint, workerId: attempt.identity.workerId,
        workerSessionId: attempt.identity.workerSessionId, leaseId: attempt.identity.leaseId,
        expectedReservationVersion: attempt.binding.reservationVersion,
        expectedIdempotencyVersion: claim.binding.idempotencyVersion,
        expectedLeaseVersion: attempt.binding.leaseVersion,
        expectedClaimVersion: Math.max(0, claim.claimVersion - 1), evaluatedAt,
      },
      attempt: { ...attempt.identity, expectedClaimVersion: attempt.binding.claimVersion,
        expectedAttemptVersion: attempt.attemptVersion, evaluatedAt },
    },
    policy: {
      claim: { ...defaultProductionExecutionClaimPolicy,
        reservationTtlSeconds: reconciliationTtlSeconds },
      attempt: { ...defaultProductionExecutionAttemptPolicy,
        reservationTtlSeconds: reconciliationTtlSeconds },
    },
    runningAt: attempt.openedAt,
    finishedAt: evaluatedAt,
    runningEventId: attempt.journal.find((entry) => entry.payload.code === "WORKER_RUNNING")?.entryId ??
      `${attempt.identity.attemptId}-running`,
    terminalEventId: attempt.journal.at(-1)?.entryId ?? `${attempt.identity.attemptId}-terminal`,
  };
  const settled = await settleFailedProductionPipelineExecution({
    adapter,
    request,
    idempotencyPolicy,
    leasePolicy: { ...defaultProductionExecutionDurableLeasePolicy,
      reservationTtlSeconds: reconciliationTtlSeconds,
      minimumLeaseDurationSeconds: 1,
      maximumLeaseDurationSeconds: reconciliationTtlSeconds,
      maximumRenewalWindowSeconds: reconciliationTtlSeconds },
    worker,
    session,
    expectedProjectSlug: job.projectSlug,
    expectedStage: job.stage,
  }, {
    schemaVersion: "1", ok: true, decision: "replayed",
    reasonCode: "WORKER_EXECUTION_REPLAYED", status: "failed", attempt,
    handlerCalled: false, writeFree: true, evidence: ["reason:WORKER_EXECUTION_REPLAYED"],
  });
  if (!settled.ok) {
    return failure(mapSettlementFailure(settled.reasonCode),
      `settlement:${settled.reasonCode}:${settled.causeReasonCode ?? "unknown"}:` +
      `${settled.failedBoundary ?? "unknown"}`,
      settled.writeFree);
  }
  const [finalRecord, finalAttempt, finalClaim, finalReservationRead] = await Promise.all([
    storage.read(identity.recordId),
    attempts.evaluateExecutionAttemptRecovery(identity.attemptId, evaluatedAt),
    claims.evaluateExecutionClaimRecovery(identity.claimId, evaluatedAt),
    adapter.read("reservation", attempt.identity.reservationId),
  ]);
  if (!finalRecord.record || !finalAttempt.attempt || !finalClaim.claim ||
    !finalRecord.record.durableLease || finalReservationRead.status !== "found" ||
    !validateProductionExecutionPersistencePayload("reservation", finalReservationRead.value)) {
    return failure("PIPELINE_RETRY_DURABLE_STATE_MISSING", "durable:final-binding-missing");
  }
  const finalLease = finalRecord.record.durableLease;
  const finalReservation = finalReservationRead.value;
  return success(settled.writeFree ? "PIPELINE_RETRY_RECONCILIATION_REPLAYED" :
    "PIPELINE_RETRY_RECONCILED", settled.writeFree, "attempt:immutable", identity, {
      state: "terminal", operation: finalRecord.record.operation,
      durableOrdinal: finalRecord.record.attempt, maxAttempts: finalRecord.record.maxAttempts,
      reservationId: finalAttempt.attempt.identity.reservationId,
      workerId: finalAttempt.attempt.identity.workerId,
      workerSessionId: finalAttempt.attempt.identity.workerSessionId,
      recordVersion: finalRecord.record.recordVersion,
      reservationVersion: finalAttempt.attempt.binding.reservationVersion,
      claimVersion: finalClaim.claim.claimVersion,
      attemptVersion: finalAttempt.attempt.attemptVersion,
      leaseVersion: finalLease.version,
      reservationIdentityFingerprint: finalReservation.identity.identityFingerprint,
      recordIntegrityFingerprint: finalRecord.record.integrity.fingerprint,
      recordIntegrityVersion: finalRecord.record.integrity.version,
      leaseIntegrityFingerprint: finalLease.integrity.fingerprint,
      claimIntegrityFingerprint: finalClaim.claim.integrity.fingerprint,
      attemptIntegrityFingerprint: finalAttempt.attempt.integrity.fingerprint,
    });
}

function mapSettlementFailure(reasonCode: string): Exclude<
ProductionPipelineRetryReconciliationReasonCode,
"PIPELINE_RETRY_RECONCILED" | "PIPELINE_RETRY_RECONCILIATION_REPLAYED"> {
  if (reasonCode === "PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED") {
    return "PIPELINE_RETRY_LEASE_CLEANUP_FAILED";
  }
  if (reasonCode === "PIPELINE_FAILED_SETTLEMENT_CLAIM_CLOSE_FAILED") {
    return "PIPELINE_RETRY_CLAIM_CLEANUP_FAILED";
  }
  if (reasonCode === "PIPELINE_FAILED_SETTLEMENT_RECORD_TERMINALIZATION_FAILED") {
    return "PIPELINE_RETRY_IDEMPOTENCY_CONFLICT";
  }
  return "PIPELINE_RETRY_COMPENSATION_FAILED";
}

function success(
  reasonCode: "PIPELINE_RETRY_RECONCILED" | "PIPELINE_RETRY_RECONCILIATION_REPLAYED",
  writeFree: boolean,
  evidence: string,
  lineageIdentity: ReturnType<typeof buildProductionPipelineExecutionIdentity>,
  lineageBinding: PipelineRetryReconciledLineageBinding,
): ProductionPipelineRetryReconciliationResult {
  return { ok: true, reasonCode, writeFree, evidence: [`reason:${reasonCode}`, evidence],
    lineageIdentity, lineageBinding };
}

function failure(
  reasonCode: Exclude<ProductionPipelineRetryReconciliationReasonCode, "PIPELINE_RETRY_RECONCILED" | "PIPELINE_RETRY_RECONCILIATION_REPLAYED">,
  evidence: string,
  writeFree = true,
): ProductionPipelineRetryReconciliationResult {
  return { ok: false, reasonCode, writeFree, evidence: [`reason:${reasonCode}`, evidence] };
}
