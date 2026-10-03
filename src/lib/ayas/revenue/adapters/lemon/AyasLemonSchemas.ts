/** Stage16.8: minimal canonical JSON:API projections. No remote text, key or URL survives. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "../../AyasRevenueSpendPolicy";
import { deepFreezeAyasRevenueValue, isAyasRevenueBoundedJson, isAyasRevenuePlainRecord, isAyasRevenueTimestamp, snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";

export const AYAS_LEMON_HOST = "https://api.lemonsqueezy.com" as const;
export const AYAS_LEMON_TYPES = ["stores", "products", "variants", "prices", "orders", "subscriptions", "subscription-invoices", "license-keys"] as const;
export type AyasLemonType = typeof AYAS_LEMON_TYPES[number];
export type AyasLemonMode = "TEST" | "LIVE";
export const lemonInteger = (v: unknown, min = 0, max = AYAS_REVENUE_MAX_MINOR_UNITS): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= min && (v as number) <= max;
export const lemonId = (v: unknown): string | null => typeof v === "string" && /^[1-9]\d{0,14}$/.test(v) && Number.isSafeInteger(Number(v)) ? v : lemonInteger(v, 1, 999_999_999_999_999) ? String(v) : null;
export const lemonCurrency = (v: unknown): v is string => (AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(v);
export function snapshotAyasLemonValue(raw: unknown, bytes = 262_144): unknown | null {
  try {
    if (!isAyasRevenueBoundedJson(raw, bytes)) return null;
    const s = snapshotAyasRevenueValue(raw);
    return s.ok && isAyasRevenueBoundedJson(s.value, bytes) ? deepFreezeAyasRevenueValue(s.value) : null;
  } catch { return null; }
}
/** Strict official UTC ISO shape, including microseconds. Reject calendar rollover before normalizing. */
export function lemonTime(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v)) return null;
  const ms = Date.parse(v); if (!Number.isFinite(ms)) return null;
  const iso = new Date(ms).toISOString();
  return iso.slice(0, 19) === v.slice(0, 19) ? iso : null;
}
export function lemonResource(raw: unknown, type: AyasLemonType, expectedId?: string): Record<string, unknown> | null {
  const r = snapshotAyasLemonValue(raw);
  if (!isAyasRevenuePlainRecord(r) || r.type !== type || lemonId(r.id) === null || (expectedId !== undefined && lemonId(r.id) !== expectedId) || !isAyasRevenuePlainRecord(r.attributes)) return null;
  return r;
}
/** Parent proof is from code-owned GETs in the same read. This schema is not authentication by itself. */
export function normalizeAyasLemonResource(raw: unknown, input: { type: AyasLemonType; storeRef: string; mode: AyasLemonMode; observedAt: string; parentRef?: string }): Readonly<Record<string, unknown>> | null {
  if (!isAyasRevenuePlainRecord(input) || !AYAS_LEMON_TYPES.includes(input.type) || lemonId(input.storeRef) !== input.storeRef || !["TEST", "LIVE"].includes(input.mode) || !isAyasRevenueTimestamp(input.observedAt)) return null;
  const r = lemonResource(raw, input.type); if (!r) return null;
  const a = r.attributes as Record<string, unknown>, id = lemonId(r.id)!, createdAt = lemonTime(a.created_at), updatedAt = lemonTime(a.updated_at);
  if (createdAt === null || updatedAt === null || createdAt > updatedAt || updatedAt > input.observedAt) return null;
  const directStore = ["products", "orders", "subscriptions", "subscription-invoices", "license-keys"].includes(input.type);
  if ((input.type === "stores" && id !== input.storeRef) || (directStore && lemonId(a.store_id) !== input.storeRef)) return null;
  if (!["stores", "prices", "license-keys"].includes(input.type) && a.test_mode !== (input.mode === "TEST")) return null;
  if (input.type === "variants" && lemonId(a.product_id) !== input.parentRef) return null;
  if (input.type === "prices" && lemonId(a.variant_id) !== input.parentRef) return null;
  if (input.type === "license-keys" && lemonId(a.order_id) !== input.parentRef) return null;
  const base = { type: input.type, resourceRef: id, storeRefDigest: digestAyasRevenueData({ storeRef: input.storeRef }), mode: input.mode, createdAt, updatedAt };
  let fields: Record<string, unknown>;
  switch (input.type) {
    case "stores":
      if (!lemonCurrency(a.currency)) return null;
      // Store aggregates are in USD and not segregated by mode in this schema: never economic evidence.
      fields = { currency: a.currency, modeEvidence: "CONNECTOR_ONLY", economicEvidence: "NONE" }; break;
    case "products":
      if (!["draft", "published"].includes(a.status as string) || typeof a.pay_what_you_want !== "boolean") return null;
      fields = { status: a.status, payWhatYouWant: a.pay_what_you_want }; break;
    case "variants":
      if (!["pending", "draft", "published"].includes(a.status as string) || typeof a.has_license_keys !== "boolean") return null;
      fields = { productRef: input.parentRef, status: a.status, hasLicenseKeys: a.has_license_keys }; break;
    case "prices":
      if (!["one_time", "subscription", "lead_magnet", "pwyw"].includes(a.category as string) || !["standard", "package", "graduated", "volume"].includes(a.scheme as string)
        || !(a.unit_price === null || lemonInteger(a.unit_price)) || !(a.usage_aggregation === null || ["sum", "last_during_period", "last_ever", "max"].includes(a.usage_aggregation as string))) return null;
      fields = { variantRef: input.parentRef, category: a.category, scheme: a.scheme, unitPriceCents: a.unit_price, currency: null,
        quoteQualification: "CURRENCY_AND_CURRENTNESS_UNQUALIFIED", modeEvidence: "VARIANT_PARENT", usageBased: a.usage_aggregation !== null }; break;
    case "orders": case "subscription-invoices": {
      const statuses = input.type === "orders" ? ["pending", "failed", "paid", "refunded", "partial_refund", "fraudulent"] : ["pending", "paid", "void", "refunded", "partial_refund"];
      const refundedAt = a.refunded_at === null ? null : lemonTime(a.refunded_at);
      if (!statuses.includes(a.status as string) || !lemonCurrency(a.currency) || !lemonInteger(a.total) || !lemonInteger(a.tax) || a.tax > a.total
        || typeof a.tax_inclusive !== "boolean" || typeof a.refunded !== "boolean" || !(a.refunded_amount === undefined || a.refunded_amount === null || (lemonInteger(a.refunded_amount) && a.refunded_amount <= a.total))
        || (a.refunded_at !== null && refundedAt === null) || (refundedAt !== null && (refundedAt < createdAt || refundedAt > updatedAt))
        || (a.status === "refunded" && (!a.refunded || refundedAt === null)) || (a.status !== "refunded" && a.refunded)) return null;
      if (input.type === "subscription-invoices" && (!lemonId(a.subscription_id) || !["initial", "renewal", "updated"].includes(a.billing_reason as string))) return null;
      fields = { status: a.status, currency: a.currency, totalMinor: a.total, taxMinor: a.tax, taxInclusive: a.tax_inclusive, refunded: a.refunded,
        refundedMinor: a.refunded_amount ?? null, refundedAt, ...(input.type === "subscription-invoices" ? { subscriptionRef: lemonId(a.subscription_id), billingReason: a.billing_reason } : {}),
        platformFee: null, processingFee: null, payout: null }; break;
    }
    case "subscriptions":
      if (!["on_trial", "active", "paused", "past_due", "unpaid", "cancelled", "expired"].includes(a.status as string) || typeof a.cancelled !== "boolean" || !lemonId(a.order_id)) return null;
      fields = { status: a.status, cancelled: a.cancelled, orderRef: lemonId(a.order_id), economicEvidence: "NONE" }; break;
    case "license-keys":
      if (!["inactive", "active", "expired", "disabled"].includes(a.status as string) || !lemonInteger(a.activation_limit, 0, 1_000_000) || !lemonInteger(a.instances_count, 0, 1_000_000)) return null;
      fields = { orderRef: input.parentRef, status: a.status, activationLimit: a.activation_limit, instanceCount: a.instances_count, modeEvidence: "ORDER_PARENT", keyRetention: "DISCARDED" }; break;
  }
  return deepFreezeAyasRevenueValue({ ...base, ...fields, contentRetention: "DISCARDED", grantsAuthority: false });
}
