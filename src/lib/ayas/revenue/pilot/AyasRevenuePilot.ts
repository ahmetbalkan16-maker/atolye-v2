/** Bounded offline experiment metadata. A synthetic ACTIVE state is never platform authority. */
import { types } from "node:util";
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueDigest,isAyasRevenueNeutralCode } from "../AyasRevenueOpportunity";
import { AYAS_REVENUE_CURRENCIES } from "../AyasRevenueSpendPolicy";
import { AYAS_REVENUE_OPERATION_EFFECT,type AyasRevenueOperation,type AyasRevenuePlatform } from "../AyasRevenuePlatformTypes";
import { deepFreezeAyasRevenueValue,hasExactAyasRevenueKeys,isAyasRevenueBoundedJson,isAyasRevenueOperation,isAyasRevenuePlainRecord,isAyasRevenuePlatform,isAyasRevenueTimestamp } from "../AyasRevenueRedaction";
export const AYAS_REVENUE_PILOT_STATES=Object.freeze(["DRAFT","OWNER_REVIEW","READY","ACTIVE","PAUSED","COMPLETED","CANCELLED","INVALIDATED"] as const);
export type AyasRevenuePilotState=typeof AYAS_REVENUE_PILOT_STATES[number];
export const AYAS_REVENUE_PILOT_TRANSITIONS:Readonly<Record<AyasRevenuePilotState,readonly AyasRevenuePilotState[]>>=deepFreezeAyasRevenueValue({
  DRAFT:["OWNER_REVIEW","CANCELLED","INVALIDATED"],OWNER_REVIEW:["READY","CANCELLED","INVALIDATED"],READY:["ACTIVE","CANCELLED","INVALIDATED"],
  ACTIVE:["PAUSED","COMPLETED","CANCELLED","INVALIDATED"],PAUSED:["ACTIVE","COMPLETED","CANCELLED","INVALIDATED"],COMPLETED:[],CANCELLED:[],INVALIDATED:[],
});
export const AYAS_REVENUE_PILOT_COUNT_METRICS=Object.freeze(["QUALIFIED_LEADS","OWNER_APPROVED_PROPOSALS","SALES","PAID_ORDERS","COURSE_ENROLLMENTS"] as const);
export type AyasRevenuePilotCountMetric=typeof AYAS_REVENUE_PILOT_COUNT_METRICS[number];
export type AyasRevenuePilotMetric={readonly kind:AyasRevenuePilotCountMetric;readonly target:number}
  |{readonly kind:"CONVERSION_RATE";readonly numerator:AyasRevenuePilotCountMetric;readonly denominator:"VISITS"|"QUALIFIED_LEADS"|"OWNER_APPROVED_PROPOSALS";readonly targetBps:number};
