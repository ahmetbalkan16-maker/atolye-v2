/** Stage16.5: owner-triggered, pinned MCP reads and inert local drafts. No production registration, fallback or executor. */
import { AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueAdapterManifest, type AyasRevenueAdapterRequest } from "../../AyasRevenuePlatformTypes";
import type { AyasRevenuePlatformAdapter } from "../../AyasRevenuePlatformAdapter";
import { ayasRevenueEffect, isAyasRevenueRequestShape } from "../../AyasRevenueActionPolicy";
import { gateAyasRevenueRequestConnection, type AyasRevenueScopeMap } from "../../AyasRevenueAccountConnection";
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord,
  isAyasRevenueSensitiveText } from "../../AyasRevenueRedaction";
import { allowAyasUpworkWorkflow, AYAS_UPWORK_MCP_ENDPOINT, AYAS_UPWORK_PAGE_LIMIT, inspectAyasUpworkTool,
  snapshotAyasUpworkData, snapshotAyasUpworkReviewedTools, type AyasUpworkReviewedTool, type AyasUpworkWorkflow } from "./AyasUpworkMcpPolicy";
import { normalizeAyasUpworkProjection } from "./AyasUpworkMapper";

export interface AyasUpworkTransportRequest { readonly endpoint: typeof AYAS_UPWORK_MCP_ENDPOINT; readonly toolName: string; readonly arguments: unknown }
/** Connector holds OAuth. A source-reviewed bridge extracts HTTP status and MCP structured result, never text instructions. */
export type AyasUpworkTransport = (request: AyasUpworkTransportRequest) => Promise<unknown>;
export interface AyasUpworkReadBinding {
  readonly pin: AyasUpworkReviewedTool;
  /** Code-owned official-schema argument builder and projector, not model- or tools/list-provided callbacks. */
  readonly argumentsFor: (payload: unknown, limit: number) => unknown;
  readonly projectResult: (structuredContent: unknown) => unknown;
}
export interface AyasUpworkAdapterOptions {
  readonly transport: AyasUpworkTransport; readonly accountRef: string; readonly connection: unknown; readonly observedScopes: readonly string[] | null;
  readonly discover: () => Promise<unknown>; readonly authorizeOwnerRead: () => boolean; readonly workflow: AyasUpworkWorkflow;
  /** Trusted source configuration. Production catalog is empty pending owner OAuth qualification; fixture bindings are synthetic. */
  readonly bindings?: readonly AyasUpworkReadBinding[]; readonly now?: () => string;
}
export const AYAS_UPWORK_MANIFEST: AyasRevenueAdapterManifest = Object.freeze({ schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, platform: "upwork",
  adapterId: "ayas-upwork-official-mcp", adapterVersion: 1, transport: "PLUGIN", locality: "EXTERNAL", credentialHandling: "CONNECTOR_MANAGED",
  costClass: "local-zero-cost", supportedOperations: Object.freeze(["PROPOSAL_DRAFT"] as const), writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false });

function proposalDraft(raw: unknown): unknown | null {
  const p = snapshotAyasUpworkData(raw);
  if (!isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["jobRef", "coverLetter", "bid", "milestones", "attachmentDigests", "rightsEvidenceDigest", "offerRevision"])
    || !isAyasRevenueExternalId(p.jobRef) || typeof p.coverLetter !== "string" || p.coverLetter.trim().length < 10 || p.coverLetter.length > 5000
    || /[\u0000-\u0008\u000b-\u001f]|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|link)\b/i.test(p.coverLetter)
    || isAyasRevenueSensitiveText(p.coverLetter) || !isAyasRevenueScenarioMoney(p.bid) || p.bid.valueMinor < 1
    || !isAyasRevenueDataArray(p.milestones, 10) || !isAyasRevenueDataArray(p.attachmentDigests, 10) || !p.attachmentDigests.every(isAyasRevenueDigest)
    || new Set(p.attachmentDigests).size !== p.attachmentDigests.length || !(p.rightsEvidenceDigest === null || isAyasRevenueDigest(p.rightsEvidenceDigest))
    || !(p.offerRevision === null || isAyasRevenueDigest(p.offerRevision))) return null;
  let total = 0;
  for (const m of p.milestones) {
    if (!isAyasRevenuePlainRecord(m) || !hasExactAyasRevenueKeys(m, ["label", "amount"]) || typeof m.label !== "string" || !m.label.trim() || m.label.length > 120
      || isAyasRevenueSensitiveText(m.label) || !isAyasRevenueScenarioMoney(m.amount) || m.amount.valueMinor < 1 || m.amount.currency !== p.bid.currency) return null;
    total += m.amount.valueMinor;
  }
  if (p.milestones.length > 0 && total !== p.bid.valueMinor) return null;
  const draft = { kind: "PROPOSAL_DRAFT", local: true, draft: p, draftDigest: digestAyasRevenueData(p), publication: "CLOSED", aiAuthored: true,
    issues: [...(p.rightsEvidenceDigest === null ? ["RIGHTS_EVIDENCE_MISSING"] : []), ...(p.offerRevision === null ? ["OFFER_REVISION_MISSING"] : [])],
    publicationRequires: ["OWNER_REVIEW", "EXACT_JOB_AND_COMMERCIAL_TERMS", "CONNECTS_AND_BOOST_COST_VERIFIED", "SCHEMA_AND_CONNECTION_REPROBE", "ONE_SHOT_IDEMPOTENCY", "UPWORK_CONFIRMATION"] };
  return containsAyasRevenueSensitiveData(draft) ? null : draft;
}

