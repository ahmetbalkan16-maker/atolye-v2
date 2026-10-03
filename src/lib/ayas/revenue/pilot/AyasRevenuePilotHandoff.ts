/** Pure manual owner checklist. No executor, journal writer, approval authority or live-write qualification. */
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp,deepFreezeAyasRevenueValue } from "../AyasRevenueRedaction";
import { classifyAyasRevenueRisk } from "../security/AyasRevenueRiskClassifier";
import { inspectAyasRevenueWriteBinding } from "../security/AyasRevenueActionGuard";
import { projectAyasRevenuePilotStore,snapshotAyasRevenuePilotData } from "./AyasRevenuePilot";
export function buildAyasRevenuePilotHandoff(rawStore:unknown,raw:unknown,now:string){
 const finish=(status:"BLOCKED"|"MANUAL_OWNER_REVIEW",reason:string,scope:unknown=null)=>deepFreezeAyasRevenueValue({status,reason,scope,ownerApprovalRequired:true,
  ownerAuthentication:"UNBOUND_NOT_AUTHENTICATION",transport:"MANUAL_ONLY",performedEvidenceRequired:true,journalQualification:"UNBOUND",executionAuthority:"NONE",grantsAuthority:false,externalWrite:false,autonomousSpend:0});
 try{const projection=projectAyasRevenuePilotStore(rawStore),p=projection.current,v=snapshotAyasRevenuePilotData(raw,32768);
  if(!p||!["READY","ACTIVE"].includes(p.state)||!isAyasRevenueTimestamp(now)||Date.parse(now)<Date.parse(p.lastStateAt)||p.stopAt!==null&&Date.parse(now)>=Date.parse(p.stopAt)
   ||!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,["planDigest","actionId","nonceDigest","currentBinding","journal","securityRiskCodes"])
   ||v.planDigest!==p.planDigest||!isAyasRevenueDigest(v.nonceDigest)||classifyAyasRevenueRisk(v.securityRiskCodes).severity!=="INFO")return finish("BLOCKED","INVALID_OR_UNQUALIFIED_SCOPE");
  const a=p.plannedActions.find(a=>a.actionId===v.actionId);if(!a)return finish("BLOCKED","UNPLANNED_ACTION");
  if(projection.observations.some(o=>o.kind==="ACTION_RESULT"&&o.actionDigest===a.actionDigest))return finish("BLOCKED","RETAINED_ACTION_ATTEMPT_NO_RETRY");
  if(projection.observations.some(o=>o.kind==="SIGNAL"))return finish("BLOCKED","RETAINED_STOP_SIGNAL");
  if(!isAyasRevenuePlainRecord(v.currentBinding)||!isAyasRevenueTimestamp(v.currentBinding.canonicalObservedAt))return finish("BLOCKED","CANONICAL_UNAVAILABLE");
  const canonicalDigest=digestAyasRevenueData({planDigest:p.planDigest,storeRevision:projection.state.revision,actionDigest:a.actionDigest}),binding={platform:p.platform,accountDigest:p.accountDigest,resourceDigest:a.resourceDigest,actionDigest:a.actionDigest,nonceDigest:v.nonceDigest,canonicalDigest,canonicalObservedAt:v.currentBinding.canonicalObservedAt};
  const checked=inspectAyasRevenueWriteBinding(binding,v.currentBinding,v.journal,now);if(checked.decision==="BLOCK")return finish("BLOCKED","BINDING_OR_JOURNAL_REFUSED");
  return finish("MANUAL_OWNER_REVIEW","NO_SEPARATELY_OPENED_WRITE_PATH",{pilotId:p.pilotId,planDigest:p.planDigest,offerDigest:p.offerDigest,operation:a.operation,actionId:a.actionId,...binding,scopeDigest:digestAyasRevenueData({offerDigest:p.offerDigest,operation:a.operation,...binding})});
 }catch{return finish("BLOCKED","CORRUPT_OR_UNAVAILABLE_CANONICAL");}
}
