/** A draft handoff is not authority or completion evidence. Owner reports remain explicitly unverified observations. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDigest, isAyasRevenueDataArray } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";
import type { AyasRevenueOperation } from "../../AyasRevenuePlatformTypes";
import { snapshotAyasFiverrValue } from "./AyasFiverrDrafts";
export interface AyasFiverrOwnerHandoff {
  readonly handoffId: string; readonly operation: AyasRevenueOperation; readonly createdAt: string; readonly platform: "fiverr";
  readonly summary: string; readonly exactDraftDigest: string; readonly checklist: readonly string[]; readonly monetaryImpact: "NONE" | "UNKNOWN";
  readonly ownerMustPerform: true; readonly completedEvidence: null | { readonly observedAt: string; readonly externalReferenceDigest: string | null };
  readonly authority: "NONE"; readonly completionVerification: "NOT_OBSERVED" | "OWNER_REPORTED_UNVERIFIED";
}
const OPERATIONS = Object.freeze({ GIG_DRAFT: "LISTING_CREATE", MESSAGE_DRAFT: "MESSAGE_SEND", DELIVERY_DRAFT: "DELIVERABLE_SUBMIT" } as const);
function identity(operation: string, draftDigest: string, createdAt: string): string { return `fiverr-handoff-${digestAyasRevenueData({ platform: "fiverr", operation, draftDigest, createdAt })}`; }
export function createAyasFiverrOwnerHandoff(raw: unknown, now: string): AyasFiverrOwnerHandoff | null {
  const draft = snapshotAyasFiverrValue(raw);
  if (!isAyasRevenueTimestamp(now) || !isAyasRevenuePlainRecord(draft) || !hasExactAyasRevenueKeys(draft, ["kind", "local", "publication", "ownerReviewRequired", "draft", "draftDigest", "issues", "preconditions"])
    || !Object.hasOwn(OPERATIONS, draft.kind as string) || draft.local !== true || draft.publication !== "CLOSED" || draft.ownerReviewRequired !== true
    || !isAyasRevenueDigest(draft.draftDigest) || digestAyasRevenueData(draft.draft) !== draft.draftDigest || !isAyasRevenueDataArray(draft.preconditions, 16)
    || !draft.preconditions.every(p => typeof p === "string" && /^[A-Z][A-Z_]{2,79}$/.test(p))) return null;
  const operation = OPERATIONS[draft.kind as keyof typeof OPERATIONS];
  return deepFreezeAyasRevenueValue({ handoffId: identity(operation, draft.draftDigest, now), operation, createdAt: now, platform: "fiverr",
    summary: `Owner must review and perform ${operation} on Fiverr`, exactDraftDigest: draft.draftDigest, checklist: ["REVIEW_EXACT_DRAFT", ...(draft.preconditions as string[])],
    monetaryImpact: operation === "LISTING_CREATE" ? "UNKNOWN" : "NONE", ownerMustPerform: true, completedEvidence: null, authority: "NONE", completionVerification: "NOT_OBSERVED" });
}
export function observeAyasFiverrOwnerCompletion(raw: unknown, observation: unknown, now: string): AyasFiverrOwnerHandoff | null {
  const h = snapshotAyasFiverrValue(raw), o = snapshotAyasFiverrValue(observation);
  if (!isAyasRevenueTimestamp(now) || !isAyasRevenuePlainRecord(h) || !hasExactAyasRevenueKeys(h, ["handoffId", "operation", "createdAt", "platform", "summary", "exactDraftDigest", "checklist", "monetaryImpact", "ownerMustPerform", "completedEvidence", "authority", "completionVerification"])
    || h.platform !== "fiverr" || h.ownerMustPerform !== true || h.authority !== "NONE" || h.completedEvidence !== null || h.completionVerification !== "NOT_OBSERVED"
    || !Object.values(OPERATIONS).includes(h.operation as never) || !isAyasRevenueDigest(h.exactDraftDigest) || !isAyasRevenueTimestamp(h.createdAt)
    || h.handoffId !== identity(h.operation as string, h.exactDraftDigest, h.createdAt) || !isAyasRevenueDataArray(h.checklist, 17)
    || !h.checklist.every(c => typeof c === "string" && /^[A-Z][A-Z_]{2,79}$/.test(c)) || h.checklist[0] !== "REVIEW_EXACT_DRAFT"
    || h.summary !== `Owner must review and perform ${h.operation} on Fiverr` || h.monetaryImpact !== (h.operation === "LISTING_CREATE" ? "UNKNOWN" : "NONE")
    || !isAyasRevenuePlainRecord(o) || !hasExactAyasRevenueKeys(o, ["source", "handoffId", "exactDraftDigest", "observedAt", "externalReferenceDigest"])
    || o.source !== "OWNER_INPUT" || o.handoffId !== h.handoffId || o.exactDraftDigest !== h.exactDraftDigest || !isAyasRevenueTimestamp(o.observedAt)
    || Date.parse(o.observedAt) < Date.parse(h.createdAt) || Date.parse(o.observedAt) > Date.parse(now)
    || !(o.externalReferenceDigest === null || isAyasRevenueDigest(o.externalReferenceDigest))) return null;
  return deepFreezeAyasRevenueValue({ ...h, completedEvidence: { observedAt: o.observedAt, externalReferenceDigest: o.externalReferenceDigest }, completionVerification: "OWNER_REPORTED_UNVERIFIED" }) as unknown as AyasFiverrOwnerHandoff;
}
