/** Stage16.7. Two publicly qualified GET routes, local drafts, coarse-token policy explicitly owner-gated.
 * A coarse instructor token has no documented granular scope list. Empty metadata scopes mean NOT_APPLICABLE,
 * never invented platform grants. The general16.0A scoped gate is unchanged. This Udemy-only boundary reuses
 * its strict metadata validator/time bounds, additionally requires a reviewed GET-only connector policy and
 * zero-cost qualification callbacks. Nothing is registered or connected by this source factory.
 */
import { isAyasRevenueAccountConnection, AYAS_REVENUE_CONNECTION_LIMITS } from "../../AyasRevenueAccountConnection";
import { isAyasRevenueRequestShape } from "../../AyasRevenueActionPolicy";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import type { AyasRevenuePlatformAdapter } from "../../AyasRevenuePlatformAdapter";
import type { AyasRevenueAdapterManifest, AyasRevenueAdapterRequest } from "../../AyasRevenuePlatformTypes";
import { bindAyasRevenueCursor, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp, readAyasRevenueCursor } from "../../AyasRevenueRedaction";
import { buildAyasCourseProductionPlan, courseInteger, snapshotAyasCourseValue } from "../../content/AyasCourseProductionPlan";
import { normalizeAyasUdemyCourse, normalizeAyasUdemyThread, snapshotAyasUdemyWire, udemyCount } from "./AyasUdemyCourseReadModel";
import { buildAyasUdemySupportDraft } from "./AyasUdemySupportWorkflow";

export const AYAS_UDEMY_HOST = "https://www.udemy.com" as const;
export const AYAS_UDEMY_READ_POLICY_DIGEST = digestAyasRevenueData({ authorizationModel: "COARSE_INSTRUCTOR_TOKEN", verbs: ["GET"],
  host: AYAS_UDEMY_HOST, routes: ["/instructor-api/v1/taught-courses/courses/", "/instructor-api/v1/message-threads/"], pageMax: 25, pagesMax: 40,
  upstreamTextRetention: "NONE", scheduledByDefault: false })!;
export const AYAS_UDEMY_MANIFEST: AyasRevenueAdapterManifest = deepFreezeAyasRevenueValue({ schemaVersion: "1", platform: "udemy", adapterId: "udemy-instructor-v1", adapterVersion: 1,
  transport: "OFFICIAL_API", locality: "EXTERNAL", credentialHandling: "CONNECTOR_MANAGED", costClass: "free-public",
  supportedOperations: ["ACCOUNT_STATUS_READ", "LISTING_LIST_READ", "ANALYTICS_READ", "MESSAGE_LIST_READ", "COURSE_DRAFT", "MESSAGE_DRAFT"],
  writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false });
