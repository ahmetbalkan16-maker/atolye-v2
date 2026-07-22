import { stableProductionId } from "./ProductionDeterminism";
import type { ProductionExecutionIdempotencyEvaluationContext, ProductionExecutionIdempotencyIdentity, ProductionExecutionIdempotencyIdentityBuildContext, ProductionExecutionIdempotencyIdentityBuildInput, ProductionExecutionIdempotencyIdentityBuildResult, ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyReasonCode, ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReplayResult, ProductionExecutionIdempotencyReservationRequest, ProductionExecutionIdempotencyReservationValidationResult, ProductionExecutionIdempotencyState, ProductionExecutionIdempotencyTransitionRequest, ProductionExecutionIdempotencyTransitionResult, ProductionExecutionRecoveryEligibilityResult, ProductionExecutionRecoveryMode } from "@/types/productionExecutionIdempotency";
import { productionExecutionIdempotencySchemaVersion } from "@/types/productionExecutionIdempotency";

const states: readonly ProductionExecutionIdempotencyState[] = ["reserved", "prepared", "queued", "running", "succeeded", "failed", "cancelled", "partially-succeeded"];
const terminalStates: readonly ProductionExecutionIdempotencyState[] = ["succeeded", "failed", "cancelled", "partially-succeeded"];
const canonicalTransitions: Readonly<Record<ProductionExecutionIdempotencyState, readonly ProductionExecutionIdempotencyState[]>> = {
  reserved: ["prepared", "cancelled"], prepared: ["queued", "cancelled"], queued: ["running", "cancelled"], running: ["succeeded", "failed", "cancelled", "partially-succeeded"], succeeded: [], failed: ["reserved"], cancelled: ["reserved"], "partially-succeeded": ["reserved"],
};
const messages: Record<ProductionExecutionIdempotencyReasonCode, string> = {
  IDEMPOTENCY_VALID: "Idempotency contract is valid.", IDEMPOTENCY_POLICY_DISABLED: "Idempotency policy is disabled.", IDEMPOTENCY_IDENTITY_INVALID: "Idempotency identity is invalid.", IDEMPOTENCY_KEY_MISSING: "Idempotency key is required.", REQUEST_ID_MISSING: "Request ID is required.", EXECUTION_FINGERPRINT_MISSING: "Execution fingerprint is required.", BINDING_FINGERPRINT_MISSING: "Binding fingerprint is required.", AUTHORIZATION_NOT_ALLOWED: "Authorization does not allow reservation.", CONFIRMATION_REQUIRED: "A valid confirmation is required.", CONFIRMATION_INVALID: "Confirmation is invalid.", INITIAL_STATE_INVALID: "Initial state must be reserved.", ATTEMPT_INVALID: "Attempt is invalid.", MAX_ATTEMPTS_EXCEEDED: "Maximum attempts were exceeded.", RECORD_INVALID: "Idempotency record is invalid.", RECORD_STATE_UNKNOWN: "Record state is unknown.", TRANSITION_NOT_ALLOWED: "Lifecycle transition is not allowed.", TRANSITION_STATE_MISMATCH: "Transition source state does not match.", TRANSITION_VERSION_MISMATCH: "Transition version does not match.", TRANSITION_TIMESTAMP_INVALID: "Transition timestamp is invalid.", LEASE_REQUIRED: "A valid worker lease is required.", LEASE_INVALID: "Worker lease is invalid.", LEASE_EXPIRED: "Worker lease is expired.", WORKER_IDENTITY_REQUIRED: "Worker identity is required.", WORKER_SCOPE_DENIED: "Worker operation scope is denied.", DUPLICATE_IN_FLIGHT: "Equivalent execution is already in flight.", COMPLETED_REPLAY: "Completed result may be returned without execution.", IDEMPOTENCY_CONFLICT: "Idempotency identity conflicts with the existing record.", REQUEST_ID_CONFLICT: "Request ID conflicts with the existing record.", EXECUTION_FINGERPRINT_CONFLICT: "Execution fingerprint conflicts with the existing record.", BINDING_CONFLICT: "Binding conflicts with the existing record.", RETRY_NOT_ALLOWED: "Retry is not allowed.", RESUME_NOT_ALLOWED: "Resume is not allowed.", RECONCILE_REQUIRED: "Explicit reconciliation is required.", NEW_AUTHORIZATION_REQUIRED: "A new authorization decision is required.", NEW_CONFIRMATION_REQUIRED: "A new confirmation is required.", IDEMPOTENCY_INDETERMINATE: "Idempotency could not be evaluated safely.",
};

