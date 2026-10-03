/** Strict, local owner reports. No credentials, external reads, persistence or ledger append; unknown facts stay unknown. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import type { AyasRevenueLedgerInput, AyasRevenueEconomicEvent } from "../../AyasRevenueLedger";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";
import { snapshotAyasFiverrValue } from "./AyasFiverrDrafts";
const past = (v: unknown, now: string): v is string => isAyasRevenueTimestamp(v) && Date.parse(v) <= Date.parse(now);
const count = (v: unknown) => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0 && (v as number) <= 1_000_000_000;
export function importAyasFiverrOwnerSnapshot(raw: unknown, expectedAccountRef: string, now: string): unknown | null {
  const p = snapshotAyasFiverrValue(raw);
  if (!isAyasRevenueTimestamp(now) || !isAyasRevenueExternalId(expectedAccountRef) || !isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["schemaVersion", "platform", "accountRef", "kind", "observedAt", "evidenceDigest", "data"])
    || p.schemaVersion !== "1" || p.platform !== "fiverr" || p.accountRef !== expectedAccountRef || !past(p.observedAt, now)
    || Date.parse(now) - Date.parse(p.observedAt) > 86_400_000 || !isAyasRevenueDigest(p.evidenceDigest)) return null;
  const data = p.data;
  if (p.kind === "ACCOUNT") { if (!isAyasRevenuePlainRecord(data) || !hasExactAyasRevenueKeys(data, ["state"]) || !["UNCONFIGURED", "ACTIVE", "RESTRICTED"].includes(data.state as string)) return null; }
  else if (p.kind === "ANALYTICS") {
    if (!isAyasRevenuePlainRecord(data) || !hasExactAyasRevenueKeys(data, ["periodStart", "periodEnd", "impressions", "clicks", "ordersCompleted"])
      || !past(data.periodStart, p.observedAt) || !past(data.periodEnd, p.observedAt) || Date.parse(data.periodEnd) <= Date.parse(data.periodStart)
      || Date.parse(data.periodEnd) - Date.parse(data.periodStart) > 31 * 86_400_000 || ![data.impressions, data.clicks, data.ordersCompleted].every(count)) return null;
  } else if (p.kind === "ORDERS") {
    if (!isAyasRevenueDataArray(data, 50) || !data.every(o => isAyasRevenuePlainRecord(o) && hasExactAyasRevenueKeys(o, ["orderDigest", "state"]) && isAyasRevenueDigest(o.orderDigest)
      && ["REQUIREMENTS_MISSING", "IN_PROGRESS", "REVISION_REQUESTED", "DELIVERY_PREPARED", "COMPLETED_OBSERVED", "CANCELLED_OBSERVED"].includes(o.state as string))
      || new Set(data.map(o => (o as Record<string, unknown>).orderDigest)).size !== data.length) return null;
  } else return null;
  return deepFreezeAyasRevenueValue({ ...p, source: "OWNER_INPUT", verification: "UNVERIFIED_OWNER_REPORT", authority: "NONE", externalMutation: false });
}
export function mapAyasFiverrOwnerEconomics(raw: unknown, expectedAccountRef: string, now: string): { readonly inputs: readonly AyasRevenueLedgerInput[]; readonly unknown: readonly string[]; readonly authority: "NONE"; readonly appendsLedger: false } {
  const refused = () => deepFreezeAyasRevenueValue({ inputs: [], unknown: ["INVALID_OWNER_ECONOMICS"], authority: "NONE" as const, appendsLedger: false as const });
  const p = snapshotAyasFiverrValue(raw);
  if (!isAyasRevenueTimestamp(now) || !isAyasRevenueExternalId(expectedAccountRef) || !isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["schemaVersion", "platform", "source", "accountRef", "eventRefDigest", "orderDigest", "orderState", "completedAt", "gross", "fee", "payout", "payoutState", "cashMovementAt", "observedAt", "evidenceDigest"])
    || p.schemaVersion !== "1" || p.platform !== "fiverr" || p.source !== "OWNER_INPUT" || p.accountRef !== expectedAccountRef
    || ![p.eventRefDigest, p.orderDigest, p.evidenceDigest].every(isAyasRevenueDigest) || !past(p.observedAt, now)
    || !["COMPLETED_OBSERVED", "IN_PROGRESS", "CANCELLED_OBSERVED"].includes(p.orderState as string)
    || !(p.completedAt === null || past(p.completedAt, p.observedAt)) || !(p.cashMovementAt === null || past(p.cashMovementAt, p.observedAt))
    || !["NOT_OBSERVED", "PENDING_CLEARANCE", "AVAILABLE", "WITHDRAWN_OBSERVED"].includes(p.payoutState as string)
    || ![p.gross, p.fee, p.payout].every(m => m === null || isAyasRevenueScenarioMoney(m))) return refused();
  const amounts = [p.gross, p.fee, p.payout].filter(m => m !== null) as { valueMinor: number; currency: string }[];
  if (new Set(amounts.map(m => m.currency)).size > 1 || p.orderState === "COMPLETED_OBSERVED" && p.completedAt === null
    || p.orderState !== "COMPLETED_OBSERVED" && p.completedAt !== null || p.payoutState === "WITHDRAWN_OBSERVED" && (p.payout === null || p.cashMovementAt === null)
    || p.payoutState !== "WITHDRAWN_OBSERVED" && p.cashMovementAt !== null
    || p.cashMovementAt !== null && p.completedAt !== null && Date.parse(p.cashMovementAt as string) < Date.parse(p.completedAt as string)) return refused();
  const inputs: AyasRevenueLedgerInput[] = [], unknown: string[] = [];
  const add = (event: AyasRevenueEconomicEvent, amount: unknown, occurredAt: string) => {
    if (amount === null) { unknown.push(`${event}_UNKNOWN`); return; }
    inputs.push({ schemaVersion: "1", platform: "fiverr", event, amount: amount as AyasRevenueLedgerInput["amount"], occurredAt,
      externalEventDigest: digestAyasRevenueData({ platform: "fiverr", eventRefDigest: p.eventRefDigest, event })!, orderDigest: p.orderDigest as string, offerDigest: null, activityDigest: null,
      evidence: { source: "OWNER_IMPORT", adapterId: null, adapterVersion: null, observedAt: p.observedAt as string, evidenceDigest: p.evidenceDigest as string }, reversesEntryId: null, notesCode: "IMPORTED" });
  };
  if (p.orderState === "COMPLETED_OBSERVED") { add("GROSS_REVENUE", p.gross, p.completedAt as string); add("PLATFORM_FEE", p.fee, p.completedAt as string); }
  else unknown.push("ORDER_NOT_COMPLETED_NO_REALIZED_REVENUE");
  if (p.payoutState === "WITHDRAWN_OBSERVED") add("PAYOUT_OBSERVED", p.payout, p.cashMovementAt as string);
  else unknown.push("CASH_MOVEMENT_NOT_OBSERVED");
  return deepFreezeAyasRevenueValue({ inputs, unknown, authority: "NONE", appendsLedger: false });
}
