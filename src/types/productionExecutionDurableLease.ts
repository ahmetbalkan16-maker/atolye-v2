import type { ProductionExecutionDurableRecord } from "./productionExecutionDurableStorage";
import type { ProductionExecutionPersistenceDiagnostic } from "./productionExecutionPersistence";

export const productionExecutionDurableLeaseSchemaVersion = "1" as const;
export type ProductionExecutionDurableLeaseReasonCode =
  | "LEASE_ACQUIRED" | "LEASE_REPLAYED" | "LEASE_ACTIVE" | "LEASE_EXPIRED" | "LEASE_RELEASED" | "LEASE_CANCELLED" | "LEASE_NOT_FOUND"
  | "LEASE_OWNER_MISMATCH" | "LEASE_SESSION_MISMATCH" | "LEASE_ID_CONFLICT" | "LEASE_OWNERSHIP_CONFLICT"
  | "LEASE_VERSION_CONFLICT" | "LEASE_STALE_WRITE" | "LEASE_NEXT_VERSION_CONFLICT"
  | "LEASE_INTERVAL_INVALID" | "LEASE_TIMESTAMP_INVALID" | "LEASE_HEARTBEAT_STALE" | "LEASE_RENEWAL_INVALID" | "RESERVATION_EXPIRED"
  | "LEASE_TERMINAL_STATE" | "LEASE_TRANSITION_INVALID" | "LEASE_TAKEOVER_NOT_ALLOWED" | "LEASE_TAKEOVER_ALLOWED"
  | "LEASE_RECORD_MALFORMED" | "LEASE_INTEGRITY_MISMATCH" | "LEASE_RECOVERY_REQUIRED" | "LEASE_ATOMIC_COMMIT_FAILED" | "LEASE_READBACK_FAILED"
  | "LEASE_PATH_INVALID" | "LEASE_TRAVERSAL_DENIED" | "LEASE_INDETERMINATE";

export interface ProductionExecutionDurableWorkerIdentity { schemaVersion: typeof productionExecutionDurableLeaseSchemaVersion; workerId: string; workerType: "server"; operationScope: readonly string[]; identitySource: "trusted-server" }
export interface ProductionExecutionWorkerSessionIdentity { schemaVersion: typeof productionExecutionDurableLeaseSchemaVersion; workerSessionId: string; workerId: string; startedAt: string; identitySource: "trusted-server" }
export interface ProductionExecutionDurableLeaseIdentity { leaseId: string; workerId: string; workerSessionId: string; recordId: string; idempotencyKey: string; requestId: string; executionFingerprint: string }
export interface ProductionExecutionLeaseOwnershipEvidence { ownerFingerprint: string; workerEvidence: string; sessionEvidence: string; previousOwnerFingerprint?: string }
export interface ProductionExecutionDurableLease {
  schemaVersion: typeof productionExecutionDurableLeaseSchemaVersion; identity: ProductionExecutionDurableLeaseIdentity;
  status: "active" | "released" | "cancelled"; acquiredAt: string; heartbeatAt: string; expiresAt: string; releasedAt?: string; cancelledAt?: string;
  version: number; ownership: ProductionExecutionLeaseOwnershipEvidence; integrity: { algorithm: "stable-production-id-v1"; fingerprint: string };
}
export interface ProductionExecutionDurableLeasePolicy { policyVersion: string; reservationTtlSeconds: number; minimumLeaseDurationSeconds: number; maximumLeaseDurationSeconds: number; maximumRenewalWindowSeconds: number }
interface LeaseMutationBase { recordId: string; expectedVersion: number; evaluatedAt: string; worker: ProductionExecutionDurableWorkerIdentity; session: ProductionExecutionWorkerSessionIdentity; leaseId: string }
export interface ProductionExecutionLeaseAcquisitionRequest extends LeaseMutationBase { acquiredAt: string; heartbeatAt: string; expiresAt: string }
export interface ProductionExecutionLeaseHeartbeatRequest extends LeaseMutationBase { heartbeatAt: string; expiresAt: string }
export interface ProductionExecutionLeaseReleaseRequest extends LeaseMutationBase { releasedAt: string }
export interface ProductionExecutionLeaseTakeoverRequest extends LeaseMutationBase { acquiredAt: string; heartbeatAt: string; expiresAt: string }
export interface ProductionExecutionLeaseEvaluationRequest { recordId: string; evaluatedAt: string; workerId?: string; workerSessionId?: string; leaseId?: string }
export type ProductionExecutionLeaseEvaluationState = "active" | "expired" | "released" | "cancelled" | "ownership-mismatch" | "indeterminate";
export interface ProductionExecutionLeaseConflictDiagnostic { category: "owner" | "session" | "lease-id" | "version" | "state" | "integrity"; expectedVersion?: number; actualVersion?: number; publicCode: ProductionExecutionDurableLeaseReasonCode }
export interface ProductionExecutionLeaseOperationResult {
  schemaVersion: typeof productionExecutionDurableLeaseSchemaVersion; ok: boolean; decision: "acquired" | "renewed" | "released" | "taken-over" | "replayed" | "deny" | "indeterminate";
  reasonCode: ProductionExecutionDurableLeaseReasonCode; reason: string; lease?: ProductionExecutionDurableLease; record?: ProductionExecutionDurableRecord;
  expectedVersion?: number; actualVersion?: number; conflict?: ProductionExecutionLeaseConflictDiagnostic; evidence: readonly string[]; diagnostics?: readonly ProductionExecutionPersistenceDiagnostic[];
}
export interface ProductionExecutionLeaseEvaluationResult { schemaVersion: typeof productionExecutionDurableLeaseSchemaVersion; state: ProductionExecutionLeaseEvaluationState; reasonCode: ProductionExecutionDurableLeaseReasonCode; takeoverAllowed: boolean; lease?: ProductionExecutionDurableLease; evidence: readonly string[] }
