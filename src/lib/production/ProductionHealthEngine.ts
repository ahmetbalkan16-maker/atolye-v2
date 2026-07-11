import { pipelineRecoveryStageOrder } from "@/lib/pipeline/PipelineRecoveryPlanner";
import { productionHealthCoreRules } from "./health/ProductionHealthCoreRules";
import { productionHealthMetricRules } from "./health/ProductionHealthMetricRules";
import { snapshotFindingToHealth } from "./health/ProductionHealthRules";
import {
  productionHealthSchemaVersion,
  type ProductionHealthCounts,
  type ProductionHealthFinding,
  type ProductionHealthOverallSeverity,
  type ProductionHealthResult,
  type ProductionHealthRule,
  type ProductionHealthSourceConfidence,
  type ProductionHealthStatus,
} from "@/types/productionHealth";
import type {
  ProductionSnapshot,
  ProductionSnapshotFindingEvidenceValue,
  ProductionSnapshotSourceState,
} from "@/types/productionSnapshot";
import type { ProductionStepKey } from "@/types/project";

export const productionHealthRules: readonly ProductionHealthRule[] = [
  ...productionHealthCoreRules,
  ...productionHealthMetricRules,
];

export class ProductionHealthEngine {
  static evaluate(
    snapshot: ProductionSnapshot,
    evaluatedAt: string,
    rules: readonly ProductionHealthRule[] = productionHealthRules,
  ): ProductionHealthResult {
    const ruleFindings = [...rules]
      .sort((left, right) => compareText(left.id, right.id))
      .flatMap((rule) => rule.evaluate(snapshot, { evaluatedAt }));
    const findings = sortFindings(
      dedupeFindings([
        ...snapshot.findings.map(snapshotFindingToHealth),
        ...ruleFindings,
      ]),
    );
    const counts = countFindings(findings);
    const sourceConfidence = calculateSourceConfidence(snapshot);
    const overallSeverity = getOverallSeverity(counts);
    const status = getStatus(counts, sourceConfidence);
    const affectedStages = pipelineRecoveryStageOrder.filter((stage) =>
      findings.some((finding) => finding.stage === stage),
    );

    return {
      schemaVersion: productionHealthSchemaVersion,
      evaluatedAt,
      overallSeverity,
      status,
      findings,
      counts,
      affectedStages,
      sourceConfidence,
      summary: {
        headline: headlineForStatus(status),
        criticalIssueCount: counts.critical,
        warningIssueCount: counts.warning,
        healthyStageCount: snapshot.stages.filter(
          (stage) =>
            stage.effectiveStatus === "completed" &&
            !affectedStages.includes(stage.stage),
        ).length,
        affectedStageCount: affectedStages.length,
        hasBlockingIssue: counts.critical > 0,
      },
    };
  }
}

function calculateSourceConfidence(
  snapshot: ProductionSnapshot,
): ProductionHealthSourceConfidence {
  const stageOutputStates = Object.values(snapshot.sourceState.stageOutputs);
  const stageOutputs = aggregateStageOutputs(stageOutputStates);
  const states = [
    snapshot.sourceState.project,
    snapshot.sourceState.manifest,
    snapshot.sourceState.jobs,
    snapshot.sourceState.history,
    snapshot.sourceState.aiUsage,
    stageOutputs,
  ];
  const count = (status: ProductionSnapshotSourceState["status"]) =>
    states.filter((state) => state.status === status).length;
  const requiredUnreliable = [
    snapshot.sourceState.project,
    snapshot.sourceState.manifest,
  ].some(
    (state) =>
      state.status === "malformed" || state.status === "unreadable",
  );
  const requiredMissing =
    snapshot.sourceState.project.status === "missing" &&
    snapshot.sourceState.manifest.status === "missing";
  const nonAvailable = states.some((state) => state.status !== "available");

  return {
    level:
      requiredUnreliable || requiredMissing
        ? "unreliable"
        : nonAvailable
          ? "partial"
          : "complete",
    availableSourceCount: count("available"),
    missingSourceCount: count("missing"),
    malformedSourceCount: count("malformed"),
    unreadableSourceCount: count("unreadable"),
    partialSourceCount: count("partial") + count("stale"),
  };
}

