/** Stage16.3A: source-only offer drafts, bounded by measured normalized fulfillment proof. No IO or selling. */
import { evaluateAyasZeroCost, parseAyasCostClass, type AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueNeutralCode } from "./AyasRevenueOpportunity";
import { digestAyasRevenueData, AYAS_REVENUE_REVISION_MAX_BYTES } from "./AyasRevenueDigest";
import { validateAyasRevenueFreeFirst, type AyasRevenueValidationInput, type AyasRevenueValidationResult } from "./AyasRevenueValidation";
import type { AyasRevenueScenarioValue } from "./AyasRevenueScenarioEconomics";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
export const AYAS_REVENUE_OFFER_PROOF_MAX_AGE_DAYS = 7;
export const AYAS_REVENUE_OFFER_TIME_BUFFER = 1.5;
export const AYAS_REVENUE_OFFER_DRAFT_OPERATION: Readonly<Record<AyasRevenuePlatform, "LISTING_DRAFT" | "PROPOSAL_DRAFT" | "COURSE_DRAFT">> = Object.freeze({
  etsy: "LISTING_DRAFT", upwork: "PROPOSAL_DRAFT", fiverr: "LISTING_DRAFT", udemy: "COURSE_DRAFT", "lemon-squeezy": "LISTING_DRAFT",
});
export interface AyasRevenueOfferSpec {
  readonly schemaVersion: "1"; readonly offerId: string; readonly opportunityId: string; readonly valuePropositionCode: string; readonly customerSegmentCode: string;
  readonly createdAt: string; readonly deliverables: readonly { readonly code: string; readonly deliverableClass: string; readonly capabilityKey: string; readonly units: number }[];
  readonly revisionSupport: { readonly maxRevisions: number; readonly supportMinutes: number; readonly supportWindowDays: number };
  readonly deliveryWindowMinutes: number;
  readonly platformMappings: readonly { readonly platform: AyasRevenuePlatform; readonly operation: "LISTING_DRAFT" | "PROPOSAL_DRAFT" | "COURSE_DRAFT"; readonly templateCode: string }[];
}
export interface AyasRevenueFulfillmentProof {
  readonly portfolioId: string; readonly offerClass: string; readonly deliverableClass: string; readonly capabilityKey: string;
  readonly capabilityProofDigest: string; readonly deliverableEvidenceDigest: string; readonly artifactDigest: string;
  readonly qualityReceiptDigest: string; readonly qualityState: "PASS" | "FAIL" | "UNMEASURED";
  readonly rightsEvidenceDigest: string; readonly rightsState: "CLEAR" | "UNKNOWN" | "BLOCKED";
  readonly attributionRequired: boolean; readonly attributionDigest: string | null;
  readonly sourceClass: "LOCAL_MEASUREMENT" | "DETERMINISTIC_CHECK" | "MODEL_OPINION"; readonly costClass: AyasCostClass;
  readonly measuredUnits: number; readonly measuredMinutes: number; readonly observedAt: string; readonly freshUntil: string;
}
export type AyasRevenueOfferCapacity =
  | { readonly state: "MEASURED"; readonly windowMinutes: number; readonly maxWorkMinutes: number; readonly committedWorkMinutes: number; readonly observedAt: string; readonly evidenceDigest: string }
  | { readonly state: "UNKNOWN"; readonly windowMinutes: null; readonly maxWorkMinutes: null; readonly committedWorkMinutes: null; readonly observedAt: null; readonly evidenceDigest: null };
