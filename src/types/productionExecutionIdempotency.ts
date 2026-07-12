import type { ProductionExecutionAuthorizationResult, ProductionExecutionAuthorizationRisk } from "./productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "./productionExecutionConfirmation";

export const productionExecutionIdempotencySchemaVersion = "1" as const;
export type ProductionExecutionIdempotencyState = "reserved" | "prepared" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partially-succeeded";
export type ProductionExecutionRecoveryMode = "retry" | "resume" | "reconcile" | "none";
export type ProductionExecutionIdempotencyReasonCode =
  | "IDEMPOTENCY_VALID" | "IDEMPOTENCY_POLICY_DISABLED" | "IDEMPOTENCY_IDENTITY_INVALID" | "IDEMPOTENCY_KEY_MISSING" | "REQUEST_ID_MISSING"
  | "EXECUTION_FINGERPRINT_MISSING" | "BINDING_FINGERPRINT_MISSING" | "AUTHORIZATION_NOT_ALLOWED" | "CONFIRMATION_REQUIRED" | "CONFIRMATION_INVALID"
  | "INITIAL_STATE_INVALID" | "ATTEMPT_INVALID" | "MAX_ATTEMPTS_EXCEEDED" | "RECORD_INVALID" | "RECORD_STATE_UNKNOWN"
  | "TRANSITION_NOT_ALLOWED" | "TRANSITION_STATE_MISMATCH" | "TRANSITION_VERSION_MISMATCH" | "TRANSITION_TIMESTAMP_INVALID"
  | "LEASE_REQUIRED" | "LEASE_INVALID" | "LEASE_EXPIRED" | "WORKER_IDENTITY_REQUIRED" | "WORKER_SCOPE_DENIED"
  | "DUPLICATE_IN_FLIGHT" | "COMPLETED_REPLAY" | "IDEMPOTENCY_CONFLICT" | "REQUEST_ID_CONFLICT" | "EXECUTION_FINGERPRINT_CONFLICT"
  | "BINDING_CONFLICT" | "RETRY_NOT_ALLOWED" | "RESUME_NOT_ALLOWED" | "RECONCILE_REQUIRED" | "NEW_AUTHORIZATION_REQUIRED"
  | "NEW_CONFIRMATION_REQUIRED" | "IDEMPOTENCY_INDETERMINATE";

export interface ProductionExecutionIdempotencyIdentity {
  schemaVersion: typeof productionExecutionIdempotencySchemaVersion; identityFingerprint: string; idempotencyKey: string; requestId: string;
  executionFingerprint: string; bindingFingerprint: string; authorizationDecisionId: string; confirmationRequestId: string; confirmationId: string;
  actorId: string; projectSlug: string; operation: string; action: string; stage?: string; policyVersion: string;
  riskLevel: ProductionExecutionAuthorizationRisk; createdAt: string;
}
export interface ProductionExecutionIdempotencyIdentityBuildInput {
  authorization: ProductionExecutionAuthorizationResult; confirmation: ProductionExecutionConfirmationValidationResult;
}
export interface ProductionExecutionIdempotencyIdentityBuildContext { evaluatedAt: string; policy: ProductionExecutionIdempotencyPolicy }
export interface ProductionExecutionIdempotencyIdentityBuildResult { ok: boolean; identity?: ProductionExecutionIdempotencyIdentity; reasonCode: ProductionExecutionIdempotencyReasonCode; reason: string; evidence: string[] }

