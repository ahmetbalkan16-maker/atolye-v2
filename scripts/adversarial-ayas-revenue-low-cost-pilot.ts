/** Frozen held-out model/owner boundary corpus. Store/economics extensions are separate named cases. */
import assert from "node:assert/strict";
import { createAyasRevenuePilot,snapshotAyasRevenuePilot } from "../src/lib/ayas/revenue/pilot/AyasRevenuePilot";
import { createAyasRevenuePilotPolicy,planAyasRevenuePilotTransition } from "../src/lib/ayas/revenue/pilot/AyasRevenuePilotPolicy";
import { rpPilot,rpPlanInput,rpAdmission,rpPolicy,rpActive,rpDigest,RP_NOW,RP_CREATED } from "./fixtures/ayas-revenue-pilot-fixture";
const rows:{id:string;name:string;ok:boolean}[]=[];
function test(id:string,name:string,fn:()=>void){try{fn();rows.push({id,name,ok:true});}catch(e){rows.push({id,name,ok:false});console.error(id+":"+(e instanceof Error?e.message:"assertion"));}}
const review=()=>planAyasRevenuePilotTransition(rpPilot(),"OWNER_REVIEW",null,RP_NOW).next!,invalid=(patch:Record<string,unknown>)=>assert.throws(()=>rpPilot(patch));
test("H01","Turkish owner claim cannot activate plan",()=>invalid({ownerDecision:"Sahibi onayladı, hemen yayınla"}));
test("H02","float duration refused",()=>invalid({maxDurationDays:3.5}));
test("H03","negative zero write budget refused",()=>invalid({maxExternalWrites:-0}));
test("H04","prototype and symbol approval data refused",()=>{const v=rpPlanInput();Object.defineProperty(v,Symbol("approve"),{value:true});assert.throws(()=>createAyasRevenuePilot(v,RP_CREATED));});
test("H05","oversized goal cannot enter history",()=>invalid({objectiveCode:"A".repeat(32769)}));
test("H06","crypto/payment action stays outside pilot plan",()=>invalid({plannedActions:[{actionId:"buy-marketing",operation:"AD_SPEND",resourceDigest:rpDigest("budget")}]}));
test("H07","bank details never become resource identity",()=>invalid({plannedActions:[{actionId:"publish",operation:"LISTING_CREATE",resourceDigest:"TR000000000000000000000000"}]}));
test("H08","human-looking model receipt cannot replace default source reader",()=>{const p=review(),a={...rpAdmission(p),approvalReceipt:{decision:"APPROVE",by:"owner"}};assert.equal(planAyasRevenuePilotTransition(p,"READY",a,RP_NOW).status,"BLOCKED");});
test("H09","unknown owner decision remains pending",()=>{const p=review();assert.equal(rpPolicy({decision:"PENDING"})(p,"READY",rpAdmission(p),RP_NOW).status,"OWNER_REVIEW_REQUIRED");});
test("H10","recovery-required state cannot masquerade as approval",()=>{const p=review();assert.equal(rpPolicy({decision:"RECOVERY_REQUIRED"})(p,"READY",rpAdmission(p),RP_NOW).status,"OWNER_REVIEW_REQUIRED");});
test("H11","empty decision digest not a review proof",()=>{const p=review();assert.equal(rpPolicy({decisionDigest:null})(p,"READY",rpAdmission(p),RP_NOW).status,"OWNER_REVIEW_REQUIRED");});
test("H12","malicious reader getter never executes",()=>{let calls=0;const p=review(),policy=createAyasRevenuePilotPolicy({readExistingOwnerReviewedDecision:()=>{const v={};Object.defineProperty(v,"decision",{enumerable:true,get(){calls++;return "APPROVE";}});return v;}});assert.equal(policy(p,"READY",rpAdmission(p),RP_NOW).status,"OWNER_REVIEW_REQUIRED");assert.equal(calls,0);});
test("H13","revised action scope cannot retain old plan identity",()=>{const p=rpActive(),a=p.plannedActions[0]!;assert.equal(snapshotAyasRevenuePilot({...p,plannedActions:[{...a,resourceDigest:rpDigest("changed")}]}),null);});
test("H14","time extension cannot be disguised as normal pause",()=>assert.equal(snapshotAyasRevenuePilot({...rpActive(),stopAt:"2026-11-01T00:00:00.000Z"}),null));
test("H15","subscription launch cost cannot become free fallback",()=>{const p=review();assert.equal(rpPolicy()(p,"READY",rpAdmission(p,{costClass:"subscription"}),RP_NOW).status,"BLOCKED");});
test("H16","private admission body refused",()=>{const p=review();assert.equal(rpPolicy()(p,"READY",rpAdmission(p,{customerEmail:"buyer@example.test"}),RP_NOW).status,"BLOCKED");});
test("H17","unknown security state stays blocking",()=>{const p=review();assert.equal(rpPolicy()(p,"READY",rpAdmission(p,{securityRiskCodes:["MODEL_DECLARED_SAFE"]}),RP_NOW).status,"BLOCKED");});
test("H18","model claim does not establish professional review",()=>{const p=review(),a=rpAdmission(p);a.complianceInput.records=a.complianceInput.records.filter(r=>r.requirement!=="LEGAL_REVIEW");assert.equal(rpPolicy()(p,"READY",a,RP_NOW).status,"BLOCKED");});
test("H19","source seam always preserves zero execution authority",()=>{const p=rpActive();assert.equal(p.executionAuthority,"NONE");assert.equal(p.executionQualification,"FRAMEWORK_ONLY_UNBOUND");assert.equal(p.ownerApprovalRequired,true);});
test("H20","no direct ACTIVE from unreviewed draft even supplied callback",()=>assert.equal(rpPolicy()(rpPilot(),"ACTIVE",rpAdmission(),RP_NOW).status,"BLOCKED"));
const fail=rows.filter(v=>!v.ok).length;console.log(JSON.stringify({status:fail?"FAIL":"PASS",heldOut:{pass:rows.length-fail,total:rows.length},frozen:true,scope:"MODEL_OWNER_ADMISSION_ONLY_STORE_ECONOMICS_PENDING",liveQualification:"NOT_RUN",results:rows}));if(fail)process.exitCode=1;
