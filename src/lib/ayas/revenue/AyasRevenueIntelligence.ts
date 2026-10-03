/** Advisory read model. Realized amounts are derived exclusively from16.2, never from memory or forecasts. */
import { groupAyasRevenueEconomics, summarizeAyasRevenueEconomics } from "./AyasRevenueEconomics";
import { digestAyasRevenueLedgerData } from "./AyasRevenueDigest";
import { validateAyasRevenueLedgerState } from "./AyasRevenueLedger";
import { digestAyasRevenueMemoryState } from "./AyasRevenueMemory";
import { resolveAyasRevenueTemporal, type AyasRevenueTemporalQuery } from "./AyasRevenueTemporal";
import { deepFreezeAyasRevenueValue } from "./AyasRevenueRedaction";
export function buildAyasRevenueIntelligence(memory:unknown,ledger:unknown,query:AyasRevenueTemporalQuery) {
  const views=resolveAyasRevenueTemporal(memory,query),state=validateAyasRevenueLedgerState(ledger),known=Date.parse(query.knownAt),at=Date.parse(query.at);
  if(state.entries.some(v=>Date.parse(v.occurredAt)>Date.parse(v.evidence.observedAt)||Date.parse(v.evidence.observedAt)>Date.parse(v.recordedAt)))throw Error("AYAS_REVENUE_INTELLIGENCE_LEDGER_CHRONOLOGY_INVALID");
  const visible=state.entries.filter(v=>Date.parse(v.recordedAt)<=known&&Date.parse(v.evidence.observedAt)<=known&&Date.parse(v.occurredAt)<=at),reversed=new Set(visible.filter(v=>v.event==="REVERSAL").map(v=>v.reversesEntryId!));
  const active=visible.filter(v=>v.event!=="REVERSAL"&&!reversed.has(v.entryId)&&(query.from===null||Date.parse(v.occurredAt)>=Date.parse(query.from))&&(query.until===null||Date.parse(v.occurredAt)<Date.parse(query.until)));
  const projection={schemaVersion:"1" as const,revision:active.length,entries:active},economics=summarizeAyasRevenueEconomics(projection),channels=groupAyasRevenueEconomics(projection,["platform"]);
  const current=views.filter(v=>v.isCurrent).map(v=>v.record),warnings=new Set<string>();
  const closed=new Set(current.filter(v=>v.slot==="OFFER_STATUS"&&["CLOSED","CANCELLED"].includes(v.value.state!)).map(v=>v.offerDigest));
  const plans=current.filter(v=>v.slot==="PRIMARY_OFFER"&&v.factClass==="OWNER_DECISION"&&!closed.has(v.offerDigest)&&["PLANNED","ACTIVE"].includes(v.value.state!));
  const currentPrimaryOffer=plans.length===1?plans[0]!.offerDigest:null;
  if(views.some(v=>v.state==="disputed"))warnings.add("DISPUTED_MEMORY_FACTS");
  if(current.some(v=>closed.has(v.offerDigest)&&v.slot!=="OFFER_STATUS"&&v.value.state==="ACTIVE"))warnings.add("CLOSED_OFFER_PLAN_SUPPRESSED");
  const ledgerDigest=digestAyasRevenueLedgerData(state);
  if(current.some(v=>v.ledgerRef&&(v.ledgerRef.digest!==ledgerDigest||v.ledgerRef.revision!==state.revision)))warnings.add("LEDGER_REFERENCE_MISMATCH");
  if(economics.some(v=>v.incompleteEvidence))warnings.add("FEES_INCOMPLETE");
  if(active.filter(v=>v.event==="REFUND").length>=2)warnings.add("REPEAT_REFUNDS");
  if(current.some(v=>v.value.activityCount!==null&&v.value.activityCount>0&&v.platform&&!channels.some(c=>c.key.platform===v.platform&&c.economics.grossRevenueMinor>0)))warnings.add("EFFORT_WITHOUT_REALIZED_SALES");
  if(current.some(v=>v.value.code==="RIGHTS_UNRESOLVED"))warnings.add("RIGHTS_UNRESOLVED");
  const followUps=current.filter(v=>v.kind==="FOLLOW_UP"&&!["DONE","CLOSED","CANCELLED"].includes(v.value.state!));
  if(followUps.some(v=>v.value.dueAt&&Date.parse(v.value.dueAt)<at))warnings.add("FOLLOW_UP_OVERDUE");
  const experiments=current.filter(v=>v.kind==="EXPERIMENT"&&!closed.has(v.offerDigest));
  if(experiments.some(v=>v.value.code==="PAID_EXPERIMENT"&&!["SUCCESS","FAILED","CANCELLED","CLOSED"].includes(v.value.state!)))warnings.add("PAID_EXPERIMENT_OUTCOME_OPEN");
  const duplicate=current.filter(v=>v.kind==="CONTENT_PLAN"&&v.value.relatedDigest!==null);if(duplicate.some((v,i)=>duplicate.some((w,j)=>i!==j&&v.value.relatedDigest===w.value.relatedDigest&&v.platform!==w.platform)))warnings.add("DUPLICATE_CONTENT_EFFORT");
  const observations=[...current.map(v=>Date.parse(v.observedAt)),...visible.map(v=>Date.parse(v.evidence.observedAt))],age=observations.length?known-Math.max(...observations):null;
  const evidenceFreshness=age===null||economics.some(v=>v.incompleteEvidence)||warnings.has("LEDGER_REFERENCE_MISMATCH")?"INCOMPLETE":age>30*86400000?"STALE":age>7*86400000?"AGING":"CURRENT";
  if(evidenceFreshness==="STALE"||evidenceFreshness==="AGING"||current.some(v=>known-Date.parse(v.observedAt)>7*86400000))warnings.add("STALE_MARKET_EVIDENCE");
  const comparisons=economics.map(e=>{const candidates=channels.filter(c=>c.economics.currency===e.currency);const complete=candidates.length>0&&candidates.every(c=>!c.economics.incompleteEvidence);
    const ranked=complete?[...candidates].sort((a,b)=>b.economics.contributionProfitMinor!-a.economics.contributionProfitMinor!):[];
    return {currency:e.currency,leadingPlatform:ranked.length&&(ranked.length===1||ranked[0]!.economics.contributionProfitMinor!==ranked[1]!.economics.contributionProfitMinor)?ranked[0]!.key.platform:null,status:complete?"COMPLETE_OBSERVATIONS":"INCOMPLETE",crossCurrencyRanking:false};});
  return deepFreezeAyasRevenueValue({asOf:query.at,query,views,currentPrimaryOffer,offers:current.filter(v=>v.kind==="OFFER"),channels,experiments,realizedEconomicsByCurrency:economics,comparisons,followUps,warnings:[...warnings].sort(),evidenceFreshness,
    memoryDigest:digestAyasRevenueMemoryState(memory),ledgerDigest,ledgerRevision:state.revision,evidenceVerification:"NORMALIZED_UNVERIFIED_OBSERVATIONS",grantsAuthority:false,executionAuthority:"NONE",autonomousBudgetUsd:0});
}
