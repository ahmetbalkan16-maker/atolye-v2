/** Stage16.11A: review metadata only. No legal opinion, authentication, activation or IO. */
import { types } from "node:util";
import { deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson, isAyasRevenueOperation,
  isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { AYAS_REVENUE_OPERATION_EFFECT, AYAS_REVENUE_TRANSPORTS, type AyasRevenueOperation, type AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";

export const AYAS_REVENUE_COMPLIANCE_REQUIREMENTS = Object.freeze([
  "CURRENT_TERMS", "ACCOUNT_STANDING", "AUTOMATION_PERMISSION", "OFFER_RIGHTS", "FEES_AND_CONSUMER_DUTIES", "JURISDICTION", "TAX_REVIEW", "LEGAL_REVIEW",
] as const);
type Requirement = typeof AYAS_REVENUE_COMPLIANCE_REQUIREMENTS[number];
type Source = "OFFICIAL_REFERENCE" | "OFFICIAL_ACCOUNT_READER" | "PLATFORM_PERMISSION" | "OWNER_REVIEW" | "PROFESSIONAL_REVIEW";
export interface AyasRevenueComplianceScope {
  readonly schemaVersion: "1"; readonly platform: AyasRevenuePlatform; readonly accountDigest: string; readonly offerDigest: string;
  readonly operation: AyasRevenueOperation; readonly transport: typeof AYAS_REVENUE_TRANSPORTS[number];
  readonly termsDigest: string; readonly scopeDigest: string; readonly observedAt: string;
}
export interface AyasRevenueComplianceRecord {
  readonly requirement: Requirement; readonly state: "REVIEWED" | "RESTRICTED" | "UNKNOWN";
  readonly source: Source; readonly evidenceDigest: string | null; readonly observedAt: string;
  readonly platform: AyasRevenuePlatform; readonly accountDigest: string; readonly offerDigest: string;
  readonly operation: AyasRevenueOperation; readonly termsDigest: string; readonly scopeDigest: string;
  readonly automationBasis: "NOT_APPLICABLE" | "WRITTEN_PLATFORM_PERMISSION" | "APPROVED_API_USE_CASE" | "MANUAL_ONLY" | "OFFICIAL_API_TERMS" | "UNKNOWN";
}
export interface AyasRevenueComplianceInput extends AyasRevenueComplianceScope { readonly records: readonly AyasRevenueComplianceRecord[] }
const DAY = 86400000;
const MAX_AGE: Readonly<Record<Requirement, number>> = Object.freeze({CURRENT_TERMS:30*DAY, ACCOUNT_STANDING:DAY, AUTOMATION_PERMISSION:7*DAY,
  OFFER_RIGHTS:7*DAY, FEES_AND_CONSUMER_DUTIES:7*DAY, JURISDICTION:7*DAY, TAX_REVIEW:7*DAY, LEGAL_REVIEW:7*DAY});
const SOURCES: Readonly<Record<Requirement, readonly Source[]>> = Object.freeze({
  CURRENT_TERMS:["OFFICIAL_REFERENCE"], ACCOUNT_STANDING:["OFFICIAL_ACCOUNT_READER"], AUTOMATION_PERMISSION:["PLATFORM_PERMISSION","OFFICIAL_REFERENCE","OWNER_REVIEW"],
  OFFER_RIGHTS:["OWNER_REVIEW","PROFESSIONAL_REVIEW"], FEES_AND_CONSUMER_DUTIES:["OFFICIAL_REFERENCE","PROFESSIONAL_REVIEW"],
  JURISDICTION:["OWNER_REVIEW","PROFESSIONAL_REVIEW"], TAX_REVIEW:["PROFESSIONAL_REVIEW"], LEGAL_REVIEW:["PROFESSIONAL_REVIEW"],
});
const SCOPE_KEYS = ["schemaVersion","platform","accountDigest","offerDigest","operation","transport","termsDigest","scopeDigest","observedAt"];
const RECORD_KEYS = ["requirement","state","source","evidenceDigest","observedAt","platform","accountDigest","offerDigest","operation","termsDigest","scopeDigest","automationBasis"];
const BOUND_KEYS = ["platform","accountDigest","offerDigest","operation","termsDigest","scopeDigest"] as const;
const PROFESSIONAL = new Set<Requirement>(["JURISDICTION","TAX_REVIEW","LEGAL_REVIEW"]);
/** Native proxy detection precedes every reflection/serialization, including nested records and arrays. */
function proxyFree(raw:unknown):boolean {
  let nodes=0;
  const visit=(v:unknown,depth:number):boolean=>{
    if(++nodes>4096||depth>8)return false;
    if(v===null||typeof v!=="object")return true;
    if(types.isProxy(v))return false;
    return Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,"value")&&visit(d.value,depth+1));
  };
  return visit(raw,0);
}
function validScope(v:Record<string,unknown>):boolean {
  return v.schemaVersion === "1" && isAyasRevenuePlatform(v.platform) && isAyasRevenueOperation(v.operation)
    && (AYAS_REVENUE_TRANSPORTS as readonly unknown[]).includes(v.transport) && isAyasRevenueTimestamp(v.observedAt)
    && [v.accountDigest,v.offerDigest,v.termsDigest,v.scopeDigest].every(isAyasRevenueDigest);
}
function validRecord(v:unknown):v is AyasRevenueComplianceRecord {
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,RECORD_KEYS))return false;
  return (AYAS_REVENUE_COMPLIANCE_REQUIREMENTS as readonly unknown[]).includes(v.requirement) && ["REVIEWED","RESTRICTED","UNKNOWN"].includes(v.state as string)
    && SOURCES[v.requirement as Requirement].includes(v.source as Source) && isAyasRevenueTimestamp(v.observedAt)
    && isAyasRevenuePlatform(v.platform) && isAyasRevenueOperation(v.operation) && [v.accountDigest,v.offerDigest,v.termsDigest,v.scopeDigest].every(isAyasRevenueDigest)
    && (v.evidenceDigest === null || isAyasRevenueDigest(v.evidenceDigest)) && (v.state !== "REVIEWED" || isAyasRevenueDigest(v.evidenceDigest))
    && ["NOT_APPLICABLE","WRITTEN_PLATFORM_PERMISSION","APPROVED_API_USE_CASE","MANUAL_ONLY","OFFICIAL_API_TERMS","UNKNOWN"].includes(v.automationBasis as string)
    && (v.requirement === "AUTOMATION_PERMISSION" || v.automationBasis === "NOT_APPLICABLE");
}
function snapshot(raw:unknown):AyasRevenueComplianceInput|null {
  try {
    // Never call getters, proxies' value coercion, or input-selected review functions.
    if(!proxyFree(raw)||!isAyasRevenueBoundedJson(raw,32768))return null;
    const v:unknown=structuredClone(raw);
    if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,SCOPE_KEYS,["records"])||!Object.hasOwn(v,"records")||!validScope(v)
      ||!Array.isArray(v.records)||v.records.length>AYAS_REVENUE_COMPLIANCE_REQUIREMENTS.length||!v.records.every(validRecord))return null;
    return deepFreezeAyasRevenueValue(v as unknown as AyasRevenueComplianceInput);
  } catch {return null;}
}
function automationMatches(v:AyasRevenueComplianceInput,r:AyasRevenueComplianceRecord):boolean {
  if(v.transport === "MANUAL_HANDOFF")return r.automationBasis === "MANUAL_ONLY" && r.source === "OWNER_REVIEW";
  if(v.platform === "fiverr")return false;
  if(v.platform === "etsy")return r.automationBasis === "WRITTEN_PLATFORM_PERMISSION" && r.source === "PLATFORM_PERMISSION";
  if(v.platform === "upwork")return r.automationBasis === "APPROVED_API_USE_CASE" && r.source === "PLATFORM_PERMISSION";
  return r.automationBasis === "OFFICIAL_API_TERMS" && r.source === "OFFICIAL_REFERENCE";
}
export type AyasRevenueComplianceState = "BLOCKED" | "OWNER_REVIEW_REQUIRED" | "PROFESSIONAL_REVIEW_REQUIRED" | "REVIEW_CHECKLIST_COMPLETE_NOT_AUTHORITY";
function result(state:AyasRevenueComplianceState,codes:readonly string[],missing:readonly Requirement[]) {
  return deepFreezeAyasRevenueValue({state, reasonCodes:[...new Set(codes)].sort(), reviewRequired:[...new Set(missing)].sort(),
    evidenceQualification:"CALLER_METADATA_ONLY" as const, currentTermsQualification:"OFFICIAL_READER_UNBOUND" as const,
    ownerAuthentication:"UNBOUND" as const, professionalAuthority:"NONE" as const, legalConclusion:"NONE" as const,
    pilotActivationAllowed:false as const, grantsAuthority:false as const, externalWrite:false as const, autonomousSpend:0 as const, rawRetention:"NONE" as const});
}
/** `now` is supplied by trusted application code. Caller receipts never become approval or actual compliance. */
export function assessAyasRevenueCompliance(raw:unknown,now:unknown) {
  const v=snapshot(raw);
  if(!v||!isAyasRevenueTimestamp(now))return result("BLOCKED",["INVALID_COMPLIANCE_METADATA"],[]);
  const time=Date.parse(now),scopeAt=Date.parse(v.observedAt);
  if(scopeAt>time||time-scopeAt>DAY)return result("BLOCKED",["STALE_OR_FUTURE_SCOPE"],[]);
  if(AYAS_REVENUE_OPERATION_EFFECT[v.operation] === "FINANCIAL_COMMITMENT")return result("BLOCKED",["FINANCIAL_EFFECT_NOT_AUTHORIZED"],[]);
  if(v.platform === "fiverr" && v.transport !== "MANUAL_HANDOFF")return result("BLOCKED",["FIVERR_MANUAL_HANDOFF_ONLY"],[]);
  const rows=new Map<Requirement,AyasRevenueComplianceRecord>();
  for(const r of v.records){
    if(rows.has(r.requirement))return result("BLOCKED",["DUPLICATE_REVIEW_RECORD"],[]);
    if(BOUND_KEYS.some(k=>r[k]!==v[k]))return result("BLOCKED",["REVIEW_SCOPE_MISMATCH"],[]);
    if(r.state === "RESTRICTED")return result("BLOCKED",["RESTRICTED_"+r.requirement],[]);
    rows.set(r.requirement,r);
  }
  const missing:Requirement[]=[],codes:string[]=[];
  for(const requirement of AYAS_REVENUE_COMPLIANCE_REQUIREMENTS){
    const r=rows.get(requirement),at=r?Date.parse(r.observedAt):null;
    if(!r||r.state !== "REVIEWED"||at===null||at>time||time-at>MAX_AGE[requirement]){
      missing.push(requirement);codes.push(!r?"MISSING_"+requirement:r.state!=="REVIEWED"?"UNKNOWN_"+requirement:"STALE_OR_FUTURE_"+requirement);continue;
    }
    if(requirement === "AUTOMATION_PERMISSION" && !automationMatches(v,r)){missing.push(requirement);codes.push(v.platform === "etsy"?"ETSY_WRITTEN_PERMISSION_REQUIRED":v.platform === "upwork"?"UPWORK_APPROVED_API_USE_CASE_REQUIRED":"AUTOMATION_BASIS_UNQUALIFIED");}
  }
  if(missing.some(r=>PROFESSIONAL.has(r)))return result("PROFESSIONAL_REVIEW_REQUIRED",codes,missing);
  if(missing.length)return result("OWNER_REVIEW_REQUIRED",codes,missing);
  return result("REVIEW_CHECKLIST_COMPLETE_NOT_AUTHORITY",["EXISTING_OWNER_GATE_AND_ACTUAL_REVIEW_BINDING_REQUIRED"],[]);
}
