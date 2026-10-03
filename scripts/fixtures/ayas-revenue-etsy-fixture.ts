/**
 * Stage16.4 test-only Etsy transport: answers shaped like the official Open API v3 schemas (ShopListing, ShopReceipt,
 * Payment, PaymentAccountLedgerEntry, Shop, Self), including buyer personal fields that the adapter must drop.
 * Synthetic values only; no network, account or credential. Never registered in production.
 */
import { createHmac } from "node:crypto";
import type { AyasEtsyTransportRequest } from "../../src/lib/ayas/revenue/adapters/etsy/AyasEtsyAdapter";

export const ETSY_SHOP_ID = "12345678";
export const ETSY_ACCOUNT_REF = "etsy-shop-main";
export const ETSY_NOW = "2026-10-03T12:00:00.000Z";
export const etsyEpoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const usd = (amount: number, divisor = 100, currency_code = "USD") => ({ amount, divisor, currency_code });

export function etsyConnection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { schemaVersion: "1", platform: "etsy", accountRef: ETSY_ACCOUNT_REF, label: "Main Etsy shop", credentialHandling: "CONNECTOR_MANAGED", credentialRef: "connector:etsy-main",
    grantedScopes: ["listings_r", "shops_r", "transactions_r"], connectedAt: "2026-09-01T12:00:00.000Z", expiresAt: "2026-12-01T12:00:00.000Z", lastVerifiedAt: "2026-10-03T06:00:00.000Z",
    reauthRequired: false, ...overrides };
}
export const ETSY_SCOPES = Object.freeze(["listings_r", "shops_r", "transactions_r"]);

export function etsyListing(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { listing_id: 900000 + n, user_id: 555, shop_id: Number(ETSY_SHOP_ID), title: `Printable map ${n}`, description: "Visit https://example.test for details", state: "active",
    creation_timestamp: etsyEpoch("2026-09-10T10:00:00.000Z"), created_timestamp: etsyEpoch("2026-09-10T10:00:00.000Z"), updated_timestamp: etsyEpoch("2026-09-20T10:00:00.000Z"),
    quantity: 99, url: `https://www.etsy.test/listing/${900000 + n}`, listing_type: "download", tags: ["map", "printable"], price: usd(1200), taxonomy_id: 2078, num_favorers: 3, ...overrides };
}
export function etsyReceipt(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { receipt_id: 700000 + n, receipt_type: 0, seller_user_id: 555, seller_email: "seller@example.test", buyer_user_id: 4242, buyer_email: "buyer@example.test",
    name: "Jane Buyer", first_line: "1 Test Street", second_line: "Flat 2", city: "Testville", state: "TS", zip: "12345", formatted_address: "Jane Buyer, 1 Test Street, Testville",
    country_iso: "US", status: "paid", payment_method: "cc", payment_email: "pay@example.test", message_from_seller: "Thanks Jane", message_from_buyer: "Call me at 555-0100",
    message_from_payment: null, is_paid: true, is_shipped: false, create_timestamp: etsyEpoch("2026-10-02T09:00:00.000Z"), created_timestamp: etsyEpoch("2026-10-02T09:00:00.000Z"),
    update_timestamp: etsyEpoch("2026-10-02T10:00:00.000Z"), updated_timestamp: etsyEpoch("2026-10-02T10:00:00.000Z"), is_gift: true, gift_message: "Happy birthday Jane", gift_sender: "Bob",
    grandtotal: usd(1380), subtotal: usd(1200), total_price: usd(1200), total_shipping_cost: usd(0), total_tax_cost: usd(180), total_vat_cost: usd(0), discount_amt: usd(0), gift_wrap_price: usd(0),
    shipments: [{ receipt_shipping_id: 1, tracking_code: "TRACK123" }], transactions: [{ transaction_id: 1, title: "Printable map" }], refunds: [], ...overrides };
}
export function etsyPayment(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { payment_id: 800000 + n, buyer_user_id: 4242, shop_id: Number(ETSY_SHOP_ID), receipt_id: 700000 + n, amount_gross: usd(1380), amount_fees: usd(66), amount_net: usd(1314),
    posted_gross: usd(1380), posted_fees: usd(66), posted_net: usd(1314), adjusted_gross: null, adjusted_fees: null, adjusted_net: null, currency: "USD", shop_currency: "USD",
    buyer_currency: "USD", shipping_user_id: 4242, shipping_address_id: 31, billing_address_id: 32, status: "settled", shipped_timestamp: null,
    create_timestamp: etsyEpoch("2026-10-02T09:01:00.000Z"), created_timestamp: etsyEpoch("2026-10-02T09:01:00.000Z"), update_timestamp: etsyEpoch("2026-10-02T09:01:00.000Z"),
    updated_timestamp: etsyEpoch("2026-10-02T09:01:00.000Z"), payment_adjustments: [], ...overrides };
}
export function etsyAdjustment(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { payment_adjustment_id: 600000 + n, payment_id: 800001, status: "COMPLETE", is_success: true, user_id: 555, reason_code: "Buyer asked", total_adjustment_amount: 500,
    shop_total_adjustment_amount: 500, buyer_total_adjustment_amount: 500, total_fee_adjustment_amount: 20, create_timestamp: etsyEpoch("2026-10-02T15:00:00.000Z"),
    created_timestamp: etsyEpoch("2026-10-02T15:00:00.000Z"), update_timestamp: etsyEpoch("2026-10-02T15:00:00.000Z"), updated_timestamp: etsyEpoch("2026-10-02T15:00:00.000Z"),
    payment_adjustment_items: [], ...overrides };
}
export function etsyLedgerEntry(n: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { entry_id: 500000 + n, ledger_id: 4400, sequence_number: n, amount: 1314, currency: "USD", description: "Payment for order", balance: 98765,
    create_date: etsyEpoch("2026-10-02T09:02:00.000Z"), created_timestamp: etsyEpoch("2026-10-02T09:02:00.000Z"), ledger_type: "Payment", reference_type: "receipt", reference_id: "700001",
    parent_entry_id: null, payment_adjustments: [], ...overrides };
}
export const etsyShop = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ shop_id: Number(ETSY_SHOP_ID), user_id: 555, shop_name: "MapStudio", currency_code: "USD",
  listing_active_count: 5, digital_listing_count: 5, transaction_sold_count: 12, review_count: 4, review_average: 4.75, is_vacation: false, login_name: "seller", url: "https://www.etsy.test/shop/MapStudio",
  policy_seller_info: "Contact seller@example.test", ...overrides });

