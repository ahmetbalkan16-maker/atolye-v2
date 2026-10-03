/** Closed, normalized business observations. These records authenticate neither an owner nor a platform. */
import { digestAyasRevenueData } from "./AyasRevenueDigest";
import { isAyasRevenueDigest, isAyasRevenueNeutralCode, isAyasRevenueScenarioMoney } from "./AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenueBoundedJson,
  isAyasRevenueExternalId, isAyasRevenuePlainRecord, isAyasRevenuePlatform, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import type { AyasRevenuePlatform } from "./AyasRevenuePlatformTypes";
export const AYAS_REVENUE_MEMORY_KINDS = ["OFFER","PLATFORM_PLAN","EXPERIMENT","CHANNEL_DECISION","PRICING_DECISION","CUSTOMER_SEGMENT","CONTENT_PLAN","DELIVERY_PATTERN","FOLLOW_UP","LESSON_LEARNED","PERFORMANCE_SUMMARY"] as const;
export const AYAS_REVENUE_FACT_CLASSES = ["REALIZED_LEDGER_FACT","PLATFORM_OBSERVATION","OWNER_DECISION","VALIDATION_RESULT","SYSTEM_DERIVED","HYPOTHESIS"] as const;
export const AYAS_REVENUE_MEMORY_SLOTS = ["OFFER_PLATFORM","OFFER_PRICE","OFFER_STATUS","CHANNEL_PRIORITY","EXPERIMENT_STATE","FOLLOWUP_STATUS","PRIMARY_OFFER"] as const;
export const AYAS_REVENUE_MEMORY_STATES = ["PLANNED","ACTIVE","PAUSED","CLOSED","CANCELLED","PENDING","SUCCESS","FAILED","DUE","DONE","LOW","MEDIUM","HIGH","UNKNOWN"] as const;
export const AYAS_REVENUE_MEMORY_MAX_RECORDS = 2048, AYAS_REVENUE_MEMORY_MAX_BYTES = 8 * 1024 * 1024;
export type AyasRevenueMemoryKind = typeof AYAS_REVENUE_MEMORY_KINDS[number];
export type AyasRevenueFactClass = typeof AYAS_REVENUE_FACT_CLASSES[number];
export interface AyasRevenueMemoryInput {
  readonly schemaVersion: "1"; readonly eventDigest: string; readonly kind: AyasRevenueMemoryKind; readonly factClass: AyasRevenueFactClass;
  readonly source: "OWNER_IMPORT" | "PLATFORM_ADAPTER" | "SYSTEM_DERIVED"; readonly evidenceDigest: string; readonly reviewEvidenceDigest: string | null;
  readonly platform: AyasRevenuePlatform | null; readonly offerDigest: string | null; readonly entityId: string | null;
  readonly slot: typeof AYAS_REVENUE_MEMORY_SLOTS[number] | null;
  readonly value: { readonly state: typeof AYAS_REVENUE_MEMORY_STATES[number] | null; readonly code: string | null;
    readonly plannedPrice: { readonly valueMinor: number; readonly currency: string } | null; readonly relatedDigest: string | null;
    readonly dueAt: string | null; readonly activityCount: number | null };
  readonly ledgerRef: { readonly digest: string; readonly revision: number } | null;
  readonly observedAt: string; readonly effectiveFrom: string; readonly effectiveUntil: string | null; readonly supersedesRecordId: string | null;
}
export interface AyasRevenueMemoryRecord extends AyasRevenueMemoryInput { readonly recordId: string; readonly recordedAt: string; readonly factKey: string | null }
export interface AyasRevenueMemoryState { readonly schemaVersion: "1"; readonly revision: number; readonly records: readonly AyasRevenueMemoryRecord[] }
export class AyasRevenueMemoryError extends Error {
  constructor(readonly code: "INVALID_RECORD"|"INVALID_STORE"|"CONFLICT"|"CAPACITY"|"STORAGE_UNSAFE"|"STORAGE_IO"|"REVISION_CONFLICT"|"LOCK_BUSY") {
    super("AYAS_REVENUE_MEMORY_"+code); this.name="AyasRevenueMemoryError"; this.stack=undefined;
  }
}
const INPUT_KEYS=["schemaVersion","eventDigest","kind","factClass","source","evidenceDigest","reviewEvidenceDigest","platform","offerDigest","entityId","slot","value","ledgerRef","observedAt","effectiveFrom","effectiveUntil","supersedesRecordId"];
const recordId=(v:unknown):v is string=>typeof v==="string"&&/^revenue-memory-[a-f0-9]{64}$/.test(v);
const nullableDigest=(v:unknown)=>v===null||isAyasRevenueDigest(v);
export const ayasRevenueFactTrust = (c:AyasRevenueFactClass):number=>({REALIZED_LEDGER_FACT:6,OWNER_DECISION:5,PLATFORM_OBSERVATION:4,VALIDATION_RESULT:3,SYSTEM_DERIVED:2,HYPOTHESIS:1}[c]);
/** A trusted structured producer selects a slot; text never creates one. */
export function ayasRevenueMemoryFactKey(v:AyasRevenueMemoryInput):string|null {
  switch(v.slot) {
    case "OFFER_PLATFORM": return "revenue.offer.current-platform";
    case "OFFER_PRICE": return `revenue.offer.current-price:${v.offerDigest}:${v.value.plannedPrice!.currency}`;
    case "OFFER_STATUS": return "revenue.offer.current-status:"+v.offerDigest;
    case "CHANNEL_PRIORITY": return "revenue.channel.current-priority:"+v.platform;
    case "EXPERIMENT_STATE": return "revenue.experiment.current-state:"+v.entityId;
    case "FOLLOWUP_STATUS": return "revenue.followup.current-status:"+v.entityId;
    case "PRIMARY_OFFER": return "revenue.plan.current-primary-offer";
    case null:return null;
  }
}
function validInput(raw:unknown,recordedAt:string):raw is AyasRevenueMemoryInput {
  if(!isAyasRevenueBoundedJson(raw,4096)||containsAyasRevenueSensitiveData(raw)||!isAyasRevenuePlainRecord(raw)||!hasExactAyasRevenueKeys(raw,INPUT_KEYS)
    ||raw.schemaVersion!=="1"||!isAyasRevenueDigest(raw.eventDigest)||!isAyasRevenueDigest(raw.evidenceDigest)
    ||!(AYAS_REVENUE_MEMORY_KINDS as readonly unknown[]).includes(raw.kind)||!(AYAS_REVENUE_FACT_CLASSES as readonly unknown[]).includes(raw.factClass)
    ||!["OWNER_IMPORT","PLATFORM_ADAPTER","SYSTEM_DERIVED"].includes(raw.source as string)||!nullableDigest(raw.reviewEvidenceDigest)
    ||!(raw.platform===null||isAyasRevenuePlatform(raw.platform))||!nullableDigest(raw.offerDigest)||!(raw.entityId===null||isAyasRevenueExternalId(raw.entityId))
    ||!(raw.slot===null||(AYAS_REVENUE_MEMORY_SLOTS as readonly unknown[]).includes(raw.slot))
    ||!isAyasRevenueTimestamp(recordedAt)||!isAyasRevenueTimestamp(raw.observedAt)||Date.parse(raw.observedAt)>Date.parse(recordedAt)
    ||!isAyasRevenueTimestamp(raw.effectiveFrom)||!(raw.effectiveUntil===null||isAyasRevenueTimestamp(raw.effectiveUntil)&&Date.parse(raw.effectiveUntil)>Date.parse(raw.effectiveFrom))
    ||!(raw.supersedesRecordId===null||recordId(raw.supersedesRecordId)))return false;
  const v=raw.value,l=raw.ledgerRef;
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,["state","code","plannedPrice","relatedDigest","dueAt","activityCount"])
    ||!(v.state===null||(AYAS_REVENUE_MEMORY_STATES as readonly unknown[]).includes(v.state))||!(v.code===null||isAyasRevenueNeutralCode(v.code))
    ||!(v.plannedPrice===null||isAyasRevenueScenarioMoney(v.plannedPrice))||!nullableDigest(v.relatedDigest)
    ||!(v.dueAt===null||isAyasRevenueTimestamp(v.dueAt))||!(v.activityCount===null||Number.isSafeInteger(v.activityCount)&&!Object.is(v.activityCount,-0)&&(v.activityCount as number)>=0&&(v.activityCount as number)<=1_000_000))return false;
  if(raw.factClass==="OWNER_DECISION" ? raw.source!=="OWNER_IMPORT"||!isAyasRevenueDigest(raw.reviewEvidenceDigest) : raw.reviewEvidenceDigest!==null)return false;
  if(raw.factClass==="HYPOTHESIS"&&raw.source!=="SYSTEM_DERIVED"||raw.factClass==="PLATFORM_OBSERVATION"&&raw.source!=="PLATFORM_ADAPTER")return false;
  if(raw.factClass==="REALIZED_LEDGER_FACT") {
    if(raw.kind!=="PERFORMANCE_SUMMARY"||raw.slot!==null||v.plannedPrice!==null||!isAyasRevenuePlainRecord(l)||!hasExactAyasRevenueKeys(l,["digest","revision"])
      ||!isAyasRevenueDigest(l.digest)||!Number.isSafeInteger(l.revision)||(l.revision as number)<0||(l.revision as number)>10_000)return false;
  } else if(l!==null)return false;
  if(v.plannedPrice!==null&&(raw.kind!=="PRICING_DECISION"||raw.offerDigest===null))return false;
  if(v.dueAt!==null&&raw.kind!=="FOLLOW_UP")return false;
  if(raw.kind==="PRICING_DECISION"&&v.plannedPrice===null||["OFFER","PLATFORM_PLAN"].includes(raw.kind as string)&&raw.offerDigest===null)return false;
  const slots:Record<string,string[]>={OFFER_PLATFORM:["PLATFORM_PLAN"],OFFER_PRICE:["PRICING_DECISION"],OFFER_STATUS:["OFFER"],CHANNEL_PRIORITY:["CHANNEL_DECISION"],EXPERIMENT_STATE:["EXPERIMENT"],FOLLOWUP_STATUS:["FOLLOW_UP"],PRIMARY_OFFER:["OFFER"]};
  if(raw.slot!==null&&!slots[raw.slot as string]?.includes(raw.kind as string))return false;
  if(["OFFER_PLATFORM","CHANNEL_PRIORITY"].includes(raw.slot as string)&&raw.platform===null||["EXPERIMENT_STATE","FOLLOWUP_STATUS"].includes(raw.slot as string)&&raw.entityId===null)return false;
  if(["OFFER_STATUS","EXPERIMENT_STATE","FOLLOWUP_STATUS","CHANNEL_PRIORITY","PRIMARY_OFFER"].includes(raw.slot as string)&&v.state===null)return false;
  if(raw.slot==="CHANNEL_PRIORITY"&&!["LOW","MEDIUM","HIGH","UNKNOWN"].includes(v.state as string))return false;
  if(["OFFER_STATUS","PRIMARY_OFFER"].includes(raw.slot as string)&&!["PLANNED","ACTIVE","PAUSED","CLOSED","CANCELLED","UNKNOWN"].includes(v.state as string))return false;
  return true;
}
export function createAyasRevenueMemoryRecord(raw:unknown,recordedAt:string):AyasRevenueMemoryRecord {
  try {if(!validInput(raw,recordedAt))throw Error();const input=structuredClone(raw),factKey=ayasRevenueMemoryFactKey(input);
    const material={...input,recordedAt,factKey},digest=digestAyasRevenueData(material);if(!digest)throw Error();return deepFreezeAyasRevenueValue({...material,recordId:"revenue-memory-"+digest});
  }catch{throw new AyasRevenueMemoryError("INVALID_RECORD");}
}
function inputOf(v:AyasRevenueMemoryRecord):AyasRevenueMemoryInput {return Object.fromEntries(INPUT_KEYS.map(k=>[k,v[k as keyof AyasRevenueMemoryInput]])) as unknown as AyasRevenueMemoryInput;}
export function planAyasRevenueMemoryAppend(state:AyasRevenueMemoryState,candidate:AyasRevenueMemoryRecord):{readonly kind:"APPEND"|"REPLAY";readonly record:AyasRevenueMemoryRecord} {
  const previous=state.records.find(v=>v.eventDigest===candidate.eventDigest);
  if(previous){if(digestAyasRevenueData(inputOf(previous))!==digestAyasRevenueData(inputOf(candidate)))throw new AyasRevenueMemoryError("CONFLICT");return {kind:"REPLAY",record:previous};}
  if(candidate.supersedesRecordId!==null){const target=state.records.find(v=>v.recordId===candidate.supersedesRecordId);
    if(!target||!candidate.factKey||target.factKey!==candidate.factKey||ayasRevenueFactTrust(candidate.factClass)<ayasRevenueFactTrust(target.factClass)
      ||Date.parse(candidate.observedAt)<Date.parse(target.observedAt))throw new AyasRevenueMemoryError("CONFLICT");}
  if(candidate.offerDigest&&candidate.value.state==="ACTIVE"&&["OFFER_STATUS","PRIMARY_OFFER"].includes(candidate.slot!)) {
    const statuses=state.records.filter(v=>v.offerDigest===candidate.offerDigest&&v.slot==="OFFER_STATUS"&&v.factClass==="OWNER_DECISION"&&Date.parse(v.effectiveFrom)<=Date.parse(candidate.effectiveFrom)).sort((a,b)=>Date.parse(b.effectiveFrom)-Date.parse(a.effectiveFrom)||Date.parse(b.recordedAt)-Date.parse(a.recordedAt));
    const latest=statuses[0];if(latest&&["CLOSED","CANCELLED"].includes(latest.value.state!)&&(candidate.slot!=="OFFER_STATUS"||candidate.factClass!=="OWNER_DECISION"||candidate.supersedesRecordId!==latest.recordId))throw new AyasRevenueMemoryError("CONFLICT");
  }
  return {kind:"APPEND",record:candidate};
}
export function emptyAyasRevenueMemory():AyasRevenueMemoryState{return deepFreezeAyasRevenueValue({schemaVersion:"1",revision:0,records:[]});}
export function validateAyasRevenueMemoryState(raw:unknown):AyasRevenueMemoryState {
  try{if(!isAyasRevenueBoundedJson(raw,AYAS_REVENUE_MEMORY_MAX_BYTES)||!isAyasRevenuePlainRecord(raw)||!hasExactAyasRevenueKeys(raw,["schemaVersion","revision","records"])
    ||raw.schemaVersion!=="1"||!Array.isArray(raw.records)||raw.records.length>AYAS_REVENUE_MEMORY_MAX_RECORDS||raw.revision!==raw.records.length)throw Error();
    const records:AyasRevenueMemoryRecord[]=[];
    for(const item of raw.records){if(!isAyasRevenuePlainRecord(item)||!hasExactAyasRevenueKeys(item,[...INPUT_KEYS,"recordId","recordedAt","factKey"]))throw Error();
      const expected=createAyasRevenueMemoryRecord(inputOf(item as unknown as AyasRevenueMemoryRecord),item.recordedAt as string);
      if(item.recordId!==expected.recordId||item.factKey!==expected.factKey||records.some(v=>Date.parse(v.recordedAt)>Date.parse(expected.recordedAt))||planAyasRevenueMemoryAppend({schemaVersion:"1",revision:records.length,records},expected).kind!=="APPEND")throw Error();records.push(expected);}
    return deepFreezeAyasRevenueValue({schemaVersion:"1",revision:records.length,records});
  }catch{throw new AyasRevenueMemoryError("INVALID_STORE");}
}
export function digestAyasRevenueMemoryState(raw:unknown):string {const state=validateAyasRevenueMemoryState(raw);return digestAyasRevenueData({revision:state.revision,records:state.records.map(v=>v.recordId)})!;}
