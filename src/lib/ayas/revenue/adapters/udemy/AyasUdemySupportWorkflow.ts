/** Only owner-facing reply drafts; no upstream body, recipient PII, transport or submission method. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { isAyasRevenueDigest } from "../../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord } from "../../AyasRevenueRedaction";
import { courseText, snapshotAyasCourseValue } from "../../content/AyasCourseProductionPlan";
export function buildAyasUdemySupportDraft(raw: unknown): unknown | null {
  const p = snapshotAyasCourseValue(raw);
  if (!isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["kind", "targetRefDigest", "contextDigest", "topicCode", "replyText"])
    || !["QUESTION_REPLY", "MESSAGE_REPLY"].includes(p.kind as string) || !isAyasRevenueDigest(p.targetRefDigest) || !isAyasRevenueDigest(p.contextDigest)
    || typeof p.topicCode !== "string" || !/^[A-Z][A-Z_]{2,31}$/.test(p.topicCode) || !courseText(p.replyText, 3000) || /[<>]/.test(p.replyText)) return null;
  return deepFreezeAyasRevenueValue({ kind: "SUPPORT_REPLY_DRAFT", draft: p, draftDigest: digestAyasRevenueData(p), local: true,
    ownerReviewRequired: true, retention: "CURRENT_OWNER_DRAFT_ONLY", submission: "CLOSED", grantsAuthority: false });
}