export interface AyasUdemyTransportRequest { readonly method: "GET"; readonly host: typeof AYAS_UDEMY_HOST; readonly path: string; readonly query: Readonly<Record<string, string>> }
export interface AyasUdemyAdapterOptions {
  readonly accountRef: string; readonly transport: (request: AyasUdemyTransportRequest) => Promise<unknown>;
  /** Trusted connector metadata supplier. Never supplies the token itself. */
  readonly connection: () => unknown;
  /** Code/owner-owned callbacks, not request fields. Missing callbacks keep reads closed. */
  readonly ownerReadPolicyApproved?: (policyDigest: string, accountRef: string) => boolean;
  readonly zeroCostQualified?: () => boolean;
  readonly now?: () => string;
  readonly minIntervalMs?: number; readonly rateBackoffMs?: number; readonly maintenanceBackoffMs?: number;
}
export function createAyasUdemyAdapter(options: AyasUdemyAdapterOptions): AyasRevenuePlatformAdapter {
  if (!isAyasRevenuePlainRecord(options) || typeof options.transport !== "function" || typeof options.connection !== "function" || typeof options.accountRef !== "string"
    || !/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(options.accountRef) || (options.now !== undefined && typeof options.now !== "function")
    || (options.ownerReadPolicyApproved !== undefined && typeof options.ownerReadPolicyApproved !== "function") || (options.zeroCostQualified !== undefined && typeof options.zeroCostQualified !== "function")) throw Error("AYAS_UDEMY_OPTIONS_INVALID");
  const { accountRef, transport, connection } = options, now = options.now ?? (() => new Date().toISOString()), approve = options.ownerReadPolicyApproved ?? (() => false), cost = options.zeroCostQualified ?? (() => false);
  const interval = options.minIntervalMs ?? 1000, backoff = options.rateBackoffMs ?? 60_000, maintenance = options.maintenanceBackoffMs ?? 3_600_000;
  if (!courseInteger(interval, 1000, 60_000) || !courseInteger(backoff, 10_000, 3_600_000) || !courseInteger(maintenance, 3_600_000, 86_400_000)) throw Error("AYAS_UDEMY_LIMITER_INVALID");
  let nextAllowed = 0, inFlight = false, lastClock = 0;
  const out = (r: AyasRevenueAdapterRequest, status: string, data: unknown = null, cursor: string | null = null, error?: string) => ({ schemaVersion: "1", requestId: r.requestId, platform: "udemy", operation: r.operation,
    status, observedAt: now(), data, nextCursor: cursor, evidence: { transport: "OFFICIAL_API", externalMutation: false, monetaryMutation: false }, ...(error ? { errorCode: `AYAS_REVENUE_UDEMY_${error}` } : {}) });
  const fail = (r: AyasRevenueAdapterRequest, why: string, status = "BLOCKED") => out(r, status, null, null, why);
  const gate = (at: string): string | null => {
    if (!isAyasRevenueTimestamp(at) || approve(AYAS_UDEMY_READ_POLICY_DIGEST, accountRef) !== true || cost() !== true) return null;
    const s = snapshotAyasUdemyWire(connection()); if (!isAyasRevenueAccountConnection(s) || s.platform !== "udemy" || s.accountRef !== accountRef || s.credentialHandling !== "CONNECTOR_MANAGED"
      || s.grantedScopes.length !== 0 || s.reauthRequired || s.connectedAt > at || s.lastVerifiedAt === null || s.lastVerifiedAt > at
      || Date.parse(at) - Date.parse(s.lastVerifiedAt) > AYAS_REVENUE_CONNECTION_LIMITS.verificationMaxAgeMs || (s.expiresAt !== null && s.expiresAt <= at)) return null;
    return digestAyasRevenueData(s);
  };
  const accepts = (r: unknown, mode: "READ" | "DRAFT"): r is AyasRevenueAdapterRequest => {
    const s = snapshotAyasCourseValue(r); return isAyasRevenueRequestShape(s) && s.platform === "udemy" && s.mode === mode && AYAS_UDEMY_MANIFEST.supportedOperations.includes(s.operation);
  };
  async function read(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasCourseValue(raw) as AyasRevenueAdapterRequest;
    if (!accepts(r, "READ")) return { refused: "AYAS_REVENUE_UDEMY_REQUEST_INVALID" };
    const at = now(), connectionDigest = gate(at); if (r.accountRef !== accountRef || connectionDigest === null) return fail(r, "CONNECTION_POLICY_REFUSED");
    const clock = Date.parse(at); if (clock < lastClock) return fail(r, "CLOCK_ROLLBACK"); lastClock = clock;
    if (r.operation === "ACCOUNT_STATUS_READ") return r.payload == null && r.cursor == null ? out(r, "OK", { kind: "ACCOUNT_CONNECTION", accountDigest: digestAyasRevenueData({ accountRef }),
      authorizationModel: "COARSE_TOKEN_GET_FACADE", scopeEvidence: "NOT_APPLICABLE_NO_DOCUMENTED_GRANULAR_SCOPES", grantsAuthority: false }) : fail(r, "PAYLOAD_INVALID");
    const kind = r.operation === "MESSAGE_LIST_READ" ? "THREADS" : "COURSES";
    if (r.payload != null && (!isAyasRevenuePlainRecord(r.payload) || !hasExactAyasRevenueKeys(r.payload, ["kind"]) || r.payload.kind !== kind)) return fail(r, "ENDPOINT_NOT_QUALIFIED");
    const limit = r.limit ?? 12, opaque = r.cursor == null ? null : readAyasRevenueCursor(r.cursor, "udemy", r.operation), page = opaque === null ? 1 : /^p[1-9]\d?$/.test(opaque) ? Number(opaque.slice(1)) : 0;
    if (!courseInteger(limit, 1, 25) || !courseInteger(page, 1, 40) || (r.cursor != null && opaque === null)) return fail(r, "PAGE_INVALID");
    if (inFlight || clock < nextAllowed) return fail(r, "BACKOFF_ACTIVE", "UNAVAILABLE");
    const path = kind === "COURSES" ? "/instructor-api/v1/taught-courses/courses/" : "/instructor-api/v1/message-threads/";
    const query: Record<string, string> = kind === "COURSES" ? { "fields[course]": "id,is_paid,is_published,num_reviews,rating" } : { "fields[message_thread]": "id,is_read" };
    inFlight = true; nextAllowed = clock + interval;
    try {
      const rawAnswer = await transport(deepFreezeAyasRevenueValue({ method: "GET", host: AYAS_UDEMY_HOST, path, query: { ...query, page: String(page), page_size: String(limit) } }));
      if (gate(now()) !== connectionDigest) return fail(r, "CONNECTION_CHANGED");
      const answer = snapshotAyasUdemyWire(rawAnswer);
      if (!isAyasRevenuePlainRecord(answer) || !hasExactAyasRevenueKeys(answer, ["status", "headers", "body"]) || !courseInteger(answer.status, 100, 599)
        || !isAyasRevenuePlainRecord(answer.headers) || !Object.values(answer.headers).every(v => typeof v === "string")) return fail(r, "RESPONSE_INVALID", "ERROR");
      const headers = Object.fromEntries(Object.entries(answer.headers).map(([k, v]) => [k.toLowerCase(), v]));
      const responseClock = Date.parse(now()); if (!Number.isFinite(responseClock) || responseClock < clock) return fail(r, "CLOCK_ROLLBACK");
      lastClock = responseClock;
      if (answer.status === 429) {
        const retry = headers["retry-after"], seconds = typeof retry === "string" && /^\d{1,5}$/.test(retry) ? Number(retry) * 1000 : 0;
        const dateDelay = typeof retry === "string" && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) - responseClock : 0;
        nextAllowed = responseClock + Math.max(backoff, Math.min(86_400_000, seconds || dateDelay || 0)); return fail(r, "RATE_LIMITED", "UNAVAILABLE");
      }
      if (answer.status === 503) { nextAllowed = responseClock + maintenance; return fail(r, "MAINTENANCE", "UNAVAILABLE"); }
      if ([400, 401, 403].includes(answer.status)) return fail(r, "AUTH_OR_REQUEST_REFUSED");
      if (answer.status !== 200) return fail(r, "UPSTREAM_UNAVAILABLE", "UNAVAILABLE");
      const body = answer.body;
      if (!isAyasRevenuePlainRecord(body) || !udemyCount(body.count) || !Array.isArray(body.results) || body.results.length > limit
        || body.results.length > body.count || !(body.next === null || typeof body.next === "string")) return fail(r, "RESPONSE_INVALID", "ERROR");
      const items = body.results.map(kind === "COURSES" ? normalizeAyasUdemyCourse : normalizeAyasUdemyThread);
      if (items.some(x => x === null) || new Set(items.map(x => {
        const item = x as Record<string, unknown>; return item.courseRefDigest ?? item.threadRefDigest;
      })).size !== items.length) return fail(r, "RESPONSE_INVALID", "ERROR");
      let next: string | null = null;
      if (body.next !== null) {
        let u: URL; try { u = new URL(body.next); } catch { return fail(r, "NEXT_INVALID", "ERROR"); }
        if (u.origin !== AYAS_UDEMY_HOST || u.pathname !== path || u.username || u.password || u.hash || [...u.searchParams.keys()].some(k => ![...Object.keys(query), "page", "page_size"].includes(k))
          || u.searchParams.getAll("page").length !== 1 || u.searchParams.get("page") !== String(page + 1)
          || u.searchParams.getAll("page_size").length !== 1 || u.searchParams.get("page_size") !== String(limit)
          || Object.entries(query).some(([k, v]) => u.searchParams.has(k) && (u.searchParams.getAll(k).length !== 1 || u.searchParams.get(k) !== v))
          || items.length === 0) return fail(r, "NEXT_INVALID", "ERROR");
        if (page < 40) next = bindAyasRevenueCursor("udemy", r.operation, `p${page + 1}`);
      }
      return items.length === 0 ? out(r, "EMPTY") : out(r, "OK", { kind, items, page: { number: page, limit, count: body.count, truncated: body.next !== null && next === null },
        economicEvidence: "NONE", upstreamTextRetention: "DISCARDED" }, next);
    } catch { return fail(r, "TRANSPORT_FAILED", "ERROR"); }
    finally { inFlight = false; }
  }
  async function draft(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasCourseValue(raw) as AyasRevenueAdapterRequest; if (!accepts(r, "DRAFT")) return { refused: "AYAS_REVENUE_UDEMY_REQUEST_INVALID" };
    const data = r.operation === "COURSE_DRAFT" ? buildAyasCourseProductionPlan(r.payload) : r.operation === "MESSAGE_DRAFT" ? buildAyasUdemySupportDraft(r.payload) : null;
    if (data === null || (r.cursor != null)) return fail(r, "DRAFT_INVALID");
    return out(r, "OK", data);
  }
  return Object.freeze({ manifest: AYAS_UDEMY_MANIFEST, read, draft });
}
