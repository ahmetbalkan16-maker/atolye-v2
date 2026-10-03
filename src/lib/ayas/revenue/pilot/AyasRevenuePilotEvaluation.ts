/** Advisory only. Full realized ledger identity, global reversals and known later fees/refunds; no FX or executor. */
import { digestAyasRevenueLedgerData } from "../AyasRevenueDigest";
import { AYAS_REVENUE_LEDGER_MAX_BYTES,validateAyasRevenueLedgerState } from "../AyasRevenueLedger";
import { summarizeAyasRevenueEconomics } from "../AyasRevenueEconomics";
import { isAyasRevenueDigest } from "../AyasRevenueOpportunity";
import { deepFreezeAyasRevenueValue,hasExactAyasRevenueKeys,isAyasRevenuePlainRecord,isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
import { AyasRevenuePilotError,projectAyasRevenuePilotStore,snapshotAyasRevenuePilotData } from "./AyasRevenuePilot";
export const AYAS_REVENUE_PILOT_VERDICTS=Object.freeze(["PROMISING","INCONCLUSIVE","NOT_VALIDATED","ECONOMICALLY_NEGATIVE","SECURITY_BLOCKED","POLICY_BLOCKED","INVALID_PILOT"] as const);
export type AyasRevenuePilotVerdict=typeof AYAS_REVENUE_PILOT_VERDICTS[number];
/** Normalized source coverage, not authentication or live certification. Missing/stale coverage stays incomplete. */
export function evaluateAyasRevenuePilot(rawStore:unknown,planDigest:string,rawLedger:unknown,rawReconciliation:unknown,now:string){
 const projection=projectAyasRevenuePilotStore(rawStore),p=projection.plans.find(v=>v.planDigest===planDigest);
 if(!p||!isAyasRevenueTimestamp(now)||projection.state.events.some(e=>Date.parse(e.recordedAt)>Date.parse(now)))throw new AyasRevenuePilotError("INVALID_EVALUATION");
 const ledgerRaw=snapshotAyasRevenuePilotData(rawLedger,AYAS_REVENUE_LEDGER_MAX_BYTES,500000),ledger=validateAyasRevenueLedgerState(ledgerRaw),ledgerDigest=digestAyasRevenueLedgerData(ledger);
 if(ledger.entries.some(e=>Date.parse(e.occurredAt)>Date.parse(e.evidence.observedAt)||Date.parse(e.evidence.observedAt)>Date.parse(e.recordedAt)||Date.parse(e.recordedAt)>Date.parse(now)))throw new AyasRevenuePilotError("INVALID_LEDGER_CHRONOLOGY");
 const reversed=new Set(ledger.entries.filter(e=>e.event==="REVERSAL").map(e=>e.reversesEntryId!)),active=ledger.entries.filter(e=>e.event!=="REVERSAL"&&!reversed.has(e.entryId));
 const inWindow=(at:string)=>p.startAt!==null&&p.stopAt!==null&&Date.parse(at)>=Date.parse(p.startAt)&&Date.parse(at)<Date.parse(p.stopAt);
 const originalSales=ledger.entries.filter(e=>e.platform===p.platform&&e.offerDigest===p.offerDigest&&e.event==="GROSS_REVENUE"&&inWindow(e.occurredAt)),sales=originalSales.filter(e=>!reversed.has(e.entryId)),orders=new Set(originalSales.map(e=>e.orderDigest).filter((v):v is string=>v!==null));
 // Related order fees/refunds are retained regardless of their occurrence date. Direct pilot costs require exact activity identity.
 const facts=active.filter(e=>e.platform===p.platform&&(e.event==="GROSS_REVENUE"?sales.some(s=>s.entryId===e.entryId):(e.orderDigest!==null&&orders.has(e.orderDigest))||(e.activityDigest===p.planDigest&&e.offerDigest===p.offerDigest)));
 const economics=summarizeAyasRevenueEconomics({schemaVersion:"1",revision:facts.length,entries:facts});
 const receipt=snapshotAyasRevenuePilotData(rawReconciliation,8192),r=isAyasRevenuePlainRecord(receipt)?receipt:null;
 const reconciled=!!r&&hasExactAyasRevenueKeys(r,["planDigest","ledgerDigest","ledgerRevision","from","to","observedAt","freshUntil","evidenceDigest","history","fees","refunds","disputes"])
  &&r.planDigest===p.planDigest&&r.ledgerDigest===ledgerDigest&&r.ledgerRevision===ledger.revision&&r.from===p.startAt&&r.to===p.stopAt
  &&isAyasRevenueDigest(r.evidenceDigest)&&isAyasRevenueTimestamp(r.observedAt)&&isAyasRevenueTimestamp(r.freshUntil)
  &&p.stopAt!==null&&Date.parse(r.observedAt)>=Date.parse(p.stopAt)&&Date.parse(r.observedAt)<=Date.parse(now)&&Date.parse(r.freshUntil)>=Date.parse(now)
  &&ledger.entries.every(e=>Date.parse(e.recordedAt)<=Date.parse(r.observedAt as string))
  &&Date.parse(r.freshUntil)-Date.parse(r.observedAt)<=86400000&&Date.parse(r.freshUntil)>=Date.parse(r.observedAt)
  &&r.history==="COMPLETE"&&r.fees==="COMPLETE"&&r.refunds==="COMPLETE"&&r.disputes==="CLEAR";
 const observations=projection.observations.filter(o=>o.planDigest===p.planDigest&&o.kind==="METRIC"&&inWindow(o.occurredAt)&&o.source!=="LOCAL_READ_ONLY");
 const count=(metric:string)=>observations.filter(o=>o.metric===metric).reduce((n,o)=>n+o.valueCount!,0);
 const paidOrders=[...orders].filter(order=>{const orderFacts=facts.filter(e=>e.orderDigest===order&&e.amount.currency===p.currency),sum=(event:string)=>orderFacts.filter(e=>e.event===event).reduce((n,e)=>n+BigInt(e.amount.valueMinor),BigInt(0));return sum("GROSS_REVENUE")>sum("REFUND");}).length;
 const value=(metric:string)=>["SALES","PAID_ORDERS"].includes(metric)?paidOrders:count(metric);
 const metric=p.successMetric,numerator=metric.kind==="CONVERSION_RATE"?value(metric.numerator):value(metric.kind),denominator=metric.kind==="CONVERSION_RATE"?value(metric.denominator):null;
 const metricValid=denominator===null||denominator>0&&numerator<=denominator;
 const conversionBps=denominator!==null&&metricValid?Number(BigInt(numerator)*BigInt(10000)/BigInt(denominator)):null;
 const met=metricValid&&(metric.kind==="CONVERSION_RATE"?conversionBps!==null&&conversionBps>=metric.targetBps:numerator>=metric.target);
 // Signals and failed/unknown actions survive revisions; choosing a later window cannot erase them.
 const signals=[...new Set(projection.observations.filter(o=>o.kind==="SIGNAL").map(o=>o.signal!))].sort(),failed=projection.observations.some(o=>o.kind==="ACTION_RESULT"&&o.actionStatus!=="PERFORMED");
 const reasons:string[]=[];let verdict:AyasRevenuePilotVerdict;
 const complete=reconciled&&economics.length>0&&economics.every(e=>!e.incompleteEvidence)&&sales.every(e=>e.orderDigest!==null)&&p.currency!==null&&economics.every(e=>e.currency===p.currency);
 if(signals.some(s=>s==="SECURITY_BLOCKER"||s==="MONETARY_COMMITMENT")){verdict="SECURITY_BLOCKED";reasons.push("SECURITY_OR_UNEXPECTED_COST");}
 else if(signals.some(s=>["RIGHTS_UNRESOLVED","ACCOUNT_RESTRICTION","POLICY_CONCERN"].includes(s))){verdict="POLICY_BLOCKED";reasons.push("POLICY_OR_RIGHTS_UNRESOLVED");}
 else if(["CANCELLED","INVALIDATED"].includes(p.state)||p.startAt===null){verdict="INVALID_PILOT";reasons.push("INVALID_OR_CANCELLED_WINDOW");}
 else if(p.state!=="COMPLETED"||p.stopAt===null||Date.parse(now)<Date.parse(p.stopAt)||!complete||!metricValid||signals.some(s=>["PRIMARY_METRIC_UNMEASURABLE","CANONICAL_UNAVAILABLE"].includes(s))){verdict="INCONCLUSIVE";reasons.push("WINDOW_OR_ECONOMICS_OR_METRIC_INCOMPLETE");}
 else if(economics.some(e=>e.contributionProfitMinor!<0)){verdict="ECONOMICALLY_NEGATIVE";reasons.push("REALIZED_NEGATIVE_CONTRIBUTION");}
 else if(!met||failed||signals.some(s=>["REFUND_PROBLEM","DELIVERABLE_QUALITY_FAILURE"].includes(s))){verdict="NOT_VALIDATED";reasons.push("METRIC_OR_RETAINED_NEGATIVE_EVIDENCE");}
 else{verdict="PROMISING";reasons.push("BOUNDED_REVIEW_INPUT_ONLY");}
 return deepFreezeAyasRevenueValue({schemaVersion:"1",planDigest:p.planDigest,pilotId:p.pilotId,pilotState:p.state,startAt:p.startAt,stopAt:p.stopAt,asOf:now,verdict,reasons,
  primaryMetric:{metric,numerator,denominator,conversionBps,valid:metricValid,met},supportingMetrics:{views:count("VIEWS"),clicks:count("CLICKS"),likes:count("LIKES"),supportCases:count("SUPPORT_CASES"),deliveries:count("DELIVERIES")},
  realizedByCurrency:economics,economicsComplete:complete,reconciliation:"NORMALIZED_METADATA_NOT_LIVE_CERTIFICATION",ledgerDigest,ledgerRevision:ledger.revision,storeRevision:projection.state.revision,
  selectedEntryDigests:facts.map(e=>e.entryId),globalReversalCount:reversed.size,retainedSignals:signals,retainedFailedOrUnknownAction:failed,
  recommendation:signals.length?"OWNER_PAUSE_REVIEW":verdict==="PROMISING"?"STAGE16_13_OWNER_REVIEW":"OWNER_REVIEW",automaticScale:false,externalWrite:false,autonomousSpend:0,grantsAuthority:false,executionAuthority:"NONE",liveQualification:"UNBOUND_NOT_RUN"});
}
