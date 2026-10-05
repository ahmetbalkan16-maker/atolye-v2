import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
import {AUDIT_DOMAINS,snapshotAudit} from "../src/lib/ayas/audit/AyasSystemAuditModel";
import {evaluateAyasSystemClosure} from "../src/lib/ayas/audit/AyasSystemClosureGate";
import {buildAyasSystemAuditReport} from "../src/lib/ayas/audit/AyasSystemAuditReport";
import {collectAyasSystemAudit,inventoryAyasAuditProtectedRoots,type AyasAuditCollectorDeps} from "../src/lib/ayas/audit/AyasSystemAuditCollector";
import {auditFixture,auditFault,auditGraphFixture,AUDIT_HASH,AUDIT_HEAD,AUDIT_NOW} from "./fixtures/ayas-system-audit-fixture";
const rows:{id:string;ok:boolean}[]=[],only=process.argv.includes("--case")?process.argv[process.argv.indexOf("--case")+1]:null;
async function scenario(name:string,fn:()=>unknown|Promise<unknown>){const id="P"+String(rows.length+1).padStart(3,"0");if(only&&id!==only){rows.push({id,ok:true});return;}try{await fn();}catch(e){rows.push({id,ok:false});const actual=only?rows.filter(r=>r.id===only):rows;console.log(JSON.stringify({status:"FAIL",primary:{passed:actual.filter(r=>r.ok).length,total:actual.length},completePrimary:false,results:actual}));throw e;}rows.push({id,ok:true});if(process.env.SMOKE_TRACE==="1")console.log(id+" "+name);}
const verdict=(v:unknown)=>evaluateAyasSystemClosure(v).decision;
async function main(){
  // Eight independent requirements in each mandatory domain, not duplicated expected outputs.
  for(const d of AUDIT_DOMAINS)for(const [fault,expected]of [["NONE","LOCAL_VALIDATION_COMPLETE"],["MISSING_SOURCE","BLOCKED"],["OLD_SOURCE_HEAD","BLOCKED"],["TEST_FAIL","BLOCKED"],["TEST_NOT_RUN","STATIC_AUDIT_COMPLETE"],["LIVE_NOT_RUN","STATIC_AUDIT_COMPLETE"],["OLD_TEST_HEAD","STATIC_AUDIT_COMPLETE"],["WRONG_CLASS","BLOCKED"]])await scenario(d+" "+fault,()=>{const v=auditFixture();if(fault!=="NONE")auditFault(v,d,fault!);assert.equal(verdict(v),expected);});
  await scenario("needs_update cannot claim current",()=>{const v=auditFixture();v.graphify.needsUpdate=true;assert.equal(verdict(v),"BLOCKED");});
  await scenario("stale marker holds",()=>{const v=auditFixture();v.graphify.stale=true;assert.equal(verdict(v),"BLOCKED");});
  await scenario("all graph anomaly types hold",()=>{const v=auditFixture();v.graphify.integrityViolations=1;assert.equal(verdict(v),"BLOCKED");});
  await scenario("graph built HEAD binds",()=>{const v=auditFixture();v.graphify.builtFromHead="3".repeat(40);assert.equal(verdict(v),"BLOCKED");});
  await scenario("unknown graph holds",()=>{const v=auditFixture();v.graphify.sourceHead=null;assert.equal(verdict(v),"BLOCKED");});
  await scenario("partial coverage stays disclosed",()=>{const v=auditFixture();v.graphify.structural="PARTIAL";v.graphify.semantic="PENDING";const r=buildAyasSystemAuditReport(v);assert.equal(r.closure,"LOCAL_VALIDATION_COMPLETE");assert.equal(evaluateAyasSystemClosure(v).assessment.input!.graphify.structural,"PARTIAL");});
  await scenario("partial baseline cannot close foundation",()=>{const v=auditFixture();v.ownerReviewDigest=AUDIT_HASH;v.coverage.executed=62;assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  await scenario("owner cannot overrule failed cognitive test",()=>assert.equal(verdict(auditFault(auditFixture(),"C","OWNER_OVERRIDES_TEST")),"BLOCKED"));
  await scenario("known limit unexpectedly passes requires review",()=>{const v=auditFixture();v.evidence.find(e=>e.checkId==="D_TEST")!.findingCode="KNOWN_LIMIT_REVIEW_REQUIRED";assert.equal(verdict(v),"BLOCKED");});
  await scenario("protected mutation never passes as unrelated",()=>{const v=auditFixture();v.mutation.afterDigest="b".repeat(64);assert.equal(verdict(v),"BLOCKED");});
  await scenario("background mutation separately reported",()=>{const v=auditFixture();v.mutation.afterDigest="b".repeat(64);v.mutation.attribution="BACKGROUND";v.mutation.writerEvidenceDigest=AUDIT_HASH;const r=evaluateAyasSystemClosure(v);assert.equal(r.decision,"BLOCKED");assert.ok(r.reasons.includes("PROTECTED_BACKGROUND_CHANGE_REPORTED"));});
  await scenario("unknown protected scope holds",()=>{const v=auditFixture();v.mutation.complete=false;assert.equal(verdict(v),"BLOCKED");});
  await scenario("expired proof remains stale",()=>{const v=auditFixture();v.evidence[1]!.observedAt="2026-10-01T10:00:00.000Z";assert.equal(evaluateAyasSystemClosure(v).assessment.evidence[1]!.state,"STALE");});
  await scenario("official HEAD independent does not stale",()=>{const v=auditFixture(),r=v.evidence.find(e=>e.checkId==="G_LIVE")!;r.head=null;r.headIndependent=true;assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  await scenario("fixture cannot exempt its HEAD",()=>{const v=auditFixture();v.evidence[1]!.headIndependent=true;v.evidence[1]!.head=null;assert.equal(verdict(v),"BLOCKED");});
  await scenario("owner review digest mismatch not foundation",()=>{const v=auditFixture();v.ownerReviewDigest="b".repeat(64);assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  await scenario("normalized closure still grants no authority",()=>{const v=auditFixture();v.ownerReviewDigest=AUDIT_HASH;const r=evaluateAyasSystemClosure(v);assert.equal(r.decision,"FOUNDATION_CLOSED");assert.equal(r.grantsAuthority,false);assert.equal(r.executionAuthority,"NONE");assert.equal(r.autonomousSpend,0);assert.match(r.evidenceVerification,/NOT_ATTESTATION/);});
  await scenario("missing machine never healthy default",()=>{const v=auditFixture();v.ownerReviewDigest=AUDIT_HASH;v.machineEvidenceAt=null;assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  await scenario("expired machine prevents promotion",()=>{const v=auditFixture();v.ownerReviewDigest=AUDIT_HASH;v.machineEvidenceAt="2026-10-01T10:00:00.000Z";assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  await scenario("throttle prevents promotion",()=>{const v=auditFixture();v.ownerReviewDigest=AUDIT_HASH;v.machineStatus="THROTTLE";assert.equal(verdict(v),"LOCAL_VALIDATION_COMPLETE");});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ayas-audit-fixture-"));try{
    const deps=():AyasAuditCollectorDeps=>({repository:()=>({head:AUDIT_HEAD,branch:"codex/fixture"}),clock:()=>AUDIT_NOW,graph:async()=>auditGraphFixture(),readSource:()=>Buffer.from("registered source"),inventory:()=>inventoryAyasAuditProtectedRoots(root),declaredSuites:163});
    await scenario("default missing test/live collectors not synthesized",async()=>{const r=await collectAyasSystemAudit(deps());assert.equal(r.report.closure,"STATIC_AUDIT_COMPLETE");assert.equal(r.input.coverage.executed,0);assert.equal(r.input.evidence.filter(e=>e.state==="NOT_RUN").length,30);});
    await scenario("collector writes no fixed protected root",async()=>{const before=inventoryAyasAuditProtectedRoots(root);await collectAyasSystemAudit(deps());assert.deepEqual(inventoryAyasAuditProtectedRoots(root),before);assert.deepEqual(fs.readdirSync(root),[]);});
    await scenario("source missing does not infer implementation",async()=>{const d=deps();d.readSource=()=>null;assert.equal((await collectAyasSystemAudit(d)).report.closure,"BLOCKED");});
    await scenario("mutating injected collector caught in TEMP",async()=>{const d=deps();d.readSource=()=>{fs.mkdirSync(path.join(root,"data/brain"),{recursive:true});fs.writeFileSync(path.join(root,"data/brain/fixture.json"),"mutation");return Buffer.from("source");};assert.equal((await collectAyasSystemAudit(d)).report.closure,"BLOCKED");});
    await scenario("HEAD drift during collection holds",async()=>{const d=deps();let i=0;d.repository=()=>({head:++i===1?AUDIT_HEAD:"2".repeat(40),branch:"codex/fixture"});assert.equal((await collectAyasSystemAudit(d)).report.closure,"BLOCKED");});
    await scenario("branch drift during collection holds",async()=>{const d=deps();let i=0;d.repository=()=>({head:AUDIT_HEAD,branch:++i===1?"codex/fixture":"codex/drift"});assert.equal((await collectAyasSystemAudit(d)).report.closure,"BLOCKED");});
    await scenario("credential path never read as mutation proof",()=>{fs.writeFileSync(path.join(root,"data/brain/credential-fixture.json"),"nonsecret sentinel");assert.equal(inventoryAyasAuditProtectedRoots(root).complete,false);});
  }finally{assert.equal(path.dirname(fs.realpathSync.native(root)).toLowerCase(),fs.realpathSync.native(os.tmpdir()).toLowerCase());fs.rmSync(root,{recursive:true,force:true});}
  await scenario("all fifteen domains always reported",()=>assert.equal(buildAyasSystemAuditReport(auditFixture()).domains.length,15));
  await scenario("pure kernel has no filesystem/process/provider/authority import",()=>{for(const f of ["AyasSystemAuditModel","AyasSystemAuditRegistry","AyasSystemAuditPolicy","AyasSystemAuditReport","AyasSystemClosureGate"])assert.doesNotMatch(fs.readFileSync("src/lib/ayas/audit/"+f+".ts","utf8"),/node:fs|child_process|process\.env|fetch\(|ApprovalService|ExecutionGateStore/);});
  await scenario("snapshot refuses callback capability",()=>assert.equal(snapshotAudit({callback:()=>true}),null));
  await scenario("immutable report cannot change evidence",()=>{const r=buildAyasSystemAuditReport(auditFixture());assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.domains[0]!.evidence));});
  const actual=only?rows.filter(r=>r.id===only):rows;assert.ok(only?actual.length===1:actual.length>=120);console.log(JSON.stringify({status:"PASS",primary:{passed:actual.length,total:actual.length},completePrimary:!only,fixture:"TEMP_READ_ONLY_NO_ACTIVATION",results:actual}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
