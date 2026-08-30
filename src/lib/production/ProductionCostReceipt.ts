import { FileStorage } from "@/lib/storage/FileStorage";
import {
  resolveAiCostBudgetUsd,
  summarizeObservedCost,
} from "@/lib/ai/AiCostBudget";
import type { AIUsageLog } from "@/types/aiUsage";
import type { RuntimeStorageInput } from "@/lib/runtime/RuntimeStoragePaths";

/**
 * Documentary media effort — Faz 5.6: the deterministic, auditable post-run cost
 * receipt persisted alongside a project's acceptance record.
 *
 * It folds `ai-usage.json` into a `{ budgetUsd, observedUsd, byCategory,
 * byProvider, byModel, unknownCostCount, retryUsd, duplicateUsd }` receipt and a
 * pass/exceeded status. `withinBudget` is false when the known spend exceeds the
 * budget OR any billable call has `pricingStatus: "unknown"` — the same
 * fail-closed rule the runtime guard uses.
 */

const RECEIPT_FILE = "production-cost-receipt.json";

export interface ProductionCostReceipt {
  readonly schemaVersion: "production-cost-receipt-v1";
  readonly projectSlug: string;
  readonly currency: "USD";
  readonly budgetUsd: number;
  readonly observedUsd: number;
  readonly withinBudget: boolean;
  readonly status: "within-budget" | "budget-exceeded" | "unknown-pricing";
  readonly unknownCostCount: number;
  readonly billableCallCount: number;
  readonly freeCallCount: number;
  readonly retryUsd: number;
  readonly duplicateUsd: number;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly byOperation: Readonly<Record<string, number>>;
  readonly generatedAt: string;
}

export function buildProductionCostReceipt(input: {
  readonly projectSlug: string;
  readonly usage: AIUsageLog;
  readonly budgetUsd?: number;
  readonly now?: () => string;
  readonly env?: NodeJS.ProcessEnv;
}): ProductionCostReceipt {
  const budgetUsd = input.budgetUsd ?? resolveAiCostBudgetUsd(input.env);
  const summary = summarizeObservedCost(input.usage.records ?? []);
  const generatedAt = (input.now ?? (() => new Date().toISOString()))();

  const hasUnknown = summary.unknownPricingRecordCount > 0;
  const overBudget = summary.knownUsd > budgetUsd;
  const status: ProductionCostReceipt["status"] = hasUnknown
    ? "unknown-pricing"
    : overBudget
      ? "budget-exceeded"
      : "within-budget";

  return {
    schemaVersion: "production-cost-receipt-v1",
    projectSlug: input.projectSlug,
    currency: "USD",
    budgetUsd,
    observedUsd: summary.knownUsd,
    withinBudget: status === "within-budget",
    status,
    unknownCostCount: summary.unknownPricingRecordCount,
    billableCallCount: summary.knownRecordCount,
    freeCallCount: summary.freeRecordCount,
    retryUsd: summary.retryUsd,
    duplicateUsd: summary.duplicateUsd,
    byCategory: summary.byStage,
    byOperation: summary.byOperation,
    generatedAt,
  };
}

/** Persist the receipt to `data/projects/<slug>/production-cost-receipt.json`. */
export function persistProductionCostReceipt(
  receipt: ProductionCostReceipt,
  input: RuntimeStorageInput = {},
): void {
  FileStorage.saveJson(
    `data/projects/${receipt.projectSlug}/${RECEIPT_FILE}`,
    receipt,
    input,
  );
}

export class ProductionCostBudgetExceededAtAcceptanceError extends Error {
  readonly code = "PRODUCTION_AI_COST_BUDGET_EXCEEDED";
  readonly receipt: ProductionCostReceipt;

  constructor(receipt: ProductionCostReceipt) {
    super(`Production AI cost ${receipt.observedUsd} USD exceeds the ${receipt.budgetUsd} USD budget.`);
    this.name = "ProductionCostBudgetExceededAtAcceptanceError";
    this.receipt = receipt;
    this.stack = undefined;
  }
}
