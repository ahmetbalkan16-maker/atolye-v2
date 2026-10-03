/** Pure hypothetical per-unit scenario. There is no ledger dependency, currency conversion or action authority. */
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord } from "./AyasRevenueRedaction";
import { isAyasRevenueDigest, isAyasRevenueScenarioMoney, type AyasRevenueScenarioMoney } from "./AyasRevenueOpportunity";
export type AyasRevenueScenarioLabel = "OBSERVED" | "ASSUMED" | "UNKNOWN";
export interface AyasRevenueScenarioValue { readonly label: AyasRevenueScenarioLabel; readonly amount: AyasRevenueScenarioMoney | null; readonly evidenceDigest: string | null }
export interface AyasRevenueScenarioInput {
  readonly schemaVersion: "1"; readonly price: AyasRevenueScenarioValue; readonly platformFee: AyasRevenueScenarioValue;
  readonly paymentProcessingFee: AyasRevenueScenarioValue; readonly deliveryCost: AyasRevenueScenarioValue;
}
export type AyasRevenueScenarioResult =
  | { readonly valid: false; readonly reasonCode: "INVALID_SCENARIO"; readonly authority: "NONE"; readonly hypothetical: true }
  | { readonly valid: true; readonly authority: "NONE"; readonly hypothetical: true; readonly realized: false; readonly input: AyasRevenueScenarioInput;
      readonly state: "HYPOTHETICAL_READY" | "UNKNOWN"; readonly variableCosts: AyasRevenueScenarioValue; readonly contribution: AyasRevenueScenarioValue;
      readonly contributionMargin: number | null };
function quote(v: unknown): v is AyasRevenueScenarioValue {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["label", "amount", "evidenceDigest"])) return false;
  if (v.label === "UNKNOWN") return v.amount === null && v.evidenceDigest === null;
  return (v.label === "OBSERVED" || v.label === "ASSUMED") && isAyasRevenueScenarioMoney(v.amount)
    && (v.label === "OBSERVED" ? isAyasRevenueDigest(v.evidenceDigest) : v.evidenceDigest === null || isAyasRevenueDigest(v.evidenceDigest));
}
function valid(v: unknown): v is AyasRevenueScenarioInput {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["schemaVersion", "price", "platformFee", "paymentProcessingFee", "deliveryCost"])
    && v.schemaVersion === "1" && quote(v.price) && v.price.label !== "OBSERVED" && quote(v.platformFee) && quote(v.paymentProcessingFee) && quote(v.deliveryCost);
}
const unknown = (): AyasRevenueScenarioValue => ({ label: "UNKNOWN", amount: null, evidenceDigest: null });
export function computeAyasRevenueScenarioEconomics(raw: unknown): AyasRevenueScenarioResult {
  const invalid = () => Object.freeze({ valid: false as const, reasonCode: "INVALID_SCENARIO" as const, authority: "NONE" as const, hypothetical: true as const });
  try {
    if (!valid(raw)) return invalid(); const value: unknown = structuredClone(raw); if (!valid(value)) return invalid(); const input = deepFreezeAyasRevenueValue(value);
    const known = [input.price, input.platformFee, input.paymentProcessingFee, input.deliveryCost].filter(v => v.amount !== null);
    if (new Set(known.map(v => v.amount!.currency)).size > 1) return invalid();
    const costs = [input.platformFee, input.paymentProcessingFee, input.deliveryCost], currency = known[0]?.amount?.currency;
    let variableCosts: AyasRevenueScenarioValue = unknown(), contribution: AyasRevenueScenarioValue = unknown(), contributionMargin: number | null = null;
    if (costs.every(v => v.amount !== null) && currency) {
      const total = costs.reduce((n, v) => n + v.amount!.valueMinor, 0); if (!Number.isSafeInteger(total)) return invalid();
      variableCosts = { label: costs.some(v => v.label === "ASSUMED") ? "ASSUMED" : "OBSERVED", amount: { valueMinor: total, currency }, evidenceDigest: null };
      if (input.price.amount !== null) {
        const profit = input.price.amount.valueMinor - total; if (!Number.isSafeInteger(profit)) return invalid();
        // A future selling price is always hypothetical, even if every cost basis was observed.
        contribution = { label: "ASSUMED", amount: { valueMinor: profit, currency }, evidenceDigest: null };
        contributionMargin = input.price.amount.valueMinor > 0 ? profit / input.price.amount.valueMinor : null;
      }
    }
    return deepFreezeAyasRevenueValue({ valid: true, authority: "NONE", hypothetical: true, realized: false, input,
      state: contribution.amount === null ? "UNKNOWN" : "HYPOTHETICAL_READY", variableCosts, contribution, contributionMargin });
  } catch { return invalid(); }
}
