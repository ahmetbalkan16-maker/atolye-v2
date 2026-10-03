/** Stage16.6: standard MANUAL_HANDOFF permits local drafts only. Owner fact imports live in a separate pure module. */
import { AYAS_REVENUE_SCHEMA_VERSION, type AyasRevenueAdapterManifest, type AyasRevenueAdapterRequest } from "../../AyasRevenuePlatformTypes";
import { isAyasRevenueRequestShape } from "../../AyasRevenueActionPolicy";
import type { AyasRevenuePlatformAdapter } from "../../AyasRevenuePlatformAdapter";
import { buildAyasFiverrDraft, snapshotAyasFiverrValue } from "./AyasFiverrDrafts";
import { createAyasFiverrOwnerHandoff } from "./AyasFiverrOwnerHandoff";
export const AYAS_FIVERR_MANIFEST: AyasRevenueAdapterManifest = Object.freeze({ schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, platform: "fiverr", adapterId: "ayas-fiverr-manual-handoff", adapterVersion: 1,
  transport: "MANUAL_HANDOFF", locality: "EXTERNAL", credentialHandling: "NONE", costClass: "local-zero-cost", supportedOperations: Object.freeze(["LISTING_DRAFT", "MESSAGE_DRAFT", "DELIVERABLE_DRAFT"] as const),
  writeOperationsRequireOwnerApproval: true, financialOperationsAutonomous: false });
export function createAyasFiverrManualAdapter(now: () => string = () => new Date().toISOString()): AyasRevenuePlatformAdapter {
  if (typeof now !== "function") throw Error("AYAS_FIVERR_OPTIONS_INVALID");
  const envelope = (r: AyasRevenueAdapterRequest, status: "OK" | "BLOCKED" | "UNAVAILABLE", data: unknown = null, error?: string) => ({
    schemaVersion: AYAS_REVENUE_SCHEMA_VERSION, requestId: r.requestId, platform: "fiverr", operation: r.operation, status, observedAt: now(), data, nextCursor: null,
    evidence: { transport: "MANUAL_HANDOFF", externalMutation: false, monetaryMutation: false }, ...(error ? { errorCode: `AYAS_REVENUE_FIVERR_${error}` } : {}) });
  async function read(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasFiverrValue(raw);
    return isAyasRevenueRequestShape(r) && r.platform === "fiverr" ? envelope(r, "UNAVAILABLE", null, "UNAVAILABLE_OFFICIAL_TRANSPORT") : { refused: "AYAS_REVENUE_FIVERR_REQUEST_INVALID" };
  }
  async function draft(raw: AyasRevenueAdapterRequest): Promise<unknown> {
    const r = snapshotAyasFiverrValue(raw);
    if (!isAyasRevenueRequestShape(r) || r.platform !== "fiverr" || r.mode !== "DRAFT") return { refused: "AYAS_REVENUE_FIVERR_REQUEST_INVALID" };
    if (!AYAS_FIVERR_MANIFEST.supportedOperations.includes(r.operation)) return envelope(r, "UNAVAILABLE", null, "UNAVAILABLE_OFFICIAL_TRANSPORT");
    const at = now(), prepared = buildAyasFiverrDraft(r.operation, r.payload, at), handoff = prepared === null ? null : createAyasFiverrOwnerHandoff(prepared, at);
    return prepared === null || handoff === null ? envelope(r, "BLOCKED", null, "DRAFT_INVALID") : envelope(r, "OK", { prepared, handoff });
  }
  return Object.freeze({ manifest: AYAS_FIVERR_MANIFEST, read, draft });
}