export const defaultProductionExecutionIdempotencyPolicy: ProductionExecutionIdempotencyPolicy = {
  policyVersion: "production-execution-idempotency-v1", enabled: false, reservationTtlSeconds: 300, leaseTtlSeconds: 60,
  maximumAttemptsByAction: { "retry-stage": 3, "resume-stage": 3 }, retryableStates: ["failed"], resumableStates: ["partially-succeeded"], reconcilableStates: ["partially-succeeded"],
  requireNewAuthorizationForRetry: true, requireNewConfirmationForRetry: true, requireNewAuthorizationForResume: true, requireNewConfirmationForResume: true,
  allowCompletedReplay: true, allowCancelledRetry: false, allowPartialResume: false, strictBinding: true, strictExecutionFingerprint: true,
};

export type ProductionExecutionReservationLifecycleState = "active" | "expired" | "invalid";

export function evaluateProductionExecutionReservationLifecycle(
  request: ProductionExecutionIdempotencyReservationRequest,
  evaluatedAt: string,
): ProductionExecutionReservationLifecycleState {
  const evaluated = canonicalDate(evaluatedAt);
  const requested = canonicalDate(request.requestedAt);
  if (!evaluated || !requested || !Number.isInteger(request.reservationTtlSeconds) ||
    request.reservationTtlSeconds < 1) return "invalid";
  return Date.parse(evaluated) >= Date.parse(requested) + request.reservationTtlSeconds * 1000
    ? "expired" : "active";
}

export function buildProductionExecutionIdempotencyIdentity(input: ProductionExecutionIdempotencyIdentityBuildInput, context: ProductionExecutionIdempotencyIdentityBuildContext): ProductionExecutionIdempotencyIdentityBuildResult {
  try {
    if (!context.policy.enabled) return failure("IDEMPOTENCY_POLICY_DISABLED");
    const { authorization, confirmation } = input;
    if (!authorization.authorized || authorization.decision !== "allow") return failure("AUTHORIZATION_NOT_ALLOWED");
    if (authorization.requiresConfirmation && !confirmation.valid) return failure(confirmation.confirmationId ? "CONFIRMATION_INVALID" : "CONFIRMATION_REQUIRED");
    if (!authorization.idempotencyKey) return failure("IDEMPOTENCY_KEY_MISSING"); if (!authorization.requestId) return failure("REQUEST_ID_MISSING");
    if (!authorization.executionFingerprint) return failure("EXECUTION_FINGERPRINT_MISSING");
    const bindingFingerprint = confirmation.valid ? confirmation.bindingFingerprint : "confirmation-not-required"; if (!bindingFingerprint) return failure("BINDING_FINGERPRINT_MISSING");
    const createdAt = canonicalDate(context.evaluatedAt); if (!createdAt) return failure("IDEMPOTENCY_IDENTITY_INVALID");
    const core = { idempotencyKey: authorization.idempotencyKey, requestId: authorization.requestId, executionFingerprint: authorization.executionFingerprint, bindingFingerprint, authorizationDecisionId: authorization.decisionId, confirmationRequestId: confirmation.confirmationRequestId, confirmationId: confirmation.confirmationId, actorId: authorization.actorId, projectSlug: authorization.projectSlug, operation: authorization.operation, action: authorization.action, ...(authorization.stage ? { stage: authorization.stage } : {}), policyVersion: context.policy.policyVersion, riskLevel: authorization.risk, createdAt };
    const identity: ProductionExecutionIdempotencyIdentity = { schemaVersion: productionExecutionIdempotencySchemaVersion, identityFingerprint: stableProductionId("idempotency-identity", core), ...core };
    return { ok: true, identity, reasonCode: "IDEMPOTENCY_VALID", reason: messages.IDEMPOTENCY_VALID, evidence: ["identity:built", `policy:${context.policy.policyVersion}`] };
  } catch { return failure("IDEMPOTENCY_INDETERMINATE"); }
}

