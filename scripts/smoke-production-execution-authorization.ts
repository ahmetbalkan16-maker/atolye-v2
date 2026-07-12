import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pipelineRecoveryStageOrder } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import {
  defaultProductionExecutionAuthorizationPolicy,
  evaluateProductionExecutionAuthorization,
} from "../src/lib/production/ProductionExecutionAuthorization";
import { productionCapabilityMatrix } from "../src/lib/production/ProductionExecutionSafetyPlan";
import type {
  ProductionExecutionAuthorizationContext,
  ProductionExecutionAuthorizationPolicy,
  ProductionExecutionAuthorizationRequest,
} from "../src/types/productionExecutionAuthorization";

const operation = "pipeline.stage.retry.preview";
const allCapabilities = productionCapabilityMatrix.map((item) => item.id);
const request: ProductionExecutionAuthorizationRequest = {
  schemaVersion: "1",
  actor: { id: "actor-1", type: "user", authenticated: true, trusted: true, identitySource: "server-session", allowedProjects: ["project-1"], allowedOperations: [operation] },
  project: { slug: "project-1" }, operation, action: "retry-stage", stage: "script",
  workerIdentity: { id: "worker-1", authenticated: true, trusted: true, identitySource: "server-worker-registry", allowedOperations: [operation] },
  requestedAt: "2026-07-12T00:00:00.000Z", requestId: "request-1", idempotencyKey: "execution-1", executionFingerprint: "fingerprint-1",
  capabilities: ["authorization"], policyContext: { environment: "test", source: "server" },
};
const policy: ProductionExecutionAuthorizationPolicy = {
  policyVersion: "test-policy-v1", enabled: true, allowedActorTypes: ["user", "service"], allowedProjects: ["project-1"],
  allowedOperations: [operation, "pipeline.stage.resume.preview"], allowedActions: ["retry-stage", "resume-stage"], allowedStages: [...pipelineRecoveryStageOrder],
  requiredCapabilitiesByAction: { "retry-stage": ["authorization"], "resume-stage": ["authorization"] },
  workerRequirements: { requiredOperations: [operation, "pipeline.stage.resume.preview"] },
  riskRequirements: {
    "retry-stage": { risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high" },
    "resume-stage": { risk: "high", requiresConfirmation: true, requiredConfirmationLevel: "high" },
  },
};
const context: ProductionExecutionAuthorizationContext = { grantedCapabilities: allCapabilities };
const evaluate = (requestOverride: Partial<ProductionExecutionAuthorizationRequest> = {}, policyOverride: Partial<ProductionExecutionAuthorizationPolicy> = {}, contextOverride: Partial<ProductionExecutionAuthorizationContext> = {}) =>
  evaluateProductionExecutionAuthorization({ ...request, ...requestOverride }, { ...policy, ...policyOverride }, { ...context, ...contextOverride });

async function main() {
  assert.equal(evaluate().decision, "allow");
  assert.equal(evaluate({}, { enabled: false }).reasonCode, "POLICY_DISABLED");
  assert.equal(evaluate({ actor: undefined }).reasonCode, "ACTOR_MISSING");
  assert.equal(evaluate({ actor: { ...request.actor!, authenticated: false } }).reasonCode, "ACTOR_UNAUTHENTICATED");
  assert.equal(evaluate({ actor: { ...request.actor!, trusted: false } }).reasonCode, "ACTOR_UNTRUSTED");
  assert.equal(evaluate({ project: { slug: "project-2" } }).reasonCode, "PROJECT_SCOPE_DENIED");
  assert.equal(evaluate({ operation: "pipeline.stage.other.preview" }).reasonCode, "OPERATION_SCOPE_DENIED");
  assert.equal(evaluate({ action: "unknown-action" }).reasonCode, "ACTION_UNKNOWN");
  assert.equal(evaluate({ action: "inspect-source" }, { allowedActions: [...policy.allowedActions, "inspect-source"] }).reasonCode, "ACTION_NOT_EXECUTABLE");
  assert.equal(evaluate({ action: "review-metric" }, { allowedActions: [...policy.allowedActions, "review-metric"] }).reasonCode, "ACTION_NOT_EXECUTABLE");
  assert.equal(evaluate({ action: "reconcile-state" }, { allowedActions: [...policy.allowedActions, "reconcile-state"] }).reasonCode, "ACTION_UNRESOLVED");
  assert.equal(evaluate({ stage: "unknown-stage" }).reasonCode, "STAGE_UNKNOWN");
  assert.equal(evaluate({ action: "resume-stage" }).reasonCode, "ACTION_STAGE_UNSUPPORTED");
  assert.equal(evaluate({ workerIdentity: undefined }).reasonCode, "WORKER_IDENTITY_REQUIRED");
  assert.equal(evaluate().authorized, true);
  assert.equal(evaluate({ workerIdentity: { ...request.workerIdentity!, allowedOperations: [] } }).reasonCode, "WORKER_SCOPE_DENIED");
  assert.equal(evaluate({ capabilities: [] }).reasonCode, "CAPABILITY_MISSING");
  assert.equal(evaluate({ capabilities: ["authorization", "unknown-capability"] }).reasonCode, "CAPABILITY_UNKNOWN");
  assert.equal(evaluate({}, {}, { grantedCapabilities: allCapabilities.filter((item) => item !== "snapshot") }).reasonCode, "CAPABILITY_DEPENDENCY_MISSING");
  const retry = evaluate(); assert.equal(retry.risk, "high"); assert.equal(retry.requiresConfirmation, true); assert.equal(retry.requiredConfirmationLevel, "high");
  const resumeOperation = "pipeline.stage.resume.preview";
  const resume = evaluate({ action: "resume-stage", operation: resumeOperation, actor: { ...request.actor!, allowedOperations: [resumeOperation] }, workerIdentity: { ...request.workerIdentity!, allowedOperations: [resumeOperation] } });
  assert.equal(resume.authorized, true); assert.equal(resume.risk, "high"); assert.equal(resume.requiresConfirmation, true);
  const frozenRequest = structuredClone(request); const frozenPolicy = structuredClone(policy); const frozenContext = structuredClone(context); evaluate();
  assert.deepEqual(request, frozenRequest); assert.deepEqual(policy, frozenPolicy); assert.deepEqual(context, frozenContext);
  assert.deepEqual(evaluate(), evaluate());
  const secretRequest = { ...request, requestId: "secret-api-key", executionFingerprint: "C:\\private\\stack trace" }; const publicText = JSON.stringify(evaluateProductionExecutionAuthorization(secretRequest, policy, context));
  assert.ok(!/secret-api-key|C:\\private|stack trace/i.test(publicText));
  assert.equal(evaluate({ actor: { ...request.actor!, authenticated: false }, policyContext: { environment: "local", source: "server" } }).authorized, false);
  assert.equal(evaluate({ policyContext: { environment: "local", source: "client" as "server" } }).reasonCode, "POLICY_INVALID");
  assert.equal(evaluate({}, { policyVersion: "" }).reasonCode, "POLICY_INVALID");
  assert.equal(defaultProductionExecutionAuthorizationPolicy.enabled, false);
  assert.deepEqual(evaluate().grantedCapabilities, allCapabilities);

  const source = await readFile("src/lib/production/ProductionExecutionAuthorization.ts", "utf8");
  assert.ok(!/writeFile|writeJSON|saveJson|fetch\(|enqueue\(|dispatch\(|process\.env|Date\.now|Math\.random|randomUUID|setInterval/.test(source));
  console.log("Sprint 97.1 production execution authorization smoke: PASS (28 scenarios)");
}

void main();
