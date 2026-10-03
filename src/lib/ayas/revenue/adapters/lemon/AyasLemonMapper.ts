/** Inert Stage16.2 inputs from a current canonical GET envelope; never a webhook, draft or test-mode sale. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import type { AyasRevenueLedgerInput } from "../../AyasRevenueLedger";
import { isAyasRevenueDigest } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";
import { lemonCurrency, lemonId, lemonInteger, snapshotAyasLemonValue } from "./AyasLemonSchemas";

export function mapAyasLemonReadToLedger(raw: unknown): { readonly inputs: readonly AyasRevenueLedgerInput[]; readonly unknown: readonly string[]; readonly writesLedger: false; readonly authority: "NONE" } {
  const done = (inputs: AyasRevenueLedgerInput[], unknown: string[]) => deepFreezeAyasRevenueValue({ inputs, unknown: [...new Set(unknown)], writesLedger: false as const, authority: "NONE" as const });
  const r = snapshotAyasLemonValue(raw);
  if (!isAyasRevenuePlainRecord(r) || r.schemaVersion !== "1" || r.platform !== "lemon-squeezy" || !["ORDER_LIST_READ", "ANALYTICS_READ"].includes(r.operation as string) || r.status !== "OK"
    || !isAyasRevenueTimestamp(r.observedAt) || !isAyasRevenuePlainRecord(r.evidence) || !hasExactAyasRevenueKeys(r.evidence, ["transport", "externalMutation", "monetaryMutation"])
    || r.evidence.transport !== "OFFICIAL_API" || r.evidence.externalMutation !== false || r.evidence.monetaryMutation !== false || !isAyasRevenuePlainRecord(r.data)) return done([], ["NOT_CANONICAL_READ"]);
  const d = r.data;
  if (d.kind !== "LEMON_CANONICAL_READ" || !["orders", "subscription-invoices"].includes(d.resourceType as string) || !["TEST", "LIVE"].includes(d.mode as string)
    || !isAyasRevenueDigest(d.storeRefDigest) || d.authority !== "NONE" || !Array.isArray(d.items) || d.items.length > 25) return done([], ["NOT_CANONICAL_READ"]);
  if (d.mode === "TEST") return done([], ["TEST_MODE_EXCLUDED_FROM_REALIZED_LEDGER"]);
  const inputs: AyasRevenueLedgerInput[] = [], unknown = ["PLATFORM_FEE_UNKNOWN", "PROCESSING_FEE_UNKNOWN", "PAYOUT_UNKNOWN", "SETTLEMENT_TIMESTAMP_UNKNOWN"];
  const seen = new Set<string>();
  for (const item of d.items) {
    const p = item as Record<string, unknown>;
    if (!isAyasRevenuePlainRecord(p) || p.type !== d.resourceType || p.mode !== "LIVE" || p.storeRefDigest !== d.storeRefDigest || lemonId(p.resourceRef) !== p.resourceRef || seen.has(p.resourceRef as string)
      || !isAyasRevenueTimestamp(p.createdAt) || !isAyasRevenueTimestamp(p.updatedAt) || p.createdAt > p.updatedAt || p.updatedAt > r.observedAt
      || !lemonCurrency(p.currency) || !lemonInteger(p.totalMinor) || !lemonInteger(p.taxMinor) || p.taxMinor > p.totalMinor || typeof p.taxInclusive !== "boolean"
      || !["pending", "failed", "void", "paid", "refunded", "partial_refund", "fraudulent"].includes(p.status as string) || typeof p.refunded !== "boolean"
      || !(p.refundedMinor === null || (lemonInteger(p.refundedMinor) && p.refundedMinor <= p.totalMinor))
      || !(p.refundedAt === null || (isAyasRevenueTimestamp(p.refundedAt) && p.refundedAt >= p.createdAt && p.refundedAt <= p.updatedAt))
      || (p.status === "refunded" ? p.refunded !== true || p.refundedAt === null : p.refunded !== false)
      || p.platformFee !== null || p.processingFee !== null || p.payout !== null || p.grantsAuthority !== false || p.contentRetention !== "DISCARDED"
      || (p.type === "subscription-invoices" && (!lemonId(p.subscriptionRef) || !["initial", "renewal", "updated"].includes(p.billingReason as string)))) return done([], ["INVALID_CANONICAL_FACT"]);
    seen.add(p.resourceRef as string);
    // The API documents cents; zero-decimal currency representation needs separate qualification.
    if (["JPY", "KRW"].includes(p.currency)) { unknown.push("NON_TWO_DECIMAL_CENT_BASIS_UNQUALIFIED"); continue; }
    // Initial invoices overlap the initial order; only orders represent the first sale.
    if (p.type === "subscription-invoices" && p.billingReason === "initial") { unknown.push("INITIAL_INVOICE_EXCLUDED_ORDER_IS_CANONICAL"); continue; }
    if (!["paid", "refunded", "partial_refund"].includes(p.status as string)) { unknown.push("NOT_OBSERVED_PAID"); continue; }
    const identity = { type: p.type, id: p.resourceRef, store: d.storeRefDigest }, orderDigest = digestAyasRevenueData(identity)!;
    const entry = (event: "GROSS_REVENUE" | "REFUND", amount: number, occurredAt: string) => {
      const proof = { identity, event, amount, currency: p.currency, occurredAt, basis: "CUSTOMER_TOTAL_LESS_EXPLICIT_MOR_TAX" };
      inputs.push({ schemaVersion: "1", platform: "lemon-squeezy", event, amount: { valueMinor: amount, currency: p.currency as string }, occurredAt,
        externalEventDigest: digestAyasRevenueData({ identity, event })!, orderDigest, offerDigest: null, activityDigest: null,
        evidence: { source: "SYSTEM_DERIVED", adapterId: null, adapterVersion: null, observedAt: r.observedAt as string, evidenceDigest: digestAyasRevenueData(proof)! }, reversesEntryId: null, notesCode: "IMPORTED" });
    };
    // MoR collects the customer tax. This is informational gross before fees, not seller net or a payout.
    entry("GROSS_REVENUE", (p.totalMinor as number) - (p.taxMinor as number), p.createdAt as string);
    if (p.refundedMinor !== null && (p.refundedMinor as number) > 0) {
      if (p.status === "refunded" && p.refundedMinor === p.totalMinor && p.refundedAt !== null) entry("REFUND", (p.totalMinor as number) - (p.taxMinor as number), p.refundedAt as string);
      else unknown.push("PARTIAL_REFUND_TAX_ALLOCATION_OR_OCCURRENCE_UNKNOWN");
    } else if (p.status === "refunded" || p.status === "partial_refund") unknown.push("REFUND_AMOUNT_UNKNOWN");
  }
  return done(inputs, unknown);
}
