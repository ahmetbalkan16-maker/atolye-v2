/** Pure source-bound advisory engine. Recomputes every pilot and lifetime money from the full ledger; never executes. */
import { types } from "node:util";
import { createHash } from "node:crypto";
import { canonicalAyasJson } from "../../provenance/AyasReleaseProvenance";
import { digestAyasRevenueData, digestAyasRevenueLedgerData } from "../AyasRevenueDigest";
import { AYAS_REVENUE_LEDGER_MAX_BYTES, validateAyasRevenueLedgerState } from "../AyasRevenueLedger";
import { summarizeAyasRevenueEconomics } from "../AyasRevenueEconomics";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { createAyasRevenueReinvestmentEvaluator } from "../AyasRevenueReinvestmentPolicy";
import { validateAyasRevenueFreeFirst } from "../AyasRevenueValidation";
import { projectAyasRevenuePilotStore, snapshotAyasRevenuePilotData } from "../pilot/AyasRevenuePilot";
import { evaluateAyasRevenuePilot } from "../pilot/AyasRevenuePilotEvaluation";
import { scalingInteger, snapshotAyasRevenueScalingRequest } from "./AyasRevenueScalingPolicy";
import type { AyasRevenueScalingDecision, AyasRevenueScalingPlan, AyasRevenueScalingRequest, AyasRevenueScalingStatus } from "./AyasRevenueScalingPlan";

export interface AyasRevenueScalingSourceScope { readonly platform: AyasRevenueScalingRequest["platform"]; readonly accountDigest: string; readonly offerDigest: string; readonly now: string }
/** Validated pilot history has its own4MiB bound; do not cast it as a ledger or widen generic digests. */
export function digestAyasRevenueScalingHistory(raw: unknown): string {
  return createHash("sha256").update(canonicalAyasJson(projectAyasRevenuePilotStore(raw).state)).digest("hex");
}
/** These functions are trusted SOURCE integrations, not request options. Production binds neither reader by default.
 * Normalized receipts/digests prove shape and identity, never authentication, complete upstream history or live qualification. */
