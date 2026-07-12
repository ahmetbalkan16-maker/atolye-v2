import type { ProductionActionType } from "./productionIntelligence";

export type ProductionCapabilityStatus = "ready" | "preview-only" | "planned" | "blocked" | "unsupported";
export type ProductionCapabilityId =
  | "snapshot" | "health" | "evidence" | "actions" | "dependency-graph" | "planner"
  | "execution-contract" | "dry-run-gateway" | "job-preview" | "consumer-versioning"
  | "api-integration" | "passive-ui" | "real-execution" | "queue-dispatch"
  | "authorization" | "confirmation" | "persistent-idempotency" | "audit-trail"
  | "cancellation" | "retry-policy" | "rollback" | "recovery" | "controlled-rollout";

export interface ProductionCapability {
  id: ProductionCapabilityId;
  status: ProductionCapabilityStatus;
  publicContract: "stable" | "internal" | "not-defined";
  readOnly: boolean;
  usesPersistence: boolean;
  producesSideEffects: boolean;
  dependencies: ProductionCapabilityId[];
  description: string;
}

export interface ProductionExecutionThreat {
  id: string;
  category: "identity" | "authorization" | "consistency" | "queue" | "provider" | "recovery" | "audit" | "security" | "compatibility";
  severity: "critical" | "high" | "medium";
  description: string;
  prevention: string;
  detection: string;
  recovery: string;
  requiredBeforeExecution: boolean;
  relatedCapabilities: ProductionCapabilityId[];
}

export interface ProductionExecutionInvariant { id: string; statement: string }

export interface ProductionActionRiskProfile {
  actionType: ProductionActionType;
  executionSupport: "unsupported" | "unresolved" | "preview-only";
  riskLevel: "read-only" | "low" | "medium" | "high" | "irreversible";
  confirmationRequired: boolean;
  supportsRetry: boolean | "unresolved";
  supportsCancellation: boolean | "unresolved";
  supportsRollback: boolean | "unresolved";
  possibleWrites: string[];
  possibleManifestChanges: string[];
  externalProviderSideEffect: boolean | "unresolved";
  requiredAuthorizationScope: string;
}

export interface ProductionExecutionRoadmapItem {
  sprint: string;
  purpose: string;
  inputContracts: string[];
  outputContracts: string[];
  exclusions: string[];
  testGates: string[];
  dependencies: string[];
}
