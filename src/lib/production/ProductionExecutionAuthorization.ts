import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import type { ProductionActionType } from "@/types/productionIntelligence";
import type {
  ProductionExecutionAuthorizationContext,
  ProductionExecutionAuthorizationPolicy,
  ProductionExecutionAuthorizationReasonCode,
  ProductionExecutionAuthorizationRequest,
  ProductionExecutionAuthorizationResult,
} from "@/types/productionExecutionAuthorization";
import { productionExecutionAuthorizationSchemaVersion } from "@/types/productionExecutionAuthorization";
import type { ProductionCapabilityId } from "@/types/productionExecutionSafety";
import { isValidProductionProjectSlug } from "./ProductionProjectSlug";
import { productionActionRiskProfiles, productionCapabilityMatrix } from "./ProductionExecutionSafetyPlan";

const actions: readonly ProductionActionType[] = ["inspect-source", "reconcile-state", "retry-stage", "resume-stage", "review-metric"];
const reasonMessages: Record<ProductionExecutionAuthorizationReasonCode, string> = {
  AUTHORIZED: "Authorization requirements are satisfied.", ACTOR_MISSING: "Actor identity is required.",
  ACTOR_UNAUTHENTICATED: "Actor must be authenticated.", ACTOR_UNTRUSTED: "Actor identity source is not trusted.",
  PROJECT_INVALID: "Project slug is invalid.", PROJECT_SCOPE_DENIED: "Project is outside the authorized scope.",
  OPERATION_SCOPE_DENIED: "Operation is outside the authorized scope.", ACTION_UNKNOWN: "Action is not canonical.",
  ACTION_NOT_EXECUTABLE: "Action has no executable authorization candidate.", ACTION_UNRESOLVED: "Action execution support is unresolved.",
  STAGE_UNKNOWN: "Stage is not canonical.", ACTION_STAGE_UNSUPPORTED: "Action and stage combination is unsupported.",
  WORKER_IDENTITY_REQUIRED: "A worker identity is required.", WORKER_IDENTITY_INVALID: "Worker identity is not trusted.",
  WORKER_SCOPE_DENIED: "Worker operation scope is insufficient.", CAPABILITY_UNKNOWN: "A capability is not canonical.",
  CAPABILITY_MISSING: "A required capability is missing.", CAPABILITY_DEPENDENCY_MISSING: "A capability dependency is missing.",
  POLICY_DISABLED: "Production execution authorization policy is disabled.", POLICY_INVALID: "Authorization policy is invalid.",
  AUTHORIZATION_INDETERMINATE: "Authorization could not be determined safely.",
};

export const defaultProductionExecutionAuthorizationPolicy: ProductionExecutionAuthorizationPolicy = {
  policyVersion: "production-execution-authorization-v1",
  enabled: false,
  allowedActorTypes: [], allowedProjects: [], allowedOperations: [], allowedActions: [], allowedStages: [],
  requiredCapabilitiesByAction: {}, workerRequirements: { requiredOperations: [] }, riskRequirements: {},
};

export function evaluateProductionExecutionAuthorization(
  request: ProductionExecutionAuthorizationRequest,
  policy: ProductionExecutionAuthorizationPolicy,
  context: ProductionExecutionAuthorizationContext,
): ProductionExecutionAuthorizationResult {
  try {
    return evaluate(request, policy, context);
  } catch {
    return result(request, policy, context, "AUTHORIZATION_INDETERMINATE", "indeterminate");
  }
}

