import type {
  ProductionHealthFinding,
  ProductionHealthFindingInput,
  ProductionHealthRule,
  ProductionHealthRuleCategory,
} from "@/types/productionHealth";
import type { ProductionSnapshotConsistencyFinding } from "@/types/productionSnapshot";

export const productionHealthThresholds = {
  minimumRateSampleSize: 3,
  lowHistorySuccessRate: 0.5,
  highUsageFailureRate: 0.5,
  highUsageFallbackRate: 0.5,
} as const;

export function createHealthFinding(
  input: ProductionHealthFindingInput,
): ProductionHealthFinding {
  return {
    code: input.code,
    severity: input.severity,
    category: input.category,
    scope: input.scope,
    ...(input.stage ? { stage: input.stage } : {}),
    sources: [...input.sources],
    message: input.message,
    evidence: { ...(input.evidence ?? {}) },
    detectedAt: input.detectedAt,
  };
}

export function snapshotFindingToHealth(
  finding: ProductionSnapshotConsistencyFinding,
): ProductionHealthFinding {
  return {
    ...finding,
    sources: [...finding.sources],
    evidence: { ...finding.evidence },
    category: categoryFromScope(finding.scope),
  };
}

export function createRule(
  id: string,
  category: ProductionHealthRuleCategory,
  description: string,
  evaluate: ProductionHealthRule["evaluate"],
): ProductionHealthRule {
  return { id, category, description, evaluate };
}

function categoryFromScope(
  scope: ProductionSnapshotConsistencyFinding["scope"],
): ProductionHealthRuleCategory {
  if (scope === "project" || scope === "pipeline") return "completion";
  if (scope === "source") return "source";
  if (scope === "stage") return "stage";
  if (scope === "queue") return "queue";
  if (scope === "history") return "history";
  return "usage";
}
