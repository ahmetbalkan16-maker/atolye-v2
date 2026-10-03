/**
 * Stage 16.4 — the Etsy revenue adapter under the Stage 16.0 standard: `{ manifest, read, draft }`.
 *
 * Reads go through an injected, connector-managed transport that holds the OAuth token and API key and attaches them;
 * this adapter only ever hands it `GET` + the fixed API host + a code-owned path + a bounded query. Before any read the
 * Stage 16.0A connection gate must pass with read scopes only. Etsy answers are normalized to neutral facts (no buyer
 * data, no raw payload); 429 is reported as rate limited and never retried here; 401/403 fail closed.
 * The listing draft is local: it validates and returns a hash-bound draft and never calls the transport.
 * Listing create/update and every money operation are not declared. The production registry stays empty until the owner
 * connects an account.
 */
import { AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueAdapterManifest, type AyasRevenueAdapterRequest, type AyasRevenueOperation } from "../../AyasRevenuePlatformTypes";
import type { AyasRevenuePlatformAdapter } from "../../AyasRevenuePlatformAdapter";
import { isAyasRevenueRequestShape } from "../../AyasRevenueActionPolicy";
import { gateAyasRevenueRequestConnection } from "../../AyasRevenueAccountConnection";
import { bindAyasRevenueCursor, containsAyasRevenueSensitiveData, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenueSensitiveText, readAyasRevenueCursor,
  snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";
import { isAyasRevenueDigest, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { AYAS_ETSY_ADAPTER_ID, AYAS_ETSY_ADAPTER_VERSION, AYAS_ETSY_API_HOST, AYAS_ETSY_LEDGER_WINDOW_MAX_SECONDS, AYAS_ETSY_LISTING_STATES, AYAS_ETSY_MAX_OFFSET,
  AYAS_ETSY_MAX_RESPONSE_BYTES, AYAS_ETSY_OPERATIONS, AYAS_ETSY_PAGE_LIMIT, AYAS_ETSY_SCOPE_MAP, AYAS_ETSY_WRITE_SCOPES, ayasEtsyIdOf, ayasEtsyPath, ayasEtsyRateLimit, isAyasEtsyId } from "./AyasEtsySchemas";
import { normalizeAyasEtsyLedgerEntry, normalizeAyasEtsyListing, normalizeAyasEtsyPayment, normalizeAyasEtsyReceipt, normalizeAyasEtsyShop } from "./AyasEtsyMapper";

export interface AyasEtsyTransportRequest { readonly method: "GET"; readonly host: typeof AYAS_ETSY_API_HOST; readonly path: string; readonly query: Readonly<Record<string, string>> }
/** Resolves to `{ status, headers, body }`. Header names are matched without case. */
export type AyasEtsyTransport = (request: AyasEtsyTransportRequest) => Promise<unknown>;
export interface AyasEtsyAdapterOptions {
  readonly transport: AyasEtsyTransport;
  readonly shopId: string;
  readonly accountRef: string;
  /** Stage 16.0A connection metadata (never a credential) and the scopes the platform last reported for it. */
  readonly connection: unknown;
  readonly observedScopes: readonly string[] | null;
  readonly now?: () => string;
}
export type AyasEtsyConnectionState = "UNCONFIGURED" | "CONNECTED_READ_ONLY" | "CONNECTED_WRITE_SCOPED" | "EXPIRED" | "REVOKED" | "ERROR";

export const AYAS_ETSY_MANIFEST: AyasRevenueAdapterManifest = Object.freeze({
  schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, platform: "etsy", adapterId: AYAS_ETSY_ADAPTER_ID, adapterVersion: AYAS_ETSY_ADAPTER_VERSION, transport: "OFFICIAL_API",
  locality: "EXTERNAL", credentialHandling: "CONNECTOR_MANAGED", costClass: "free-public", supportedOperations: AYAS_ETSY_OPERATIONS,
  writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false,
});

/** The spec's connection states, from the same 16.0A gate the reads use. A write scope is reported, never usable for writing. */
export function ayasEtsyConnectionState(connection: unknown, observedScopes: readonly string[] | null, now: string): AyasEtsyConnectionState {
  if (connection === null || connection === undefined) return "UNCONFIGURED";
  const probe = { requestId: "etsy-connection-probe", platform: "etsy", operation: "ACCOUNT_STATUS_READ", mode: "READ", accountRef: isAyasRevenuePlainRecord(connection) ? connection.accountRef : null, requestedAt: now };
  const gate = gateAyasRevenueRequestConnection(probe, connection, { now, operations: AYAS_ETSY_OPERATIONS, scopeMap: AYAS_ETSY_SCOPE_MAP, observedScopes });
  const granted = isAyasRevenuePlainRecord(connection) && Array.isArray(connection.grantedScopes) ? connection.grantedScopes : [];
  if (gate.health === "REAUTH_REQUIRED") return "REVOKED";
  if (gate.health === "EXPIRED") return "EXPIRED";
  if (granted.some((s) => (AYAS_ETSY_WRITE_SCOPES as readonly unknown[]).includes(s))) return "CONNECTED_WRITE_SCOPED";
  return gate.gate === "CONNECTION_OK" ? "CONNECTED_READ_ONLY" : "ERROR";
}

type Planned = { readonly kind: string; readonly path: string; readonly query: Record<string, string>; readonly paged: boolean; readonly offset: number; readonly limit: number; readonly receiptRef: string | null }
  | { readonly error: string };
/** Request → fixed path and bounded query. A payload names ids and windows, never a host, path or method. */
function plan(shopId: string, request: AyasRevenueAdapterRequest): Planned {
  const p = request.payload === undefined ? null : request.payload, limit = request.limit ?? 25;
  const cursor = request.cursor === undefined || request.cursor === null ? null : readAyasRevenueCursor(request.cursor, "etsy", request.operation);
  if (request.cursor !== undefined && request.cursor !== null && (cursor === null || !/^o\d{1,5}$/.test(cursor))) return { error: "CURSOR_INVALID" };
  const offset = cursor === null ? 0 : Number(cursor.slice(1));
  if (limit > AYAS_ETSY_PAGE_LIMIT || offset > AYAS_ETSY_MAX_OFFSET) return { error: "PAGE_BOUND" };
  const page = (kind: string, path: string | null, extra: Record<string, string> = {}): Planned => path === null ? { error: "PATH_INVALID" }
    : { kind, path, query: { ...extra, limit: String(limit), offset: String(offset) }, paged: true, offset, limit, receiptRef: null };
  const one = (kind: string, path: string | null, receiptRef: string | null = null): Planned => path === null ? { error: "PATH_INVALID" } : { kind, path, query: {}, paged: false, offset: 0, limit: 1, receiptRef };
  switch (request.operation) {
    case "ACCOUNT_STATUS_READ": return p === null && cursor === null ? one("ACCOUNT", ayasEtsyPath.me()) : { error: "PAYLOAD_INVALID" };
    case "ANALYTICS_READ": return p === null && cursor === null ? one("SHOP_FACTS", ayasEtsyPath.shop(shopId)) : { error: "PAYLOAD_INVALID" };
    case "LISTING_LIST_READ": {
      const state = p === null ? "active" : isAyasRevenuePlainRecord(p) && Object.keys(p).join() === "state" && (AYAS_ETSY_LISTING_STATES as readonly unknown[]).includes(p.state) ? p.state as string : null;
      return state === null ? { error: "PAYLOAD_INVALID" } : page("LISTINGS", ayasEtsyPath.listings(shopId), { state });
    }
    case "ORDER_LIST_READ":
      if (p === null) return page("RECEIPTS", ayasEtsyPath.receipts(shopId));
      return isAyasRevenuePlainRecord(p) && Object.keys(p).join() === "receiptId" && isAyasEtsyId(p.receiptId) && cursor === null
        ? one("RECEIPT", ayasEtsyPath.receipt(shopId, p.receiptId), p.receiptId) : { error: "PAYLOAD_INVALID" };
    case "PAYOUT_LIST_READ": {
      if (!isAyasRevenuePlainRecord(p)) return { error: "PAYLOAD_INVALID" };
      if (p.kind === "RECEIPT_PAYMENTS" && Object.keys(p).sort().join() === "kind,receiptId" && isAyasEtsyId(p.receiptId) && cursor === null)
        return one("RECEIPT_PAYMENTS", ayasEtsyPath.receiptPayments(shopId, p.receiptId), p.receiptId);
      const window = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
      if (p.kind === "LEDGER_ENTRIES" && Object.keys(p).sort().join() === "kind,maxCreated,minCreated" && window(p.minCreated) && window(p.maxCreated)
        && (p.maxCreated as number) > (p.minCreated as number) && (p.maxCreated as number) - (p.minCreated as number) <= AYAS_ETSY_LEDGER_WINDOW_MAX_SECONDS)
        return page("LEDGER_ENTRIES", ayasEtsyPath.ledgerEntries(shopId), { min_created: String(p.minCreated), max_created: String(p.maxCreated) });
      return { error: "PAYLOAD_INVALID" };
    }
    default: return { error: "OPERATION_NOT_READABLE" };
  }
}

const NORMALIZERS: Readonly<Record<string, (raw: unknown) => unknown>> = Object.freeze({
  LISTINGS: normalizeAyasEtsyListing, RECEIPTS: normalizeAyasEtsyReceipt, RECEIPT: normalizeAyasEtsyReceipt, RECEIPT_PAYMENTS: normalizeAyasEtsyPayment,
  LEDGER_ENTRIES: normalizeAyasEtsyLedgerEntry, SHOP_FACTS: normalizeAyasEtsyShop,
});

// Contact details never get this far: the 16.0 request shape refuses them before planning and before this adapter.
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|shop|store|link|ly)\b/i;
const text = (v: unknown, max: number, pattern = /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}\n]+$/u): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max
  && pattern.test(v) && !URL_LIKE.test(v) && !isAyasRevenueSensitiveText(v);
