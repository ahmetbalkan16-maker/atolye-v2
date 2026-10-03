/** Pure realized-money advice. No env, memory, store, registry, payment, network or executor access. */
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../provenance/AyasReleaseProvenance";
import { parseAyasCostClass } from "../policy/AyasZeroCostPolicy";
import { AYAS_REVENUE_MAX_MINOR_UNITS, AYAS_REVENUE_CURRENCIES } from "./AyasRevenueSpendPolicy";
import { validateAyasRevenueLedgerState, AYAS_REVENUE_LEDGER_MAX_BYTES, type AyasRevenueLedgerEntry } from "./AyasRevenueLedger";
import { summarizeAyasRevenueEconomics } from "./AyasRevenueEconomics";
import { validateAyasRevenueFreeFirst } from "./AyasRevenueValidation";
import { digestAyasRevenueData } from "./AyasRevenueDigest";
import { isAyasRevenueDigest, isAyasRevenueNeutralCode, isAyasRevenueScenarioMoney } from "./AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueExternalId,
  isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import { AYAS_REINVESTMENT_PURPOSES, type AyasReinvestmentPurpose, type AyasRevenueReinvestmentCandidate, type AyasRevenueReinvestmentDecision, type AyasRevenueReinvestmentInput } from "./AyasRevenueReinvestmentProposal";

export interface AyasRevenueReviewedReinvestmentPolicy {
  readonly schemaVersion: "1"; readonly revision: number; readonly enabled: boolean; readonly basisPoints: number;
  readonly maxAbsoluteMinorByCurrency: Readonly<Record<string, number>>; readonly allowedPurposes: readonly AyasReinvestmentPurpose[];
  readonly reviewedAt: string | null; readonly reviewEvidenceDigest: string | null;
}
export const AYAS_REVENUE_DEFAULT_REINVESTMENT_POLICY: AyasRevenueReviewedReinvestmentPolicy = deepFreezeAyasRevenueValue({ schemaVersion: "1", revision: 1,
  enabled: false, basisPoints: 0, maxAbsoluteMinorByCurrency: {}, allowedPurposes: [], reviewedAt: null, reviewEvidenceDigest: null });
