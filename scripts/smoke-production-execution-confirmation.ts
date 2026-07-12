import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateProductionExecutionAuthorization } from "../src/lib/production/ProductionExecutionAuthorization";
import { buildProductionExecutionConfirmationRequest, defaultProductionExecutionConfirmationPolicy, productionExecutionConfirmationBindingFingerprint, validateProductionExecutionConfirmation } from "../src/lib/production/ProductionExecutionConfirmation";
import { productionCapabilityMatrix } from "../src/lib/production/ProductionExecutionSafetyPlan";
import type { ProductionExecutionAuthorizationPolicy, ProductionExecutionAuthorizationRequest, ProductionExecutionAuthorizationResult } from "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationGrant, ProductionExecutionConfirmationPolicy, ProductionExecutionConfirmationRequest } from "../src/types/productionExecutionConfirmation";
import type { ProductionExecutionRequest } from "../src/types/productionIntelligence";

const requestedAt = "2026-07-12T10:00:00.000Z";
const issuedAt = "2026-07-12T10:00:30.000Z";
const evaluatedAt = "2026-07-12T10:01:00.000Z";
const operation = "pipeline.stage.retry.preview";
const authorizationRequest: ProductionExecutionAuthorizationRequest = {
  schemaVersion: "1", actor: { id: "actor-1", type: "user", authenticated: true, trusted: true, identitySource: "server-session", allowedProjects: ["project-1"], allowedOperations: [operation] },
  project: { slug: "project-1" }, operation, action: "retry-stage", stage: "script", workerIdentity: { id: "worker-1", authenticated: true, trusted: true, identitySource: "worker-registry", allowedOperations: [operation] },
  requestedAt, requestId: "request-1", idempotencyKey: "execution-1", executionFingerprint: "snapshot-1", capabilities: ["authorization"], policyContext: { environment: "test", source: "server" },
};
const authorizationPolicy: ProductionExecutionAuthorizationPolicy = {
  policyVersion: "confirmation-policy-v1", enabled: true, allowedActorTypes: ["user"], allowedProjects: ["project-1"], allowedOperations: [operation, "pipeline.stage.resume.preview"], allowedActions: ["retry-stage", "resume-stage"], allowedStages: ["script"],
  requiredCapabilitiesByAction: { "retry-stage": ["authorization"], "resume-stage": ["authorization"] }, workerRequirements: { requiredOperations: [operation, "pipeline.stage.resume.preview"] },
  riskRequirements: { "retry-stage": { risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high" }, "resume-stage": { risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high" } },
};
const authorization = evaluateProductionExecutionAuthorization(authorizationRequest, authorizationPolicy, { grantedCapabilities: productionCapabilityMatrix.map((item) => item.id) });
const executionRequest: ProductionExecutionRequest = { schemaVersion: 1, requestId: "request-1", idempotencyKey: "execution-1", projectSlug: "project-1", snapshotFingerprint: "snapshot-1", planId: "plan-1", stepId: "step-1", actionType: "retry-stage", stage: "script", mode: "dry-run", confirmation: "required-not-provided" };
const policy: ProductionExecutionConfirmationPolicy = { ...defaultProductionExecutionConfirmationPolicy, enabled: true, policyVersion: "confirmation-policy-v1", allowedConfirmerActorTypes: ["user", "service"], allowSelfConfirmation: false };
const built = buildProductionExecutionConfirmationRequest({ authorization, executionRequest }, { policy, metadata: { environment: "test", source: "server" } });
assert.equal(built.ok, true); const confirmationRequest = built.request!;

function makeGrant(request: ProductionExecutionConfirmationRequest, override: Partial<ProductionExecutionConfirmationGrant> = {}): ProductionExecutionConfirmationGrant {
  const grant: ProductionExecutionConfirmationGrant = { schemaVersion: "1", confirmationId: "confirmation-1", confirmationRequestId: request.confirmationRequestId, authorizationDecisionId: request.authorizationDecisionId, requestId: request.requestId, idempotencyKey: request.idempotencyKey, executionFingerprint: request.executionFingerprint, bindingFingerprint: request.bindingFingerprint, actorId: request.actorId, confirmedByActorId: "confirmer-2", confirmedByActorType: "user", projectSlug: request.projectSlug, operation: request.operation, action: request.action, stage: request.stage, riskLevel: request.riskLevel, requiredConfirmationLevel: request.requiredConfirmationLevel, confirmationLevel: "high", policyVersion: request.policyVersion, issuedAt, expiresAt: request.expiresAt, singleUse: request.singleUse, status: "granted", evidence: ["server-confirmed"], integrity: { algorithm: "stable-production-id-v1", fingerprint: request.bindingFingerprint } };
  return { ...grant, ...override };
}
const grant = makeGrant(confirmationRequest);
const validate = (grantOverride: Partial<ProductionExecutionConfirmationGrant> = {}, requestOverride: Partial<ProductionExecutionConfirmationRequest> = {}, authorizationOverride: Partial<ProductionExecutionAuthorizationResult> = {}, policyOverride: Partial<ProductionExecutionConfirmationPolicy> = {}, at = evaluatedAt) => validateProductionExecutionConfirmation({ authorization: { ...authorization, ...authorizationOverride }, request: { ...confirmationRequest, ...requestOverride }, grant: makeGrant({ ...confirmationRequest, ...requestOverride }, grantOverride) }, { evaluatedAt: at, policy: { ...policy, ...policyOverride } });