function evaluate(request: ProductionExecutionAuthorizationRequest, policy: ProductionExecutionAuthorizationPolicy, context: ProductionExecutionAuthorizationContext) {
  if (!validPolicy(policy)) return result(request, policy, context, "POLICY_INVALID");
  if (!policy.enabled) return result(request, policy, context, "POLICY_DISABLED");
  if (request.schemaVersion !== productionExecutionAuthorizationSchemaVersion || request.policyContext?.source !== "server") return result(request, policy, context, "POLICY_INVALID");
  if (!request.actor?.id) return result(request, policy, context, "ACTOR_MISSING");
  if (!request.actor.authenticated) return result(request, policy, context, "ACTOR_UNAUTHENTICATED");
  if (!request.actor.trusted || !request.actor.identitySource) return result(request, policy, context, "ACTOR_UNTRUSTED");
  if (!policy.allowedActorTypes.includes(request.actor.type)) return result(request, policy, context, "ACTOR_UNTRUSTED");
  if (!isValidProductionProjectSlug(request.project.slug)) return result(request, policy, context, "PROJECT_INVALID");
  if (!request.actor.allowedProjects.includes(request.project.slug) || !policy.allowedProjects.includes(request.project.slug)) return result(request, policy, context, "PROJECT_SCOPE_DENIED");
  if (!request.actor.allowedOperations.includes(request.operation) || !policy.allowedOperations.includes(request.operation)) return result(request, policy, context, "OPERATION_SCOPE_DENIED");
  if (!actions.includes(request.action as ProductionActionType)) return result(request, policy, context, "ACTION_UNKNOWN");
  const action = request.action as ProductionActionType;
  const profile = productionActionRiskProfiles.find((item) => item.actionType === action);
  if (!profile || profile.executionSupport === "unsupported") return result(request, policy, context, "ACTION_NOT_EXECUTABLE");
  if (profile.executionSupport === "unresolved") return result(request, policy, context, "ACTION_UNRESOLVED");
  if (!policy.allowedActions.includes(action)) return result(request, policy, context, "ACTION_NOT_EXECUTABLE");
  if (!request.stage || !pipelineRecoveryStageOrder.includes(request.stage as (typeof pipelineRecoveryStageOrder)[number]) || !policy.allowedStages.includes(request.stage)) return result(request, policy, context, "STAGE_UNKNOWN");
  if ((action !== "retry-stage" && action !== "resume-stage") || !request.operation.includes(action === "retry-stage" ? "retry" : "resume")) return result(request, policy, context, "ACTION_STAGE_UNSUPPORTED");
  if (policy.workerRequirements.requiredOperations.includes(request.operation)) {
    if (!request.workerIdentity?.id) return result(request, policy, context, "WORKER_IDENTITY_REQUIRED");
    if (!request.workerIdentity.authenticated || !request.workerIdentity.trusted || !request.workerIdentity.identitySource) return result(request, policy, context, "WORKER_IDENTITY_INVALID");
    if (!request.workerIdentity.allowedOperations.includes(request.operation)) return result(request, policy, context, "WORKER_SCOPE_DENIED");
  }
  const knownRequested = canonical(request.capabilities);
  if (knownRequested.length !== new Set(request.capabilities).size) return result(request, policy, context, "CAPABILITY_UNKNOWN");
  const knownGranted = canonical(context.grantedCapabilities);
  if (knownGranted.length !== new Set(context.grantedCapabilities).size) return result(request, policy, context, "CAPABILITY_UNKNOWN");
  const required = policy.requiredCapabilitiesByAction[action] ?? [];
  if (required.some((capability) => !knownRequested.includes(capability) || !knownGranted.includes(capability))) return result(request, policy, context, "CAPABILITY_MISSING");
  if (hasCycle(required)) return result(request, policy, context, "POLICY_INVALID");
  const dependencies = resolveDependencies(required);
  if (dependencies.some((capability) => !knownGranted.includes(capability))) return result(request, policy, context, "CAPABILITY_DEPENDENCY_MISSING");
  return result(request, policy, context, "AUTHORIZED", "allow");
}

function result(request: ProductionExecutionAuthorizationRequest, policy: ProductionExecutionAuthorizationPolicy, context: ProductionExecutionAuthorizationContext, reasonCode: ProductionExecutionAuthorizationReasonCode, decision: "allow" | "deny" | "indeterminate" = "deny"): ProductionExecutionAuthorizationResult {
  const action = actions.includes(request.action as ProductionActionType) ? request.action as ProductionActionType : undefined;
  const required = action ? [...(policy.requiredCapabilitiesByAction[action] ?? [])] : [];
  const granted = canonical(context.grantedCapabilities);
  const risk = action ? policy.riskRequirements[action] : undefined;
  return {
    schemaVersion: productionExecutionAuthorizationSchemaVersion, decision, authorized: decision === "allow", reasonCode,
    reason: reasonMessages[reasonCode], evaluatedAt: request.requestedAt, actorId: request.actor?.id ?? "unknown-actor",
    projectSlug: request.project.slug, operation: request.operation, action: request.action, ...(request.stage ? { stage: request.stage } : {}),
    requiredCapabilities: required, grantedCapabilities: granted, missingCapabilities: required.filter((item) => !granted.includes(item)),
    policyVersion: policy.policyVersion || "invalid-policy", risk: risk?.risk ?? "none",
    requiresConfirmation: risk?.requiresConfirmation ?? false, requiredConfirmationLevel: risk?.requiredConfirmationLevel ?? "none",
    evidence: [`policy:${policy.policyVersion || "invalid"}`, `reason:${reasonCode}`],
  };
}

function canonical(values: readonly string[]): ProductionCapabilityId[] {
  const requested = new Set(values);
  return productionCapabilityMatrix.map((item) => item.id).filter((id) => requested.has(id));
}
function resolveDependencies(ids: readonly ProductionCapabilityId[]) {
  const resolved = new Set<ProductionCapabilityId>();
  const visit = (id: ProductionCapabilityId) => { for (const dependency of productionCapabilityMatrix.find((item) => item.id === id)?.dependencies ?? []) { resolved.add(dependency); visit(dependency); } };
  ids.forEach(visit); return canonical([...resolved]);
}
function hasCycle(ids: readonly ProductionCapabilityId[]) {
  const visiting = new Set<ProductionCapabilityId>(); const visited = new Set<ProductionCapabilityId>();
  const visit = (id: ProductionCapabilityId): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const dependency of productionCapabilityMatrix.find((item) => item.id === id)?.dependencies ?? []) if (visit(dependency)) return true; visiting.delete(id); visited.add(id); return false; };
  return ids.some(visit);
}
function validPolicy(policy: ProductionExecutionAuthorizationPolicy) {
  return Boolean(policy.policyVersion) && policy.allowedActions.every((action) => actions.includes(action)) && policy.allowedStages.every((stage) => pipelineRecoveryStageOrder.includes(stage as (typeof pipelineRecoveryStageOrder)[number]));
}
