import type {
  ProductionSnapshot,
  ProductionSnapshotConsistencyFinding,
  ProductionSnapshotFindingCode,
  ProductionSnapshotFindingEvidenceValue,
  ProductionSnapshotFindingScope,
  ProductionSnapshotFindingSeverity,
  ProductionSnapshotSourceName,
} from "./productionSnapshot";
import type { ProductionStepKey } from "./project";

export const productionHealthSchemaVersion = 1 as const;

export type ProductionHealthStatus =
  | "healthy"
  | "warning"
  | "critical"
  | "unknown";

export type ProductionHealthOverallSeverity =
  | "none"
  | ProductionSnapshotFindingSeverity;

export type ProductionHealthRuleCategory =
  | "source"
  | "completion"
  | "stage"
  | "queue"
  | "history"
  | "usage"
  | "consistency";

export type ProductionHealthFindingCode =
  | ProductionSnapshotFindingCode
  | "source_partial"
  | "all_stages_completed_project_not_completed"
  | "project_completed_incomplete_stage"
  | "terminal_pipeline_with_active_work"
  | "cancelled_stage"
  | "failed_stage"
  | "dependency_not_ready_active_stage"
  | "queue_prerequisite_blocked"
  | "queue_summary_mismatch"
  | "next_candidate_blocked_conflict"
  | "history_failed_events"
  | "history_cancelled_events"
  | "history_low_success_rate"
  | "usage_high_failure_rate"
  | "usage_high_fallback_rate"
  | "usage_all_requests_failed"
  | "usage_token_coverage_partial"
  | "usage_cost_coverage_partial"
  | "completed_ai_stages_without_usage";

export interface ProductionHealthFinding
  extends Omit<ProductionSnapshotConsistencyFinding, "code"> {
  code: ProductionHealthFindingCode;
  category: ProductionHealthRuleCategory;
}

export interface ProductionHealthCounts {
  total: number;
  info: number;
  warning: number;
  critical: number;
}

export type ProductionHealthSourceConfidenceLevel =
  | "complete"
  | "partial"
  | "unreliable";

export interface ProductionHealthSourceConfidence {
  level: ProductionHealthSourceConfidenceLevel;
  availableSourceCount: number;
  missingSourceCount: number;
  malformedSourceCount: number;
  unreadableSourceCount: number;
  partialSourceCount: number;
}

export interface ProductionHealthSummary {
  headline: string;
  criticalIssueCount: number;
  warningIssueCount: number;
  healthyStageCount: number;
  affectedStageCount: number;
  hasBlockingIssue: boolean;
}

export interface ProductionHealthResult {
  schemaVersion: typeof productionHealthSchemaVersion;
  evaluatedAt: string;
  overallSeverity: ProductionHealthOverallSeverity;
  status: ProductionHealthStatus;
  findings: ProductionHealthFinding[];
  counts: ProductionHealthCounts;
  affectedStages: ProductionStepKey[];
  sourceConfidence: ProductionHealthSourceConfidence;
  summary: ProductionHealthSummary;
}

export interface ProductionHealthRuleContext {
  evaluatedAt: string;
}

export interface ProductionHealthRule {
  id: string;
  category: ProductionHealthRuleCategory;
  description: string;
  evaluate(
    snapshot: ProductionSnapshot,
    context: ProductionHealthRuleContext,
  ): ProductionHealthFinding[];
}

export type ProductionHealthEvidence = Record<
  string,
  ProductionSnapshotFindingEvidenceValue
>;

export type ProductionHealthFindingInput = {
  code: ProductionHealthFindingCode;
  severity: ProductionSnapshotFindingSeverity;
  category: ProductionHealthRuleCategory;
  scope: ProductionSnapshotFindingScope;
  sources: ProductionSnapshotSourceName[];
  message: string;
  detectedAt: string;
  stage?: ProductionStepKey;
  evidence?: ProductionHealthEvidence;
};
