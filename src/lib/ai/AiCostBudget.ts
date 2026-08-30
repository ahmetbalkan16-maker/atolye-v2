import type { AIUsageRecord } from "@/types/aiUsage";
import { estimateTokenCost } from "./AiPricing";
import { isRealProductionEnvironment } from "@/lib/runtime/ProductionModeDetection";

/**
 * Documentary media effort — Faz 5: the hard per-video AI spend budget.
 *
 * A single documentary's total paid-AI cost (LLM + image + TTS + any other
 * provider) must not exceed `$1.00`. This module is the deterministic decision
 * layer:
 *  - `summarizeObservedCost` folds an `ai-usage.json` record list into a
 *    known-USD total + per-stage / per-operation breakdown + retry/duplicate
 *    accounting.
 *  - `evaluateAiCostBudget` decides whether the next call may be dispatched:
 *    it fails **closed** when the observed spend already meets the budget, when
 *    the projected spend (observed + a conservative ceiling for the pending
 *    call) would exceed it, or when any priced call has `pricingStatus:
 *    "unknown"` (we cannot prove we are under budget).
 *
 * `mock` / other free-provider records contribute `0` and never trip the guard,
 * so nothing in the existing mock-only test suites changes.
 */

export const DEFAULT_AI_COST_BUDGET_USD = 1.0;

/**
 * The runtime cost guard (pre-dispatch fail-closed block). Default policy:
 *  - **on** for a real production render — a real OpenAI key is present AND
 *    `NODE_ENV !== "test"`.
 *  - **off** otherwise — every unit / e2e suite runs with `NODE_ENV=test`
 *    (and usually no key), so a stubbed paid provider is never blocked and the
 *    deterministic pricing / `estimatedCost` recording still run.
 *
 * An explicit `ATOLYE_AI_COST_GUARD` (`on`/`off` etc.) always wins. This mirrors
 * `RealMediaProductionFlags.isCostBudgetGuardEnabled`; both are kept in sync.
 */
export function isAiCostGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.ATOLYE_AI_COST_GUARD?.trim().toLowerCase();
  if (flag === "on" || flag === "true" || flag === "1") return true;
  if (flag === "off" || flag === "false" || flag === "0") return false;
  return isRealProductionEnvironment(env);
}

/** Override the budget via `ATOLYE_AI_COST_BUDGET_USD` (0 < x <= 1000). */
export function resolveAiCostBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ATOLYE_AI_COST_BUDGET_USD?.trim();
  if (!raw) return DEFAULT_AI_COST_BUDGET_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) {
    return DEFAULT_AI_COST_BUDGET_USD;
  }
  return Math.round(parsed * 1e6) / 1e6;
}

export interface ObservedCostSummary {
  /** Sum of every record whose `pricingStatus` is "known" (USD). */
  readonly knownUsd: number;
  /** Records that were billable and priced ("known"). */
  readonly knownRecordCount: number;
  /** Records with `pricingStatus: "unknown"` — the fail-closed trigger. */
  readonly unknownPricingRecordCount: number;
  /** Records explicitly free (mock / non-billable). */
  readonly freeRecordCount: number;
  /** Known USD grouped by pipeline stage. */
  readonly byStage: Readonly<Record<string, number>>;
  /** Known USD grouped by operation. */
  readonly byOperation: Readonly<Record<string, number>>;
  /** Known USD attributable to retried calls (`retryCount > 0`). */
  readonly retryUsd: number;
  /** Known USD spent on the 2nd+ billable call of an identical stage+operation. */
  readonly duplicateUsd: number;
}

export function summarizeObservedCost(
  records: readonly AIUsageRecord[],
): ObservedCostSummary {
  let knownUsd = 0;
  let knownRecordCount = 0;
  let unknownPricingRecordCount = 0;
  let freeRecordCount = 0;
  let retryUsd = 0;
  let duplicateUsd = 0;
  const byStage: Record<string, number> = {};
  const byOperation: Record<string, number> = {};
  const seenOperationKeys = new Set<string>();

  for (const record of records) {
    const resolved = resolveRecordCost(record);
    if (resolved.status === "free") {
      freeRecordCount += 1;
      continue;
    }
    if (resolved.status === "unknown") {
      unknownPricingRecordCount += 1;
      continue;
    }

    const cost = resolved.costUsd;
    knownUsd += cost;
    knownRecordCount += 1;

    const stage = typeof record.stage === "string" ? record.stage : "unknown";
    const operation = typeof record.operation === "string" ? record.operation : "unknown";
    byStage[stage] = (byStage[stage] ?? 0) + cost;
    byOperation[operation] = (byOperation[operation] ?? 0) + cost;

    if (typeof record.retryCount === "number" && record.retryCount > 0) {
      retryUsd += cost;
    }
    const key = `${stage}:${operation}`;
    if (seenOperationKeys.has(key)) {
      duplicateUsd += cost;
    } else {
      seenOperationKeys.add(key);
    }
  }

  return {
    knownUsd: round(knownUsd),
    knownRecordCount,
    unknownPricingRecordCount,
    freeRecordCount,
    byStage: roundRecord(byStage),
    byOperation: roundRecord(byOperation),
    retryUsd: round(retryUsd),
    duplicateUsd: round(duplicateUsd),
  };
}

