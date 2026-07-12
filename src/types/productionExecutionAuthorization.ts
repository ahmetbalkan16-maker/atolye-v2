import type { ProductionActionType } from "./productionIntelligence";
import type { ProductionCapabilityId } from "./productionExecutionSafety";

export const productionExecutionAuthorizationSchemaVersion = "1" as const;

export type ProductionExecutionActorType = "user" | "service" | "worker" | "system";
export type ProductionExecutionAuthorizationDecision = "allow" | "deny" | "indeterminate";
export type ProductionExecutionAuthorizationRisk = "none" | "low" | "medium" | "high" | "critical";
export type ProductionExecutionAuthorizationConfirmationLevel = "none" | "standard" | "elevated" | "high" | "critical";
export type ProductionExecutionAuthorizationReasonCode =
  | "AUTHORIZED"
  | "ACTOR_MISSING"
  | "ACTOR_UNAUTHENTICATED"
  | "ACTOR_UNTRUSTED"
  | "PROJECT_INVALID"
  | "PROJECT_SCOPE_DENIED"
  | "OPERATION_SCOPE_DENIED"
  | "ACTION_UNKNOWN"
  | "ACTION_NOT_EXECUTABLE"
  | "ACTION_UNRESOLVED"
  | "STAGE_UNKNOWN"
  | "ACTION_STAGE_UNSUPPORTED"
  | "WORKER_IDENTITY_REQUIRED"
  | "WORKER_IDENTITY_INVALID"
  | "WORKER_SCOPE_DENIED"
  | "CAPABILITY_UNKNOWN"
  | "CAPABILITY_MISSING"
  | "CAPABILITY_DEPENDENCY_MISSING"
  | "POLICY_DISABLED"
  | "POLICY_INVALID"
  | "AUTHORIZATION_INDETERMINATE";

export interface ProductionExecutionActorIdentity {
  id: string;
  type: ProductionExecutionActorType;
  authenticated: boolean;
  trusted: boolean;
  identitySource: string;
  allowedProjects: readonly string[];
  allowedOperations: readonly string[];
}

export interface ProductionExecutionWorkerIdentity {
  id: string;
  authenticated: boolean;
  trusted: boolean;
  identitySource: string;
  allowedOperations: readonly string[];
}

export interface ProductionExecutionAuthorizationRequest {
  schemaVersion: typeof productionExecutionAuthorizationSchemaVersion;
  actor?: ProductionExecutionActorIdentity;
  project: { slug: string };
  operation: string;
  action: string;
  stage?: string;
  workerIdentity?: ProductionExecutionWorkerIdentity;
  requestedAt: string;
  requestId: string;
  idempotencyKey: string;
  executionFingerprint: string;
  capabilities: readonly string[];
  policyContext: { environment: "local" | "hosted" | "test"; source: "server" };
}

export interface ProductionExecutionAuthorizationPolicy {
  policyVersion: string;
  enabled: boolean;
  allowedActorTypes: readonly ProductionExecutionActorType[];
  allowedProjects: readonly string[];
  allowedOperations: readonly string[];
  allowedActions: readonly ProductionActionType[];
  allowedStages: readonly string[];
  requiredCapabilitiesByAction: Readonly<Partial<Record<ProductionActionType, readonly ProductionCapabilityId[]>>>;
  workerRequirements: { requiredOperations: readonly string[] };
  riskRequirements: Readonly<Partial<Record<ProductionActionType, { risk: ProductionExecutionAuthorizationRisk; requiresConfirmation: boolean; requiredConfirmationLevel: ProductionExecutionAuthorizationConfirmationLevel }>>>;
}

export interface ProductionExecutionAuthorizationContext {
  grantedCapabilities: readonly string[];
}

export interface ProductionExecutionAuthorizationResult {
  schemaVersion: typeof productionExecutionAuthorizationSchemaVersion;
  decisionId: string;
  decision: ProductionExecutionAuthorizationDecision;
  authorized: boolean;
  reasonCode: ProductionExecutionAuthorizationReasonCode;
  reason: string;
  evaluatedAt: string;
  requestId: string;
  idempotencyKey: string;
  executionFingerprint: string;
  actorId: string;
  actorType: ProductionExecutionActorType;
  projectSlug: string;
  operation: string;
  action: string;
  stage?: string;
  requiredCapabilities: ProductionCapabilityId[];
  grantedCapabilities: ProductionCapabilityId[];
  missingCapabilities: ProductionCapabilityId[];
  policyVersion: string;
  risk: ProductionExecutionAuthorizationRisk;
  requiresConfirmation: boolean;
  requiredConfirmationLevel: ProductionExecutionAuthorizationConfirmationLevel;
  evidence: string[];
}
