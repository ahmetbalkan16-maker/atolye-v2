/** Stage16.3: conservative advisory validation of normalized zero-cost evidence. No registry/ledger/IO imports. */
import { evaluateAyasZeroCost, parseAyasCostClass, type AyasCostClass } from "../policy/AyasZeroCostPolicy";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueNeutralCode, snapshotAyasRevenueOpportunity,
  type AyasRevenueOfferType, type AyasRevenueOpportunity } from "./AyasRevenueOpportunity";
import { computeAyasRevenueScenarioEconomics, type AyasRevenueScenarioInput, type AyasRevenueScenarioResult } from "./AyasRevenueScenarioEconomics";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
export const AYAS_REVENUE_VALIDATION_KINDS = Object.freeze(["LOCAL_CAPABILITY", "LOCAL_DELIVERABLE_PROOF", "PUBLIC_DEMAND_SIGNAL", "PUBLIC_COMPETITION_SIGNAL", "PLATFORM_READ_ONLY_SIGNAL", "OWNER_INTEREST_SIGNAL", "REALIZED_LEDGER_SIGNAL"] as const);
export const AYAS_REVENUE_VALIDATION_FACTS = Object.freeze(["CAPABILITY_AVAILABLE", "CAPABILITY_MISSING", "CAPABILITY_DEGRADED", "DELIVERABLE_PROVEN", "DELIVERABLE_NOT_PROVEN",
  "DEMAND_OBSERVED", "DEMAND_ABSENT", "LISTING_COUNT_OBSERVED", "COMPETITION_OBSERVED", "COMPETITION_NOT_OBSERVED", "COMPETITION_SATURATED", "DIFFERENTIATION_OBSERVED", "DIFFERENTIATION_NOT_PROVEN",
  "FEE_SCHEDULE_OBSERVED", "RIGHTS_CLEAR", "RIGHTS_UNCERTAIN", "OWNER_INTERESTED", "OWNER_DECLINED", "REALIZED_REVENUE_OBSERVED", "REALIZED_LOSS_OBSERVED"] as const);
