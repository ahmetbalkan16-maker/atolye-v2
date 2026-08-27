import {
  type RuntimeStorageContext,
  resolveRuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import { stableProductionId } from "./ProductionDeterminism";
import { AdapterBackedProductionExecutionDurableStorage } from "./ProductionExecutionDurableStorage";
import {
  buildProductionPipelineRetryBudgetExtensionReceipt,
} from "./ProductionPipelineRetryBudgetExtensionSchema";
import {
  readRetryBudgetExtensionAuthority,
  readRetryBudgetExtensionReceipt,
  writeRetryBudgetExtensionReceipt,
} from "./ProductionPipelineRetryBudgetExtensionStore";
import { AdapterBackedProductionExecutionDurableLeaseService } from "./ProductionExecutionDurableLease";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionIdempotencyPolicy } from "./ProductionExecutionIdempotency";
import { defaultProductionExecutionDurableLeasePolicy } from "./ProductionExecutionDurableLease";
import { defaultProductionExecutionClaimPolicy } from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionAttemptPolicy } from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableAttempt } from "./ProductionExecutionDurableAttempt";
import { validateProductionExecutionDurableClaim } from "./ProductionExecutionDurableClaim";
import { validateProductionExecutionDurableLease } from "./ProductionExecutionDurableLease";
import { readProductionExecutionRecoverySemanticAuthority,
  type ProductionOrphanReservationToleranceLookupContext } from
  "./ProductionExecutionRecoveryBootstrap";
import { ProductionExecutionLifecycle } from "./ProductionExecutionLifecycle";
import type { ProductionExecutionPersistenceAdapter,
  ProductionExecutionPersistenceRecordKind } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyState, ProductionExecutionIdempotencyTransitionRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionDurableLeasePolicy, ProductionExecutionDurableWorkerIdentity, ProductionExecutionWorkerSessionIdentity } from "@/types/productionExecutionDurableLease";
import type { ProductionExecutionWorkerExecutionRequest, ProductionExecutionWorkerExecutionResult } from "@/types/productionExecutionWorker";
import type { ProductionExecutionDurableClaimRecord } from "@/types/productionExecutionDurableClaim";
import type { ProductionExecutionIdempotencyReservationRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionStepKey } from "@/types/project";
import type { RetryBudgetExtensionDurableBinding } from
  "@/types/productionPipelineRetryBudgetExtension";

export interface ProductionPipelineTerminalSettlementContext {
  adapter: ProductionExecutionPersistenceAdapter;
  request: ProductionExecutionWorkerExecutionRequest;
  idempotencyPolicy: ProductionExecutionIdempotencyPolicy;
  leasePolicy: ProductionExecutionDurableLeasePolicy;
  worker: ProductionExecutionDurableWorkerIdentity;
  session: ProductionExecutionWorkerSessionIdentity;
}

export interface ProductionPipelineTerminalSettlementResult {
  ok: boolean;
  writeFree: boolean;
  writePerformed?: boolean;
  quiescenceProven?: boolean;
  reasonCode: string;
  settlementReasonCode?: string;
  completedSteps?: readonly ProductionPipelineFailedSettlementStep[];
  originalFailureCode?: string;
  causeReasonCode?: string;
  failedBoundary?: ProductionPipelineFailedSettlementFailureBoundary;
  attemptEvidence?: ProductionPipelineFailedSettlementAttemptEvidence;
}

export type ProductionPipelineFailedSettlementStep =
  | "attempt-failed"
  | "lease-released"
  | "claim-closed"
  | "record-terminal"
  | "quiescence-verified"
  | "settled-receipt-finalized";

export type ProductionPipelineFailedSettlementBoundary =
  | "before-lease-release"
  | "after-lease-release"
  | "before-claim-close"
  | "after-claim-close"
  | "before-record-terminalization"
  | "after-record-terminalization"
  | "before-final-validation";

export type ProductionPipelineFailedSettlementFailureBoundary =
  | ProductionPipelineFailedSettlementBoundary
  | "initial-chain-verification"
  | "lease-release"
  | "claim-close"
  | "record-terminalization"
  | "final-validation";

export interface ProductionPipelineFailedSettlementAttemptEvidence {
  readonly attemptId: string;
  readonly attemptVersion: number;
  readonly terminalState: string;
  readonly terminalReasonCode: string;
  readonly projectSlug?: string;
  readonly stage?: string;
  readonly operation?: string;
  readonly recordId: string;
  readonly claimId: string;
  readonly leaseId: string;
  readonly reservationId: string;
  readonly workerId: string;
  readonly workerSessionId: string;
}

export interface ProductionPipelineFailedSettlementContext
  extends ProductionPipelineTerminalSettlementContext {
  expectedProjectSlug?: string;
  expectedStage?: string;
  storageContext?: RuntimeStorageContext;
  /** Deterministic fault seam for isolated lifecycle tests. Never configured by production composition. */
  onBoundary?: (boundary: ProductionPipelineFailedSettlementBoundary) => void | Promise<void>;
}

const failedSettlementLocks = new Map<string, Promise<void>>();

