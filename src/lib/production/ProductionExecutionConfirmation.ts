import { stableProductionId } from "./ProductionDeterminism";
import { isValidProductionProjectSlug } from "./ProductionProjectSlug";
import type { ProductionExecutionAuthorizationRisk } from "@/types/productionExecutionAuthorization";
import { productionExecutionConfirmationSchemaVersion, type ProductionExecutionConfirmationBinding, type ProductionExecutionConfirmationBuildContext, type ProductionExecutionConfirmationBuilderInput, type ProductionExecutionConfirmationBuildResult, type ProductionExecutionConfirmationGrant, type ProductionExecutionConfirmationLevel, type ProductionExecutionConfirmationPolicy, type ProductionExecutionConfirmationReasonCode, type ProductionExecutionConfirmationRequest, type ProductionExecutionConfirmationValidationContext, type ProductionExecutionConfirmationValidationInput, type ProductionExecutionConfirmationValidationResult } from "@/types/productionExecutionConfirmation";

const levels: readonly ProductionExecutionConfirmationLevel[] = ["none", "standard", "elevated", "high", "critical"];
const risks: readonly ProductionExecutionAuthorizationRisk[] = ["none", "low", "medium", "high", "critical"];
const statuses = ["pending", "granted", "rejected", "expired", "revoked", "consumed", "invalid"] as const;
const messages: Record<ProductionExecutionConfirmationReasonCode, string> = {
  CONFIRMATION_VALID: "Confirmation binding is valid.", CONFIRMATION_POLICY_DISABLED: "Confirmation policy is disabled.", AUTHORIZATION_NOT_ALLOWED: "Authorization decision does not allow confirmation.", AUTHORIZATION_INDETERMINATE: "Authorization decision is indeterminate.", CONFIRMATION_NOT_REQUIRED: "Authorization does not require confirmation.", CONFIRMATION_REQUEST_INVALID: "Confirmation request is invalid.", CONFIRMATION_REQUEST_ID_MISSING: "Confirmation request ID is required.", AUTHORIZATION_DECISION_ID_MISSING: "Authorization decision ID is required.", ACTOR_BINDING_MISMATCH: "Actor binding does not match.", CONFIRMER_NOT_ALLOWED: "Confirmer is not allowed by policy.", DISTINCT_CONFIRMER_REQUIRED: "A distinct confirmer is required.", PROJECT_BINDING_MISMATCH: "Project binding does not match.", OPERATION_BINDING_MISMATCH: "Operation binding does not match.", ACTION_BINDING_MISMATCH: "Action binding does not match.", STAGE_BINDING_MISMATCH: "Stage binding does not match.", REQUEST_ID_MISMATCH: "Request ID binding does not match.", IDEMPOTENCY_KEY_MISMATCH: "Idempotency key binding does not match.", EXECUTION_FINGERPRINT_MISMATCH: "Execution fingerprint binding does not match.", BINDING_FINGERPRINT_MISMATCH: "Binding fingerprint does not match.", POLICY_VERSION_MISMATCH: "Policy version does not match.", RISK_LEVEL_MISMATCH: "Risk level does not match policy.", CONFIRMATION_LEVEL_INSUFFICIENT: "Confirmation level is insufficient.", ISSUED_AT_INVALID: "Issued time is invalid.", EXPIRY_INVALID: "Expiry is invalid.", CONFIRMATION_EXPIRED: "Confirmation is expired.", CONFIRMATION_ALREADY_CONSUMED: "Single-use confirmation was consumed.", CONFIRMATION_REVOKED: "Confirmation was revoked.", CONFIRMATION_REJECTED: "Confirmation was rejected.", CONFIRMATION_PENDING: "Confirmation is pending.", CONFIRMATION_STATUS_INVALID: "Confirmation status is invalid.", CONFIRMATION_LEVEL_UNKNOWN: "Confirmation level is unknown.", RISK_LEVEL_UNKNOWN: "Risk level is unknown.", CONFIRMATION_INDETERMINATE: "Confirmation could not be evaluated safely.",
};

export const defaultProductionExecutionConfirmationPolicy: ProductionExecutionConfirmationPolicy = {
  enabled: false, policyVersion: "production-execution-confirmation-v1", allowedConfirmerActorTypes: [],
  confirmationTtlSecondsByLevel: { none: 0, standard: 300, elevated: 240, high: 180, critical: 120 }, maximumConfirmationTtlSeconds: 300,
  singleUseRequiredByRisk: { none: false, low: false, medium: false, high: true, critical: true },
  minimumLevelByRisk: { none: "none", low: "standard", medium: "elevated", high: "high", critical: "critical" },
  allowSelfConfirmation: false, requireDistinctConfirmerForCritical: true,
};

