/** Stage 16.0 test-only fake revenue adapter: deterministic data, no network, no credentials, never registered in production. */
import type { AyasCostClass } from "../../src/lib/ayas/policy/AyasZeroCostPolicy";
import type { AyasRevenueAdapterManifest, AyasRevenueAdapterRequest, AyasRevenueOperation, AyasRevenuePlatform } from "../../src/lib/ayas/revenue/AyasRevenuePlatformTypes";
import { bindAyasRevenueCursor, readAyasRevenueCursor } from "../../src/lib/ayas/revenue/AyasRevenueRedaction";

export const FAKE_REVENUE_OBSERVED_AT = "2026-10-03T12:00:00.000Z";
export const FAKE_REVENUE_LISTINGS = Object.freeze([
  { listingId: "L-1001", title: "Hand-drawn map print", state: "active", priceMinor: 2400, currency: "USD" },
  { listingId: "L-1002", title: "Watercolour city poster", state: "active", priceMinor: 3100, currency: "USD" },
  { listingId: "L-1003", title: "Minimal line art set", state: "draft", priceMinor: 1500, currency: "USD" },
  { listingId: "L-1004", title: "Printable calendar", state: "active", priceMinor: 900, currency: "USD" },
  { listingId: "L-1005", title: "Botanical sketch bundle", state: "inactive", priceMinor: 1800, currency: "USD" },
]);

export interface FakeRevenueOptions {
  readonly platform?: AyasRevenuePlatform;
  readonly adapterId?: string;
  readonly adapterVersion?: number;
  readonly transport?: AyasRevenueAdapterManifest["transport"];
  readonly credentialHandling?: AyasRevenueAdapterManifest["credentialHandling"];
  readonly costClass?: AyasCostClass;
  readonly operations?: readonly AyasRevenueOperation[];
  /** Replaces the default answer; receives the request the adapter was handed. */
  readonly respond?: (request: AyasRevenueAdapterRequest, kind: "read" | "draft") => unknown;
}

export function fakeRevenueManifest(o: FakeRevenueOptions = {}): AyasRevenueAdapterManifest {
  return {
    schemaVersion: "1", platform: o.platform ?? "etsy", adapterId: o.adapterId ?? `fixture-${o.platform ?? "etsy"}-fake`, adapterVersion: o.adapterVersion ?? 1,
    transport: o.transport ?? "OFFICIAL_API", locality: "EXTERNAL", credentialHandling: o.credentialHandling ?? "NONE", costClass: o.costClass ?? "free-public",
    supportedOperations: o.operations ?? ["LISTING_LIST_READ", "ORDER_LIST_READ", "ANALYTICS_READ", "LISTING_DRAFT", "LISTING_CREATE", "LISTING_UPDATE", "PURCHASE", "REFUND"],
    writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false,
  };
}

/** A default, well-formed answer for the request. */
export function fakeRevenueAnswer(manifest: AyasRevenueAdapterManifest, request: AyasRevenueAdapterRequest, kind: "read" | "draft"): Record<string, unknown> {
  const base = { schemaVersion: "1", requestId: request.requestId, platform: request.platform, operation: request.operation, observedAt: FAKE_REVENUE_OBSERVED_AT,
    evidence: { transport: manifest.transport, externalMutation: false, monetaryMutation: false } };
  if (kind === "draft") return { ...base, status: "OK", data: { draftId: `draft-${request.requestId}`, kind: request.operation, fields: request.payload ?? null, local: true }, nextCursor: null };
  if (request.operation !== "LISTING_LIST_READ") return { ...base, status: "EMPTY", data: null, nextCursor: null };
  const start = request.cursor ? Number((readAyasRevenueCursor(request.cursor, request.platform, request.operation) ?? "p0").slice(1)) : 0, size = request.limit ?? 2;
  const page = FAKE_REVENUE_LISTINGS.slice(start, start + size), next = start + size < FAKE_REVENUE_LISTINGS.length ? bindAyasRevenueCursor(request.platform, request.operation, `p${start + size}`) : null;
  return { ...base, status: page.length ? "OK" : "EMPTY", data: page.length ? page.map((x) => ({ ...x })) : null, nextCursor: page.length ? next : null };
}

export function createFakeRevenueAdapter(o: FakeRevenueOptions = {}) {
  const manifest = fakeRevenueManifest(o), calls = { read: 0, draft: 0, requests: [] as AyasRevenueAdapterRequest[] };
  const answer = (request: AyasRevenueAdapterRequest, kind: "read" | "draft") => {
    calls[kind]++; calls.requests.push(request);
    return Promise.resolve(o.respond ? o.respond(request, kind) : fakeRevenueAnswer(manifest, request, kind));
  };
  const adapter = { manifest, read: (request: AyasRevenueAdapterRequest) => answer(request, "read"), draft: (request: AyasRevenueAdapterRequest) => answer(request, "draft") };
  return { adapter, calls };
}