export function createAyasRevenueScalingEvaluator(options: {
  readonly readCurrentEvidence?: (scope: AyasRevenueScalingSourceScope) => unknown;
  readonly readOwnerReviewedReinvestmentPolicy?: () => unknown;
} = {}): (raw: unknown, now: string) => AyasRevenueScalingDecision {
  if (types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype
    || !Reflect.ownKeys(options).every(key => ["readCurrentEvidence", "readOwnerReviewedReinvestmentPolicy"].includes(String(key)) && typeof key === "string"
      && Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value") && typeof Object.getOwnPropertyDescriptor(options, key)!.value === "function")) throw Error("INVALID_SOURCE_OPTIONS");
  const read = options.readCurrentEvidence ?? (() => null);
  const reinvest = createAyasRevenueReinvestmentEvaluator(options.readOwnerReviewedReinvestmentPolicy ? { readOwnerReviewedSourcePolicy: options.readOwnerReviewedReinvestmentPolicy } : {});
  return (raw, now) => {
    const done = (status: AyasRevenueScalingStatus, reasonCode: string, plan: AyasRevenueScalingPlan | null = null, recommendation: AyasRevenueScalingDecision["recommendation"] = "OWNER_REVIEW"): AyasRevenueScalingDecision =>
      deepFreezeAyasRevenueValue({ status, reasonCode, plan, recommendation, ownerApprovalRequired: true, executionAuthority: "NONE", grantsSpendAuthority: false, autonomousSpend: 0 });
    try {
      const q = snapshotAyasRevenueScalingRequest(raw);
      if (!q || !isAyasRevenueTimestamp(now)) return done("NOT_ELIGIBLE", "INVALID_REQUEST_OR_CLOCK");
      if (q.scalingDimension === "PLATFORM_EXPANSION") return done("MORE_EVIDENCE_REQUIRED", "NEW_PLATFORM_REQUIRES_VALIDATION_AND_PILOT", null, "NEW_PLATFORM_VALIDATION_PILOT");
      const source = snapshotAyasRevenuePilotData(read(Object.freeze({ platform: q.platform, accountDigest: q.accountDigest, offerDigest: q.offerDigest, now })), AYAS_REVENUE_LEDGER_MAX_BYTES + 5 * 1024 * 1024, 600000);
      if (!isAyasRevenuePlainRecord(source) || !hasExactAyasRevenueKeys(source, ["schemaVersion", "platform", "accountDigest", "offerDigest", "ledger", "pilots", "coverage", "readiness", "freeFirstInput", "reinvestmentInput"])
        || source.schemaVersion !== "1" || source.platform !== q.platform || source.accountDigest !== q.accountDigest || source.offerDigest !== q.offerDigest) return done("MORE_EVIDENCE_REQUIRED", "CURRENT_SOURCE_UNBOUND_OR_INVALID");
      const ledger = validateAyasRevenueLedgerState(source.ledger), ledgerDigest = digestAyasRevenueLedgerData(ledger), c = source.coverage;
      const fresh = (observed: unknown, until: unknown): boolean => isAyasRevenueTimestamp(observed) && isAyasRevenueTimestamp(until)
        && Date.parse(observed) <= Date.parse(now) && Date.parse(until) >= Date.parse(now) && Date.parse(until) >= Date.parse(observed) && Date.parse(until) - Date.parse(observed) <= 86400000;
      if (!isAyasRevenuePlainRecord(c) || !hasExactAyasRevenueKeys(c, ["state", "storeDigests", "ledgerDigest", "ledgerRevision", "observedAt", "freshUntil", "evidenceDigest"])
        || c.state !== "COMPLETE" || c.ledgerDigest !== ledgerDigest || c.ledgerRevision !== ledger.revision || !isAyasRevenueDigest(c.evidenceDigest) || !fresh(c.observedAt, c.freshUntil)
        || !Array.isArray(c.storeDigests) || c.storeDigests.length < 1 || c.storeDigests.length > 30 || !c.storeDigests.every(isAyasRevenueDigest) || new Set(c.storeDigests).size !== c.storeDigests.length
        || !Array.isArray(source.pilots) || source.pilots.length !== c.storeDigests.length) return done("MORE_EVIDENCE_REQUIRED", "HISTORY_COVERAGE_UNQUALIFIED");
      if (ledger.entries.some(e => Date.parse(e.occurredAt) > Date.parse(e.evidence.observedAt) || Date.parse(e.evidence.observedAt) > Date.parse(e.recordedAt) || Date.parse(e.recordedAt) > Date.parse(c.observedAt as string))) return done("ECONOMICS_BLOCKED", "LEDGER_CHRONOLOGY_UNQUALIFIED");
      const rosterIds = new Set<string>(), rosterDigests = new Set<string>();
      for (const bundle of source.pilots) {
        if (!isAyasRevenuePlainRecord(bundle) || !hasExactAyasRevenueKeys(bundle, ["store", "reconciliations"])) return done("MORE_EVIDENCE_REQUIRED", "INVALID_PILOT_BUNDLE");
        const projection = projectAyasRevenuePilotStore(bundle.store), current = projection.current, digest = digestAyasRevenueScalingHistory(projection.state);
        if (!current || !c.storeDigests.includes(digest) || rosterDigests.has(digest) || rosterIds.has(current.pilotId)
          || current.platform !== q.platform || current.accountDigest !== q.accountDigest || current.offerDigest !== q.offerDigest) return done("MORE_EVIDENCE_REQUIRED", "PILOT_SCOPE_OR_HISTORY_MISMATCH");
        rosterIds.add(current.pilotId); rosterDigests.add(digest);
      }
      const evaluations: ReturnType<typeof evaluateAyasRevenuePilot>[] = [], ids = new Set<string>(), plans = new Set<string>(), stores = new Set<string>(), usedSales = new Set<string>(), usedOrders = new Set<string>();
      for (const bundle of source.pilots) {
        if (!isAyasRevenuePlainRecord(bundle) || !hasExactAyasRevenueKeys(bundle, ["store", "reconciliations"]) || !Array.isArray(bundle.reconciliations)) return done("MORE_EVIDENCE_REQUIRED", "INVALID_PILOT_BUNDLE");
        const p = projectAyasRevenuePilotStore(bundle.store), storeDigest = digestAyasRevenueScalingHistory(p.state), current = p.current;
        if (!c.storeDigests.includes(storeDigest) || stores.has(storeDigest) || !current || ids.has(current.pilotId) || current.platform !== q.platform || current.accountDigest !== q.accountDigest || current.offerDigest !== q.offerDigest) return done("MORE_EVIDENCE_REQUIRED", "PILOT_SCOPE_OR_HISTORY_MISMATCH");
        stores.add(storeDigest); ids.add(current.pilotId);
        if (current.state !== "COMPLETED") return done("MORE_EVIDENCE_REQUIRED", "CURRENT_PILOT_NOT_COMPLETED");
        const started = p.plans.filter(plan => plan.startAt !== null);
        if (started.length !== bundle.reconciliations.length || !started.length) return done("MORE_EVIDENCE_REQUIRED", "ALL_PILOT_REVISIONS_REQUIRED");
        for (const plan of started) {
          if (plan.currency !== q.currency || plans.has(plan.planDigest)) return done("ECONOMICS_BLOCKED", "CURRENCY_OR_DUPLICATE_PLAN");
          plans.add(plan.planDigest);
          const receipts = bundle.reconciliations.filter(r => isAyasRevenuePlainRecord(r) && r.planDigest === plan.planDigest);
          if (receipts.length !== 1) return done("MORE_EVIDENCE_REQUIRED", "EXACT_RECONCILIATION_REQUIRED");
          const receipt = receipts[0];
          if (!isAyasRevenuePlainRecord(receipt) || receipt.ledgerDigest !== ledgerDigest || receipt.ledgerRevision !== ledger.revision) return done("ECONOMICS_BLOCKED", "PILOT_FULL_LEDGER_BINDING_REQUIRED");
          //16.12 conservatively treats later same-offer costs as unallocated. Exclude only exact other-order
          // facts proven by the full sibling roster. Unknown/unbound costs remain; every sibling is evaluated too.
          const ownOrders = new Set(ledger.entries.filter(f => f.platform === q.platform && f.offerDigest === q.offerDigest && f.event === "GROSS_REVENUE" && f.orderDigest !== null
            && Date.parse(f.occurredAt) >= Date.parse(plan.startAt!) && Date.parse(f.occurredAt) < Date.parse(plan.stopAt!)).map(f => f.orderDigest!));
          const siblingOrders = new Set<string>();
          for (const other of source.pilots) {
            if (!isAyasRevenuePlainRecord(other)) return done("MORE_EVIDENCE_REQUIRED", "INVALID_PILOT_BUNDLE");
            const otherPlans = projectAyasRevenuePilotStore(other.store).plans;
            for (const sibling of otherPlans) if (sibling.planDigest !== plan.planDigest && sibling.platform === q.platform && sibling.accountDigest === q.accountDigest && sibling.offerDigest === q.offerDigest && sibling.startAt !== null && sibling.stopAt !== null) {
              for (const f of ledger.entries) if (f.platform === q.platform && f.offerDigest === q.offerDigest && f.amount.currency === q.currency && f.event === "GROSS_REVENUE" && f.orderDigest !== null
                && Date.parse(f.occurredAt) >= Date.parse(sibling.startAt) && Date.parse(f.occurredAt) < Date.parse(sibling.stopAt) && !ownOrders.has(f.orderDigest)) siblingOrders.add(f.orderDigest);
            }
          }
          const scopedFacts = ledger.entries.filter(f => !(f.platform === q.platform && f.offerDigest === q.offerDigest && f.amount.currency === q.currency && f.orderDigest !== null && siblingOrders.has(f.orderDigest)));
          const kept = new Set(scopedFacts.filter(f => f.event !== "REVERSAL").map(f => f.entryId));
          const entries = scopedFacts.filter(f => f.event !== "REVERSAL" || kept.has(f.reversesEntryId!)), pilotLedger = validateAyasRevenueLedgerState({ schemaVersion: "1", revision: entries.length, entries });
          const e = evaluateAyasRevenuePilot(p.state, plan.planDigest, pilotLedger, { ...receipt, ledgerDigest: digestAyasRevenueLedgerData(pilotLedger), ledgerRevision: pilotLedger.revision }, now);
          if (e.verdict === "SECURITY_BLOCKED" || e.verdict === "POLICY_BLOCKED") return done("SECURITY_BLOCKED", "RETAINED_PILOT_SECURITY_OR_POLICY");
          if (e.verdict !== "PROMISING" || !e.primaryMetric.met || !e.economicsComplete || e.realizedByCurrency.length !== 1 || e.realizedByCurrency[0]!.contributionProfitMinor! <= 0) return done("ECONOMICS_BLOCKED", "ALL_WINDOWS_POSITIVE_PROMISING_REQUIRED");
          const sales = ledger.entries.filter(f => e.selectedEntryDigests.includes(f.entryId) && f.event === "GROSS_REVENUE");
          if (!sales.length || sales.some(s => usedSales.has(s.entryId) || s.orderDigest === null || usedOrders.has(s.orderDigest))) return done("MORE_EVIDENCE_REQUIRED", "REUSED_OR_UNBOUND_SALES");
          for (const sale of sales) { usedSales.add(sale.entryId); usedOrders.add(sale.orderDigest!); }
          evaluations.push(e);
        }
      }
      evaluations.sort((a, b) => Date.parse(a.startAt!) - Date.parse(b.startAt!));
      const metricDigest = digestAyasRevenueData(evaluations[0]!.primaryMetric.metric)!;
      if (evaluations.some((e, i) => digestAyasRevenueData(e.primaryMetric.metric) !== metricDigest || i > 0 && Date.parse(e.startAt!) < Date.parse(evaluations[i - 1]!.stopAt!))) return done("MORE_EVIDENCE_REQUIRED", "METRIC_DRIFT_OR_OVERLAPPING_WINDOWS");
      const repeatCount = evaluations.length;
      if (q.intent === "BOUNDED_REPETITION" ? q.requiredBudget !== null || q.scalingDimension !== "VOLUME" : repeatCount < (q.intent === "BROADER_CHANNEL" ? 3 : 2)) return done("MORE_EVIDENCE_REQUIRED", "REPEATABILITY_REQUIRED");
      // Reverse globally before selecting scope. Earlier losses and later refunds/costs stay in lifetime economics.
      const reversed = new Set(ledger.entries.filter(e => e.event === "REVERSAL").map(e => e.reversesEntryId!));
      if (ledger.entries.some(e => e.event !== "REVERSAL" && !reversed.has(e.entryId) && e.platform === q.platform && e.amount.currency === q.currency
        && !["GROSS_REVENUE", "PAYOUT_OBSERVED"].includes(e.event) && e.amount.valueMinor > 0 && e.orderDigest === null && e.offerDigest === null)) return done("ECONOMICS_BLOCKED", "UNATTRIBUTABLE_ACCOUNT_COST");
      const facts = ledger.entries.filter(e => e.event !== "REVERSAL" && !reversed.has(e.entryId) && e.platform === q.platform && e.offerDigest === q.offerDigest && e.amount.currency === q.currency);
      const lifetime = summarizeAyasRevenueEconomics({ schemaVersion: "1", revision: facts.length, entries: facts })[0];
      if (!lifetime || lifetime.incompleteEvidence || lifetime.contributionProfitMinor === null || lifetime.contributionProfitMinor <= 0) return done("ECONOMICS_BLOCKED", "LIFETIME_PROFIT_UNQUALIFIED");
      const firstAt = Date.parse(evaluations[0]!.startAt!), earlier = facts.filter(e => Date.parse(e.occurredAt) < firstAt);
      if (earlier.length && (summarizeAyasRevenueEconomics({ schemaVersion: "1", revision: earlier.length, entries: earlier })[0]!.observedContributionProfitMinor < 0)) return done("ECONOMICS_BLOCKED", "PRIOR_LOSS_RETAINED");
      const ready = source.readiness;
      if (!isAyasRevenuePlainRecord(ready) || !hasExactAyasRevenueKeys(ready, ["security", "rights", "accountStanding", "deliveryQuality", "supportMeasured", "supportBacklog", "supportCapacity", "maxLevel", "currentLevel", "dimension", "refundRevenueBps", "freeFirstReview", "priceFact", "observedAt", "freshUntil", "evidenceDigest"])
        || !fresh(ready.observedAt, ready.freshUntil) || !isAyasRevenueDigest(ready.evidenceDigest) || Date.parse(ready.observedAt as string) < Date.parse(evaluations.at(-1)!.stopAt!)) return done("MORE_EVIDENCE_REQUIRED", "READINESS_UNQUALIFIED");
      if (ready.security !== "CLEAR" || ready.rights !== "CLEAR" || ready.accountStanding !== "CLEAR") return done("SECURITY_BLOCKED", "CURRENT_SECURITY_RIGHTS_OR_ACCOUNT");
      if (ready.deliveryQuality !== "ACCEPTABLE" || ready.supportMeasured !== true || !scalingInteger(ready.supportBacklog, 1000000) || !scalingInteger(ready.supportCapacity, 1000000)
        || !scalingInteger(ready.maxLevel) || ready.currentLevel !== q.currentLevel || ready.dimension !== q.scalingDimension || q.proposedLevel > ready.maxLevel || ready.supportBacklog > ready.supportCapacity
        || q.rollback.maxSupportBacklog > ready.supportCapacity || ready.supportBacklog > q.rollback.maxSupportBacklog) return done("CAPACITY_BLOCKED", "DELIVERY_SUPPORT_OR_LEVEL_UNQUALIFIED");
      const baseline = Number(BigInt(lifetime.refundsMinor) * BigInt(10000) / BigInt(lifetime.grossRevenueMinor));
      if (!scalingInteger(ready.refundRevenueBps, 10000) || ready.refundRevenueBps > q.rollback.maxRefundRevenueBps || baseline > q.rollback.maxRefundRevenueBps) return done("ECONOMICS_BLOCKED", "REFUND_THRESHOLD_EXCEEDED");
      const free = validateAyasRevenueFreeFirst(source.freeFirstInput, now);
      if (free.status !== "PILOT_CANDIDATE" || ready.freeFirstReview !== "REVIEWED" || !isAyasRevenuePlainRecord(source.freeFirstInput)
        || !isAyasRevenuePlainRecord(source.freeFirstInput.opportunity) || source.freeFirstInput.opportunity.platform !== q.platform) return done("MORE_EVIDENCE_REQUIRED", "CURRENT_FREE_FIRST_REVIEW_REQUIRED");
      if (q.scalingDimension === "PRICE_EXPERIMENT" ? !isAyasRevenuePlainRecord(ready.priceFact) || !hasExactAyasRevenueKeys(ready.priceFact, ["currency", "valueMinor", "evidenceDigest"])
        || ready.priceFact.currency !== q.currency || ready.priceFact.valueMinor !== q.currentLevel || !isAyasRevenueDigest(ready.priceFact.evidenceDigest) : ready.priceFact !== null) return done("MORE_EVIDENCE_REQUIRED", "CURRENT_PRICE_FACT_REQUIRED");
      let reinvestmentProposalDigest: string | null = null, reinvestmentExpiresAt: string | null = null;
      if (q.requiredBudget !== null) {
        const r = source.reinvestmentInput;
        if (!isAyasRevenuePlainRecord(r) || r.platform !== q.platform || !isAyasRevenuePlainRecord(r.amount) || r.amount.valueMinor !== q.requiredBudget.valueMinor || r.amount.currency !== q.currency
          || !isAyasRevenuePlainRecord(r.evidenceWindow) || r.evidenceWindow.from !== evaluations[0]!.startAt || r.evidenceWindow.to !== evaluations.at(-1)!.stopAt
          || digestAyasRevenueLedgerData(r.ledger) !== ledgerDigest || digestAyasRevenueData(r.freeFirstInput) !== digestAyasRevenueData(source.freeFirstInput)
          || (q.scalingDimension === "PAID_ACQUISITION" && r.purpose !== "MARKETING_EXPERIMENT")) return done("ECONOMICS_BLOCKED", "EXACT_REINVESTMENT_BINDING_REQUIRED");
        const decision = reinvest(r, now);
        if (decision.status !== "OWNER_REVIEW_ELIGIBLE" || decision.maxEligibleMinor < q.requiredBudget.valueMinor || !decision.candidate) return done("ECONOMICS_BLOCKED", "REINVESTMENT_POLICY_OR_CEILING_BLOCKED");
        reinvestmentProposalDigest = decision.candidate.proposalDigest;
        reinvestmentExpiresAt = decision.candidate.expiresAt;
      } else if (source.reinvestmentInput !== null) return done("NOT_ELIGIBLE", "UNREQUESTED_PAID_INPUT");
      const total = evaluations.reduce((n, e) => n + BigInt(e.realizedByCurrency[0]!.contributionProfitMinor!), BigInt(0));
      const profit = Number(total < BigInt(lifetime.contributionProfitMinor) ? total : BigInt(lifetime.contributionProfitMinor));
      if (!Number.isSafeInteger(profit) || profit <= 0) return done("ECONOMICS_BLOCKED", "PROFIT_OVERFLOW_OR_NONPOSITIVE");
      const material = { ...q, sourcePilotIds: [...ids].sort(), sourcePlanDigests: evaluations.map(e => e.planDigest),
        evidenceLevel: repeatCount >= 3 ? "MULTI_WINDOW_STABLE" as const : repeatCount >= 2 ? "REPEATED_RESULT" as const : "SINGLE_PILOT" as const,
        realizedProfitEvidence: { currency: q.currency, valueMinor: profit, windowFrom: evaluations[0]!.startAt!, windowTo: evaluations.at(-1)!.stopAt! },
        ledgerDigest, ledgerRevision: ledger.revision, sourceEvidenceDigest: digestAyasRevenueData({ coverage: c, readiness: ready, freeFirst: free, evaluations: evaluations.map(e => ({ planDigest: e.planDigest, storeRevision: e.storeRevision, verdict: e.verdict })) })!,
        reinvestmentProposalDigest, baselineRefundRevenueBps: baseline, baselineMetricDigest: metricDigest,
        baselineMetrics: evaluations.map(e => ({ planDigest: e.planDigest, from: e.startAt!, to: e.stopAt!, numerator: e.primaryMetric.numerator, denominator: e.primaryMetric.denominator, conversionBps: e.primaryMetric.conversionBps })),
        metricFloorMeaning: "FRACTION_OF_EACH_SOURCE_WINDOW_BASELINE" as const,
        expiresAt: new Date(Math.min(Date.parse(c.freshUntil as string), Date.parse(ready.freshUntil as string), reinvestmentExpiresAt === null ? Infinity : Date.parse(reinvestmentExpiresAt), ...evaluations.map(e => Date.parse(e.asOf) + 86400000))).toISOString(),
        afterChangeMeasurement: "SEPARATE_WINDOW_REQUIRED" as const, rollbackAction: "OWNER_CONTROLLED_ONLY" as const,
        ownerApprovalRequired: true as const, executionAuthority: "NONE" as const, grantsSpendAuthority: false as const, autonomousSpend: 0 as const, qualification: "NORMALIZED_SOURCE_NOT_LIVE_CERTIFICATION" as const };
      const planDigest = digestAyasRevenueData(material);
      if (!planDigest || !material.sourceEvidenceDigest) return done("NOT_ELIGIBLE", "PLAN_DIGEST_UNQUALIFIED");
      return done("OWNER_REVIEW_ELIGIBLE", q.intent === "BOUNDED_REPETITION" ? "BOUNDED_REPETITION_ONLY" : "ADVISORY_PLAN_ONLY", { ...material, planDigest });
    } catch { return done("NOT_ELIGIBLE", "INVALID_EVIDENCE_OR_SOURCE"); }
  };
}
export const evaluateAyasRevenueScaling = createAyasRevenueScalingEvaluator();
