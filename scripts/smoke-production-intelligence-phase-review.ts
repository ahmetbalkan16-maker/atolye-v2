import assert from "node:assert/strict";
import { ProductionActionEngine } from "../src/lib/production/ProductionActionEngine";
import { detectProductionDependencyCycles } from "../src/lib/production/ProductionDependencyGraph";
import { ProductionExecutionContract } from "../src/lib/production/ProductionExecutionContract";
import { ProductionExecutionGateway } from "../src/lib/production/ProductionExecutionGateway";
import { ProductionExecutionJobContract } from "../src/lib/production/ProductionExecutionJobContract";
import { getProductionHealth, ProductionHealthApiConsumerError } from "../src/lib/production/ProductionHealthApiClient";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import { ProductionIntelligenceService } from "../src/lib/production/ProductionIntelligenceService";
import type { ProductionHealthFinding } from "../src/types/productionHealth";
import type { ProductionPlan, ProductionPlanStep } from "../src/types/productionIntelligence";
import { intelligenceFixture } from "./production-intelligence-fixture";

const slug = "sprint-96-7-review";

async function main() {
  const { snapshot, health } = intelligenceFixture();
  const baseline = ProductionIntelligenceService.derive(snapshot, health);
  assert.deepEqual(baseline, ProductionIntelligenceService.derive(snapshot, health));

  const sourceOne = sourceFinding(["project"], { expected: true, actual: false });
  const sourceTwo = sourceFinding(["manifest"], { actual: false, expected: true });
  const orderedHealth = { ...health, findings: [sourceOne, sourceTwo] };
  const reversedHealth = { ...health, findings: [sourceTwo, sourceOne] };
  assert.deepEqual(
    ProductionActionEngine.recommend(orderedHealth),
    ProductionActionEngine.recommend(reversedHealth),
  );
  assert.equal(ProductionActionEngine.recommend(orderedHealth).length, 2);

  const evidenceOrderHealth = {
    ...health,
    findings: [
      sourceFinding(["project", "manifest"], { expected: true, actual: false }),
    ],
  };
  const evidenceReverseHealth = {
    ...health,
    findings: [
      sourceFinding(["manifest", "project"], { actual: false, expected: true }),
    ],
  };
  assert.deepEqual(
    ProductionActionEngine.recommend(evidenceOrderHealth),
    ProductionActionEngine.recommend(evidenceReverseHealth),
  );

  assert.deepEqual(baseline.graph.cycles, []);
  assert.ok(
    detectProductionDependencyCycles([
      { from: "research", to: "script" },
      { from: "script", to: "research" },
    ]).length > 0,
  );

  const unreliable = structuredClone(snapshot);
  unreliable.sourceState.project = { status: "unreadable" };
  const unreliablePlan = ProductionIntelligenceService.derive(unreliable, health).plan;
  assert.equal(unreliablePlan.status, "unknown");
  assert.equal(unreliablePlan.recommendedStepId, undefined);

  const step = baseline.plan.steps.find((item) => item.id === baseline.plan.recommendedStepId)!;
  const request = ProductionExecutionContract.build(slug, baseline.plan, step, true);
  assert.equal(
    ProductionExecutionContract.validate(
      { ...request, requestId: "request-tampered" },
      baseline.plan,
      baseline.plan.snapshotFingerprint,
    ).code,
    "invalid-request",
  );
  assert.equal(
    ProductionExecutionContract.validate(
      { ...request, stage: undefined },
      baseline.plan,
      baseline.plan.snapshotFingerprint,
    ).code,
    "stage-mismatch",
  );

  const stale = ProductionExecutionGateway.dryRun(
    ProductionExecutionContract.validate(request, baseline.plan, "snapshot-stale"),
  );
  assert.equal(stale.status, "stale");
  const staleJob = ProductionExecutionJobContract.preview(request, stale, step);
  assert.equal(staleJob.status, "stale");
  assert.ok(!("snapshot" in staleJob));

  const unsupportedStep: ProductionPlanStep = {
    ...step,
    id: "step-inspect-source",
    actionType: "inspect-source",
    stage: undefined,
    confirmationRequired: false,
  };
  const unsupportedPlan: ProductionPlan = {
    ...baseline.plan,
    id: "plan-inspect-source",
    recommendedStepId: unsupportedStep.id,
    steps: [unsupportedStep],
  };
  const unsupportedRequest = ProductionExecutionContract.build(slug, unsupportedPlan, unsupportedStep);
  assert.equal(
    ProductionExecutionGateway.dryRun(
      ProductionExecutionContract.validate(
        unsupportedRequest,
        unsupportedPlan,
        unsupportedPlan.snapshotFingerprint,
      ),
    ).status,
    "unsupported",
  );

  const originalDerive = ProductionIntelligenceService.derive;
  ProductionIntelligenceService.derive = () => {
    throw new Error("synthetic intelligence failure");
  };
  try {
    const healthOnly = await ProductionHealthService.getProductionHealth({
      projectSlug: slug,
      evaluatedAt: "2026-07-11T21:00:00.000Z",
    });
    assert.equal(healthOnly.projectSlug, slug);
    assert.equal(healthOnly.intelligence, undefined);
  } finally {
    ProductionIntelligenceService.derive = originalDerive;
  }

  const report = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt: "2026-07-11T21:00:00.000Z",
  });
  const malformed = { ...report, intelligence: { actions: null } };
  await assert.rejects(
    getProductionHealth(slug, {
      fetchImpl: async () => Response.json({ success: true, data: malformed }),
    }),
    (error: unknown) =>
      error instanceof ProductionHealthApiConsumerError &&
      error.kind === "malformed_response",
  );

  const serialized = JSON.stringify({ baseline, request, staleJob });
  assert.ok(!serialized.includes("C:\\Users"));
  assert.ok(!serialized.toLowerCase().includes("api_key"));
  assert.ok(!serialized.toLowerCase().includes("stack"));

  console.log("Sprint 96.7 production intelligence phase review smoke: PASS (18 scenarios)");
}

function sourceFinding(
  sources: ProductionHealthFinding["sources"],
  evidence: ProductionHealthFinding["evidence"],
): ProductionHealthFinding {
  return {
    code: "source_missing",
    severity: "warning",
    category: "source",
    scope: "source",
    sources,
    message: "Snapshot source is missing.",
    evidence,
    detectedAt: "2026-07-11T21:00:00.000Z",
  };
}

void main();
