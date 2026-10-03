/** Temporal v2 read-side semantics for a separate closed business registry; conversation keys stay unchanged. */
import { ayasRevenueFactTrust, validateAyasRevenueMemoryState, type AyasRevenueMemoryRecord } from "./AyasRevenueMemory";
import { deepFreezeAyasRevenueValue, isAyasRevenueTimestamp } from "./AyasRevenueRedaction";
import { digestAyasRevenueData } from "./AyasRevenueDigest";
export interface AyasRevenueTemporalQuery {readonly mode:"current"|"history"|"as-of";readonly at:string;readonly knownAt:string;readonly from:string|null;readonly until:string|null}
export interface AyasRevenueTemporalView {readonly record:AyasRevenueMemoryRecord;readonly state:"current"|"historical"|"future"|"disputed"|"superseded";readonly isCurrent:boolean}
export function resolveAyasRevenueTemporal(raw:unknown,query:AyasRevenueTemporalQuery):readonly AyasRevenueTemporalView[] {
  if(!["current","history","as-of"].includes(query.mode)||!isAyasRevenueTimestamp(query.at)||!isAyasRevenueTimestamp(query.knownAt)
    ||[query.from,query.until].some(v=>v!==null&&!isAyasRevenueTimestamp(v))||query.from!==null&&query.until!==null&&Date.parse(query.from)>=Date.parse(query.until))throw Error("AYAS_REVENUE_TEMPORAL_QUERY_INVALID");
  const memory=validateAyasRevenueMemoryState(raw),at=Date.parse(query.at),known=Date.parse(query.knownAt);
  const visible=memory.records.filter(v=>Date.parse(v.recordedAt)<=known&&Date.parse(v.observedAt)<=known),states=new Map<string,AyasRevenueTemporalView["state"]>();
  for(const v of visible)states.set(v.recordId,Date.parse(v.effectiveFrom)>at?"future":v.effectiveUntil&&Date.parse(v.effectiveUntil)<=at?"historical":"current");
  const groups=new Map<string,AyasRevenueMemoryRecord[]>();for(const v of visible){if(!v.factKey)continue;const list=groups.get(v.factKey)??[];list.push(v);groups.set(v.factKey,list);}
  for(const records of groups.values()) {
    const eligible=records.filter(v=>Date.parse(v.effectiveFrom)<=at);if(!eligible.length)continue;
    const rank=Math.max(...eligible.map(v=>ayasRevenueFactTrust(v.factClass))),trusted=eligible.filter(v=>ayasRevenueFactTrust(v.factClass)===rank);
    const latest=Math.max(...trusted.map(v=>Date.parse(v.effectiveFrom))),version=trusted.filter(v=>Date.parse(v.effectiveFrom)===latest);
    const superseded=new Set(eligible.map(v=>v.supersedesRecordId).filter((v):v is string=>v!==null));
    const winners=version.filter(v=>!superseded.has(v.recordId)),values=new Set(winners.map(v=>digestAyasRevenueData({value:v.value,platform:v.platform,offerDigest:v.offerDigest,ledgerRef:v.ledgerRef})));
    for(const v of eligible)if(!winners.includes(v))states.set(v.recordId,"superseded");
    for(const v of winners)states.set(v.recordId,values.size>1?"disputed":v.effectiveUntil&&Date.parse(v.effectiveUntil)<=at?"historical":"current");
  }
  return deepFreezeAyasRevenueValue(visible.map(record=>({record,state:states.get(record.recordId)!,isCurrent:states.get(record.recordId)==="current"})));
}
