/** Synthetic source-contract proof only. No owner key, real store, request or payment. */
import { createHmac, createHash } from "node:crypto";
import { createAyasLemonSqueezyAdapter, type AyasLemonAdapterOptions, type AyasLemonTransportRequest, AYAS_LEMON_CONNECTION_STATES } from "../../src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter";
import { createAyasRevenuePlatformRegistry, runAyasRevenueReadOrDraft } from "../../src/lib/ayas/revenue/AyasRevenuePlatformRegistry";
import { revenueOfferFixture } from "./ayas-revenue-offer-fixture";
import { revenueFulfillmentFixture } from "./ayas-revenue-fulfillment-fixture";
export const LEMON_NOW = "2026-10-03T15:00:00.000Z";
export const lemonDigest = (s: string) => createHash("sha256").update(s).digest("hex");
export function lemonWire(type = "products", id = "10", test = true): { type: string; id: string; attributes: Record<string, unknown> } {
  const base = { store_id: 1, created_at: "2026-10-03T12:00:00.000000Z", updated_at: "2026-10-03T14:00:00.000000Z", test_mode: test,
    user_email: "buyer@example.test", user_name: "Private Customer", urls: { receipt: "https://private.test/signed" }, description: "<h1>Remote text</h1>" };
  const attrs: Record<string, Record<string, unknown>> = { stores: { currency: "USD", total_revenue: 999999, thirty_day_revenue: 5000 },
    products: { status: "published", pay_what_you_want: false }, variants: { product_id: 10, status: "pending", has_license_keys: true },
    prices: { variant_id: 20, category: "one_time", scheme: "standard", unit_price: 1000, usage_aggregation: null },
    orders: { status: "paid", currency: "USD", total: 1200, tax: 200, tax_inclusive: false, refunded: false, refunded_at: null, refunded_amount: 0 },
    subscriptions: { status: "active", cancelled: false, order_id: 30 },
    "subscription-invoices": { subscription_id: 40, billing_reason: "renewal", status: "paid", currency: "USD", total: 1200, tax: 200, tax_inclusive: false, refunded: false, refunded_at: null, refunded_amount: 0 },
    "license-keys": { order_id: 30, status: "active", activation_limit: 5, instances_count: 1, key: "synthetic-license-value", key_short: "synthetic-license-short" } };
  const attributes: Record<string, unknown> = { ...base, ...attrs[type] };
  if (["stores", "prices", "license-keys"].includes(type)) delete attributes.test_mode;
  return { type, id, attributes };
}
export function lemonAnswer(rows: unknown[], next: string | null = null, page = 1, limit = 10, lastPage = 1, total = rows.length) {
  return { status: 200, headers: { "X-Ratelimit-Limit": "300", "X-Ratelimit-Remaining": "299" } as Record<string, string>, body: { jsonapi: { version: "1.0" }, data: rows as unknown, meta: { page: { currentPage: page, perPage: limit, lastPage, total } }, links: { next } } };
}
export function lemonConnection() { return { schemaVersion: "1", platform: "lemon-squeezy", accountRef: "lemon-fixture", label: "Fixture store", credentialHandling: "SERVER_SECRET", credentialRef: "vault:lemon-fixture", grantedScopes: [] as string[],
  connectedAt: "2026-10-03T12:00:00.000Z", expiresAt: "2027-10-03T12:00:00.000Z" as string | null, lastVerifiedAt: LEMON_NOW as string | null, reauthRequired: false }; }
export function lemonRequest(operation = "LISTING_LIST_READ", extra: Record<string, unknown> = {}) { return { requestId: "lemon-source-request", platform: "lemon-squeezy", operation,
  mode: operation.endsWith("DRAFT") ? "DRAFT" : operation.endsWith("READ") ? "READ" : "EXECUTE", accountRef: "lemon-fixture", requestedAt: LEMON_NOW, payload: { kind: "products" }, ...extra }; }
export function lemonFixture(overrides: Partial<AyasLemonAdapterOptions> = {}) {
  const calls: AyasLemonTransportRequest[] = [], state = { time: LEMON_NOW, approved: true, free: true, live: false, credentialState: "TEST_CONNECTED" as typeof AYAS_LEMON_CONNECTION_STATES[number], connection: lemonConnection(),
    answer: lemonAnswer([lemonWire()]), resources: { products: lemonWire("products", "10"), variants: lemonWire("variants", "20"), prices: lemonWire("prices", "25"), orders: lemonWire("orders", "30"), "license-keys": lemonWire("license-keys", "60") } as Record<string, ReturnType<typeof lemonWire>> };
  const adapter = createAyasLemonSqueezyAdapter({ accountRef: "lemon-fixture", storeRef: "1", mode: "TEST", connection: () => state.connection, credentialState: () => state.credentialState,
    ownerReadPolicyApproved: () => state.approved, zeroCostQualified: () => state.free, liveReadApproved: () => state.live, now: () => state.time,
    transport: async request => { calls.push(request); const m = /^\/v1\/([^/]+)\/([1-9]\d*)$/.exec(request.path); return m ? { ...state.answer, body: { jsonapi: { version: "1.0" }, data: state.resources[m[1]!] ?? lemonWire(m[1]!, m[2]!, state.credentialState === "TEST_CONNECTED") } } : state.answer; }, ...overrides });
  const registry = createAyasRevenuePlatformRegistry([adapter]); return { adapter, state, calls, registry, run: (r = lemonRequest()) => runAyasRevenueReadOrDraft(registry, r, { now: () => state.time }) };
}
export function lemonProductDraft() { const offer = revenueOfferFixture(); return { schemaVersion: "1", kind: "PRODUCT", title: "Reusable design bundle", description: "Editable design assets with documented usage rights.", version: 1, classCode: "DIGITAL_ASSET",
  price: { valueMinor: 1000, currency: "USD" }, rightsEvidenceDigest: lemonDigest("rights") as string | null, fulfillmentOffer: offer, deliverableDigests: [offer.portfolio[0]!.artifactDigest], taxNotes: "Owner must verify the product tax category.", updatePolicy: "Documented minor updates.", refundPolicyDigest: lemonDigest("refund-policy") }; }
export function lemonCheckoutDraft() { return { schemaVersion: "1", kind: "CHECKOUT_PLAN", storeRef: "1", productRef: "10", variantRef: "20", priceRef: "25", price: { valueMinor: 1000, currency: "USD" },
  sourceReadDigests: [lemonDigest("product"), lemonDigest("variant"), lemonDigest("price")], fulfillmentDigest: lemonDigest("fulfillment"), refundPolicyDigest: lemonDigest("refund"), commercialReviewDigest: null as string | null, renewalInterval: null as string | null, renewalCount: null as number | null }; }
export const lemonLicenseDraft = () => ({ schemaVersion: "1", kind: "LICENSE_DELIVERY_PLAN", fulfillment: revenueFulfillmentFixture(), licenseTermsDigest: lemonDigest("terms"), supportPolicyDigest: lemonDigest("support") });
export const LEMON_SYNTHETIC_SIGNING_SECRET = "local-fixture-signing-material";
export function lemonWebhook(event = "order_created", resource = lemonWire("orders", "30")) {
  const body = Buffer.from(JSON.stringify({ meta: { event_name: event, custom_data: { email: "buyer@example.test" } }, data: resource }));
  return { body, headers: { "X-Event-Name": event, "X-Signature": createHmac("sha256", LEMON_SYNTHETIC_SIGNING_SECRET).update(body).digest("hex") }, binding: { storeRef: "1", mode: "TEST" as const } };
}