export async function settlePendingSuccessfulProductionPipelineExecutions(
  adapter: ProductionExecutionPersistenceAdapter,
): Promise<ProductionPipelineTerminalSettlementResult> {
  const recordKeys = await adapter.listKeys("idempotency");
  const attemptKeys = await adapter.listKeys("attempt");
  if (!recordKeys.ok || !attemptKeys.ok) return denied("PIPELINE_SETTLEMENT_DISCOVERY_FAILED");
  const records = await latestArtifacts<ProductionExecutionDurableRecord>(recordKeys.keys, async (key) => {
    const read = await adapter.read("idempotency", key);
    return read.status === "found" ? read.value as ProductionExecutionDurableRecord : undefined;
  });
  const attempts = await latestArtifacts<ProductionExecutionDurableAttemptRecord>(attemptKeys.keys, async (key) => {
    const read = await adapter.read("attempt", key);
    return read.status === "found" ? read.value : undefined;
  });
  let writes = false;
  for (const record of records) {
    if (record.state === "succeeded" && record.durableLease?.status === "released") continue;
    if (record.durableLease?.status !== "active") continue;
    const attempt = attempts.find((item) =>
      item.identity.recordId === record.recordId && item.state === "succeeded"
    );
    if (!attempt?.finalizedAt) continue;
    const lease = record.durableLease;
    const worker = { schemaVersion:"1" as const, workerId:lease.identity.workerId, workerType:"server" as const, operationScope:[record.operation], identitySource:"trusted-server" as const };
    const session = { schemaVersion:"1" as const, workerSessionId:lease.identity.workerSessionId, workerId:lease.identity.workerId, startedAt:lease.acquiredAt, identitySource:"trusted-server" as const };
    const ttl = Math.max(1, Math.ceil((Date.parse(lease.expiresAt) - Date.parse(record.reservedAt ?? record.createdAt)) / 1000));
    const idempotencyPolicy = { ...defaultProductionExecutionIdempotencyPolicy, enabled:true, reservationTtlSeconds:ttl };
    const request: ProductionExecutionWorkerExecutionRequest = {
      coordinator: {
        claim: {
          claimId:attempt.identity.claimId, recordId:record.recordId, reservationId:attempt.identity.reservationId,
          requestId:record.requestId, idempotencyKey:record.idempotencyKey, executionFingerprint:record.executionFingerprint,
          workerId:attempt.identity.workerId, workerSessionId:attempt.identity.workerSessionId, leaseId:attempt.identity.leaseId,
          expectedReservationVersion:1, expectedIdempotencyVersion:2, expectedLeaseVersion:1, expectedClaimVersion:0,
          evaluatedAt:attempt.openedAt,
        },
        attempt: {
          ...attempt.identity, expectedClaimVersion:attempt.binding.claimVersion,
          expectedAttemptVersion:0, evaluatedAt:attempt.openedAt,
        },
      },
      policy: {
        claim:{...defaultProductionExecutionClaimPolicy,reservationTtlSeconds:ttl},
        attempt:{...defaultProductionExecutionAttemptPolicy,reservationTtlSeconds:ttl},
      },
      runningAt:attempt.openedAt,
      finishedAt:attempt.finalizedAt,
      runningEventId:attempt.journal.find((entry) => entry.payload.code === "WORKER_RUNNING")?.entryId ?? `${attempt.identity.attemptId}-running`,
      terminalEventId:attempt.journal.at(-1)?.entryId ?? `${attempt.identity.attemptId}-terminal`,
    };
    const result = await settleSuccessfulProductionPipelineExecution({
      adapter, request, idempotencyPolicy,
      leasePolicy:{...defaultProductionExecutionDurableLeasePolicy,reservationTtlSeconds:ttl,maximumLeaseDurationSeconds:ttl},
      worker, session,
    }, {
      schemaVersion:"1", ok:true, decision:"replayed", reasonCode:"WORKER_EXECUTION_REPLAYED",
      status:"completed", attempt, handlerCalled:false, writeFree:true,
      evidence:["reason:WORKER_EXECUTION_REPLAYED"],
    });
    if (!result.ok) return result;
    writes ||= !result.writeFree;
  }
  return allowed(!writes, writes ? "PIPELINE_SETTLEMENT_COMPLETED" : "PIPELINE_SETTLEMENT_REPLAYED");
}

export async function settleSuccessfulProductionPipelineExecution(
  context: ProductionPipelineTerminalSettlementContext,
  execution: ProductionExecutionWorkerExecutionResult,
): Promise<ProductionPipelineTerminalSettlementResult> {
  if (execution.status !== "completed" || execution.attempt?.state !== "succeeded") {
    return denied("PIPELINE_SETTLEMENT_ATTEMPT_NOT_SUCCEEDED");
  }
  const { adapter, request } = context;
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const claims = new AdapterBackedProductionExecutionClaimService(adapter);
  const leases = new AdapterBackedProductionExecutionDurableLeaseService(adapter);
  const recordId = request.coordinator.attempt.recordId;
  const initial = await storage.read(recordId);
  if (!initial.record) return denied(initial.reasonCode);
  if (isSettled(initial.record)) return allowed(true, "PIPELINE_SETTLEMENT_REPLAYED");

  const claim = await claims.releaseExecutionClaim({
    claimId: request.coordinator.attempt.claimId,
    workerId: request.coordinator.attempt.workerId,
    workerSessionId: request.coordinator.attempt.workerSessionId,
    leaseId: request.coordinator.attempt.leaseId,
    expectedClaimVersion: 1,
    evaluatedAt: request.finishedAt,
  });
  if (!claim.ok) return denied(claim.reasonCode);

  let current = (await storage.read(recordId)).record;
  if (!current) return denied("DURABLE_STORAGE_RECORD_MISSING");
  const states: readonly ProductionExecutionIdempotencyState[] = ["reserved", "prepared", "queued", "running", "succeeded"];
  const start = states.indexOf(current.state as ProductionExecutionIdempotencyState);
  if (start < 0 || current.state === "succeeded" && current.durableLease?.status !== "active") {
    return isSettled(current) ? allowed(false, "PIPELINE_SETTLEMENT_COMPLETED") : denied("PIPELINE_SETTLEMENT_STATE_CONFLICT");
  }
  for (let index = start; index < states.length - 1; index += 1) {
    const fromState = states[index];
    const toState = states[index + 1];
    const transition = buildTransition(context, execution, current, fromState, toState);
    const transitioned = await storage.transition(recordId, transition, {
      evaluatedAt: request.finishedAt,
      policy: context.idempotencyPolicy,
    });
    if (!transitioned.ok || !transitioned.record) return denied(transitioned.reasonCode);
    current = transitioned.record;
  }

  if (current.state !== "succeeded" || !current.durableLease) {
    return denied("PIPELINE_SETTLEMENT_STATE_CONFLICT");
  }
  const released = await leases.release({
    recordId,
    expectedVersion: current.recordVersion,
    evaluatedAt: request.finishedAt,
    worker: context.worker,
    session: context.session,
    leaseId: request.coordinator.attempt.leaseId,
    releasedAt: request.finishedAt,
  }, context.leasePolicy);
  if (!released.ok || !released.record || !isSettled(released.record)) {
    return denied(released.reasonCode);
  }
  return allowed(false, "PIPELINE_SETTLEMENT_COMPLETED");
}

/**
 * Forward-complete a terminal failed attempt into durable quiescence.
 * The failed attempt is immutable and must already exist before this function is entered.
 */
