import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProductionHealthPanelView,
  loadProductionHealthUiState,
  type ProductionHealthUiState,
} from "../src/components/studio/ProductionHealthPanel";
import { ProductionHealthApiConsumerError } from "../src/lib/production/ProductionHealthApiClient";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import type { ProductionHealthReport } from "../src/lib/production/ProductionHealthService";

const slug = "sprint-95-7-health-ui";
const evaluatedAt = "2026-07-11T19:00:00.000Z";

async function main() {
  const baseReport = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });

  const loading = render({ kind: "loading" });
  assert.ok(loading.includes("Production health yukleniyor."));
  assert.ok(loading.includes('role="status"'));

  const healthyReport = withHealth(baseReport, "healthy", "none");
  const success = render({ kind: "success", report: healthyReport });
  assert.ok(success.includes("Status: healthy"));
  assert.ok(success.includes("Severity: none"));
  assert.ok(success.includes("Source confidence"));
  assert.ok(success.includes("Evaluated at"));

  const warning = render({
    kind: "success",
    report: withHealth(baseReport, "warning", "warning"),
  });
  assert.ok(warning.includes("Status: warning"));
  assert.ok(warning.includes("text-yellow-400"));

  const critical = render({
    kind: "success",
    report: withHealth(baseReport, "critical", "critical"),
  });
  assert.ok(critical.includes("Status: critical"));
  assert.ok(critical.includes("text-red-400"));

  const unknown = render({
    kind: "success",
    report: withHealth(baseReport, "unknown", "none"),
  });
  assert.ok(unknown.includes("Status: unknown"));
  assert.ok(unknown.includes("source confidence is insufficient"));

  const error = render({
    kind: "error",
    message: "Production health response was invalid.",
  });
  assert.ok(error.includes('role="alert"'));
  assert.ok(error.includes("Production health response was invalid."));
  assert.ok(error.includes("Retry"));

  let loadCount = 0;
  const loader = async () => {
    loadCount += 1;
    return healthyReport;
  };
  assert.equal(
    (await loadProductionHealthUiState(slug, loader)).kind,
    "success",
  );
  assert.equal(
    (await loadProductionHealthUiState(slug, loader)).kind,
    "success",
  );
  assert.equal(loadCount, 2);

  const malformedState = await loadProductionHealthUiState(slug, async () => {
    throw new ProductionHealthApiConsumerError("malformed_response");
  });
  assert.deepEqual(malformedState, {
    kind: "error",
    message: "Production health response was invalid.",
  });

  const emptyReport = structuredClone(healthyReport);
  emptyReport.health.findings = [];
  emptyReport.health.counts = {
    total: 0,
    info: 0,
    warning: 0,
    critical: 0,
  };
  const empty = render({ kind: "success", report: emptyReport });
  assert.ok(empty.includes("Findings"));
  assert.ok(empty.includes(">0<"));
  assert.ok(empty.includes("No production health findings were reported."));

  const deterministicState: ProductionHealthUiState = {
    kind: "success",
    report: criticalReport(baseReport),
  };
  assert.equal(render(deterministicState), render(deterministicState));

  const unknownFailure = await loadProductionHealthUiState(slug, async () => {
    throw new Error("secret internal stack");
  });
  assert.deepEqual(unknownFailure, {
    kind: "error",
    message: "Production health could not be loaded.",
  });

  console.log("Sprint 95.7 production health UI smoke: PASS (10 scenarios)");
}

function render(state: ProductionHealthUiState) {
  return renderToStaticMarkup(
    createElement(ProductionHealthPanelView, {
      state,
      onRetry: () => undefined,
    }),
  );
}

function withHealth(
  report: ProductionHealthReport,
  status: ProductionHealthReport["health"]["status"],
  severity: ProductionHealthReport["health"]["overallSeverity"],
) {
  const next = structuredClone(report);
  next.health.status = status;
  next.health.overallSeverity = severity;
  return next;
}

function criticalReport(report: ProductionHealthReport) {
  return withHealth(report, "critical", "critical");
}

void main();
