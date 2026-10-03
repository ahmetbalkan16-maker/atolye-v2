/**
 * Stage 16.4 — Etsy answers become platform-neutral facts, and canonical payment reads become Stage 16.2 ledger inputs.
 *
 * Only named fields are read: buyer and seller personal data (names, emails, addresses, messages, user ids) is never
 * copied, and no raw Etsy payload is kept. A record that does not have the expected shape makes the whole page invalid
 * rather than partly read. Money that cannot be converted exactly is null (unknown), never zero.
 */
import { AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueAdapterResult } from "../../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenuePlainRecord, isAyasRevenueTimestamp, snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";
import { AYAS_REVENUE_MAX_MINOR_UNITS } from "../../AyasRevenueSpendPolicy";
import { digestAyasRevenueExternalId, type AyasRevenueLedgerInput } from "../../AyasRevenueLedger";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { AYAS_ETSY_ADAPTER_ID, AYAS_ETSY_ADAPTER_VERSION, AYAS_ETSY_CURRENCY_EXPONENT, AYAS_ETSY_LISTING_STATES, AYAS_ETSY_MAX_RESPONSE_BYTES, AYAS_ETSY_PAGE_LIMIT, ayasEtsyIdOf, ayasEtsyMoney, ayasEtsyTime, type AyasEtsyAmount } from "./AyasEtsySchemas";

const RECEIPT_STATUSES = ["paid", "completed", "open", "payment processing", "canceled", "fully refunded", "partially refunded"] as const;
const code = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const money = (v: unknown): AyasEtsyAmount | null => (v === null || v === undefined ? null : ayasEtsyMoney(v));
const list = (v: unknown): unknown[] | null => Array.isArray(v) ? v : null;

export interface AyasEtsyListingFact { readonly listingRef: string; readonly state: typeof AYAS_ETSY_LISTING_STATES[number] | "removed"; readonly title: string; readonly quantity: number;
  readonly price: AyasEtsyAmount | null; readonly listingType: "physical" | "download" | "both" | null; readonly taxonomyId: number | null; readonly tagCount: number; readonly createdAt: string; readonly updatedAt: string }
export function normalizeAyasEtsyListing(raw: unknown): AyasEtsyListingFact | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const listingRef = ayasEtsyIdOf(raw.listing_id), createdAt = ayasEtsyTime(raw.created_timestamp), updatedAt = ayasEtsyTime(raw.updated_timestamp), tags = list(raw.tags);
  if (listingRef === null || createdAt === null || updatedAt === null || !([...AYAS_ETSY_LISTING_STATES, "removed"] as readonly unknown[]).includes(raw.state)
    || typeof raw.title !== "string" || raw.title.length === 0 || raw.title.length > 140 || !count(raw.quantity) || tags === null || tags.length > 13) return null;
  const listingType = (["physical", "download", "both"] as readonly unknown[]).includes(raw.listing_type) ? raw.listing_type as AyasEtsyListingFact["listingType"] : null;
  const taxonomyId = Number.isSafeInteger(raw.taxonomy_id) && (raw.taxonomy_id as number) > 0 ? raw.taxonomy_id as number : null;
  return { listingRef, state: raw.state as AyasEtsyListingFact["state"], title: raw.title, quantity: raw.quantity as number, price: money(raw.price), listingType, taxonomyId, tagCount: tags.length, createdAt, updatedAt };
}

export interface AyasEtsyReceiptFact { readonly receiptRef: string; readonly status: typeof RECEIPT_STATUSES[number]; readonly isPaid: boolean; readonly isShipped: boolean;
  readonly createdAt: string; readonly updatedAt: string; readonly grandTotal: AyasEtsyAmount | null; readonly subtotal: AyasEtsyAmount | null; readonly shipping: AyasEtsyAmount | null;
  readonly salesTax: AyasEtsyAmount | null; readonly vat: AyasEtsyAmount | null; readonly discount: AyasEtsyAmount | null; readonly giftWrap: AyasEtsyAmount | null;
  readonly transactionCount: number; readonly refundCount: number }