const integer = (v: unknown, max = AYAS_REVENUE_MAX_MINOR_UNITS): v is number => Number.isSafeInteger(v) && !Object.is(v, -0) && (v as number) >= 0 && (v as number) <= max;
const timestamp = (v: unknown, now: string): v is string => isAyasRevenueTimestamp(v) && Date.parse(v) <= Date.parse(now);
const RESERVES = ["refundsMinor", "feesMinor", "disputesMinor", "taxMinor", "payoutMinor"] as const;
function snapshot(raw: unknown, bytes = 512 * 1024): unknown | null {
  if (!isAyasRevenueBoundedJson(raw, bytes) || containsAyasRevenueSensitiveData(raw)) return null;
  return deepFreezeAyasRevenueValue(structuredClone(raw));
}
function policy(raw: unknown, now: string): AyasRevenueReviewedReinvestmentPolicy | null {
  const p = snapshot(raw);
  if (!isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["schemaVersion", "revision", "enabled", "basisPoints", "maxAbsoluteMinorByCurrency", "allowedPurposes", "reviewedAt", "reviewEvidenceDigest"])
    || p.schemaVersion !== "1" || !integer(p.revision, 10_000) || p.revision === 0 || typeof p.enabled !== "boolean" || !integer(p.basisPoints, 10_000)
    || !isAyasRevenuePlainRecord(p.maxAbsoluteMinorByCurrency) || Object.keys(p.maxAbsoluteMinorByCurrency).length > AYAS_REVENUE_CURRENCIES.length
    || !Object.entries(p.maxAbsoluteMinorByCurrency).every(([c, v]) => (AYAS_REVENUE_CURRENCIES as readonly string[]).includes(c) && integer(v))
    || !Array.isArray(p.allowedPurposes) || p.allowedPurposes.length > AYAS_REINVESTMENT_PURPOSES.length || !p.allowedPurposes.every(v => (AYAS_REINVESTMENT_PURPOSES as readonly unknown[]).includes(v))
    || new Set(p.allowedPurposes).size !== p.allowedPurposes.length) return null;
  if (p.enabled ? !timestamp(p.reviewedAt, now) || !isAyasRevenueDigest(p.reviewEvidenceDigest) || p.basisPoints === 0
    : p.basisPoints !== 0 || Object.keys(p.maxAbsoluteMinorByCurrency).length !== 0 || p.allowedPurposes.length !== 0 || p.reviewedAt !== null || p.reviewEvidenceDigest !== null) return null;
  return p as unknown as AyasRevenueReviewedReinvestmentPolicy;
}
function input(raw: unknown, now: string): AyasRevenueReinvestmentInput | null {
  const p = snapshot(raw, AYAS_REVENUE_LEDGER_MAX_BYTES + 512 * 1024);
  if (!isAyasRevenuePlainRecord(p) || !hasExactAyasRevenueKeys(p, ["schemaVersion", "candidateId", "platform", "purpose", "amount", "evidenceWindow", "ledger", "reconciliation", "freeFirstInput", "freeAlternative", "risks", "effect"])
    || p.schemaVersion !== "1" || !isAyasRevenueExternalId(p.candidateId) || !isAyasRevenuePlatform(p.platform) || !(AYAS_REINVESTMENT_PURPOSES as readonly unknown[]).includes(p.purpose)
    || !isAyasRevenueScenarioMoney(p.amount) || p.amount.valueMinor === 0 || !isAyasRevenuePlainRecord(p.evidenceWindow) || !hasExactAyasRevenueKeys(p.evidenceWindow, ["from", "to"])
    || !timestamp(p.evidenceWindow.from, now) || !timestamp(p.evidenceWindow.to, now) || Date.parse(p.evidenceWindow.from) > Date.parse(p.evidenceWindow.to)) return null;
  const r = p.reconciliation, a = p.freeAlternative, risks = p.risks, e = p.effect;
  if (!isAyasRevenuePlainRecord(r) || !hasExactAyasRevenueKeys(r, ["ledgerDigest", "ledgerRevision", "currency", "from", "to", "observedAt", "freshUntil", "evidenceDigest", "historyCoverage", "fees", "refunds", "disputes", "tax", "settlement", "debtMinor", "reserve"])
    || !isAyasRevenueDigest(r.ledgerDigest) || !integer(r.ledgerRevision, 10_000) || r.currency !== p.amount.currency || r.from !== p.evidenceWindow.from || r.to !== p.evidenceWindow.to
    || !timestamp(r.observedAt, now) || Date.parse(r.observedAt) < Date.parse(p.evidenceWindow.to) || !isAyasRevenueTimestamp(r.freshUntil) || Date.parse(r.freshUntil) < Date.parse(r.observedAt)
    || !isAyasRevenueDigest(r.evidenceDigest) || !["COMPLETE", "UNKNOWN"].includes(r.historyCoverage as string) || !["COMPLETE", "UNKNOWN"].includes(r.fees as string)
    || !["BOUNDED", "UNKNOWN"].includes(r.refunds as string) || !["BOUNDED", "UNKNOWN"].includes(r.disputes as string) || !["CLEAR_OR_RESERVED", "UNKNOWN"].includes(r.tax as string)
    || !["SETTLED", "UNKNOWN"].includes(r.settlement as string) || !(r.debtMinor === null || integer(r.debtMinor)) || !isAyasRevenuePlainRecord(r.reserve)
    || !hasExactAyasRevenueKeys(r.reserve, RESERVES) || !Object.values(r.reserve).every(v => v === null || integer(v))) return null;
  if (!isAyasRevenuePlainRecord(a) || !hasExactAyasRevenueKeys(a, ["state", "evidenceDigest", "observedAt"]) || !["NO_EQUIVALENT_FREE", "EQUIVALENT_FREE_AVAILABLE", "UNKNOWN"].includes(a.state as string)
    || !(a.evidenceDigest === null || isAyasRevenueDigest(a.evidenceDigest)) || !timestamp(a.observedAt, now) || Date.parse(a.observedAt) < Date.parse(r.observedAt)
    || !isAyasRevenuePlainRecord(risks) || !hasExactAyasRevenueKeys(risks, ["security", "licensing", "privacy", "evidenceDigest"])
    || ![risks.security, risks.licensing, risks.privacy].every(v => ["LOW", "HIGH", "UNKNOWN"].includes(v as string)) || !(risks.evidenceDigest === null || isAyasRevenueDigest(risks.evidenceDigest))) return null;
  if (!isAyasRevenuePlainRecord(e) || !hasExactAyasRevenueKeys(e, ["reversibility", "oneShot", "recurring", "creditOrDebt", "lossChasing", "automaticScale", "expiresAt", "successMetricCode", "maxDownside", "costClass"])
    || !["REVERSIBLE", "PARTIALLY_REVERSIBLE", "IRREVERSIBLE", "UNKNOWN"].includes(e.reversibility as string) || ![e.oneShot, e.recurring, e.creditOrDebt, e.lossChasing, e.automaticScale].every(v => typeof v === "boolean")
    || !isAyasRevenueTimestamp(e.expiresAt) || !isAyasRevenueNeutralCode(e.successMetricCode) || !isAyasRevenueScenarioMoney(e.maxDownside)
    || typeof e.costClass !== "string" || parseAyasCostClass(e.costClass) !== e.costClass) return null;
  return p as unknown as AyasRevenueReinvestmentInput;
}
const safe = (v: bigint): number => { if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) throw Error("AGGREGATE_OVERFLOW"); return Number(v); };
/** Payout is already seller cash: cap net sales by each order's payout, then subtract only delivery/ads/other costs. Fees are not deducted twice. */
function settledProfit(entries: readonly AyasRevenueLedgerEntry[], requireCoverage: boolean): number | null {
  const sum = (facts: readonly AyasRevenueLedgerEntry[], event: AyasRevenueLedgerEntry["event"]) => facts.filter(v => v.event === event).reduce((n, v) => n + BigInt(v.amount.valueMinor), BigInt(0));
  const orders = new Map<string, AyasRevenueLedgerEntry[]>();
  for (const v of entries) { if (v.orderDigest === null) continue; const key = v.platform + ':' + v.orderDigest; const list = orders.get(key) ?? []; list.push(v); orders.set(key, list); }
  let settled = BigInt(0);
  for (const facts of orders.values()) {
    if (!facts.some(v => v.event === "GROSS_REVENUE")) continue;
    if (requireCoverage && ["PLATFORM_FEE", "PAYMENT_PROCESSING_FEE", "PAYOUT_OBSERVED"].some(event => !facts.some(v => v.event === event))) return null;
    const net = sum(facts, "GROSS_REVENUE") - sum(facts, "REFUND") - sum(facts, "PLATFORM_FEE") - sum(facts, "PAYMENT_PROCESSING_FEE") - sum(facts, "TAX_WITHHELD");
    const payout = sum(facts, "PAYOUT_OBSERVED"); settled += net < payout ? net : payout;
  }
  const observed = entries.length ? summarizeAyasRevenueEconomics({schemaVersion: "1", revision: entries.length, entries})[0]! : null;
  const cash = settled - sum(entries, "VARIABLE_DELIVERY_COST") - sum(entries, "AD_SPEND") - sum(entries, "OTHER_COST");
  const observedProfit = BigInt(observed?.observedContributionProfitMinor ?? 0) - sum(entries, "TAX_WITHHELD");
  return safe(cash < observedProfit ? cash : observedProfit);
}
/** The optional reader is a trusted owner-reviewed SOURCE integration, never a request field. Production has no reader bound and stays disabled.
 * Returned normalized records/digests do not authenticate an owner. A future binding needs its own authenticated review and exact current ledger reread. */
