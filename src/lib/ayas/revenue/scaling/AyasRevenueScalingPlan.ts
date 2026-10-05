/** Owner-review artifacts only. No reservation, approval, spend or external executor. */
import type { AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";
import type { AyasRevenueScenarioMoney } from "../AyasRevenueOpportunity";

export const AYAS_SCALING_DIMENSIONS = Object.freeze(["VOLUME", "LISTINGS", "PROPOSALS", "PRODUCTION_FREQUENCY", "LANGUAGE_SCOPE", "PRICE_EXPERIMENT", "PAID_ACQUISITION", "PLATFORM_EXPANSION"] as const);
export type AyasScalingDimension = typeof AYAS_SCALING_DIMENSIONS[number];
export const AYAS_SCALING_ROLLBACK_CODES = Object.freeze(["NEGATIVE_CONTRIBUTION", "REFUND_DETERIORATION", "SECURITY_FINDING", "DELIVERY_BREACH", "SUPPORT_CAPACITY", "PLATFORM_RESTRICTION", "RIGHTS_ISSUE", "UNEXPECTED_COST", "METRIC_DETERIORATION"] as const);
export interface AyasRevenueScalingRequest {
  readonly schemaVersion: "1"; readonly planId: string; readonly platform: AyasRevenuePlatform; readonly accountDigest: string; readonly offerDigest: string;
  readonly currency: string; readonly scalingDimension: AyasScalingDimension; readonly currentLevel: number; readonly proposedLevel: number;
  readonly intent: "BOUNDED_REPETITION" | "MATERIAL_SCALE" | "BROADER_CHANNEL";
  readonly requiredBudget: AyasRevenueScenarioMoney | null; readonly maxDownside: AyasRevenueScenarioMoney | null;
  readonly priceExperiment: { readonly currentMinor: number; readonly proposedMinor: number; readonly currency: string } | null;
  readonly rollback: { readonly codes: readonly typeof AYAS_SCALING_ROLLBACK_CODES[number][]; readonly maxRefundRevenueBps: number; readonly maxSupportBacklog: number; readonly metricFloorBps: number };
}
export interface AyasRevenueScalingPlan extends AyasRevenueScalingRequest {
  readonly sourcePilotIds: readonly string[]; readonly sourcePlanDigests: readonly string[];
  readonly evidenceLevel: "SINGLE_PILOT" | "REPEATED_RESULT" | "MULTI_WINDOW_STABLE";
  readonly realizedProfitEvidence: { readonly currency: string; readonly valueMinor: number; readonly windowFrom: string; readonly windowTo: string };
  readonly ledgerDigest: string; readonly ledgerRevision: number; readonly sourceEvidenceDigest: string; readonly reinvestmentProposalDigest: string | null;
  readonly baselineRefundRevenueBps: number; readonly baselineMetricDigest: string; readonly expiresAt: string; readonly planDigest: string;
  readonly baselineMetrics: readonly { readonly planDigest: string; readonly from: string; readonly to: string; readonly numerator: number; readonly denominator: number | null; readonly conversionBps: number | null }[];
  readonly metricFloorMeaning: "FRACTION_OF_EACH_SOURCE_WINDOW_BASELINE";
  readonly afterChangeMeasurement: "SEPARATE_WINDOW_REQUIRED"; readonly rollbackAction: "OWNER_CONTROLLED_ONLY";
  readonly ownerApprovalRequired: true; readonly executionAuthority: "NONE"; readonly grantsSpendAuthority: false; readonly autonomousSpend: 0;
  readonly qualification: "NORMALIZED_SOURCE_NOT_LIVE_CERTIFICATION";
}
export type AyasRevenueScalingStatus = "NOT_ELIGIBLE" | "MORE_EVIDENCE_REQUIRED" | "CAPACITY_BLOCKED" | "SECURITY_BLOCKED" | "ECONOMICS_BLOCKED" | "OWNER_REVIEW_ELIGIBLE";
export interface AyasRevenueScalingDecision {
  readonly status: AyasRevenueScalingStatus; readonly reasonCode: string; readonly plan: AyasRevenueScalingPlan | null;
  readonly recommendation: "NEW_PLATFORM_VALIDATION_PILOT" | "OWNER_REVIEW";
  readonly ownerApprovalRequired: true; readonly executionAuthority: "NONE"; readonly grantsSpendAuthority: false; readonly autonomousSpend: 0;
}