export function normalizeAyasEtsyReceipt(raw: unknown): AyasEtsyReceiptFact | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const receiptRef = ayasEtsyIdOf(raw.receipt_id), createdAt = ayasEtsyTime(raw.created_timestamp), updatedAt = ayasEtsyTime(raw.updated_timestamp);
  const transactions = list(raw.transactions), refunds = raw.refunds === null || raw.refunds === undefined ? [] : list(raw.refunds);
  if (receiptRef === null || createdAt === null || updatedAt === null || !(RECEIPT_STATUSES as readonly unknown[]).includes(raw.status) || typeof raw.is_paid !== "boolean"
    || typeof raw.is_shipped !== "boolean" || transactions === null || refunds === null) return null;
  return { receiptRef, status: raw.status as AyasEtsyReceiptFact["status"], isPaid: raw.is_paid, isShipped: raw.is_shipped, createdAt, updatedAt,
    grandTotal: money(raw.grandtotal), subtotal: money(raw.subtotal), shipping: money(raw.total_shipping_cost), salesTax: money(raw.total_tax_cost), vat: money(raw.total_vat_cost),
    discount: money(raw.discount_amt), giftWrap: money(raw.gift_wrap_price), transactionCount: transactions.length, refundCount: refunds.length };
}

export interface AyasEtsyAdjustmentFact { readonly adjustmentRef: string; readonly success: boolean; readonly status: string | null; readonly refundMinor: number | null; readonly feeRefundMinor: number | null; readonly createdAt: string }
export interface AyasEtsyPaymentFact { readonly paymentRef: string; readonly receiptRef: string; readonly currency: string; readonly status: string | null; readonly createdAt: string;
  readonly gross: AyasEtsyAmount | null; readonly fees: AyasEtsyAmount | null; readonly net: AyasEtsyAmount | null; readonly adjustments: readonly AyasEtsyAdjustmentFact[] }
/** Amounts in another currency than the payment's are unknown: no conversion is invented. */
export function normalizeAyasEtsyPayment(raw: unknown): AyasEtsyPaymentFact | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const paymentRef = ayasEtsyIdOf(raw.payment_id), receiptRef = ayasEtsyIdOf(raw.receipt_id), createdAt = ayasEtsyTime(raw.created_timestamp), currency = raw.currency;
  const adjustments = raw.payment_adjustments === null || raw.payment_adjustments === undefined ? [] : list(raw.payment_adjustments);
  if (paymentRef === null || receiptRef === null || createdAt === null || typeof currency !== "string" || !Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, currency) || adjustments === null || adjustments.length > 50) return null;
  const same = (v: unknown) => { const m = money(v); return m !== null && m.currency === currency ? m : null; };
  const adjusted: AyasEtsyAdjustmentFact[] = [];
  for (const a of adjustments) {
    if (!isAyasRevenuePlainRecord(a)) return null;
    const adjustmentRef = ayasEtsyIdOf(a.payment_adjustment_id), at = ayasEtsyTime(a.create_timestamp);
    if (adjustmentRef === null || at === null || typeof a.is_success !== "boolean" || ayasEtsyIdOf(a.payment_id) !== paymentRef) return null;
    const amount = (v: unknown) => count(v) && !Object.is(v, -0) && (v as number) <= AYAS_REVENUE_MAX_MINOR_UNITS ? v as number : null;
    adjusted.push({ adjustmentRef, success: a.is_success, status: code(a.status) ? a.status : null, refundMinor: amount(a.total_adjustment_amount), feeRefundMinor: amount(a.total_fee_adjustment_amount), createdAt: at });
  }
  return { paymentRef, receiptRef, currency, status: code(raw.status) ? raw.status : null, createdAt, gross: same(raw.amount_gross), fees: same(raw.amount_fees), net: same(raw.amount_net), adjustments: adjusted };
}

export interface AyasEtsyLedgerEntryFact { readonly entryRef: string; readonly ledgerRef: string; readonly amount: number; readonly currency: string; readonly unitsVerified: false;
  readonly createdAt: string; readonly ledgerType: string | null; readonly referenceType: string | null; readonly referenceRef: string | null }
/** Etsy's payment-account ledger: kept as observed. Its integer units and type vocabulary are not yet verified against a live account, so it is never mapped to money. */
export function normalizeAyasEtsyLedgerEntry(raw: unknown): AyasEtsyLedgerEntryFact | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const entryRef = ayasEtsyIdOf(raw.entry_id), ledgerRef = ayasEtsyIdOf(raw.ledger_id), createdAt = ayasEtsyTime(raw.created_timestamp);
  if (entryRef === null || ledgerRef === null || createdAt === null || !Number.isSafeInteger(raw.amount) || typeof raw.currency !== "string" || !Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, raw.currency)) return null;
  const referenceRef = typeof raw.reference_id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(raw.reference_id) ? raw.reference_id : null;
  return { entryRef, ledgerRef, amount: raw.amount as number, currency: raw.currency, unitsVerified: false, createdAt, ledgerType: code(raw.ledger_type) ? raw.ledger_type : null,
    referenceType: code(raw.reference_type) ? raw.reference_type : null, referenceRef };
}