export async function settleFailedProductionPipelineExecution(
  context: ProductionPipelineFailedSettlementContext,
  execution: ProductionExecutionWorkerExecutionResult,
): Promise<ProductionPipelineTerminalSettlementResult> {
  const resolvedContext = {
    ...context,
    storageContext: context.storageContext ?? resolveRuntimeStorageContext(),
  };
  return withFailedSettlementLock(context.request.coordinator.attempt.recordId,
    () => settleFailedProductionPipelineExecutionUnlocked(resolvedContext, execution));
}

async function settleFailedProductionPipelineExecutionUnlocked(
  context: ProductionPipelineFailedSettlementContext & { storageContext: RuntimeStorageContext },
  execution: ProductionExecutionWorkerExecutionResult,
): Promise<ProductionPipelineTerminalSettlementResult> {
  const originalFailureCode = terminalFailureCode(execution.attempt);
  const completed: ProductionPipelineFailedSettlementStep[] = [];
  const attemptEvidence = failedAttemptEvidence(context, execution.attempt, originalFailureCode);
  let wrote = false;
  const deny = (
    reasonCode: string,
    failedBoundary: ProductionPipelineFailedSettlementFailureBoundary,
    causeReasonCode?: string,
  ) => failedDenied(reasonCode, completed, originalFailureCode, failedBoundary,
    attemptEvidence, causeReasonCode, wrote);
  if (execution.status !== "failed" || execution.attempt?.state !== "failed") {
    return deny("PIPELINE_FAILED_SETTLEMENT_ATTEMPT_NOT_FAILED", "initial-chain-verification");
  }

  const verified = await readAndVerifyFailedChain(context, execution.attempt);
  if (!verified.ok) {
    return deny("PIPELINE_FAILED_SETTLEMENT_BINDING_CONFLICT",
      "initial-chain-verification", verified.reasonCode);
  }
  completed.push("attempt-failed");

  try {
    await context.onBoundary?.("before-lease-release");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "before-lease-release",
      "before-lease-release");
  }

  const leases = new AdapterBackedProductionExecutionDurableLeaseService(context.adapter);
  let record = (await new AdapterBackedProductionExecutionDurableStorage(context.adapter)
    .read(context.request.coordinator.attempt.recordId)).record;
  if (!record?.durableLease) {
    return deny("PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED", "lease-release",
      "LEASE_NOT_FOUND");
  }
  if (record.durableLease.status === "active") {
    const release = await leases.release({
      recordId: record.recordId,
      expectedVersion: record.recordVersion,
      evaluatedAt: context.request.finishedAt,
      worker: context.worker,
      session: context.session,
      leaseId: context.request.coordinator.attempt.leaseId,
      releasedAt: context.request.finishedAt,
    }, context.leasePolicy);
    if (!release.ok) {
      const replay = (await new AdapterBackedProductionExecutionDurableStorage(context.adapter)
        .read(record.recordId)).record;
      if (!replay || !sameReleasedLease(replay, context)) {
        return deny("PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED", "lease-release",
          release.reasonCode);
      }
      record = replay;
    } else {
      record = release.record;
      wrote ||= release.decision !== "replayed";
    }
  } else if (!sameReleasedLease(record, context)) {
    return deny("PIPELINE_FAILED_SETTLEMENT_LEASE_RELEASE_FAILED", "lease-release",
      `LEASE_${record.durableLease.status.toUpperCase()}`);
  }
  completed.push("lease-released");
  try {
    await context.onBoundary?.("after-lease-release");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "after-lease-release",
      "after-lease-release");
  }
  try {
    await context.onBoundary?.("before-claim-close");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "before-claim-close",
      "before-claim-close");
  }

  const claims = new AdapterBackedProductionExecutionClaimService(context.adapter);
  let claimRead = await latestArtifact<ProductionExecutionDurableClaimRecord>(
    context.adapter, "claim", context.request.coordinator.attempt.claimId,
  );
  if (!claimRead || !validateProductionExecutionDurableClaim(claimRead)) {
    return deny("PIPELINE_FAILED_SETTLEMENT_CLAIM_CLOSE_FAILED", "claim-close",
      "CLAIM_NOT_FOUND");
  }
  if (claimRead.state === "active") {
    const abandoned = await claims.abandonExecutionClaim({
      claimId: claimRead.identity.claimId,
      workerId: claimRead.identity.workerId,
      workerSessionId: claimRead.identity.workerSessionId,
      leaseId: claimRead.identity.leaseId,
      expectedClaimVersion: claimRead.claimVersion,
      evaluatedAt: context.request.finishedAt,
      reason: "coordination-recovery",
    });
    if (!abandoned.ok) {
      claimRead = await latestArtifact<ProductionExecutionDurableClaimRecord>(
        context.adapter, "claim", claimRead.identity.claimId,
      );
      if (!claimRead || !["abandoned", "released"].includes(claimRead.state)) {
        return deny("PIPELINE_FAILED_SETTLEMENT_CLAIM_CLOSE_FAILED", "claim-close",
          abandoned.reasonCode);
      }
    } else {
      claimRead = abandoned.claim;
      wrote ||= abandoned.decision !== "replayed";
    }
  } else if (!["abandoned", "released"].includes(claimRead.state)) {
    return deny("PIPELINE_FAILED_SETTLEMENT_CLAIM_CLOSE_FAILED", "claim-close",
      `CLAIM_${claimRead.state.toUpperCase()}`);
  }
  completed.push("claim-closed");
  try {
    await context.onBoundary?.("after-claim-close");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "after-claim-close",
      "after-claim-close");
  }
  try {
    await context.onBoundary?.("before-record-terminalization");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "before-record-terminalization",
      "before-record-terminalization");
  }

  const storage = new AdapterBackedProductionExecutionDurableStorage(context.adapter);
  record = await readRecordWithReplay(storage, context.request.coordinator.attempt.recordId);
  if (!record) {
    return deny("PIPELINE_FAILED_SETTLEMENT_RECORD_TERMINALIZATION_FAILED",
      "record-terminalization", "DURABLE_STORAGE_RECORD_MISSING");
  }
  if (record.state === "reserved") {
    const terminalized = await storage.releaseReservation(record.recordId, {
      schemaVersion: "1",
      recordId: record.recordId,
      idempotencyKey: record.idempotencyKey,
      fromState: "reserved",
      toState: "cancelled",
      expectedVersion: record.recordVersion,
      attempt: record.attempt,
      transitionedAt: context.request.finishedAt,
      actorId: record.actorId,
      reasonCode: "PIPELINE_FAILED_TERMINAL_SETTLEMENT",
      failure: {
        failureCode: originalFailureCode,
        category: "provider",
        retryable: true,
        resumePossible: false,
        failedAt: context.request.finishedAt,
        safeMessage: "Pipeline stage execution failed.",
      },
      recovery: {
        mode: "reconcile",
        previousRecordId: record.recordId,
        confirmationSingleUseConsumed: false,
      },
      evidence: ["source:pipeline-failed-terminal-settlement", `failure:${originalFailureCode}`],
    }, { evaluatedAt: context.request.finishedAt, policy: context.idempotencyPolicy });
    if (!terminalized.ok || !terminalized.record) {
      const replay = await readRecordWithReplay(storage, record.recordId);
      if (!replay || !["cancelled", "failed"].includes(replay.state)) {
        return deny("PIPELINE_FAILED_SETTLEMENT_RECORD_TERMINALIZATION_FAILED",
          "record-terminalization", terminalized.reasonCode);
      }
      record = replay;
    } else {
      record = terminalized.record;
      wrote = true;
    }
  } else if (!["cancelled", "failed"].includes(record.state)) {
    return deny("PIPELINE_FAILED_SETTLEMENT_RECORD_TERMINALIZATION_FAILED",
      "record-terminalization", `RECORD_${record.state.toUpperCase()}`);
  }
  completed.push("record-terminal");
  try {
    await context.onBoundary?.("after-record-terminalization");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "after-record-terminalization",
      "after-record-terminalization");
  }
  try {
    await context.onBoundary?.("before-final-validation");
  } catch {
    return deny("PIPELINE_FAILED_SETTLEMENT_INTERRUPTED", "before-final-validation",
      "before-final-validation");
  }

  const final = await readAndVerifyFailedChain(context, execution.attempt, true);
  if (!final.ok) {
    return deny("PIPELINE_FAILED_SETTLEMENT_VALIDATION_FAILED", "final-validation",
      final.reasonCode);
  }
  completed.push("quiescence-verified");
  if (final.retryBudgetExtension) {
    const receipt = finalizeProductionPipelineRetryBudgetExtensionSettlement({
      storageContext: context.storageContext,
      terminalAttemptFinalizedAt: execution.attempt.finalizedAt,
      binding: final.retryBudgetExtension,
    });
    if (!receipt.ok) {
      return deny(receipt.reasonCode, "final-validation", receipt.causeReasonCode);
    }
    wrote ||= !receipt.writeFree;
    completed.push("settled-receipt-finalized");
  }
  return {
    ok: true,
    writeFree: !wrote,
    writePerformed: wrote,
    quiescenceProven: true,
    reasonCode: wrote ? "PIPELINE_FAILED_SETTLEMENT_COMPLETED" : "PIPELINE_FAILED_SETTLEMENT_REPLAYED",
    settlementReasonCode: wrote ? "PIPELINE_FAILED_SETTLEMENT_COMPLETED" :
      "PIPELINE_FAILED_SETTLEMENT_REPLAYED",
    completedSteps: completed,
    originalFailureCode,
    attemptEvidence,
  };
}