export function validateProductionExecutionIdempotencyReservation(request: ProductionExecutionIdempotencyReservationRequest, policy: ProductionExecutionIdempotencyPolicy): ProductionExecutionIdempotencyReservationValidationResult {
  let reasonCode: ProductionExecutionIdempotencyReasonCode = "IDEMPOTENCY_VALID";
  if (!policy.enabled) reasonCode = "IDEMPOTENCY_POLICY_DISABLED";
  else if (!request.authorization.authorized || request.authorization.decision !== "allow") reasonCode = "AUTHORIZATION_NOT_ALLOWED";
  else if (request.authorization.requiresConfirmation && !request.confirmation.valid) reasonCode = request.confirmation.confirmationId ? "CONFIRMATION_INVALID" : "CONFIRMATION_REQUIRED";
  else if (request.expectedInitialState !== "reserved") reasonCode = "INITIAL_STATE_INVALID";
  else if (!Number.isInteger(request.attempt) || request.attempt < 1) reasonCode = "ATTEMPT_INVALID";
  else if (request.maxAttempts < request.attempt || request.maxAttempts > (policy.maximumAttemptsByAction[request.identity.action] ?? 1)) reasonCode = "MAX_ATTEMPTS_EXCEEDED";
  else if (request.reservationTtlSeconds !== policy.reservationTtlSeconds || request.policyContext.source !== "server" || request.metadata.source !== "server") reasonCode = "IDEMPOTENCY_IDENTITY_INVALID";
  return { valid: reasonCode === "IDEMPOTENCY_VALID", reasonCode, reason: messages[reasonCode], evidence: [`reason:${reasonCode}`] };
}

export function evaluateProductionExecutionIdempotencyTransition(record: ProductionExecutionIdempotencyRecord, transition: ProductionExecutionIdempotencyTransitionRequest, context: ProductionExecutionIdempotencyEvaluationContext): ProductionExecutionIdempotencyTransitionResult {
  try { return transitionEvaluation(record, transition, context); } catch { return transitionResult(record, transition, context, "IDEMPOTENCY_INDETERMINATE", "indeterminate"); }
}
function transitionEvaluation(record: ProductionExecutionIdempotencyRecord, transition: ProductionExecutionIdempotencyTransitionRequest, context: ProductionExecutionIdempotencyEvaluationContext) {
  if (!context.policy.enabled) return transitionResult(record, transition, context, "IDEMPOTENCY_POLICY_DISABLED");
  if (!states.includes(record.state as ProductionExecutionIdempotencyState) || !states.includes(transition.toState as ProductionExecutionIdempotencyState)) return transitionResult(record, transition, context, "RECORD_STATE_UNKNOWN");
  if (transition.fromState !== record.state || transition.recordId !== record.recordId || transition.idempotencyKey !== record.idempotencyKey) return transitionResult(record, transition, context, "TRANSITION_STATE_MISMATCH");
  if (transition.expectedVersion !== record.integrity.version) return transitionResult(record, transition, context, "TRANSITION_VERSION_MISMATCH");
  const transitionedAt = canonicalDate(transition.transitionedAt); if (!transitionedAt || Date.parse(transitionedAt) < Date.parse(record.updatedAt)) return transitionResult(record, transition, context, "TRANSITION_TIMESTAMP_INVALID");
  if (transition.attempt !== record.attempt || transition.attempt < 1) return transitionResult(record, transition, context, "ATTEMPT_INVALID");
  const from = record.state as ProductionExecutionIdempotencyState; const to = transition.toState as ProductionExecutionIdempotencyState;
  if (from === to || !canonicalTransitions[from].includes(to)) return transitionResult(record, transition, context, "TRANSITION_NOT_ALLOWED");
  if (to === "running") { const leaseFailure = validateLease(record, transition, context); if (leaseFailure) return transitionResult(record, transition, context, leaseFailure); }
  if (to === "reserved" && terminalStates.includes(from)) { const mode = from === "failed" || from === "cancelled" ? "retry" : "resume"; const eligibility = evaluateProductionExecutionRecoveryEligibility(record, mode, context); if (!eligibility.eligible) return transitionResult(record, transition, context, eligibility.reasonCode); }
  return transitionResult(record, transition, context, "IDEMPOTENCY_VALID", "allow");
}