export function createAyasRevenueReinvestmentEvaluator(options: { readonly readOwnerReviewedSourcePolicy?: () => unknown } = {}): (raw: unknown, now: string) => AyasRevenueReinvestmentDecision {
  const reader = options.readOwnerReviewedSourcePolicy ?? (() => AYAS_REVENUE_DEFAULT_REINVESTMENT_POLICY);
  return (raw, now) => {
    let available = 0, ceiling = 0;
    const done = (status: AyasRevenueReinvestmentDecision["status"], reasonCode: string, candidate: AyasRevenueReinvestmentCandidate | null = null): AyasRevenueReinvestmentDecision =>
      deepFreezeAyasRevenueValue({ status, reasonCode, availableProfitMinor: available, maxEligibleMinor: ceiling, candidate, ownerApprovalRequired: true, executionAuthority: "NONE", grantsSpendAuthority: false, autonomousBudgetUsd: 0 });
    try {
      if (!isAyasRevenueTimestamp(now)) return done("BLOCKED", "CLOCK_INVALID");
      const reviewed = policy(reader(), now); if (reviewed === null) return done("BLOCKED", "REVIEWED_POLICY_INVALID");
      if (!reviewed.enabled) return done("DISABLED", "REINVESTMENT_DEFAULT_DISABLED");
      const p = input(raw, now); if (p === null) return done("BLOCKED", "INVALID_INPUT");
      if (!isAyasRevenueBoundedJson(p.ledger, AYAS_REVENUE_LEDGER_MAX_BYTES)) return done("BLOCKED", "LEDGER_SIZE_UNQUALIFIED");
      const r = p.reconciliation, state = validateAyasRevenueLedgerState(p.ledger);
      // Ledger identity is bound without the smaller generic revision helper's 512KiB ceiling.
      const ledgerDigest = digestLedger(state);
      if (r.ledgerDigest !== ledgerDigest || r.ledgerRevision !== state.revision) return done("BLOCKED", "LEDGER_BINDING_MISMATCH");
      if (r.historyCoverage !== "COMPLETE" || r.fees !== "COMPLETE" || r.refunds !== "BOUNDED" || r.disputes !== "BOUNDED" || r.tax !== "CLEAR_OR_RESERVED" || r.settlement !== "SETTLED"
        || r.debtMinor !== 0 || RESERVES.some(k => r.reserve[k] === null) || Date.parse(now) > Math.min(Date.parse(r.freshUntil), Date.parse(r.observedAt) + 86_400_000)) return done("BLOCKED", "ECONOMIC_UNCERTAINTY_OR_DEBT");
      if (state.entries.some(v => !timestamp(v.occurredAt, now) || !timestamp(v.evidence.observedAt, now) || !timestamp(v.recordedAt, now)
        || Date.parse(v.occurredAt) > Date.parse(v.evidence.observedAt) || Date.parse(v.evidence.observedAt) > Date.parse(v.recordedAt) || Date.parse(v.recordedAt) > Date.parse(r.observedAt))) return done("BLOCKED", "LEDGER_CHRONOLOGY_UNQUALIFIED");
      const reversed = new Set(state.entries.filter(v => v.event === "REVERSAL").map(v => v.reversesEntryId!));
      const active = state.entries.filter(v => v.event !== "REVERSAL" && !reversed.has(v.entryId) && v.amount.currency === p.amount.currency);
      const from = Date.parse(p.evidenceWindow.from), to = Date.parse(p.evidenceWindow.to);
      const window = active.filter(v => Date.parse(v.occurredAt) >= from && Date.parse(v.occurredAt) <= to);
      if (!window.length || summarizeAyasRevenueEconomics({schemaVersion: "1", revision: window.length, entries: window})[0]?.status !== "COMPLETE_OBSERVATIONS") return done("BLOCKED", "INCOMPLETE_LEDGER_WINDOW");
      const profit = settledProfit(window, true), prior = settledProfit(active.filter(v => Date.parse(v.occurredAt) < from), false);
      const lifetime = settledProfit(active, true);
      if (profit === null || prior === null || lifetime === null || profit <= 0 || lifetime <= 0) return done("BLOCKED", "NO_POSITIVE_REALIZED_PROFIT");
      const realized = Math.min(lifetime, safe(BigInt(profit) + BigInt(Math.min(0, prior))));
      const reserved = safe(RESERVES.reduce((n, k) => n + BigInt(r.reserve[k]!), BigInt(0)));
      available = Math.max(0, safe(BigInt(realized) - BigInt(reserved)));
      if (available === 0) return done("BLOCKED", "RESERVE_OR_LOSS_EXHAUSTS_PROFIT");
      const absolute = reviewed.maxAbsoluteMinorByCurrency[p.amount.currency] ?? 0;
      ceiling = Math.min(absolute, safe(BigInt(available) * BigInt(reviewed.basisPoints) / BigInt(10_000)));
      if (!reviewed.allowedPurposes.includes(p.purpose)) return done("BLOCKED", "PURPOSE_NOT_REVIEWED");
      if (p.amount.valueMinor > ceiling) return done("BLOCKED", "REVIEWED_CEILING_EXCEEDED");
      const f = validateAyasRevenueFreeFirst(p.freeFirstInput, now);
      if (f.status !== "PILOT_CANDIDATE" || p.freeFirstInput.opportunity.platform !== p.platform || p.freeFirstInput.scenario.price.amount?.currency !== p.amount.currency) return done("BLOCKED", "FREE_FIRST_NOT_READY_OR_SCOPE_MISMATCH");
      if (p.freeAlternative.state !== "NO_EQUIVALENT_FREE" || p.freeAlternative.evidenceDigest === null) return done("BLOCKED", "FREE_ALTERNATIVE_EXISTS_OR_UNPROVEN");
      if ([p.risks.security, p.risks.licensing, p.risks.privacy].some(v => v !== "LOW") || p.risks.evidenceDigest === null) return done("BLOCKED", "UNRESOLVED_SECURITY_LICENSE_PRIVACY");
      const e = p.effect;
      if (!["REVERSIBLE", "PARTIALLY_REVERSIBLE"].includes(e.reversibility) || !e.oneShot || e.recurring || e.creditOrDebt || e.lossChasing || e.automaticScale || e.costClass === "subscription" || e.costClass === "unknown-cost"
        || e.maxDownside.currency !== p.amount.currency || e.maxDownside.valueMinor !== p.amount.valueMinor || Date.parse(e.expiresAt) <= Date.parse(now)
        || Date.parse(e.expiresAt) > Math.min(Date.parse(r.freshUntil), Date.parse(r.observedAt) + 86_400_000)) return done("BLOCKED", "UNBOUNDED_OR_RECURRING_EFFECT");
      const money = (valueMinor: number) => ({valueMinor, currency: p.amount.currency});
      const material = {schemaVersion: "1" as const, candidateId: p.candidateId, platform: p.platform, purpose: p.purpose, amount: p.amount, evidenceWindow: p.evidenceWindow,
        realizedProfit: money(realized), reservedAmount: money(reserved), maxEligibleAmount: money(ceiling), expectedBenefitCode: e.successMetricCode,
        reversibility: e.reversibility as "REVERSIBLE" | "PARTIALLY_REVERSIBLE", costClass: e.costClass, expiresAt: e.expiresAt, maxDownside: e.maxDownside,
        policyDigest: digestAyasRevenueData(reviewed)!, ledgerDigest, ledgerRevision: state.revision, reconciliationDigest: digestAyasRevenueData(r)!, freeFirstDigest: digestAyasRevenueData({f, alternative: p.freeAlternative})!,
        riskDigest: digestAyasRevenueData(p.risks)!, requestDigest: digestAyasRevenueData({...p, ledger: {ledgerDigest, revision: state.revision}})!,
        ownerApprovalRequired: true as const, executionAuthority: "NONE" as const, grantsSpendAuthority: false as const, autonomousBudgetUsd: 0 as const,
        automaticRenewal: false as const, automaticScaling: false as const, reservation: "NONE" as const, evidenceVerification: "NORMALIZED_INPUT_NOT_LIVE_CERTIFICATION" as const};
      return done("OWNER_REVIEW_ELIGIBLE", "BOUNDED_ADVISORY_ONLY", {...material, proposalDigest: digestAyasRevenueData(material)!});
    } catch { available = 0; ceiling = 0; return done("BLOCKED", "INVALID_INPUT_OR_POLICY"); }
  };
}
// A canonical ledger digest is scoped to16.2 bytes, not the generic small-object bound.
export function digestLedger(ledger: unknown): string { return createHash("sha256").update(canonicalAyasJson(validateAyasRevenueLedgerState(ledger))).digest("hex"); }
export const evaluateAyasRevenueReinvestment = createAyasRevenueReinvestmentEvaluator();
