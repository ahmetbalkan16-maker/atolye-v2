/** Pure state plans. The trusted SOURCE reader defaults unbound; it is not a new approval endpoint. */
import { evaluateAyasZeroCost,parseAyasCostClass } from "../../policy/AyasZeroCostPolicy";
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { validateAyasRevenueFreeFirst,type AyasRevenueValidationInput } from "../AyasRevenueValidation";
import { assessAyasRevenueCompliance } from "../compliance/AyasRevenueCompliance";
import { classifyAyasRevenueRisk } from "../security/AyasRevenueRiskClassifier";
import { AYAS_REVENUE_TRANSPORTS } from "../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue,hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { snapshotAyasRevenuePilot,snapshotAyasRevenuePilotData,type AyasRevenuePilot,type AyasRevenuePilotState } from "./AyasRevenuePilot";
const TRANSITIONS:Readonly<Record<AyasRevenuePilotState,readonly AyasRevenuePilotState[]>>=Object.freeze({
  DRAFT:["OWNER_REVIEW","CANCELLED","INVALIDATED"],OWNER_REVIEW:["READY","CANCELLED","INVALIDATED"],READY:["ACTIVE","CANCELLED","INVALIDATED"],
  ACTIVE:["PAUSED","COMPLETED","CANCELLED","INVALIDATED"],PAUSED:["ACTIVE","COMPLETED","CANCELLED","INVALIDATED"],COMPLETED:[],CANCELLED:[],INVALIDATED:[],
});
export interface AyasRevenuePilotOwnerRead {readonly planDigest:string;readonly transitionDigest:string;readonly requestedState:AyasRevenuePilotState;readonly now:string}
function admission(p:AyasRevenuePilot,raw:unknown,now:string):string|null {
  const v=snapshotAyasRevenuePilotData(raw);
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,["freeFirstInput","complianceInput","securityRiskCodes","costClass","passiveFeesEvidenceDigest","transport","deliverableDigest"]))return "ADMISSION_INVALID";
  if(typeof v.costClass!=="string"||parseAyasCostClass(v.costClass)!==v.costClass||!evaluateAyasZeroCost(v.costClass).allowed)return "ZERO_COST_NOT_QUALIFIED";
  if(!(AYAS_REVENUE_TRANSPORTS as readonly unknown[]).includes(v.transport)||(p.platform==="fiverr"&&v.transport!=="MANUAL_HANDOFF"))return "TRANSPORT_UNQUALIFIED";
  if(!isAyasRevenueDigest(v.passiveFeesEvidenceDigest)||!isAyasRevenueDigest(v.deliverableDigest))return "FEES_OR_DELIVERABLE_UNQUALIFIED";
  const f=validateAyasRevenueFreeFirst(v.freeFirstInput,now),input=v.freeFirstInput as AyasRevenueValidationInput;
  if(f.status!=="PILOT_CANDIDATE"||input.opportunity.platform!==p.platform||digestAyasRevenueData(input)!==p.validationSnapshotDigest||input.rights.evidenceDigest!==v.deliverableDigest)return "FREE_FIRST_NOT_READY_OR_BINDING_MISMATCH";
  if(!f.acceptedEvidenceDigests.includes(v.passiveFeesEvidenceDigest))return "PASSIVE_FEE_EVIDENCE_BINDING_MISMATCH";
  if(p.currency!==null&&input.scenario.price.amount?.currency!==p.currency)return "PLAN_CURRENCY_MISMATCH";
  if(classifyAyasRevenueRisk(v.securityRiskCodes).severity!=="INFO")return "SECURITY_UNQUALIFIED";
  const c=assessAyasRevenueCompliance(v.complianceInput,now),scope=v.complianceInput;
  if(c.state!=="REVIEW_CHECKLIST_COMPLETE_NOT_AUTHORITY"||!isAyasRevenuePlainRecord(scope)||scope.platform!==p.platform||scope.accountDigest!==p.accountDigest||scope.offerDigest!==p.offerDigest
    ||scope.transport!==v.transport||scope.operation!==(p.plannedActions[0]?.operation??"ACCOUNT_STATUS_READ"))return "COMPLIANCE_REVIEW_UNBOUND_OR_MISMATCH";
  return null;
}
/** Reader must eventually reuse the authenticated existing owner path. Normalized digests alone do not authenticate it.
 * No production reader is bound. Unit callbacks only simulate review metadata; every state keeps executionAuthority NONE. */
