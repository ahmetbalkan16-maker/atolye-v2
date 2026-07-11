import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProductionHealthFindingEvidence from "../src/components/studio/ProductionHealthFindingEvidence";
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

const slug = "sprint-95-9-evidence";
const evaluatedAt = "2026-07-11T21:00:00.000Z";

async function main() {
  const baseReport = await ProductionHealthService.getProductionHealth({
    projectSlug: slug,
    evaluatedAt,
  });

  const withEvidence = finding({ runningCount: 2, blocked: true });
  const success = renderEvidence(withEvidence, "complete", "critical");
  assert.ok(success.includes("runningCount"));
  assert.ok(success.includes(">2<"));
  assert.ok(success.includes("blocked"));

  const empty = renderEvidence(finding({}), "complete", "healthy");
  assert.ok(empty.includes("No structured evidence was provided"));

  const unknown = renderEvidence(finding({ sample: 1 }), "unreliable", "unknown");
  assert.ok(unknown.includes("Evidence may be incomplete"));

  const malformedState = await loadProductionHealthUiState(slug, async () => {
    throw new ProductionHealthApiConsumerError("malformed_response");
  });
  const malformed = renderPanel(malformedState);
  assert.ok(malformed.includes("Production health response was invalid."));
  assert.ok(!malformed.includes("Finding evidence"));

  assert.equal(
    renderEvidence(withEvidence, "partial", "warning"),
    renderEvidence(withEvidence, "partial", "warning"),
  );

  const longValue = `${"Long evidence value ".repeat(30)}\nSecond line.`;
  const longEvidence = renderEvidence(
    finding({ detail: longValue }),
    "partial",
    "warning",
  );
  assert.ok(longEvidence.includes("whitespace-pre-wrap"));
  assert.ok(longEvidence.includes("Second line."));

  const missingSourceFinding = finding({ reason: "missing source" });
  missingSourceFinding.sources = [];
  const missingSource = renderEvidence(
    missingSourceFinding,
    "partial",
    "warning",
  );
  assert.ok(missingSource.includes("Source unavailable"));

  let attempts = 0;
  const initialFinding = finding({ attempt: 1 });
  const retryFinding = finding({ attempt: 2 });
  await loadProductionHealthUiState(slug, async () => {
    attempts += 1;
    return reportWithFindings(baseReport, [initialFinding]);
  });
  const retryState = await loadProductionHealthUiState(slug, async () => {
    attempts += 1;
    return reportWithFindings(baseReport, [retryFinding]);
  });
  const retryRender = renderPanel(retryState);
  assert.equal(attempts, 2);
  assert.ok(retryRender.includes("attempt"));
  assert.ok(retryRender.includes(">2<"));

  const multiple = renderFindings(
    [finding({ first: 1 }), finding({ second: 2 })],
    "complete",
    "warning",
  );
  assert.ok(multiple.indexOf("first") < multiple.indexOf("second"));
  assert.ok(multiple.includes("Total: 2"));

  const confidence = renderEvidence(finding({}), "unreliable", "unknown");
  assert.ok(confidence.includes("Confidence"));
  assert.ok(confidence.includes("unreliable"));

  console.log(
    "Sprint 95.9 production health evidence smoke: PASS (10 scenarios)",
  );
}

function finding(
  evidence: ProductionHealthFinding["evidence"],
): ProductionHealthFinding {
  return {
    severity: "warning",
    code: "queue_prerequisite_blocked",
    category: "queue",
    scope: "queue",
    stage: "script",
    sources: ["jobs"],
    message: "Queue is blocked.",
    evidence,
    detectedAt: evaluatedAt,
  };
}

function renderEvidence(
  findingValue: ProductionHealthFinding,
  confidence: ProductionHealthReport["health"]["sourceConfidence"]["level"],
  status: ProductionHealthReport["health"]["status"],
) {
  return renderToStaticMarkup(
    createElement(ProductionHealthFindingEvidence, {
      finding: findingValue,
      confidence,
      status,
    }),
  );
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
  next.health.counts.total = findings.length;
  return next;
}

void main();
