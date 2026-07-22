import { ProjectReader } from "@/lib/projects/ProjectReader";
import { PipelineJobManager } from "@/lib/pipeline/PipelineJobManager";
import type { ProductionRuntimeOperationContext } from "@/lib/runtime/ProductionRuntimeOperationContext";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionDurableClaimRecord } from "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionDurableLease } from "@/types/productionExecutionDurableLease";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type {
  ProductionExecutionIdempotencyRecord,
  ProductionExecutionIdempotencyReservationRequest,
} from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionAuthorizationResult } from "@/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "@/types/productionExecutionConfirmation";
import type { ProductionExecutionWorkerExecutionRequest } from "@/types/productionExecutionWorker";
import {
  ProductionPipelineDurableExecutionError,
  type ProductionPipelineExecutionContext,
} from "./ProductionPipelineExecutionAdapter";
import {
  executeCanonicalProductionPipelineStage,
  installCanonicalProductionPipelineExecutionRuntime,
} from "./ProductionPipelineExecutionCanonicalRuntime";
import { stableProductionId } from "./ProductionDeterminism";
import {
  AdapterBackedProductionExecutionClaimService,
  defaultProductionExecutionClaimPolicy,
  validateProductionExecutionDurableClaim,
} from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionAttemptPolicy,
  validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import {
  AdapterBackedProductionExecutionDurableLeaseService,
  defaultProductionExecutionDurableLeasePolicy,
  validateProductionExecutionDurableLease,
} from "./ProductionExecutionDurableLease";
import {
  AdapterBackedProductionExecutionDurableStorage,
  defaultProductionExecutionDurableStoragePolicy,
} from "./ProductionExecutionDurableStorage";
import {
  buildProductionExecutionIdempotencyIdentity,
  defaultProductionExecutionIdempotencyPolicy,
} from "./ProductionExecutionIdempotency";
import { ProductionExecutionCoordinator } from "./ProductionExecutionCoordinator";
import { ProductionExecutionFilePersistenceAdapter } from "./ProductionExecutionPersistence";
import { ProductionExecutionLifecycle } from "./ProductionExecutionLifecycle";
import { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";
import {
  emitProductionPipelineExecutionEvent,
  poisonProductionPipelineExecutionPlanAfterDurableAttempt,
} from "./ProductionPipelineExecutionInstrumentation";
import type { ProductionAcceptanceStageExecutionIdentity } from "./ProductionAcceptancePolicy";
import type { ProductionWorkerLifecycle } from "./ProductionWorkerLifecycle";

export { buildProductionPipelineExecutionIdentity } from "./ProductionPipelineExecutionIdentity";

const ttlSeconds = 31_536_000;
const workerId = "pipeline-worker";
const sessionId = "pipeline-session-v1";
declare const completedPreparationBrand: unique symbol;

export interface ProductionPipelineCompletedPreparationAuthority {
  readonly [completedPreparationBrand]: true;
}

export interface CompletedProductionPipelinePreparation {
  readonly canonicalIdentity: ProductionAcceptanceStageExecutionIdentity;
  readonly leaseId: string;
  readonly reservation: ProductionExecutionIdempotencyReservationRequest;
  readonly record: ProductionExecutionDurableRecord;
  readonly lease: ProductionExecutionDurableLease;
  readonly claim: ProductionExecutionDurableClaimRecord;
  readonly attempt: ProductionExecutionDurableAttemptRecord;
  readonly request: ProductionExecutionWorkerExecutionRequest;
}

const completedPreparations =
  new WeakMap<object, CompletedProductionPipelinePreparation>();

/** @internal Install-only canonical composition; no production reset or adapter seam exists. */
export function installCanonicalProductionPipelineExecution(
  lifecycle: ProductionWorkerLifecycle,
  runtimeOperationContext: ProductionRuntimeOperationContext,
): void {
  installCanonicalProductionPipelineExecutionRuntime(lifecycle, runtimeOperationContext);
}

export function executeConfiguredProductionPipelineStage(
  context: ProductionPipelineExecutionContext,
  handler: Parameters<typeof executeCanonicalProductionPipelineStage>[1],
): Promise<boolean> {
  return executeCanonicalProductionPipelineStage(context, handler);
}

export function readCompletedProductionPipelinePreparation(
  authority: ProductionPipelineCompletedPreparationAuthority,
): CompletedProductionPipelinePreparation {
  const completed = completedPreparations.get(authority as object);
  if (!completed) {
    throw new ProductionPipelineDurableExecutionError(
      "Pipeline durable preparation authority is invalid.",
      "WORKER_EXECUTION_COORDINATION_FAILED",
    );
  }
  return completed;
}

export async function prepareProductionPipelineExecution(
  context: ProductionPipelineExecutionContext,
) {
  await emitProductionPipelineExecutionEvent("durable-entry");
  const job = await PipelineJobManager.getJobForStageReadOnly(context.projectSlug, context.stage);
  const attemptNumber = job?.attempts ?? 0;
  const jobId = job?.id ?? `${context.projectSlug}-${context.stage}`;
  const anchor = job?.updatedAt ?? job?.createdAt ?? new Date().toISOString();
  const now = new Date().toISOString();
  const planned = buildProductionPipelineExecutionIdentity(context, {
    id: jobId,
    attempts: attemptNumber,
  });
  const planIdentity = {
    requestId: planned.requestId,
    idempotencyKey: planned.idempotencyKey,
    operation: `pipeline.stage.${context.runType}`,
    leaseId: planned.leaseId,
  };
  const authorization: ProductionExecutionAuthorizationResult = {
    schemaVersion: "1", decisionId: stableProductionId("pipeline-authorization", planned.core),
    decision: "allow", authorized: true, reasonCode: "AUTHORIZED",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    executionFingerprint: planned.executionFingerprint, actorId: "pipeline-system",
    actorType: "system", projectSlug: context.projectSlug, operation: planIdentity.operation,
    action: "retry-stage", stage: context.stage, requiredCapabilities: [], grantedCapabilities: [],
    missingCapabilities: [], policyVersion: "pipeline-durable-v1", risk: "high",
    requiresConfirmation: true, requiredConfirmationLevel: "high",
    evidence: ["source:pipeline-composition"],
  };
  const confirmation: ProductionExecutionConfirmationValidationResult = {
    schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID",
    reason: "trusted pipeline composition", evaluatedAt: anchor,
    confirmationId: stableProductionId("pipeline-confirmation", planned.core),
    confirmationRequestId: stableProductionId("pipeline-confirmation-request", planned.core),
    authorizationDecisionId: stableProductionId("pipeline-authorization", planned.core),
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    actorId: "pipeline-system", projectSlug: context.projectSlug, operation: planIdentity.operation,
    action: "retry-stage", stage: context.stage, riskLevel: "high",
    requiredConfirmationLevel: "high", providedConfirmationLevel: "high", bindingMatches: true,
    bindingFingerprint: stableProductionId("pipeline-confirmation-binding", planned.core),
    expired: false, singleUse: true, consumed: false, policyVersion: "pipeline-durable-v1",
    evidence: ["source:pipeline-composition"],
  };
  const idempotencyPolicy = {
    ...defaultProductionExecutionIdempotencyPolicy,
    enabled: true,
    reservationTtlSeconds: ttlSeconds,
  };
  const storagePolicy = {
    ...defaultProductionExecutionDurableStoragePolicy,
    enabled: true,
    reservationTtlSeconds: ttlSeconds,
    idempotencyPolicy,
  };
  const leasePolicy = {
    ...defaultProductionExecutionDurableLeasePolicy,
    reservationTtlSeconds: ttlSeconds,
    maximumLeaseDurationSeconds: ttlSeconds,
  };
  const claimPolicy = {
    ...defaultProductionExecutionClaimPolicy,
    reservationTtlSeconds: ttlSeconds,
  };
  const attemptPolicy = {
    ...defaultProductionExecutionAttemptPolicy,
    reservationTtlSeconds: ttlSeconds,
  };
  const idempotencyIdentity = buildProductionExecutionIdempotencyIdentity(
    { authorization, confirmation }, { evaluatedAt: anchor, policy: idempotencyPolicy },
  ).identity!;
  const adapter = new ProductionExecutionFilePersistenceAdapter({
    trustedRootDirectory: `${ProjectReader.getProjectFolder(context.projectSlug)}/production-execution`,
  });
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const reservation: ProductionExecutionIdempotencyReservationRequest = {
    schemaVersion: "1", identity: idempotencyIdentity, authorization, confirmation,
    requestedAt: anchor, expectedInitialState: "reserved", attempt: attemptNumber + 1,
    maxAttempts: 3, reservationTtlSeconds: ttlSeconds,
    policyContext: { source: "server", environment: "hosted" }, metadata: { source: "server" },
  };
  const record: ProductionExecutionIdempotencyRecord = {
    schemaVersion: "1", recordId: planned.recordId,
    identityFingerprint: idempotencyIdentity.identityFingerprint,
    idempotencyKey: idempotencyIdentity.idempotencyKey, requestId: idempotencyIdentity.requestId,
    executionFingerprint: idempotencyIdentity.executionFingerprint,
    bindingFingerprint: idempotencyIdentity.bindingFingerprint, actorId: idempotencyIdentity.actorId,
    projectSlug: idempotencyIdentity.projectSlug, operation: idempotencyIdentity.operation,
    action: idempotencyIdentity.action, stage: idempotencyIdentity.stage,
    authorizationDecisionId: idempotencyIdentity.authorizationDecisionId,
    confirmationRequestId: idempotencyIdentity.confirmationRequestId,
    confirmationId: idempotencyIdentity.confirmationId, policyVersion: idempotencyIdentity.policyVersion,
    riskLevel: idempotencyIdentity.riskLevel, state: "reserved", attempt: attemptNumber + 1,
    maxAttempts: 3, createdAt: anchor, updatedAt: anchor, reservedAt: anchor,
    evidence: ["source:pipeline-composition"],
    integrity: { algorithm: "stable-production-id-v1",
      fingerprint: idempotencyIdentity.identityFingerprint, version: 1 },
  };
  const reservationRead = await adapter.read("reservation", idempotencyIdentity.identityFingerprint);
  if (reservationRead.status !== "found") {
    const created = await storage.createReservation(reservation, {
      evaluatedAt: anchor, policy: storagePolicy,
    });
    if (!created.ok || !created.reservation) {
      throw new Error("Pipeline durable reservation preparation failed.");
    }
  }
  let existingRecord = await storage.read(record.recordId);
  if (!existingRecord.record) {
    const created = await storage.createRecord(record, { evaluatedAt: anchor, policy: storagePolicy });
    if (!created.ok || !created.record) {
      throw new Error("Pipeline durable record preparation failed.");
    }
    existingRecord = await storage.read(record.recordId);
  }
  const worker = { schemaVersion: "1" as const, workerId, workerType: "server" as const,
    operationScope: [planIdentity.operation], identitySource: "trusted-server" as const };
  const session = { schemaVersion: "1" as const, workerSessionId: sessionId, workerId,
    startedAt: anchor, identitySource: "trusted-server" as const };
  const terminalReplay = existingRecord.record?.state === "succeeded" &&
    existingRecord.record.durableLease?.status === "released";
  if (!terminalReplay) {
    const acquired = await leases.acquire({ recordId: record.recordId, expectedVersion: 1,
      evaluatedAt: anchor, worker, session, leaseId: planned.leaseId, acquiredAt: anchor,
      heartbeatAt: anchor, expiresAt: new Date(Date.parse(anchor) + ttlSeconds * 1000).toISOString() },
    leasePolicy);
    if (!acquired.ok && acquired.reasonCode !== "LEASE_REPLAYED") {
      throw new Error(`Pipeline durable lease preparation failed: ${acquired.reasonCode}`);
    }
  }
  const claimRequest = {
    claimId: planned.claimId, recordId: record.recordId,
    reservationId: idempotencyIdentity.identityFingerprint,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    operation: planIdentity.operation, executionFingerprint: planned.executionFingerprint,
    workerId, workerSessionId: sessionId, leaseId: planned.leaseId,
    expectedReservationVersion: 1, expectedIdempotencyVersion: 2,
    expectedLeaseVersion: 1, expectedClaimVersion: 0, evaluatedAt: now,
  };
  if (!terminalReplay) {
    const claimed = await claims.acquireExecutionClaim(claimRequest, claimPolicy);
    if (!claimed.ok) {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable execution could not start.", claimed.reasonCode,
      );
    }
  }
  const attemptRequest = {
    attemptId: planned.attemptId, claimId: planned.claimId,
    reservationId: idempotencyIdentity.identityFingerprint, recordId: record.recordId,
    requestId: planIdentity.requestId, idempotencyKey: planIdentity.idempotencyKey,
    operation: planIdentity.operation, executionFingerprint: planned.executionFingerprint,
    workerId, workerSessionId: sessionId, leaseId: planned.leaseId,
    expectedClaimVersion: 1, expectedAttemptVersion: 0, evaluatedAt: now,
  };
  const plannedRequest: ProductionExecutionWorkerExecutionRequest = {
    coordinator: { claim: claimRequest, attempt: attemptRequest },
    policy: { claim: claimPolicy, attempt: attemptPolicy }, runningAt: now, finishedAt: now,
    runningEventId: planned.runningEventId, terminalEventId: planned.terminalEventId,
  };
  if (!terminalReplay) {
    const coordinated = await new ProductionExecutionCoordinator(adapter).coordinate(
      plannedRequest.coordinator, plannedRequest.policy,
    );
    if (!coordinated.ok || !coordinated.attempt) {
      throw new ProductionPipelineDurableExecutionError(
        "Pipeline durable attempt preparation failed.", coordinated.reasonCode,
      );
    }
  }
  await emitProductionPipelineExecutionEvent("durable-attempt-persisted");
  const completed = await readCompletedDurableRecords(adapter, storage, {
    reservationId: idempotencyIdentity.identityFingerprint,
    recordId: record.recordId,
    claimId: planned.claimId,
    attemptId: planned.attemptId,
  }, now);
  assertCompletedBindings(completed);
  await emitProductionPipelineExecutionEvent("durable-readback-verified");
  poisonProductionPipelineExecutionPlanAfterDurableAttempt(planIdentity);
  const completedRequest: ProductionExecutionWorkerExecutionRequest = {
    coordinator: {
      claim: { ...claimRequest, claimId: completed.claim.identity.claimId,
        recordId: completed.claim.identity.recordId,
        reservationId: completed.claim.identity.reservationId,
        requestId: completed.claim.identity.requestId,
        idempotencyKey: completed.claim.identity.idempotencyKey,
        operation: completed.record.operation,
        executionFingerprint: completed.claim.identity.executionFingerprint,
        leaseId: completed.claim.identity.leaseId },
      attempt: { ...attemptRequest, ...completed.attempt.identity,
        operation: completed.record.operation, expectedClaimVersion: completed.attempt.binding.claimVersion },
    },
    policy: plannedRequest.policy, runningAt: now, finishedAt: now,
    runningEventId: planned.runningEventId, terminalEventId: planned.terminalEventId,
  };
  const canonicalIdentity = Object.freeze({
    projectSlug: completed.record.projectSlug, stage: context.stage, runType: context.runType,
    jobId, attemptNumber, attemptId: completed.attempt.identity.attemptId,
    recordId: completed.attempt.identity.recordId,
    reservationId: completed.attempt.identity.reservationId,
    claimId: completed.attempt.identity.claimId,
    leaseId: completed.lease.identity.leaseId,
    requestId: completed.attempt.identity.requestId,
    idempotencyKey: completed.attempt.identity.idempotencyKey,
    operation: completed.record.operation,
    executionFingerprint: completed.attempt.identity.executionFingerprint,
    durableAttemptRequired: true as const,
  });
  const authority = Object.freeze(Object.create(null)) as
    ProductionPipelineCompletedPreparationAuthority;
  const authorityData = deepFreeze({ canonicalIdentity,
    leaseId: completed.lease.identity.leaseId, ...completed, request: completedRequest });
  completedPreparations.set(authority as object, authorityData);
  await emitProductionPipelineExecutionEvent("canonical-identity-extracted");
  return { adapter, request: completedRequest, authority,
    settlement: { adapter, request: completedRequest, idempotencyPolicy, leasePolicy, worker, session } };
}