export const AYAS_REVENUE_VALIDATION_STATUSES = Object.freeze(["BLOCKED", "INSUFFICIENT_EVIDENCE", "RESEARCH_REQUIRED", "FREE_VALIDATION_READY", "PILOT_CANDIDATE", "DO_NOT_PURSUE", "OWNER_REVIEW_REQUIRED"] as const);
export type AyasRevenueValidationStatus = typeof AYAS_REVENUE_VALIDATION_STATUSES[number];
export const AYAS_REVENUE_VALIDATION_MAX_AGE_DAYS: Readonly<Record<AyasRevenueOfferType, number>> = Object.freeze({ DIGITAL_PRODUCT: 30, FREELANCE_SERVICE: 7, COURSE: 60, CONTENT_ASSET: 14, OTHER: 7 });
export const AYAS_REVENUE_VALIDATION_PLATFORM_MAX_AGE_DAYS: Readonly<Record<AyasRevenuePlatform | "MULTI", number>> = Object.freeze({ etsy: 30, upwork: 7, fiverr: 14, udemy: 60, "lemon-squeezy": 30, MULTI: 7 });
export interface AyasRevenueValidationEvidence {
  readonly kind: typeof AYAS_REVENUE_VALIDATION_KINDS[number]; readonly sourceClass: "LOCAL_FACT" | "PUBLIC_FACT" | "PLATFORM_FACT" | "OWNER_INPUT" | "MODEL_OPINION";
  readonly opportunityId: string; readonly platform: AyasRevenuePlatform | "MULTI"; readonly targetMarketCode: string | null;
  readonly observedAt: string; readonly freshUntil: string; readonly costClass: AyasCostClass; readonly confidence: number;
  readonly sourceIdentityDigest: string; readonly evidenceDigest: string; readonly referenceDigest: string;
  readonly capabilityKey: string | null; readonly facts: readonly typeof AYAS_REVENUE_VALIDATION_FACTS[number][];
}
export interface AyasRevenueValidationInput {
  readonly schemaVersion: "1"; readonly opportunity: AyasRevenueOpportunity; readonly scenario: AyasRevenueScenarioInput;
  readonly capabilities: readonly { readonly key: string; readonly status: "AVAILABLE" | "MISSING" | "DEGRADED"; readonly proofDigest: string | null }[];
  readonly prerequisites: readonly { readonly code: "LOCAL_VALIDATION" | "PLATFORM_READINESS" | "DELIVERY" | "RIGHTS"; readonly state: "READY" | "MISSING" | "UNKNOWN" | "OWNER_REQUIRED"; readonly costClass: AyasCostClass; readonly evidenceDigest: string | null }[];
  readonly rights: { readonly state: "CLEAR" | "UNCERTAIN" | "BLOCKED"; readonly evidenceDigest: string | null };
  readonly securityBlockers: readonly ("SECURITY" | "LICENSE" | "RIGHTS")[]; readonly evidence: readonly AyasRevenueValidationEvidence[];
}
export interface AyasRevenueValidationResult {
  readonly schemaVersion: "1"; readonly status: AyasRevenueValidationStatus; readonly authority: "NONE"; readonly grantsActionAuthority: false; readonly grantsSpendAuthority: false;
  readonly opportunityId: string | null; readonly reasonCodes: readonly string[]; readonly dimensions: Readonly<Record<string, string>>;
  readonly scenario: AyasRevenueScenarioResult | null; readonly acceptedEvidenceDigests: readonly string[];
  readonly evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION"; readonly realizedLedgerVerified: false;
}
const includes = (v: unknown, values: readonly unknown[]): boolean => values.includes(v);
const cost = (v: unknown): v is AyasCostClass => typeof v === "string" && parseAyasCostClass(v) === v;
function evidence(v: unknown): v is AyasRevenueValidationEvidence {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["kind", "sourceClass", "opportunityId", "platform", "targetMarketCode", "observedAt", "freshUntil", "costClass", "confidence", "sourceIdentityDigest", "evidenceDigest", "referenceDigest", "capabilityKey", "facts"])) return false;
  return includes(v.kind, AYAS_REVENUE_VALIDATION_KINDS) && includes(v.sourceClass, ["LOCAL_FACT", "PUBLIC_FACT", "PLATFORM_FACT", "OWNER_INPUT", "MODEL_OPINION"])
    && isAyasRevenueExternalId(v.opportunityId) && (v.platform === "MULTI" || isAyasRevenuePlatform(v.platform)) && (v.targetMarketCode === null || isAyasRevenueNeutralCode(v.targetMarketCode))
    && isAyasRevenueTimestamp(v.observedAt) && isAyasRevenueTimestamp(v.freshUntil) && Date.parse(v.freshUntil) >= Date.parse(v.observedAt)
    && cost(v.costClass) && typeof v.confidence === "number" && Number.isFinite(v.confidence) && v.confidence >= 0 && v.confidence <= 1
    && isAyasRevenueDigest(v.sourceIdentityDigest) && isAyasRevenueDigest(v.evidenceDigest) && isAyasRevenueDigest(v.referenceDigest)
    && (v.capabilityKey === null || isAyasRevenueNeutralCode(v.capabilityKey)) && isAyasRevenueDataArray(v.facts, 20) && v.facts.length > 0
    && v.facts.every(f => includes(f, AYAS_REVENUE_VALIDATION_FACTS)) && new Set(v.facts).size === v.facts.length;
}
function valid(v: unknown): v is AyasRevenueValidationInput {
  if (!isAyasRevenuePlainRecord(v) || !hasExactAyasRevenueKeys(v, ["schemaVersion", "opportunity", "scenario", "capabilities", "prerequisites", "rights", "securityBlockers", "evidence"]) || v.schemaVersion !== "1"
    || !snapshotAyasRevenueOpportunity(v.opportunity) || !computeAyasRevenueScenarioEconomics(v.scenario).valid) return false;
  if (!isAyasRevenueDataArray(v.capabilities, 20) || !v.capabilities.every(c => isAyasRevenuePlainRecord(c) && hasExactAyasRevenueKeys(c, ["key", "status", "proofDigest"])
    && isAyasRevenueNeutralCode(c.key) && includes(c.status, ["AVAILABLE", "MISSING", "DEGRADED"]) && (c.proofDigest === null || isAyasRevenueDigest(c.proofDigest)))
    || new Set(v.capabilities.map(c => (c as { key: string }).key)).size !== v.capabilities.length) return false;
  if (!isAyasRevenueDataArray(v.prerequisites, 4) || !v.prerequisites.every(p => isAyasRevenuePlainRecord(p) && hasExactAyasRevenueKeys(p, ["code", "state", "costClass", "evidenceDigest"])
    && includes(p.code, ["LOCAL_VALIDATION", "PLATFORM_READINESS", "DELIVERY", "RIGHTS"]) && includes(p.state, ["READY", "MISSING", "UNKNOWN", "OWNER_REQUIRED"]) && cost(p.costClass)
    && (p.evidenceDigest === null || isAyasRevenueDigest(p.evidenceDigest))) || new Set(v.prerequisites.map(p => (p as { code: string }).code)).size !== v.prerequisites.length) return false;
  return isAyasRevenuePlainRecord(v.rights) && hasExactAyasRevenueKeys(v.rights, ["state", "evidenceDigest"]) && includes(v.rights.state, ["CLEAR", "UNCERTAIN", "BLOCKED"])
    && (v.rights.evidenceDigest === null || isAyasRevenueDigest(v.rights.evidenceDigest)) && isAyasRevenueDataArray(v.securityBlockers, 3)
    && v.securityBlockers.every(b => includes(b, ["SECURITY", "LICENSE", "RIGHTS"])) && new Set(v.securityBlockers).size === v.securityBlockers.length
    && isAyasRevenueDataArray(v.evidence, 256) && v.evidence.every(evidence);
}
const sourceForKind: Readonly<Record<AyasRevenueValidationEvidence["kind"], AyasRevenueValidationEvidence["sourceClass"]>> = Object.freeze({
  LOCAL_CAPABILITY: "LOCAL_FACT", LOCAL_DELIVERABLE_PROOF: "LOCAL_FACT", PUBLIC_DEMAND_SIGNAL: "PUBLIC_FACT", PUBLIC_COMPETITION_SIGNAL: "PUBLIC_FACT",
  PLATFORM_READ_ONLY_SIGNAL: "PLATFORM_FACT", OWNER_INTEREST_SIGNAL: "OWNER_INPUT", REALIZED_LEDGER_SIGNAL: "LOCAL_FACT",
});
/** Common publisher OR original reference joins a provenance group, including transitive mirror chains. */
function independentDemandCount(records: readonly AyasRevenueValidationEvidence[]): number {
  const parent = new Map<string, string>();
  const root = (id: string): string => { if (!parent.has(id)) parent.set(id, id); let r = id; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  for (const e of records) parent.set(root(`source:${e.sourceIdentityDigest}`), root(`reference:${e.referenceDigest}`));
  const groups = new Map<string, { positive: boolean; negative: boolean }>();
  for (const e of records) { const id = root(`source:${e.sourceIdentityDigest}`), g = groups.get(id) ?? { positive: false, negative: false };
    g.positive ||= e.facts.includes("DEMAND_OBSERVED"); g.negative ||= e.facts.includes("DEMAND_ABSENT"); groups.set(id, g); }
  return [...groups.values()].filter(g => g.positive && !g.negative).length;
}
/** `now` is a trusted caller clock, never a freshness setting in a model/evidence payload. */
export function validateAyasRevenueFreeFirst(raw: unknown, now: string): AyasRevenueValidationResult {
  let opportunityId: string | null = null, scenario: AyasRevenueScenarioResult | null = null;
  const dimensions: Record<string, string> = {}, accepted: string[] = [], reasons = new Set<string>();
  const result = (status: AyasRevenueValidationStatus, reason?: string): AyasRevenueValidationResult => {
    if (reason) reasons.add(reason); return deepFreezeAyasRevenueValue({ schemaVersion: "1", status, authority: "NONE", grantsActionAuthority: false, grantsSpendAuthority: false,
      opportunityId, reasonCodes: [...reasons].sort(), dimensions, scenario, acceptedEvidenceDigests: accepted,
      evidenceVerification: "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION", realizedLedgerVerified: false });
  };
  try {
    if (!isAyasRevenueTimestamp(now) || !valid(raw)) return result("BLOCKED", "INVALID_INPUT"); const copied: unknown = structuredClone(raw); if (!valid(copied)) return result("BLOCKED", "INVALID_INPUT");
    const input = deepFreezeAyasRevenueValue(copied), o = input.opportunity; opportunityId = o.opportunityId; scenario = computeAyasRevenueScenarioEconomics(input.scenario);
    if (!scenario.valid) return result("BLOCKED", "INVALID_SCENARIO");
    const price = o.hypothesis.priceScenario, scenarioPrice = scenario.input.price.amount;
    if ((price === null) !== (scenarioPrice === null) || price?.valueMinor !== scenarioPrice?.valueMinor || price?.currency !== scenarioPrice?.currency) return result("BLOCKED", "PRICE_SCENARIO_MISMATCH");
    if (Date.parse(o.observedAt) > Date.parse(now)) return result("BLOCKED", "FUTURE_OPPORTUNITY");
    const duplicates = new Map<string, string>(), current: AyasRevenueValidationEvidence[] = []; let staleDemand = false;
    for (const e of input.evidence) {
      if (!evaluateAyasZeroCost(e.costClass).allowed) return result("BLOCKED", "NONZERO_OR_UNKNOWN_EVIDENCE_COST");
      const material = JSON.stringify([e.kind, e.sourceClass, e.opportunityId, e.platform, e.targetMarketCode, e.observedAt, e.freshUntil, e.costClass, e.confidence, e.sourceIdentityDigest, e.referenceDigest, e.capabilityKey, [...e.facts].sort()]);
      if (duplicates.has(e.evidenceDigest)) { if (duplicates.get(e.evidenceDigest) !== material) return result("BLOCKED", "CONFLICTING_EVIDENCE_DIGEST"); continue; } duplicates.set(e.evidenceDigest, material);
      const localScope = e.sourceClass === "LOCAL_FACT" && ["LOCAL_CAPABILITY", "LOCAL_DELIVERABLE_PROOF"].includes(e.kind) && e.platform === "MULTI";
      if (e.opportunityId !== o.opportunityId || (e.platform !== o.platform && !localScope) || e.targetMarketCode !== o.targetMarketCode) { reasons.add("EVIDENCE_SCOPE_MISMATCH"); continue; }
      const ageDays = Math.min(AYAS_REVENUE_VALIDATION_MAX_AGE_DAYS[o.offerType], AYAS_REVENUE_VALIDATION_PLATFORM_MAX_AGE_DAYS[o.platform]);
      const limit = Math.min(Date.parse(e.freshUntil), Date.parse(e.observedAt) + ageDays * 86_400_000);
      if (Date.parse(e.observedAt) > Date.parse(now) || Date.parse(now) > limit) { reasons.add("STALE_OR_FUTURE_EVIDENCE"); if (e.kind === "PUBLIC_DEMAND_SIGNAL") staleDemand = true; continue; }
      if (e.sourceClass !== sourceForKind[e.kind] || e.confidence < 0.6) { reasons.add("UNQUALIFIED_EVIDENCE"); continue; }
      current.push(e); accepted.push(e.evidenceDigest);
    }
    const has = (kind: AyasRevenueValidationEvidence["kind"], fact: AyasRevenueValidationEvidence["facts"][number]) => current.some(e => e.kind === kind && e.facts.includes(fact));
    const capabilityReady = o.capabilityKeys.every(key => {
      const c = input.capabilities.find(c => c.key === key); return c?.status === "AVAILABLE" && c.proofDigest !== null
        && !current.some(e => e.kind === "LOCAL_CAPABILITY" && e.capabilityKey === key && e.facts.some(f => f === "CAPABILITY_MISSING" || f === "CAPABILITY_DEGRADED"))
        && current.some(e => e.kind === "LOCAL_CAPABILITY" && e.capabilityKey === key && e.evidenceDigest === c.proofDigest && e.confidence >= 0.8 && e.facts.includes("CAPABILITY_AVAILABLE")
          && !e.facts.some(f => f === "CAPABILITY_MISSING" || f === "CAPABILITY_DEGRADED"));
    });
    const deliverable = !has("LOCAL_DELIVERABLE_PROOF", "DELIVERABLE_NOT_PROVEN")
      && current.some(e => e.kind === "LOCAL_DELIVERABLE_PROOF" && e.facts.includes("DELIVERABLE_PROVEN") && e.confidence >= 0.8);
    const demandCount = independentDemandCount(current.filter(e => e.kind === "PUBLIC_DEMAND_SIGNAL"));
    const competition = has("PUBLIC_COMPETITION_SIGNAL", "COMPETITION_OBSERVED") && !has("PUBLIC_COMPETITION_SIGNAL", "COMPETITION_NOT_OBSERVED"),
      differentiation = has("PUBLIC_COMPETITION_SIGNAL", "DIFFERENTIATION_OBSERVED") && !has("PUBLIC_COMPETITION_SIGNAL", "DIFFERENTIATION_NOT_PROVEN");
    const rightsClear = input.rights.state === "CLEAR" && input.rights.evidenceDigest !== null && current.some(e => e.evidenceDigest === input.rights.evidenceDigest
      && e.kind === "LOCAL_DELIVERABLE_PROOF" && e.facts.includes("RIGHTS_CLEAR")) && !has("LOCAL_DELIVERABLE_PROOF", "RIGHTS_UNCERTAIN");
    const proofForPrerequisite = (p: AyasRevenueValidationInput["prerequisites"][number]): boolean => current.some(e => e.evidenceDigest === p.evidenceDigest
      && (p.code === "LOCAL_VALIDATION" ? capabilityReady && e.kind === "LOCAL_CAPABILITY" && e.facts.includes("CAPABILITY_AVAILABLE") && e.confidence >= 0.8
        : p.code === "PLATFORM_READINESS" ? e.kind === "PLATFORM_READ_ONLY_SIGNAL"
          : p.code === "DELIVERY" ? deliverable && e.kind === "LOCAL_DELIVERABLE_PROOF" && e.facts.includes("DELIVERABLE_PROVEN") && e.confidence >= 0.8
            : rightsClear && e.kind === "LOCAL_DELIVERABLE_PROOF" && e.facts.includes("RIGHTS_CLEAR")));
    const prerequisiteMissing = ["LOCAL_VALIDATION", "PLATFORM_READINESS"].some(code => !input.prerequisites.some(p => p.code === code))
      || input.prerequisites.some(p => !evaluateAyasZeroCost(p.costClass).allowed || p.state === "MISSING" || p.state === "UNKNOWN" || (p.state === "READY" && !proofForPrerequisite(p)));
    const ownerRequired = input.prerequisites.some(p => p.state === "OWNER_REQUIRED") || o.platform === "MULTI";
    const knownFees = [scenario.input.platformFee, scenario.input.paymentProcessingFee].every(q => q.label !== "UNKNOWN" && q.evidenceDigest !== null
      && current.some(e => e.evidenceDigest === q.evidenceDigest && e.kind === "PLATFORM_READ_ONLY_SIGNAL" && e.facts.includes("FEE_SCHEDULE_OBSERVED")));
    Object.assign(dimensions, { capabilityReadiness: capabilityReady ? "AVAILABLE" : "MISSING_OR_UNPROVEN", deliverableReadiness: deliverable ? "PROVEN" : "NOT_PROVEN",
      demandEvidence: demandCount >= 2 ? "CORROBORATED" : demandCount === 1 ? "ONE_SOURCE" : "NONE", competitionSaturation: competition ? has("PUBLIC_COMPETITION_SIGNAL", "COMPETITION_SATURATED") ? "SATURATED" : "EVIDENCED" : "UNKNOWN",
      differentiation: differentiation ? "EVIDENCED" : "MISSING", zeroCostLaunch: prerequisiteMissing ? "BLOCKED_OR_UNKNOWN" : "FEASIBLE", estimatedUnitEconomics: scenario.state,
      platformPrerequisites: ownerRequired ? "OWNER_REQUIRED" : prerequisiteMissing ? "UNKNOWN" : "READY",
      rights: rightsClear ? "CLEAR" : input.rights.state === "BLOCKED" ? "BLOCKED" : input.rights.state === "UNCERTAIN" || has("LOCAL_DELIVERABLE_PROOF", "RIGHTS_UNCERTAIN") ? "UNCERTAIN" : "UNPROVEN",
      evidenceFreshness: staleDemand ? "STALE_OR_FUTURE_DEMAND" : "CURRENT_ACCEPTED_INPUT" });
    if (input.securityBlockers.length || input.rights.state === "BLOCKED") return result("BLOCKED", "SECURITY_LICENSE_OR_RIGHTS_BLOCKER");
    if (!capabilityReady) return result("BLOCKED", "CAPABILITY_UNAVAILABLE_OR_UNPROVEN");
    if (prerequisiteMissing) return result("BLOCKED", "PAID_UNKNOWN_OR_MISSING_PREREQUISITE");
    if (!rightsClear && ["DIGITAL_PRODUCT", "COURSE", "CONTENT_ASSET"].includes(o.offerType)) return result("BLOCKED", "RIGHTS_UNRESOLVED");
    if (scenario.contribution.amount !== null && scenario.contribution.amount.valueMinor < 0) return result("DO_NOT_PURSUE", "NEGATIVE_HYPOTHETICAL_CONTRIBUTION");
    if (!knownFees || scenario.state === "UNKNOWN") return result("RESEARCH_REQUIRED", "UNKNOWN_FEES_OR_SCENARIO");
    if (demandCount < 2) return result(staleDemand ? "RESEARCH_REQUIRED" : "INSUFFICIENT_EVIDENCE", "CORROBORATED_CURRENT_DEMAND_REQUIRED");
    if (!competition || !differentiation) return result("RESEARCH_REQUIRED", "COMPETITION_AND_DIFFERENTIATION_REQUIRED");
    if (!rightsClear || ownerRequired) return result("OWNER_REVIEW_REQUIRED", "RIGHTS_OR_PLATFORM_OWNER_REVIEW");
    if (!deliverable) return result("FREE_VALIDATION_READY", "DELIVERABLE_PROOF_REQUIRED");
    return result("PILOT_CANDIDATE", "CONDITIONAL_FREE_PILOT_ADVICE");
  } catch { return result("BLOCKED", "INVALID_INPUT"); }
}
