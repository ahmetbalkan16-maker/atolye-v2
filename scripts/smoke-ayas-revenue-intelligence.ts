/** Pure currency/ledger/history/context assertions. No model, platform, production store or owner-policy binding. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAyasRevenueIntelligence } from "../src/lib/ayas/revenue/AyasRevenueIntelligence";
import { buildAyasRevenueContext, AYAS_REVENUE_CONTEXT_MAX_CHARS, AYAS_REVENUE_CONTEXT_MAX_LINES } from "../src/lib/ayas/revenue/AyasRevenueContext";
import { detectAyasRevenueRecall } from "../src/lib/ayas/revenue/AyasRevenueRecall";
import { digestAyasRevenueLedgerData } from "../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenueLedgerEntry,validateAyasRevenueLedgerState,type AyasRevenueLedgerInput } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { revenueLedgerFixtureFact as fact, revenueLedgerFixtureState as ledger } from "./fixtures/ayas-revenue-ledger-fixture";
import { rmInput,rmRecord,rmState,rmQuery,rmDigest,RM_AT,RM_NOW,RM_OLD } from "./fixtures/ayas-revenue-memory-fixture";
const rows:{id:string;set:string;ok:boolean}[]=[];let count=0;
const run=(id:string,set:string,test:()=>unknown)=>{try{test();rows.push({id,set,ok:true});}catch(e){rows.push({id,set,ok:false});console.error(id+":"+(e instanceof Error?e.message:"assertion"));}};
const primary=(test:()=>unknown)=>run("P"+String(++count).padStart(2,"0"),"primary",test);
function sale(tag="one",platform="etsy",currency="USD",amount=1000):AyasRevenueLedgerInput[]{return (["GROSS_REVENUE","PLATFORM_FEE","PAYMENT_PROCESSING_FEE","PAYOUT_OBSERVED"] as const).map((event,i)=>fact(tag+"-"+i,event,i===0||i===3?amount:100,{platform,amount:{valueMinor:i===0||i===3?amount:100,currency},orderDigest:rmDigest("order-"+tag)}));}
const money=()=>ledger(...sale()),memory=()=>rmState(rmRecord()),snapshot=(m:unknown=memory(),l:unknown=money(),q=rmQuery())=>buildAyasRevenueIntelligence(m,l,q);
const context=(m:unknown=memory(),l:unknown=money(),text="Şu an ne satıyoruz?")=>buildAyasRevenueContext({memory:m,ledger:l,userText:text,now:RM_NOW});
primary(()=>assert.equal(snapshot().currentPrimaryOffer,rmDigest("offer-one")));
primary(()=>assert.equal(snapshot().realizedEconomicsByCurrency[0]?.contributionProfitMinor,800));
primary(()=>{const s=snapshot();assert.equal(s.grantsAuthority,false);assert.equal(s.executionAuthority,"NONE");assert.equal(s.autonomousBudgetUsd,0);});
primary(()=>{const p=rmRecord("price",{kind:"PRICING_DECISION",slot:"OFFER_PRICE",value:{...rmInput().value,plannedPrice:{valueMinor:999999,currency:"USD"}}});assert.equal(snapshot(rmState(p)).realizedEconomicsByCurrency[0]?.grossRevenueMinor,1000);});
primary(()=>{const m=rmState(rmRecord("model",{factClass:"HYPOTHESIS",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null}));assert.equal(snapshot(m).currentPrimaryOffer,null);});
primary(()=>{const p=rmRecord(),closed=rmRecord("closed",{slot:"OFFER_STATUS",effectiveFrom:"2026-10-03T12:30:00.000Z",value:{...rmInput().value,state:"CLOSED"}});assert.equal(snapshot(rmState(p,closed)).currentPrimaryOffer,null);assert.ok(snapshot(rmState(p,closed)).warnings.includes("CLOSED_OFFER_PLAN_SUPPRESSED"));});
primary(()=>{const f=rmRecord("future",{effectiveFrom:"2026-11-01T00:00:00.000Z"});assert.equal(snapshot(rmState(f)).currentPrimaryOffer,null);});
primary(()=>{const s=snapshot(rmState(rmRecord("a"),rmRecord("b",{offerDigest:rmDigest("second")})));assert.equal(s.currentPrimaryOffer,null);assert.ok(s.warnings.includes("DISPUTED_MEMORY_FACTS"));});
primary(()=>{const s=snapshot(memory(),ledger(fact("incomplete")));assert.equal(s.realizedEconomicsByCurrency[0]?.contributionProfitMinor,null);assert.ok(s.warnings.includes("FEES_INCOMPLETE"));assert.equal(s.comparisons[0]?.leadingPlatform,null);});
primary(()=>{const s=snapshot(memory(),ledger(...sale("usd","etsy","USD"),...sale("eur","upwork","EUR",100000)));assert.equal(s.realizedEconomicsByCurrency.length,2);assert.ok(s.comparisons.every(v=>v.crossCurrencyRanking===false));assert.equal(s.comparisons.find(v=>v.currency==="USD")?.leadingPlatform,"etsy");});
primary(()=>{const s=snapshot(memory(),ledger(...sale("first","etsy","USD",1000),...sale("second","upwork","USD",2000)));assert.equal(s.comparisons[0]?.leadingPlatform,"upwork");});
primary(()=>{const s=snapshot(memory(),ledger(...sale("first","etsy"),...sale("second","upwork")));assert.equal(s.comparisons[0]?.leadingPlatform,null);});
primary(()=>{const l=money(),r=rmRecord("ledger",{kind:"PERFORMANCE_SUMMARY",slot:null,factClass:"REALIZED_LEDGER_FACT",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,ledgerRef:{digest:digestAyasRevenueLedgerData(l),revision:l.revision}});assert.ok(!snapshot(rmState(r),l).warnings.includes("LEDGER_REFERENCE_MISMATCH"));});
primary(()=>{const r=rmRecord("bad-ref",{kind:"PERFORMANCE_SUMMARY",slot:null,factClass:"REALIZED_LEDGER_FACT",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,ledgerRef:{digest:rmDigest("wrong"),revision:0}});assert.ok(snapshot(rmState(r)).warnings.includes("LEDGER_REFERENCE_MISMATCH"));});
primary(()=>{const s=snapshot(memory(),ledger(...sale(),fact("refund1","REFUND",100),fact("refund2","REFUND",100)));assert.ok(s.warnings.includes("REPEAT_REFUNDS"));});
primary(()=>{const r=rmRecord("effort",{kind:"CHANNEL_DECISION",slot:"CHANNEL_PRIORITY",platform:"upwork",value:{...rmInput().value,state:"HIGH",activityCount:4}});assert.ok(snapshot(rmState(r)).warnings.includes("EFFORT_WITHOUT_REALIZED_SALES"));});
primary(()=>{const r=rmRecord("rights",{kind:"LESSON_LEARNED",slot:null,value:{...rmInput().value,code:"RIGHTS_UNRESOLVED"}});assert.ok(snapshot(rmState(r)).warnings.includes("RIGHTS_UNRESOLVED"));});
primary(()=>{const r=rmRecord("followup",{kind:"FOLLOW_UP",entityId:"followup-one",slot:"FOLLOWUP_STATUS",value:{...rmInput().value,state:"DUE",dueAt:"2026-10-03T12:30:00.000Z"}});const s=snapshot(rmState(r));assert.equal(s.followUps.length,1);assert.ok(s.warnings.includes("FOLLOW_UP_OVERDUE"));});
primary(()=>{const r=rmRecord("done",{kind:"FOLLOW_UP",entityId:"followup-one",slot:"FOLLOWUP_STATUS",value:{...rmInput().value,state:"DONE",dueAt:RM_AT}});assert.equal(snapshot(rmState(r)).followUps.length,0);});
primary(()=>{const r=rmRecord("paid",{kind:"EXPERIMENT",entityId:"experiment-one",slot:"EXPERIMENT_STATE",value:{...rmInput().value,code:"PAID_EXPERIMENT",state:"ACTIVE"}});assert.ok(snapshot(rmState(r)).warnings.includes("PAID_EXPERIMENT_OUTCOME_OPEN"));});
primary(()=>{const r=rmRecord("success",{kind:"EXPERIMENT",entityId:"experiment-one",slot:"EXPERIMENT_STATE",value:{...rmInput().value,state:"SUCCESS"}});assert.equal(snapshot(rmState(r)).experiments[0]?.value.state,"SUCCESS");});
primary(()=>{const a=rmRecord("content1",{kind:"CONTENT_PLAN",slot:null,value:{...rmInput().value,relatedDigest:rmDigest("same-content")}}),b=rmRecord("content2",{kind:"CONTENT_PLAN",slot:null,platform:"upwork",value:a.value});assert.ok(snapshot(rmState(a,b)).warnings.includes("DUPLICATE_CONTENT_EFFORT"));});
primary(()=>{const old=rmRecord("old-plan",{observedAt:RM_OLD,effectiveFrom:RM_OLD},RM_OLD);assert.ok(snapshot(rmState(old)).warnings.includes("STALE_MARKET_EVIDENCE"));});
primary(()=>assert.equal(context().status,"OK"));
primary(()=>{const c=context();assert.ok(c.lines.length<=AYAS_REVENUE_CONTEXT_MAX_LINES);assert.ok(c.lines.join("\n").length<=AYAS_REVENUE_CONTEXT_MAX_CHARS);assert.match(c.lines.join("\n"),/doğrulanmış onay değildir/);assert.equal(c.grantsAuthority,false);});
primary(()=>{const c=context({...memory(),privateMessage:"buyer-private-body"});assert.equal(c.status,"UNAVAILABLE");assert.ok(!JSON.stringify(c).includes("buyer-private-body"));});
primary(()=>assert.equal(context(memory(),{schemaVersion:"1",revision:99,entries:[]}).status,"UNAVAILABLE"));
primary(()=>assert.equal(context(memory(),money(),"2+2 kaç?").status,"NOT_RELEVANT"));
primary(()=>{const old=rmRecord("old",{observedAt:RM_OLD,effectiveFrom:RM_OLD},RM_OLD),next=rmRecord("next",{offerDigest:rmDigest("second")});const m=rmState(old,next);context(m,money(),"2026-09-20 tarihinde plan");assert.equal(context(m).status,"OK");assert.match(context(m).lines.join("\n"),new RegExp(rmDigest("second")));});
primary(()=>{const bytes=JSON.stringify(money()),m=JSON.stringify(memory());snapshot();context();assert.equal(JSON.stringify(money()),bytes);assert.equal(JSON.stringify(memory()),m);});
primary(()=>{const source=fs.readFileSync("src/lib/ayas/AyasChatStream.ts","utf8");assert.match(source,/revenueMemorySnapshots\?/);assert.match(source,/\.\.\.\(revenueContext\?\.lines \?\? \[\]\)/);assert.doesNotMatch(source,/new AyasRevenueMemoryStore|new AyasRevenueLedgerStore/);});
primary(()=>{const s=snapshot();assert.ok(Object.isFrozen(s.realizedEconomicsByCurrency));assert.equal(s.evidenceVerification,"NORMALIZED_UNVERIFIED_OBSERVATIONS");});
const heldOut:[string,()=>unknown][]=[
 ["Unknown money empty",()=>assert.equal(snapshot(rmState(),ledger()).evidenceFreshness,"INCOMPLETE")],
 ["Known-at hides delayed sale",()=>{const f=fact("delayed","GROSS_REVENUE",1000),entry=createAyasRevenueLedgerEntry(f,"2026-10-03T13:00:00.000Z"),l=validateAyasRevenueLedgerState({schemaVersion:"1",revision:1,entries:[entry]});assert.equal(snapshot(memory(),l,{...rmQuery(),knownAt:RM_AT}).realizedEconomicsByCurrency.length,0);}],
 ["Hypothesis doesn't replace owner plan",()=>{const a=rmRecord(),b=rmRecord("model",{factClass:"HYPOTHESIS",source:"SYSTEM_DERIVED",reviewEvidenceDigest:null,offerDigest:rmDigest("forecast"),effectiveFrom:"2026-10-03T12:30:00.000Z"});assert.equal(snapshot(rmState(a,b)).currentPrimaryOffer,a.offerDigest);}],
 ["No generic success score",()=>assert.ok(!Object.hasOwn(snapshot(),"successScore"))],
 ["Turkish experiment query",()=>{const q=detectAyasRevenueRecall("Upwork'ta neyi denedik?",RM_NOW);assert.equal(q.intent,"EXPERIMENTS");assert.equal(q.mode,"history");assert.equal(q.platform,"upwork");}],
 ["Current cue overrides past clause",()=>assert.equal(detectAyasRevenueRecall("Geçen ay Etsy dedik; şu an ne satıyoruz?",RM_NOW).mode,"current")],
 ["Raw platform payload refused",()=>assert.equal(context({...memory(),rawPayload:{order:1}}).status,"UNAVAILABLE")],
 ["Context output cannot approve",()=>assert.match(context().lines.join("\n"),/yürütme yetkisi NONE; bütçe 0/)]
];for(let i=0;i<heldOut.length;i++)run("H"+String(i+1).padStart(2,"0"),"heldOut",heldOut[i]![1]);
const result={status:rows.every(v=>v.ok)?"PASS":"FAIL",primary:{passed:rows.filter(v=>v.set==="primary"&&v.ok).length,total:rows.filter(v=>v.set==="primary").length},heldOut:{passed:rows.filter(v=>v.set==="heldOut"&&v.ok).length,total:rows.filter(v=>v.set==="heldOut").length},fixture:"SYNTHETIC_NO_MODEL_OR_LIVE_DATA",results:rows};console.log(JSON.stringify(result));if(result.status!=="PASS")process.exitCode=1;
