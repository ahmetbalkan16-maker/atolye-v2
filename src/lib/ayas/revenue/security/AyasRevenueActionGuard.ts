/** Additional refusal only. No approval parameter, executor, budget or autonomous write decision. */
import { isAyasRevenueRequestShape,ayasRevenueEffect } from "../AyasRevenueActionPolicy";
import { isAyasRevenueOperation,isAyasRevenuePlatform,hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { inspectAyasRevenueContent } from "./AyasRevenueContentFirewall";
import { AYAS_REVENUE_SECURITY_LIMITS,revenueRiskEvidence,revenueSecuritySnapshot,type AyasRevenueRiskCode } from "./AyasRevenueThreatModel";
export function guardAyasRevenueAction(raw:unknown) {
  const request=revenueSecuritySnapshot(raw),codes:AyasRevenueRiskCode[]=[];
  if(!isAyasRevenueRequestShape(request)||!isAyasRevenueOperation(request.operation)||!isAyasRevenuePlatform(request.platform))return Object.freeze({decision:"BLOCK",...revenueRiskEvidence(["UNKNOWN_RISK"],null)});
  const effect=ayasRevenueEffect(request.operation),content=inspectAyasRevenueContent(request.payload??{},request.platform);codes.push(...content.risks);
  if(effect==="FINANCIAL_COMMITMENT")codes.push("UNEXPECTED_FINANCIAL_EFFECT");
  return Object.freeze({decision:codes.length?"BLOCK":effect==="EXTERNAL_WRITE"?"REQUIRE_OWNER_REVIEW":effect==="LOCAL_DRAFT"?"ALLOW_LOCAL_DRAFT":"ALLOW_READ",...revenueRiskEvidence(codes,request)});
}
const BINDING_KEYS=["platform","accountDigest","resourceDigest","actionDigest","nonceDigest","canonicalDigest","canonicalObservedAt"];
const binding=(v:unknown):v is Record<string,unknown>=>isAyasRevenuePlainRecord(v)&&hasExactAyasRevenueKeys(v,BINDING_KEYS)&&isAyasRevenuePlatform(v.platform)
  &&[v.accountDigest,v.resourceDigest,v.actionDigest,v.nonceDigest,v.canonicalDigest].every(isAyasRevenueDigest)&&isAyasRevenueTimestamp(v.canonicalObservedAt);
/** Fresh canonical reader and durable journal are still caller qualification; this never consumes a nonce. */
export function inspectAyasRevenueWriteBinding(proposed:unknown,current:unknown,journal:unknown,now:unknown) {
  const a=revenueSecuritySnapshot(proposed),b=revenueSecuritySnapshot(current),j=revenueSecuritySnapshot(journal),codes:AyasRevenueRiskCode[]=[];
  if(!binding(a)||!binding(b)||!isAyasRevenueTimestamp(now)||!Array.isArray(j)||j.length>AYAS_REVENUE_SECURITY_LIMITS.history||!j.every(v=>isAyasRevenuePlainRecord(v)&&hasExactAyasRevenueKeys(v,["actionDigest","nonceDigest","status"])&&isAyasRevenueDigest(v.actionDigest)&&isAyasRevenueDigest(v.nonceDigest)&&["PENDING","COMPLETED","REJECTED","UNKNOWN"].includes(v.status as string)))return Object.freeze({decision:"BLOCK",...revenueRiskEvidence(["UNKNOWN_RISK"],null)});
  if(["platform","accountDigest","resourceDigest","actionDigest","nonceDigest"].some(k=>a[k]!==b[k]))codes.push("RESOURCE_ID_CONFUSION");
  if(a.canonicalDigest!==b.canonicalDigest||Date.parse(b.canonicalObservedAt as string)>Date.parse(now)||Date.parse(now)-Date.parse(b.canonicalObservedAt as string)>60000||Date.parse(b.canonicalObservedAt as string)<Date.parse(a.canonicalObservedAt as string))codes.push("CANONICAL_STATE_MISMATCH");
  if(j.some(v=>v.actionDigest===a.actionDigest||v.nonceDigest===a.nonceDigest))codes.push("DUPLICATE_EXTERNAL_WRITE");
  return Object.freeze({decision:codes.length?"BLOCK":"REQUIRE_OWNER_REVIEW",bindingDigest:digestAyasRevenueData(a),...revenueRiskEvidence(codes,null)});
}