export interface AyasEtsyShopFact { readonly shopRef: string; readonly currency: string | null; readonly activeListings: number; readonly digitalListings: number; readonly soldTransactions: number;
  readonly reviewCount: number | null; readonly reviewAverage: number | null; readonly onVacation: boolean }
export function normalizeAyasEtsyShop(raw: unknown): AyasEtsyShopFact | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const shopRef = ayasEtsyIdOf(raw.shop_id);
  if (shopRef === null || !count(raw.listing_active_count) || !count(raw.digital_listing_count) || !count(raw.transaction_sold_count) || typeof raw.is_vacation !== "boolean") return null;
  const avg = typeof raw.review_average === "number" && Number.isFinite(raw.review_average) && raw.review_average >= 0 && raw.review_average <= 5 ? raw.review_average : null;
  return { shopRef, currency: typeof raw.currency_code === "string" && Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, raw.currency_code) ? raw.currency_code : null,
    activeListings: raw.listing_active_count as number, digitalListings: raw.digital_listing_count as number, soldTransactions: raw.transaction_sold_count as number,
    reviewCount: count(raw.review_count) ? raw.review_count as number : null, reviewAverage: avg, onVacation: raw.is_vacation };
}

export interface AyasEtsyLedgerMapping {
  readonly inputs: readonly AyasRevenueLedgerInput[];
  /** Economic facts that exist but could not be stated exactly. Each is unknown, never zero. */
  readonly unknown: readonly string[];
  readonly authority: "NONE"; readonly writesLedger: false;
}
const amount = (v: unknown): v is AyasEtsyAmount => isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["valueMinor", "currency"]) && count(v.valueMinor)
  && !Object.is(v.valueMinor, -0) && (v.valueMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS && typeof v.currency === "string" && Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, v.currency);
const amountOrNull = (v: unknown, currency: unknown) => v === null || (amount(v) && v.currency === currency);
function paymentFact(v: unknown): v is AyasEtsyPaymentFact {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["paymentRef", "receiptRef", "currency", "status", "createdAt", "gross", "fees", "net", "adjustments"])
    && typeof v.paymentRef === "string" && /^[1-9]\d{0,18}$/.test(v.paymentRef) && typeof v.receiptRef === "string" && /^[1-9]\d{0,18}$/.test(v.receiptRef)
    && typeof v.currency === "string" && Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, v.currency) && (v.status === null || code(v.status)) && isAyasRevenueTimestamp(v.createdAt)
    && amountOrNull(v.gross, v.currency) && amountOrNull(v.fees, v.currency) && amountOrNull(v.net, v.currency) && Array.isArray(v.adjustments) && v.adjustments.length <= 50 && v.adjustments.every((a) => isAyasRevenuePlainRecord(a)
      && hasExactAyasRevenueKeys(a, ["adjustmentRef", "success", "status", "refundMinor", "feeRefundMinor", "createdAt"]) && typeof a.adjustmentRef === "string" && /^[1-9]\d{0,18}$/.test(a.adjustmentRef)
      && typeof a.success === "boolean" && (a.status === null || code(a.status))
      && (a.refundMinor === null || (count(a.refundMinor) && !Object.is(a.refundMinor, -0) && (a.refundMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS))
      && (a.feeRefundMinor === null || (count(a.feeRefundMinor) && !Object.is(a.feeRefundMinor, -0) && (a.feeRefundMinor as number) <= AYAS_REVENUE_MAX_MINOR_UNITS)) && isAyasRevenueTimestamp(a.createdAt));
}
/**
 * Ledger inputs from one canonical `PAYOUT_LIST_READ` / `RECEIPT_PAYMENTS` result of this adapter — never from a webhook.
 * Gross revenue only for a settled payment; the card processing fee as reported; successful refunds in a two-decimal
 * payment currency (Etsy states adjustment amounts in pennies). Etsy's transaction and listing fees and payouts are not in a
 * payment record, so they are reported unknown here. Nothing is written: the caller appends through the Stage 16.2 store.
 */