export function evaluateProductionExecutionIdempotencyReplay(record: ProductionExecutionIdempotencyRecord, incoming: ProductionExecutionIdempotencyIdentity, context: ProductionExecutionIdempotencyEvaluationContext): ProductionExecutionIdempotencyReplayResult {
  try {
    if (!context.policy.enabled || !states.includes(record.state as ProductionExecutionIdempotencyState)) return replay(record, incoming, context.policy.enabled ? "RECORD_STATE_UNKNOWN" : "IDEMPOTENCY_POLICY_DISABLED", "invalid");
    if (record.requestId === incoming.requestId && record.idempotencyKey !== incoming.idempotencyKey) return replay(record, incoming, "REQUEST_ID_CONFLICT", "conflict");
    if (record.idempotencyKey !== incoming.idempotencyKey) return replay(record, incoming, "IDEMPOTENCY_CONFLICT", "conflict");
    if (context.policy.strictBinding && record.bindingFingerprint !== incoming.bindingFingerprint) return replay(record, incoming, "BINDING_CONFLICT", "conflict");
    if (context.policy.strictExecutionFingerprint && record.executionFingerprint !== incoming.executionFingerprint) return replay(record, incoming, "EXECUTION_FINGERPRINT_CONFLICT", "conflict");
    const state = record.state as ProductionExecutionIdempotencyState;
    if (["reserved", "prepared", "queued", "running"].includes(state)) return replay(record, incoming, "DUPLICATE_IN_FLIGHT", "duplicate-in-flight");
    if (state === "succeeded" && context.policy.allowCompletedReplay) return replay(record, incoming, "COMPLETED_REPLAY", "completed-replay");
    if (state === "failed") return replay(record, incoming, evaluateProductionExecutionRecoveryEligibility(record, "retry", context).reasonCode, "retry-candidate");
    if (state === "partially-succeeded") return replay(record, incoming, evaluateProductionExecutionRecoveryEligibility(record, "resume", context).reasonCode, "resume-candidate");
    return replay(record, incoming, "RETRY_NOT_ALLOWED", "invalid");
  } catch { return replay(record, incoming, "IDEMPOTENCY_INDETERMINATE", "invalid", "indeterminate"); }
}

export function evaluateProductionExecutionRecoveryEligibility(record: ProductionExecutionIdempotencyRecord, requestedMode: ProductionExecutionRecoveryMode, context: ProductionExecutionIdempotencyEvaluationContext): ProductionExecutionRecoveryEligibilityResult {
  const nextAttempt = record.attempt + 1; const maxAttempts = Math.min(record.maxAttempts, context.policy.maximumAttemptsByAction[record.action] ?? record.maxAttempts);
  const base = { nextAttempt, maxAttempts, requiresNewExecutionFingerprint: requestedMode !== "retry", allowedFromState: states.filter((state) => requestedMode === "retry" ? context.policy.retryableStates.includes(state) || (state === "cancelled" && context.policy.allowCancelledRetry) : requestedMode === "resume" ? context.policy.resumableStates.includes(state) : context.policy.reconcilableStates.includes(state)), recoveryMode: requestedMode };
  if (!context.policy.enabled) return { eligible: false, reasonCode: "IDEMPOTENCY_POLICY_DISABLED", requiresNewAuthorization: true, requiresNewConfirmation: true, ...base };
  if (nextAttempt > maxAttempts) return { eligible: false, reasonCode: "MAX_ATTEMPTS_EXCEEDED", requiresNewAuthorization: true, requiresNewConfirmation: true, ...base };
  if (requestedMode === "retry" && !base.allowedFromState.includes(record.state as ProductionExecutionIdempotencyState)) return { eligible: false, reasonCode: "RETRY_NOT_ALLOWED", requiresNewAuthorization: context.policy.requireNewAuthorizationForRetry, requiresNewConfirmation: context.policy.requireNewConfirmationForRetry, ...base };
  if (requestedMode === "resume" && (!context.policy.allowPartialResume || !base.allowedFromState.includes(record.state as ProductionExecutionIdempotencyState))) return { eligible: false, reasonCode: context.policy.reconcilableStates.includes(record.state as ProductionExecutionIdempotencyState) ? "RECONCILE_REQUIRED" : "RESUME_NOT_ALLOWED", requiresNewAuthorization: context.policy.requireNewAuthorizationForResume, requiresNewConfirmation: context.policy.requireNewConfirmationForResume, ...base };
  if (record.recovery?.confirmationSingleUseConsumed) return { eligible: false, reasonCode: "NEW_CONFIRMATION_REQUIRED", requiresNewAuthorization: true, requiresNewConfirmation: true, ...base };
  return { eligible: true, reasonCode: "IDEMPOTENCY_VALID", requiresNewAuthorization: requestedMode === "retry" ? context.policy.requireNewAuthorizationForRetry : context.policy.requireNewAuthorizationForResume, requiresNewConfirmation: requestedMode === "retry" ? context.policy.requireNewConfirmationForRetry : context.policy.requireNewConfirmationForResume, ...base };
}

