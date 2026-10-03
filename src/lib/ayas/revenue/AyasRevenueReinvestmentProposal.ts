/** Stage16.9 owner-review material. An eligible proposal is neither a reservation nor spending authority. */
import type { AyasCostClass } from "../policy/AyasZeroCostPolicy";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import type { AyasRevenueScenarioMoney } from "./AyasRevenueOpportunity";
import type { AyasRevenueValidationInput } from "./AyasRevenueValidation";

export const AYAS_REINVESTMENT_PURPOSES = Object.freeze(["PRODUCT_QUALITY", "DELIVERY_CAPABILITY", "PLATFORM_FEE", "MARKETING_EXPERIMENT", "SOFTWARE_TOOL", "INFRASTRUCTURE", "OTHER"] as const);
export type AyasReinvestmentPurpose = typeof AYAS_REINVESTMENT_PURPOSES[number];
export interface AyasRevenueReinvestmentInput {
  readonly schemaVersion: "1"; readonly candidateId: string; readonly platform: AyasRevenuePlatform; readonly purpose: AyasReinvestmentPurpose;
  readonly amount: AyasRevenueScenarioMoney; readonly evidenceWindow: { readonly from: string; readonly to: string }; readonly ledger: unknown;
  readonly reconciliation: {
    readonly ledgerDigest: string; readonly ledgerRevision: number; readonly currency: string; readonly from: string; readonly to: string;
    readonly observedAt: string; readonly freshUntil: string; readonly evidenceDigest: string; readonly historyCoverage: "COMPLETE" | "UNKNOWN";
    readonly fees: "COMPLETE" | "UNKNOWN"; readonly refunds: "BOUNDED" | "UNKNOWN"; readonly disputes: "BOUNDED" | "UNKNOWN";
    readonly tax: "CLEAR_OR_RESERVED" | "UNKNOWN"; readonly settlement: "SETTLED" | "UNKNOWN"; readonly debtMinor: number | null;
    readonly reserve: { readonly refundsMinor: number | null; readonly feesMinor: number | null; readonly disputesMinor: number | null; readonly taxMinor: number | null; readonly payoutMinor: number | null };
  };
  readonly freeFirstInput: AyasRevenueValidationInput;
  readonly freeAlternative: { readonly state: "NO_EQUIVALENT_FREE" | "EQUIVALENT_FREE_AVAILABLE" | "UNKNOWN"; readonly evidenceDigest: string | null; readonly observedAt: string };
  readonly risks: { readonly security: "LOW" | "HIGH" | "UNKNOWN"; readonly licensing: "LOW" | "HIGH" | "UNKNOWN"; readonly privacy: "LOW" | "HIGH" | "UNKNOWN"; readonly evidenceDigest: string | null };
  readonly effect: { readonly reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN"; readonly oneShot: boolean; readonly recurring: boolean;
    readonly creditOrDebt: boolean; readonly lossChasing: boolean; readonly automaticScale: boolean; readonly expiresAt: string; readonly successMetricCode: string;
    readonly maxDownside: AyasRevenueScenarioMoney; readonly costClass: AyasCostClass };
}
export interface AyasRevenueReinvestmentCandidate {
  readonly schemaVersion: "1"; readonly candidateId: string; readonly platform: AyasRevenuePlatform; readonly purpose: AyasReinvestmentPurpose;
  readonly amount: AyasRevenueScenarioMoney; readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly realizedProfit: AyasRevenueScenarioMoney; readonly reservedAmount: AyasRevenueScenarioMoney; readonly maxEligibleAmount: AyasRevenueScenarioMoney;
  readonly expectedBenefitCode: string; readonly reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE"; readonly costClass: AyasCostClass;
  readonly expiresAt: string; readonly maxDownside: AyasRevenueScenarioMoney; readonly policyDigest: string; readonly ledgerDigest: string;
  readonly ledgerRevision: number; readonly reconciliationDigest: string; readonly freeFirstDigest: string; readonly riskDigest: string; readonly requestDigest: string; readonly proposalDigest: string;
  readonly ownerApprovalRequired: true; readonly executionAuthority: "NONE"; readonly grantsSpendAuthority: false; readonly autonomousBudgetUsd: 0;
  readonly automaticRenewal: false; readonly automaticScaling: false; readonly reservation: "NONE"; readonly evidenceVerification: "NORMALIZED_INPUT_NOT_LIVE_CERTIFICATION";
}
export interface AyasRevenueReinvestmentDecision {
  readonly status: "BLOCKED" | "DISABLED" | "OWNER_REVIEW_ELIGIBLE"; readonly reasonCode: string;
  readonly availableProfitMinor: number; readonly maxEligibleMinor: number; readonly candidate: AyasRevenueReinvestmentCandidate | null;
  readonly ownerApprovalRequired: true; readonly executionAuthority: "NONE"; readonly grantsSpendAuthority: false; readonly autonomousBudgetUsd: 0;
}
