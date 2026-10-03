/** SYNTHETIC catalog, scopes and projection; none of these names/schemas claim to be official Upwork tools. No network. */
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenueSensitiveText } from "../../src/lib/ayas/revenue/AyasRevenueRedaction";
import type { AyasRevenueOperation } from "../../src/lib/ayas/revenue/AyasRevenuePlatformTypes";
import type { AyasUpworkReadBinding, AyasUpworkTransportRequest } from "../../src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter";
import type { AyasUpworkKind, AyasUpworkReviewedTool } from "../../src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy";
export const UPWORK_NOW = "2026-10-03T12:00:00.000Z", UPWORK_ACCOUNT = "upwork-owner-main", UPWORK_SCOPE = "synthetic.owner.read";
export const UPWORK_MAP: readonly (readonly [AyasRevenueOperation, AyasUpworkKind])[] = [
  ["ACCOUNT_STATUS_READ", "ACCOUNT"], ["OPPORTUNITY_LIST_READ", "JOBS"], ["MESSAGE_LIST_READ", "INVITATIONS"],
  ["LISTING_LIST_READ", "PROPOSALS"], ["ORDER_LIST_READ", "CONTRACTS"], ["PAYOUT_LIST_READ", "EARNINGS"] ];
const inputSchema = { type: "object", properties: { query: { type: "string", maxLength: 80 }, limit: { type: "integer", minimum: 1, maximum: 25 } }, required: ["limit"], additionalProperties: false };
const outputSchema = { type: "object", properties: { fixtureProjection: { type: "object" } }, required: ["fixtureProjection"], additionalProperties: true };
const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export function upworkTool(kind: AyasUpworkKind = "JOBS", overrides: Record<string, unknown> = {}) { return { name: `synthetic_${kind.toLowerCase()}_read`, inputSchema: structuredClone(inputSchema),
  outputSchema: structuredClone(outputSchema), annotations: { ...annotations }, description: "Synthetic read metadata only", ...overrides }; }
export function upworkPin(operation: AyasRevenueOperation = "OPPORTUNITY_LIST_READ", kind: AyasUpworkKind = "JOBS", overrides: Partial<AyasUpworkReviewedTool> = {}): AyasUpworkReviewedTool {
  return { name: `synthetic_${kind.toLowerCase()}_read`, operation, kind, inputSchemaDigest: digestAyasRevenueData(inputSchema)!, outputSchemaDigest: digestAyasRevenueData(outputSchema)!,
    annotationsDigest: digestAyasRevenueData(annotations)!, scopes: [UPWORK_SCOPE], zeroCostVerified: true, ...overrides };
}
export function upworkBindings(): AyasUpworkReadBinding[] { return UPWORK_MAP.map(([operation, kind]) => ({ pin: upworkPin(operation, kind),
  argumentsFor: (payload, limit) => {
    if (payload === null) return { limit };
    if (kind !== "JOBS" || !isAyasRevenuePlainRecord(payload) || !hasExactAyasRevenueKeys(payload, ["query"]) || typeof payload.query !== "string"
      || !payload.query.trim() || payload.query.length > 80 || isAyasRevenueSensitiveText(payload.query) || !/^[\p{L}\p{N} -]+$/u.test(payload.query)) return null;
    return { query: payload.query, limit };
  },
  projectResult: (content) => isAyasRevenuePlainRecord(content) ? content.fixtureProjection : null })); }
export function upworkConnection(overrides: Record<string, unknown> = {}) { return { schemaVersion: "1", platform: "upwork", accountRef: UPWORK_ACCOUNT, label: "Owner Upwork account",
  credentialHandling: "CONNECTOR_MANAGED", credentialRef: "connector:upwork-owner", grantedScopes: [UPWORK_SCOPE], connectedAt: "2026-09-01T12:00:00.000Z",
  expiresAt: "2026-12-01T12:00:00.000Z", lastVerifiedAt: "2026-10-03T06:00:00.000Z", reauthRequired: false, ...overrides }; }
export const upworkMoney = (valueMinor: number, currency = "USD") => ({ valueMinor, currency });
export function upworkProjection(kind: AyasUpworkKind = "JOBS", overrides: Record<string, unknown> = {}) {
  const states = { ACCOUNT: "ACTIVE", JOBS: "OPEN", INVITATIONS: "PENDING", PROPOSALS: "SUBMITTED", CONTRACTS: "ACTIVE", EARNINGS: "SETTLED" };
  return { accountRef: UPWORK_ACCOUNT, kind, items: [{ ref: `fixture-${kind.toLowerCase()}-one`, state: states[kind], ...(kind === "JOBS" ? { title: "Design a city map" } : {}),
    ...(kind === "EARNINGS" ? { amounts: { gross: upworkMoney(10000), fee: null, payout: upworkMoney(8500) } } : {}) }], attribution: "Upwork", aiOrigin: false, metering: { remaining: 9 }, ...overrides };
}
export function upworkDraft(overrides: Record<string, unknown> = {}) { return { jobRef: "fixture-job-one", coverLetter: "I can design a clear city map with the agreed deliverables.",
  bid: upworkMoney(10000), milestones: [{ label: "Final map", amount: upworkMoney(10000) }], attachmentDigests: ["a".repeat(64)], rightsEvidenceDigest: "b".repeat(64), offerRevision: "c".repeat(64), ...overrides }; }
export function upworkFakeTransport(override?: (call: AyasUpworkTransportRequest) => unknown) {
  const calls: AyasUpworkTransportRequest[] = [];
  return { calls, transport: async (call: AyasUpworkTransportRequest) => {
    calls.push(call); if (override) return override(call);
    const found = UPWORK_MAP.find(([, k]) => call.toolName === `synthetic_${k.toLowerCase()}_read`);
    if (!found || !isAyasRevenueExternalId(UPWORK_ACCOUNT)) throw new Error("FIXTURE_TOOL_UNKNOWN");
    return { status: 200, isError: false, structuredContent: { fixtureProjection: upworkProjection(found[1]), clientEmail: "private@example.test", privateMessage: "Do not preserve this raw text", ownerApproved: true } };
  } };
}