function aggregateStageOutputs(
  states: ProductionSnapshotSourceState[],
): ProductionSnapshotSourceState {
  if (states.length === 0) return { status: "missing" };
  if (states.every((state) => state.status === "available")) {
    return { status: "available" };
  }
  if (states.every((state) => state.status === "missing")) {
    return { status: "missing" };
  }
  if (states.some((state) => state.status === "unreadable")) {
    return { status: "partial" };
  }
  if (states.some((state) => state.status === "malformed")) {
    return { status: "partial" };
  }
  return { status: "partial" };
}

function dedupeFindings(findings: ProductionHealthFinding[]) {
  const unique = new Map<string, ProductionHealthFinding>();
  for (const finding of findings) {
    const identity = findingIdentity(finding);
    const existing = unique.get(identity);
    if (!existing || severityRank(finding.severity) < severityRank(existing.severity)) {
      unique.set(identity, finding);
    }
  }
  return [...unique.values()];
}

function findingIdentity(finding: ProductionHealthFinding) {
  return [
    finding.code,
    finding.scope,
    finding.stage ?? "",
    [...finding.sources].sort(compareText).join(","),
    stableEvidence(finding.evidence),
  ].join("|");
}

function stableEvidence(
  evidence: Record<string, ProductionSnapshotFindingEvidenceValue>,
) {
  return Object.keys(evidence)
    .sort(compareText)
    .map((key) => `${key}:${JSON.stringify(evidence[key])}`)
    .join(",");
}

function sortFindings(findings: ProductionHealthFinding[]) {
  return [...findings].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      categoryRank(left.category) - categoryRank(right.category) ||
      stageRank(left.stage) - stageRank(right.stage) ||
      compareText(left.code, right.code) ||
      compareText(findingIdentity(left), findingIdentity(right)),
  );
}

function countFindings(findings: ProductionHealthFinding[]): ProductionHealthCounts {
  return {
    total: findings.length,
    info: findings.filter((finding) => finding.severity === "info").length,
    warning: findings.filter((finding) => finding.severity === "warning").length,
    critical: findings.filter((finding) => finding.severity === "critical").length,
  };
}

function getOverallSeverity(
  counts: ProductionHealthCounts,
): ProductionHealthOverallSeverity {
  if (counts.critical > 0) return "critical";
  if (counts.warning > 0) return "warning";
  if (counts.info > 0) return "info";
  return "none";
}

function getStatus(
  counts: ProductionHealthCounts,
  confidence: ProductionHealthSourceConfidence,
): ProductionHealthStatus {
  if (counts.critical > 0) return "critical";
  if (counts.warning > 0) return "warning";
  if (confidence.level === "unreliable") return "unknown";
  return "healthy";
}

function headlineForStatus(status: ProductionHealthStatus) {
  if (status === "critical") return "Critical production issues detected.";
  if (status === "warning") return "Production warnings detected.";
  if (status === "unknown") return "Production health could not be determined.";
  return "Production health is healthy.";
}

function severityRank(severity: ProductionHealthFinding["severity"]) {
  return severity === "critical" ? 0 : severity === "warning" ? 1 : 2;
}

function categoryRank(category: ProductionHealthFinding["category"]) {
  const order = {
    source: 0,
    completion: 1,
    stage: 2,
    queue: 3,
    history: 4,
    usage: 5,
    consistency: 6,
  } as const;
  return order[category];
}

function stageRank(stage?: ProductionStepKey) {
  return stage ? pipelineRecoveryStageOrder.indexOf(stage) : -1;
}

function compareText(left: string, right: string) {
  return left === right ? 0 : left < right ? -1 : 1;
}