export function productionExecutionConfirmationBindingFingerprint(binding: ProductionExecutionConfirmationBinding) {
  return stableProductionId("confirmation-binding", binding);
}

export function buildProductionExecutionConfirmationRequest(input: ProductionExecutionConfirmationBuilderInput, context: ProductionExecutionConfirmationBuildContext): ProductionExecutionConfirmationBuildResult {
  try {
    const { authorization, executionRequest } = input; const { policy } = context;
    if (!policy.enabled) return buildFailure("CONFIRMATION_POLICY_DISABLED");
    if (authorization.decision === "indeterminate") return buildFailure("AUTHORIZATION_INDETERMINATE");
    if (!authorization.authorized || authorization.decision !== "allow") return buildFailure("AUTHORIZATION_NOT_ALLOWED");
    if (!authorization.requiresConfirmation) return buildFailure("CONFIRMATION_NOT_REQUIRED");
    if (!authorization.decisionId) return buildFailure("AUTHORIZATION_DECISION_ID_MISSING");
    if (authorization.projectSlug !== executionRequest.projectSlug || authorization.action !== executionRequest.actionType || authorization.stage !== executionRequest.stage || authorization.requestId !== executionRequest.requestId || authorization.idempotencyKey !== executionRequest.idempotencyKey || authorization.executionFingerprint !== executionRequest.snapshotFingerprint || authorization.policyVersion !== policy.policyVersion) return buildFailure("CONFIRMATION_REQUEST_INVALID");
    const requiredLevel = authorization.requiredConfirmationLevel as ProductionExecutionConfirmationLevel;
    if (!levels.includes(requiredLevel) || !risks.includes(authorization.risk)) return buildFailure("CONFIRMATION_REQUEST_INVALID");
    const requestedAt = canonicalDate(authorization.evaluatedAt); if (!requestedAt) return buildFailure("CONFIRMATION_REQUEST_INVALID");
    const ttl = policy.confirmationTtlSecondsByLevel[requiredLevel]; if (!Number.isInteger(ttl) || ttl <= 0 || ttl > policy.maximumConfirmationTtlSeconds) return buildFailure("CONFIRMATION_REQUEST_INVALID");
    const expiresAt = new Date(Date.parse(requestedAt) + ttl * 1000).toISOString();
    const singleUse = policy.singleUseRequiredByRisk[authorization.risk];
    const binding: ProductionExecutionConfirmationBinding = { authorizationDecisionId: authorization.decisionId, requestId: executionRequest.requestId, idempotencyKey: executionRequest.idempotencyKey, executionFingerprint: executionRequest.snapshotFingerprint, actorId: authorization.actorId, projectSlug: authorization.projectSlug, operation: authorization.operation, action: authorization.action, ...(authorization.stage ? { stage: authorization.stage } : {}), policyVersion: authorization.policyVersion, riskLevel: authorization.risk, requiredConfirmationLevel: requiredLevel, expiresAt, singleUse };
    const bindingFingerprint = productionExecutionConfirmationBindingFingerprint(binding);
    const request: ProductionExecutionConfirmationRequest = { schemaVersion: productionExecutionConfirmationSchemaVersion, confirmationRequestId: stableProductionId("confirmation-request", { bindingFingerprint, requestedAt }), ...binding, actorType: input.authorization.actorType, requestedAt, bindingFingerprint, metadata: { ...context.metadata } };
    return { ok: true, request, reasonCode: "CONFIRMATION_VALID", reason: messages.CONFIRMATION_VALID, evidence: ["confirmation-request:built", `policy:${policy.policyVersion}`] };
  } catch { return buildFailure("CONFIRMATION_INDETERMINATE"); }
}

export function validateProductionExecutionConfirmation(input: ProductionExecutionConfirmationValidationInput, context: ProductionExecutionConfirmationValidationContext): ProductionExecutionConfirmationValidationResult {
  try { return validate(input, context); } catch { return validationResult(input, context, "CONFIRMATION_INDETERMINATE", "indeterminate"); }
}