async function withFailedSettlementLock<T>(recordId: string, action: () => Promise<T>): Promise<T> {
  const previous = failedSettlementLocks.get(recordId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  failedSettlementLocks.set(recordId, queued);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (failedSettlementLocks.get(recordId) === queued) failedSettlementLocks.delete(recordId);
  }
}

function buildTransition(
  context: ProductionPipelineTerminalSettlementContext,
  execution: ProductionExecutionWorkerExecutionResult,
  record: NonNullable<Awaited<ReturnType<AdapterBackedProductionExecutionDurableStorage["read"]>>["record"]>,
  fromState: ProductionExecutionIdempotencyState,
  toState: ProductionExecutionIdempotencyState,
): ProductionExecutionIdempotencyTransitionRequest {
  const lease = record.durableLease;
  return {
    schemaVersion: "1",
    recordId: record.recordId,
    idempotencyKey: record.idempotencyKey,
    fromState,
    toState,
    expectedVersion: record.recordVersion,
    attempt: record.attempt,
    transitionedAt: context.request.finishedAt,
    actorId: record.actorId,
    reasonCode: `PIPELINE_STAGE_${toState.toUpperCase()}`,
    evidence: ["source:pipeline-terminal-settlement", `state:${toState}`],
    ...(toState === "running" && lease ? {
      workerIdentity: { id: context.worker.workerId, operationScope: context.worker.operationScope },
      lease: {
        leaseId: lease.identity.leaseId,
        workerId: lease.identity.workerId,
        workerOperationScope: context.worker.operationScope,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
        heartbeatAt: lease.heartbeatAt,
        version: lease.version,
        status: "active" as const,
      },
    } : {}),
    ...(toState === "succeeded" ? {
      result: {
        resultFingerprint: stableProductionId("pipeline-stage-result", {
          attemptId: execution.attempt?.identity.attemptId,
          attemptFingerprint: execution.attempt?.integrity.fingerprint,
        }),
        summary: "Pipeline stage completed and durably settled.",
        completedAt: context.request.finishedAt,
        outputReferences: [],
        partial: false,
      },
    } : {}),
  };
}

function isSettled(record: { state: string; durableLease?: { status: string } }) {
  return record.state === "succeeded" && record.durableLease?.status === "released";
}

function allowed(writeFree: boolean, reasonCode: string): ProductionPipelineTerminalSettlementResult {
  return { ok: true, writeFree, reasonCode };
}

function denied(reasonCode: string): ProductionPipelineTerminalSettlementResult {
  return { ok: false, writeFree: true, reasonCode };
}

function failedDenied(
  reasonCode: string,
  completedSteps: readonly ProductionPipelineFailedSettlementStep[],
  originalFailureCode: string,
  failedBoundary: ProductionPipelineFailedSettlementFailureBoundary,
  attemptEvidence: ProductionPipelineFailedSettlementAttemptEvidence,
  causeReasonCode?: string,
  writePerformed = false,
): ProductionPipelineTerminalSettlementResult {
  return {
    ok: false,
    writeFree: !writePerformed,
    writePerformed,
    quiescenceProven: false,
    reasonCode,
    settlementReasonCode: reasonCode,
    completedSteps: [...completedSteps],
    originalFailureCode,
    failedBoundary,
    attemptEvidence,
    ...(causeReasonCode ? { causeReasonCode } : {}),
  };
}

