/** Synthetic owner-policy/reconciliation callbacks only; no credential, live ledger or actual owner approval. */
import { digestLedger, type AyasRevenueReviewedReinvestmentPolicy } from "../../src/lib/ayas/revenue/AyasRevenueReinvestmentPolicy";
import type { AyasRevenueReinvestmentInput } from "../../src/lib/ayas/revenue/AyasRevenueReinvestmentProposal";
import { revenueLedgerFixtureFact, revenueLedgerFixtureState } from "./ayas-revenue-ledger-fixture";
import { revenueFreeFirstFixture, revenueFreeFirstDigest } from "./ayas-revenue-free-first-fixture";
import type { AyasRevenueLedgerInput } from "../../src/lib/ayas/revenue/AyasRevenueLedger";
type Mutable<T> = T extends string ? string : T extends readonly (infer I)[] ? Mutable<I>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export type ReinvestmentFixture = Mutable<AyasRevenueReinvestmentInput>;
export const RI_AT = "2026-10-03T12:00:00.000Z", RI_NOW = "2026-10-03T13:00:00.000Z";
export const riDigest = revenueFreeFirstDigest;
export function riPolicy(): Mutable<AyasRevenueReviewedReinvestmentPolicy> { return {schemaVersion: "1", revision: 1, enabled: true, basisPoints: 2500,
  maxAbsoluteMinorByCurrency: {USD: 5000}, allowedPurposes: ["PRODUCT_QUALITY", "DELIVERY_CAPABILITY", "PLATFORM_FEE", "MARKETING_EXPERIMENT", "SOFTWARE_TOOL", "INFRASTRUCTURE"],
  reviewedAt: "2026-10-03T11:00:00.000Z", reviewEvidenceDigest: riDigest("reviewed-source-policy")}; }
export function riFacts(): AyasRevenueLedgerInput[] { return [["sale","GROSS_REVENUE",10000],["platform-fee","PLATFORM_FEE",500],["processing-fee","PAYMENT_PROCESSING_FEE",500],
  ["payout","PAYOUT_OBSERVED",9000],["delivery","VARIABLE_DELIVERY_COST",1000]].map(([tag,event,amount])=>revenueLedgerFixtureFact(tag as string,event as AyasRevenueLedgerInput["event"],amount as number,{platform:"lemon-squeezy"})); }
export function riBind(p: ReinvestmentFixture, facts: AyasRevenueLedgerInput[] = riFacts()): ReinvestmentFixture {
  p.ledger = revenueLedgerFixtureState(...facts); p.reconciliation.ledgerDigest=digestLedger(p.ledger); p.reconciliation.ledgerRevision=facts.length; return p;
}
export function riFixture(): ReinvestmentFixture {
  const p: ReinvestmentFixture = {schemaVersion:"1",candidateId:"reinvest-fixture",platform:"lemon-squeezy",purpose:"PRODUCT_QUALITY",amount:{valueMinor:1000,currency:"USD"},
    evidenceWindow:{from:"2026-09-01T00:00:00.000Z",to:RI_AT},ledger:null,
    reconciliation:{ledgerDigest:riDigest("pending"),ledgerRevision:0,currency:"USD",from:"2026-09-01T00:00:00.000Z",to:RI_AT,observedAt:RI_AT,freshUntil:"2026-10-04T12:00:00.000Z",evidenceDigest:riDigest("economic-reconciliation"),
      historyCoverage:"COMPLETE",fees:"COMPLETE",refunds:"BOUNDED",disputes:"BOUNDED",tax:"CLEAR_OR_RESERVED",settlement:"SETTLED",debtMinor:0,
      reserve:{refundsMinor:100,feesMinor:100,disputesMinor:100,taxMinor:100,payoutMinor:100}},
    freeFirstInput:revenueFreeFirstFixture(),freeAlternative:{state:"NO_EQUIVALENT_FREE",evidenceDigest:riDigest("free-alternative-reviewed"),observedAt:RI_AT},
    risks:{security:"LOW",licensing:"LOW",privacy:"LOW",evidenceDigest:riDigest("risk-review")},
    effect:{reversibility:"REVERSIBLE",oneShot:true,recurring:false,creditOrDebt:false,lossChasing:false,automaticScale:false,expiresAt:"2026-10-04T11:00:00.000Z",successMetricCode:"QUALITY_PASS_RATE",maxDownside:{valueMinor:1000,currency:"USD"},costClass:"paid"}};
  // The original generic fixture digest accidentally matches the unchanged card-number scanner.
  p.freeFirstInput.evidence.find(e=>e.kind==="LOCAL_DELIVERABLE_PROOF")!.referenceDigest=riDigest("reinvestment-deliverable-reference");
  return riBind(p);
}