function validate(input: ProductionExecutionConfirmationValidationInput, context: ProductionExecutionConfirmationValidationContext): ProductionExecutionConfirmationValidationResult {
  const { authorization, request, grant } = input; const { policy } = context;
  if (!policy.enabled) return validationResult(input, context, "CONFIRMATION_POLICY_DISABLED");
  if (authorization.decision === "indeterminate") return validationResult(input, context, "AUTHORIZATION_INDETERMINATE");
  if (!authorization.authorized || authorization.decision !== "allow") return validationResult(input, context, "AUTHORIZATION_NOT_ALLOWED");
  if (!authorization.requiresConfirmation) return validationResult(input, context, "CONFIRMATION_NOT_REQUIRED");
  if (request.schemaVersion !== productionExecutionConfirmationSchemaVersion || request.metadata.source !== "server") return validationResult(input, context, "CONFIRMATION_REQUEST_INVALID");
  if (!request.confirmationRequestId) return validationResult(input, context, "CONFIRMATION_REQUEST_ID_MISSING");
  if (!request.authorizationDecisionId || !grant.authorizationDecisionId) return validationResult(input, context, "AUTHORIZATION_DECISION_ID_MISSING");
  if (!levels.includes(grant.confirmationLevel as ProductionExecutionConfirmationLevel)) return validationResult(input, context, "CONFIRMATION_LEVEL_UNKNOWN");
  if (!risks.includes(grant.riskLevel)) return validationResult(input, context, "RISK_LEVEL_UNKNOWN");
  if (!statuses.includes(grant.status as (typeof statuses)[number])) return validationResult(input, context, "CONFIRMATION_STATUS_INVALID");
  if (grant.actorId !== authorization.actorId || request.actorId !== authorization.actorId) return validationResult(input, context, "ACTOR_BINDING_MISMATCH");
  if (!policy.allowedConfirmerActorTypes.includes(grant.confirmedByActorType as never)) return validationResult(input, context, "CONFIRMER_NOT_ALLOWED");
  if ((!policy.allowSelfConfirmation || (grant.riskLevel === "critical" && policy.requireDistinctConfirmerForCritical)) && grant.confirmedByActorId === grant.actorId) return validationResult(input, context, "DISTINCT_CONFIRMER_REQUIRED");
  const mismatch = bindingMismatch(input); if (mismatch) return validationResult(input, context, mismatch);
  if (grant.policyVersion !== policy.policyVersion || request.policyVersion !== policy.policyVersion) return validationResult(input, context, "POLICY_VERSION_MISMATCH");
  const minimumRiskLevel = policy.minimumLevelByRisk[authorization.risk];
  if (grant.riskLevel !== authorization.risk || levelRank(grant.requiredConfirmationLevel) < levelRank(minimumRiskLevel)) return validationResult(input, context, "RISK_LEVEL_MISMATCH");
  if (levelRank(grant.confirmationLevel) < levelRank(grant.requiredConfirmationLevel)) return validationResult(input, context, "CONFIRMATION_LEVEL_INSUFFICIENT");
  const issuedAt = canonicalDate(grant.issuedAt); const requestedAt = canonicalDate(request.requestedAt); const expiresAt = canonicalDate(grant.expiresAt); const evaluatedAt = canonicalDate(context.evaluatedAt);
  if (!issuedAt || !requestedAt || Date.parse(issuedAt) < Date.parse(requestedAt)) return validationResult(input, context, "ISSUED_AT_INVALID");
  if (!expiresAt || Date.parse(expiresAt) <= Date.parse(issuedAt)) return validationResult(input, context, "EXPIRY_INVALID");
  if (!evaluatedAt) return validationResult(input, context, "CONFIRMATION_INDETERMINATE", "indeterminate");
  if (Date.parse(evaluatedAt) >= Date.parse(expiresAt)) return validationResult(input, context, "CONFIRMATION_EXPIRED");
  if (grant.singleUse && grant.status === "consumed") return validationResult(input, context, "CONFIRMATION_ALREADY_CONSUMED");
  if (grant.status === "revoked") return validationResult(input, context, "CONFIRMATION_REVOKED");
  if (grant.status === "rejected") return validationResult(input, context, "CONFIRMATION_REJECTED");
  if (grant.status === "pending") return validationResult(input, context, "CONFIRMATION_PENDING");
  if (grant.status === "expired") return validationResult(input, context, "CONFIRMATION_EXPIRED");
  if (grant.status !== "granted") return validationResult(input, context, "CONFIRMATION_STATUS_INVALID");
  if (policy.singleUseRequiredByRisk[grant.riskLevel] && !grant.singleUse) return validationResult(input, context, "CONFIRMATION_REQUEST_INVALID");
  const expected = productionExecutionConfirmationBindingFingerprint(bindingFromGrant(grant));
  if (grant.bindingFingerprint !== expected || request.bindingFingerprint !== expected || grant.integrity.algorithm !== "stable-production-id-v1" || grant.integrity.fingerprint !== expected) return validationResult(input, context, "BINDING_FINGERPRINT_MISMATCH");
  return validationResult(input, context, "CONFIRMATION_VALID", "valid");
}

