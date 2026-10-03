/** All owner, professional, platform and account metadata here is synthetic, with no live authority. */
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenuePilot,createAyasRevenuePilotObservation,emptyAyasRevenuePilotStore,makeAyasRevenuePilotEvent,type AyasRevenuePilot,type AyasRevenuePilotStoreState } from "../../src/lib/ayas/revenue/pilot/AyasRevenuePilot";
import { createAyasRevenueLedgerEntry,validateAyasRevenueLedgerState,type AyasRevenueEconomicEvent } from "../../src/lib/ayas/revenue/AyasRevenueLedger";
import { digestAyasRevenueLedgerData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenuePilotPolicy,type AyasRevenuePilotOwnerRead } from "../../src/lib/ayas/revenue/pilot/AyasRevenuePilotPolicy";
import { rcInput,rcDigest } from "./ayas-revenue-compliance-fixture";
import { revenueFreeFirstFixture,REVENUE_FREE_FIRST_NOW } from "./ayas-revenue-free-first-fixture";
export const RP_NOW=REVENUE_FREE_FIRST_NOW,RP_CREATED="2026-10-04T11:59:00.000Z",rpDigest=rcDigest;
export const rpFree=()=>revenueFreeFirstFixture();
export function rpPlanInput(patch:Record<string,unknown>={}){return {pilotId:"pilot-fixture",platform:"lemon-squeezy",accountDigest:rpDigest("account"),offerDigest:rpDigest("offer"),
  validationSnapshotDigest:digestAyasRevenueData(rpFree()),objectiveCode:"VALIDATE_PAID_ORDERS",acquisitionCode:"ONE_EXISTING_CHANNEL",successMetric:{kind:"SALES",target:1},currency:"USD",
  plannedActions:[{actionId:"one-product-publication",operation:"LISTING_CREATE",resourceDigest:rpDigest("product-resource")}],...patch};}
export const rpPilot=(patch:Record<string,unknown>={})=>createAyasRevenuePilot(rpPlanInput(patch),RP_CREATED);
export function rpAdmission(p:AyasRevenuePilot=rpPilot(),patch:Record<string,unknown>={}){
 const free=rpFree(),compliance=rcInput({platform:p.platform,accountDigest:p.accountDigest,offerDigest:p.offerDigest,operation:p.plannedActions[0]?.operation??"ACCOUNT_STATUS_READ"});
 return {freeFirstInput:free,complianceInput:{...compliance,observedAt:RP_NOW,records:compliance.records.map(r=>({...r,observedAt:RP_NOW}))},securityRiskCodes:[],
   costClass:"free-public",passiveFeesEvidenceDigest:free.scenario.platformFee.evidenceDigest,transport:"OFFICIAL_API",deliverableDigest:free.rights.evidenceDigest,...patch};
}
export const rpOwnerReceipt=(scope:AyasRevenuePilotOwnerRead,patch:Record<string,unknown>={})=>({planDigest:scope.planDigest,transitionDigest:scope.transitionDigest,decisionDigest:rpDigest("SYNTHETIC_OWNER_REVIEW"),decision:"APPROVE",decidedAt:scope.now,...patch});
export const rpPolicy=(patch:Record<string,unknown>={})=>createAyasRevenuePilotPolicy({readExistingOwnerReviewedDecision:scope=>rpOwnerReceipt(scope,patch)});
export function rpActive(){const policy=rpPolicy(),draft=rpPilot(),review=policy(draft,"OWNER_REVIEW",null,RP_NOW).next!,ready=policy(review,"READY",rpAdmission(review),RP_NOW).next!;
  return policy(ready,"ACTIVE",rpAdmission(ready),RP_NOW).next!;}
export function rpObservation(p:AyasRevenuePilot=rpActive(),patch:Record<string,unknown>={}){return {schemaVersion:"1",pilotId:p.pilotId,planDigest:p.planDigest,platform:p.platform,accountDigest:p.accountDigest,offerDigest:p.offerDigest,
 kind:"METRIC",metric:"SALES",valueCount:1,actionDigest:null,actionStatus:null,ownerDecisionDigest:null,performedEvidenceDigest:null,signal:null,source:"OFFICIAL_CANONICAL",evidenceDigest:rpDigest("metric-1"),occurredAt:p.startAt!,observedAt:p.startAt!,...patch};}