export type BudgetDecisionReason =
  | "within-budget"
  | "observed-exceeds-budget"
  | "projected-exceeds-budget"
  | "unknown-pricing-present";

export interface BudgetDecision {
  readonly allowed: boolean;
  readonly reason: BudgetDecisionReason;
  readonly budgetUsd: number;
  readonly observedKnownUsd: number;
  readonly pendingUsd: number;
  readonly projectedUsd: number;
  readonly hasUnknownPricing: boolean;
}

export function evaluateAiCostBudget(input: {
  readonly records: readonly AIUsageRecord[];
  /** Conservative USD ceiling of the call about to be made (0 for free/mock). */
  readonly pendingUsd?: number;
  /** The pending call resolves to no price row — fail closed. */
  readonly pendingPricingUnknown?: boolean;
  readonly budgetUsd?: number;
}): BudgetDecision {
  const budgetUsd = input.budgetUsd ?? resolveAiCostBudgetUsd();
  const summary = summarizeObservedCost(input.records);
  const pendingUsd = Math.max(0, Number.isFinite(input.pendingUsd ?? 0) ? (input.pendingUsd ?? 0) : 0);
  const projectedUsd = round(summary.knownUsd + pendingUsd);
  const hasUnknownPricing =
    summary.unknownPricingRecordCount > 0 || Boolean(input.pendingPricingUnknown);

  const base = {
    budgetUsd,
    observedKnownUsd: summary.knownUsd,
    pendingUsd: round(pendingUsd),
    projectedUsd,
    hasUnknownPricing,
  };

  if (hasUnknownPricing) {
    return { allowed: false, reason: "unknown-pricing-present", ...base };
  }
  if (summary.knownUsd >= budgetUsd) {
    return { allowed: false, reason: "observed-exceeds-budget", ...base };
  }
  if (projectedUsd > budgetUsd) {
    return { allowed: false, reason: "projected-exceeds-budget", ...base };
  }
  return { allowed: true, reason: "within-budget", ...base };
}

const SAFE_BUDGET_ERROR =
  "The $1 production AI-cost budget would be exceeded; the request was not dispatched.";

export class AiCostBudgetExceededError extends Error {
  readonly code = "AI_COST_BUDGET_EXCEEDED";
  readonly reasonCode: BudgetDecisionReason;
  readonly decision: BudgetDecision;

  constructor(decision: BudgetDecision) {
    super(SAFE_BUDGET_ERROR);
    this.name = "AiCostBudgetExceededError";
    this.reasonCode = decision.reason;
    this.decision = decision;
    this.stack = undefined;
  }
}

// --------------------------------------------------------------------------- internals

/**
 * Resolve one record to a `{ status, costUsd }`, tolerating pre-Faz-5 data:
 *  - explicit `pricingStatus` wins (free → 0; known → stored `estimatedCost`).
 *  - `mock` / `local` provider → free.
 *  - legacy billable record with a finite `estimatedCost` → known, that value.
 *  - legacy billable record with token counts + a priced model → known,
 *    re-derived deterministically from `AiPricing`.
 *  - anything else billable → unknown (fail-closed).
 */
function resolveRecordCost(
  record: AIUsageRecord,
): { status: "known" | "unknown" | "free"; costUsd: number } {
  const stored = numeric(record.estimatedCost);

  if (record.pricingStatus === "free") return { status: "free", costUsd: 0 };
  if (record.pricingStatus === "known") {
    return stored !== null ? { status: "known", costUsd: stored } : { status: "unknown", costUsd: 0 };
  }
  if (record.pricingStatus === "unknown") return { status: "unknown", costUsd: 0 };

  const provider = typeof record.provider === "string" ? record.provider.toLowerCase() : "";
  if (provider === "mock" || provider === "local") return { status: "free", costUsd: 0 };

  if (stored !== null) return { status: "known", costUsd: stored };

  const derived = estimateTokenCost({
    provider: record.provider,
    model: record.model,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  });
  if (derived.status === "known") return { status: "known", costUsd: derived.costUsd };
  if (derived.status === "free") return { status: "free", costUsd: 0 };

  return { status: "unknown", costUsd: 0 };
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function roundRecord(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) out[key] = round(value);
  return out;
}
