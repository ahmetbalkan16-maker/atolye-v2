/** Synthetic complete source/owner-policy metadata; no live authority or account. */
import { createAyasRevenuePilot, emptyAyasRevenuePilotStore, makeAyasRevenuePilotEvent, type AyasRevenuePilotStoreState } from "../../src/lib/ayas/revenue/pilot/AyasRevenuePilot";
import { digestAyasRevenueData, digestAyasRevenueLedgerData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { digestAyasRevenueScalingHistory, createAyasRevenueScalingEvaluator } from "../../src/lib/ayas/revenue/scaling/AyasRevenueScaling";
import { AYAS_SCALING_ROLLBACK_CODES } from "../../src/lib/ayas/revenue/scaling/AyasRevenueScalingPlan";
import { validateAyasRevenueLedgerState } from "../../src/lib/ayas/revenue/AyasRevenueLedger";
import { rpDigest, rpPlanInput, rpLedgerFact } from "./ayas-revenue-pilot-fixture";
import { riFixture, riPolicy } from "./ayas-revenue-reinvestment-fixture";
import { revenueFreeFirstFixture } from "./ayas-revenue-free-first-fixture";
export const RS_NOW = "2026-10-04T13:00:00.000Z", RS_UNTIL = "2026-10-05T12:00:00.000Z";
export function rsRequest() { return { schemaVersion: "1", planId: "scale-fixture", platform: "lemon-squeezy", accountDigest: rpDigest("account"), offerDigest: rpDigest("offer"), currency: "USD",
  scalingDimension: "VOLUME", currentLevel: 10, proposedLevel: 15, intent: "MATERIAL_SCALE", requiredBudget: null as {valueMinor:number;currency:string}|null,
  maxDownside: null as {valueMinor:number;currency:string}|null, priceExperiment: null as {currentMinor:number;proposedMinor:number;currency:string}|null,
  rollback: { codes: [...AYAS_SCALING_ROLLBACK_CODES], maxRefundRevenueBps: 1000, maxSupportBacklog: 5, metricFloorBps: 8000 } }; }
export function rsPilot(index: number, patch:Record<string,unknown>={}) {
  const start = new Date(Date.parse("2026-10-01T12:00:00.000Z") + index * 86400000).toISOString(), stop = new Date(Date.parse(start)+86400000).toISOString(), created = new Date(Date.parse(start)-60000).toISOString();
  let p = createAyasRevenuePilot(rpPlanInput({ pilotId: "scaling-pilot-"+index, maxDurationDays:1, maxExternalWrites:0, plannedActions:[], ...patch }), created);
  let store: AyasRevenuePilotStoreState = emptyAyasRevenuePilotStore();
  const add = (kind:"PLAN"|"STATE", at:string) => { const event = makeAyasRevenuePilotEvent(store,kind,p,at);store={schemaVersion:"1",revision:store.revision+1,events:[...store.events,event]}; };
  add("PLAN",created);
  for(const state of ["OWNER_REVIEW","READY","ACTIVE","COMPLETED"] as const) {
    p={...p,state,lastStateAt:state==="COMPLETED"?stop:start,ownerReviewDigest:rpDigest("synthetic-review"),startAt:state==="ACTIVE"||state==="COMPLETED"?start:null,stopAt:state==="ACTIVE"||state==="COMPLETED"?stop:null};add("STATE",p.lastStateAt);
  }
  return { store, p };
}
export function rsSource(count=2) {
  const history=Array.from({length:count},(_,i)=>rsPilot(i)), entries=history.flatMap(({p},i)=>[rpLedgerFact("scale-sale-"+i,"GROSS_REVENUE",1000,{occurredAt:p.startAt,orderDigest:rpDigest("scale-order-"+i)}),
    rpLedgerFact("scale-platform-"+i,"PLATFORM_FEE",100,{occurredAt:p.startAt,orderDigest:rpDigest("scale-order-"+i)}),rpLedgerFact("scale-processing-"+i,"PAYMENT_PROCESSING_FEE",50,{occurredAt:p.startAt,orderDigest:rpDigest("scale-order-"+i)}),
    rpLedgerFact("scale-payout-"+i,"PAYOUT_OBSERVED",850,{occurredAt:p.startAt,orderDigest:rpDigest("scale-order-"+i)})]);
  const ledger=validateAyasRevenueLedgerState({schemaVersion:"1",revision:entries.length,entries}), ledgerDigest=digestAyasRevenueLedgerData(ledger),freeFirstInput=revenueFreeFirstFixture();
  freeFirstInput.evidence.find(e=>e.kind==="LOCAL_DELIVERABLE_PROOF")!.referenceDigest=rpDigest("scaling-deliverable-reference");
  return {schemaVersion:"1",platform:"lemon-squeezy",accountDigest:rpDigest("account"),offerDigest:rpDigest("offer"),ledger,
    pilots:history.map(({p,store})=>({store,reconciliations:[{planDigest:p.planDigest,ledgerDigest,ledgerRevision:ledger.revision,from:p.startAt,to:p.stopAt,observedAt:RS_NOW,freshUntil:RS_UNTIL,evidenceDigest:rpDigest("reconciled-"+p.pilotId),history:"COMPLETE",fees:"COMPLETE",refunds:"COMPLETE",disputes:"CLEAR"}]})),
    coverage:{state:"COMPLETE",storeDigests:history.map(h=>digestAyasRevenueScalingHistory(h.store)),ledgerDigest,ledgerRevision:ledger.revision,observedAt:RS_NOW,freshUntil:RS_UNTIL,evidenceDigest:rpDigest("full-scaling-roster")},
    readiness:{security:"CLEAR",rights:"CLEAR",accountStanding:"CLEAR",deliveryQuality:"ACCEPTABLE",supportMeasured:true,supportBacklog:1,supportCapacity:10,maxLevel:20,currentLevel:10,dimension:"VOLUME",refundRevenueBps:0,freeFirstReview:"REVIEWED",priceFact:null as {currency:string;valueMinor:number;evidenceDigest:string}|null,observedAt:RS_NOW,freshUntil:RS_UNTIL,evidenceDigest:rpDigest("measured-readiness")},freeFirstInput,reinvestmentInput:null as unknown};
}
export type RsSource=ReturnType<typeof rsSource>;
export function rsRebind(s:RsSource) {
  s.coverage.ledgerDigest=digestAyasRevenueLedgerData(s.ledger);s.coverage.ledgerRevision=s.ledger.revision;s.coverage.storeDigests=s.pilots.map(p=>digestAyasRevenueScalingHistory(p.store));
  for(const b of s.pilots)for(const r of b.reconciliations){r.ledgerDigest=s.coverage.ledgerDigest;r.ledgerRevision=s.ledger.revision;}return s;
}
export const rsEvaluator=(s:unknown,policy?:unknown)=>createAyasRevenueScalingEvaluator({readCurrentEvidence:()=>s,...(policy===undefined?{}:{readOwnerReviewedReinvestmentPolicy:()=>policy})});
export function rsPaid() {
  const s=rsSource(),q=rsRequest(),r=riFixture(),policy=riPolicy();q.currentLevel=100;q.proposedLevel=150;q.requiredBudget={valueMinor:150,currency:"USD"};q.maxDownside={...q.requiredBudget};q.scalingDimension="PAID_ACQUISITION";s.readiness.dimension=q.scalingDimension;s.readiness.currentLevel=100;s.readiness.maxLevel=200;
  r.amount={...q.requiredBudget};r.platform="lemon-squeezy";r.purpose="MARKETING_EXPERIMENT";r.ledger=s.ledger;r.evidenceWindow={from:s.pilots[0]!.reconciliations[0]!.from!,to:s.pilots.at(-1)!.reconciliations[0]!.to!};
  r.reconciliation={...r.reconciliation,ledgerDigest:s.coverage.ledgerDigest,ledgerRevision:s.ledger.revision,from:r.evidenceWindow.from,to:r.evidenceWindow.to,observedAt:RS_NOW,freshUntil:RS_UNTIL};
  r.freeFirstInput=s.freeFirstInput;r.freeAlternative.observedAt=RS_NOW;r.effect.maxDownside={...q.requiredBudget};r.effect.expiresAt=RS_UNTIL;r.effect.successMetricCode="SCALING_BOUNDED_METRIC";
  policy.reviewedAt=RS_NOW;s.reinvestmentInput=r;return {s,q,policy};
}
export const rsDigest=digestAyasRevenueData;