function failedAttemptEvidence(
  context: ProductionPipelineFailedSettlementContext,
  attempt: ProductionExecutionDurableAttemptRecord | undefined,
  terminalReasonCode: string,
): ProductionPipelineFailedSettlementAttemptEvidence {
  const identity = attempt?.identity ?? context.request.coordinator.attempt;
  return Object.freeze({
    attemptId: boundedIdentifier(identity.attemptId),
    attemptVersion: Number.isSafeInteger(attempt?.attemptVersion) ? attempt!.attemptVersion : 0,
    terminalState: attempt?.state === "failed" ? "failed" : "unknown",
    terminalReasonCode,
    ...(context.expectedProjectSlug
      ? { projectSlug: boundedIdentifier(context.expectedProjectSlug) } : {}),
    ...(context.expectedStage ? { stage: boundedIdentifier(context.expectedStage) } : {}),
    ...(identity.operation ? { operation: boundedOperation(identity.operation) } : {}),
    recordId: boundedIdentifier(identity.recordId),
    claimId: boundedIdentifier(identity.claimId),
    leaseId: boundedIdentifier(identity.leaseId),
    reservationId: boundedIdentifier(identity.reservationId),
    workerId: boundedIdentifier(identity.workerId),
    workerSessionId: boundedIdentifier(identity.workerSessionId),
  });
}

function boundedIdentifier(value: string): string {
  return /^[a-z0-9][a-z0-9_-]{0,101}$/.test(value) ? value : "invalid-identifier";
}

function boundedOperation(value: string): string {
  return /^[a-z0-9][a-z0-9._:-]{0,198}$/.test(value) ? value : "invalid-operation";
}

function terminalFailureCode(attempt: ProductionExecutionDurableAttemptRecord | undefined) {
  const code = attempt?.journal.at(-1)?.payload.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,80}$/.test(code)
    ? code
    : "WORKER_HANDLER_FAILED";
}

