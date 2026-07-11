import {
  productionIntelligenceSchemaVersion,
  type ProductionActionPriority,
  type ProductionActionType,
  type ProductionDependencyEdge,
  type ProductionDependencyGraph,
  type ProductionDependencyNode,
  type ProductionExecutionDryRunResult,
  type ProductionExecutionJobPreview,
  type ProductionExecutionOperation,
  type ProductionIntelligence,
  type ProductionPlan,
  type ProductionPlanStep,
  type ProductionRecommendedAction,
} from "@/types/productionIntelligence";
import type { ProductionStepKey } from "@/types/project";

export type ProductionIntelligenceConsumerResult =
  | { status: "absent"; value: null }
  | { status: "valid"; value: ProductionIntelligence }
  | { status: "invalid"; value: null; reason: "invalid-payload" | "missing-schema-version" }
  | { status: "unsupported"; value: null; schemaVersion: string };

const stages: readonly ProductionStepKey[] = [
  "research", "script", "scenes", "visuals", "animation", "video",
  "audio", "assembly", "thumbnail", "seo", "youtube", "export",
];
const actionTypes: readonly ProductionActionType[] = [
  "inspect-source", "reconcile-state", "retry-stage", "resume-stage", "review-metric",
];
const actionPriorities: readonly ProductionActionPriority[] = ["critical", "high", "normal"];
const planStatuses = ["ready", "blocked", "complete", "unknown"] as const;
const stepStatuses = ["ready", "blocked"] as const;
const nodeStatuses = ["complete", "ready", "blocked", "unknown"] as const;
const previewStatuses = ["prepared", "blocked", "stale", "unsupported", "rejected"] as const;

export function parseProductionIntelligence(value: unknown): ProductionIntelligenceConsumerResult {
  if (value === undefined) return { status: "absent", value: null };
  if (!isRecord(value)) return { status: "invalid", value: null, reason: "invalid-payload" };
  if (!("schemaVersion" in value)) return { status: "invalid", value: null, reason: "missing-schema-version" };
  if (typeof value.schemaVersion !== "string") return { status: "invalid", value: null, reason: "invalid-payload" };
  if (value.schemaVersion !== productionIntelligenceSchemaVersion) {
    return { status: "unsupported", value: null, schemaVersion: value.schemaVersion };
  }

  const actions = parseArray(value.actions, parseAction);
  const graph = parseGraph(value.graph);
  const plan = parsePlan(value.plan);
  const executionPreview = value.executionPreview === undefined ? undefined : parseExecutionPreview(value.executionPreview);
  const jobPreview = value.jobPreview === undefined ? undefined : parseJobPreview(value.jobPreview);
  if (!actions || !graph || !plan || executionPreview === null || jobPreview === null) {
    return { status: "invalid", value: null, reason: "invalid-payload" };
  }

  return {
    status: "valid",
    value: {
      schemaVersion: productionIntelligenceSchemaVersion,
      actions,
      graph,
      plan,
      ...(executionPreview ? { executionPreview } : {}),
      ...(jobPreview ? { jobPreview } : {}),
    },
  };
}

function parseAction(value: unknown): ProductionRecommendedAction | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.findingRef) || !isEnum(value.actionType, actionTypes) || !isString(value.title) || !isString(value.reason) || !isEnum(value.priority, actionPriorities) || value.safety !== "read-only-recommendation" || typeof value.confirmationRequired !== "boolean") return null;
  if (value.affectedStage !== undefined && !isStage(value.affectedStage)) return null;
  return { id: value.id, findingRef: value.findingRef, actionType: value.actionType, ...(value.affectedStage ? { affectedStage: value.affectedStage } : {}), title: value.title, reason: value.reason, priority: value.priority, safety: value.safety, confirmationRequired: value.confirmationRequired };
}

function parseGraph(value: unknown): ProductionDependencyGraph | null {
  if (!isRecord(value)) return null;
  const nodes = parseArray(value.nodes, parseNode);
  const edges = parseArray(value.edges, parseEdge);
  const blockedStages = parseArray(value.blockedStages, parseStage);
  const rootCauseStages = parseArray(value.rootCauseStages, parseStage);
  const cycles = parseArray(value.cycles, (cycle) => parseArray(cycle, parseStage));
  return nodes && edges && blockedStages && rootCauseStages && cycles ? { nodes, edges, blockedStages, rootCauseStages, cycles } : null;
}

function parseNode(value: unknown): ProductionDependencyNode | null {
  if (!isRecord(value) || !isStage(value.stage) || !isEnum(value.status, nodeStatuses)) return null;
  const upstreamDependencies = parseArray(value.upstreamDependencies, parseStage);
  const downstreamUnlocks = parseArray(value.downstreamUnlocks, parseStage);
  const rootCauseFindingRefs = parseArray(value.rootCauseFindingRefs, parseString);
  return upstreamDependencies && downstreamUnlocks && rootCauseFindingRefs ? { stage: value.stage, status: value.status, upstreamDependencies, downstreamUnlocks, rootCauseFindingRefs } : null;
}