async function main() {
  assert.equal(validate().decision, "valid");
  assert.equal(validate({}, {}, {}, { enabled: false }).reasonCode, "CONFIRMATION_POLICY_DISABLED");
  assert.equal(validate({}, {}, { authorized: false, decision: "deny" }).reasonCode, "AUTHORIZATION_NOT_ALLOWED");
  assert.equal(validate({}, {}, { authorized: false, decision: "indeterminate" }).reasonCode, "AUTHORIZATION_INDETERMINATE");
  assert.equal(validate({}, {}, { requiresConfirmation: false }).reasonCode, "CONFIRMATION_NOT_REQUIRED");
  assert.equal(validate({}, { confirmationRequestId: "" }).reasonCode, "CONFIRMATION_REQUEST_ID_MISSING");
  assert.equal(validate({}, { authorizationDecisionId: "" }).reasonCode, "AUTHORIZATION_DECISION_ID_MISSING");
  assert.equal(validate({ actorId: "actor-2" }).reasonCode, "ACTOR_BINDING_MISMATCH");
  assert.equal(validate({ confirmedByActorType: "system" }).reasonCode, "CONFIRMER_NOT_ALLOWED");
  const criticalPolicy = { ...policy, minimumLevelByRisk: { ...policy.minimumLevelByRisk, critical: "critical" as const }, requireDistinctConfirmerForCritical: true };
  assert.equal(validate({ riskLevel: "critical", confirmationLevel: "critical", confirmedByActorId: "actor-1" }, { riskLevel: "critical", requiredConfirmationLevel: "critical" }, { risk: "critical", requiredConfirmationLevel: "critical" }, criticalPolicy).reasonCode, "DISTINCT_CONFIRMER_REQUIRED");
  assert.equal(validate({ projectSlug: "project-2" }).reasonCode, "PROJECT_BINDING_MISMATCH");
  assert.equal(validate({ operation: "other" }).reasonCode, "OPERATION_BINDING_MISMATCH");
  assert.equal(validate({ action: "resume-stage" }).reasonCode, "ACTION_BINDING_MISMATCH");
  assert.equal(validate({ stage: "video" }).reasonCode, "STAGE_BINDING_MISMATCH");
  assert.equal(validate({ requestId: "request-2" }).reasonCode, "REQUEST_ID_MISMATCH");
  assert.equal(validate({ idempotencyKey: "execution-2" }).reasonCode, "IDEMPOTENCY_KEY_MISMATCH");
  assert.equal(validate({ executionFingerprint: "snapshot-2" }).reasonCode, "EXECUTION_FINGERPRINT_MISMATCH");
  assert.equal(validate({ bindingFingerprint: "bad-binding" }).reasonCode, "BINDING_FINGERPRINT_MISMATCH");
  assert.equal(validate({}, {}, {}, { policyVersion: "confirmation-policy-v2" }).reasonCode, "POLICY_VERSION_MISMATCH");
  assert.equal(validate({ riskLevel: "medium" }).reasonCode, "RISK_LEVEL_MISMATCH");
  assert.equal(validate({ confirmationLevel: "elevated" }).reasonCode, "CONFIRMATION_LEVEL_INSUFFICIENT");
  assert.equal(validate({ issuedAt: "2026-07-12T09:59:59.000Z" }).reasonCode, "ISSUED_AT_INVALID");
  assert.equal(validate({ expiresAt: issuedAt }).reasonCode, "EXPIRY_INVALID");
  assert.equal(validate({}, {}, {}, {}, "2026-07-12T10:03:00.000Z").reasonCode, "CONFIRMATION_EXPIRED");
  assert.equal(validate({ status: "consumed" }).reasonCode, "CONFIRMATION_ALREADY_CONSUMED");
  assert.equal(validate({ status: "revoked" }).reasonCode, "CONFIRMATION_REVOKED");
  assert.equal(validate({ status: "rejected" }).reasonCode, "CONFIRMATION_REJECTED");
  assert.equal(validate({ status: "pending" }).reasonCode, "CONFIRMATION_PENDING");
  assert.equal(validate({ status: "mystery" }).reasonCode, "CONFIRMATION_STATUS_INVALID");
  assert.equal(validate({ confirmationLevel: "mystery" }).reasonCode, "CONFIRMATION_LEVEL_UNKNOWN");
  assert.equal(validate({ riskLevel: "mystery" as "high" }).reasonCode, "RISK_LEVEL_UNKNOWN");
  assert.equal(confirmationRequest.requiredConfirmationLevel, "high"); assert.equal(confirmationRequest.riskLevel, "high");
  const resumeAuthorization = { ...authorization, operation: "pipeline.stage.resume.preview", action: "resume-stage" }; const resumeExecution = { ...executionRequest, actionType: "resume-stage" as const };
  const resumeBuilt = buildProductionExecutionConfirmationRequest({ authorization: resumeAuthorization, executionRequest: resumeExecution }, { policy, metadata: { environment: "test", source: "server" } }); assert.equal(resumeBuilt.request?.requiredConfirmationLevel, "high");
  assert.equal(confirmationRequest.singleUse, true);
  const semanticBinding = { authorizationDecisionId: "a", requestId: "r", idempotencyKey: "i", executionFingerprint: "f", actorId: "u", projectSlug: "p", operation: "o", action: "x", stage: "s", policyVersion: "v", riskLevel: "high" as const, requiredConfirmationLevel: "high" as const, expiresAt: confirmationRequest.expiresAt, singleUse: true };
  assert.equal(productionExecutionConfirmationBindingFingerprint(semanticBinding), productionExecutionConfirmationBindingFingerprint({ ...semanticBinding }));
  assert.notEqual(productionExecutionConfirmationBindingFingerprint(semanticBinding), productionExecutionConfirmationBindingFingerprint({ ...semanticBinding, requestId: "changed" }));
  const reordered = { singleUse: true, expiresAt: semanticBinding.expiresAt, requiredConfirmationLevel: "high" as const, riskLevel: "high" as const, policyVersion: "v", stage: "s", action: "x", operation: "o", projectSlug: "p", actorId: "u", executionFingerprint: "f", idempotencyKey: "i", requestId: "r", authorizationDecisionId: "a" };
  assert.equal(productionExecutionConfirmationBindingFingerprint(semanticBinding), productionExecutionConfirmationBindingFingerprint(reordered));
  const frozenAuthorization = structuredClone(authorization); const frozenExecution = structuredClone(executionRequest); const frozenPolicy = structuredClone(policy); const frozenRequest = structuredClone(confirmationRequest); const frozenGrant = structuredClone(grant); validate();
  assert.deepEqual(authorization, frozenAuthorization); assert.deepEqual(executionRequest, frozenExecution); assert.deepEqual(policy, frozenPolicy); assert.deepEqual(confirmationRequest, frozenRequest); assert.deepEqual(grant, frozenGrant);
  assert.deepEqual(validate(), validate());
  assert.equal(validate({ issuedAt: "not-a-date" }).reasonCode, "ISSUED_AT_INVALID");
  assert.equal(validate({}, { metadata: { environment: "local", source: "client" as "server" } }).valid, false);
  const workerExtended = { ...authorization, workerIdentity: { id: "other-worker" } } as ProductionExecutionAuthorizationResult; assert.equal(buildProductionExecutionConfirmationRequest({ authorization: workerExtended, executionRequest }, { policy, metadata: { environment: "test", source: "server" } }).request?.actorId, authorization.actorId);
  const publicText = JSON.stringify(validate({ evidence: ["secret-api-key", "C:\\private\\file", "Error stack trace"] }));
  assert.ok(!/secret-api-key|C:\\private|stack trace/i.test(publicText));
  assert.equal(defaultProductionExecutionConfirmationPolicy.enabled, false);
  assert.equal(buildProductionExecutionConfirmationRequest({ authorization: { ...authorization, authorized: false, decision: "deny" }, executionRequest }, { policy, metadata: { environment: "test", source: "server" } }).ok, false);
  assert.equal(buildProductionExecutionConfirmationRequest({ authorization: { ...authorization, requiresConfirmation: false }, executionRequest }, { policy, metadata: { environment: "test", source: "server" } }).reasonCode, "CONFIRMATION_NOT_REQUIRED");
  assert.ok(confirmationRequest.confirmationRequestId.startsWith("confirmation-request-"));
  assert.equal(validate({ status: "expired" }).reasonCode, "CONFIRMATION_EXPIRED");
  const source = await readFile("src/lib/production/ProductionExecutionConfirmation.ts", "utf8"); assert.ok(!/writeFile|writeJSON|saveJson|fetch\(|enqueue\(|dispatch\(|process\.env|Date\.now|Math\.random|randomUUID|setInterval|jsonwebtoken|jwt/i.test(source));
  console.log("Sprint 97.2 production execution confirmation smoke: PASS (48 scenarios)");
}
void main();
