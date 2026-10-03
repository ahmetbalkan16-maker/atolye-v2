/** Stage16.3B: pure delivery-quality gate for one accepted order of a provable offer. No IO, delivery, message or ledger write. */
import { evaluateAyasZeroCost, parseAyasCostClass, type AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueNeutralCode } from "./AyasRevenueOpportunity";
import { digestAyasRevenueData, AYAS_REVENUE_REVISION_MAX_BYTES } from "./AyasRevenueDigest";
import { buildAyasRevenueOffer, type AyasRevenueOfferFactoryInput } from "./AyasRevenueOfferFactory";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
export const AYAS_REVENUE_FULFILLMENT_STATUSES = Object.freeze(["BLOCKED", "REQUIREMENTS_INCOMPLETE", "IN_PRODUCTION", "QA_REWORK_REQUIRED", "HANDOFF_READY",
  "AWAITING_OBSERVED_COMPLETION", "REVISION_REQUIRED", "OWNER_REVIEW_REQUIRED", "COMPLETED_OBSERVED"] as const);
export type AyasRevenueFulfillmentStatus = typeof AYAS_REVENUE_FULFILLMENT_STATUSES[number];
export interface AyasRevenueOrder {
  readonly orderId: string; readonly offerId: string; readonly offerRevision: string; readonly platform: AyasRevenuePlatform;
  readonly acceptedAt: string; readonly deadlineAt: string; readonly revisionsAllowed: number; readonly round: number;
  readonly deliverables: readonly { readonly code: string; readonly units: number }[];
}
export interface AyasRevenueFulfillmentArtifact {
  readonly deliverableCode: string; readonly round: number; readonly artifactDigest: string; readonly bytes: number; readonly mediaClass: string;
  readonly producedAt: string; readonly costClass: AyasCostClass; readonly rightsState: "CLEAR" | "UNKNOWN" | "BLOCKED"; readonly rightsEvidenceDigest: string | null;
  readonly attributionRequired: boolean; readonly attributionDigest: string | null;
}
export interface AyasRevenueQaReceipt {
  readonly artifactDigest: string; readonly checkCode: string; readonly state: "PASS" | "FAIL" | "UNMEASURED";
  readonly sourceClass: "DETERMINISTIC_CHECK" | "LOCAL_MEASUREMENT" | "OWNER_REVIEW" | "MODEL_OPINION"; readonly receiptDigest: string; readonly checkedAt: string;
}
export interface AyasRevenueFulfillmentInput {
  readonly schemaVersion: "1"; readonly offerInput: AyasRevenueOfferFactoryInput; readonly order: AyasRevenueOrder;
  readonly requirements: readonly { readonly deliverableCode: string; readonly code: string; readonly state: "COMPLETE" | "MISSING" | "AMBIGUOUS" | "OUT_OF_SCOPE"; readonly evidenceDigest: string | null }[];
  readonly artifacts: readonly AyasRevenueFulfillmentArtifact[]; readonly qa: readonly AyasRevenueQaReceipt[];
  readonly handoff: { readonly state: "NOT_STARTED" | "HANDED_OFF"; readonly manifestDigest: string | null; readonly handedOffAt: string | null; readonly evidenceDigest: string | null };
  readonly completion: { readonly state: "NOT_OBSERVED" | "ACCEPTED" | "REVISION_REQUESTED" | "DISPUTED" | "CANCELLED"; readonly sourceClass: "PLATFORM_READ" | "OWNER_INPUT" | null;
    readonly observedAt: string | null; readonly evidenceDigest: string | null };
}
export interface AyasRevenueDeliveryManifestItem { readonly deliverableCode: string; readonly artifactDigest: string; readonly bytes: number; readonly mediaClass: string }
export interface AyasRevenueFulfillmentResult {
  readonly schemaVersion: "1"; readonly status: AyasRevenueFulfillmentStatus; readonly authority: "NONE"; readonly deliversAutonomously: false; readonly externalWrite: false;
  readonly grantsSpendAuthority: false; readonly createsLedgerEntry: false; readonly realizedLedgerEligible: boolean; readonly reasonCodes: readonly string[];
  readonly orderId: string | null; readonly offerRevision: string | null; readonly round: number | null;
  readonly deliveryManifest: { readonly digest: string; readonly items: readonly AyasRevenueDeliveryManifestItem[] } | null;
  readonly deadline: { readonly state: "ON_TRACK" | "AT_RISK" | "MISSED" | "MET_AT_HANDOFF" | "MISSED_AT_HANDOFF"; readonly remainingMinutes: number; readonly plannedWorkMinutes: number } | null;
  readonly evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION";
}
const integer = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= lo && (v as number) <= hi;
const member = (v: unknown, choices: readonly unknown[]) => choices.includes(v);
const cost = (v: unknown): v is AyasCostClass => typeof v === "string" && parseAyasCostClass(v) === v;
const digestOrNull = (v: unknown) => v === null || isAyasRevenueDigest(v);
function order(v: unknown): v is AyasRevenueOrder {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["orderId", "offerId", "offerRevision", "platform", "acceptedAt", "deadlineAt", "revisionsAllowed", "round", "deliverables"])
    && isAyasRevenueExternalId(v.orderId) && isAyasRevenueExternalId(v.offerId) && isAyasRevenueDigest(v.offerRevision) && isAyasRevenuePlatform(v.platform)
    && isAyasRevenueTimestamp(v.acceptedAt) && isAyasRevenueTimestamp(v.deadlineAt) && integer(v.revisionsAllowed, 0, 10) && integer(v.round, 0, 10)
    && isAyasRevenueDataArray(v.deliverables, 20) && v.deliverables.length > 0 && v.deliverables.every(d => isAyasRevenuePlainRecord(d) && hasExactAyasRevenueKeys(d, ["code", "units"])
      && isAyasRevenueNeutralCode(d.code) && integer(d.units, 1, 100)) && new Set(v.deliverables.map(d => (d as { code: string }).code)).size === v.deliverables.length;
}
function artifact(v: unknown): v is AyasRevenueFulfillmentArtifact {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["deliverableCode", "round", "artifactDigest", "bytes", "mediaClass", "producedAt", "costClass", "rightsState", "rightsEvidenceDigest", "attributionRequired", "attributionDigest"])
    && isAyasRevenueNeutralCode(v.deliverableCode) && integer(v.round, 0, 10) && isAyasRevenueDigest(v.artifactDigest) && integer(v.bytes, 1, Number.MAX_SAFE_INTEGER) && isAyasRevenueNeutralCode(v.mediaClass)
    && isAyasRevenueTimestamp(v.producedAt) && cost(v.costClass) && member(v.rightsState, ["CLEAR", "UNKNOWN", "BLOCKED"]) && digestOrNull(v.rightsEvidenceDigest)
    && typeof v.attributionRequired === "boolean" && digestOrNull(v.attributionDigest);
}
function receipt(v: unknown): v is AyasRevenueQaReceipt {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["artifactDigest", "checkCode", "state", "sourceClass", "receiptDigest", "checkedAt"])
    && isAyasRevenueDigest(v.artifactDigest) && isAyasRevenueNeutralCode(v.checkCode) && member(v.state, ["PASS", "FAIL", "UNMEASURED"])
    && member(v.sourceClass, ["DETERMINISTIC_CHECK", "LOCAL_MEASUREMENT", "OWNER_REVIEW", "MODEL_OPINION"]) && isAyasRevenueDigest(v.receiptDigest) && isAyasRevenueTimestamp(v.checkedAt);
}
function valid(v: unknown): v is AyasRevenueFulfillmentInput {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "offerInput", "order", "requirements", "artifacts", "qa", "handoff", "completion"]) || v.schemaVersion !== "1"
    || !isAyasRevenuePlainRecord(v.offerInput) || !order(v.order)) return false;
  if (!isAyasRevenueDataArray(v.requirements, 100) || !v.requirements.every(r => isAyasRevenuePlainRecord(r) && hasExactAyasRevenueKeys(r, ["deliverableCode", "code", "state", "evidenceDigest"])
    && isAyasRevenueNeutralCode(r.deliverableCode) && isAyasRevenueNeutralCode(r.code) && member(r.state, ["COMPLETE", "MISSING", "AMBIGUOUS", "OUT_OF_SCOPE"]) && digestOrNull(r.evidenceDigest))
    || new Set(v.requirements.map(r => { const x = r as { deliverableCode: string; code: string }; return `${x.deliverableCode}\u0000${x.code}`; })).size !== v.requirements.length) return false;
  if (!isAyasRevenueDataArray(v.artifacts, 200) || !v.artifacts.every(artifact)
    || new Set(v.artifacts.map(a => { const x = a as { round: number; artifactDigest: string }; return `${x.round}:${x.artifactDigest}`; })).size !== v.artifacts.length) return false;
  if (!isAyasRevenueDataArray(v.qa, 400) || !v.qa.every(receipt) || new Set(v.qa.map(q => (q as { receiptDigest: string }).receiptDigest)).size !== v.qa.length) return false;
  const h = v.handoff, c = v.completion;
  if (!isAyasRevenuePlainRecord(h) || !hasExactAyasRevenueKeys(h, ["state", "manifestDigest", "handedOffAt", "evidenceDigest"]) || !isAyasRevenuePlainRecord(c)
    || !hasExactAyasRevenueKeys(c, ["state", "sourceClass", "observedAt", "evidenceDigest"])) return false;
  const handoffShape = h.state === "NOT_STARTED" ? [h.manifestDigest, h.handedOffAt, h.evidenceDigest].every(x => x === null)
    : h.state === "HANDED_OFF" && isAyasRevenueDigest(h.manifestDigest) && isAyasRevenueTimestamp(h.handedOffAt) && isAyasRevenueDigest(h.evidenceDigest);
  const completionShape = c.state === "NOT_OBSERVED" ? [c.sourceClass, c.observedAt, c.evidenceDigest].every(x => x === null)
    : member(c.state, ["ACCEPTED", "REVISION_REQUESTED", "DISPUTED", "CANCELLED"]) && member(c.sourceClass, ["PLATFORM_READ", "OWNER_INPUT"]) && isAyasRevenueTimestamp(c.observedAt) && isAyasRevenueDigest(c.evidenceDigest);
  return handoffShape && completionShape;
}
/** `now` is a trusted caller clock. Receipts are normalized input; this gate neither delivers files nor certifies their bytes. */
export function evaluateAyasRevenueFulfillment(raw: unknown, now: string): AyasRevenueFulfillmentResult {
  let orderId: string | null = null, offerRevision: string | null = null, round: number | null = null, realizedLedgerEligible = false;
  let deliveryManifest: AyasRevenueFulfillmentResult["deliveryManifest"] = null, deadline: AyasRevenueFulfillmentResult["deadline"] = null;
  const reasons = new Set<string>();
  const result = (status: AyasRevenueFulfillmentStatus, reason: string): AyasRevenueFulfillmentResult => {
    reasons.add(reason); return deepFreezeAyasRevenueValue({ schemaVersion: "1", status, authority: "NONE", deliversAutonomously: false, externalWrite: false, grantsSpendAuthority: false,
      createsLedgerEntry: false, realizedLedgerEligible, reasonCodes: [...reasons].sort(), orderId, offerRevision, round, deliveryManifest, deadline,
      evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION" });
  };
  try {
    if (!isAyasRevenueTimestamp(now) || !isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES) || !valid(raw)) return result("BLOCKED", "INVALID_FULFILLMENT_INPUT");
    const copied: unknown = structuredClone(raw); if (!valid(copied)) return result("BLOCKED", "INVALID_FULFILLMENT_INPUT"); const input = deepFreezeAyasRevenueValue(copied);
    const o = input.order, at = (t: string) => Date.parse(t), nowMs = at(now); orderId = o.orderId; offerRevision = o.offerRevision; round = o.round;
    const timesInPast = [o.acceptedAt, ...input.artifacts.map(a => a.producedAt), ...input.qa.map(q => q.checkedAt), input.handoff.handedOffAt, input.completion.observedAt].every(t => t === null || at(t) <= nowMs);
    const afterAcceptance = [input.handoff.handedOffAt, input.completion.observedAt].every(t => t === null || at(t) >= at(o.acceptedAt));
    if (!timesInPast || !afterAcceptance || at(o.deadlineAt) <= at(o.acceptedAt)) return result("BLOCKED", "INVALID_ORDER_TIMELINE");
    // The order must reference the exact offer revision that was provable when it was accepted.
    const offer = buildAyasRevenueOffer(input.offerInput, o.acceptedAt);
    if (offer.status !== "OWNER_REVIEW_READY" || offer.offer === null || offer.deliveryScenario === null) return result("BLOCKED", "OFFER_NOT_PROVEN_AT_ACCEPTANCE");
    if (offer.revision !== o.offerRevision || offer.offer.offerId !== o.offerId || !offer.offer.platformMappings.some(m => m.platform === o.platform)) return result("BLOCKED", "OFFER_REVISION_OR_PLATFORM_MISMATCH");
    const terms = offer.offer, planned = offer.deliveryScenario.workMinutes, codes = new Set(o.deliverables.map(d => d.code));
    if (o.deliverables.some(d => !terms.deliverables.some(t => t.code === d.code && d.units <= t.units)) || o.revisionsAllowed > terms.revisionSupport.maxRevisions || o.round > o.revisionsAllowed
      || at(o.deadlineAt) < at(o.acceptedAt) + terms.deliveryWindowMinutes * 60_000 || input.requirements.some(r => r.state === "OUT_OF_SCOPE")) return result("BLOCKED", "UNSUPPORTED_PROMISE");
    if (input.requirements.some(r => !codes.has(r.deliverableCode)) || input.artifacts.some(a => !codes.has(a.deliverableCode) || a.round > o.round)
      || input.qa.some(q => !input.artifacts.some(a => a.artifactDigest === q.artifactDigest && at(a.producedAt) <= at(q.checkedAt)))) return result("BLOCKED", "UNBOUND_FULFILLMENT_RECORD");
    const current = input.artifacts.filter(a => a.round === o.round);
    // Spend in any round is surfaced, not only in the round being delivered.
    if (input.artifacts.some(a => !evaluateAyasZeroCost(a.costClass).allowed)) return result("BLOCKED", "NONZERO_OR_UNKNOWN_FULFILLMENT_COST");
    if (current.some(a => a.rightsState === "BLOCKED")) return result("BLOCKED", "ARTIFACT_RIGHTS_BLOCKED");
    const receipts = (a: AyasRevenueFulfillmentArtifact) => input.qa.filter(q => q.artifactDigest === a.artifactDigest && at(q.checkedAt) >= at(a.producedAt));
    const failed = (a: AyasRevenueFulfillmentArtifact) => receipts(a).some(q => q.state === "FAIL");
    const passing = current.filter(a => a.rightsState === "CLEAR" && a.rightsEvidenceDigest !== null && (!a.attributionRequired || a.attributionDigest !== null) && !failed(a)
      && receipts(a).some(q => q.state === "PASS" && q.sourceClass !== "MODEL_OPINION"));
    const short = o.deliverables.filter(d => passing.filter(a => a.deliverableCode === d.code).length < d.units);
    const items = passing.map(a => ({ deliverableCode: a.deliverableCode, artifactDigest: a.artifactDigest, bytes: a.bytes, mediaClass: a.mediaClass }))
      .sort((x, y) => x.deliverableCode < y.deliverableCode ? -1 : x.deliverableCode > y.deliverableCode ? 1 : x.artifactDigest < y.artifactDigest ? -1 : x.artifactDigest > y.artifactDigest ? 1 : 0);
    const manifestDigest = short.length === 0 ? digestAyasRevenueData({ schemaVersion: "1", orderId: o.orderId, offerRevision: o.offerRevision, round: o.round, items }) : null;
    if (short.length === 0 && manifestDigest === null) return result("BLOCKED", "INVALID_FULFILLMENT_INPUT");
    const h = input.handoff, c = input.completion, remaining = Math.floor((at(o.deadlineAt) - nowMs) / 60_000);
    const requirementsComplete = o.deliverables.every(d => input.requirements.some(r => r.deliverableCode === d.code)) && input.requirements.every(r => r.state === "COMPLETE" && r.evidenceDigest !== null);
    if (h.state === "HANDED_OFF") {
      if (manifestDigest === null || !requirementsComplete) return result("BLOCKED", "HANDOFF_BEFORE_QUALITY_GATE");
      if (h.manifestDigest !== manifestDigest) return result("BLOCKED", "HANDOFF_MANIFEST_MISMATCH");
      if (c.state !== "NOT_OBSERVED" && at(c.observedAt!) < at(h.handedOffAt!)) return result("BLOCKED", "INVALID_ORDER_TIMELINE");
      deliveryManifest = { digest: manifestDigest, items };
      deadline = { state: at(h.handedOffAt!) <= at(o.deadlineAt) ? "MET_AT_HANDOFF" : "MISSED_AT_HANDOFF", remainingMinutes: remaining, plannedWorkMinutes: planned };
      if (c.state === "NOT_OBSERVED") return result("AWAITING_OBSERVED_COMPLETION", "OWNER_OR_PLATFORM_COMPLETION_NOT_OBSERVED");
      if (c.state === "ACCEPTED") { realizedLedgerEligible = true; return result("COMPLETED_OBSERVED", "REALIZED_MONEY_STILL_REQUIRES_LEDGER_EVIDENCE"); }
      if (c.state === "REVISION_REQUESTED") return o.round < o.revisionsAllowed ? result("REVISION_REQUIRED", "NEXT_ROUND_WITHIN_REVISION_BUDGET") : result("OWNER_REVIEW_REQUIRED", "REVISION_BUDGET_EXHAUSTED");
      return result("OWNER_REVIEW_REQUIRED", c.state === "DISPUTED" ? "ORDER_DISPUTED" : "ORDER_CANCELLED");
    }
    if (c.state === "ACCEPTED" || c.state === "REVISION_REQUESTED") return result("BLOCKED", "COMPLETION_WITHOUT_HANDOFF");
    deadline = { state: remaining < 0 ? "MISSED" : short.length > 0 && remaining < planned ? "AT_RISK" : "ON_TRACK", remainingMinutes: remaining, plannedWorkMinutes: planned };
    if (c.state !== "NOT_OBSERVED") return result("OWNER_REVIEW_REQUIRED", c.state === "DISPUTED" ? "ORDER_DISPUTED" : "ORDER_CANCELLED");
    if (deadline.state === "MISSED") {
      // A complete late order keeps its gated manifest, so a late handoff the owner chooses stays bound to exact files.
      if (manifestDigest !== null && requirementsComplete) deliveryManifest = { digest: manifestDigest, items };
      return result("OWNER_REVIEW_REQUIRED", "DEADLINE_MISSED");
    }
    if (deadline.state === "AT_RISK") reasons.add("DEADLINE_AT_RISK");
    if (!requirementsComplete) return result("REQUIREMENTS_INCOMPLETE", "OWNER_CLARIFICATION_REQUIRED");
    if (short.some(d => current.some(a => a.deliverableCode === d.code && failed(a)))) return result("QA_REWORK_REQUIRED", "FAILED_ARTIFACT_NOT_REPLACED");
    if (short.length > 0) return result("IN_PRODUCTION", "PASSING_ARTIFACTS_INCOMPLETE");
    deliveryManifest = { digest: manifestDigest!, items };
    return result("HANDOFF_READY", "OWNER_HANDOFF_REQUIRED");
  } catch { return result("BLOCKED", "INVALID_FULFILLMENT_INPUT"); }
}
