/** Closed record, temporal and durable-store assertions. Every writer uses a checked owned TEMP checkout. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AYAS_REVENUE_MEMORY_KINDS, createAyasRevenueMemoryRecord, emptyAyasRevenueMemory, validateAyasRevenueMemoryState, planAyasRevenueMemoryAppend, digestAyasRevenueMemoryState } from "../src/lib/ayas/revenue/AyasRevenueMemory";
import { AyasRevenueMemoryStore } from "../src/lib/ayas/revenue/AyasRevenueMemoryStore";
import { resolveAyasRevenueTemporal } from "../src/lib/ayas/revenue/AyasRevenueTemporal";
import { detectAyasRevenueRecall } from "../src/lib/ayas/revenue/AyasRevenueRecall";
import { rmInput,rmRecord,rmState,rmQuery,rmDigest,RM_AT,RM_NOW,RM_OLD } from "./fixtures/ayas-revenue-memory-fixture";
const rows:{id:string;set:string;ok:boolean}[]=[],tempParent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(tempParent,"ayas-business-memory-"));
const run=async(id:string,set:string,test:()=>unknown)=>{try{await test();rows.push({id,set,ok:true});}catch(e){rows.push({id,set,ok:false});console.error(id+":"+(e instanceof Error?e.message:"assertion"));}};
const reject=(raw:unknown)=>assert.throws(()=>createAyasRevenueMemoryRecord(raw,RM_AT),/INVALID_RECORD/),current=(...records:ReturnType<typeof rmRecord>[])=>resolveAyasRevenueTemporal(rmState(...records),rmQuery()).filter(v=>v.isCurrent);
const root=(id:string)=>{const p=path.join(temp,id);fs.mkdirSync(p);return p;},file=(p:string)=>path.join(p,"data","brain","revenue","intelligence","memory.json");
const store=(p:string,maxRecords?:number)=>new AyasRevenueMemoryStore(p,{now:()=>RM_AT,...(maxRecords?{maxRecords}:{})});
const fingerprint=(p:string):string=>{if(!fs.existsSync(p))return "MISSING";const values:string[]=[];const visit=(q:string)=>{const s=fs.lstatSync(q);values.push(path.relative(p,q)+":"+s.mode+":"+s.size+":"+s.mtimeMs);if(s.isSymbolicLink()){values.push(fs.readlinkSync(q));return;}if(s.isDirectory())for(const n of fs.readdirSync(q).sort())visit(path.join(q,n));else values.push(createHash("sha256").update(fs.readFileSync(q)).digest("hex"));};visit(p);return createHash("sha256").update(values.join("\n")).digest("hex");};
const liveLedger=path.join(process.cwd(),"data","brain","revenue","ledger.json"),ledgerBefore=fingerprint(liveLedger);
let n=0;const primary=(test:()=>unknown)=>run("P"+String(++n).padStart(2,"0"),"primary",test);
async function main() {
try {
await primary(()=>{assert.equal(current(rmRecord())[0]?.record.offerDigest,rmDigest("offer-one"));});
for(const kind of AYAS_REVENUE_MEMORY_KINDS)await primary(()=>{const value={...rmInput().value,code:"LOCAL_OBSERVATION",plannedPrice:kind==="PRICING_DECISION"?{valueMinor:1200,currency:"USD"}:null};assert.equal(rmRecord("kind-"+kind,{kind,slot:null,value}).kind,kind);});
for(const field of ["customerEmail","phone","address","privateMessage","rawPayload","apiKey","taxId","bankAccount","proposalBody","memoryInstruction"])await primary(()=>reject({...rmInput(),[field]:"private@example.test"}));
for(const patch of [{kind:"UNKNOWN"},{factClass:"MODEL_APPROVAL"},{source:"CHAT"},{slot:"free text slot"},{platform:"amazon"},{entityId:"../../outside"},{eventDigest:"x"},{evidenceDigest:null},{reviewEvidenceDigest:null},{observedAt:"2026-10-04T12:00:00.000Z"},{effectiveUntil:RM_AT},{schemaVersion:"2"}])await primary(()=>reject({...rmInput(),...patch}));
await primary(()=>{const p=rmInput(),v={...p.value,code:"CUSTOMER_EMAIL_customer@example.test"};reject({...p,value:v});});
await primary(()=>reject(rmInput("realized-copy",{factClass:"REALIZED_LEDGER_FACT",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,kind:"PERFORMANCE_SUMMARY",slot:null,ledgerRef:{digest:rmDigest("ledger"),revision:1},value:{...rmInput().value,plannedPrice:{valueMinor:1000,currency:"USD"}}})));
await primary(()=>{const p=rmRecord("ledger-ref",{factClass:"REALIZED_LEDGER_FACT",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,kind:"PERFORMANCE_SUMMARY",slot:null,ledgerRef:{digest:rmDigest("ledger"),revision:1}});assert.equal(p.ledgerRef?.revision,1);assert.equal(p.value.plannedPrice,null);});
await primary(()=>{let reads=0;const p={...rmInput()};Object.defineProperty(p,"value",{enumerable:true,get(){reads++;return rmInput().value;}});reject(p);assert.equal(reads,0);});
await primary(()=>reject(new Proxy({}, {getPrototypeOf(){throw Error("reflection");}})));
await primary(()=>{const old=rmRecord("old",{observedAt:RM_OLD,effectiveFrom:RM_OLD},RM_OLD),next=rmRecord("next",{offerDigest:rmDigest("offer-two")});assert.equal(current(old,next)[0]?.record.recordId,next.recordId);assert.equal(resolveAyasRevenueTemporal(rmState(old,next),rmQuery())[0]?.state,"superseded");});
await primary(()=>{const owner=rmRecord(),model=rmRecord("model",{factClass:"HYPOTHESIS",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,offerDigest:rmDigest("hypothesis-offer"),effectiveFrom:"2026-10-03T12:30:00.000Z"});assert.equal(current(owner,model)[0]?.record.recordId,owner.recordId);});
await primary(()=>{const a=rmRecord("a"),b=rmRecord("b",{offerDigest:rmDigest("offer-two")});assert.equal(current(a,b).length,0);assert.equal(resolveAyasRevenueTemporal(rmState(a,b),rmQuery()).filter(v=>v.state==="disputed").length,2);});
await primary(()=>{const a=rmRecord("a"),b=rmRecord("b",{offerDigest:rmDigest("offer-two"),supersedesRecordId:a.recordId});assert.equal(current(a,b)[0]?.record.recordId,b.recordId);});
await primary(()=>{const a=rmRecord(),b=rmRecord("future",{effectiveFrom:"2026-11-01T00:00:00.000Z"});assert.equal(current(a,b)[0]?.record.recordId,a.recordId);assert.equal(resolveAyasRevenueTemporal(rmState(a,b),rmQuery())[1]?.state,"future");});
await primary(()=>{const a=rmRecord("old",{observedAt:RM_OLD,effectiveFrom:RM_OLD},RM_OLD),b=rmRecord("expired",{effectiveUntil:"2026-10-03T12:30:00.000Z"});assert.equal(current(a,b).length,0);});
await primary(()=>{const a=rmRecord("old",{observedAt:RM_OLD,effectiveFrom:RM_OLD},RM_OLD),b=rmRecord();assert.equal(resolveAyasRevenueTemporal(rmState(a,b),{...rmQuery(),mode:"as-of",at:"2026-09-30T23:59:59.999Z"}).find(v=>v.isCurrent)?.record.recordId,a.recordId);});
await primary(()=>{const a=rmRecord();assert.equal(resolveAyasRevenueTemporal(rmState(a),{...rmQuery(),knownAt:RM_OLD}).length,0);});
await primary(()=>{const a=rmRecord("closed",{slot:"OFFER_STATUS",value:{...rmInput().value,state:"CLOSED"}});assert.throws(()=>rmState(a,rmRecord("revive")),/INVALID_STORE/);});
await primary(()=>{const a=rmRecord("closed",{slot:"OFFER_STATUS",value:{...rmInput().value,state:"CLOSED"}}),b=rmRecord("reopen",{slot:"OFFER_STATUS",supersedesRecordId:a.recordId});assert.equal(current(a,b)[0]?.record.value.state,"ACTIVE");});
await primary(()=>{const a=rmRecord();assert.equal(planAyasRevenueMemoryAppend(rmState(a),createAyasRevenueMemoryRecord(rmInput(),RM_NOW)).kind,"REPLAY");});
await primary(()=>{const a=rmRecord();assert.throws(()=>planAyasRevenueMemoryAppend(rmState(a),rmRecord("primary",{offerDigest:rmDigest("other")})),/CONFLICT/);});
await primary(()=>assert.throws(()=>validateAyasRevenueMemoryState({schemaVersion:"1",revision:99,records:[]}),/INVALID_STORE/));
await primary(()=>{const a=rmRecord();assert.throws(()=>validateAyasRevenueMemoryState({schemaVersion:"1",revision:1,records:[{...a,factKey:"user.identity.name"}]}),/INVALID_STORE/);});
await primary(()=>{const a=rmRecord();assert.throws(()=>validateAyasRevenueMemoryState({schemaVersion:"1",revision:1,records:[{...a,recordedAt:RM_NOW}]}),/INVALID_STORE/);});
await primary(()=>{const p=root("empty");assert.deepEqual(store(p).read(),emptyAyasRevenueMemory());assert.equal(fs.existsSync(path.join(p,"data")),false);});
await primary(async()=>{const p=root("persist"),a=store(p);assert.equal((await a.append(rmInput())).status,"APPENDED");assert.equal(store(p).read().records.length,1);assert.equal((await a.append(rmInput())).status,"REPLAY");assert.equal(store(p).read().revision,1);});
await primary(async()=>{const p=root("concurrent");await Promise.all([store(p).append(rmInput("parallel-a")),store(p).append(rmInput("parallel-b",{slot:null}))]);assert.equal(store(p).read().revision,2);});
await primary(async()=>{const p=root("capacity");await store(p,1).append(rmInput());await assert.rejects(store(p,1).append(rmInput("second")),/CAPACITY/);});
await primary(async()=>{const p=root("broken");await store(p).append(rmInput());fs.writeFileSync(file(p),"{broken");assert.throws(()=>store(p).read(),/INVALID_STORE/);});
await primary(async()=>{const p=root("directory");await store(p).append(rmInput());fs.unlinkSync(file(p));fs.mkdirSync(file(p));assert.throws(()=>store(p).read(),/STORAGE_UNSAFE/);});
await primary(async()=>{const p=root("hardlink");await store(p).append(rmInput());const other=path.join(p,"copy.json");fs.linkSync(file(p),other);assert.throws(()=>store(p).read(),/STORAGE_UNSAFE/);fs.unlinkSync(other);});
await primary(async()=>{const p=root("safe-mode"),safe=path.join(p,"data","brain","execution","safe-mode");fs.mkdirSync(safe,{recursive:true});fs.writeFileSync(path.join(safe,"corrupt.json"),"{}");await assert.rejects(store(p).append(rmInput()),/AYAS_SAFE_/);assert.equal(fs.existsSync(file(p)),false);});
await primary(()=>assert.equal(digestAyasRevenueMemoryState(rmState(rmRecord())),digestAyasRevenueMemoryState(rmState(rmRecord()))));
await primary(()=>{const a=rmRecord(),b=rmRecord("different",{slot:null});assert.notEqual(digestAyasRevenueMemoryState(rmState(a)),digestAyasRevenueMemoryState(rmState(a,b)));});
await primary(async()=>{const {streamAyasChat}=await import("../src/lib/ayas/AyasChatStream"),{emptyAyasRevenueLedger}=await import("../src/lib/ayas/revenue/AyasRevenueLedger");
  const p=root("actual-chat"),prompts:string[]=[],reply="İş planını kayıtlardaki gözlemlerle değerlendirebiliriz.";
  const provider:import("../src/lib/ayas/model/AyasModelTypes").AyasModelProvider={id:"ollama",kind:"local",model:"fixture-revenue",configured:true,contextWindowTokens:8192,
    health:async()=>({available:true,detail:"in-process",checkedAtMs:0}),chat:async r=>{prompts.push(r.prompt);return {text:reply,finishReason:"stop"};},async *stream(r){prompts.push(r.prompt);yield {type:"delta",text:reply};yield {type:"done",text:reply,finishReason:"stop"};}};
  const snapshot:import("../src/lib/brain/ui/BrainConsoleSnapshot").BrainConsoleSnapshot={generatedAt:RM_AT,executionGate:"CLOSED",connected:{tasks:false,cycles:false,experience:false},errors:[],tasks:{total:0,byStatus:{queued:0,running:0,"blocked-on-dependency":0,"blocked-on-approval":0,succeeded:0,failed:0,cancelled:0,"skipped-unsafe":0},pendingApproval:0,skippedUnsafe:0,items:[]},cyclesRecorded:0,experience:{total:0},safety:{decision:"proceed-with-constraints",snapshotSource:"unavailable",reasons:[],hardwareProfileId:"gtx-1650-4gb"}};
  const events=[];for await(const event of streamAyasChat({text:"Şu an ne satıyoruz?",seq:0,snapshot,env:{NODE_ENV:"test"},fetcher:async()=>{throw Error("NETWORK_MUST_NOT_RUN");},memoryStore:{rootDir:p},route:{decision:{complexity:"NORMAL",providerId:"ollama",providerKind:"local",model:provider.model,reason:"in-process"},provider},revenueMemorySnapshots:{memory:rmState(rmRecord()),ledger:emptyAyasRevenueLedger()}}))events.push(event);
  assert.ok(events.some(e=>e.type==="done"));assert.ok(prompts.length>0);assert.match(prompts.join("\n"),/Gelir iş bağlamı/);assert.match(prompts.join("\n"),/yürütme yetkisi NONE; bütçe 0/);assert.equal(fs.existsSync(path.join(p,"revenue","ledger.json")),false);
});
assert.ok(n>=60);
// Fifteen frozen held-out contracts; no source rewrite or test-selected production branch.
const heldOut:[string,()=>unknown][]=[
 ["Turkish current",()=>assert.equal(detectAyasRevenueRecall("Şu an ne satıyoruz?",RM_NOW).mode,"current")],
 ["Turkish previous month",()=>{const q=detectAyasRevenueRecall("Geçen ay hangi kanal daha çok kazandırdı?",RM_NOW);assert.equal(q.from,"2026-09-01T00:00:00.000Z");assert.equal(q.until,"2026-10-01T00:00:00.000Z");}],
 ["Turkish cancelled history",()=>assert.equal(detectAyasRevenueRecall("Etsy planından vazgeçmiş miydik?",RM_NOW).mode,"history")],
 ["Current after history",()=>{detectAyasRevenueRecall("Geçen ay ne sattık?",RM_NOW);assert.equal(detectAyasRevenueRecall("Şimdi plan ne?",RM_NOW).mode,"current");}],
 ["Explicit asof",()=>assert.equal(detectAyasRevenueRecall("2026-09-20 tarihinde plan",RM_NOW).at,"2026-09-20T23:59:59.999Z")],
 ["Malformed date",()=>assert.throws(()=>detectAyasRevenueRecall("2026-02-31 plan",RM_NOW))],
 ["No future economic date",()=>assert.throws(()=>detectAyasRevenueRecall("2026-11-01 plan",RM_NOW))],
 ["Priority closed",()=>reject({...rmInput("priority",{kind:"CHANNEL_DECISION",slot:"CHANNEL_PRIORITY"}),value:{...rmInput().value,state:"APPROVE"}})],
 ["Card text",()=>reject({...rmInput(),value:{...rmInput().value,code:"4111111111111111"}})],
 ["Model cannot correct owner",()=>{const a=rmRecord(),b=rmRecord("model-correction",{factClass:"HYPOTHESIS",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,supersedesRecordId:a.recordId});assert.throws(()=>rmState(a,b));}],
 ["Dangling correction",()=>assert.throws(()=>rmState(rmRecord("missing",{supersedesRecordId:"revenue-memory-"+rmDigest("missing")})))],
 ["Price separate currencies",()=>{const p=rmInput("price",{kind:"PRICING_DECISION",slot:"OFFER_PRICE",value:{...rmInput().value,plannedPrice:{valueMinor:1000,currency:"USD"}}}),a=createAyasRevenueMemoryRecord(p,RM_AT),b=createAyasRevenueMemoryRecord({...p,eventDigest:rmDigest("eur-price"),value:{...p.value,plannedPrice:{valueMinor:900,currency:"EUR"}}},RM_AT);assert.equal(current(a,b).length,2);}],
 ["Immutable copies",()=>{const input=rmInput(),r=createAyasRevenueMemoryRecord(input,RM_AT);assert.ok(Object.isFrozen(r.value));assert.notEqual(input.value,r.value);}],
 ["Duplicate store event",()=>assert.throws(()=>rmState(rmRecord(),rmRecord()))],
 ["Money store untouched",()=>assert.equal(fingerprint(liveLedger),ledgerBefore)]
];
for(let i=0;i<heldOut.length;i++)await run("H"+String(i+1).padStart(2,"0"),"heldOut",heldOut[i]![1]);
} finally {assert.equal(fingerprint(liveLedger),ledgerBefore);const resolved=fs.realpathSync.native(temp);assert.equal(path.dirname(resolved).toLowerCase(),tempParent.toLowerCase());assert.ok(path.basename(resolved).startsWith("ayas-business-memory-"));fs.rmSync(resolved,{recursive:true,force:true});}
const result={status:rows.every(v=>v.ok)?"PASS":"FAIL",primary:{passed:rows.filter(v=>v.set==="primary"&&v.ok).length,total:rows.filter(v=>v.set==="primary").length},heldOut:{passed:rows.filter(v=>v.set==="heldOut"&&v.ok).length,total:rows.filter(v=>v.set==="heldOut").length},ledgerUnchanged:true,fixture:"TEMP_SYNTHETIC_NO_OWNER_AUTHENTICATION",results:rows};console.log(JSON.stringify(result));if(result.status!=="PASS")process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
