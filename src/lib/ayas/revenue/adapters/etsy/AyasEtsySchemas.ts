/**
 * Stage 16.4 — the code-owned Etsy Open API v3 surface AYAS may read.
 *
 * Re-checked on 2026-10-03 against Etsy's published OpenAPI 3.0.0 document (servers: openapi.etsy.com), the
 * authentication, rate-limit and webhook pages. Paths are fixed templates with numeric ids; nothing in a request
 * payload, a platform answer or external text can choose a host, path or method. Only GET is reachable.
 * Credentials (OAuth token, API key) live in the connector-managed transport and never pass through here.
 */
import type { AyasRevenueOperation } from "../../AyasRevenuePlatformTypes";
import type { AyasRevenueScopeMap } from "../../AyasRevenueAccountConnection";
import { AYAS_REVENUE_CURRENCIES, AYAS_REVENUE_MAX_MINOR_UNITS } from "../../AyasRevenueSpendPolicy";
import { isAyasRevenuePlainRecord } from "../../AyasRevenueRedaction";

export const AYAS_ETSY_ADAPTER_ID = "etsy-open-api-v3";
export const AYAS_ETSY_ADAPTER_VERSION = 1;
export const AYAS_ETSY_API_HOST = "openapi.etsy.com";
/** Hosts a webhook `resource_url` may name; it is parsed for ids only and never fetched as given. */
export const AYAS_ETSY_RESOURCE_HOSTS = Object.freeze(["api.etsy.com", "openapi.etsy.com"] as const);
export const AYAS_ETSY_PAGE_LIMIT = 100;
export const AYAS_ETSY_MAX_OFFSET = 10_000;
export const AYAS_ETSY_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const AYAS_ETSY_LEDGER_WINDOW_MAX_SECONDS = 31 * 86_400;

/** Reads and the local listing draft only. Listing create/update and every money operation are not declared, so they are never planned as executable. */
export const AYAS_ETSY_OPERATIONS: readonly AyasRevenueOperation[] = Object.freeze(["ACCOUNT_STATUS_READ", "LISTING_LIST_READ", "ORDER_LIST_READ", "PAYOUT_LIST_READ", "ANALYTICS_READ", "LISTING_DRAFT"]);
/** Least privilege: read scopes only. A connection holding any write scope is excess and not usable. */
export const AYAS_ETSY_SCOPE_MAP: AyasRevenueScopeMap = Object.freeze({
  ACCOUNT_STATUS_READ: Object.freeze(["shops_r"]), ANALYTICS_READ: Object.freeze(["shops_r"]), LISTING_LIST_READ: Object.freeze(["listings_r"]),
  ORDER_LIST_READ: Object.freeze(["transactions_r"]), PAYOUT_LIST_READ: Object.freeze(["transactions_r"]),
});
export const AYAS_ETSY_WRITE_SCOPES = Object.freeze(["listings_w", "listings_d", "shops_w", "transactions_w", "profile_w", "address_w"] as const);
export const AYAS_ETSY_LISTING_STATES = Object.freeze(["active", "inactive", "sold_out", "draft", "expired"] as const);

const id = (value: string) => /^[1-9]\d{0,18}$/.test(value);
/** Fixed GET templates. Each id must be a positive decimal string. */
export const ayasEtsyPath = Object.freeze({
  me: () => "/v3/application/users/me",
  shop: (shopId: string) => id(shopId) ? `/v3/application/shops/${shopId}` : null,
  listings: (shopId: string) => id(shopId) ? `/v3/application/shops/${shopId}/listings` : null,
  receipts: (shopId: string) => id(shopId) ? `/v3/application/shops/${shopId}/receipts` : null,
  receipt: (shopId: string, receiptId: string) => id(shopId) && id(receiptId) ? `/v3/application/shops/${shopId}/receipts/${receiptId}` : null,
  receiptPayments: (shopId: string, receiptId: string) => id(shopId) && id(receiptId) ? `/v3/application/shops/${shopId}/receipts/${receiptId}/payments` : null,
  ledgerEntries: (shopId: string) => id(shopId) ? `/v3/application/shops/${shopId}/payment-account/ledger-entries` : null,
});
export const isAyasEtsyId = (value: unknown): value is string => typeof value === "string" && id(value);
/** Etsy ids arrive as JSON integers; only exact positive safe integers become ids. */
export const ayasEtsyIdOf = (value: unknown): string | null => Number.isSafeInteger(value) && (value as number) > 0 ? String(value) : null;

/** ISO 4217 minor-unit exponents for the closed revenue currency list. */
export const AYAS_ETSY_CURRENCY_EXPONENT: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(AYAS_REVENUE_CURRENCIES.map((c) => [c, c === "JPY" || c === "KRW" ? 0 : 2])));
export interface AyasEtsyAmount { readonly valueMinor: number; readonly currency: string }
/**
 * Etsy `Money` is `{ amount, divisor, currency_code }`, worth amount / divisor. It becomes integer minor units only when
 * the currency is in the closed list and the conversion is exact; anything else is null (unknown), never zero.
 */
export function ayasEtsyMoney(raw: unknown): AyasEtsyAmount | null {
  if (!isAyasRevenuePlainRecord(raw)) return null;
  const { amount, divisor, currency_code: currency } = raw;
  if (!Number.isSafeInteger(amount) || (amount as number) < 0 || !Number.isSafeInteger(divisor) || (divisor as number) < 1 || typeof currency !== "string"
    || !Object.hasOwn(AYAS_ETSY_CURRENCY_EXPONENT, currency)) return null;
  const scaled = (amount as number) * 10 ** AYAS_ETSY_CURRENCY_EXPONENT[currency]!;
  if (!Number.isSafeInteger(scaled) || scaled % (divisor as number) !== 0) return null;
  const valueMinor = scaled / (divisor as number);
  return valueMinor <= AYAS_REVENUE_MAX_MINOR_UNITS ? Object.freeze({ valueMinor, currency }) : null;
}
/** Epoch seconds to an ISO timestamp; anything else is null. */
export function ayasEtsyTime(raw: unknown): string | null {
  if (!Number.isSafeInteger(raw) || (raw as number) <= 0 || (raw as number) > 32_503_680_000) return null;
  return new Date((raw as number) * 1000).toISOString();
}

export interface AyasEtsyRateLimit { readonly limitPerSecond: number | null; readonly remainingThisSecond: number | null; readonly limitPerDay: number | null; readonly remainingToday: number | null }
/** Official headers, lower-cased. The documentation spells one `x-remaining-this-secon`; both spellings are read. Malformed values are unknown. */
export function ayasEtsyRateLimit(headers: Readonly<Record<string, string>>): AyasEtsyRateLimit {
  const n = (...names: string[]): number | null => {
    for (const name of names) { const v = headers[name]; if (typeof v === "string" && /^\d{1,9}$/.test(v.trim())) return Number(v.trim()); }
    return null;
  };
  return Object.freeze({ limitPerSecond: n("x-limit-per-second"), remainingThisSecond: n("x-remaining-this-second", "x-remaining-this-secon"),
    limitPerDay: n("x-limit-per-day"), remainingToday: n("x-remaining-today") });
}

/** Receipt fields that carry buyer or seller personal data. They are never read into a normalized fact. */
export const AYAS_ETSY_RECEIPT_PII_FIELDS = Object.freeze(["seller_email", "buyer_email", "buyer_user_id", "name", "first_line", "second_line", "city", "state", "zip",
  "formatted_address", "country_iso", "payment_email", "message_from_seller", "message_from_buyer", "message_from_payment", "gift_message", "gift_sender", "shipments"] as const);