const DRAFT_KEYS = ["title", "description", "tags", "taxonomyId", "price", "quantity", "listingType", "mediaDigests", "rightsEvidenceDigest", "offerRevision"];
/** Local listing draft. Shape errors refuse the draft; missing proofs are listed as issues for the owner. */
function draftListing(payload: unknown): { readonly ok: true; readonly data: Record<string, unknown> } | { readonly ok: false } {
  const p = payload;
  if (!isAyasRevenuePlainRecord(p) || Object.keys(p).sort().join() !== [...DRAFT_KEYS].sort().join()) return { ok: false };
  const tags = p.tags, media = p.mediaDigests;
  if (!text(p.title, 140, /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u) || !text(p.description, 5000) || !Array.isArray(tags) || tags.length > 13
    || !tags.every((t) => text(t, 20, /^[\p{L}\p{N} '-]+$/u)) || new Set(tags.map((t) => String(t).toLowerCase())).size !== tags.length
    || !(Number.isSafeInteger(p.taxonomyId) && (p.taxonomyId as number) > 0) || !isAyasRevenueScenarioMoney(p.price) || (p.price as { valueMinor: number }).valueMinor < 1
    || !(Number.isSafeInteger(p.quantity) && (p.quantity as number) >= 1 && (p.quantity as number) <= 999) || !["physical", "download", "both"].includes(p.listingType as string)
    || !Array.isArray(media) || media.length > 10 || !media.every(isAyasRevenueDigest) || new Set(media).size !== media.length
    || !(p.rightsEvidenceDigest === null || isAyasRevenueDigest(p.rightsEvidenceDigest)) || !(p.offerRevision === null || isAyasRevenueDigest(p.offerRevision))) return { ok: false };
  const issues = [...(media.length === 0 ? ["MEDIA_MISSING"] : []), ...(p.rightsEvidenceDigest === null ? ["RIGHTS_EVIDENCE_MISSING"] : []), ...(p.offerRevision === null ? ["OFFER_REVISION_MISSING"] : [])];
  const draftDigest = digestAyasRevenueData(p);
  if (draftDigest === null) return { ok: false };
  return { ok: true, data: { kind: "LISTING_DRAFT", local: true, draft: p, draftDigest, issues, publication: "CLOSED",
    publicationRequires: ["CONNECTION_REPROBE", "LISTINGS_WRITE_SCOPE", "PAYLOAD_HASH_BOUND", "MEDIA_RIGHTS_PASS", "SPEND_GATE_FEE_REVIEW", "OWNER_APPROVAL", "IDEMPOTENT_CREATE", "READ_BACK_BEFORE_LOCAL_STATE"] } };
}

export function createAyasEtsyAdapter(options: AyasEtsyAdapterOptions): AyasRevenuePlatformAdapter {
  if (!isAyasRevenuePlainRecord(options) || typeof options.transport !== "function" || !isAyasEtsyId(options.shopId) || !isAyasRevenueExternalId(options.accountRef)
    || (options.now !== undefined && typeof options.now !== "function")) throw new Error("AYAS_ETSY_ADAPTER_INVALID");
  const { transport, shopId, accountRef, connection, observedScopes } = options, now = options.now ?? (() => new Date().toISOString());
  const envelope = (request: AyasRevenueAdapterRequest, status: "OK" | "EMPTY" | "BLOCKED" | "UNAVAILABLE" | "ERROR", data: unknown, nextCursor: string | null, errorCode?: string) => ({
    schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, requestId: request.requestId, platform: "etsy", operation: request.operation, status, observedAt: now(), data, nextCursor,
    evidence: { transport: "OFFICIAL_API", externalMutation: false, monetaryMutation: false }, ...(errorCode ? { errorCode: `AYAS_REVENUE_ETSY_${errorCode}` } : {}) });
  const fail = (request: AyasRevenueAdapterRequest, status: "BLOCKED" | "UNAVAILABLE" | "ERROR", why: string) => envelope(request, status, null, null, why);
  const accepts = (request: unknown, operations: readonly AyasRevenueOperation[]): request is AyasRevenueAdapterRequest =>
    isAyasRevenueRequestShape(request) && request.platform === "etsy" && operations.includes(request.operation as AyasRevenueOperation);

  async function read(request: AyasRevenueAdapterRequest): Promise<unknown> {
    const reads = AYAS_ETSY_OPERATIONS.filter((op) => op !== "LISTING_DRAFT");
    if (!accepts(request, reads) || request.mode !== "READ") return { refused: "AYAS_REVENUE_ETSY_REQUEST_INVALID" };
    const at = now();
    const gate = gateAyasRevenueRequestConnection(request, connection, { now: at, operations: AYAS_ETSY_OPERATIONS, scopeMap: AYAS_ETSY_SCOPE_MAP, observedScopes });
    if (gate.gate !== "CONNECTION_OK" || request.accountRef !== accountRef) return fail(request, "BLOCKED", `CONNECTION_${gate.gate === "CONNECTION_OK" ? "ACCOUNT_MISMATCH" : gate.reason.replace(/^CONNECTION_/, "")}`);
    const planned = plan(shopId, request);
    if ("error" in planned) return fail(request, "BLOCKED", planned.error);
    let answer: unknown;
    try { answer = await transport(Object.freeze({ method: "GET", host: AYAS_ETSY_API_HOST, path: planned.path, query: Object.freeze({ ...planned.query }) })); }
    catch { return fail(request, "ERROR", "TRANSPORT_FAILED"); }
    const snapshot = snapshotAyasRevenueValue(answer);
    if (!snapshot.ok || !isAyasRevenuePlainRecord(snapshot.value)) return fail(request, "ERROR", "RESPONSE_INVALID");
    const response = snapshot.value, rawHeaders = response.headers;
    if (!Number.isSafeInteger(response.status) || !isAyasRevenuePlainRecord(rawHeaders) || !Object.values(rawHeaders).every((v) => typeof v === "string")) return fail(request, "ERROR", "RESPONSE_INVALID");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v as string;
    const status = response.status as number;
    if (status === 429) return fail(request, "UNAVAILABLE", "RATE_LIMITED");
    if (status === 401) return fail(request, "BLOCKED", "AUTH_REFUSED");
    if (status === 403) return fail(request, "BLOCKED", "SCOPE_REFUSED");
    if (status === 404) return fail(request, "ERROR", "NOT_FOUND");
    if (status >= 500 && status <= 599) return fail(request, "UNAVAILABLE", "UPSTREAM_UNAVAILABLE");
    if (status !== 200) return fail(request, "ERROR", "REQUEST_REJECTED");
    let size: number;
    try { size = Buffer.byteLength(JSON.stringify(response.body) ?? "", "utf8"); } catch { return fail(request, "ERROR", "RESPONSE_INVALID"); }
    if (size > AYAS_ETSY_MAX_RESPONSE_BYTES) return fail(request, "ERROR", "RESPONSE_TOO_LARGE");
    const body = response.body, rateLimit = ayasEtsyRateLimit(headers);
    // Listings and payments carry their shop identity; the requested path alone is not evidence of ownership.
    if ((planned.kind === "LISTINGS" || planned.kind === "RECEIPT_PAYMENTS") && isAyasRevenuePlainRecord(body) && Array.isArray(body.results)
      && body.results.some((item) => !isAyasRevenuePlainRecord(item) || ayasEtsyIdOf(item.shop_id) !== shopId)) return fail(request, "BLOCKED", "SHOP_MISMATCH");
    if (planned.kind === "ACCOUNT") {
      const shopRef = isAyasRevenuePlainRecord(body) ? ayasEtsyIdOf(body.shop_id) : null;
      if (shopRef === null) return fail(request, "ERROR", "RESPONSE_INVALID");
      if (shopRef !== shopId) return fail(request, "BLOCKED", "SHOP_MISMATCH");
      return envelope(request, "OK", { kind: "ACCOUNT", shopRef, connectionState: ayasEtsyConnectionState(connection, observedScopes, at), rateLimit }, null);
    }
    const normalize = NORMALIZERS[planned.kind]!;
    if (planned.kind === "RECEIPT_PAYMENTS") {
      // One receipt's payments: a `{ count, results }` collection without paging.
      const items = isAyasRevenuePlainRecord(body) && Array.isArray(body.results) && body.results.length <= AYAS_ETSY_PAGE_LIMIT ? body.results.map(normalize) : null;
      if (items === null || items.some((x) => x === null || (x as { receiptRef: string }).receiptRef !== planned.receiptRef)) return fail(request, "ERROR", "RESPONSE_INVALID");
      return items.length === 0 ? envelope(request, "EMPTY", null, null) : envelope(request, "OK", { kind: planned.kind, items, rateLimit }, null);
    }
    if (!planned.paged) {
      const item = normalize(body) as { shopRef?: string; receiptRef?: string } | null;
      if (item === null) return fail(request, "ERROR", "RESPONSE_INVALID");
      if (planned.kind === "SHOP_FACTS" && item.shopRef !== shopId) return fail(request, "BLOCKED", "SHOP_MISMATCH");
      if (planned.kind === "RECEIPT" && item.receiptRef !== planned.receiptRef) return fail(request, "ERROR", "RESPONSE_INVALID");
      return envelope(request, "OK", { kind: planned.kind, item, rateLimit }, null);
    }
    if (!isAyasRevenuePlainRecord(body) || !Number.isSafeInteger(body.count) || (body.count as number) < 0 || !Array.isArray(body.results) || body.results.length > planned.limit)
      return fail(request, "ERROR", "RESPONSE_INVALID");
    const items = body.results.map(normalize);
    if (items.some((x) => x === null)) return fail(request, "ERROR", "RESPONSE_INVALID");
    if (items.length === 0) return envelope(request, "EMPTY", null, null);
    const next = planned.offset + items.length, more = items.length === planned.limit && next < (body.count as number) && next <= AYAS_ETSY_MAX_OFFSET;
    return envelope(request, "OK", { kind: planned.kind, items, page: { offset: planned.offset, limit: planned.limit, count: body.count }, rateLimit },
      more ? bindAyasRevenueCursor("etsy", request.operation, `o${next}`) : null);
  }

  async function draft(request: AyasRevenueAdapterRequest): Promise<unknown> {
    if (!accepts(request, ["LISTING_DRAFT"]) || request.mode !== "DRAFT") return { refused: "AYAS_REVENUE_ETSY_REQUEST_INVALID" };
    const listing = draftListing(request.payload);
    if (!listing.ok || containsAyasRevenueSensitiveData(listing.data)) return fail(request, "BLOCKED", "DRAFT_INVALID");
    return envelope(request, "OK", listing.data, null);
  }
  return Object.freeze({ manifest: AYAS_ETSY_MANIFEST, read, draft });
}