export const AYAS_REVENUE_PILOT_LIMITS=Object.freeze({defaultDays:14,maxDays:30,defaultWrites:1,maxWrites:1,maxHistory:1000,maxObservations:1000,maxBytes:4*1024*1024});
export const AYAS_REVENUE_PILOT_ACTIONS:Readonly<Record<AyasRevenuePlatform,readonly AyasRevenueOperation[]>>=deepFreezeAyasRevenueValue({
  etsy:["LISTING_CREATE","LISTING_UPDATE","MESSAGE_SEND"],upwork:["PROPOSAL_SUBMIT","MESSAGE_SEND","DELIVERABLE_SUBMIT"],
  fiverr:["LISTING_CREATE","LISTING_UPDATE","MESSAGE_SEND","DELIVERABLE_SUBMIT"],udemy:["COURSE_PUBLISH"],"lemon-squeezy":["LISTING_CREATE","LISTING_UPDATE"],
});
export interface AyasRevenuePilotAction {readonly actionId:string;readonly operation:AyasRevenueOperation;readonly resourceDigest:string;readonly actionDigest:string}
export interface AyasRevenuePilot {
  readonly schemaVersion:"1";readonly pilotId:string;readonly planRevision:number;readonly platform:AyasRevenuePlatform;readonly accountDigest:string;
  readonly offerDigest:string;readonly validationSnapshotDigest:string;readonly objectiveCode:string;readonly acquisitionCode:string;readonly successMetric:AyasRevenuePilotMetric;
  readonly plannedActions:readonly AyasRevenuePilotAction[];readonly maxDurationDays:number;readonly maxExternalWrites:number;readonly spendBudgetMinor:0;readonly currency:string|null;
  readonly createdAt:string;readonly lastStateAt:string;readonly startAt:string|null;readonly stopAt:string|null;readonly state:AyasRevenuePilotState;
  readonly ownerApprovalRequired:true;readonly executionAuthority:"NONE";readonly executionQualification:"FRAMEWORK_ONLY_UNBOUND";readonly ownerReviewDigest:string|null;readonly planDigest:string;
}
export class AyasRevenuePilotError extends Error {constructor(readonly code:string){super("AYAS_REVENUE_PILOT_"+code);this.name="AyasRevenuePilotError";this.stack=undefined;}}
export const AYAS_REVENUE_PILOT_SIGNALS=Object.freeze(["SECURITY_BLOCKER","MONETARY_COMMITMENT","RIGHTS_UNRESOLVED","ACCOUNT_RESTRICTION","REFUND_PROBLEM","POLICY_CONCERN","DELIVERABLE_QUALITY_FAILURE","PRIMARY_METRIC_UNMEASURABLE","CANONICAL_UNAVAILABLE"] as const);
export interface AyasRevenuePilotObservation {
  readonly schemaVersion:"1";readonly pilotId:string;readonly planDigest:string;readonly platform:AyasRevenuePlatform;readonly accountDigest:string;readonly offerDigest:string;
  readonly kind:"METRIC"|"ACTION_RESULT"|"SIGNAL";readonly metric:AyasRevenuePilotCountMetric|"VISITS"|"VIEWS"|"CLICKS"|"LIKES"|"SUPPORT_CASES"|"DELIVERIES"|null;
  readonly valueCount:number|null;readonly actionDigest:string|null;readonly actionStatus:"PERFORMED"|"FAILED"|"UNKNOWN"|null;
  readonly ownerDecisionDigest:string|null;readonly performedEvidenceDigest:string|null;readonly signal:typeof AYAS_REVENUE_PILOT_SIGNALS[number]|null;
  readonly source:"OFFICIAL_CANONICAL"|"OWNER_PERFORMED"|"LOCAL_READ_ONLY";readonly evidenceDigest:string;readonly occurredAt:string;readonly observedAt:string;
  readonly qualification:"NORMALIZED_NOT_LIVE_CERTIFICATION";
}
/** Native proxy refusal before reflection; all snapshots reject accessors, functions and extra schema fields. */
export function snapshotAyasRevenuePilotData(raw:unknown,maxBytes=524288,maxNodes=65536):unknown {
  try{let nodes=0;const visit=(v:unknown,depth:number):boolean=>{
    if(++nodes>maxNodes||depth>8)return false;if(v===null||typeof v!=="object")return true;if(types.isProxy(v))return false;
    return Object.values(Object.getOwnPropertyDescriptors(v)).every(d=>Object.hasOwn(d,"value")&&visit(d.value,depth+1));
  };if(!visit(raw,0)||!isAyasRevenueBoundedJson(raw,maxBytes))return null;return deepFreezeAyasRevenueValue(structuredClone(raw));}catch{return null;}
}
const integer=(v:unknown,min:number,max:number):v is number=>Number.isSafeInteger(v)&&!Object.is(v,-0)&&(v as number)>=min&&(v as number)<=max;
function metric(v:unknown):v is AyasRevenuePilotMetric {
  if(!isAyasRevenuePlainRecord(v))return false;
  if(v.kind==="CONVERSION_RATE")return hasExactAyasRevenueKeys(v,["kind","numerator","denominator","targetBps"])
    &&(AYAS_REVENUE_PILOT_COUNT_METRICS as readonly unknown[]).includes(v.numerator)&&["VISITS","QUALIFIED_LEADS","OWNER_APPROVED_PROPOSALS"].includes(v.denominator as string)
    &&v.numerator!==v.denominator&&integer(v.targetBps,1,10000);
  return hasExactAyasRevenueKeys(v,["kind","target"])&&(AYAS_REVENUE_PILOT_COUNT_METRICS as readonly unknown[]).includes(v.kind)&&integer(v.target,1,1000000);
}
const PLAN_KEYS=["schemaVersion","pilotId","planRevision","platform","accountDigest","offerDigest","validationSnapshotDigest","objectiveCode","acquisitionCode","successMetric","plannedActions","maxDurationDays","maxExternalWrites","spendBudgetMinor","currency","createdAt","ownerApprovalRequired","executionAuthority","executionQualification"] as const;
export function digestAyasRevenuePilotPlan(v:Omit<AyasRevenuePilot,"planDigest">|AyasRevenuePilot):string {
  const digest=digestAyasRevenueData(Object.fromEntries(PLAN_KEYS.map(k=>[k,v[k]])));if(digest===null)throw new AyasRevenuePilotError("INVALID_PLAN");return digest;
}
function action(v:unknown,platform:AyasRevenuePlatform):v is AyasRevenuePilotAction {
  return isAyasRevenuePlainRecord(v)&&hasExactAyasRevenueKeys(v,["actionId","operation","resourceDigest","actionDigest"])
    &&isAyasRevenueNeutralCode(v.actionId)&&isAyasRevenueOperation(v.operation)&&AYAS_REVENUE_PILOT_ACTIONS[platform].includes(v.operation)
    &&AYAS_REVENUE_OPERATION_EFFECT[v.operation]==="EXTERNAL_WRITE"&&isAyasRevenueDigest(v.resourceDigest)
    &&v.actionDigest===digestAyasRevenueData({actionId:v.actionId,operation:v.operation,resourceDigest:v.resourceDigest});
}
export function snapshotAyasRevenuePilot(raw:unknown):AyasRevenuePilot|null {
  const v=snapshotAyasRevenuePilotData(raw,32768);
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,[...PLAN_KEYS,"lastStateAt","startAt","stopAt","state","ownerReviewDigest","planDigest"]))return null;
  if(v.schemaVersion!=="1"||!isAyasRevenueNeutralCode(v.pilotId)||!integer(v.planRevision,1,1000)||!isAyasRevenuePlatform(v.platform)
    ||![v.accountDigest,v.offerDigest,v.validationSnapshotDigest,v.planDigest].every(isAyasRevenueDigest)||!isAyasRevenueNeutralCode(v.objectiveCode)||!isAyasRevenueNeutralCode(v.acquisitionCode)||!metric(v.successMetric)
    ||!integer(v.maxDurationDays,1,30)||!integer(v.maxExternalWrites,0,1)||v.spendBudgetMinor!==0||Object.is(v.spendBudgetMinor,-0)
    ||!(v.currency===null||(AYAS_REVENUE_CURRENCIES as readonly unknown[]).includes(v.currency))||!Array.isArray(v.plannedActions)||v.plannedActions.length>(v.maxExternalWrites as number)
    ||!v.plannedActions.every(a=>action(a,v.platform as AyasRevenuePlatform))||new Set(v.plannedActions.map(a=>a.actionId)).size!==v.plannedActions.length
    ||!(AYAS_REVENUE_PILOT_STATES as readonly unknown[]).includes(v.state)||v.ownerApprovalRequired!==true||v.executionAuthority!=="NONE"||v.executionQualification!=="FRAMEWORK_ONLY_UNBOUND"
    ||!isAyasRevenueTimestamp(v.createdAt)||!isAyasRevenueTimestamp(v.lastStateAt)||Date.parse(v.lastStateAt)<Date.parse(v.createdAt)
    ||!(v.ownerReviewDigest===null||isAyasRevenueDigest(v.ownerReviewDigest)))return null;
  const started=v.startAt!==null||v.stopAt!==null;
  if(started&&(!isAyasRevenueTimestamp(v.startAt)||!isAyasRevenueTimestamp(v.stopAt)||Date.parse(v.startAt)<Date.parse(v.createdAt)
    ||Date.parse(v.stopAt)-Date.parse(v.startAt)!==(v.maxDurationDays as number)*86400000||Date.parse(v.lastStateAt)<Date.parse(v.startAt)))return null;
  if(["ACTIVE","PAUSED","COMPLETED"].includes(v.state as string)&&(!started||v.ownerReviewDigest===null))return null;
  if(["DRAFT","OWNER_REVIEW","READY"].includes(v.state as string)&&started)return null;
  if(v.state==="READY"&&v.ownerReviewDigest===null)return null;
  const p=v as unknown as AyasRevenuePilot;return p.planDigest===digestAyasRevenuePilotPlan(p)?p:null;
}
/** Operations are proposed by trusted application code, never extracted from external text. */
export function createAyasRevenuePilot(raw:unknown,createdAt:string,planRevision=1):AyasRevenuePilot {
  const v=snapshotAyasRevenuePilotData(raw,32768);
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,["pilotId","platform","accountDigest","offerDigest","validationSnapshotDigest","objectiveCode","acquisitionCode","successMetric","currency","plannedActions"],["maxDurationDays","maxExternalWrites"])
    ||!Array.isArray(v.plannedActions)||!isAyasRevenuePlatform(v.platform)||!isAyasRevenueNeutralCode(v.pilotId)
    ||!isAyasRevenueDigest(v.accountDigest)||!isAyasRevenueDigest(v.offerDigest)||!isAyasRevenueDigest(v.validationSnapshotDigest)
    ||!isAyasRevenueNeutralCode(v.objectiveCode)||!isAyasRevenueNeutralCode(v.acquisitionCode)||!metric(v.successMetric)
    ||!(v.currency===null||typeof v.currency==="string"&&(AYAS_REVENUE_CURRENCIES as readonly string[]).includes(v.currency)))throw new AyasRevenuePilotError("INVALID_PLAN");
  const platform=v.platform,maxDurationDays=v.maxDurationDays??14,maxExternalWrites=v.maxExternalWrites??1;
  if(!integer(maxDurationDays,1,30)||!integer(maxExternalWrites,0,1))throw new AyasRevenuePilotError("INVALID_PLAN");
  const actions=v.plannedActions.map(a=>{if(!isAyasRevenuePlainRecord(a)||!hasExactAyasRevenueKeys(a,["actionId","operation","resourceDigest"]))throw new AyasRevenuePilotError("INVALID_PLAN");
    const result={...a,actionDigest:digestAyasRevenueData(a)};if(!action(result,platform))throw new AyasRevenuePilotError("INVALID_PLAN");return result;});
  const material:Omit<AyasRevenuePilot,"planDigest">={schemaVersion:"1",pilotId:v.pilotId,planRevision,platform,accountDigest:v.accountDigest,offerDigest:v.offerDigest,validationSnapshotDigest:v.validationSnapshotDigest,
    objectiveCode:v.objectiveCode,acquisitionCode:v.acquisitionCode,successMetric:v.successMetric,currency:v.currency,plannedActions:actions,maxDurationDays,maxExternalWrites,spendBudgetMinor:0,
    createdAt,lastStateAt:createdAt,startAt:null,stopAt:null,state:"DRAFT",ownerApprovalRequired:true,executionAuthority:"NONE",executionQualification:"FRAMEWORK_ONLY_UNBOUND",ownerReviewDigest:null};
  const result=snapshotAyasRevenuePilot({...material,planDigest:digestAyasRevenuePilotPlan(material)});if(!result)throw new AyasRevenuePilotError("INVALID_PLAN");return result;
}
const OBS_KEYS=["schemaVersion","pilotId","planDigest","platform","accountDigest","offerDigest","kind","metric","valueCount","actionDigest","actionStatus","ownerDecisionDigest","performedEvidenceDigest","signal","source","evidenceDigest","occurredAt","observedAt"];
export function createAyasRevenuePilotObservation(raw:unknown,pilot:AyasRevenuePilot,now:string):AyasRevenuePilotObservation {
  const v=snapshotAyasRevenuePilotData(raw,16384),p=snapshotAyasRevenuePilot(pilot);
  const fail=():never=>{throw new AyasRevenuePilotError("INVALID_OBSERVATION");};
  if(!p||p.startAt===null||!isAyasRevenueTimestamp(now)||!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,OBS_KEYS)
    ||v.schemaVersion!=="1"||v.pilotId!==p.pilotId||v.planDigest!==p.planDigest||v.platform!==p.platform||v.accountDigest!==p.accountDigest||v.offerDigest!==p.offerDigest
    ||!isAyasRevenueDigest(v.evidenceDigest)||!isAyasRevenueTimestamp(v.occurredAt)||!isAyasRevenueTimestamp(v.observedAt)
    ||Date.parse(v.occurredAt)<Date.parse(p.startAt)||Date.parse(v.observedAt)<Date.parse(v.occurredAt)||Date.parse(v.observedAt)>Date.parse(now)
    ||!["OFFICIAL_CANONICAL","OWNER_PERFORMED","LOCAL_READ_ONLY"].includes(v.source as string))return fail();
  if(v.kind==="METRIC"){
    if(!([...AYAS_REVENUE_PILOT_COUNT_METRICS,"VISITS","VIEWS","CLICKS","LIKES","SUPPORT_CASES","DELIVERIES"] as readonly unknown[]).includes(v.metric)
      ||!integer(v.valueCount,0,1000000)||[v.actionDigest,v.actionStatus,v.ownerDecisionDigest,v.performedEvidenceDigest,v.signal].some(x=>x!==null))return fail();
  }else if(v.kind==="ACTION_RESULT"){
    if(v.metric!==null||v.valueCount!==null||v.signal!==null||!isAyasRevenueDigest(v.ownerDecisionDigest)
      ||!isAyasRevenueDigest(v.actionDigest)||!p.plannedActions.some(a=>a.actionDigest===v.actionDigest)||!["PERFORMED","FAILED","UNKNOWN"].includes(v.actionStatus as string)
      ||(v.actionStatus==="PERFORMED"?v.source!=="OWNER_PERFORMED"||!isAyasRevenueDigest(v.performedEvidenceDigest):v.performedEvidenceDigest!==null))return fail();
  }else if(v.kind==="SIGNAL"){
    if(!(AYAS_REVENUE_PILOT_SIGNALS as readonly unknown[]).includes(v.signal)||[v.metric,v.valueCount,v.actionDigest,v.actionStatus,v.ownerDecisionDigest,v.performedEvidenceDigest].some(x=>x!==null))return fail();
  }else return fail();
  return deepFreezeAyasRevenueValue({...v,qualification:"NORMALIZED_NOT_LIVE_CERTIFICATION"}) as unknown as AyasRevenuePilotObservation;
}
export interface AyasRevenuePilotEvent {readonly index:number;readonly previousEventDigest:string|null;readonly recordedAt:string;readonly kind:"PLAN"|"STATE"|"OBSERVATION";readonly body:AyasRevenuePilot|AyasRevenuePilotObservation;readonly eventDigest:string}
export interface AyasRevenuePilotStoreState {readonly schemaVersion:"1";readonly revision:number;readonly events:readonly AyasRevenuePilotEvent[]}
export const emptyAyasRevenuePilotStore=():AyasRevenuePilotStoreState=>deepFreezeAyasRevenueValue({schemaVersion:"1",revision:0,events:[]});
export function makeAyasRevenuePilotEvent(state:AyasRevenuePilotStoreState,kind:AyasRevenuePilotEvent["kind"],body:AyasRevenuePilotEvent["body"],recordedAt:string):AyasRevenuePilotEvent {
  const material={index:state.revision+1,previousEventDigest:state.events.at(-1)?.eventDigest??null,recordedAt,kind,body},eventDigest=digestAyasRevenueData(material);
  if(eventDigest===null)throw new AyasRevenuePilotError("INVALID_EVENT");return deepFreezeAyasRevenueValue({...material,eventDigest});
}
/** Integrity/shape, not attestation: a digest chain cannot authenticate a malicious caller or filesystem owner. */
export function projectAyasRevenuePilotStore(raw:unknown) {
  const v=snapshotAyasRevenuePilotData(raw,AYAS_REVENUE_PILOT_LIMITS.maxBytes),fail=():never=>{throw new AyasRevenuePilotError("INVALID_STORE");};
  if(!isAyasRevenuePlainRecord(v)||!hasExactAyasRevenueKeys(v,["schemaVersion","revision","events"])||v.schemaVersion!=="1"||!Array.isArray(v.events)
    ||v.events.length>AYAS_REVENUE_PILOT_LIMITS.maxHistory||!integer(v.revision,0,AYAS_REVENUE_PILOT_LIMITS.maxHistory)||v.revision!==v.events.length)return fail();
  let current:AyasRevenuePilot|null=null,previous:string|null=null,at:number|null=null;
  const plans=new Map<string,AyasRevenuePilot>(),observations:AyasRevenuePilotObservation[]=[],evidence=new Map<string,string>(),actions=new Set<string>();
  for(let i=0;i<v.events.length;i++){
    const e=v.events[i];if(!isAyasRevenuePlainRecord(e)||!hasExactAyasRevenueKeys(e,["index","previousEventDigest","recordedAt","kind","body","eventDigest"])
      ||e.index!==i+1||e.previousEventDigest!==previous||!isAyasRevenueDigest(e.eventDigest)||!isAyasRevenueTimestamp(e.recordedAt)
      ||at!==null&&Date.parse(e.recordedAt)<at||e.eventDigest!==digestAyasRevenueData({index:e.index,previousEventDigest:e.previousEventDigest,recordedAt:e.recordedAt,kind:e.kind,body:e.body}))return fail();
    if(e.kind==="PLAN"||e.kind==="STATE"){
      const p=snapshotAyasRevenuePilot(e.body);if(!p||p.lastStateAt!==e.recordedAt||Date.parse(p.createdAt)>Date.parse(e.recordedAt))return fail();
      if(e.kind==="PLAN"){
        if(p.state!=="DRAFT"||p.createdAt!==e.recordedAt||p.planRevision!==(current?.planRevision??0)+1||plans.has(p.planDigest))return fail();
        if(current&&(!["DRAFT","OWNER_REVIEW","COMPLETED","CANCELLED","INVALIDATED"].includes(current.state)||p.pilotId!==current.pilotId||p.platform!==current.platform||p.accountDigest!==current.accountDigest||p.offerDigest!==current.offerDigest))return fail();
      }else{
        if(!current||p.planDigest!==current.planDigest||!AYAS_REVENUE_PILOT_TRANSITIONS[current.state].includes(p.state))return fail();
        if(current.startAt!==null&&(p.startAt!==current.startAt||p.stopAt!==current.stopAt))return fail();
        if(current.startAt===null&&(p.state==="ACTIVE"?p.startAt!==e.recordedAt:p.startAt!==null))return fail();
        if(p.state!=="OWNER_REVIEW"&&p.ownerReviewDigest===null)return fail();
        if(p.state==="COMPLETED"&&(p.stopAt===null||Date.parse(e.recordedAt)<Date.parse(p.stopAt)))return fail();
      }
      current=p;plans.set(p.planDigest,p);
    }else if(e.kind==="OBSERVATION"){
      if(!isAyasRevenuePlainRecord(e.body)||e.body.qualification!=="NORMALIZED_NOT_LIVE_CERTIFICATION"||typeof e.body.planDigest!=="string")return fail();
      const p=plans.get(e.body.planDigest);if(!p)return fail();const {qualification,...material}=e.body;void qualification;
      const o=createAyasRevenuePilotObservation(material,p,e.recordedAt),identity=digestAyasRevenueData(o)!;
      if(evidence.has(o.evidenceDigest))return fail();evidence.set(o.evidenceDigest,identity);
      if(o.kind==="ACTION_RESULT"){const key=o.planDigest+":"+o.actionDigest;if(actions.has(key))return fail();actions.add(key);
        if(observations.filter(r=>r.planDigest===o.planDigest&&r.kind==="ACTION_RESULT").length>=p.maxExternalWrites)return fail();}
      if(observations.length>=AYAS_REVENUE_PILOT_LIMITS.maxObservations)return fail();observations.push(o);
    }else return fail();
    previous=e.eventDigest;at=Date.parse(e.recordedAt);
  }
  return deepFreezeAyasRevenueValue({state:v as unknown as AyasRevenuePilotStoreState,current,plans:[...plans.values()],observations});
}
export const validateAyasRevenuePilotStore=(raw:unknown):AyasRevenuePilotStoreState=>projectAyasRevenuePilotStore(raw).state;
