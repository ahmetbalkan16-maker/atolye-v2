import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ProductionExecutionContract } from "../src/lib/production/ProductionExecutionContract";
import {
  firstRealExecutionCandidate,
  productionActionRiskProfiles,
  productionCapabilityMatrix,
  productionExecutionInvariants,
  productionExecutionRoadmap,
  productionExecutionThreats,
} from "../src/lib/production/ProductionExecutionSafetyPlan";
import { ProductionIntelligenceService } from "../src/lib/production/ProductionIntelligenceService";
import { productionIntelligenceSchemaVersion } from "../src/types/productionIntelligence";
import type { ProductionCapabilityId } from "../src/types/productionExecutionSafety";
import { intelligenceFixture } from "./production-intelligence-fixture";

const expectedOrder: ProductionCapabilityId[] = [
  "snapshot", "health", "evidence", "actions", "dependency-graph", "planner",
  "execution-contract", "dry-run-gateway", "job-preview", "consumer-versioning",
  "api-integration", "passive-ui", "real-execution", "queue-dispatch",
  "authorization", "confirmation", "persistent-idempotency", "audit-trail",
  "cancellation", "retry-policy", "rollback", "recovery", "controlled-rollout",
];

async function main() {
  assert.deepEqual(productionCapabilityMatrix.map((item) => item.id), expectedOrder);
  assert.equal(new Set(productionCapabilityMatrix.map((item) => item.id)).size, expectedOrder.length);
  assert.equal(capability("real-execution").status, "blocked");
  assert.equal(capability("queue-dispatch").status, "blocked");
  assert.equal(capability("dry-run-gateway").status, "preview-only");
  assert.equal(capability("job-preview").status, "preview-only");
  assert.equal(productionIntelligenceSchemaVersion, "1");
  assert.equal(productionActionRiskProfiles.find((item) => item.actionType === "inspect-source")?.executionSupport, "unsupported");

  const { snapshot, health } = intelligenceFixture();
  const { plan } = ProductionIntelligenceService.derive(snapshot, health);
  const step = plan.steps.find((item) => item.id === plan.recommendedStepId)!;
  const unconfirmed = ProductionExecutionContract.build("closure-project", plan, step);
  assert.equal(ProductionExecutionContract.validate(unconfirmed, plan, plan.snapshotFingerprint).code, "confirmation-required");
  const confirmed = ProductionExecutionContract.build("closure-project", plan, step, true);
  assert.equal(ProductionExecutionContract.validate(confirmed, plan, "stale-fingerprint").code, "stale-plan");

  assert.equal(capability("persistent-idempotency").status, "planned");
  assert.equal(capability("audit-trail").status, "planned");
  assert.equal(capability("rollback").status, "unsupported");
  assert.equal(firstRealExecutionCandidate, "not-selected");
  assert.equal(productionExecutionInvariants.length, 20);
  assert.equal(productionExecutionThreats.length, 21);
  assert.deepEqual(productionCapabilityMatrix, structuredClone(productionCapabilityMatrix));
  assert.equal(hasDependencyCycle(), false);
  assert.deepEqual(productionExecutionRoadmap.map((item) => item.sprint), ["97.1", "97.2", "97.3", "97.4", "97.5", "97.6", "97.7", "97.8", "97.9"]);

  const publicText = JSON.stringify({ productionCapabilityMatrix, productionActionRiskProfiles });
  assert.ok(!publicText.includes("C:\\Users"));
  assert.ok(!/api[_-]?key|secret|stack trace/i.test(publicText));
  assert.ok(productionCapabilityMatrix.every((item) => !item.usesPersistence && !item.producesSideEffects));

  const source = await readFile("src/lib/production/ProductionExecutionSafetyPlan.ts", "utf-8");
  assert.ok(!/writeFile|writeJSON|fetch\(|enqueue\(|dispatch\(|executeJobRetry\(|runFromStage\(|process\.env|Date\.now|Math\.random|randomUUID|setInterval/.test(source));

  console.log("Sprint 97.0 production phase closure smoke: PASS (20 scenarios)");
}

function capability(id: ProductionCapabilityId) {
  const item = productionCapabilityMatrix.find((candidate) => candidate.id === id);
  assert.ok(item, `Missing capability ${id}`);
  return item;
}

function hasDependencyCycle() {
  const visiting = new Set<ProductionCapabilityId>();
  const visited = new Set<ProductionCapabilityId>();
  const visit = (id: ProductionCapabilityId): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of capability(id).dependencies) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return expectedOrder.some(visit);
}

void main();
