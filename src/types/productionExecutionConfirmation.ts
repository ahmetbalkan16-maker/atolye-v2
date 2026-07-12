import type { ProductionExecutionActorType, ProductionExecutionAuthorizationResult, ProductionExecutionAuthorizationRisk } from "./productionExecutionAuthorization";
import type { ProductionExecutionRequest } from "./productionIntelligence";

export const productionExecutionConfirmationSchemaVersion = "1" as const;
export type ProductionExecutionConfirmationLevel = "none" | "standard" | "elevated" | "high" | "critical";
export type ProductionExecutionConfirmationStatus = "pending" | "granted" | "rejected" | "expired" | "revoked" | "consumed" | "invalid";
export type ProductionExecutionConfirmationReasonCode =
  | "CONFIRMATION_VALID" | "CONFIRMATION_POLICY_DISABLED" | "AUTHORIZATION_NOT_ALLOWED" | "AUTHORIZATION_INDETERMINATE"
  | "CONFIRMATION_NOT_REQUIRED" | "CONFIRMATION_REQUEST_INVALID" | "CONFIRMATION_REQUEST_ID_MISSING" | "AUTHORIZATION_DECISION_ID_MISSING"
  | "ACTOR_BINDING_MISMATCH" | "CONFIRMER_NOT_ALLOWED" | "DISTINCT_CONFIRMER_REQUIRED" | "PROJECT_BINDING_MISMATCH"
  | "OPERATION_BINDING_MISMATCH" | "ACTION_BINDING_MISMATCH" | "STAGE_BINDING_MISMATCH" | "REQUEST_ID_MISMATCH"
  | "IDEMPOTENCY_KEY_MISMATCH" | "EXECUTION_FINGERPRINT_MISMATCH" | "BINDING_FINGERPRINT_MISMATCH" | "POLICY_VERSION_MISMATCH"
  | "RISK_LEVEL_MISMATCH" | "CONFIRMATION_LEVEL_INSUFFICIENT" | "ISSUED_AT_INVALID" | "EXPIRY_INVALID" | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_ALREADY_CONSUMED" | "CONFIRMATION_REVOKED" | "CONFIRMATION_REJECTED" | "CONFIRMATION_PENDING"
  | "CONFIRMATION_STATUS_INVALID" | "CONFIRMATION_LEVEL_UNKNOWN" | "RISK_LEVEL_UNKNOWN" | "CONFIRMATION_INDETERMINATE";

export interface ProductionExecutionConfirmationMetadata { source: "server"; environment: "local" | "hosted" | "test" }
export interface ProductionExecutionConfirmationBinding {
  authorizationDecisionId: string; requestId: string; idempotencyKey: string; executionFingerprint: string;
  actorId: string; projectSlug: string; operation: string; action: string; stage?: string;
  policyVersion: string; riskLevel: ProductionExecutionAuthorizationRisk; requiredConfirmationLevel: ProductionExecutionConfirmationLevel;
  expiresAt: string; singleUse: boolean;
}
export interface ProductionExecutionConfirmationRequest extends ProductionExecutionConfirmationBinding {
  schemaVersion: typeof productionExecutionConfirmationSchemaVersion;
  confirmationRequestId: string; actorType: ProductionExecutionActorType; requestedAt: string; bindingFingerprint: string;
  metadata: ProductionExecutionConfirmationMetadata;
}
export interface ProductionExecutionConfirmationGrant extends ProductionExecutionConfirmationBinding {
  schemaVersion: typeof productionExecutionConfirmationSchemaVersion;
  confirmationId: string; confirmationRequestId: string; bindingFingerprint: string; confirmedByActorId: string;
  confirmedByActorType: string; confirmationLevel: string; issuedAt: string; status: string;
  evidence: readonly string[]; integrity: { algorithm: "stable-production-id-v1"; fingerprint: string };
}
export interface ProductionExecutionConfirmationPolicy {
  enabled: boolean; policyVersion: string; allowedConfirmerActorTypes: readonly ProductionExecutionActorType[];
  confirmationTtlSecondsByLevel: Readonly<Record<ProductionExecutionConfirmationLevel, number>>;
  maximumConfirmationTtlSeconds: number;
  singleUseRequiredByRisk: Readonly<Record<ProductionExecutionAuthorizationRisk, boolean>>;
  minimumLevelByRisk: Readonly<Record<ProductionExecutionAuthorizationRisk, ProductionExecutionConfirmationLevel>>;
  allowSelfConfirmation: boolean; requireDistinctConfirmerForCritical: boolean;
}
export interface ProductionExecutionConfirmationBuildContext { policy: ProductionExecutionConfirmationPolicy; metadata: ProductionExecutionConfirmationMetadata }
export interface ProductionExecutionConfirmationBuildResult {
  ok: boolean; request?: ProductionExecutionConfirmationRequest; reasonCode: ProductionExecutionConfirmationReasonCode; reason: string; evidence: string[];
}
export interface ProductionExecutionConfirmationValidationInput {
  authorization: ProductionExecutionAuthorizationResult; request: ProductionExecutionConfirmationRequest; grant: ProductionExecutionConfirmationGrant;
}
export interface ProductionExecutionConfirmationValidationContext { evaluatedAt: string; policy: ProductionExecutionConfirmationPolicy }
export interface ProductionExecutionConfirmationValidationResult {
  schemaVersion: typeof productionExecutionConfirmationSchemaVersion; decision: "valid" | "invalid" | "indeterminate"; valid: boolean;
  reasonCode: ProductionExecutionConfirmationReasonCode; reason: string; evaluatedAt: string; confirmationId: string;
  confirmationRequestId: string; authorizationDecisionId: string; requestId: string; idempotencyKey: string; actorId: string;
  projectSlug: string; operation: string; action: string; stage?: string; riskLevel: string;
  requiredConfirmationLevel: string; providedConfirmationLevel: string; bindingMatches: boolean; expired: boolean;
  singleUse: boolean; consumed: boolean; policyVersion: string; evidence: string[];
}
export interface ProductionExecutionConfirmationBuilderInput { authorization: ProductionExecutionAuthorizationResult; executionRequest: ProductionExecutionRequest }
