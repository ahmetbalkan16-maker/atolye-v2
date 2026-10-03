/** Official REST v1 GET facade and local drafts. Coarse API keys grant no AYAS write authority. */
import { isAyasRevenueAccountConnection, AYAS_REVENUE_CONNECTION_LIMITS } from "../../AyasRevenueAccountConnection";
import { isAyasRevenueRequestShape } from "../../AyasRevenueActionPolicy";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import type { AyasRevenuePlatformAdapter } from "../../AyasRevenuePlatformAdapter";
import type { AyasRevenueAdapterManifest, AyasRevenueAdapterRequest } from "../../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp, bindAyasRevenueCursor, readAyasRevenueCursor } from "../../AyasRevenueRedaction";
import { AYAS_LEMON_HOST, type AyasLemonMode, type AyasLemonType, lemonId, lemonInteger, lemonResource, normalizeAyasLemonResource, snapshotAyasLemonValue } from "./AyasLemonSchemas";
import { buildAyasLemonLocalDraft } from "./AyasLemonCheckoutPolicy";

export const AYAS_LEMON_READ_POLICY_DIGEST = digestAyasRevenueData({ model: "COARSE_API_KEY_GET_FACADE", host: AYAS_LEMON_HOST,
  types: ["stores", "products", "variants", "prices", "orders", "subscriptions", "subscription-invoices", "license-keys"], verbs: ["GET"],
  maxBatchCalls: 3, minBatchIntervalMs: 1000, pageMax: 25, pagesMax: 40, rawRetention: "NONE", liveDefault: "CLOSED", scheduledByDefault: false })!;
export const AYAS_LEMON_MANIFEST: AyasRevenueAdapterManifest = deepFreezeAyasRevenueValue({ schemaVersion: "1", platform: "lemon-squeezy", adapterId: "lemon-squeezy-rest-v1", adapterVersion: 1,
  transport: "OFFICIAL_API", locality: "EXTERNAL", credentialHandling: "SERVER_SECRET", costClass: "free-public",
  supportedOperations: ["ACCOUNT_STATUS_READ", "LISTING_LIST_READ", "ORDER_LIST_READ", "ANALYTICS_READ", "LISTING_DRAFT", "DELIVERABLE_DRAFT"],
  writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false });
export const AYAS_LEMON_CONNECTION_STATES = ["UNCONFIGURED", "TEST_CONNECTED", "LIVE_READ_ONLY", "LIVE_WRITE_SCOPED", "REVOKED", "ERROR"] as const;
export interface AyasLemonTransportRequest { readonly method: "GET"; readonly host: typeof AYAS_LEMON_HOST; readonly path: string; readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<{ Accept: "application/vnd.api+json"; "Content-Type": "application/vnd.api+json" }> }
export interface AyasLemonAdapterOptions {
  readonly accountRef: string; readonly storeRef: string; readonly mode: AyasLemonMode;
  readonly transport: (request: AyasLemonTransportRequest) => Promise<unknown>;
  readonly connection: () => unknown;
  /** Trusted secret-holder state, never request-supplied metadata. No key is returned. */
  readonly credentialState: () => typeof AYAS_LEMON_CONNECTION_STATES[number];
  readonly ownerReadPolicyApproved?: (digest: string, accountRef: string, mode: AyasLemonMode) => boolean;
  readonly zeroCostQualified?: () => boolean; readonly liveReadApproved?: () => boolean;
  readonly now?: () => string; readonly minBatchIntervalMs?: number; readonly rateBackoffMs?: number;
}
const READ_KINDS: Readonly<Record<string, readonly AyasLemonType[]>> = Object.freeze({ ACCOUNT_STATUS_READ: ["stores"], LISTING_LIST_READ: ["products", "variants", "prices"],
  ORDER_LIST_READ: ["orders", "subscriptions", "subscription-invoices", "license-keys"], ANALYTICS_READ: ["orders", "subscription-invoices"] });