export function mapAyasEtsyPaymentsToLedger(result: unknown): AyasEtsyLedgerMapping {
  try {
    if (!isAyasRevenueBoundedJson(result, AYAS_ETSY_MAX_RESPONSE_BYTES)) return refusedMapping("INVALID_PAYMENT_READ");
    const snapshot = snapshotAyasRevenueValue(result);
    return snapshot.ok && isAyasRevenueBoundedJson(snapshot.value, AYAS_ETSY_MAX_RESPONSE_BYTES) ? mapPayments(snapshot.value) : refusedMapping("INVALID_PAYMENT_READ");
  } catch { return refusedMapping("INVALID_PAYMENT_READ"); }
}
const refusedMapping = (why: string): AyasEtsyLedgerMapping => deepFreezeAyasRevenueValue({ inputs: [], unknown: [why], authority: "NONE" as const, writesLedger: false as const });
function mapPayments(result: unknown): AyasEtsyLedgerMapping {
  const refuse = refusedMapping, r = result as AyasRevenueAdapterResult;
  if (!isAyasRevenuePlainRecord(result) || r.schemaVersion !== AYAS_REVENUE_SCHEMA_VERSION || r.platform !== "etsy" || r.operation !== "PAYOUT_LIST_READ" || r.status !== "OK"
    || !isAyasRevenuePlainRecord(r.evidence) || !hasExactAyasRevenueKeys(r.evidence, ["transport", "externalMutation", "monetaryMutation"])
    || r.evidence.transport !== "OFFICIAL_API" || r.evidence.externalMutation !== false || r.evidence.monetaryMutation !== false || !isAyasRevenueTimestamp(r.observedAt)) return refuse("NOT_A_CANONICAL_ETSY_PAYMENT_READ");
  const data = r.data as { kind?: unknown; items?: unknown };
  if (!isAyasRevenuePlainRecord(data) || data.kind !== "RECEIPT_PAYMENTS" || !Array.isArray(data.items) || data.items.length > AYAS_ETSY_PAGE_LIMIT || !data.items.every(paymentFact)) return refuse("NOT_A_CANONICAL_ETSY_PAYMENT_READ");
  const inputs: AyasRevenueLedgerInput[] = [], unknown: string[] = [];
  for (const p of data.items as AyasEtsyPaymentFact[]) {
    const evidenceDigest = digestAyasRevenueData(p);
    if (evidenceDigest === null) { unknown.push(`PAYMENT:${p.paymentRef}`); continue; }
    const orderDigest = digestAyasRevenueExternalId(`etsy-receipt:${p.receiptRef}`);
    const entry = (event: AyasRevenueLedgerInput["event"], key: string, value: AyasEtsyAmount, occurredAt: string): AyasRevenueLedgerInput => ({
      schemaVersion: "1", platform: "etsy", event, amount: { valueMinor: value.valueMinor, currency: value.currency }, occurredAt,
      externalEventDigest: digestAyasRevenueExternalId(`etsy-${key}`), orderDigest, offerDigest: null, activityDigest: null,
      evidence: { source: "PLATFORM_ADAPTER", adapterId: AYAS_ETSY_ADAPTER_ID, adapterVersion: AYAS_ETSY_ADAPTER_VERSION, observedAt: r.observedAt, evidenceDigest },
      reversesEntryId: null, notesCode: null });
    if (p.status !== "settled") unknown.push(`GROSS_REVENUE_NOT_SETTLED:${p.paymentRef}`);
    else if (p.gross === null) unknown.push(`GROSS_REVENUE:${p.paymentRef}`);
    else inputs.push(entry("GROSS_REVENUE", `payment:${p.paymentRef}:gross`, p.gross, p.createdAt));
    if (p.fees === null) unknown.push(`PAYMENT_PROCESSING_FEE:${p.paymentRef}`);
    else inputs.push(entry("PAYMENT_PROCESSING_FEE", `payment:${p.paymentRef}:processing-fee`, p.fees, p.createdAt));
    for (const a of p.adjustments) {
      if (!a.success) continue;
      if (a.refundMinor === null || AYAS_ETSY_CURRENCY_EXPONENT[p.currency] !== 2) { unknown.push(`REFUND:${a.adjustmentRef}`); continue; }
      inputs.push(entry("REFUND", `adjustment:${a.adjustmentRef}:refund`, { valueMinor: a.refundMinor, currency: p.currency }, a.createdAt));
      if (a.feeRefundMinor !== null && a.feeRefundMinor > 0) unknown.push(`PROCESSING_FEE_RETURNED:${a.adjustmentRef}`);
    }
    unknown.push(`PLATFORM_FEE_NOT_IN_PAYMENT:${p.paymentRef}`);
  }
  unknown.push("PAYOUT_FROM_LEDGER_TYPES_UNVERIFIED");
  return deepFreezeAyasRevenueValue({ inputs, unknown, authority: "NONE" as const, writesLedger: false as const });
}
