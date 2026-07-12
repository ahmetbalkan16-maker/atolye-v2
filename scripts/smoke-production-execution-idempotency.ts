import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy, evaluateProductionExecutionIdempotencyReplay, evaluateProductionExecutionIdempotencyTransition, evaluateProductionExecutionRecoveryEligibility, validateProductionExecutionIdempotencyReservation } from "../src/lib/production/ProductionExecutionIdempotency";
import type { ProductionExecutionAuthorizationResult } from "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "../src/types/productionExecutionConfirmation";
import type { ProductionExecutionIdempotencyIdentity, ProductionExecutionIdempotencyLease, ProductionExecutionIdempotencyPolicy, ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest, ProductionExecutionIdempotencyTransitionRequest } from "../src/types/productionExecutionIdempotency";

const now = "2026-07-12T12:00:00.000Z"; const later = "2026-07-12T12:01:00.000Z"; const operation = "pipeline.stage.retry.preview";
const policy: ProductionExecutionIdempotencyPolicy = { ...defaultProductionExecutionIdempotencyPolicy, enabled: true, policyVersion: "idempotency-policy-v1", allowPartialResume: true };
const authorization: ProductionExecutionAuthorizationResult = { schemaVersion: "1", decisionId: "authorization-1", decision: "allow", authorized: true, reasonCode: "AUTHORIZED", reason: "safe", evaluatedAt: now, requestId: "request-1", idempotencyKey: "execution-1", executionFingerprint: "snapshot-1", actorId: "actor-1", actorType: "user", projectSlug: "project-1", operation, action: "retry-stage", stage: "script", requiredCapabilities: [], grantedCapabilities: [], missingCapabilities: [], policyVersion: "authorization-policy-v1", risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high", evidence: [] };
const confirmation: ProductionExecutionConfirmationValidationResult = { schemaVersion: "1", decision: "valid", valid: true, reasonCode: "CONFIRMATION_VALID", reason: "safe", evaluatedAt: now, confirmationId: "confirmation-1", confirmationRequestId: "confirmation-request-1", authorizationDecisionId: "authorization-1", requestId: "request-1", idempotencyKey: "execution-1", actorId: "actor-1", projectSlug: "project-1", operation, action: "retry-stage", stage: "script", riskLevel: "high", requiredConfirmationLevel: "high", providedConfirmationLevel: "high", bindingMatches: true, bindingFingerprint: "confirmation-binding-1", expired: false, singleUse: true, consumed: false, policyVersion: "authorization-policy-v1", evidence: [] };
const built = buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, { evaluatedAt: now, policy }); assert.equal(built.ok, true); const identity = built.identity!;

function record(state: string = "reserved", override: Partial<ProductionExecutionIdempotencyRecord> = {}): ProductionExecutionIdempotencyRecord {
  return { schemaVersion: "1", recordId: "record-1", identityFingerprint: identity.identityFingerprint, idempotencyKey: identity.idempotencyKey, requestId: identity.requestId, executionFingerprint: identity.executionFingerprint, bindingFingerprint: identity.bindingFingerprint, actorId: identity.actorId, projectSlug: identity.projectSlug, operation: identity.operation, action: identity.action, stage: identity.stage, authorizationDecisionId: identity.authorizationDecisionId, confirmationRequestId: identity.confirmationRequestId, confirmationId: identity.confirmationId, policyVersion: identity.policyVersion, riskLevel: identity.riskLevel, state, attempt: 1, maxAttempts: 3, createdAt: now, updatedAt: now, reservedAt: now, evidence: [], integrity: { algorithm: "stable-production-id-v1", fingerprint: identity.identityFingerprint, version: 1 }, ...override };
}
const lease: ProductionExecutionIdempotencyLease = { leaseId: "lease-1", workerId: "worker-1", workerOperationScope: [operation], acquiredAt: now, heartbeatAt: now, expiresAt: "2026-07-12T12:02:00.000Z", version: 1, status: "active" };
function transition(fromState: string, toState: string, override: Partial<ProductionExecutionIdempotencyTransitionRequest> = {}): ProductionExecutionIdempotencyTransitionRequest { return { schemaVersion: "1", recordId: "record-1", idempotencyKey: "execution-1", fromState, toState, expectedVersion: 1, attempt: 1, transitionedAt: later, actorId: "actor-1", reasonCode: "test", evidence: [], ...(toState === "running" ? { workerIdentity: { id: "worker-1", operationScope: [operation] }, lease } : {}), ...override }; }
const context = { evaluatedAt: later, policy };
function reservation(override: Partial<ProductionExecutionIdempotencyReservationRequest> = {}): ProductionExecutionIdempotencyReservationRequest { return { schemaVersion: "1", identity, authorization, confirmation, requestedAt: now, expectedInitialState: "reserved", attempt: 1, maxAttempts: 3, reservationTtlSeconds: policy.reservationTtlSeconds, policyContext: { source: "server", environment: "test" }, metadata: { source: "server" }, ...override }; }