export interface AyasRevenueOfferFactoryInput {
  readonly schemaVersion: "1"; readonly offer: AyasRevenueOfferSpec; readonly validationInput: AyasRevenueValidationInput;
  readonly fulfillmentProofs: readonly AyasRevenueFulfillmentProof[];
  readonly portfolio: readonly { readonly portfolioId: string; readonly artifactDigest: string; readonly deliverableClass: string; readonly capabilityKey: string; readonly sourceClass: "LOCAL_ARTIFACT" | "MODEL_DESCRIPTION" }[];
  readonly capacity: AyasRevenueOfferCapacity;
}
export interface AyasRevenueOfferFactoryResult {
  readonly schemaVersion: "1"; readonly status: "BLOCKED" | "DRAFT_INCOMPLETE" | "OWNER_REVIEW_READY"; readonly authority: "NONE";
  readonly sellableAutonomously: false; readonly externalWrite: false; readonly grantsSpendAuthority: false;
  readonly revision: string | null; readonly reasonCodes: readonly string[]; readonly validation: AyasRevenueValidationResult | null;
  readonly offer: (AyasRevenueOfferSpec & { readonly priceScenario: AyasRevenueScenarioValue }) | null;
  readonly deliveryScenario: { readonly label: "ASSUMED"; readonly workMinutes: number; readonly occupiedWindowMinutes: number; readonly reservedCapacity: false } | null;
  readonly evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION";
}
const integer = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= lo && (v as number) <= hi;
const member = (v: unknown, choices: readonly unknown[]) => choices.includes(v);
const cost = (v: unknown): v is AyasCostClass => typeof v === "string" && parseAyasCostClass(v) === v;
function spec(v: unknown): v is AyasRevenueOfferSpec {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "offerId", "opportunityId", "valuePropositionCode", "customerSegmentCode", "createdAt", "deliverables", "revisionSupport", "deliveryWindowMinutes", "platformMappings"])) return false;
  const r = v.revisionSupport;
  return v.schemaVersion === "1" && isAyasRevenueExternalId(v.offerId) && isAyasRevenueExternalId(v.opportunityId) && isAyasRevenueNeutralCode(v.valuePropositionCode)
    && isAyasRevenueNeutralCode(v.customerSegmentCode) && isAyasRevenueTimestamp(v.createdAt) && integer(v.deliveryWindowMinutes, 1, 43_200)
    && isAyasRevenueDataArray(v.deliverables, 20) && v.deliverables.length > 0 && v.deliverables.every(d => isAyasRevenuePlainRecord(d)
      && hasExactAyasRevenueKeys(d, ["code", "deliverableClass", "capabilityKey", "units"]) && isAyasRevenueNeutralCode(d.code) && isAyasRevenueNeutralCode(d.deliverableClass) && isAyasRevenueNeutralCode(d.capabilityKey) && integer(d.units, 1, 100))
    && new Set(v.deliverables.map(d => (d as { code: string }).code)).size === v.deliverables.length
    && isAyasRevenuePlainRecord(r) && hasExactAyasRevenueKeys(r, ["maxRevisions", "supportMinutes", "supportWindowDays"]) && integer(r.maxRevisions, 0, 10) && integer(r.supportMinutes, 0, 1440) && integer(r.supportWindowDays, 0, 365)
    && isAyasRevenueDataArray(v.platformMappings, 5) && v.platformMappings.length > 0 && v.platformMappings.every(m => isAyasRevenuePlainRecord(m) && hasExactAyasRevenueKeys(m, ["platform", "operation", "templateCode"])
      && isAyasRevenuePlatform(m.platform) && m.operation === AYAS_REVENUE_OFFER_DRAFT_OPERATION[m.platform] && isAyasRevenueNeutralCode(m.templateCode))
    && new Set(v.platformMappings.map(m => (m as { platform: string }).platform)).size === v.platformMappings.length;
}
function proof(v: unknown): v is AyasRevenueFulfillmentProof {
  return isAyasRevenuePlainRecord(v) && hasExactAyasRevenueKeys(v, ["portfolioId", "offerClass", "deliverableClass", "capabilityKey", "capabilityProofDigest", "deliverableEvidenceDigest", "artifactDigest", "qualityReceiptDigest", "qualityState", "rightsEvidenceDigest", "rightsState", "attributionRequired", "attributionDigest", "sourceClass", "costClass", "measuredUnits", "measuredMinutes", "observedAt", "freshUntil"])
    && isAyasRevenueExternalId(v.portfolioId) && isAyasRevenueNeutralCode(v.offerClass) && isAyasRevenueNeutralCode(v.deliverableClass) && isAyasRevenueNeutralCode(v.capabilityKey)
    && [v.capabilityProofDigest, v.deliverableEvidenceDigest, v.artifactDigest, v.qualityReceiptDigest, v.rightsEvidenceDigest].every(isAyasRevenueDigest)
    && member(v.qualityState, ["PASS", "FAIL", "UNMEASURED"]) && member(v.rightsState, ["CLEAR", "UNKNOWN", "BLOCKED"])
    && typeof v.attributionRequired === "boolean" && (v.attributionDigest === null || isAyasRevenueDigest(v.attributionDigest))
    && member(v.sourceClass, ["LOCAL_MEASUREMENT", "DETERMINISTIC_CHECK", "MODEL_OPINION"]) && cost(v.costClass)
    && integer(v.measuredUnits, 1, 10_000) && integer(v.measuredMinutes, 1, 43_200) && isAyasRevenueTimestamp(v.observedAt) && isAyasRevenueTimestamp(v.freshUntil) && Date.parse(v.freshUntil) >= Date.parse(v.observedAt);
}
function valid(v: unknown): v is AyasRevenueOfferFactoryInput {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "offer", "validationInput", "fulfillmentProofs", "portfolio", "capacity"]) || v.schemaVersion !== "1" || !spec(v.offer)
    || !isAyasRevenuePlainRecord(v.validationInput) || !isAyasRevenueDataArray(v.fulfillmentProofs, 40) || !v.fulfillmentProofs.every(proof)
    || new Set(v.fulfillmentProofs.map(p => (p as { portfolioId: string }).portfolioId)).size !== v.fulfillmentProofs.length) return false;
  if (!isAyasRevenueDataArray(v.portfolio, 40) || !v.portfolio.every(p => isAyasRevenuePlainRecord(p) && hasExactAyasRevenueKeys(p, ["portfolioId", "artifactDigest", "deliverableClass", "capabilityKey", "sourceClass"])
    && isAyasRevenueExternalId(p.portfolioId) && isAyasRevenueDigest(p.artifactDigest) && isAyasRevenueNeutralCode(p.deliverableClass) && isAyasRevenueNeutralCode(p.capabilityKey) && member(p.sourceClass, ["LOCAL_ARTIFACT", "MODEL_DESCRIPTION"]))
    || new Set(v.portfolio.map(p => (p as { portfolioId: string }).portfolioId)).size !== v.portfolio.length || new Set(v.portfolio.map(p => (p as { artifactDigest: string }).artifactDigest)).size !== v.portfolio.length) return false;
  const c = v.capacity;
  if (!isAyasRevenuePlainRecord(c) || !hasExactAyasRevenueKeys(c, ["state", "windowMinutes", "maxWorkMinutes", "committedWorkMinutes", "observedAt", "evidenceDigest"])) return false;
  return c.state === "UNKNOWN" ? [c.windowMinutes, c.maxWorkMinutes, c.committedWorkMinutes, c.observedAt, c.evidenceDigest].every(x => x === null)
    : c.state === "MEASURED" && integer(c.windowMinutes, 1, 43_200) && integer(c.maxWorkMinutes, 0, 43_200) && integer(c.committedWorkMinutes, 0, 43_200) && isAyasRevenueTimestamp(c.observedAt) && isAyasRevenueDigest(c.evidenceDigest);
}
const currentProof = (observed: string, expires: string, now: string): boolean => Date.parse(observed) <= Date.parse(now)
  && Date.parse(now) <= Math.min(Date.parse(expires), Date.parse(observed) + AYAS_REVENUE_OFFER_PROOF_MAX_AGE_DAYS * 86_400_000);
