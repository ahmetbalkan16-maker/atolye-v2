import type { ProductionHealthFinding } from "./productionHealth";
import type { ProductionStepKey } from "./project";

export type ProductionActionType =
  | "inspect-source"
  | "reconcile-state"
  | "retry-stage"
  | "resume-stage"
  | "review-metric";
export type ProductionActionPriority = "critical" | "high" | "normal";

export interface ProductionRecommendedAction {
  id: string;
  findingRef: string;
  actionType: ProductionActionType;
  affectedStage?: ProductionStepKey;
  title: string;
  reason: string;
  priority: ProductionActionPriority;
  safety: "read-only-recommendation";
  confirmationRequired: boolean;
}

export interface ProductionDependencyNode {
  stage: ProductionStepKey;
  status: "complete" | "ready" | "blocked" | "unknown";
  upstreamDependencies: ProductionStepKey[];
  downstreamUnlocks: ProductionStepKey[];
  rootCauseFindingRefs: string[];
}
export interface ProductionDependencyEdge { from: ProductionStepKey; to: ProductionStepKey }
export interface ProductionDependencyGraph {
  nodes: ProductionDependencyNode[];
  edges: ProductionDependencyEdge[];
  blockedStages: ProductionStepKey[];
  rootCauseStages: ProductionStepKey[];
  cycles: ProductionStepKey[][];
}

export type ProductionPlanStatus = "ready" | "blocked" | "complete" | "unknown";
export interface ProductionPlanStep {
  id: string;
  actionId: string;
  actionType: ProductionActionType;
  stage?: ProductionStepKey;
  status: "ready" | "blocked";
  prerequisites: ProductionStepKey[];
  unlocks: ProductionStepKey[];
  rootCauseFindingRefs: string[];
  selectionReasons: string[];
  confirmationRequired: boolean;
}
export interface ProductionPlan {
  id: string;
  snapshotFingerprint: string;
  status: ProductionPlanStatus;
  recommendedStepId?: string;
  steps: ProductionPlanStep[];
}

export interface ProductionExecutionRequest {
  schemaVersion: 1;
  requestId: string;
  idempotencyKey: string;
  projectSlug: string;
  snapshotFingerprint: string;
  planId: string;
  stepId: string;
  actionType: ProductionActionType;
  stage?: ProductionStepKey;
  mode: "dry-run";
  confirmation: "not-required" | "required-not-provided" | "provided";
}
export type ProductionExecutionValidationCode =
  | "valid" | "invalid-slug" | "invalid-action" | "stage-mismatch"
  | "stale-plan" | "blocked-step" | "confirmation-required" | "invalid-request";
export interface ProductionExecutionValidationResult {
  valid: boolean;
  code: ProductionExecutionValidationCode;
  request?: ProductionExecutionRequest;
}

export interface ProductionExecutionOperation {
  operationKey: string;
  serviceKey: string;
  requiredInputs: string[];
  expectedOutputs: string[];
  possibleWrites: string[];
  manifestEffects: string[];
}
export interface ProductionExecutionDryRunResult {
  status: "prepared" | "blocked" | "stale" | "unsupported" | "rejected";
  requestId: string;
  operation?: ProductionExecutionOperation;
  reasonCode?: string;
}

export interface ProductionExecutionJobPreview {
  schemaVersion: 1;
  jobId: string;
  idempotencyKey: string;
  projectSlug: string;
  stage?: ProductionStepKey;
  status: "prepared" | "blocked" | "stale" | "unsupported" | "rejected";
  operationKey?: string;
  prerequisites: ProductionStepKey[];
  requiredInputs: { key: string; source: "request" | "project-state" }[];
  expectedOutputs: { key: string; persistence: "preview-only" }[];
}

export interface ProductionIntelligence {
  actions: ProductionRecommendedAction[];
  graph: ProductionDependencyGraph;
  plan: ProductionPlan;
}

export function productionFindingRef(finding: ProductionHealthFinding) {
  const sources = [...finding.sources].sort().join(",");
  const evidence = Object.keys(finding.evidence)
    .sort()
    .map((key) => `${key}:${JSON.stringify(finding.evidence[key])}`)
    .join(",");
  return `${finding.code}:${finding.stage ?? finding.scope}:${sources}:${evidence}`;
}