async function main() {
  assert.equal(built.reasonCode, "IDEMPOTENCY_VALID");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, { evaluatedAt: now, policy: { ...policy, enabled: false } }).reasonCode, "IDEMPOTENCY_POLICY_DISABLED");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization: { ...authorization, idempotencyKey: "" }, confirmation }, { evaluatedAt: now, policy }).reasonCode, "IDEMPOTENCY_KEY_MISSING");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization: { ...authorization, requestId: "" }, confirmation }, { evaluatedAt: now, policy }).reasonCode, "REQUEST_ID_MISSING");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization: { ...authorization, executionFingerprint: "" }, confirmation }, { evaluatedAt: now, policy }).reasonCode, "EXECUTION_FINGERPRINT_MISSING");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation: { ...confirmation, bindingFingerprint: "" } }, { evaluatedAt: now, policy }).reasonCode, "BINDING_FINGERPRINT_MISSING");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization: { ...authorization, authorized: false, decision: "deny" }, confirmation }, { evaluatedAt: now, policy }).reasonCode, "AUTHORIZATION_NOT_ALLOWED");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation: { ...confirmation, valid: false, confirmationId: "" } }, { evaluatedAt: now, policy }).reasonCode, "CONFIRMATION_REQUIRED");
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation: { ...confirmation, valid: false } }, { evaluatedAt: now, policy }).reasonCode, "CONFIRMATION_INVALID");
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation({ expectedInitialState: "prepared" as "reserved" }), policy).reasonCode, "INITIAL_STATE_INVALID");
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation({ attempt: 0 }), policy).reasonCode, "ATTEMPT_INVALID");
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation({ attempt: -1 }), policy).reasonCode, "ATTEMPT_INVALID");
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation({ attempt: 4 }), policy).reasonCode, "MAX_ATTEMPTS_EXCEEDED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("reserved"), transition("reserved", "prepared"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("prepared"), transition("prepared", "queued"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("running"), transition("running", "succeeded"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("running"), transition("running", "failed"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("running"), transition("running", "cancelled"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("running"), transition("running", "partially-succeeded"), context).allowed, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("reserved"), transition("reserved", "running"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "succeeded"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("succeeded"), transition("succeeded", "running"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "queued"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("mystery"), transition("mystery", "queued"), context).reasonCode, "RECORD_STATE_UNKNOWN");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("reserved"), transition("reserved", "prepared", { expectedVersion: 2 }), context).reasonCode, "TRANSITION_VERSION_MISMATCH");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("reserved"), transition("reserved", "prepared", { transitionedAt: "not-a-date" }), context).reasonCode, "TRANSITION_TIMESTAMP_INVALID");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running", { workerIdentity: undefined }), context).reasonCode, "WORKER_IDENTITY_REQUIRED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running", { workerIdentity: { id: "worker-1", operationScope: [] } }), context).reasonCode, "WORKER_SCOPE_DENIED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running", { lease: undefined }), context).reasonCode, "LEASE_REQUIRED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running", { lease: { ...lease, expiresAt: now } }), context).reasonCode, "LEASE_EXPIRED");
  for (const state of ["reserved", "running"] as const) assert.equal(evaluateProductionExecutionIdempotencyReplay(record(state), identity, context).reasonCode, "DUPLICATE_IN_FLIGHT");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record("succeeded"), identity, context).reasonCode, "COMPLETED_REPLAY");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record("failed"), identity, context).replayType, "retry-candidate");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record("partially-succeeded"), identity, context).replayType, "resume-candidate");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record(), { ...identity, bindingFingerprint: "other" }, context).reasonCode, "BINDING_CONFLICT");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record(), { ...identity, executionFingerprint: "other" }, context).reasonCode, "EXECUTION_FINGERPRINT_CONFLICT");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record(), { ...identity, idempotencyKey: "other" }, context).reasonCode, "REQUEST_ID_CONFLICT");
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("failed"), "retry", context).eligible, true);
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("failed"), "retry", { evaluatedAt: later, policy: { ...policy, retryableStates: [] } }).reasonCode, "RETRY_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("partially-succeeded"), "resume", context).eligible, true);
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("partially-succeeded"), "resume", { evaluatedAt: later, policy: { ...policy, allowPartialResume: false } }).reasonCode, "RECONCILE_REQUIRED");
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("succeeded"), "retry", context).reasonCode, "RETRY_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("failed", { attempt: 3 }), "retry", context).reasonCode, "MAX_ATTEMPTS_EXCEEDED");
  const retry = evaluateProductionExecutionRecoveryEligibility(record("failed"), "retry", context); assert.equal(retry.requiresNewAuthorization, true); assert.equal(retry.requiresNewConfirmation, true);
  const resume = evaluateProductionExecutionRecoveryEligibility(record("partially-succeeded"), "resume", context); assert.equal(resume.requiresNewAuthorization, true); assert.equal(resume.requiresNewConfirmation, true);
  assert.equal(evaluateProductionExecutionRecoveryEligibility(record("failed", { recovery: { mode: "retry", confirmationSingleUseConsumed: true } }), "retry", context).reasonCode, "NEW_CONFIRMATION_REQUIRED");
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation({ policyContext: { source: "client" as "server", environment: "local" } }), policy).valid, false);
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, { evaluatedAt: now, policy }).identity?.identityFingerprint, identity.identityFingerprint);
  const reordered: ProductionExecutionIdempotencyIdentity = { createdAt: identity.createdAt, riskLevel: identity.riskLevel, policyVersion: identity.policyVersion, stage: identity.stage, action: identity.action, operation: identity.operation, projectSlug: identity.projectSlug, actorId: identity.actorId, confirmationId: identity.confirmationId, confirmationRequestId: identity.confirmationRequestId, authorizationDecisionId: identity.authorizationDecisionId, bindingFingerprint: identity.bindingFingerprint, executionFingerprint: identity.executionFingerprint, requestId: identity.requestId, idempotencyKey: identity.idempotencyKey, identityFingerprint: identity.identityFingerprint, schemaVersion: "1" }; assert.deepEqual(reordered, identity);
  assert.notEqual(identity.identityFingerprint, buildProductionExecutionIdempotencyIdentity({ authorization: { ...authorization, idempotencyKey: "execution-2" }, confirmation: { ...confirmation, idempotencyKey: "execution-2" } }, { evaluatedAt: now, policy }).identity?.identityFingerprint);
  const frozen = [structuredClone(authorization), structuredClone(confirmation), structuredClone(policy), structuredClone(identity), structuredClone(lease)]; evaluateProductionExecutionIdempotencyReplay(record(), identity, context); evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running"), context); assert.deepEqual([authorization, confirmation, policy, identity, lease], frozen);
  assert.deepEqual(evaluateProductionExecutionIdempotencyReplay(record(), identity, context), evaluateProductionExecutionIdempotencyReplay(record(), identity, context));
  assert.equal(buildProductionExecutionIdempotencyIdentity({ authorization, confirmation }, { evaluatedAt: "bad-date", policy }).reasonCode, "IDEMPOTENCY_IDENTITY_INVALID");
  const unsafeRecord = record("failed", { failure: { failureCode: "X", category: "unknown", retryable: true, resumePossible: false, failedAt: now, safeMessage: "secret C:\\private stack trace" } }); const publicText = JSON.stringify(evaluateProductionExecutionIdempotencyReplay(unsafeRecord, identity, context)); assert.ok(!/secret|C:\\private|stack trace/i.test(publicText));
  assert.equal(defaultProductionExecutionIdempotencyPolicy.enabled, false);
  assert.equal(validateProductionExecutionIdempotencyReservation(reservation(), policy).valid, true);
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("queued"), transition("queued", "running", { lease: { ...lease, status: "released" } }), context).reasonCode, "LEASE_INVALID");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("prepared"), transition("prepared", "running"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyTransition(record("failed"), transition("failed", "running"), context).reasonCode, "TRANSITION_NOT_ALLOWED");
  assert.equal(evaluateProductionExecutionIdempotencyReplay(record("cancelled"), identity, context).allowed, false);
  const source = await readFile("src/lib/production/ProductionExecutionIdempotency.ts", "utf8"); assert.ok(!/writeFile|writeJSON|saveJson|fetch\(|enqueue\(|dispatch\(|process\.env|Date\.now|Math\.random|randomUUID|setInterval|mutex|heartbeat\s*\(/i.test(source));
  console.log("Sprint 97.3 production execution idempotency smoke: PASS (60 scenarios)");
}
void main();