export function rpHistory(observationPatches:readonly Record<string,unknown>[]=[],completed=true,planPatch:Record<string,unknown>={}){
 let store:AyasRevenuePilotStoreState=emptyAyasRevenuePilotStore(),p=rpPilot(planPatch);const add=(kind:"PLAN"|"STATE"|"OBSERVATION",body:Parameters<typeof makeAyasRevenuePilotEvent>[2],at:string)=>{const e=makeAyasRevenuePilotEvent(store,kind,body,at);store={schemaVersion:"1",revision:store.revision+1,events:[...store.events,e]};};
 add("PLAN",p,RP_CREATED);for(const next of ["OWNER_REVIEW","READY","ACTIVE"] as const){p=rpPolicy()(p,next,next==="OWNER_REVIEW"?null:rpAdmission(p),RP_NOW).next!;add("STATE",p,RP_NOW);}
 for(const patch of observationPatches){const o=createAyasRevenuePilotObservation(rpObservation(p,patch),p,RP_NOW);add("OBSERVATION",o,RP_NOW);}
 if(completed){p=rpPolicy()(p,"COMPLETED",null,p.stopAt!).next!;add("STATE",p,p.stopAt!);}return {store,p,now:p.stopAt!};
}
export function rpLedgerFact(tag:string,event:AyasRevenueEconomicEvent="GROSS_REVENUE",valueMinor=1000,patch:Record<string,unknown>={}){
 const {recordedAtOverride,...fields}=patch,at=typeof fields.occurredAt==="string"?fields.occurredAt:RP_NOW;
 return createAyasRevenueLedgerEntry({schemaVersion:"1",platform:"lemon-squeezy",event,amount:{valueMinor,currency:"USD"},occurredAt:at,externalEventDigest:rpDigest(tag),orderDigest:rpDigest("pilot-order"),offerDigest:rpDigest("offer"),activityDigest:null,
 evidence:{source:"OWNER_IMPORT",adapterId:null,adapterVersion:null,observedAt:at,evidenceDigest:rpDigest("evidence-"+tag)},reversesEntryId:null,notesCode:null,...fields},typeof recordedAtOverride==="string"?recordedAtOverride:at);
}
export function rpLedger(entries=[rpLedgerFact("sale"),rpLedgerFact("platform-fee","PLATFORM_FEE",100),rpLedgerFact("processing-fee","PAYMENT_PROCESSING_FEE",50)]){return validateAyasRevenueLedgerState({schemaVersion:"1",revision:entries.length,entries});}
export function rpEvaluationFixture(observationPatches:readonly Record<string,unknown>[]=[],completed=true,planPatch:Record<string,unknown>={}){const h=rpHistory(observationPatches,completed,planPatch),ledger=rpLedger();return {...h,ledger,reconciliation:{planDigest:h.p.planDigest,ledgerDigest:digestAyasRevenueLedgerData(ledger),ledgerRevision:ledger.revision,from:h.p.startAt,to:h.p.stopAt,observedAt:h.now,freshUntil:new Date(Date.parse(h.now)+86400000).toISOString(),evidenceDigest:rpDigest("complete-economic-window"),history:"COMPLETE",fees:"COMPLETE",refunds:"COMPLETE",disputes:"CLEAR"}};}
export function rpHandoffFixture(){const h=rpHistory([],false),a=h.p.plannedActions[0]!,nonceDigest=rpDigest("handoff-nonce"),canonicalDigest=digestAyasRevenueData({planDigest:h.p.planDigest,storeRevision:h.store.revision,actionDigest:a.actionDigest});
 return {...h,now:RP_NOW,input:{planDigest:h.p.planDigest,actionId:a.actionId,nonceDigest,currentBinding:{platform:h.p.platform,accountDigest:h.p.accountDigest,resourceDigest:a.resourceDigest,actionDigest:a.actionDigest,nonceDigest,canonicalDigest,canonicalObservedAt:RP_NOW},journal:[] as {actionDigest:string;nonceDigest:string;status:string}[],securityRiskCodes:[] as string[]}};}