export interface EtsyFakeTransport { readonly calls: AyasEtsyTransportRequest[]; readonly transport: (r: AyasEtsyTransportRequest) => Promise<unknown> }
type Answer = { status: number; headers: Record<string, string>; body: unknown };
/** Default answers by path; `override` can replace any answer. Pages honour `limit`/`offset`. */
export function etsyFakeTransport(options: { listings?: number; receipts?: number; override?: (r: AyasEtsyTransportRequest) => unknown } = {}): EtsyFakeTransport {
  const calls: AyasEtsyTransportRequest[] = [], ok = (body: unknown): Answer => ({ status: 200, headers: { "X-Limit-Per-Second": "150", "x-remaining-this-second": "149", "x-limit-per-day": "100000", "x-remaining-today": "99998" }, body });
  const page = (total: number, make: (n: number) => unknown, q: Readonly<Record<string, string>>) => {
    const limit = Number(q.limit ?? 25), offset = Number(q.offset ?? 0), results = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) results.push(make(i + 1));
    return { count: total, results };
  };
  const shop = `/v3/application/shops/${ETSY_SHOP_ID}`;
  const transport = async (r: AyasEtsyTransportRequest): Promise<unknown> => {
    calls.push(r);
    if (options.override) { const answer = options.override(r); if (answer !== undefined) return answer; }
    if (r.path === "/v3/application/users/me") return ok({ user_id: Number(ETSY_SHOP_ID), shop_id: Number(ETSY_SHOP_ID) });
    if (r.path === shop) return ok(etsyShop());
    if (r.path === `${shop}/listings`) return ok(page(options.listings ?? 5, (n) => etsyListing(n), r.query));
    if (r.path === `${shop}/receipts`) return ok(page(options.receipts ?? 3, (n) => etsyReceipt(n), r.query));
    const receipt = new RegExp(`^${shop}/receipts/(\\d+)(/payments)?$`).exec(r.path);
    if (receipt) { const n = Number(receipt[1]) - 700000; return ok(receipt[2] ? { count: 1, results: [etsyPayment(n)] } : etsyReceipt(n)); }
    if (r.path === `${shop}/payment-account/ledger-entries`) return ok(page(2, (n) => etsyLedgerEntry(n), r.query));
    return { status: 404, headers: {}, body: { error: "not found" } };
  };
  return { calls, transport };
}

/** Signs exactly as Etsy documents: base64(HMAC-SHA256(base64decode(secret without whsec_), id.timestamp.body)). */
export const ETSY_WEBHOOK_SECRET = `whsec_${Buffer.from("stage16.4-fixture-signing-key-32b").toString("base64")}`;
export function etsySignWebhook(id: string, timestamp: number, body: string, secret = ETSY_WEBHOOK_SECRET): string {
  return createHmac("sha256", Buffer.from(secret.slice("whsec_".length), "base64")).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}
export function etsyWebhookBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ event_type: "order.paid", resource_url: `https://api.etsy.com/v3/application/shops/${ETSY_SHOP_ID}/receipts/700001`, shop_id: Number(ETSY_SHOP_ID), ...overrides });
}
