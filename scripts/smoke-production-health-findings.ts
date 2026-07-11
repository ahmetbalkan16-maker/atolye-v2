import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductionHealthFindingsPanel from "../src/components/studio/ProductionHealthFindingsPanel";
import {
  ProductionHealthPanelView,
  loadProductionHealthUiState,
  type ProductionHealthUiState,
} from "../src/components/studio/ProductionHealthPanel";
import { ProductionHealthApiConsumerError } from "../src/lib/production/ProductionHealthApiClient";
import { ProductionHealthService } from "../src/lib/production/ProductionHealthService";
import type { ProductionHealthReport } from "../src/lib/production/ProductionHealthService";
import type { ProductionHealthFinding } from "../src/types/productionHealth";

const slug = "sprint-95-8-findings";
const evaluatedAt = "2026-07-11T20:00:00.000Z";

async function main() {
  const baseReport = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });

  const empty = renderFindings([], "complete", "healthy");
  assert.ok(empty.includes("Total: 0"));
  assert.ok(empty.includes("No production health findings were reported."));

  const infoFinding = finding("info", "usage_data_partial", "usage");
  const success = renderFindings([infoFinding], "complete", "healthy");
  assert.ok(success.includes("Total: 1"));
  assert.ok(success.includes("usage_data_partial"));
  assert.ok(success.includes("Description for usage_data_partial"));

  const warningFinding = finding("warning", "failed_stage", "stage");
  const warning = renderFindings([warningFinding], "partial", "warning");
  assert.ok(warning.includes("text-yellow-400"));
  assert.ok(warning.includes("warning"));

  const criticalFinding = finding(
    "critical",
    "completed_stage_missing_output",
    "stage",
  );
  const critical = renderFindings([criticalFinding], "unreliable", "critical");
  assert.ok(critical.includes("text-red-400"));
  assert.ok(critical.includes("critical"));

  const unknown = renderFindings(
    [warningFinding],
    "unreliable",
    "unknown",
  );
  assert.ok(unknown.includes("currently unknown"));
  assert.ok(unknown.includes("unreliable"));

  const orderedFindings = [
    finding("critical", "completed_stage_missing_output", "stage", "youtube"),
    finding("warning", "failed_stage", "stage", "script"),
    finding("info", "usage_data_partial", "usage"),
  ];
  const ordered = renderFindings(orderedFindings, "partial", "critical");
  assert.ok(
    ordered.indexOf("completed_stage_missing_output") <
      ordered.indexOf("failed_stage"),
  );
  assert.ok(ordered.indexOf("failed_stage") < ordered.indexOf("usage_data_partial"));

  const affected = renderFindings(
    [finding("warning", "failed_stage", "stage", "assembly")],
    "partial",
    "warning",
  );
  assert.ok(affected.includes("Affected stages"));
  assert.ok(affected.includes("assembly"));

  const longMessage = `${"Very long production health explanation ".repeat(20)}\nSecond line.`;
  const longFinding = finding("warning", "source_partial", "source");
  longFinding.message = longMessage;
  const longDescription = renderFindings(
    [longFinding],
    "partial",
    "warning",
  );
  assert.ok(longDescription.includes("whitespace-pre-wrap"));
  assert.ok(longDescription.includes("Second line."));

  let attempts = 0;
  const retryReport = reportWithFindings(baseReport, [criticalFinding]);
  const retryState = await loadProductionHealthUiState(slug, async () => {
    attempts += 1;
    return attempts === 1
      ? reportWithFindings(baseReport, [warningFinding])
      : retryReport;
  });
  assert.equal(retryState.kind, "success");
  const afterRetryState = await loadProductionHealthUiState(slug, async () => {
    attempts += 1;
    return retryReport;
  });
  const afterRetry = renderPanel(afterRetryState);
  assert.equal(attempts, 2);
  assert.ok(afterRetry.includes("completed_stage_missing_output"));

  const malformedState = await loadProductionHealthUiState(slug, async () => {
    throw new ProductionHealthApiConsumerError("malformed_response");
  });
  const malformed = renderPanel(malformedState);
  assert.ok(malformed.includes("Production health response was invalid."));
  assert.ok(!malformed.includes("Health findings"));

  assert.equal(
    renderFindings(orderedFindings, "partial", "critical"),
    renderFindings(orderedFindings, "partial", "critical"),
  );

  console.log(
    "Sprint 95.8 production health findings smoke: PASS (10 scenarios)",
  );
}

function finding(
  severity: ProductionHealthFinding["severity"],
  code: ProductionHealthFinding["code"],
  category: ProductionHealthFinding["category"],
  stage?: ProductionHealthFinding["stage"],
): ProductionHealthFinding {
  return {
    severity,
    code,
    category,
    scope: stage ? "stage" : category === "source" ? "source" : "usage",
    ...(stage ? { stage } : {}),
    sources: category === "source" ? ["manifest"] : ["aiUsage"],
    message: `Description for ${code}`,
    evidence: {},
    detectedAt: evaluatedAt,
  };
}

function renderFindings(
  findings: ProductionHealthFinding[],
  sourceConfidence: ProductionHealthReport["health"]["sourceConfidence"]["level"],
  status: ProductionHealthReport["health"]["status"],
) {
  return renderToStaticMarkup(
    createElement(ProductionHealthFindingsPanel, {
      findings,
      sourceConfidence,
      status,
    }),
  );
}

function renderPanel(state: ProductionHealthUiState) {
  return renderToStaticMarkup(
    createElement(ProductionHealthPanelView, {
      state,
      onRetry: () => undefined,
    }),
  );
}

function reportWithFindings(
  report: ProductionHealthReport,
  findings: ProductionHealthFinding[],
) {
  const next = structuredClone(report);
  next.health.findings = findings;
  next.health.counts = {
    total: findings.length,
    info: findings.filter((item) => item.severity === "info").length,
    warning: findings.filter((item) => item.severity === "warning").length,
    critical: findings.filter((item) => item.severity === "critical").length,
  };
  return next;
}

void main();