function validateLease(record: ProductionExecutionIdempotencyRecord, transition: ProductionExecutionIdempotencyTransitionRequest, context: ProductionExecutionIdempotencyEvaluationContext): ProductionExecutionIdempotencyReasonCode | undefined {
  if (!transition.workerIdentity?.id) return "WORKER_IDENTITY_REQUIRED"; if (!transition.workerIdentity.operationScope.includes(record.operation)) return "WORKER_SCOPE_DENIED";
  const lease = transition.lease; if (!lease) return "LEASE_REQUIRED"; if (lease.status !== "active" || lease.workerId !== transition.workerIdentity.id || lease.version < 1 || !lease.workerOperationScope.includes(record.operation)) return "LEASE_INVALID";
  const expiresAt = canonicalDate(lease.expiresAt); const evaluatedAt = canonicalDate(context.evaluatedAt); if (!expiresAt || !evaluatedAt) return "LEASE_INVALID"; if (Date.parse(evaluatedAt) >= Date.parse(expiresAt)) return "LEASE_EXPIRED";
}
function transitionResult(record: ProductionExecutionIdempotencyRecord, transition: ProductionExecutionIdempotencyTransitionRequest, context: ProductionExecutionIdempotencyEvaluationContext, reasonCode: ProductionExecutionIdempotencyReasonCode, decision: "allow" | "deny" | "indeterminate" = "deny"): ProductionExecutionIdempotencyTransitionResult { const to = transition.toState as ProductionExecutionIdempotencyState; return { schemaVersion: productionExecutionIdempotencySchemaVersion, decision, allowed: decision === "allow", reasonCode, reason: messages[reasonCode], evaluatedAt: context.evaluatedAt, recordId: record.recordId, idempotencyKey: record.idempotencyKey, fromState: transition.fromState, toState: transition.toState, attempt: transition.attempt, terminal: terminalStates.includes(to), retryAllowed: to === "failed", resumeAllowed: to === "partially-succeeded", requiresNewConfirmation: to === "failed" || to === "partially-succeeded", requiresNewAuthorization: to === "failed" || to === "partially-succeeded", evidence: [`policy:${context.policy.policyVersion}`, `reason:${reasonCode}`] }; }
function replay(record: ProductionExecutionIdempotencyRecord, incoming: ProductionExecutionIdempotencyIdentity, reasonCode: ProductionExecutionIdempotencyReasonCode, replayType: ProductionExecutionIdempotencyReplayResult["replayType"], decision: ProductionExecutionIdempotencyReplayResult["decision"] = replayType === "duplicate-in-flight" || replayType === "completed-replay" ? "return-existing" : replayType === "retry-candidate" || replayType === "resume-candidate" ? "recovery-candidate" : "deny"): ProductionExecutionIdempotencyReplayResult { const sameIdentity = record.identityFingerprint === incoming.identityFingerprint; const sameBinding = record.bindingFingerprint === incoming.bindingFingerprint; const sameExecutionFingerprint = record.executionFingerprint === incoming.executionFingerprint; const eligibility = replayType === "retry-candidate" || replayType === "resume-candidate"; return { decision, replayType, allowed: decision !== "deny" && decision !== "indeterminate", reasonCode, reason: messages[reasonCode], existingState: record.state, sameIdentity, sameBinding, sameExecutionFingerprint, returnExistingResult: replayType === "completed-replay", retryAllowed: replayType === "retry-candidate" && reasonCode === "IDEMPOTENCY_VALID", resumeAllowed: replayType === "resume-candidate" && reasonCode === "IDEMPOTENCY_VALID", conflict: replayType === "conflict", requiresNewAuthorization: eligibility, requiresNewConfirmation: eligibility, evidence: [`reason:${reasonCode}`, `state:${record.state}`] }; }
function failure(reasonCode: ProductionExecutionIdempotencyReasonCode): ProductionExecutionIdempotencyIdentityBuildResult { return { ok: false, reasonCode, reason: messages[reasonCode], evidence: [`reason:${reasonCode}`] }; }
function canonicalDate(value: string) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return undefined; const canonical = new Date(parsed).toISOString(); return canonical === value ? canonical : undefined; }
