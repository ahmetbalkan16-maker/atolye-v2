/**
 * Stage 16.1 — revenue zero-cost / spend gate. Pure policy; it moves no money and adds no executor.
 *
 * A stricter revenue-domain wrapper around the global AyasZeroCostPolicy (which is not changed and decides
 * every cost class here):
 *   - the upfront and autonomous revenue budgets are literal zero; nothing in the environment, a payload, a
 *     model, research or platform text can raise them;
 *   - every monetary commitment (ads, subscriptions, purchases, paid credits or bids, active fee
 *     commitments, refunds, transfers/withdrawals) is denied autonomously, whatever its amount, including 0
 *     (a free trial that can renew or needs payment details is a subscription);
 *   - unknown cost, a missing amount on a monetary event and any event other than NONE or an observed
 *     passive fee are UNKNOWN_COST_DENIED; every cost class the global policy denies is denied;
 *   - reads may use either globally allowed zero-cost class (including offline/local adapters); a local
 *     draft must be `local-zero-cost`;
 *   - an observed passive platform fee is an accounting fact from a read, never authorization; next to a
 *     write or a draft it is a denied monetary commitment;
 *   - expected revenue, reported profit or an "owner policy" source offset nothing: the intent has no field
 *     for them and the source does not change the decision in Stage 16.1.
 * The intent is read once (structured snapshot). An allowed decision never has `monetaryMutation: true`,
 * and an allowed external write still needs the owner through the Stage 16.0 action policy. The Stage 16.0
 * read/draft runner calls this gate before every dispatch.
 */