async function readAndVerifyFailedChain(
  context: ProductionPipelineFailedSettlementContext,
  attempt: ProductionExecutionDurableAttemptRecord,
  requireQuiescence = false,
): Promise<{ ok: true; retryBudgetExtension?: RetryBudgetExtensionDurableBinding } |
  { ok: false; reasonCode: string }> {
  const expected = context.request.coordinator.attempt;
  const inventory = await readFailedSettlementAuthorityInventory(context.adapter);
  if (!inventory.ok) return inventory;
  const reservation = inventory.reservations.get(expected.reservationId);
  const durableAttempt = inventory.attempts.get(expected.attemptId);
  const claim = inventory.claims.get(expected.claimId);
  const record = inventory.records.get(expected.recordId);
  if (!reservation || !record || !claim || !durableAttempt) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_CHAIN_MISSING" };
  }
  if (!record.durableLease || !validateProductionExecutionDurableLease(record.durableLease)) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_CHAIN_INVALID" };
  }
  const expectedProjectSlug = context.expectedProjectSlug ?? record.projectSlug;
  const expectedStage = context.expectedStage ?? record.stage;
  const expectedOperation = expected.operation ?? record.operation;
  const claimRequest = context.request.coordinator.claim;
  const identities = [attempt.identity, durableAttempt.identity];
  if (durableAttempt.state !== "failed" || attempt.integrity.fingerprint !== durableAttempt.integrity.fingerprint ||
    durableAttempt.attemptVersion !== attempt.attemptVersion ||
    identities.some((identity) =>
      identity.attemptId !== expected.attemptId ||
      identity.claimId !== expected.claimId ||
      identity.reservationId !== expected.reservationId ||
      identity.recordId !== expected.recordId ||
      identity.requestId !== expected.requestId ||
      identity.idempotencyKey !== expected.idempotencyKey ||
      identity.executionFingerprint !== expected.executionFingerprint ||
      identity.workerId !== expected.workerId ||
      identity.workerSessionId !== expected.workerSessionId ||
      identity.leaseId !== expected.leaseId ||
      (expected.operation !== undefined && identity.operation !== expected.operation)
    )) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_ATTEMPT_BINDING_MISMATCH" };
  }
  if (
    reservation.identity.identityFingerprint !== expected.reservationId ||
    reservation.identity.projectSlug !== expectedProjectSlug ||
    reservation.identity.stage !== expectedStage ||
    reservation.identity.operation !== expectedOperation ||
    reservation.identity.requestId !== expected.requestId ||
    reservation.identity.idempotencyKey !== expected.idempotencyKey ||
    reservation.identity.executionFingerprint !== expected.executionFingerprint ||
    reservation.identity.bindingFingerprint !== record.bindingFingerprint ||
    record.identityFingerprint !== expected.reservationId ||
    record.projectSlug !== expectedProjectSlug ||
    record.stage !== expectedStage ||
    record.operation !== expectedOperation ||
    record.requestId !== expected.requestId ||
    record.idempotencyKey !== expected.idempotencyKey ||
    record.executionFingerprint !== expected.executionFingerprint ||
    claim.identity.claimId !== expected.claimId ||
    claim.identity.recordId !== expected.recordId ||
    claim.identity.reservationId !== expected.reservationId ||
    claim.identity.requestId !== expected.requestId ||
    claim.identity.idempotencyKey !== expected.idempotencyKey ||
    claim.identity.executionFingerprint !== expected.executionFingerprint ||
    claim.identity.workerId !== expected.workerId ||
    claim.identity.workerSessionId !== expected.workerSessionId ||
    claim.identity.leaseId !== expected.leaseId ||
    claim.identity.operation !== expectedOperation ||
    claim.binding.reservationVersion !== claimRequest.expectedReservationVersion ||
    claim.binding.idempotencyVersion !== claimRequest.expectedIdempotencyVersion ||
    claim.binding.leaseVersion !== claimRequest.expectedLeaseVersion ||
    durableAttempt.binding.reservationVersion !== claimRequest.expectedReservationVersion ||
    durableAttempt.binding.claimVersion !== context.request.coordinator.attempt.expectedClaimVersion ||
    durableAttempt.binding.leaseVersion !== claimRequest.expectedLeaseVersion ||
    record.durableLease.identity.recordId !== expected.recordId ||
    record.durableLease.identity.requestId !== expected.requestId ||
    record.durableLease.identity.idempotencyKey !== expected.idempotencyKey ||
    record.durableLease.identity.executionFingerprint !== expected.executionFingerprint ||
    record.durableLease.identity.workerId !== expected.workerId ||
    record.durableLease.identity.workerSessionId !== expected.workerSessionId ||
    record.durableLease.identity.leaseId !== expected.leaseId
  ) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_CHAIN_BINDING_MISMATCH" };
  }
  const reservationAuthorities = [...inventory.reservations.values()].filter((candidate) =>
    candidate.identity.projectSlug === expectedProjectSlug &&
    candidate.identity.stage === expectedStage &&
    candidate.identity.operation === expectedOperation &&
    candidate.identity.requestId === expected.requestId &&
    candidate.identity.idempotencyKey === expected.idempotencyKey &&
    candidate.identity.executionFingerprint === expected.executionFingerprint);
  const competingRecord = [...inventory.records.values()].some((candidate) =>
    candidate.recordId !== expected.recordId && (
      candidate.identityFingerprint === expected.reservationId ||
      candidate.durableLease?.identity.recordId === expected.recordId));
  const competingClaim = [...inventory.claims.values()].some((candidate) =>
    candidate.identity.claimId !== expected.claimId &&
    candidate.identity.recordId === expected.recordId && candidate.state === "active");
  const competingAttempt = [...inventory.attempts.values()].some((candidate) =>
    candidate.identity.attemptId !== expected.attemptId &&
    candidate.identity.recordId === expected.recordId &&
    !["succeeded", "failed", "cancelled", "abandoned"].includes(candidate.state));
  if (reservationAuthorities.length !== 1 ||
    reservationAuthorities[0]?.identity.identityFingerprint !== expected.reservationId ||
    competingRecord || competingClaim || competingAttempt) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_COMPETING_AUTHORITY" };
  }
  const baseRecordVersion = claimRequest.expectedIdempotencyVersion;
  const baseLeaseVersion = claimRequest.expectedLeaseVersion;
  const baseClaimVersion = context.request.coordinator.attempt.expectedClaimVersion;
  const initialVersionStateValid =
    (record.recordVersion === baseRecordVersion && record.state === "reserved" &&
      record.durableLease.version === baseLeaseVersion && record.durableLease.status === "active" &&
      claim.claimVersion === baseClaimVersion && claim.state === "active") ||
    (record.recordVersion === baseRecordVersion + 1 && record.state === "reserved" &&
      record.durableLease.version === baseLeaseVersion + 1 && record.durableLease.status === "released" &&
      ((claim.claimVersion === baseClaimVersion && claim.state === "active") ||
       (claim.claimVersion === baseClaimVersion + 1 &&
        ["abandoned", "released"].includes(claim.state)))) ||
    (record.recordVersion === baseRecordVersion + 2 &&
      ["cancelled", "failed"].includes(record.state) &&
      record.durableLease.version === baseLeaseVersion + 1 && record.durableLease.status === "released" &&
      claim.claimVersion === baseClaimVersion + 1 &&
      ["abandoned", "released"].includes(claim.state));
  const finalVersionStateValid = record.recordVersion === baseRecordVersion + 2 &&
    record.durableLease.version === baseLeaseVersion + 1 &&
    claim.claimVersion === baseClaimVersion + 1;
  if (requireQuiescence ? !finalVersionStateValid : !initialVersionStateValid) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_VERSION_BINDING_MISMATCH" };
  }
  if (requireQuiescence && (
    !["cancelled", "failed"].includes(record.state) ||
    record.durableLease.status !== "released" ||
    !["abandoned", "released"].includes(claim.state)
  )) {
    return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_NOT_QUIESCENT" };
  }
  if (requireQuiescence) {
    // Opt-in only: without a concrete (projectSlug, stage) pair to scope the
    // tolerance-authority lookup to, this is omitted and behavior is
    // unchanged from before ProductionOrphanReservationToleranceAuthority.ts
    // existed. jobId mirrors PipelineJobManager's own getJobId convention.
    const toleranceContext: ProductionOrphanReservationToleranceLookupContext | undefined =
      context.expectedProjectSlug && context.expectedStage
        ? { projectSlug: context.expectedProjectSlug,
            stage: context.expectedStage as ProductionStepKey,
            jobId: `${context.expectedProjectSlug}-${context.expectedStage}`,
            runtimeInput: context.storageContext }
        : undefined;
    const semantic = await readProductionExecutionRecoverySemanticAuthority(
      context.adapter, context.request.finishedAt,
      new ProductionExecutionLifecycle(context.adapter), toleranceContext);
    if (semantic.decision !== "ready" || semantic.activeReservationCount !== 0 ||
      semantic.counts.active !== 0 || semantic.counts.running !== 0) {
      return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_RECOVERY_AUTHORITY_NOT_READY" };
    }
  }
  const retryBudgetExtension = verifyRetryBudgetExtensionSiblingBinding({
    reservation, record, claim, attempt: durableAttempt,
    projectSlug: expectedProjectSlug, stage: expectedStage,
  });
  if (!retryBudgetExtension.ok) return retryBudgetExtension;
  return { ok: true, ...(retryBudgetExtension.binding
    ? { retryBudgetExtension: retryBudgetExtension.binding } : {}) };
}