export function createAyasUpworkAdapter(options: AyasUpworkAdapterOptions): AyasRevenuePlatformAdapter {
  if (!isAyasRevenuePlainRecord(options) || typeof options.transport !== "function" || typeof options.discover !== "function" || typeof options.authorizeOwnerRead !== "function"
    || !isAyasRevenueExternalId(options.accountRef) || (options.now !== undefined && typeof options.now !== "function")) throw new Error("AYAS_UPWORK_OPTIONS_INVALID");
  const supplied = options.bindings ?? [], bindings: AyasUpworkReadBinding[] = [];
  if (!isAyasRevenueDataArray(supplied, 16)) throw new Error("AYAS_UPWORK_BINDINGS_INVALID");
  for (const b of supplied) {
    if (!isAyasRevenuePlainRecord(b) || !hasExactAyasRevenueKeys(b, ["pin", "argumentsFor", "projectResult"]) || typeof b.argumentsFor !== "function" || typeof b.projectResult !== "function") throw new Error("AYAS_UPWORK_BINDINGS_INVALID");
    const pins = snapshotAyasUpworkReviewedTools([b.pin]);
    if (!pins || ayasRevenueEffect(pins[0]!.operation) !== "READ_ONLY" || pins[0]!.zeroCostVerified !== true) throw new Error("AYAS_UPWORK_BINDINGS_INVALID");
    bindings.push(Object.freeze({ pin: pins[0]!, argumentsFor: b.argumentsFor, projectResult: b.projectResult }));
  }
  const validated = snapshotAyasUpworkReviewedTools(bindings.map(b => b.pin));
  if (!validated) throw new Error("AYAS_UPWORK_BINDINGS_INVALID");
  const pins = validated;
  // Unqualified production reads remain unsupported. No discovered name can populate this catalog.
  const qualified = bindings.length > 0, reads = pins.map(p => p.operation), operations = Object.freeze([...reads, "PROPOSAL_DRAFT" as const]);
  const manifest: AyasRevenueAdapterManifest = Object.freeze({ ...AYAS_UPWORK_MANIFEST, costClass: qualified ? "free-public" : "local-zero-cost", supportedOperations: operations });
  const scopeMap: AyasRevenueScopeMap = Object.freeze(Object.fromEntries(pins.map(p => [p.operation, p.scopes])));
  const { transport, accountRef, discover, authorizeOwnerRead, workflow } = options, now = options.now ?? (() => new Date().toISOString());
  const connection = snapshotAyasUpworkData(options.connection), observedScopes = snapshotAyasUpworkData(options.observedScopes) as readonly string[] | null;
  const envelope = (r: AyasRevenueAdapterRequest, status: "OK" | "EMPTY" | "BLOCKED" | "UNAVAILABLE" | "ERROR", data: unknown = null, why?: string) => ({
    schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, requestId: r.requestId, platform: "upwork", operation: r.operation, status, observedAt: now(), data, nextCursor: null,
    evidence: { transport: "PLUGIN", externalMutation: false, monetaryMutation: false }, ...(why ? { errorCode: `AYAS_REVENUE_UPWORK_${why}` } : {}) });
  async function read(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const request = snapshotAyasUpworkData(raw);
    if (!isAyasRevenueRequestShape(request) || request.platform !== "upwork" || request.mode !== "READ") return { refused: "AYAS_REVENUE_UPWORK_REQUEST_INVALID" };
    const binding = bindings.find(b => b.pin.operation === request.operation);
    if (!binding) return envelope(request, "BLOCKED", null, "TOOL_UNQUALIFIED");
    try { if (!allowAyasUpworkWorkflow(workflow) || authorizeOwnerRead() !== true) return envelope(request, "BLOCKED", null, "OWNER_INTERACTIVE_REQUIRED"); }
    catch { return envelope(request, "BLOCKED", null, "OWNER_INTERACTIVE_REQUIRED"); }
    const gate = gateAyasRevenueRequestConnection(request, connection, { now: now(), operations, scopeMap, observedScopes });
    if (gate.gate !== "CONNECTION_OK" || request.accountRef !== accountRef) return envelope(request, "BLOCKED", null, "CONNECTION_REFUSED");
    if (request.cursor !== undefined && request.cursor !== null || (request.limit ?? 10) > AYAS_UPWORK_PAGE_LIMIT) return envelope(request, "BLOCKED", null, "PAGE_BOUND");
    let tools: unknown, args: unknown;
    try { tools = snapshotAyasUpworkData(await discover()); args = snapshotAyasUpworkData(binding.argumentsFor(request.payload ?? null, request.limit ?? 10)); }
    catch { return envelope(request, "ERROR", null, "DISCOVERY_OR_PLAN_FAILED"); }
    if (!isAyasRevenueDataArray(tools, 128) || !tools.every(isAyasRevenuePlainRecord) || new Set(tools.map(t => (t as Record<string, unknown>).name)).size !== tools.length
      || !tools.some(t => isAyasRevenuePlainRecord(t) && t.name === binding.pin.name && inspectAyasUpworkTool(t, pins) === "READ_PIN_MATCH")) return envelope(request, "BLOCKED", null, "TOOL_SCHEMA_DRIFT");
    if (!isAyasRevenuePlainRecord(args) || containsAyasRevenueSensitiveData(args)) return envelope(request, "BLOCKED", null, "PAYLOAD_INVALID");
    // Discovery is async: owner authorization and connection freshness can change while awaiting it.
    try { if (authorizeOwnerRead() !== true || gateAyasRevenueRequestConnection(request, connection, { now: now(), operations, scopeMap, observedScopes }).gate !== "CONNECTION_OK")
      return envelope(request, "BLOCKED", null, "CONNECTION_OR_OWNER_CHANGED"); }
    catch { return envelope(request, "BLOCKED", null, "CONNECTION_OR_OWNER_CHANGED"); }
    let answer: unknown;
    try { answer = snapshotAyasUpworkData(await transport(deepFreezeAyasRevenueValue({ endpoint: AYAS_UPWORK_MCP_ENDPOINT, toolName: binding.pin.name, arguments: args }))); }
    catch { return envelope(request, "ERROR", null, "TRANSPORT_FAILED"); }
    if (!isAyasRevenuePlainRecord(answer) || !hasExactAyasRevenueKeys(answer, ["status", "isError", "structuredContent"]) || !Number.isSafeInteger(answer.status)
      || typeof answer.isError !== "boolean") return envelope(request, "ERROR", null, "RESPONSE_INVALID");
    if (answer.status === 429) return envelope(request, "UNAVAILABLE", null, "RATE_LIMITED");
    if (answer.status === 401 || answer.status === 403) return envelope(request, "BLOCKED", null, "AUTH_OR_SCOPE_REFUSED");
    if ((answer.status as number) >= 500 && (answer.status as number) <= 599) return envelope(request, "UNAVAILABLE", null, "UPSTREAM_UNAVAILABLE");
    if (answer.status !== 200 || answer.isError !== false) return envelope(request, "ERROR", null, "MCP_TOOL_ERROR");
    let projected: unknown;
    try { projected = normalizeAyasUpworkProjection(binding.projectResult(answer.structuredContent), binding.pin.kind, accountRef, request.limit ?? 10); }
    catch { return envelope(request, "ERROR", null, "PROJECTION_FAILED"); }
    if (!isAyasRevenuePlainRecord(projected)) return envelope(request, "ERROR", null, "RESPONSE_INVALID");
    return (projected.items as unknown[]).length === 0 ? envelope(request, "EMPTY") : envelope(request, "OK", projected);
  }
  async function draft(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const request = snapshotAyasUpworkData(raw);
    if (!isAyasRevenueRequestShape(request) || request.platform !== "upwork" || request.mode !== "DRAFT" || request.operation !== "PROPOSAL_DRAFT") return { refused: "AYAS_REVENUE_UPWORK_REQUEST_INVALID" };
    const data = proposalDraft(request.payload);
    return data === null ? envelope(request, "BLOCKED", null, "DRAFT_INVALID") : envelope(request, "OK", data);
  }
  return Object.freeze({ manifest, read, draft });
}