import { evaluateAyasZeroCost, parseAyasCostClass, type AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { AYAS_REVENUE_OPERATION_EFFECT, AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueOperation, type AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
import { hasExactAyasRevenueKeys, isAyasRevenueOperation, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp, snapshotAyasRevenueValue } from "./AyasRevenueRedaction";

export const AYAS_REVENUE_UPFRONT_BUDGET_USD = 0 as const;
export const AYAS_REVENUE_AUTONOMOUS_SPEND_USD = 0 as const;
export const AYAS_REVENUE_MONEY_EVENTS = Object.freeze(["NONE", "PASSIVE_PLATFORM_FEE_OBSERVED", "ACTIVE_FEE_COMMITMENT", "AD_SPEND", "SUBSCRIPTION", "PURCHASE",
  "PAID_CREDIT_OR_BID", "REFUND", "TRANSFER_OR_WITHDRAWAL", "UNKNOWN"] as const);
export type AyasRevenueMoneyEvent = typeof AYAS_REVENUE_MONEY_EVENTS[number];
/** Events that commit money. Each is denied autonomously at any amount. */
export const AYAS_REVENUE_ACTIVE_MONEY_EVENTS: readonly AyasRevenueMoneyEvent[] = Object.freeze(["ACTIVE_FEE_COMMITMENT", "AD_SPEND", "SUBSCRIPTION", "PURCHASE",
  "PAID_CREDIT_OR_BID", "REFUND", "TRANSFER_OR_WITHDRAWAL"]);
export const AYAS_REVENUE_SPEND_SOURCES = Object.freeze(["PLATFORM_FACT", "LOCAL_PLAN", "OWNER_POLICY"] as const);
/** ISO 4217 codes accepted for amounts. No exchange-rate conversion happens anywhere in Stage 16.1. */
export const AYAS_REVENUE_CURRENCIES = Object.freeze(["USD", "EUR", "GBP", "TRY", "CAD", "AUD", "NZD", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF",
  "RON", "BGN", "ILS", "INR", "SGD", "HKD", "MXN", "BRL", "ZAR", "AED", "SAR", "KRW", "CNY", "PHP", "IDR", "MYR", "THB"] as const);
/** Largest accepted amount in minor units (10^12, e.g. ten billion dollars in cents). */
export const AYAS_REVENUE_MAX_MINOR_UNITS = 1_000_000_000_000;

export interface AyasRevenueSpendIntent {
  readonly schemaVersion: typeof AYAS_REVENUE_SCHEMA_VERSION;
  readonly platform: AyasRevenuePlatform;
  readonly operation: AyasRevenueOperation;
  readonly event: AyasRevenueMoneyEvent;
  readonly amount: { readonly valueMinor: number; readonly currency: string } | null;
  readonly costClass: AyasCostClass;
  readonly source: typeof AYAS_REVENUE_SPEND_SOURCES[number];
  readonly requestedAt: string;
}
export type AyasRevenueSpendDecision =
  | { readonly allowedAutonomously: true; readonly reasonCode: "ZERO_COST_OPERATION" | "PASSIVE_FEE_OBSERVATION"; readonly monetaryMutation: false; readonly budgetUsd: 0; readonly grantsActionAuthority: false }
  | { readonly allowedAutonomously: false; readonly reasonCode: "UPFRONT_SPEND_DENIED" | "MONETARY_COMMITMENT_DENIED" | "UNKNOWN_COST_DENIED" | "FINANCIAL_OPERATION_OWNER_REQUIRED" | "INVALID_MONEY_INTENT";
      readonly monetaryMutation: boolean; readonly budgetUsd: 0; readonly grantsActionAuthority: false };

const INTENT_KEYS = ["schemaVersion", "platform", "operation", "event", "amount", "costClass", "source", "requestedAt"] as const;
export function isAyasRevenueSpendIntent(raw: unknown): raw is AyasRevenueSpendIntent {
  if (!isAyasRevenuePlainRecord(raw) || !hasExactAyasRevenueKeys(raw, INTENT_KEYS)) return false;
  const a = raw.amount;
  return raw.schemaVersion === AYAS_REVENUE_SCHEMA_VERSION && isAyasRevenuePlatform(raw.platform) && isAyasRevenueOperation(raw.operation)
    && (AYAS_REVENUE_MONEY_EVENTS as readonly unknown[]).includes(raw.event)
    && (a === null || (isAyasRevenuePlainRecord(a) && hasExactAyasRevenueKeys(a, ["valueMinor", "currency"])
      && Number.isSafeInteger(a.valueMinor) && (a.valueMinor as number) >= 0 && (a.valueMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS
      && (AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(a.currency)))
    && typeof raw.costClass === "string" && parseAyasCostClass(raw.costClass) === raw.costClass
    && (AYAS_REVENUE_SPEND_SOURCES as readonly unknown[]).includes(raw.source) && isAyasRevenueTimestamp(raw.requestedAt);
}

const allow = (reasonCode: "ZERO_COST_OPERATION" | "PASSIVE_FEE_OBSERVATION"): AyasRevenueSpendDecision =>
  Object.freeze({ allowedAutonomously: true as const, reasonCode, monetaryMutation: false as const, budgetUsd: AYAS_REVENUE_AUTONOMOUS_SPEND_USD, grantsActionAuthority: false as const });
const deny = (reasonCode: Extract<AyasRevenueSpendDecision, { allowedAutonomously: false }>["reasonCode"], monetaryMutation: boolean): AyasRevenueSpendDecision =>
  Object.freeze({ allowedAutonomously: false as const, reasonCode, monetaryMutation, budgetUsd: AYAS_REVENUE_AUTONOMOUS_SPEND_USD, grantsActionAuthority: false as const });
/** The upfront budget is zero in every currency, so any positive amount exceeds it. */
const exceedsUpfrontBudget = (valueMinor: number): boolean => valueMinor > AYAS_REVENUE_UPFRONT_BUDGET_USD;

/** The only input is the intent itself: no budget, balance, expected revenue or profit can be passed in. */
export function decideAyasRevenueSpend(raw: unknown): AyasRevenueSpendDecision {
  // Check descriptors before cloning so neither top-level nor nested money accessors are invoked.
  // Reflection on a hostile proxy may throw; an invalid intent still produces a refusal.
  let snapshot: ReturnType<typeof snapshotAyasRevenueValue>;
  try {
    if (!isAyasRevenueSpendIntent(raw)) return deny("INVALID_MONEY_INTENT", false);
    snapshot = snapshotAyasRevenueValue(raw);
  } catch { return deny("INVALID_MONEY_INTENT", false); }
  if (!snapshot || !snapshot.ok || !isAyasRevenueSpendIntent(snapshot.value)) return deny("INVALID_MONEY_INTENT", false);
  const intent = snapshot.value, effect = AYAS_REVENUE_OPERATION_EFFECT[intent.operation];
  if (effect === "FINANCIAL_COMMITMENT") return deny("FINANCIAL_OPERATION_OWNER_REQUIRED", true);
  if (AYAS_REVENUE_ACTIVE_MONEY_EVENTS.includes(intent.event)) {
    if (intent.amount === null) return deny("UNKNOWN_COST_DENIED", true);
    return exceedsUpfrontBudget(intent.amount.valueMinor) ? deny("UPFRONT_SPEND_DENIED", true) : deny("MONETARY_COMMITMENT_DENIED", true);
  }
  // Fail closed: only NONE and an observed passive fee continue.
  if (intent.event !== "NONE" && intent.event !== "PASSIVE_PLATFORM_FEE_OBSERVED") return deny("UNKNOWN_COST_DENIED", true);
  // The operation's own transport cost, decided by the global policy: a paid or unknown-cost read is itself spending.
  const cost = evaluateAyasZeroCost(intent.costClass);
  if (!cost.allowed) return cost.reasonCode === "AYAS_ZERO_COST_DENIED_UNKNOWN" ? deny("UNKNOWN_COST_DENIED", true) : deny("MONETARY_COMMITMENT_DENIED", true);
  if (intent.event === "PASSIVE_PLATFORM_FEE_OBSERVED") {
    if (effect !== "READ_ONLY") return deny("MONETARY_COMMITMENT_DENIED", true);
    if (intent.source !== "PLATFORM_FACT" || intent.amount === null) return deny("INVALID_MONEY_INTENT", false);
  } else if (intent.amount !== null && intent.amount.valueMinor !== 0) return deny("INVALID_MONEY_INTENT", false);
  if (effect === "LOCAL_DRAFT" && intent.costClass !== "local-zero-cost") return deny("INVALID_MONEY_INTENT", false);
  return allow(intent.event === "PASSIVE_PLATFORM_FEE_OBSERVED" ? "PASSIVE_FEE_OBSERVATION" : "ZERO_COST_OPERATION");
}
