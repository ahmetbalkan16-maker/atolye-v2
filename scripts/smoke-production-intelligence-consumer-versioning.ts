import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductionHealthPanelView } from "../src/components/studio/ProductionHealthPanel";
import { getProductionHealth } from "../src/lib/production/ProductionHealthApiClient";
import { parseProductionIntelligence } from "../src/lib/production/ProductionIntelligenceConsumer";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import { productionIntelligenceSchemaVersion } from "../src/types/productionIntelligence";

const slug = "sprint-96-8-versioning";
const evaluatedAt = "2026-07-11T22:00:00.000Z";

async function main() {
  const report = await ProductionHealthService.getProductionHealth({ projectSlug: slug, evaluatedAt });
  const full = report.intelligence!;
  assert.equal(full.schemaVersion, productionIntelligenceSchemaVersion);

  assert.deepEqual(parseProductionIntelligence(undefined), { status: "absent", value: null });

  const minimal = { schemaVersion: "1", actions: [], graph: full.graph, plan: { ...full.plan, steps: [], recommendedStepId: undefined } };
  assert.equal(parseProductionIntelligence(minimal).status, "valid");
  assert.equal(parseProductionIntelligence(full).status, "valid");

  const extended = { ...full, futureField: { enabled: true } };
  const extendedResult = parseProductionIntelligence(extended);
  assert.equal(extendedResult.status, "valid");
  if (extendedResult.status === "valid") assert.equal("futureField" in extendedResult.value, false);

  assert.deepEqual(parseProductionIntelligence({ schemaVersion: "999" }), { status: "unsupported", value: null, schemaVersion: "999" });
  assert.deepEqual(parseProductionIntelligence({ actions: [], graph: full.graph, plan: full.plan }), { status: "invalid", value: null, reason: "missing-schema-version" });
  assert.equal(parseProductionIntelligence(null).status, "invalid");
  assert.equal(parseProductionIntelligence([]).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, actions: {} }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, plan: { ...full.plan, status: "future" } }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, plan: { ...full.plan, recommendedStepId: "missing-step" } }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, executionPreview: { status: "prepared" } }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, jobPreview: { schemaVersion: 1 } }).status, "invalid");

  const action = full.actions[0];
  assert.equal(parseProductionIntelligence({ ...full, actions: [{ ...action, actionType: "future-action" }] }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, actions: [{ ...action, affectedStage: "future-stage" }] }).status, "invalid");
  assert.equal(parseProductionIntelligence({ ...full, graph: { ...full.graph, nodes: [{ deep: { unexpected: { object: true } } }] } }).status, "invalid");

  const prototypePayload = JSON.parse(JSON.stringify(full).replace(/^{/, '{"__proto__":{"polluted":true},')) as unknown;
  assert.equal(parseProductionIntelligence(prototypePayload).status, "valid");
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);

  assert.deepEqual(parseProductionIntelligence(full), parseProductionIntelligence(full));
  const reordered = { plan: full.plan, graph: full.graph, actions: full.actions, schemaVersion: full.schemaVersion };
  assert.deepEqual(parseProductionIntelligence(full), parseProductionIntelligence(reordered));
  assert.deepEqual(parseProductionIntelligence(full), parseProductionIntelligence(extended));

  const legacyReport = { schemaVersion: report.schemaVersion, projectSlug: report.projectSlug, generatedAt: report.generatedAt, snapshot: report.snapshot, health: report.health };
  const legacyConsumed = await consume(legacyReport);
  assert.equal(legacyConsumed.intelligence, undefined);
  assert.ok(render(legacyConsumed).includes("Production Health"));

  const unsupportedConsumed = await consume({ ...report, intelligence: { schemaVersion: "999" } });
  assert.equal(unsupportedConsumed.intelligence, undefined);
  assert.ok(!render(unsupportedConsumed).includes("Production plan"));

  const invalidConsumed = await consume({ ...report, intelligence: { ...full, actions: null } });
  assert.equal(invalidConsumed.intelligence, undefined);
  assert.ok(render(invalidConsumed).includes("Status:"));

  console.log("Sprint 96.8 production intelligence consumer versioning smoke: PASS (22 scenarios)");
}

function consume(data: unknown) {
  return getProductionHealth(slug, { fetchImpl: async () => Response.json({ success: true, data }) });
}

function render(report: Awaited<ReturnType<typeof consume>>) {
  return renderToStaticMarkup(createElement(ProductionHealthPanelView, { state: { kind: "success", report }, onRetry: () => undefined }));
}

void main();