/** Receipts must be collected by trusted read-only callers. This function does not attest bytes or reserve delivery slots. */
export function buildAyasRevenueOffer(raw: unknown, now: string): AyasRevenueOfferFactoryResult {
  let revision: string | null = null, validation: AyasRevenueValidationResult | null = null, offer: AyasRevenueOfferFactoryResult["offer"] = null, deliveryScenario: AyasRevenueOfferFactoryResult["deliveryScenario"] = null;
  const reasons = new Set<string>();
  const result = (status: AyasRevenueOfferFactoryResult["status"], reason: string): AyasRevenueOfferFactoryResult => {
    reasons.add(reason); return deepFreezeAyasRevenueValue({ schemaVersion: "1", status, authority: "NONE", sellableAutonomously: false, externalWrite: false, grantsSpendAuthority: false,
      revision, reasonCodes: [...reasons].sort(), validation, offer, deliveryScenario, evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION" });
  };
  try {
    if (!isAyasRevenueTimestamp(now) || !isAyasRevenueBoundedJson(raw, AYAS_REVENUE_REVISION_MAX_BYTES) || !valid(raw)) return result("BLOCKED", "INVALID_OFFER_INPUT");
    const copied: unknown = structuredClone(raw); if (!valid(copied)) return result("BLOCKED", "INVALID_OFFER_INPUT"); const input = deepFreezeAyasRevenueValue(copied);
    validation = validateAyasRevenueFreeFirst(input.validationInput, now);
    if (validation.status === "BLOCKED" || validation.status === "DO_NOT_PURSUE") return result("BLOCKED", "VALIDATION_BLOCKED");
    if (!validation.scenario?.valid || validation.scenario.state !== "HYPOTHETICAL_READY") return result("DRAFT_INCOMPLETE", "HYPOTHETICAL_PRICE_OR_COST_UNKNOWN");
    const o = input.validationInput.opportunity;
    if (input.offer.opportunityId !== o.opportunityId || input.offer.valuePropositionCode !== o.hypothesis.valuePropositionCode || Date.parse(input.offer.createdAt) > Date.parse(now)
      || input.offer.deliverables.some(d => !o.capabilityKeys.includes(d.capabilityKey))) return result("BLOCKED", "OFFER_SCOPE_MISMATCH");
    offer = { ...input.offer, priceScenario: validation.scenario.input.price }; revision = digestAyasRevenueData(input); if (revision === null) return result("BLOCKED", "INVALID_REVISION_INPUT");
    if (!["PILOT_CANDIDATE", "OWNER_REVIEW_REQUIRED"].includes(validation.status) || validation.dimensions.rights !== "CLEAR" || validation.dimensions.deliverableReadiness !== "PROVEN") return result("DRAFT_INCOMPLETE", "CURRENT_VALIDATION_AND_RIGHTS_REQUIRED");
    if (input.fulfillmentProofs.some(p => !evaluateAyasZeroCost(p.costClass).allowed || p.qualityState === "FAIL" || p.rightsState === "BLOCKED")) return result("BLOCKED", "FULFILLMENT_COST_QUALITY_OR_RIGHTS_BLOCKER");
    let workMinutes = input.offer.revisionSupport.supportMinutes;
    for (const d of input.offer.deliverables) {
      const candidates = input.fulfillmentProofs.filter(p => p.offerClass === o.deliverableClass && p.deliverableClass === d.deliverableClass && p.capabilityKey === d.capabilityKey
        && p.sourceClass !== "MODEL_OPINION" && p.qualityState === "PASS" && p.rightsState === "CLEAR" && (!p.attributionRequired || p.attributionDigest !== null)
        && currentProof(p.observedAt, p.freshUntil, now) && input.validationInput.capabilities.some(c => c.key === d.capabilityKey && c.status === "AVAILABLE" && c.proofDigest === p.capabilityProofDigest)
        && validation!.acceptedEvidenceDigests.includes(p.deliverableEvidenceDigest) && validation!.acceptedEvidenceDigests.includes(p.rightsEvidenceDigest)
        && input.validationInput.evidence.some(e => e.kind === "LOCAL_DELIVERABLE_PROOF" && e.evidenceDigest === p.deliverableEvidenceDigest && e.referenceDigest === p.artifactDigest && (e.capabilityKey === null || e.capabilityKey === d.capabilityKey) && e.facts.includes("DELIVERABLE_PROVEN") && e.confidence >= 0.8)
        && input.validationInput.evidence.some(e => e.kind === "LOCAL_DELIVERABLE_PROOF" && e.evidenceDigest === p.rightsEvidenceDigest && e.referenceDigest === p.artifactDigest && (e.capabilityKey === null || e.capabilityKey === d.capabilityKey) && e.facts.includes("RIGHTS_CLEAR"))
        && input.portfolio.some(a => a.portfolioId === p.portfolioId && a.sourceClass === "LOCAL_ARTIFACT" && a.artifactDigest === p.artifactDigest && a.deliverableClass === d.deliverableClass && a.capabilityKey === d.capabilityKey));
      const unitsWithRevisions = d.units * (1 + input.offer.revisionSupport.maxRevisions);
      const groupUnitsWithRevisions = input.offer.deliverables.filter(item => item.deliverableClass === d.deliverableClass && item.capabilityKey === d.capabilityKey)
        .reduce((units, item) => units + item.units * (1 + input.offer.revisionSupport.maxRevisions), 0);
      // Do not infer throughput beyond an observed sample, or cherry-pick the fastest of contradictory measurements.
      const covering = candidates.filter(p => p.measuredUnits >= groupUnitsWithRevisions); if (covering.length === 0) return result("DRAFT_INCOMPLETE", "MEASURED_FULFILLMENT_AND_PORTFOLIO_PROOF_REQUIRED");
      workMinutes += Math.max(...covering.map(p => Math.ceil(p.measuredMinutes / p.measuredUnits * unitsWithRevisions * AYAS_REVENUE_OFFER_TIME_BUFFER)));
    }
    const capacity = input.capacity;
    if (capacity.state === "UNKNOWN" || !currentProof(capacity.observedAt, now, now)) return result("DRAFT_INCOMPLETE", "CURRENT_CAPACITY_PROOF_REQUIRED");
    if (capacity.windowMinutes !== input.offer.deliveryWindowMinutes || capacity.maxWorkMinutes > capacity.windowMinutes || capacity.committedWorkMinutes > capacity.maxWorkMinutes
      || capacity.committedWorkMinutes + workMinutes > capacity.maxWorkMinutes || capacity.committedWorkMinutes + workMinutes > input.offer.deliveryWindowMinutes) return result("BLOCKED", "CAPACITY_OR_DEADLINE_EXCEEDED");
    deliveryScenario = { label: "ASSUMED", workMinutes, occupiedWindowMinutes: capacity.committedWorkMinutes + workMinutes, reservedCapacity: false };
    return result("OWNER_REVIEW_READY", "LOCAL_OFFER_REQUIRES_OWNER_AND_PLATFORM_REVALIDATION");
  } catch { return result("BLOCKED", "INVALID_OFFER_INPUT"); }
}