function verifyRetryBudgetExtensionSiblingBinding(input: {
  readonly reservation: ProductionExecutionIdempotencyReservationRequest;
  readonly record: ProductionExecutionDurableRecord;
  readonly claim: ProductionExecutionDurableClaimRecord;
  readonly attempt: ProductionExecutionDurableAttemptRecord;
  readonly projectSlug?: string;
  readonly stage?: string;
}): { ok: true; binding?: RetryBudgetExtensionDurableBinding } |
  { ok: false; reasonCode: string } {
  const siblings = [input.reservation.retryBudgetExtension,
    input.record.retryBudgetExtension, input.record.durableLease?.retryBudgetExtension,
    input.claim.retryBudgetExtension, input.attempt.retryBudgetExtension];
  if (siblings.every((binding) => binding === undefined)) return { ok: true };
  if (siblings.some((binding) => binding === undefined)) {
    return { ok: false, reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_MISSING" };
  }
  const binding = siblings[0]!;
  if (siblings.some((candidate) => !sameRetryBudgetExtensionBinding(binding, candidate!)) ||
    !input.projectSlug || !input.stage || binding.schemaVersion !== "1" ||
    binding.authorizedDurableOrdinal !== 4 || binding.effectiveMaxAttempts !== 4 ||
    binding.authorizedRunType !== "resume" ||
    binding.authorizedOperation !== "pipeline.stage.resume" ||
    binding.durableAttemptOrdinal !== 4 || binding.projectSlug !== input.projectSlug ||
    binding.stage !== input.stage || binding.jobId !== `${input.projectSlug}-${input.stage}` ||
    binding.identityFingerprint !== input.record.identityFingerprint ||
    binding.reservationBinding !== input.reservation.identity.identityFingerprint ||
    input.record.operation !== "pipeline.stage.resume" ||
    input.attempt.identity.operation !== "pipeline.stage.resume" ||
    input.record.attempt !== 4 || input.record.maxAttempts !== 4) {
    return { ok: false,
      reasonCode: "PIPELINE_RETRY_BUDGET_EXTENSION_SIBLING_BINDING_MISMATCH" };
  }
  return { ok: true, binding };
}

function sameRetryBudgetExtensionBinding(left: RetryBudgetExtensionDurableBinding,
  right: RetryBudgetExtensionDurableBinding): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.authorityId === right.authorityId &&
    left.authorityIntegrityFingerprint === right.authorityIntegrityFingerprint &&
    left.consumptionReceiptFingerprint === right.consumptionReceiptFingerprint &&
    left.authorizedDurableOrdinal === right.authorizedDurableOrdinal &&
    left.effectiveMaxAttempts === right.effectiveMaxAttempts &&
    left.authorizedRunType === right.authorizedRunType &&
    left.authorizedOperation === right.authorizedOperation &&
    left.projectSlug === right.projectSlug && left.stage === right.stage &&
    left.jobId === right.jobId &&
    left.identityFingerprint === right.identityFingerprint &&
    left.reservationBinding === right.reservationBinding &&
    left.durableAttemptOrdinal === right.durableAttemptOrdinal;
}

function finalizeProductionPipelineRetryBudgetExtensionSettlement(input: {
  readonly storageContext: RuntimeStorageContext;
  readonly terminalAttemptFinalizedAt?: string;
  readonly binding: RetryBudgetExtensionDurableBinding;
}): { ok: true; writeFree: boolean } |
  { ok: false; reasonCode: string; causeReasonCode: string } {
  const { binding } = input;
  const authorityRead = readRetryBudgetExtensionAuthority(
    binding.projectSlug, binding.authorityId, input.storageContext);
  if (!authorityRead.ok || !authorityRead.value) return receiptBindingFailure(authorityRead.reasonCode);
  const authority = authorityRead.value;
  if (authority.integrity.fingerprint !== binding.authorityIntegrityFingerprint ||
    authority.projectSlug !== binding.projectSlug || authority.stage !== binding.stage ||
    authority.jobId !== binding.jobId ||
    authority.authorizedRunType !== binding.authorizedRunType ||
    authority.authorizedOperation !== binding.authorizedOperation ||
    authority.authorizedDurableOrdinal !== binding.authorizedDurableOrdinal ||
    authority.effectiveMaxAttempts !== binding.effectiveMaxAttempts) {
    return receiptBindingFailure("PIPELINE_RETRY_BUDGET_EXTENSION_AUTHORITY_BINDING_MISMATCH");
  }
  const consumedRead = readRetryBudgetExtensionReceipt(
    binding.projectSlug, binding.authorityId, "consumed", input.storageContext);
  if (!consumedRead.ok || !consumedRead.value ||
    consumedRead.value.integrity.fingerprint !== binding.consumptionReceiptFingerprint) {
    return receiptBindingFailure(consumedRead.ok
      ? "PIPELINE_RETRY_BUDGET_EXTENSION_CONSUMPTION_BINDING_MISMATCH"
      : consumedRead.reasonCode);
  }
  if (!input.terminalAttemptFinalizedAt) {
    return receiptBindingFailure("PIPELINE_RETRY_BUDGET_EXTENSION_TERMINAL_TIME_MISSING");
  }
  const expectedReceipt = buildProductionPipelineRetryBudgetExtensionReceipt(binding.authorityId,
    "settled", input.terminalAttemptFinalizedAt, consumedRead.value.jobVersion,
    ["terminal-settlement:settled-receipt-finalized"]);
  const settledRead = readRetryBudgetExtensionReceipt(
    binding.projectSlug, binding.authorityId, "settled", input.storageContext);
  if (settledRead.ok && settledRead.value) {
    return settledRead.value.integrity.fingerprint === expectedReceipt.integrity.fingerprint
      ? { ok: true, writeFree: true }
      : receiptBindingFailure("PIPELINE_RETRY_BUDGET_EXTENSION_SETTLED_BINDING_MISMATCH");
  }
  if (settledRead.status !== "not-found") return receiptBindingFailure(settledRead.reasonCode);
  const written = writeRetryBudgetExtensionReceipt(
    binding.projectSlug, expectedReceipt, input.storageContext);
  if (!written.ok) return { ok: false,
    reasonCode: "PIPELINE_FAILED_SETTLEMENT_RECEIPT_WRITE_FAILED",
    causeReasonCode: written.reasonCode };
  return { ok: true, writeFree: written.writeFree };
}

function receiptBindingFailure(causeReasonCode: string): {
  ok: false; reasonCode: string; causeReasonCode: string } {
  return { ok: false, reasonCode: "PIPELINE_FAILED_SETTLEMENT_RECEIPT_BINDING_FAILED",
    causeReasonCode };
}

interface FailedSettlementAuthorityInventory {
  readonly ok: true;
  readonly reservations: ReadonlyMap<string, ProductionExecutionIdempotencyReservationRequest>;
  readonly records: ReadonlyMap<string, ProductionExecutionDurableRecord>;
  readonly claims: ReadonlyMap<string, ProductionExecutionDurableClaimRecord>;
  readonly attempts: ReadonlyMap<string, ProductionExecutionDurableAttemptRecord>;
}

