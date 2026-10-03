/** Stage16.6: pure local drafts. These are scenarios and owner-review material, never Fiverr publications. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { evaluateAyasRevenueFulfillment } from "../../AyasRevenueFulfillment";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenuePlainRecord,
  isAyasRevenueSensitiveText, snapshotAyasRevenueValue } from "../../AyasRevenueRedaction";
import type { AyasRevenueOperation } from "../../AyasRevenuePlatformTypes";

export function snapshotAyasFiverrValue(raw: unknown): unknown | null {
  try {
    if (!isAyasRevenueBoundedJson(raw, 65_536) || containsAyasRevenueSensitiveData(raw)) return null;
    const copy = snapshotAyasRevenueValue(raw);
    return copy.ok && isAyasRevenueBoundedJson(copy.value, 65_536) && !containsAyasRevenueSensitiveData(copy.value) ? deepFreezeAyasRevenueValue(copy.value) : null;
  } catch { return null; }
}
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max
  && !isAyasRevenueSensitiveText(v) && !/[\u0000-\u0008\u000b-\u001f]|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|link)\b/i.test(v);
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= min && (v as number) <= max;
const texts = (v: unknown, max: number, chars: number): v is string[] => isAyasRevenueDataArray(v, max) && v.every(x => text(x, chars)) && new Set(v).size === v.length;
const proof = (v: unknown) => v === null || isAyasRevenueDigest(v);
function gig(p: Record<string, unknown>): { draft: unknown; issues: string[]; preconditions: string[] } | null {
  if (!hasExactAyasRevenueKeys(p, ["title", "categoryCode", "description", "faq", "packages", "requirements", "tags", "mediaDigests", "rightsEvidenceDigest", "offerRevision"])
    || !text(p.title, 80) || !text(p.categoryCode, 64) || !/^[A-Za-z][A-Za-z0-9_-]+$/.test(p.categoryCode) || !text(p.description, 1200)
    || !isAyasRevenueDataArray(p.faq, 10) || !p.faq.every(f => isAyasRevenuePlainRecord(f) && hasExactAyasRevenueKeys(f, ["question", "answer"]) && text(f.question, 200) && text(f.answer, 500))
    || !isAyasRevenueDataArray(p.packages, 3) || p.packages.length === 0 || !texts(p.requirements, 10, 250) || !texts(p.tags, 5, 20)
    || !isAyasRevenueDataArray(p.mediaDigests, 3) || !p.mediaDigests.every(isAyasRevenueDigest) || new Set(p.mediaDigests).size !== p.mediaDigests.length
    || !proof(p.rightsEvidenceDigest) || !proof(p.offerRevision)) return null;
  const tiers = ["BASIC", "STANDARD", "PREMIUM"], seen = new Set<string>(); let lastPrice = 0;
  for (const pack of p.packages) {
    if (!isAyasRevenuePlainRecord(pack) || !hasExactAyasRevenueKeys(pack, ["tier", "name", "scope", "price", "deliveryDays", "revisions"])
      || !tiers.includes(pack.tier as string) || seen.has(pack.tier as string) || pack.tier !== tiers[seen.size] || !text(pack.name, 40) || !text(pack.scope, 300)
      || !isAyasRevenueScenarioMoney(pack.price) || pack.price.currency !== "USD" || pack.price.valueMinor < 500 || pack.price.valueMinor <= lastPrice
      || !integer(pack.deliveryDays, 1, 30) || !integer(pack.revisions, 1, 10)) return null;
    seen.add(pack.tier as string); lastPrice = pack.price.valueMinor;
  }
  return { draft: p, issues: [...(p.mediaDigests.length === 0 ? ["MEDIA_MISSING"] : []), ...(p.rightsEvidenceDigest === null ? ["RIGHTS_EVIDENCE_MISSING"] : []),
    ...(p.offerRevision === null ? ["FULFILLMENT_OFFER_PROOF_MISSING"] : [])], preconditions: ["CURRENT_CATEGORY_PRICE_AND_MEDIA_RULES", "FULFILLMENT_CAPACITY_AND_RIGHTS_REPROBE", "OWNER_GIG_REVIEW", "OWNER_PUBLISH_ON_FIVERR"] };
}
function message(p: Record<string, unknown>): { draft: unknown; issues: string[]; preconditions: string[] } | null {
  if (!hasExactAyasRevenueKeys(p, ["purpose", "conversationDigest", "orderDigest", "text", "unresolvedQuestions"])
    || !["ORDER_REPLY", "REQUIREMENTS_QUESTION", "REVISION_REPLY", "DELIVERY_NOTE"].includes(p.purpose as string) || !isAyasRevenueDigest(p.conversationDigest)
    || !proof(p.orderDigest) || (p.purpose !== "REQUIREMENTS_QUESTION" && p.orderDigest === null) || !text(p.text, 3000) || !texts(p.unresolvedQuestions, 10, 250)) return null;
  return { draft: p, issues: [], preconditions: ["EXISTING_CONVERSATION_OR_ORDER", "OWNER_CONTEXT_AND_PRIVACY_REVIEW", "OWNER_SEND_ON_FIVERR"] };
}
function delivery(p: Record<string, unknown>, now: string): { draft: unknown; issues: string[]; preconditions: string[] } | null {
  if (!hasExactAyasRevenueKeys(p, ["fulfillment", "message"]) || !text(p.message, 3000) || !isAyasRevenuePlainRecord(p.fulfillment)
    || !isAyasRevenuePlainRecord(p.fulfillment.order) || p.fulfillment.order.platform !== "fiverr") return null;
  const result = evaluateAyasRevenueFulfillment(p.fulfillment, now);
  if (result.status !== "HANDOFF_READY" || result.deliveryManifest === null || result.externalWrite !== false || result.deliversAutonomously !== false) return null;
  const orderDigest = digestAyasRevenueData({ platform: "fiverr", orderId: result.orderId });
  return { draft: { orderDigest, offerRevision: result.offerRevision, round: result.round, manifest: result.deliveryManifest, message: p.message,
    qualityReceiptDigest: digestAyasRevenueData(result), completion: "NOT_OBSERVED" }, issues: [], preconditions: ["OWNER_VERIFY_EXACT_FILE_HASHES", "OWNER_RIGHTS_AND_REQUIREMENTS_REVIEW", "OWNER_DELIVER_WORK_ON_FIVERR", "SEPARATE_COMPLETION_OBSERVATION"] };
}
export function buildAyasFiverrDraft(operation: AyasRevenueOperation, raw: unknown, now: string): unknown | null {
  const p = snapshotAyasFiverrValue(raw); if (!isAyasRevenuePlainRecord(p)) return null;
  const built = operation === "LISTING_DRAFT" ? gig(p) : operation === "MESSAGE_DRAFT" ? message(p) : operation === "DELIVERABLE_DRAFT" ? delivery(p, now) : null;
  if (built === null) return null;
  const draftDigest = digestAyasRevenueData(built.draft); if (draftDigest === null) return null;
  return deepFreezeAyasRevenueValue({ kind: operation === "LISTING_DRAFT" ? "GIG_DRAFT" : operation === "MESSAGE_DRAFT" ? "MESSAGE_DRAFT" : "DELIVERY_DRAFT",
    local: true, publication: "CLOSED", ownerReviewRequired: true, draft: built.draft, draftDigest, issues: built.issues, preconditions: built.preconditions });
}
