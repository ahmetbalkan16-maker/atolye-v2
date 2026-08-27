import type { PipelineJob } from "@/types/pipelineJob";
import {
  type RuntimeStorageContext,
  getProjectRoot,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionAttemptService,
  defaultProductionExecutionAttemptPolicy } from "./ProductionExecutionDurableAttempt";
import { defaultProductionExecutionClaimPolicy } from "./ProductionExecutionDurableClaim";
import {
  AdapterBackedProductionExecutionDurableLeaseService,
  defaultProductionExecutionDurableLeasePolicy,
} from "./ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionDurableStorage,
} from "./ProductionExecutionDurableStorage";
import { defaultProductionExecutionIdempotencyPolicy } from "./ProductionExecutionIdempotency";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { validateProductionExecutionPersistencePayload } from
  "./ProductionExecutionPersistence";
import type { ProductionExecutionPersistenceAdapter } from
  "@/types/productionExecutionPersistence";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import { regenerationBindingById } from
  "./ProductionCompletedStageRegenerationStore";
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
    storageContext?: RuntimeStorageContext;
  } = {},
): Promise<ProductionPipelineRetryReconciliationResult> {
  const storageContext = dependencies.storageContext ?? resolveRuntimeStorageContext();
  if (job.status !== "failed") {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", "job:not-failed");
  }

  const durableAttemptOrdinal = job.attempts;
  // Resolved directly from the job's own persisted regenerationId (a fixed,
  // already-decided fact) rather than re-derived from durableAttemptOrdinal
  // against the current regeneration roster -- see
  // ProductionDurableIdentityDerivation.ts and this session's forensic
  // report on pipeline-record-1ab478279f9a.../ca987045... for why the latter
  // is unsound once a later regeneration is registered for this stage.
  const regeneration = job.regenerationId
    ? regenerationBindingById(job.projectSlug, job.regenerationId, storageContext)
    : undefined;
  const historicalRunType = regeneration
    ? (job.attemptWithinGeneration === 0 ? "resume" as const : "retry" as const)
    : durableAttemptOrdinal === 0 ? "initial" as const : "retry" as const;
  const identity = buildProductionPipelineExecutionIdentity(
    {
      projectSlug: job.projectSlug,
      stage: job.stage,
      runType: historicalRunType,
      regeneration,
    },
    { id: job.id, attempts: durableAttemptOrdinal },
  );
  const trustedRootDirectory =
    `${getProjectRoot(job.projectSlug, storageContext)}/production-execution`;
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
  if (!attemptAssessment.attempt && claimAssessment.claim && claimAssessment.claim.state === "active") {
    if (claimAssessment.classification === "unbound-orphaned-claim" || claimAssessment.classification === "missing-linked-record") {
      const abandon = await claims.abandonExecutionClaim({
        claimId: claimAssessment.claim.identity.claimId,
        workerId: claimAssessment.claim.identity.workerId,
        workerSessionId: claimAssessment.claim.identity.workerSessionId,
        leaseId: claimAssessment.claim.identity.leaseId,
        expectedClaimVersion: claimAssessment.claim.claimVersion,
        evaluatedAt,
        reason: "coordination-recovery",
      });
      if (abandon.ok && abandon.claim) {
        return success("PIPELINE_RETRY_RECONCILED", false, "claim:orphaned-abandoned", identity, {
          state: "terminal",
          operation: identity.core.attemptNumber === 0 ? "pipeline.stage.initial" : "pipeline.stage.retry",
          durableOrdinal: job.attempts,
          maxAttempts: 3,
          reservationId: claimAssessment.claim.identity.reservationId,
          workerId: claimAssessment.claim.identity.workerId,
          workerSessionId: claimAssessment.claim.identity.workerSessionId,
          recordVersion: recordRead.record?.recordVersion ?? 1,
          reservationVersion: 1,
          claimVersion: abandon.claim.claimVersion,
          attemptVersion: 0,
          leaseVersion: 0,
          reservationIdentityFingerprint: claimAssessment.claim.identity.reservationId,
          recordIntegrityFingerprint: recordRead.record?.integrity.fingerprint ?? "none",
          recordIntegrityVersion: 1,
          leaseIntegrityFingerprint: "none",
          claimIntegrityFingerprint: abandon.claim.integrity.fingerprint,
          attemptIntegrityFingerprint: "none",
        });
      }
    }
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
    storageContext,
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
  const finalRunType = runTypeFromOperation(finalRecord.record.operation);
  if (!finalRunType) {
    return failure("PIPELINE_RETRY_DURABLE_CONFLICT", "durable:operation-invalid");
  }
  const finalIdentity = buildProductionPipelineExecutionIdentity({
    projectSlug: job.projectSlug,
    stage: job.stage,
    runType: finalRunType,
    regeneration,
  }, { id: job.id, attempts: durableAttemptOrdinal });
  return success(settled.writeFree ? "PIPELINE_RETRY_RECONCILIATION_REPLAYED" :
    "PIPELINE_RETRY_RECONCILED", settled.writeFree, "attempt:immutable", finalIdentity, {
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

function runTypeFromOperation(operation: string): "initial" | "retry" | "resume" | undefined {
  if (operation === "pipeline.stage.initial") return "initial";
  if (operation === "pipeline.stage.retry") return "retry";
  if (operation === "pipeline.stage.resume") return "resume";
  return undefined;
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

export type ProductionOrphanReservationRecoveryReasonCode =
  | "ORPHAN_RESERVATION_RECONCILED"
  | "ORPHAN_RESERVATION_RECONCILIATION_REPLAYED"
  | "ORPHAN_RESERVATION_NOT_FOUND"
  | "ORPHAN_RESERVATION_NOT_RESERVED"
  | "ORPHAN_RESERVATION_CLAIM_EXISTS"
  | "ORPHAN_RESERVATION_ATTEMPT_EXISTS"
  | "ORPHAN_RESERVATION_LEASE_RELEASE_FAILED"
  | "ORPHAN_RESERVATION_CANCEL_FAILED"
  | "ORPHAN_RESERVATION_LIST_FAILED";

export interface ProductionOrphanReservationRecoveryResult {
  readonly ok: boolean;
  readonly reasonCode: ProductionOrphanReservationRecoveryReasonCode;
  readonly writeFree: boolean;
  readonly evidence: readonly string[];
  readonly record?: ProductionExecutionDurableRecord;
}

/**
 * Recovers a durable idempotency record that reached "reserved" (a lease may have
 * been acquired) but NEVER reached claim acquisition — i.e. no real execution work
 * was ever attempted under it. This is a distinct scenario from
 * `reconcileFailedPipelineExecution` above, which requires a full
 * record+lease+claim+attempt chain to already exist and targets the identity
 * `job.attempts` currently computes — not an arbitrary, already-orphaned recordId.
 *
 * Deliberately NOT wired into ProductionExecutionRecoveryBootstrap, ProductionRuntimeInitializer,
 * or any other automatic startup/recovery path. Every invocation is expected to be an
 * explicit, operator-approved, one-off call against a specific, already-identified
 * recordId — never a scan-and-fix-everything sweep.
 *
 * Safety, in order:
 *  1. Reads the record fresh. Already-"cancelled" is a replay-safe no-op (safe to
 *     call twice). Anything other than "reserved" is refused — this function only
 *     ever acts on a record still sitting in its initial reservation state.
 *  2. Refuses if ANY claim or attempt record references this recordId (scanned via
 *     `identity.recordId`, mirroring the lookup `AdapterBackedProductionExecutionClaimService`'s
 *     own private `activeClaimForRecord` uses), regardless of that claim/attempt's own
 *     state — a record with real claim/attempt activity is not "orphaned before claim
 *     acquisition" and belongs to the existing `abandonExecutionClaim`/
 *     `reconcileFailedPipelineExecution` recovery paths instead.
 *  3. If a lease exists and is still "active", releases it via the existing
 *     `AdapterBackedProductionExecutionDurableLeaseService.release()` (CAS-protected via
 *     the record's own `recordVersion`, using the lease's own recorded owner identity —
 *     this never asserts a different worker/session). Already-"released" is treated as a
 *     previously-completed step and skipped, not repeated — supports resuming after a
 *     partial prior run.
 *  4. Transitions the record itself from "reserved" to "cancelled" via the existing
 *     `AdapterBackedProductionExecutionDurableStorage.transition()` (`canonicalTransitions`
 *     already permits reserved -> cancelled unconditionally), CAS-protected via a
 *     freshly re-read version. "cancelled" is the terminal state
 *     `ProductionPipelineExecutionFactory`'s existing "cancelled -> reserved" reopening
 *     logic already recognizes and can reopen from — nothing new is required there.
 *
 * Every mutation re-reads state immediately beforehand and passes the version it just
 * read as `expectedVersion` — a concurrent mutation by another process fails the
 * underlying, unmodified CAS check (`validateMutation` / `evaluateProductionExecutionIdempotencyTransition`)
 * rather than being silently overwritten.
 */
export async function reconcileOrphanedReservationWithoutClaim(
  adapter: ProductionExecutionPersistenceAdapter,
  recordId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<ProductionOrphanReservationRecoveryResult> {
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);

  const initialRead = await storage.read(recordId);
  if (!initialRead.record) {
    return orphanFailure("ORPHAN_RESERVATION_NOT_FOUND", "record:missing");
  }
  if (initialRead.record.state === "cancelled") {
    return {
      ok: true,
      reasonCode: "ORPHAN_RESERVATION_RECONCILIATION_REPLAYED",
      writeFree: true,
      evidence: ["record:already-cancelled"],
      record: initialRead.record,
    };
  }
  if (initialRead.record.state !== "reserved") {
    return orphanFailure(
      "ORPHAN_RESERVATION_NOT_RESERVED",
      `record:state-${initialRead.record.state}`,
    );
  }

  const claimExists = await anyDurableRecordReferencesRecordId(adapter, "claim", recordId);
  if (claimExists === "list-failed") {
    return orphanFailure("ORPHAN_RESERVATION_LIST_FAILED", "claim:list-failed");
  }
  if (claimExists) {
    return orphanFailure("ORPHAN_RESERVATION_CLAIM_EXISTS", "claim:exists");
  }
  const attemptExists = await anyDurableRecordReferencesRecordId(adapter, "attempt", recordId);
  if (attemptExists === "list-failed") {
    return orphanFailure("ORPHAN_RESERVATION_LIST_FAILED", "attempt:list-failed");
  }
  if (attemptExists) {
    return orphanFailure("ORPHAN_RESERVATION_ATTEMPT_EXISTS", "attempt:exists");
  }

  let writePerformed = false;
  const preLeaseRead = await storage.read(recordId);
  if (!preLeaseRead.record || preLeaseRead.record.state !== "reserved") {
    return orphanFailure(
      "ORPHAN_RESERVATION_NOT_RESERVED",
      `record:state-changed-${preLeaseRead.record?.state ?? "missing"}`,
    );
  }
  const lease = preLeaseRead.record.durableLease;
  if (lease && lease.status === "active") {
    const evaluatedAt = now();
    const released = await leases.release({
      recordId,
      expectedVersion: preLeaseRead.actualVersion ?? preLeaseRead.record.recordVersion,
      evaluatedAt,
      releasedAt: evaluatedAt,
      worker: {
        schemaVersion: "1", workerId: lease.identity.workerId, workerType: "server",
        operationScope: [preLeaseRead.record.operation], identitySource: "trusted-server",
      },
      session: {
        schemaVersion: "1", workerSessionId: lease.identity.workerSessionId,
        workerId: lease.identity.workerId, startedAt: lease.acquiredAt,
        identitySource: "trusted-server",
      },
      leaseId: lease.identity.leaseId,
    }, defaultProductionExecutionDurableLeasePolicy);
    if (!released.ok && released.reasonCode !== "LEASE_REPLAYED") {
      return orphanFailure(
        "ORPHAN_RESERVATION_LEASE_RELEASE_FAILED",
        `lease:${released.reasonCode}`,
      );
    }
    if (released.ok && released.decision !== "replayed") writePerformed = true;
  }

  const preCancelRead = await storage.read(recordId);
  if (!preCancelRead.record) {
    return orphanFailure("ORPHAN_RESERVATION_NOT_FOUND", "record:missing-before-cancel");
  }
  if (preCancelRead.record.state === "cancelled") {
    return {
      ok: true,
      reasonCode: "ORPHAN_RESERVATION_RECONCILIATION_REPLAYED",
      writeFree: !writePerformed,
      evidence: ["record:cancelled-by-concurrent-call"],
      record: preCancelRead.record,
    };
  }
  if (preCancelRead.record.state !== "reserved") {
    return orphanFailure(
      "ORPHAN_RESERVATION_NOT_RESERVED",
      `record:state-changed-${preCancelRead.record.state}`,
    );
  }
  const cancelEvaluatedAt = now();
  const transitioned = await storage.transition(recordId, {
    schemaVersion: "1",
    recordId,
    idempotencyKey: preCancelRead.record.idempotencyKey,
    fromState: "reserved",
    toState: "cancelled",
    expectedVersion: preCancelRead.actualVersion ?? preCancelRead.record.recordVersion,
    attempt: preCancelRead.record.attempt,
    transitionedAt: cancelEvaluatedAt,
    actorId: "pipeline-system",
    reasonCode: "ORPHAN_RESERVATION_MANUAL_RECOVERY",
    evidence: ["source:orphan-reservation-recovery"],
  }, {
    evaluatedAt: cancelEvaluatedAt,
    policy: { ...defaultProductionExecutionIdempotencyPolicy, enabled: true },
  });
  if (!transitioned.ok || !transitioned.record) {
    return orphanFailure(
      "ORPHAN_RESERVATION_CANCEL_FAILED",
      `record:${transitioned.reasonCode}`,
    );
  }

  return {
    ok: true,
    reasonCode: "ORPHAN_RESERVATION_RECONCILED",
    writeFree: false,
    evidence: ["record:cancelled", "lease:released-or-already-released"],
    record: transitioned.record,
  };
}

/** @internal Shared with resolveDurableAttemptOrdinal's trailing-orphan scan (P2). */
export async function anyDurableRecordReferencesRecordId(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: "claim" | "attempt",
  recordId: string,
): Promise<boolean | "list-failed"> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return "list-failed";
  for (const key of listed.keys) {
    const read = await adapter.read(kind, key);
    if (read.status === "found") {
      const value = read.value as { identity?: { recordId?: string } };
      if (value.identity?.recordId === recordId) return true;
    }
  }
  return false;
}

function orphanFailure(
  reasonCode: Exclude<ProductionOrphanReservationRecoveryReasonCode,
    "ORPHAN_RESERVATION_RECONCILED" | "ORPHAN_RESERVATION_RECONCILIATION_REPLAYED">,
  evidence: string,
): ProductionOrphanReservationRecoveryResult {
  return { ok: false, reasonCode, writeFree: true, evidence: [`reason:${reasonCode}`, evidence] };
}