function parseEdge(value: unknown): ProductionDependencyEdge | null {
  return isRecord(value) && isStage(value.from) && isStage(value.to) ? { from: value.from, to: value.to } : null;
}

function parsePlan(value: unknown): ProductionPlan | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.snapshotFingerprint) || !isEnum(value.status, planStatuses)) return null;
  const steps = parseArray(value.steps, parseStep);
  if (!steps || (value.recommendedStepId !== undefined && !isString(value.recommendedStepId))) return null;
  if (value.recommendedStepId && !steps.some((step) => step.id === value.recommendedStepId)) return null;
  return { id: value.id, snapshotFingerprint: value.snapshotFingerprint, status: value.status, ...(value.recommendedStepId ? { recommendedStepId: value.recommendedStepId } : {}), steps };
}

function parseStep(value: unknown): ProductionPlanStep | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.actionId) || !isEnum(value.actionType, actionTypes) || !isEnum(value.status, stepStatuses) || typeof value.confirmationRequired !== "boolean") return null;
  if (value.stage !== undefined && !isStage(value.stage)) return null;
  const prerequisites = parseArray(value.prerequisites, parseStage);
  const unlocks = parseArray(value.unlocks, parseStage);
  const rootCauseFindingRefs = parseArray(value.rootCauseFindingRefs, parseString);
  const selectionReasons = parseArray(value.selectionReasons, parseString);
  return prerequisites && unlocks && rootCauseFindingRefs && selectionReasons ? { id: value.id, actionId: value.actionId, actionType: value.actionType, ...(value.stage ? { stage: value.stage } : {}), status: value.status, prerequisites, unlocks, rootCauseFindingRefs, selectionReasons, confirmationRequired: value.confirmationRequired } : null;
}

function parseExecutionPreview(value: unknown): ProductionExecutionDryRunResult | null {
  if (!isRecord(value) || !isEnum(value.status, previewStatuses) || !isString(value.requestId) || !isOptionalString(value.reasonCode)) return null;
  const operation = value.operation === undefined ? undefined : parseOperation(value.operation);
  if (operation === null) return null;
  return { status: value.status, requestId: value.requestId, ...(operation ? { operation } : {}), ...(value.reasonCode ? { reasonCode: value.reasonCode } : {}) };
}

function parseOperation(value: unknown): ProductionExecutionOperation | null {
  if (!isRecord(value) || !isString(value.operationKey) || !isString(value.serviceKey)) return null;
  const requiredInputs = parseArray(value.requiredInputs, parseString);
  const expectedOutputs = parseArray(value.expectedOutputs, parseString);
  const possibleWrites = parseArray(value.possibleWrites, parseString);
  const manifestEffects = parseArray(value.manifestEffects, parseString);
  return requiredInputs && expectedOutputs && possibleWrites && manifestEffects ? { operationKey: value.operationKey, serviceKey: value.serviceKey, requiredInputs, expectedOutputs, possibleWrites, manifestEffects } : null;
}

function parseJobPreview(value: unknown): ProductionExecutionJobPreview | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isString(value.jobId) || !isString(value.idempotencyKey) || !isString(value.projectSlug) || !isEnum(value.status, previewStatuses) || !isOptionalString(value.operationKey)) return null;
  if (value.stage !== undefined && !isStage(value.stage)) return null;
  const prerequisites = parseArray(value.prerequisites, parseStage);
  const requiredInputs = parseArray(value.requiredInputs, parseInputDescriptor);
  const expectedOutputs = parseArray(value.expectedOutputs, parseOutputDescriptor);
  return prerequisites && requiredInputs && expectedOutputs ? { schemaVersion: 1, jobId: value.jobId, idempotencyKey: value.idempotencyKey, projectSlug: value.projectSlug, ...(value.stage ? { stage: value.stage } : {}), status: value.status, ...(value.operationKey ? { operationKey: value.operationKey } : {}), prerequisites, requiredInputs, expectedOutputs } : null;
}

function parseInputDescriptor(value: unknown): ProductionExecutionJobPreview["requiredInputs"][number] | null { return isRecord(value) && isString(value.key) && (value.source === "request" || value.source === "project-state") ? { key: value.key, source: value.source } : null; }
function parseOutputDescriptor(value: unknown): ProductionExecutionJobPreview["expectedOutputs"][number] | null { return isRecord(value) && isString(value.key) && value.persistence === "preview-only" ? { key: value.key, persistence: value.persistence } : null; }
function parseStage(value: unknown) { return isStage(value) ? value : null; }
function parseString(value: unknown) { return isString(value) ? value : null; }
function parseArray<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null { if (!Array.isArray(value)) return null; const parsed = value.map(parse); return parsed.some((item) => item === null) ? null : parsed as T[]; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isString(value: unknown): value is string { return typeof value === "string"; }
function isOptionalString(value: unknown) { return value === undefined || typeof value === "string"; }
function isStage(value: unknown): value is ProductionStepKey { return typeof value === "string" && stages.includes(value as ProductionStepKey); }
function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T { return typeof value === "string" && values.includes(value as T); }