export interface ProductionExecutionIdempotencyLease { leaseId: string; workerId: string; workerOperationScope: readonly string[]; acquiredAt: string; expiresAt: string; heartbeatAt: string; version: number; status: "active" | "expired" | "released" | "invalid" }
export interface ProductionExecutionIdempotencyResultMetadata { resultFingerprint: string; summary: string; completedAt: string; outputReferences: readonly string[]; partial: boolean }
export interface ProductionExecutionIdempotencyFailureMetadata { failureCode: string; category: "validation" | "authorization" | "confirmation" | "provider" | "persistence" | "worker" | "unknown"; retryable: boolean; resumePossible: boolean; failedAt: string; safeMessage: string }
export interface ProductionExecutionIdempotencyRecoveryMetadata { mode: ProductionExecutionRecoveryMode; previousRecordId?: string; checkpointFingerprint?: string; confirmationSingleUseConsumed: boolean }
export interface ProductionExecutionIdempotencyRecord extends Omit<ProductionExecutionIdempotencyIdentity, "identityFingerprint"> {
  recordId: string; identityFingerprint: string; state: string; attempt: number; maxAttempts: number; createdAt: string; updatedAt: string;
  reservedAt?: string; preparedAt?: string; queuedAt?: string; startedAt?: string; finishedAt?: string;
  lease?: ProductionExecutionIdempotencyLease; result?: ProductionExecutionIdempotencyResultMetadata; failure?: ProductionExecutionIdempotencyFailureMetadata;
  recovery?: ProductionExecutionIdempotencyRecoveryMetadata; evidence: readonly string[]; integrity: { algorithm: "stable-production-id-v1"; fingerprint: string; version: number };
}
export interface ProductionExecutionIdempotencyReservationRequest {
  schemaVersion: typeof productionExecutionIdempotencySchemaVersion; identity: ProductionExecutionIdempotencyIdentity;
  authorization: ProductionExecutionAuthorizationResult; confirmation: ProductionExecutionConfirmationValidationResult;
  requestedAt: string; expectedInitialState: "reserved"; attempt: number; maxAttempts: number; reservationTtlSeconds: number;
  policyContext: { source: "server"; environment: "local" | "hosted" | "test" }; metadata: { source: "server" };
}
export interface ProductionExecutionIdempotencyReservationValidationResult { valid: boolean; reasonCode: ProductionExecutionIdempotencyReasonCode; reason: string; evidence: string[] }
export interface ProductionExecutionIdempotencyTransitionRequest {
  schemaVersion: typeof productionExecutionIdempotencySchemaVersion; recordId: string; idempotencyKey: string; fromState: string; toState: string;
  expectedVersion: number; attempt: number; transitionedAt: string; actorId: string; workerIdentity?: { id: string; operationScope: readonly string[] };
  reasonCode: string; result?: ProductionExecutionIdempotencyResultMetadata; failure?: ProductionExecutionIdempotencyFailureMetadata;
  recovery?: ProductionExecutionIdempotencyRecoveryMetadata; lease?: ProductionExecutionIdempotencyLease; evidence: readonly string[];
}
export interface ProductionExecutionIdempotencyTransitionResult {
  schemaVersion: typeof productionExecutionIdempotencySchemaVersion; decision: "allow" | "deny" | "indeterminate"; allowed: boolean;
  reasonCode: ProductionExecutionIdempotencyReasonCode; reason: string; evaluatedAt: string; recordId: string; idempotencyKey: string;
  fromState: string; toState: string; attempt: number; terminal: boolean; retryAllowed: boolean; resumeAllowed: boolean;
  requiresNewConfirmation: boolean; requiresNewAuthorization: boolean; evidence: string[];
}
export interface ProductionExecutionIdempotencyReplayResult {
  decision: "return-existing" | "recovery-candidate" | "deny" | "indeterminate"; replayType: "same-request" | "duplicate-in-flight" | "completed-replay" | "retry-candidate" | "resume-candidate" | "conflict" | "invalid";
  allowed: boolean; reasonCode: ProductionExecutionIdempotencyReasonCode; reason: string; existingState: string; sameIdentity: boolean; sameBinding: boolean;
  sameExecutionFingerprint: boolean; returnExistingResult: boolean; retryAllowed: boolean; resumeAllowed: boolean; conflict: boolean;
  requiresNewAuthorization: boolean; requiresNewConfirmation: boolean; evidence: string[];
}
export interface ProductionExecutionRecoveryEligibilityResult { eligible: boolean; reasonCode: ProductionExecutionIdempotencyReasonCode; nextAttempt: number; maxAttempts: number; requiresNewAuthorization: boolean; requiresNewConfirmation: boolean; requiresNewExecutionFingerprint: boolean; allowedFromState: ProductionExecutionIdempotencyState[]; recoveryMode: ProductionExecutionRecoveryMode }
export interface ProductionExecutionIdempotencyPolicy {
  policyVersion: string; enabled: boolean; reservationTtlSeconds: number; leaseTtlSeconds: number; maximumAttemptsByAction: Readonly<Record<string, number>>;
  retryableStates: readonly ProductionExecutionIdempotencyState[]; resumableStates: readonly ProductionExecutionIdempotencyState[]; reconcilableStates: readonly ProductionExecutionIdempotencyState[];
  requireNewAuthorizationForRetry: boolean; requireNewConfirmationForRetry: boolean; requireNewAuthorizationForResume: boolean; requireNewConfirmationForResume: boolean;
  allowCompletedReplay: boolean; allowCancelledRetry: boolean; allowPartialResume: boolean; strictBinding: boolean; strictExecutionFingerprint: boolean;
}
export interface ProductionExecutionIdempotencyEvaluationContext { evaluatedAt: string; policy: ProductionExecutionIdempotencyPolicy }
