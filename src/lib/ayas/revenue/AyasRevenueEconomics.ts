/** Pure per-currency economics from observed ledger facts. Hypothetical prices/FX and execution authority are absent. */
import { deepFreezeAyasRevenueValue } from "./AyasRevenueRedaction";
import { AyasRevenueLedgerError, validateAyasRevenueLedgerState, type AyasRevenueLedgerEntry, type AyasRevenueLedgerState } from "./AyasRevenueLedger";

export const AYAS_REVENUE_ECONOMICS_DIMENSIONS = Object.freeze(["platform", "orderDigest", "offerDigest", "activityDigest", "day", "week", "month", "currency"] as const);
export type AyasRevenueEconomicsDimension = typeof AYAS_REVENUE_ECONOMICS_DIMENSIONS[number];
export interface AyasRevenueEconomics {
  readonly currency: string; readonly grossRevenueMinor: number; readonly refundsMinor: number; readonly netRevenueMinor: number;
  readonly platformFeesMinor: number; readonly paymentProcessingFeesMinor: number; readonly variableDeliveryCostMinor: number;
  readonly adSpendMinor: number; readonly otherCostMinor: number; readonly variableCostsMinor: number; readonly taxWithheldMinor: number; readonly payoutObservedMinor: number;
  readonly observedContributionProfitMinor: number; readonly contributionProfitMinor: number | null; readonly contributionMargin: number | null;
  readonly status: "COMPLETE_OBSERVATIONS" | "INCOMPLETE"; readonly incompleteEvidence: boolean;
  readonly entryCount: number; readonly activeEntryCount: number; readonly earliestFactAt: string; readonly latestFactAt: string;
  readonly sourceCoverage: Readonly<Record<"PLATFORM_ADAPTER" | "OWNER_IMPORT" | "SYSTEM_DERIVED", number>>;
  /** Refused conflicts are not appended; this ledger cannot reconstruct their historical count. */
  readonly conflictCount: null; readonly conflictCoverage: "NOT_RECORDED"; readonly reversalCount: number;
  readonly evidenceVerification: "UNVERIFIED_OBSERVATIONS"; readonly grantsAuthority: false;
}
export interface AyasRevenueEconomicsGroup { readonly key: Readonly<Partial<Record<AyasRevenueEconomicsDimension, string | null>>>; readonly economics: AyasRevenueEconomics }
const safeAdd = (a: number, b: number): number => { const sum = a + b; if (!Number.isSafeInteger(sum)) throw new AyasRevenueLedgerError("AGGREGATE_OVERFLOW"); return sum; };
function period(at: string, dimension: "day" | "week" | "month"): string {
  const day = at.split("T")[0]!;
  if (dimension === "month") return day.slice(0, day.lastIndexOf("-"));
  if (dimension === "day") return day;
  const d = new Date(at); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().split("T")[0]!;
}
function summarize(facts: readonly AyasRevenueLedgerEntry[], reversed: ReadonlySet<string>): AyasRevenueEconomics {
  const active = facts.filter((v) => v.event !== "REVERSAL" && !reversed.has(v.entryId));
  const sum = (event: AyasRevenueLedgerEntry["event"]): number => active.filter((v) => v.event === event).reduce((n, v) => safeAdd(n, v.amount.valueMinor), 0);
  const grossRevenueMinor = sum("GROSS_REVENUE"), refundsMinor = sum("REFUND"), netRevenueMinor = safeAdd(grossRevenueMinor, -refundsMinor);
  const platformFeesMinor = sum("PLATFORM_FEE"), paymentProcessingFeesMinor = sum("PAYMENT_PROCESSING_FEE"), variableDeliveryCostMinor = sum("VARIABLE_DELIVERY_COST");
  const adSpendMinor = sum("AD_SPEND"), otherCostMinor = sum("OTHER_COST");
  const variableCostsMinor = [platformFeesMinor, paymentProcessingFeesMinor, variableDeliveryCostMinor, adSpendMinor, otherCostMinor].reduce(safeAdd, 0);
  const observedContributionProfitMinor = safeAdd(netRevenueMinor, -variableCostsMinor);
  const sales = active.filter((v) => v.event === "GROSS_REVENUE");
  // Explicit zero-fee facts count; missing fees never become zero. Null order identities cannot prove fee coverage.
  const incompleteEvidence = sales.length === 0 || sales.some((sale) => sale.orderDigest === null || ["PLATFORM_FEE", "PAYMENT_PROCESSING_FEE"].some((fee) =>
    !active.some((v) => v.platform === sale.platform && v.amount.currency === sale.amount.currency && v.orderDigest === sale.orderDigest && v.event === fee)));
  const sourceCoverage = { PLATFORM_ADAPTER: 0, OWNER_IMPORT: 0, SYSTEM_DERIVED: 0 }; for (const v of facts) sourceCoverage[v.evidence.source]++;
  const times = facts.map((v) => v.occurredAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  return deepFreezeAyasRevenueValue({ currency: facts[0]!.amount.currency, grossRevenueMinor, refundsMinor, netRevenueMinor, platformFeesMinor,
    paymentProcessingFeesMinor, variableDeliveryCostMinor, adSpendMinor, otherCostMinor, variableCostsMinor, observedContributionProfitMinor,
    contributionProfitMinor: incompleteEvidence ? null : observedContributionProfitMinor,
    contributionMargin: incompleteEvidence || netRevenueMinor <= 0 ? null : observedContributionProfitMinor / netRevenueMinor,
    taxWithheldMinor: sum("TAX_WITHHELD"), payoutObservedMinor: sum("PAYOUT_OBSERVED"), status: incompleteEvidence ? "INCOMPLETE" : "COMPLETE_OBSERVATIONS",
    incompleteEvidence, entryCount: facts.length, activeEntryCount: active.length, earliestFactAt: times[0]!, latestFactAt: times.at(-1)!, sourceCoverage,
    conflictCount: null, conflictCoverage: "NOT_RECORDED", reversalCount: facts.filter((v) => v.event === "REVERSAL").length,
    evidenceVerification: "UNVERIFIED_OBSERVATIONS", grantsAuthority: false });
}
/** Currency is always part of a group, even when omitted by the caller. Reverse globally before grouping by time. */
export function groupAyasRevenueEconomics(raw: AyasRevenueLedgerState, requested: readonly AyasRevenueEconomicsDimension[] = ["currency"]): readonly AyasRevenueEconomicsGroup[] {
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > AYAS_REVENUE_ECONOMICS_DIMENSIONS.length
    || new Set(requested).size !== requested.length || !requested.every((d) => AYAS_REVENUE_ECONOMICS_DIMENSIONS.includes(d))) throw new AyasRevenueLedgerError("INVALID_INPUT");
  const state = validateAyasRevenueLedgerState(raw), dimensions: AyasRevenueEconomicsDimension[] = [...requested]; if (!dimensions.includes("currency")) dimensions.push("currency");
  const reversed = new Set(state.entries.filter((v) => v.event === "REVERSAL").map((v) => v.reversesEntryId!));
  const groups = new Map<string, { key: AyasRevenueEconomicsGroup["key"]; facts: AyasRevenueLedgerEntry[] }>();
  for (const v of state.entries) {
    const key = Object.fromEntries(dimensions.map((d) => [d, d === "currency" ? v.amount.currency : d === "day" || d === "week" || d === "month" ? period(v.occurredAt, d) : v[d]]));
    const identity = JSON.stringify(dimensions.map((d) => key[d]));
    if (!groups.has(identity)) groups.set(identity, { key, facts: [] }); groups.get(identity)!.facts.push(v);
  }
  return deepFreezeAyasRevenueValue([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => ({ key: g.key, economics: summarize(g.facts, reversed) })));
}
export function summarizeAyasRevenueEconomics(state: AyasRevenueLedgerState): readonly AyasRevenueEconomics[] {
  return deepFreezeAyasRevenueValue(groupAyasRevenueEconomics(state).map((g) => g.economics));
}