async function readFailedSettlementAuthorityInventory(
  adapter: ProductionExecutionPersistenceAdapter,
): Promise<FailedSettlementAuthorityInventory | { ok: false; reasonCode: string }> {
  const reservationList = await adapter.listKeys("reservation");
  if (!reservationList.ok) return authorityInventoryFailure("RESERVATION_LIST_FAILED");
  const reservations = new Map<string, ProductionExecutionIdempotencyReservationRequest>();
  for (const key of reservationList.keys) {
    const read = await adapter.read("reservation", key);
    if (read.status !== "found" || read.value.identity.identityFingerprint !== key ||
      reservations.has(key)) return authorityInventoryFailure("RESERVATION_AUTHORITY_INVALID");
    reservations.set(key, read.value);
  }
  const storage = new AdapterBackedProductionExecutionDurableStorage(adapter);
  const records = await readLatestVersionedAuthorities<ProductionExecutionDurableRecord>(
    adapter, "idempotency", (value) => value.recordId, (value) => value.recordVersion,
    (value) => storage.validateRecord(value).ok);
  if (!records.ok) return records;
  const claims = await readLatestVersionedAuthorities<ProductionExecutionDurableClaimRecord>(
    adapter, "claim", (value) => value.identity.claimId, (value) => value.claimVersion,
    validateProductionExecutionDurableClaim);
  if (!claims.ok) return claims;
  const attempts = await readLatestVersionedAuthorities<ProductionExecutionDurableAttemptRecord>(
    adapter, "attempt", (value) => value.identity.attemptId, (value) => value.attemptVersion,
    validateProductionExecutionDurableAttempt);
  if (!attempts.ok) return attempts;
  return { ok: true, reservations, records: records.latest,
    claims: claims.latest, attempts: attempts.latest };
}

async function readLatestVersionedAuthorities<T>(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: ProductionExecutionPersistenceRecordKind,
  identityOf: (value: T) => string,
  versionOf: (value: T) => number,
  validate: (value: T) => boolean,
): Promise<{ ok: true; latest: ReadonlyMap<string, T> } | { ok: false; reasonCode: string }> {
  const listed = await adapter.listKeys(kind);
  if (!listed.ok) return authorityInventoryFailure(`${kind.toUpperCase()}_LIST_FAILED`);
  const chains = new Map<string, Array<{ version: number; value: T }>>();
  for (const key of listed.keys) {
    const match = /^(.+)-v([1-9][0-9]*)$/.exec(key);
    if (!match) return authorityInventoryFailure(`${kind.toUpperCase()}_KEY_INVALID`);
    const read = await adapter.read(kind, key);
    if (read.status !== "found") return authorityInventoryFailure(`${kind.toUpperCase()}_READ_FAILED`);
    const value = read.value as T;
    const version = Number(match[2]);
    if (!validate(value) || identityOf(value) !== match[1] || versionOf(value) !== version) {
      return authorityInventoryFailure(`${kind.toUpperCase()}_VERSION_BINDING_INVALID`);
    }
    const chain = chains.get(match[1]) ?? [];
    chain.push({ version, value });
    chains.set(match[1], chain);
  }
  const latest = new Map<string, T>();
  for (const [identity, chain] of chains) {
    chain.sort((left, right) => left.version - right.version);
    if (chain.some((entry, index) => entry.version !== index + 1)) {
      return authorityInventoryFailure(`${kind.toUpperCase()}_VERSION_CHAIN_INVALID`);
    }
    latest.set(identity, chain.at(-1)!.value);
  }
  return { ok: true, latest };
}

function authorityInventoryFailure(reasonCode: string): { ok: false; reasonCode: string } {
  return { ok: false, reasonCode: /^[A-Z0-9_]{1,80}$/.test(reasonCode)
    ? reasonCode : "AUTHORITY_INVENTORY_INVALID" };
}

function sameReleasedLease(
  record: ProductionExecutionDurableRecord,
  context: ProductionPipelineFailedSettlementContext,
) {
  const lease = record.durableLease;
  return lease?.status === "released" &&
    lease.identity.leaseId === context.request.coordinator.attempt.leaseId &&
    lease.identity.workerId === context.request.coordinator.attempt.workerId &&
    lease.identity.workerSessionId === context.request.coordinator.attempt.workerSessionId;
}

async function latestArtifact<T>(
  adapter: ProductionExecutionPersistenceAdapter,
  kind: ProductionExecutionPersistenceRecordKind,
  identity: string,
): Promise<T | undefined> {
  const expression = new RegExp(`^${identity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-v([1-9][0-9]*)$`);
  for (let index = 0; index < 3; index += 1) {
    const listed = await adapter.listKeys(kind);
    if (listed.ok) {
      const key = listed.keys
        .map((candidate) => ({ candidate, match: expression.exec(candidate) }))
        .filter((item): item is { candidate: string; match: RegExpExecArray } => Boolean(item.match))
        .sort((left, right) => Number(right.match[1]) - Number(left.match[1]))[0]?.candidate;
      if (key) {
        const read = await adapter.read(kind, key);
        if (read.status === "found") return read.value as T;
      }
    }
    await Promise.resolve();
  }
  return undefined;
}

async function readRecordWithReplay(
  storage: AdapterBackedProductionExecutionDurableStorage,
  recordId: string,
): Promise<ProductionExecutionDurableRecord | undefined> {
  for (let index = 0; index < 3; index += 1) {
    const read = await storage.read(recordId);
    if (read.record) return read.record;
    await Promise.resolve();
  }
  return undefined;
}

async function latestArtifacts<T>(keys: readonly string[], read: (key: string) => Promise<T | undefined>): Promise<T[]> {
  const latest = new Map<string, { key: string; version: number }>();
  for (const key of keys) {
    const match = /^(.*)-v([1-9][0-9]*)$/.exec(key);
    if (!match) continue;
    const version = Number(match[2]), current = latest.get(match[1]);
    if (!current || version > current.version) latest.set(match[1], { key, version });
  }
  const values: T[] = [];
  for (const item of latest.values()) {
    const value = await read(item.key);
    if (value) values.push(value);
  }
  return values;
}