async function readCompletedDurableRecords(
  adapter: ProductionExecutionFilePersistenceAdapter,
  storage: AdapterBackedProductionExecutionDurableStorage,
  ids: { reservationId: string; recordId: string; claimId: string; attemptId: string },
  evaluatedAt: string,
) {
  const reservation = await adapter.read("reservation", ids.reservationId);
  const record = await storage.read(ids.recordId);
  const claim = await readLatestVersioned<ProductionExecutionDurableClaimRecord>(
    adapter, "claim", ids.claimId,
  );
  const attempt = await new ProductionExecutionLifecycle(adapter).inspect(ids.attemptId, evaluatedAt);
  if (reservation.status !== "found" || !record.record || !record.record.durableLease ||
    !claim || !attempt.attempt || !validateProductionExecutionDurableClaim(claim) ||
    !validateProductionExecutionDurableAttempt(attempt.attempt) ||
    !validateProductionExecutionDurableLease(record.record.durableLease)) {
    throw new Error("Pipeline durable preparation readback failed.");
  }
  return { reservation: reservation.value as ProductionExecutionIdempotencyReservationRequest,
    record: record.record, lease: record.record.durableLease, claim, attempt: attempt.attempt };
}

async function readLatestVersioned<T>(
  adapter: ProductionExecutionFilePersistenceAdapter,
  kind: "claim" | "attempt",
  identity: string,
): Promise<T | undefined> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return undefined;
  const prefix = `${identity}-v`;
  const key = listed.keys.filter((candidate) => candidate.startsWith(prefix))
    .sort((left, right) => Number(right.slice(prefix.length)) - Number(left.slice(prefix.length)))[0];
  if (!key) return undefined;
  const read = await adapter.read(kind, key);
  return read.status === "found" ? read.value as T : undefined;
}