export function createAyasRevenuePilotPolicy(options:{readonly readExistingOwnerReviewedDecision?:(scope:AyasRevenuePilotOwnerRead)=>unknown}={}) {
  if(!isAyasRevenuePlainRecord(options)||!hasExactAyasRevenueKeys(options,[],["readExistingOwnerReviewedDecision"])||(options.readExistingOwnerReviewedDecision!==undefined&&typeof options.readExistingOwnerReviewedDecision!=="function"))throw Error("AYAS_REVENUE_PILOT_READER_INVALID");
  const reader=options.readExistingOwnerReviewedDecision??(()=>null);
  return (raw:unknown,requestedState:AyasRevenuePilotState,rawAdmission:unknown,now:string)=>{
    const p=snapshotAyasRevenuePilot(raw),out=(status:"BLOCKED"|"OWNER_REVIEW_REQUIRED"|"LOCAL_STATE_PLAN",reasonCode:string,next:AyasRevenuePilot|null=null)=>deepFreezeAyasRevenueValue({status,reasonCode,next,
      ownerAuthentication:"UNBOUND_NORMALIZED_SOURCE_READER_NOT_AUTHENTICATION" as const,grantsAuthority:false as const,executionAuthority:"NONE" as const,externalWrite:false as const,autonomousSpend:0 as const});
    if(!p||!isAyasRevenueTimestamp(now)||Date.parse(now)<Date.parse(p.lastStateAt))return out("BLOCKED","INVALID_PILOT_OR_CLOCK");
    if(!TRANSITIONS[p.state].includes(requestedState))return out("BLOCKED","TRANSITION_NOT_ALLOWED");
    if(requestedState==="OWNER_REVIEW")return out("LOCAL_STATE_PLAN","REVIEW_REQUEST_ONLY",{...p,state:requestedState,lastStateAt:now});
    if(["READY","ACTIVE"].includes(requestedState)){const reason=admission(p,rawAdmission,now);if(reason)return out("BLOCKED",reason);}
    const startAt=requestedState==="ACTIVE"&&p.startAt===null?now:p.startAt,stopAt=startAt===null?null:p.stopAt??new Date(Date.parse(startAt)+p.maxDurationDays*86400000).toISOString();
    if(requestedState==="ACTIVE"&&stopAt!==null&&Date.parse(now)>=Date.parse(stopAt))return out("BLOCKED","PILOT_WINDOW_EXPIRED");
    if(requestedState==="COMPLETED"&&stopAt!==null&&Date.parse(now)<Date.parse(stopAt))return out("BLOCKED","PILOT_WINDOW_NOT_COMPLETE");
    const transitionDigest=digestAyasRevenueData({planDigest:p.planDigest,prior:p.state,requestedState,startAt,stopAt,at:now})!,scope=Object.freeze({planDigest:p.planDigest,transitionDigest,requestedState,now});
    let r:unknown;try{r=snapshotAyasRevenuePilotData(reader(scope),8192);}catch{r=null;}
    if(!isAyasRevenuePlainRecord(r)||!hasExactAyasRevenueKeys(r,["planDigest","transitionDigest","decisionDigest","decision","decidedAt"])||r.planDigest!==p.planDigest||r.transitionDigest!==transitionDigest
      ||!isAyasRevenueDigest(r.decisionDigest)||r.decision!=="APPROVE"||!isAyasRevenueTimestamp(r.decidedAt)||Date.parse(r.decidedAt)>Date.parse(now)||Date.parse(now)-Date.parse(r.decidedAt)>86400000)return out("OWNER_REVIEW_REQUIRED","EXACT_EXISTING_OWNER_SOURCE_READER_REQUIRED");
    const next=snapshotAyasRevenuePilot({...p,state:requestedState,startAt,stopAt,lastStateAt:now,ownerReviewDigest:r.decisionDigest});if(!next)return out("BLOCKED","TRANSITION_STATE_INVALID");
    return out("LOCAL_STATE_PLAN","FRAMEWORK_REVIEW_METADATA_ONLY_NO_EXECUTION",next);
  };
}
export const planAyasRevenuePilotTransition=createAyasRevenuePilotPolicy();
