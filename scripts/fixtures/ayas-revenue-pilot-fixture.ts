/** All owner, professional, platform and account metadata here is synthetic, with no live authority. */
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenuePilot,type AyasRevenuePilot } from "../../src/lib/ayas/revenue/pilot/AyasRevenuePilot";
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