function bindingMismatch({ authorization, request, grant }: ProductionExecutionConfirmationValidationInput): ProductionExecutionConfirmationReasonCode | undefined {
  if (grant.confirmationRequestId !== request.confirmationRequestId || grant.authorizationDecisionId !== authorization.decisionId) return "AUTHORIZATION_DECISION_ID_MISSING";
  if (grant.projectSlug !== request.projectSlug || request.projectSlug !== authorization.projectSlug || !isValidProductionProjectSlug(grant.projectSlug)) return "PROJECT_BINDING_MISMATCH";
  if (grant.operation !== request.operation || request.operation !== authorization.operation) return "OPERATION_BINDING_MISMATCH";
  if (grant.action !== request.action || request.action !== authorization.action) return "ACTION_BINDING_MISMATCH";
  if (grant.stage !== request.stage || request.stage !== authorization.stage) return "STAGE_BINDING_MISMATCH";
  if (grant.requestId !== request.requestId || request.requestId !== authorization.requestId) return "REQUEST_ID_MISMATCH";
  if (grant.idempotencyKey !== request.idempotencyKey || request.idempotencyKey !== authorization.idempotencyKey) return "IDEMPOTENCY_KEY_MISMATCH";
  if (grant.executionFingerprint !== request.executionFingerprint || request.executionFingerprint !== authorization.executionFingerprint) return "EXECUTION_FINGERPRINT_MISMATCH";
}
function bindingFromGrant(grant: ProductionExecutionConfirmationGrant): ProductionExecutionConfirmationBinding { return { authorizationDecisionId: grant.authorizationDecisionId, requestId: grant.requestId, idempotencyKey: grant.idempotencyKey, executionFingerprint: grant.executionFingerprint, actorId: grant.actorId, projectSlug: grant.projectSlug, operation: grant.operation, action: grant.action, ...(grant.stage ? { stage: grant.stage } : {}), policyVersion: grant.policyVersion, riskLevel: grant.riskLevel, requiredConfirmationLevel: grant.requiredConfirmationLevel, expiresAt: grant.expiresAt, singleUse: grant.singleUse }; }
function validationResult(input: ProductionExecutionConfirmationValidationInput, context: ProductionExecutionConfirmationValidationContext, reasonCode: ProductionExecutionConfirmationReasonCode, decision: "valid" | "invalid" | "indeterminate" = "invalid"): ProductionExecutionConfirmationValidationResult { const { request, grant } = input; const expired = Boolean(canonicalDate(context.evaluatedAt) && canonicalDate(grant.expiresAt) && Date.parse(context.evaluatedAt) >= Date.parse(grant.expiresAt)); return { schemaVersion: productionExecutionConfirmationSchemaVersion, decision, valid: decision === "valid", reasonCode, reason: messages[reasonCode], evaluatedAt: context.evaluatedAt, confirmationId: grant.confirmationId || "unknown-confirmation", confirmationRequestId: request.confirmationRequestId || "unknown-request", authorizationDecisionId: request.authorizationDecisionId || "unknown-decision", requestId: request.requestId, idempotencyKey: request.idempotencyKey, actorId: request.actorId, projectSlug: request.projectSlug, operation: request.operation, action: request.action, ...(request.stage ? { stage: request.stage } : {}), riskLevel: grant.riskLevel, requiredConfirmationLevel: request.requiredConfirmationLevel, providedConfirmationLevel: grant.confirmationLevel, bindingMatches: reasonCode === "CONFIRMATION_VALID", expired, singleUse: grant.singleUse, consumed: grant.status === "consumed", policyVersion: request.policyVersion, evidence: [`policy:${context.policy.policyVersion || "invalid"}`, `reason:${reasonCode}`] }; }
function buildFailure(reasonCode: ProductionExecutionConfirmationReasonCode): ProductionExecutionConfirmationBuildResult { return { ok: false, reasonCode, reason: messages[reasonCode], evidence: [`reason:${reasonCode}`] }; }
function canonicalDate(value: string) { const parsed = Date.parse(value); if (!Number.isFinite(parsed)) return undefined; const canonical = new Date(parsed).toISOString(); return canonical === value ? canonical : undefined; }
function levelRank(value: string) { return levels.indexOf(value as ProductionExecutionConfirmationLevel); }
