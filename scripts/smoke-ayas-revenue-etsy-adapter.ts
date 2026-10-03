/** Stage16.4:72 primary +12 frozen held-out. Etsy adapter over a fake official-shape transport; no network, account, credential or money. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAyasEtsyAdapter, ayasEtsyConnectionState, AYAS_ETSY_MANIFEST, type AyasEtsyTransportRequest } from "../src/lib/ayas/revenue/adapters/etsy/AyasEtsyAdapter";
import { ayasEtsyMoney, ayasEtsyRateLimit } from "../src/lib/ayas/revenue/adapters/etsy/AyasEtsySchemas";
import { mapAyasEtsyPaymentsToLedger } from "../src/lib/ayas/revenue/adapters/etsy/AyasEtsyMapper";
import { verifyAyasEtsyWebhook } from "../src/lib/ayas/revenue/adapters/etsy/AyasEtsyWebhook";
import { createAyasRevenuePlatformRegistry, runAyasRevenueReadOrDraft, planRevenueOperation, ayasRevenueProductionRegistry, AYAS_REVENUE_PRODUCTION_ADAPTERS } from "../src/lib/ayas/revenue/AyasRevenuePlatformRegistry";
import { inspectRevenueAdapter, isAyasRevenuePlatformAdapter } from "../src/lib/ayas/revenue/AyasRevenuePlatformAdapter";
import { createAyasRevenueLedgerEntry, emptyAyasRevenueLedger, planAyasRevenueLedgerAppend } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { ETSY_ACCOUNT_REF as ACCOUNT, ETSY_NOW as NOW, ETSY_SCOPES, ETSY_SHOP_ID as SHOP, ETSY_WEBHOOK_SECRET as SECRET, etsyAdjustment, etsyConnection, etsyEpoch, etsyFakeTransport,
  etsyListing, etsyPayment, etsyReceipt, etsyShop, etsySignWebhook, etsyWebhookBody, usd } from "./fixtures/ayas-revenue-etsy-fixture";
const selected = process.env.AYAS_REVENUE_ETSY_MUTATION_CASE;
if (selected !== undefined) { const cwd = fs.realpathSync.native(process.cwd()); assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-etsy-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(selected, /^[PH]\d{2}$/); }
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
type Setup = { connection?: unknown; observedScopes?: readonly string[] | null; listings?: number; receipts?: number; override?: (r: AyasEtsyTransportRequest) => unknown; now?: string };
function setup(o: Setup = {}) {
  const fake = etsyFakeTransport({ listings: o.listings, receipts: o.receipts, override: o.override });
  const adapter = createAyasEtsyAdapter({ transport: fake.transport, shopId: SHOP, accountRef: ACCOUNT, connection: Object.hasOwn(o, "connection") ? o.connection : etsyConnection(),
    observedScopes: Object.hasOwn(o, "observedScopes") ? o.observedScopes! : ETSY_SCOPES, now: () => o.now ?? NOW });
  return { fake, adapter, registry: createAyasRevenuePlatformRegistry([adapter]) };
}
let n = 0;
const req = (operation: string, extra: Record<string, unknown> = {}) => ({ requestId: `etsy-req-${String(++n).padStart(4, "0")}`, platform: "etsy", operation,
  mode: operation === "LISTING_DRAFT" ? "DRAFT" : ["LISTING_CREATE", "LISTING_UPDATE", "REFUND", "FUNDS_WITHDRAW", "PURCHASE"].includes(operation) ? "EXECUTE" : "READ", accountRef: ACCOUNT, requestedAt: NOW, ...extra });
async function go(s: ReturnType<typeof setup>, request: Record<string, unknown>) { return runAyasRevenueReadOrDraft(s.registry, request, { now: () => NOW }); }
const data = (r: Awaited<ReturnType<typeof go>>) => r.result!.data as Record<string, unknown> & { items: Record<string, unknown>[]; item: Record<string, unknown> };
const draftPayload = (o: Record<string, unknown> = {}) => ({ title: "Printable city map", description: "A high resolution printable map in three sizes.", tags: ["map", "printable"], taxonomyId: 2078,
  price: { valueMinor: 1200, currency: "USD" }, quantity: 999, listingType: "download", mediaDigests: ["a".repeat(64)], rightsEvidenceDigest: "b".repeat(64), offerRevision: "c".repeat(64), ...o });
const hook = (o: { id?: string; ts?: number; body?: string; signature?: string; headers?: Record<string, string>; seen?: string[]; now?: string; secret?: string } = {}) => {
  const id = o.id ?? "msg_2kqF1", ts = o.ts ?? etsyEpoch(NOW), body = o.body ?? etsyWebhookBody();
  return verifyAyasEtsyWebhook({ headers: o.headers ?? { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": o.signature ?? etsySignWebhook(id, ts, body) },
    rawBody: body, signingSecret: o.secret ?? SECRET, expectedShopId: SHOP, now: o.now ?? NOW, seenDeliveryIds: new Set(o.seen ?? []) });
};
const PII = ["buyer@example.test", "seller@example.test", "pay@example.test", "Jane", "Test Street", "Testville", "12345\"", "555-0100", "birthday", "TRACK123", "https://"];
const noPii = (v: unknown) => { const s = JSON.stringify(v); for (const p of PII) assert.ok(!s.includes(p), `leaked ${p}`); };
async function paymentsRead(payment: Record<string, unknown> = {}) {
  const s = setup({ override: (r) => r.path.endsWith("/payments") ? { status: 200, headers: {}, body: { count: 1, results: [etsyPayment(1, payment)] } } : undefined });
  return go(s, req("PAYOUT_LIST_READ", { payload: { kind: "RECEIPT_PAYMENTS", receiptId: "700001" } }));
}
async function run(set: "primary" | "held-out", id: string, name: string, body: () => Promise<void> | void) { if (selected !== undefined && selected !== id) return;
  if (selected !== undefined) { await body(); results.push({ id, set, ok: true }); return; }
  try { await body(); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
}
const p = (id: string, name: string, body: () => Promise<void> | void) => run("primary", id, name, body);
const h = (id: string, name: string, body: () => Promise<void> | void) => run("held-out", id, name, body);
async function main() {
  await p("P01", "manifest is a read and local-draft adapter under the 16.0 standard", () => { const s = setup(); assert.ok(isAyasRevenuePlatformAdapter(s.adapter)); const i = inspectRevenueAdapter(s.adapter);
    assert.equal(i.valid, true); assert.deepEqual(i.operations.EXTERNAL_WRITE, []); assert.deepEqual(i.operations.FINANCIAL_COMMITMENT, []); assert.deepEqual(i.operations.LOCAL_DRAFT, ["LISTING_DRAFT"]);
    assert.equal(AYAS_ETSY_MANIFEST.transport, "OFFICIAL_API"); assert.equal(AYAS_ETSY_MANIFEST.credentialHandling, "CONNECTOR_MANAGED"); assert.equal(i.cost, "AYAS_ZERO_COST_ALLOWED_FREE_PUBLIC"); });
  await p("P02", "production registry stays empty", () => { assert.equal(AYAS_REVENUE_PRODUCTION_ADAPTERS.length, 0); assert.equal(planRevenueOperation(ayasRevenueProductionRegistry(), req("LISTING_LIST_READ")).reason, "ADAPTER_NOT_REGISTERED"); });
  await p("P03", "account read through the standard reports a read-only connection", async () => { const s = setup(); const r = await go(s, req("ACCOUNT_STATUS_READ"));
    assert.equal(r.result!.status, "OK"); assert.deepEqual({ ...data(r), rateLimit: null }, { kind: "ACCOUNT", shopRef: SHOP, connectionState: "CONNECTED_READ_ONLY", rateLimit: null });
    assert.deepEqual(s.fake.calls, [{ method: "GET", host: "openapi.etsy.com", path: "/v3/application/users/me", query: {} }]); });
  await p("P04", "a token for another shop is refused", async () => { const s = setup({ override: (r) => r.path.endsWith("/me") ? { status: 200, headers: {}, body: { user_id: 1, shop_id: 99 } } : undefined });
    assert.equal((await go(s, req("ACCOUNT_STATUS_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_SHOP_MISMATCH"); });
  await p("P05", "no connection means no call", async () => { const s = setup({ connection: null }); const r = await go(s, req("LISTING_LIST_READ")); assert.equal(r.result!.status, "BLOCKED");
    assert.equal(s.fake.calls.length, 0); assert.equal(ayasEtsyConnectionState(null, ETSY_SCOPES, NOW), "UNCONFIGURED"); });
  await p("P06", "missing scope blocks before any call", async () => { const c = etsyConnection({ grantedScopes: ["listings_r", "shops_r"] }); const s = setup({ connection: c, observedScopes: ["listings_r", "shops_r"] });
    assert.equal((await go(s, req("ORDER_LIST_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_CONNECTION_NOT_USABLE"); assert.equal(s.fake.calls.length, 0); assert.equal(ayasEtsyConnectionState(c, ["listings_r", "shops_r"], NOW), "ERROR"); });
  await p("P07", "revoked connection blocks", async () => { const c = etsyConnection({ reauthRequired: true }); const s = setup({ connection: c }); assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "BLOCKED");
    assert.equal(s.fake.calls.length, 0); assert.equal(ayasEtsyConnectionState(c, ETSY_SCOPES, NOW), "REVOKED"); });
  await p("P08", "expired connection blocks", async () => { const c = etsyConnection({ expiresAt: "2026-10-02T12:00:00.000Z" }); const s = setup({ connection: c }); assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "BLOCKED");
    assert.equal(ayasEtsyConnectionState(c, ETSY_SCOPES, NOW), "EXPIRED"); });
  await p("P09", "a write-scoped token is reported and still blocked", async () => { const scopes = [...ETSY_SCOPES, "listings_w"], c = etsyConnection({ grantedScopes: scopes }); const s = setup({ connection: c, observedScopes: scopes });
    assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "BLOCKED"); assert.equal(s.fake.calls.length, 0); assert.equal(ayasEtsyConnectionState(c, scopes, NOW), "CONNECTED_WRITE_SCOPED"); });
  await p("P10", "scope drift blocks", async () => { const s = setup({ observedScopes: ["listings_r", "shops_r"] }); assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "BLOCKED"); assert.equal(s.fake.calls.length, 0); });
  await p("P11", "an unverified connection blocks", async () => { const s = setup({ observedScopes: null }); assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "BLOCKED"); });
  await p("P12", "a request for another account blocks", async () => { const s = setup(); const r = await go(s, req("LISTING_LIST_READ", { accountRef: "etsy-shop-other" })); assert.equal(r.result!.status, "BLOCKED"); assert.equal(s.fake.calls.length, 0); });
  await p("P13", "401 and 403 fail closed", async () => { for (const [status, code] of [[401, "AUTH_REFUSED"], [403, "SCOPE_REFUSED"]] as const) {
    const s = setup({ override: () => ({ status, headers: {}, body: { error: "invalid_token" } }) }); const r = await go(s, req("LISTING_LIST_READ")); assert.equal(r.result!.status, "BLOCKED"); assert.equal(r.result!.errorCode, `AYAS_REVENUE_ETSY_${code}`); } });
  await p("P14", "listing page is normalized without urls or descriptions", async () => { const s = setup(); const r = await go(s, req("LISTING_LIST_READ", { limit: 2 }));
    assert.equal(r.result!.status, "OK"); assert.deepEqual(s.fake.calls[0]!.query, { state: "active", limit: "2", offset: "0" }); const d = data(r); assert.equal(d.items.length, 2);
    assert.deepEqual(d.items[0], { listingRef: "900001", state: "active", title: "Printable map 1", quantity: 99, price: { valueMinor: 1200, currency: "USD" }, listingType: "download", taxonomyId: 2078, tagCount: 2,
      createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-20T10:00:00.000Z" }); noPii(d); assert.deepEqual(d.page, { offset: 0, limit: 2, count: 5 }); assert.equal(r.result!.nextCursor, "etsy:LISTING_LIST_READ:o2"); });
  await p("P15", "pagination follows the bound cursor to the last page", async () => { const s = setup(); const second = await go(s, req("LISTING_LIST_READ", { limit: 2, cursor: "etsy:LISTING_LIST_READ:o2" }));
    assert.equal(s.fake.calls[0]!.query.offset, "2"); assert.equal(second.result!.nextCursor, "etsy:LISTING_LIST_READ:o4"); const last = await go(s, req("LISTING_LIST_READ", { limit: 2, cursor: second.result!.nextCursor }));
    assert.equal(data(last).items.length, 1); assert.equal(last.result!.nextCursor, null); });
  await p("P16", "listing state filter is a closed set", async () => { const s = setup(); await go(s, req("LISTING_LIST_READ", { payload: { state: "draft" } })); assert.equal(s.fake.calls[0]!.query.state, "draft");
    for (const payload of [{ state: "removed" }, { state: "active", path: "/v3/x" }, { state: "ACTIVE" }]) assert.equal((await go(s, req("LISTING_LIST_READ", { payload }))).result!.errorCode, "AYAS_REVENUE_ETSY_PAYLOAD_INVALID");
    assert.equal(s.fake.calls.length, 1); });
  await p("P17", "cursors are bound to their operation and shape", async () => { const s = setup(); assert.equal(planRevenueOperation(s.registry, req("LISTING_LIST_READ", { cursor: "etsy:ORDER_LIST_READ:o2" })).reason, "CURSOR_SCOPE_MISMATCH");
    assert.equal((await go(s, req("LISTING_LIST_READ", { cursor: "etsy:LISTING_LIST_READ:zz" }))).result!.errorCode, "AYAS_REVENUE_ETSY_CURSOR_INVALID"); assert.equal(s.fake.calls.length, 0); });
  await p("P18", "page size and depth are bounded", async () => { const s = setup(); assert.equal(planRevenueOperation(s.registry, req("LISTING_LIST_READ", { limit: 101 })).reason, "REQUEST_INVALID");
    assert.equal((await go(s, req("LISTING_LIST_READ", { cursor: "etsy:LISTING_LIST_READ:o10001" }))).result!.errorCode, "AYAS_REVENUE_ETSY_PAGE_BOUND");
    const capped = setup({ listings: 20_000 }); const r = await go(capped, req("LISTING_LIST_READ", { limit: 100, cursor: "etsy:LISTING_LIST_READ:o9900" })); assert.equal(r.result!.nextCursor, "etsy:LISTING_LIST_READ:o10000");
    const end = await go(capped, req("LISTING_LIST_READ", { limit: 100, cursor: r.result!.nextCursor })); assert.equal(end.result!.nextCursor, null); });
  await p("P19", "an empty page is EMPTY", async () => { const s = setup({ listings: 0 }); assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.status, "EMPTY"); });
  await p("P20", "receipts drop every buyer and seller personal field", async () => { const s = setup(); const r = await go(s, req("ORDER_LIST_READ")); assert.equal(r.result!.status, "OK"); const d = data(r);
    noPii(d); assert.deepEqual(Object.keys(d.items[0]!).sort(), ["createdAt", "discount", "giftWrap", "grandTotal", "isPaid", "isShipped", "receiptRef", "refundCount", "salesTax", "shipping", "status", "subtotal", "transactionCount", "updatedAt", "vat"]); });
  await p("P21", "order pagination", async () => { const s = setup({ receipts: 3 }); const a = await go(s, req("ORDER_LIST_READ", { limit: 2 })); assert.equal(a.result!.nextCursor, "etsy:ORDER_LIST_READ:o2");
    const b = await go(s, req("ORDER_LIST_READ", { limit: 2, cursor: a.result!.nextCursor })); assert.equal(data(b).items.length, 1); assert.equal(b.result!.nextCursor, null); });
  await p("P22", "a single receipt read is bound to the requested receipt", async () => { const s = setup(); const r = await go(s, req("ORDER_LIST_READ", { payload: { receiptId: "700001" } }));
    assert.equal(s.fake.calls[0]!.path, `/v3/application/shops/${SHOP}/receipts/700001`); assert.equal(data(r).item.receiptRef, "700001");
    const wrong = setup({ override: (q) => q.path.endsWith("/receipts/700001") ? { status: 200, headers: {}, body: etsyReceipt(2) } : undefined });
    assert.equal((await go(wrong, req("ORDER_LIST_READ", { payload: { receiptId: "700001" } }))).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID"); });
  await p("P23", "money converts only when exact", () => { assert.deepEqual(ayasEtsyMoney(usd(1380)), { valueMinor: 1380, currency: "USD" }); assert.equal(ayasEtsyMoney(usd(100, 3)), null);
    assert.equal(ayasEtsyMoney(usd(100, 100, "XAU")), null); assert.equal(ayasEtsyMoney(usd(-1)), null); assert.equal(ayasEtsyMoney(usd(100, 0)), null); assert.equal(ayasEtsyMoney({ amount: 1.5, divisor: 100, currency_code: "USD" }), null); });
  await p("P24", "currency exponents are applied", () => { assert.deepEqual(ayasEtsyMoney(usd(1500, 1, "JPY")), { valueMinor: 1500, currency: "JPY" }); assert.deepEqual(ayasEtsyMoney(usd(12340, 1000)), { valueMinor: 1234, currency: "USD" });
    assert.equal(ayasEtsyMoney(usd(12345, 1000)), null); assert.equal(ayasEtsyMoney(usd(150, 100, "JPY")), null); });
  await p("P25", "receipt payments are normalized without buyer ids", async () => { const r = await paymentsRead(); const d = data(r); assert.equal(d.kind, "RECEIPT_PAYMENTS");
    assert.deepEqual(d.items[0], { paymentRef: "800001", receiptRef: "700001", currency: "USD", status: "settled", createdAt: "2026-10-02T09:01:00.000Z", gross: { valueMinor: 1380, currency: "USD" },
      fees: { valueMinor: 66, currency: "USD" }, net: { valueMinor: 1314, currency: "USD" }, adjustments: [] }); assert.ok(!JSON.stringify(d).includes("4242"));
    const other = setup({ override: (q) => q.path.endsWith("/payments") ? { status: 200, headers: {}, body: { count: 1, results: [etsyPayment(2)] } } : undefined });
    assert.equal((await go(other, req("PAYOUT_LIST_READ", { payload: { kind: "RECEIPT_PAYMENTS", receiptId: "700001" } }))).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID"); });
  await p("P26", "ledger windows are required and bounded", async () => { const s = setup(); const min = etsyEpoch("2026-10-01T00:00:00.000Z");
    await go(s, req("PAYOUT_LIST_READ", { payload: { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 86_400 } })); assert.deepEqual(s.fake.calls[0]!.query, { min_created: String(min), max_created: String(min + 86_400), limit: "25", offset: "0" });
    for (const payload of [{ kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 40 * 86_400 }, { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min }, { minCreated: min, maxCreated: min + 1 }, null])
      assert.equal((await go(s, req("PAYOUT_LIST_READ", payload === null ? {} : { payload }))).result!.errorCode, "AYAS_REVENUE_ETSY_PAYLOAD_INVALID"); assert.equal(s.fake.calls.length, 1); });
  await p("P27", "ledger entries are observed but never treated as verified money", async () => { const s = setup(); const min = etsyEpoch("2026-10-01T00:00:00.000Z");
    const d = data(await go(s, req("PAYOUT_LIST_READ", { payload: { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 86_400 } })));
    assert.deepEqual(d.items[0], { entryRef: "500001", ledgerRef: "4400", amount: 1314, currency: "USD", unitsVerified: false, createdAt: "2026-10-02T09:02:00.000Z", ledgerType: "Payment", referenceType: "receipt", referenceRef: "700001" }); });
  await p("P28", "shop analytics come from official counters only", async () => { const s = setup(); const d = data(await go(s, req("ANALYTICS_READ")));
    assert.deepEqual(d.item, { shopRef: SHOP, currency: "USD", activeListings: 5, digitalListings: 5, soldTransactions: 12, reviewCount: 4, reviewAverage: 4.75, onVacation: false }); noPii(d);
    const other = setup({ override: (r) => r.path === `/v3/application/shops/${SHOP}` ? { status: 200, headers: {}, body: etsyShop({ shop_id: 99 }) } : undefined });
    assert.equal((await go(other, req("ANALYTICS_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_SHOP_MISMATCH"); });
  await p("P29", "rate limiting is reported once, never retried", async () => { const s = setup({ override: () => ({ status: 429, headers: { "retry-after": "2" }, body: {} }) }); const r = await go(s, req("LISTING_LIST_READ"));
    assert.equal(r.result!.status, "UNAVAILABLE"); assert.equal(r.result!.errorCode, "AYAS_REVENUE_ETSY_RATE_LIMITED"); assert.equal(s.fake.calls.length, 1); });
  await p("P30", "rate-limit headers: both documented spellings, any case; malformed is unknown", async () => { assert.deepEqual(ayasEtsyRateLimit({ "x-limit-per-second": "150", "x-remaining-this-secon": "7", "x-limit-per-day": "100000", "x-remaining-today": "5" }),
    { limitPerSecond: 150, remainingThisSecond: 7, limitPerDay: 100000, remainingToday: 5 }); assert.deepEqual(ayasEtsyRateLimit({ "x-limit-per-second": "-1", "x-remaining-today": "1e3" }), { limitPerSecond: null, remainingThisSecond: null, limitPerDay: null, remainingToday: null });
    const d = data(await go(setup(), req("LISTING_LIST_READ"))); assert.deepEqual(d.rateLimit, { limitPerSecond: 150, remainingThisSecond: 149, limitPerDay: 100000, remainingToday: 99998 }); });
  await p("P31", "upstream and request errors are classified", async () => { for (const [status, st, code] of [[503, "UNAVAILABLE", "UPSTREAM_UNAVAILABLE"], [400, "ERROR", "REQUEST_REJECTED"], [404, "ERROR", "NOT_FOUND"], [302, "ERROR", "REQUEST_REJECTED"]] as const) {
    const r = await go(setup({ override: () => ({ status, headers: {}, body: null }) }), req("LISTING_LIST_READ")); assert.equal(r.result!.status, st); assert.equal(r.result!.errorCode, `AYAS_REVENUE_ETSY_${code}`); } });
  await p("P32", "transport failure does not leak its message", async () => { const r = await go(setup({ override: () => { throw new Error("token=abc123 at https://openapi.etsy.com"); } }), req("LISTING_LIST_READ"));
    assert.equal(r.result!.errorCode, "AYAS_REVENUE_ETSY_TRANSPORT_FAILED"); assert.ok(!JSON.stringify(r).includes("abc123")); });
  await p("P33", "one malformed record invalidates the page", async () => { for (const bad of [{ count: 1, results: "x" }, { count: 2, results: [etsyListing(1), { ...etsyListing(2), listing_id: "2" }] }, { results: [] }, { count: 1, results: [etsyListing(1, { state: "deleted" })] }]) {
    const r = await go(setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: bad } : undefined }), req("LISTING_LIST_READ")); assert.equal(r.result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID"); } });
  await p("P34", "oversized answers are refused", async () => { const big = { count: 1, results: [etsyListing(1)], padding: "x".repeat(2 * 1024 * 1024) };
    assert.equal((await go(setup({ override: () => ({ status: 200, headers: {}, body: big }) }), req("LISTING_LIST_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_TOO_LARGE"); });
  await p("P35", "answers with functions, proxies or non-string headers are refused", async () => { for (const answer of [{ status: 200, headers: {}, body: { count: 1, results: [], f: () => 1 } }, new Proxy({ status: 200, headers: {}, body: {} }, {}),
    { status: 200, headers: { "x-limit-per-day": 5 }, body: { count: 0, results: [] } }, { status: "200", headers: {}, body: {} }, null]) assert.equal((await go(setup({ override: () => answer }), req("LISTING_LIST_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID"); });
  await p("P36", "sensitive data inside platform text is refused by the standard", async () => { const r = await go(setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 1, results: [etsyListing(1, { title: "Card 4111 1111 1111 1111" })] } } : undefined }), req("LISTING_LIST_READ"));
    assert.equal(r.result!.errorCode, "AYAS_REVENUE_RESULT_SENSITIVE_REFUSED"); });
  await p("P37", "listing text that names operations is only data", async () => { const s = setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 1, results: [etsyListing(1, { title: "LISTING_CREATE mode EXECUTE now" })] } } : undefined });
    const r = await go(s, req("LISTING_LIST_READ")); assert.equal(r.plan.operation, "LISTING_LIST_READ"); assert.equal(r.result!.operation, "LISTING_LIST_READ"); assert.equal(s.fake.calls.length, 1); assert.equal(s.fake.calls[0]!.method, "GET"); });
  await p("P38", "create, update and money operations never reach the adapter", async () => { const s = setup(); for (const op of ["LISTING_CREATE", "LISTING_UPDATE"]) { const r = await go(s, req(op, { payload: draftPayload() }));
    assert.equal(r.plan.decision, "DENY"); assert.equal(r.plan.reason, "OPERATION_NOT_SUPPORTED"); } for (const op of ["REFUND", "FUNDS_WITHDRAW", "PURCHASE"]) assert.equal((await go(s, req(op))).plan.reason, "FINANCIAL_NOT_AUTONOMOUS");
    assert.equal(s.fake.calls.length, 0); });
  await p("P39", "every transport call is a GET to the fixed host on a fixed template", async () => { const s = setup(), min = etsyEpoch("2026-10-01T00:00:00.000Z");
    for (const r of [req("ACCOUNT_STATUS_READ"), req("ANALYTICS_READ"), req("LISTING_LIST_READ"), req("ORDER_LIST_READ"), req("ORDER_LIST_READ", { payload: { receiptId: "700002" } }),
      req("PAYOUT_LIST_READ", { payload: { kind: "RECEIPT_PAYMENTS", receiptId: "700002" } }), req("PAYOUT_LIST_READ", { payload: { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 60 } })]) await go(s, r);
    assert.equal(s.fake.calls.length, 7); for (const c of s.fake.calls) { assert.equal(c.method, "GET"); assert.equal(c.host, "openapi.etsy.com");
      assert.match(c.path, /^\/v3\/application\/(?:users\/me|shops\/12345678(?:\/listings|\/receipts(?:\/\d+(?:\/payments)?)?|\/payment-account\/ledger-entries)?)$/); assert.ok(Object.isFrozen(c) && Object.isFrozen(c.query)); } });
  await p("P40", "hostile ids never reach a path", async () => { const s = setup(); for (const receiptId of ["../1", "1/../../x", "https://evil.test/1", 700001, "01", "700001?x=1", ""]) {
    assert.equal((await go(s, req("ORDER_LIST_READ", { payload: { receiptId } }))).result!.errorCode, "AYAS_REVENUE_ETSY_PAYLOAD_INVALID"); }
    for (const [op, payload] of [["ORDER_LIST_READ", { receiptId: "700001", host: "evil.test" }], ["PAYOUT_LIST_READ", { kind: "RECEIPT_PAYMENTS", receiptId: "700001", path: "/v3/x" }]] as const)
      assert.equal((await go(s, req(op, { payload }))).result!.errorCode, "AYAS_REVENUE_ETSY_PAYLOAD_INVALID"); assert.equal(s.fake.calls.length, 0); });
  await p("P41", "adapter construction validates its inputs", () => { const t = etsyFakeTransport().transport; for (const o of [{ transport: t, shopId: "0", accountRef: ACCOUNT }, { transport: t, shopId: "../1", accountRef: ACCOUNT },
    { transport: "fetch", shopId: SHOP, accountRef: ACCOUNT }, { transport: t, shopId: SHOP, accountRef: "a/b" }]) assert.throws(() => createAyasEtsyAdapter({ connection: null, observedScopes: null, ...o } as never), /AYAS_ETSY_ADAPTER_INVALID/); });
  await p("P42", "direct calls with the wrong mode or platform are refused", async () => { const s = setup(); for (const r of [req("LISTING_LIST_READ", { mode: "EXECUTE" }), req("LISTING_LIST_READ", { platform: "upwork" }), req("LISTING_DRAFT", { mode: "READ" })]) {
    const answer = await s.adapter.read(r as never) as Record<string, unknown>; assert.equal(answer.refused, "AYAS_REVENUE_ETSY_REQUEST_INVALID"); }
    assert.equal(((await s.adapter.draft(req("LISTING_LIST_READ") as never)) as Record<string, unknown>).refused, "AYAS_REVENUE_ETSY_REQUEST_INVALID"); assert.equal(s.fake.calls.length, 0); });
  await p("P43", "local listing draft is hash-bound and publication stays closed", async () => { const s = setup(); const r = await go(s, req("LISTING_DRAFT", { payload: draftPayload() })); const d = data(r);
    assert.equal(r.result!.status, "OK"); assert.equal(d.local, true); assert.match(d.draftDigest as string, /^[a-f0-9]{64}$/); assert.equal(d.publication, "CLOSED"); assert.deepEqual(d.issues, []);
    for (const step of ["OWNER_APPROVAL", "SPEND_GATE_FEE_REVIEW", "IDEMPOTENT_CREATE", "READ_BACK_BEFORE_LOCAL_STATE", "CONNECTION_REPROBE"]) assert.ok((d.publicationRequires as string[]).includes(step)); assert.equal(s.fake.calls.length, 0); });
  await p("P44", "missing proofs are listed as issues", async () => { const d = data(await go(setup(), req("LISTING_DRAFT", { payload: draftPayload({ mediaDigests: [], rightsEvidenceDigest: null, offerRevision: null }) })));
    assert.deepEqual(d.issues, ["MEDIA_MISSING", "RIGHTS_EVIDENCE_MISSING", "OFFER_REVISION_MISSING"]); });
  await p("P45", "draft refuses links, contact details, bad tags, bad price and extra fields", async () => { const s = setup(); const mail = draftPayload({ description: "Mail me at x@example.test" });
    const viaStandard = await go(s, req("LISTING_DRAFT", { payload: mail })); assert.equal(viaStandard.plan.reason, "REQUEST_INVALID"); assert.equal(viaStandard.result, null);
    assert.equal(((await s.adapter.draft(req("LISTING_DRAFT", { payload: mail }) as never)) as { refused: string }).refused, "AYAS_REVENUE_ETSY_REQUEST_INVALID");
    for (const o of [{ description: "See www.example.test" }, { title: "Buy at https://shop.test" }, { description: "Order at mapstudio.shop" },
    { tags: Array.from({ length: 14 }, (_, i) => `t${i}`) }, { tags: ["map", "Map"] }, { tags: ["a".repeat(21)] }, { title: "x".repeat(141) }, { price: { valueMinor: 0, currency: "USD" } }, { price: { valueMinor: 100, currency: "XAU" } },
    { quantity: 1000 }, { listingType: "service" }, { mediaDigests: ["not-a-digest"] }, { publish: true }, { shopUrl: "x" }]) assert.equal((await go(s, req("LISTING_DRAFT", { payload: draftPayload(o) }))).result!.errorCode, "AYAS_REVENUE_ETSY_DRAFT_INVALID", JSON.stringify(o)); });
  await p("P46", "same draft, same digest; changed price, new digest", async () => { const s = setup(); const a = data(await go(s, req("LISTING_DRAFT", { payload: draftPayload() })));
    const reordered = Object.fromEntries(Object.entries(draftPayload()).reverse()); const b = data(await go(s, req("LISTING_DRAFT", { payload: reordered }))); assert.equal(a.draftDigest, b.draftDigest);
    const c = data(await go(s, req("LISTING_DRAFT", { payload: draftPayload({ price: { valueMinor: 1300, currency: "USD" } }) }))); assert.notEqual(a.draftDigest, c.draftDigest); });
  await p("P47", "a draft needs no connection", async () => { const s = setup({ connection: null }); assert.equal((await go(s, req("LISTING_DRAFT", { payload: draftPayload() }))).result!.status, "OK"); });
  await p("P48", "a verified webhook is a pointer that names canonical reads", () => { const r = hook(); assert.equal(r.status, "VERIFIED_POINTER"); assert.deepEqual(r.pointer, { eventType: "order.paid", shopRef: SHOP, receiptRef: "700001" });
    assert.deepEqual(r.canonicalReads, [{ operation: "ORDER_LIST_READ", payload: { receiptId: "700001" } }, { operation: "PAYOUT_LIST_READ", payload: { kind: "RECEIPT_PAYMENTS", receiptId: "700001" } }]);
    assert.equal(r.writesLedger, false); assert.equal(r.keepsRawBody, false); const s = JSON.stringify(r); assert.ok(!s.includes("resource_url") && !s.includes("whsec_") && !s.includes(SECRET.slice(6, 20))); });
  await p("P49", "bad, tampered or wrong-key signatures are rejected", () => { assert.equal(hook({ signature: Buffer.alloc(32).toString("base64") }).reason, "SIGNATURE_INVALID");
    const ts = etsyEpoch(NOW), body = etsyWebhookBody(); assert.equal(hook({ body: etsyWebhookBody({ event_type: "order.canceled" }), signature: etsySignWebhook("msg_2kqF1", ts, body) }).reason, "SIGNATURE_INVALID");
    assert.equal(hook({ secret: `whsec_${Buffer.from("another-signing-key-of-32-bytes!").toString("base64")}` }).reason, "SIGNATURE_INVALID"); assert.equal(hook({ secret: "not-a-secret" }).reason, "SIGNATURE_INVALID"); });
  await p("P50", "timestamps outside five minutes are rejected", () => { assert.equal(hook({ ts: etsyEpoch(NOW) - 301 }).reason, "TIMESTAMP_OUTSIDE_WINDOW"); assert.equal(hook({ ts: etsyEpoch(NOW) + 301 }).reason, "TIMESTAMP_OUTSIDE_WINDOW");
    assert.equal(hook({ ts: etsyEpoch(NOW) - 300 }).status, "VERIFIED_POINTER"); });
  await p("P51", "a repeated delivery id is a duplicate without a pointer", () => { const r = hook({ seen: ["msg_2kqF1"] }); assert.equal(r.status, "DUPLICATE"); assert.equal(r.pointer, null); assert.deepEqual(r.canonicalReads, []); });
  await p("P52", "unknown events are rejected", () => { for (const event_type of ["order.refunded", "listing.updated", "ORDER.PAID"]) assert.equal(hook({ body: etsyWebhookBody({ event_type }) }).reason, "UNKNOWN_EVENT"); });
  await p("P53", "hostile resource urls are rejected", () => { for (const resource_url of [`https://evil.test/v3/application/shops/${SHOP}/receipts/1`, `http://api.etsy.com/v3/application/shops/${SHOP}/receipts/1`,
    `https://api.etsy.com:8443/v3/application/shops/${SHOP}/receipts/1`, `https://api.etsy.com/v3/application/shops/${SHOP}/receipts/1?redirect=x`, `https://api.etsy.com/v3/application/shops/${SHOP}/receipts/../listings`,
    "https://api.etsy.com/v3/application/shops/999/receipts/1", `https://user:pw@api.etsy.com/v3/application/shops/${SHOP}/receipts/1`, `https://api.etsy.com/v3/application/shops/${SHOP}/listings/1`, "not a url", 5])
    assert.equal(hook({ body: etsyWebhookBody({ resource_url }) }).status, "REJECTED", String(resource_url)); });
  await p("P54", "a webhook for another shop is rejected", () => { assert.equal(hook({ body: etsyWebhookBody({ shop_id: 99 }) }).reason, "SHOP_MISMATCH"); });
  await p("P55", "versioned and multiple signatures are accepted when one matches", () => { const ts = etsyEpoch(NOW), body = etsyWebhookBody(), good = etsySignWebhook("msg_2kqF1", ts, body);
    assert.equal(hook({ signature: `v1,${good}` }).status, "VERIFIED_POINTER"); assert.equal(hook({ signature: `v1,${Buffer.alloc(32).toString("base64")} v1,${good}` }).status, "VERIFIED_POINTER"); });
  await p("P56", "missing, malformed or duplicated headers are rejected", () => { const ts = String(etsyEpoch(NOW)), body = etsyWebhookBody(), sig = etsySignWebhook("msg_2kqF1", etsyEpoch(NOW), body);
    for (const headers of <Record<string, string>[]>[{ "webhook-id": "msg_2kqF1", "webhook-timestamp": ts }, { "webhook-id": "msg/../1", "webhook-timestamp": ts, "webhook-signature": sig }, { "webhook-id": "msg_2kqF1", "webhook-timestamp": "1.5", "webhook-signature": sig },
      { "webhook-id": "msg_2kqF1", "Webhook-Id": "msg_other", "webhook-timestamp": ts, "webhook-signature": sig }]) assert.equal(hook({ headers }).reason, "MISSING_OR_MALFORMED_HEADERS"); });
  await p("P57", "a canonical settled payment maps to valid ledger inputs", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead()).result); assert.deepEqual(m.inputs.map((i) => [i.event, i.amount.valueMinor]), [["GROSS_REVENUE", 1380], ["PAYMENT_PROCESSING_FEE", 66]]);
    for (const i of m.inputs) createAyasRevenueLedgerEntry(i, NOW); assert.ok(m.unknown.includes("PLATFORM_FEE_NOT_IN_PAYMENT:800001") && m.unknown.includes("PAYOUT_FROM_LEDGER_TYPES_UNVERIFIED")); assert.equal(m.writesLedger, false); });
  await p("P58", "a missing fee is unknown, never zero; an unsettled payment has no revenue", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead({ amount_fees: null })).result);
    assert.deepEqual(m.inputs.map((i) => i.event), ["GROSS_REVENUE"]); assert.ok(m.unknown.includes("PAYMENT_PROCESSING_FEE:800001")); const u = mapAyasEtsyPaymentsToLedger((await paymentsRead({ status: "authed" })).result);
    assert.ok(!u.inputs.some((i) => i.event === "GROSS_REVENUE")); assert.ok(u.unknown.includes("GROSS_REVENUE_NOT_SETTLED:800001")); });
  await p("P59", "only successful refunds in a two-decimal currency become refund entries", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead({ payment_adjustments: [etsyAdjustment(1), etsyAdjustment(2, { is_success: false })] })).result);
    assert.deepEqual(m.inputs.filter((i) => i.event === "REFUND").map((i) => i.amount.valueMinor), [500]); assert.ok(m.unknown.includes("PROCESSING_FEE_RETURNED:600001"));
    const jpy = mapAyasEtsyPaymentsToLedger((await paymentsRead({ currency: "JPY", amount_gross: usd(1380, 1, "JPY"), amount_fees: usd(66, 1, "JPY"), amount_net: usd(1314, 1, "JPY"), payment_adjustments: [etsyAdjustment(1)] })).result);
    assert.ok(!jpy.inputs.some((i) => i.event === "REFUND")); assert.ok(jpy.unknown.includes("REFUND:600001")); });
  await p("P60", "only a canonical payment read can be mapped", async () => { const ok = (await paymentsRead()).result!; const listing = (await go(setup(), req("LISTING_LIST_READ"))).result;
    for (const forged of [hook(), listing, { ...ok, status: "EMPTY" }, { ...ok, platform: "upwork" }, { ...ok, evidence: { ...ok.evidence, transport: "MANUAL_HANDOFF" } }, { ...ok, data: { ...(ok.data as object), kind: "LEDGER_ENTRIES" } }, null])
      assert.deepEqual(mapAyasEtsyPaymentsToLedger(forged).inputs, []); });
  await p("P61", "mapping is deterministic and replays idempotently in the ledger", async () => { const a = mapAyasEtsyPaymentsToLedger((await paymentsRead()).result), b = mapAyasEtsyPaymentsToLedger((await paymentsRead()).result);
    assert.deepEqual(a, b); const entry = createAyasRevenueLedgerEntry(a.inputs[0], NOW); const state = { ...emptyAyasRevenueLedger(), revision: 1, entries: [entry] };
    assert.equal(planAyasRevenueLedgerAppend(state, createAyasRevenueLedgerEntry(b.inputs[0], NOW)).kind, "REPLAY"); });
  await p("P62", "mapped entries carry digests only and bind the normalized payment", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead()).result); noPii(m); assert.ok(!JSON.stringify(m.inputs).includes("800001"));
    const changed = mapAyasEtsyPaymentsToLedger((await paymentsRead({ amount_fees: usd(67) })).result); assert.notEqual(m.inputs[0]!.evidence.evidenceDigest, changed.inputs[0]!.evidence.evidenceDigest); });
  await p("P63", "adapter files do no IO of their own and nothing outside revenue imports them", () => { const dir = "src/lib/ayas/revenue/adapters/etsy";
    for (const f of fs.readdirSync(dir)) { const s = fs.readFileSync(path.join(dir, f), "utf8");
      assert.doesNotMatch(s, /node:(?:fs|http|https|net|tls|child_process|dns)|(?<![.\w])fetch\s*\(|process\.env|XMLHttpRequest|WebSocket|puppeteer|playwright|scrap|require\(/i, f);
      for (const m of s.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) assert.ok(/^\.\.\/\.\.\/AyasRevenue[A-Za-z]+$|^\.\/AyasEtsy[A-Za-z]+$/.test(m[1]!) || (f === "AyasEtsyWebhook.ts" && m[1] === "node:crypto"), `${f} imports ${m[1]}`); }
    const outside: string[] = []; const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q);
      else if (/\.tsx?$/.test(e.name) && !q.replace(/\\/g, "/").includes("src/lib/ayas/revenue/") && /adapters\/etsy\/AyasEtsy/.test(fs.readFileSync(q, "utf8"))) outside.push(q); } };
    for (const root of ["src", "app"]) if (fs.existsSync(root)) walk(root); assert.deepEqual(outside, []); });
  await p("P64", "adapter, graders, fixture and document cannot rewrite themselves", () => { for (const f of ["src/lib/ayas/revenue/adapters/etsy/AyasEtsyAdapter.ts", "src/lib/ayas/revenue/adapters/etsy/AyasEtsyWebhook.ts",
    "scripts/smoke-ayas-revenue-etsy-adapter.ts", "scripts/smoke-ayas-revenue-etsy-adapter-mutations.ts", "scripts/fixtures/ayas-revenue-etsy-fixture.ts", "docs/AYAS_REVENUE_ETSY_ADAPTER.md"]) assert.equal(classifyPatchTarget(f).level, "FORBIDDEN_AUTONOMOUS", f); });
  await p("P65", "the adapter's own account binds reads even when the connection names another", async () => { const c = etsyConnection({ accountRef: "etsy-shop-other" }); const s = setup({ connection: c });
    const r = await go(s, req("LISTING_LIST_READ", { accountRef: "etsy-shop-other" })); assert.equal(r.result!.errorCode, "AYAS_REVENUE_ETSY_CONNECTION_ACCOUNT_MISMATCH"); assert.equal(s.fake.calls.length, 0); });
  await p("P66", "a page longer than requested is refused", async () => { const s = setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 3, results: [etsyListing(1), etsyListing(2), etsyListing(3)] } } : undefined });
    assert.equal((await go(s, req("LISTING_LIST_READ", { limit: 2 }))).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID"); });
  await p("P67", "a full last page has no next cursor", async () => { const s = setup({ listings: 4 }); const r = await go(s, req("LISTING_LIST_READ", { limit: 2, cursor: "etsy:LISTING_LIST_READ:o2" }));
    assert.equal(data(r).items.length, 2); assert.equal(r.result!.nextCursor, null); });
  // Frozen before the first run.
  await p("P68", "listing and payment facts must belong to the configured shop", async () => {
    for (const shop_id of [99, null]) {
      const s = setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 1, results: [etsyListing(1, { shop_id })] } } : undefined });
      assert.equal((await go(s, req("LISTING_LIST_READ"))).result!.errorCode, "AYAS_REVENUE_ETSY_SHOP_MISMATCH");
      assert.equal((await paymentsRead({ shop_id })).result!.errorCode, "AYAS_REVENUE_ETSY_SHOP_MISMATCH");
    }
  });
  await p("P69", "an adjustment from another payment is refused", async () => {
    assert.equal((await paymentsRead({ payment_adjustments: [etsyAdjustment(1, { payment_id: 800002 })] })).result!.errorCode, "AYAS_REVENUE_ETSY_RESPONSE_INVALID");
  });
  await p("P70", "ledger mapping rejects changed effects, currencies and out-of-bound money", async () => {
    const result = (await paymentsRead()).result!;
    for (const evidence of [{ ...result.evidence, monetaryMutation: true }, { ...result.evidence, monetaryMutation: undefined }])
      assert.deepEqual(mapAyasEtsyPaymentsToLedger({ ...result, evidence }).inputs, []);
    for (const gross of [{ valueMinor: 1380, currency: "EUR" }, { valueMinor: Number.MAX_SAFE_INTEGER, currency: "USD" }]) {
      const changed = structuredClone(result) as typeof result & { data: { items: { gross: unknown }[] } };
      changed.data.items[0]!.gross = gross;
      assert.deepEqual(mapAyasEtsyPaymentsToLedger(changed).inputs, []);
    }
  });
  await p("P71", "ledger mapping refuses nested accessors before they execute", async () => {
    const result = (await paymentsRead()).result!, changed = structuredClone(result) as typeof result & { data: { items: unknown[] } };
    const payment = changed.data.items[0]; let reads = 0;
    Object.defineProperty(changed.data.items, "0", { enumerable: true, get: () => { reads++; return payment; } });
    assert.deepEqual(mapAyasEtsyPaymentsToLedger(changed).inputs, []); assert.equal(reads, 0);
  });
  await p("P72", "oversized adjustment money stays unknown and never becomes a ledger input", async () => {
    const mapping = mapAyasEtsyPaymentsToLedger((await paymentsRead({ payment_adjustments: [etsyAdjustment(1, { total_adjustment_amount: Number.MAX_SAFE_INTEGER })] })).result);
    assert.ok(!mapping.inputs.some(i => i.event === "REFUND")); assert.ok(mapping.unknown.includes("REFUND:600001"));
    for (const input of mapping.inputs) createAyasRevenueLedgerEntry(input, NOW);
  });
  await h("H01", "GBP listing prices convert exactly", async () => { const s = setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 1, results: [etsyListing(1, { price: usd(2599, 100, "GBP") })] } } : undefined });
    assert.deepEqual(data(await go(s, req("LISTING_LIST_READ"))).items[0]!.price, { valueMinor: 2599, currency: "GBP" }); });
  await h("H02", "a partially refunded receipt keeps counts, not refund details", async () => { const s = setup({ override: (q) => q.path.endsWith("/receipts/700001") ? { status: 200, headers: {}, body: etsyReceipt(1, { status: "partially refunded", refunds: [{ amount: usd(500), note_from_issuer: "Sorry Jane" }] }) } : undefined });
    const d = data(await go(s, req("ORDER_LIST_READ", { payload: { receiptId: "700001" } }))); assert.equal(d.item.status, "partially refunded"); assert.equal(d.item.refundCount, 1); noPii(d); });
  await h("H03", "a 31-day ledger window is the limit", async () => { const s = setup(), min = etsyEpoch("2026-09-01T00:00:00.000Z");
    assert.equal((await go(s, req("PAYOUT_LIST_READ", { payload: { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 31 * 86_400 } }))).result!.status, "OK");
    assert.equal((await go(s, req("PAYOUT_LIST_READ", { payload: { kind: "LEDGER_ENTRIES", minCreated: min, maxCreated: min + 31 * 86_400 + 1 } }))).result!.status, "BLOCKED"); });
  await h("H04", "a cancellation webhook is a pointer too", () => { const body = etsyWebhookBody({ event_type: "order.canceled" }); const r = hook({ body }); assert.equal(r.status, "VERIFIED_POINTER"); assert.equal(r.pointer!.eventType, "order.canceled"); });
  await h("H05", "resource host lookalikes are rejected", () => { assert.equal(hook({ body: etsyWebhookBody({ resource_url: `https://openapi.etsy.com/v3/application/shops/${SHOP}/receipts/700009` }) }).pointer!.receiptRef, "700009");
    assert.equal(hook({ body: etsyWebhookBody({ resource_url: `https://api.etsy.com.evil.test/v3/application/shops/${SHOP}/receipts/1` }) }).status, "REJECTED"); });
  await h("H06", "a retry-after hint still produces one call", async () => { const s = setup({ override: () => ({ status: 429, headers: { "Retry-After": "0" }, body: null }) }); await go(s, req("ORDER_LIST_READ")); await go(s, req("ORDER_LIST_READ"));
    assert.equal(s.fake.calls.length, 2); });
  await h("H07", "a delete-scoped token is write-scoped and blocked", async () => { const scopes = [...ETSY_SCOPES, "listings_d"], c = etsyConnection({ grantedScopes: scopes }); const s = setup({ connection: c, observedScopes: scopes });
    assert.equal(ayasEtsyConnectionState(c, scopes, NOW), "CONNECTED_WRITE_SCOPED"); assert.equal((await go(s, req("ACCOUNT_STATUS_READ"))).result!.status, "BLOCKED"); });
  await h("H08", "a download listing draft with ten media items is fine", async () => { const media = Array.from({ length: 10 }, (_, i) => i.toString(16).padStart(64, "0"));
    const d = data(await go(setup(), req("LISTING_DRAFT", { payload: draftPayload({ listingType: "download", mediaDigests: media }) }))); assert.equal(d.publication, "CLOSED"); });
  await h("H09", "two adjustments, one failed, give one refund", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead({ payment_adjustments: [etsyAdjustment(3, { is_success: false }), etsyAdjustment(4, { total_adjustment_amount: 250 })] })).result);
    assert.deepEqual(m.inputs.filter((i) => i.event === "REFUND").map((i) => i.amount.valueMinor), [250]); });
  await h("H10", "an expiring connection still reads", async () => { const s = setup({ connection: etsyConnection({ expiresAt: "2026-10-05T12:00:00.000Z" }) }); assert.equal((await go(s, req("ACCOUNT_STATUS_READ"))).result!.status, "OK"); });
  await h("H11", "a gross amount in another currency than the payment is unknown", async () => { const m = mapAyasEtsyPaymentsToLedger((await paymentsRead({ currency: "EUR" })).result);
    assert.ok(!m.inputs.some((i) => i.event === "GROSS_REVENUE")); assert.ok(m.unknown.includes("GROSS_REVENUE:800001")); });
  await h("H12", "a link in a listing title is data and is never followed", async () => { const s = setup({ override: (q) => q.path.endsWith("/listings") ? { status: 200, headers: {}, body: { count: 1, results: [etsyListing(1, { title: "See https://evil.test/x" })] } } : undefined });
    const r = await go(s, req("LISTING_LIST_READ")); assert.equal(r.result!.status, "OK"); assert.equal(s.fake.calls.length, 1); assert.ok(s.fake.calls.every((c) => c.host === "openapi.etsy.com")); });
  if (selected === undefined) { assert.equal(results.filter((r) => r.set === "primary").length, 72); assert.equal(results.filter((r) => r.set === "held-out").length, 12); } else assert.equal(results.length, 1);
  console.log(JSON.stringify({ status: results.every((r) => r.ok) ? "PASS" : "FAIL", primary: { passed: results.filter((r) => r.set === "primary" && r.ok).length, total: results.filter((r) => r.set === "primary").length },
    heldOut: { passed: results.filter((r) => r.set === "held-out" && r.ok).length, total: results.filter((r) => r.set === "held-out").length }, authority: "NONE", results }, null, 2)); if (results.some((r) => !r.ok)) process.exitCode = 1;
}
void main();
