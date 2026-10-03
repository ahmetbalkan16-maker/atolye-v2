/** Trusted official-reader snapshots only; this pure comparison neither connects nor rotates credentials. */
import { hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp,isAyasRevenuePlatform } from "../AyasRevenueRedaction";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { AYAS_REVENUE_SECURITY_LIMITS,revenueRiskEvidence,revenueSecuritySnapshot,type AyasRevenueRiskCode } from "./AyasRevenueThreatModel";
const KEYS=["schemaVersion","platform","accountDigest","storeDigest","mode","scopeDigest","toolCatalogDigest","securitySettingsDigest","credentialState","unexpectedWrite","unfamiliarDevice","mfaChanged","observedAt"];
const valid=(v:unknown):v is Record<string,unknown>=>isAyasRevenuePlainRecord(v)&&hasExactAyasRevenueKeys(v,KEYS)&&v.schemaVersion==="1"&&isAyasRevenuePlatform(v.platform)
  &&[v.accountDigest,v.storeDigest,v.scopeDigest,v.toolCatalogDigest,v.securitySettingsDigest].every(isAyasRevenueDigest)&&["TEST","LIVE","MANUAL"].includes(v.mode as string)
  &&["ACTIVE","REVOKED","UNKNOWN"].includes(v.credentialState as string)&&[v.unexpectedWrite,v.unfamiliarDevice,v.mfaChanged].every(x=>typeof x==="boolean")&&isAyasRevenueTimestamp(v.observedAt);
export function assessAyasRevenueAccountSafety(prior:unknown,observed:unknown,now:unknown) {
  const a=revenueSecuritySnapshot(prior),b=revenueSecuritySnapshot(observed),codes:AyasRevenueRiskCode[]=[];
  if(!valid(a)||!valid(b)||!isAyasRevenueTimestamp(now))return Object.freeze({state:"ACCOUNT_REAUTH_REQUIRED",...revenueRiskEvidence(["UNKNOWN_RISK"],null)});
  const time=Date.parse(now),at=Date.parse(b.observedAt as string);
  if(at>time||at<Date.parse(a.observedAt as string)||Date.parse(a.observedAt as string)>time||time-at>AYAS_REVENUE_SECURITY_LIMITS.accountAgeMs)codes.push("UNKNOWN_RISK");
  if(b.credentialState!=="ACTIVE"||b.unfamiliarDevice)codes.push("ACCOUNT_TAKEOVER_SIGNAL");
  if(a.platform!==b.platform||a.accountDigest!==b.accountDigest||a.storeDigest!==b.storeDigest||a.mode!==b.mode)codes.push("RESOURCE_ID_CONFUSION");
  if(a.scopeDigest!==b.scopeDigest)codes.push("SESSION_SCOPE_DRIFT");
  if(a.toolCatalogDigest!==b.toolCatalogDigest||b.unexpectedWrite)codes.push("UNKNOWN_TOOL_OR_SCOPE");
  if(a.securitySettingsDigest!==b.securitySettingsDigest||b.mfaChanged)codes.push("MFA_OR_AUTH_CHANGE");
  return Object.freeze({state:codes.length?"ACCOUNT_REAUTH_REQUIRED":"OBSERVED_STABLE",...revenueRiskEvidence(codes,b)});
}