export function createAyasLemonSqueezyAdapter(options: AyasLemonAdapterOptions): AyasRevenuePlatformAdapter {
  if (!isAyasRevenuePlainRecord(options) || typeof options.transport !== "function" || typeof options.connection !== "function" || typeof options.credentialState !== "function"
    || typeof options.accountRef !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(options.accountRef) || lemonId(options.storeRef) !== options.storeRef || !["TEST", "LIVE"].includes(options.mode)
    || [options.ownerReadPolicyApproved, options.zeroCostQualified, options.liveReadApproved, options.now].some(x => x !== undefined && typeof x !== "function")) throw Error("AYAS_LEMON_OPTIONS_INVALID");
  const { accountRef, storeRef, mode, transport, connection, credentialState } = options;
  const now = options.now ?? (() => new Date().toISOString()), approve = options.ownerReadPolicyApproved ?? (() => false), cost = options.zeroCostQualified ?? (() => false), live = options.liveReadApproved ?? (() => false);
  const interval = options.minBatchIntervalMs ?? 1000, backoff = options.rateBackoffMs ?? 60_000;
  if (!lemonInteger(interval, 1000, 60_000) || !lemonInteger(backoff, 10_000, 3_600_000)) throw Error("AYAS_LEMON_LIMITER_INVALID");
  let nextAllowed = 0, lastClock = 0, inFlight = false;
  const out = (r: AyasRevenueAdapterRequest, status: string, data: unknown = null, nextCursor: string | null = null, error?: string) => ({ schemaVersion: "1", requestId: r.requestId,
    platform: "lemon-squeezy", operation: r.operation, status, observedAt: now(), data, nextCursor, evidence: { transport: "OFFICIAL_API", externalMutation: false, monetaryMutation: false }, ...(error ? { errorCode: `AYAS_REVENUE_LEMON_${error}` } : {}) });
  const fail = (r: AyasRevenueAdapterRequest, error: string, status = "BLOCKED") => out(r, status, null, null, error);
  const gate = (at: string): string | null => {
    if (!isAyasRevenueTimestamp(at) || approve(AYAS_LEMON_READ_POLICY_DIGEST, accountRef, mode) !== true || cost() !== true || (mode === "LIVE" && live() !== true)) return null;
    const state = credentialState(); if (mode === "TEST" ? state !== "TEST_CONNECTED" : !["LIVE_READ_ONLY", "LIVE_WRITE_SCOPED"].includes(state)) return null;
    const c = snapshotAyasLemonValue(connection());
    if (!isAyasRevenueAccountConnection(c) || c.platform !== "lemon-squeezy" || c.accountRef !== accountRef || c.credentialHandling !== "SERVER_SECRET" || c.grantedScopes.length !== 0
      || c.reauthRequired || c.connectedAt > at || c.lastVerifiedAt === null || c.lastVerifiedAt > at || Date.parse(at) - Date.parse(c.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs
      || c.expiresAt === null || c.expiresAt <= at || Date.parse(c.expiresAt) - Date.parse(c.connectedAt) > 366 * 86_400_000) return null;
    return digestAyasRevenueData({ c, state, storeRef, mode });
  };
  async function read(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasLemonValue(raw, 65_536) as AyasRevenueAdapterRequest;
    if (!isAyasRevenueRequestShape(r) || r.platform !== "lemon-squeezy" || r.mode !== "READ" || !Object.hasOwn(READ_KINDS, r.operation)) return { refused: "AYAS_REVENUE_LEMON_REQUEST_INVALID" };
    const at = now(); let captured: string | null;
    try { captured = gate(at); } catch { captured = null; }
    if (r.accountRef !== accountRef || captured === null) return fail(r, "CONNECTION_POLICY_REFUSED");
    const clock = Date.parse(at); if (clock < lastClock) return fail(r, "CLOCK_ROLLBACK"); lastClock = clock;
    const p = r.payload == null && r.operation === "ACCOUNT_STATUS_READ" ? { kind: "stores", resourceRef: storeRef } : r.payload;
    if (!isAyasRevenuePlainRecord(p) || !(hasExactAyasRevenueKeys(p, ["kind"]) || hasExactAyasRevenueKeys(p, ["kind", "resourceRef"])) || !READ_KINDS[r.operation].includes(p.kind as AyasLemonType)
      || (Object.hasOwn(p, "resourceRef") && lemonId(p.resourceRef) !== p.resourceRef)) return fail(r, "PAYLOAD_INVALID");
    const type = p.kind as AyasLemonType, resourceRef = p.resourceRef as string | undefined;
    if ((["stores", "variants", "prices", "license-keys"].includes(type) && resourceRef === undefined) || (type === "stores" && resourceRef !== storeRef)) return fail(r, "RESOURCE_REQUIRED");
    const limit = r.limit ?? 10;
    const cursorScope = `${r.operation}:${type}:${storeRef}:${mode}:${limit}`, opaque = r.cursor == null ? null : readAyasRevenueCursor(r.cursor, "lemon-squeezy", r.operation);
    const match = typeof opaque === "string" ? /^([a-f0-9]{64})-p([1-9]\d?)$/.exec(opaque) : null, scopeDigest = digestAyasRevenueData({ cursorScope })!;
    const page = r.cursor == null ? 1 : match && match[1] === scopeDigest ? Number(match[2]) : 0;
    if (!lemonInteger(limit, 1, 25) || !lemonInteger(page, 1, 40) || (resourceRef !== undefined && r.cursor != null)) return fail(r, "PAGE_INVALID");
    if (inFlight || clock < nextAllowed) return fail(r, "BACKOFF_ACTIVE", "UNAVAILABLE");
    inFlight = true; nextAllowed = clock + interval;
    let calls = 0, remainingBudget: number | null = null;
    const get = async (kind: AyasLemonType, id?: string, list = false): Promise<Record<string, unknown>> => {
      if (++calls > 3) throw Error("BATCH_BOUND");
      if (remainingBudget !== null) { if (remainingBudget <= 0) throw Error("RATE_LIMITED"); remainingBudget--; }
      if (gate(now()) !== captured || Date.parse(now()) < lastClock) throw Error("CONNECTION_CHANGED");
      const query: Record<string, string> = list ? { "filter[store_id]": storeRef, "page[number]": String(page), "page[size]": String(limit) } : {};
      const result = snapshotAyasLemonValue(await transport(deepFreezeAyasRevenueValue({ method: "GET", host: AYAS_LEMON_HOST, path: `/v1/${kind}${id ? `/${id}` : ""}`, query,
        headers: { Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" } })));
      if (gate(now()) !== captured) throw Error("CONNECTION_CHANGED");
      const responseClock = Date.parse(now()); if (!Number.isFinite(responseClock) || responseClock < lastClock) throw Error("CLOCK_ROLLBACK"); lastClock = responseClock;
      if (!isAyasRevenuePlainRecord(result) || !hasExactAyasRevenueKeys(result, ["status", "headers", "body"]) || !lemonInteger(result.status, 100, 599) || !isAyasRevenuePlainRecord(result.headers)
        || !Object.values(result.headers).every(v => typeof v === "string")) throw Error("RESPONSE_INVALID");
      const entries = Object.entries(result.headers).map(([k, v]) => [k.toLowerCase(), v] as const); if (new Set(entries.map(x => x[0])).size !== entries.length) throw Error("HEADERS_INVALID");
      const h = Object.fromEntries(entries), remain = h["x-ratelimit-remaining"], ceiling = h["x-ratelimit-limit"];
      if ((remain !== undefined && !/^\d{1,6}$/.test(remain as string)) || (ceiling !== undefined && !/^\d{1,6}$/.test(ceiling as string))) throw Error("HEADERS_INVALID");
      if (ceiling !== undefined && (Number(ceiling) < 1 || (remain !== undefined && Number(remain) > Number(ceiling)))) throw Error("HEADERS_INVALID");
      if (remain !== undefined) remainingBudget = Math.min(remainingBudget ?? Number(remain), Number(remain));
      if (ceiling !== undefined) nextAllowed = Math.max(nextAllowed, clock + Math.ceil(180_000 / Number(ceiling)));
      if (remain === "0") nextAllowed = Math.max(nextAllowed, responseClock + backoff);
      if (result.status === 429) {
        const retry = h["retry-after"], seconds = typeof retry === "string" && /^\d{1,5}$/.test(retry) ? Number(retry) * 1000 : 0;
        const date = typeof retry === "string" && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) - responseClock : 0;
        nextAllowed = responseClock + Math.max(backoff, Math.min(86_400_000, seconds || date || 0)); throw Error("RATE_LIMITED");
      }
      if (result.status >= 500) { nextAllowed = responseClock + backoff; throw Error("UPSTREAM_UNAVAILABLE"); }
      if ([401, 403].includes(result.status)) throw Error("AUTH_REFUSED");
      if (result.status !== 200) throw Error("UPSTREAM_REFUSED");
      const body = result.body;
      if (!isAyasRevenuePlainRecord(body) || !isAyasRevenuePlainRecord(body.jsonapi) || body.jsonapi.version !== "1.0") throw Error("JSONAPI_INVALID");
      return body;
    };
    try {
      const body = await get(type, resourceRef, resourceRef === undefined);
      let parentRef: string | undefined;
      if (["variants", "prices", "license-keys"].includes(type)) {
        const child = lemonResource(body.data, type, resourceRef); if (!child) throw Error("RESOURCE_INVALID");
        const attrs = child.attributes as Record<string, unknown>;
        parentRef = lemonId(type === "variants" ? attrs.product_id : type === "prices" ? attrs.variant_id : attrs.order_id) ?? undefined;
        if (!parentRef) throw Error("PARENT_INVALID");
        const parentType: AyasLemonType = type === "variants" ? "products" : type === "prices" ? "variants" : "orders";
        const parent = lemonResource((await get(parentType, parentRef)).data, parentType, parentRef); if (!parent) throw Error("PARENT_INVALID");
        let productRef: string | undefined;
        if (type === "prices") {
          productRef = lemonId((parent.attributes as Record<string, unknown>).product_id) ?? undefined; if (!productRef) throw Error("PARENT_INVALID");
            const product = lemonResource((await get("products", productRef)).data, "products", productRef);
          if (!normalizeAyasLemonResource(product, { type: "products", storeRef, mode, observedAt: now() })) throw Error("PARENT_INVALID");
        }
        if (!normalizeAyasLemonResource(parent, { type: parentType, storeRef, mode, observedAt: now(), ...(productRef ? { parentRef: productRef } : {}) })) throw Error("PARENT_INVALID");
      }
      const rows = resourceRef === undefined ? body.data : [body.data];
      if (!Array.isArray(rows) || rows.length > limit || rows.some(x => resourceRef !== undefined && lemonId((x as Record<string, unknown>)?.id) !== resourceRef)) throw Error("RESOURCE_INVALID");
      const items = rows.map(x => normalizeAyasLemonResource(x, { type, storeRef, mode, observedAt: now(), ...(parentRef ? { parentRef } : {}) }));
      if (items.some(x => x === null) || new Set(items.map(x => x?.resourceRef)).size !== items.length) throw Error("RESOURCE_INVALID");
      let next: string | null = null, truncated = false;
      if (resourceRef === undefined) {
        const meta = isAyasRevenuePlainRecord(body.meta) ? body.meta.page : null;
        if (!isAyasRevenuePlainRecord(meta) || meta.currentPage !== page || meta.perPage !== limit || !lemonInteger(meta.lastPage, 1, 1_000_000) || !lemonInteger(meta.total, 0, 10_000_000)
          || meta.lastPage !== Math.max(1, Math.ceil(meta.total / limit)) || meta.lastPage < page || items.length !== Math.min(limit, Math.max(0, meta.total - (page - 1) * limit)) || !isAyasRevenuePlainRecord(body.links)) throw Error("PAGINATION_INVALID");
        if (page < meta.lastPage) {
          if (typeof body.links.next !== "string" || items.length === 0) throw Error("PAGINATION_INVALID");
          const u = new URL(body.links.next);
          if (u.origin !== AYAS_LEMON_HOST || u.pathname !== `/v1/${type}` || u.username || u.password || u.hash || [...u.searchParams.keys()].length !== 3
            || u.searchParams.getAll("filter[store_id]").length !== 1 || u.searchParams.get("filter[store_id]") !== storeRef
            || u.searchParams.getAll("page[number]").length !== 1 || u.searchParams.get("page[number]") !== String(page + 1)
            || u.searchParams.getAll("page[size]").length !== 1 || u.searchParams.get("page[size]") !== String(limit)) throw Error("NEXT_INVALID");
          truncated = page >= 40; if (!truncated) next = bindAyasRevenueCursor("lemon-squeezy", r.operation, `${scopeDigest}-p${page + 1}`);
        } else if (body.links.next != null) throw Error("PAGINATION_INVALID");
      }
      return items.length ? out(r, "OK", { kind: "LEMON_CANONICAL_READ", resourceType: type, mode, storeRefDigest: digestAyasRevenueData({ storeRef }), items, truncated, authority: "NONE" }, next) : out(r, "EMPTY");
    } catch (e) {
      const codes = ["BATCH_BOUND", "CONNECTION_CHANGED", "CLOCK_ROLLBACK", "RESPONSE_INVALID", "HEADERS_INVALID", "RATE_LIMITED", "UPSTREAM_UNAVAILABLE", "AUTH_REFUSED", "UPSTREAM_REFUSED", "JSONAPI_INVALID", "RESOURCE_INVALID", "PARENT_INVALID", "PAGINATION_INVALID", "NEXT_INVALID"];
      const code = e instanceof Error && codes.includes(e.message) ? e.message : "TRANSPORT_FAILED";
      return fail(r, code, ["RATE_LIMITED", "UPSTREAM_UNAVAILABLE"].includes(code) ? "UNAVAILABLE" : "ERROR");
    } finally { inFlight = false; }
  }
  async function draft(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasLemonValue(raw, 65_536) as AyasRevenueAdapterRequest;
    if (!isAyasRevenueRequestShape(r) || r.platform !== "lemon-squeezy" || r.mode !== "DRAFT" || !["LISTING_DRAFT", "DELIVERABLE_DRAFT"].includes(r.operation)) return { refused: "AYAS_REVENUE_LEMON_REQUEST_INVALID" };
    const data = buildAyasLemonLocalDraft(r.payload, now()); if (data === null || r.cursor != null || (r.operation === "LISTING_DRAFT" ? data.kind !== "PRODUCT" : data.kind === "PRODUCT")) return fail(r, "DRAFT_INVALID");
    return out(r, "OK", data);
  }
  return Object.freeze({ manifest: AYAS_LEMON_MANIFEST, read, draft });
}