function assertCompletedBindings(completed: {
  reservation: ProductionExecutionIdempotencyReservationRequest;
  record: ProductionExecutionDurableRecord;
  lease: ProductionExecutionDurableLease;
  claim: ProductionExecutionDurableClaimRecord;
  attempt: ProductionExecutionDurableAttemptRecord;
}): void {
  const { reservation, record, lease, claim, attempt } = completed;
  const exact = reservation.identity.requestId === record.requestId &&
    record.requestId === claim.identity.requestId && claim.identity.requestId === attempt.identity.requestId &&
    reservation.identity.idempotencyKey === record.idempotencyKey &&
    record.idempotencyKey === claim.identity.idempotencyKey &&
    claim.identity.idempotencyKey === attempt.identity.idempotencyKey &&
    reservation.identity.operation === record.operation && claim.identity.operation === record.operation &&
    attempt.identity.operation === record.operation &&
    reservation.identity.identityFingerprint === claim.identity.reservationId &&
    claim.identity.reservationId === attempt.identity.reservationId &&
    claim.identity.claimId === attempt.identity.claimId && claim.identity.leaseId === attempt.identity.leaseId &&
    lease.identity.leaseId === attempt.identity.leaseId &&
    reservation.identity.executionFingerprint === attempt.identity.executionFingerprint;
  if (!exact) throw new Error("Pipeline durable preparation binding verification failed.");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
