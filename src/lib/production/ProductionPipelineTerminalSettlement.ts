import { stableProductionId } from "./ProductionDeterminism";
import { AdapterBackedProductionExecutionDurableStorage } from "./ProductionExecutionDurableStorage";
import { AdapterBackedProductionExecutionDurableLeaseService } from "./ProductionExecutionDurableLease";
import { AdapterBackedProductionExecutionClaimService } from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionIdempotencyPolicy } from "./ProductionExecutionIdempotency";
import { defaultProductionExecutionDurableLeasePolicy } from "./ProductionExecutionDurableLease";
import { defaultProductionExecutionClaimPolicy } from "./ProductionExecutionDurableClaim";
import { defaultProductionExecutionAttemptPolicy } from "./ProductionExecutionDurableAttempt";
import type { ProductionExecutionPersistenceAdapter } from "@/types/productionExecutionPersistence";
import type { ProductionExecutionDurableRecord } from "@/types/productionExecutionDurableStorage";
import type { ProductionExecutionDurableAttemptRecord } from "@/types/productionExecutionDurableAttempt";
import type { ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyState, ProductionExecutionIdempotencyTransitionRequest } from "@/types/productionExecutionIdempotency";
import type { ProductionExecutionDurableLeasePolicy, ProductionExecutionDurableWorkerIdentity, ProductionExecutionWorkerSessionIdentity } from "@/types/productionExecutionDurableLease";
import type { ProductionExecutionWorkerExecutionRequest, ProductionExecutionWorkerExecutionResult } from "@/types/productionExecutionWorker";

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
  reasonCode: string;
}

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
