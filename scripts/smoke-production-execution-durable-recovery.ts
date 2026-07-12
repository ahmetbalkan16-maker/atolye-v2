import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy } from "../src/lib/production/ProductionExecutionIdempotency";
import { AdapterBackedProductionExecutionDurableStorage, defaultProductionExecutionDurableStoragePolicy } from "../src/lib/production/ProductionExecutionDurableStorage";
import { evaluateProductionExecutionDirectoryDurability, ProductionExecutionDurableRecoveryService, ProductionExecutionFilePersistenceAdapter } from "../src/lib/production/ProductionExecutionPersistence";
import type { ProductionExecutionAuthorizationResult } from "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "../src/types/productionExecutionConfirmation";
import type { ProductionExecutionIdempotencyRecord } from "../src/types/productionExecutionIdempotency";

const t0="2026-07-12T20:00:00.000Z",t1="2026-07-12T20:01:00.000Z",operation="pipeline.stage.retry.preview";
const idPolicy={...defaultProductionExecutionIdempotencyPolicy,enabled:true,policyVersion:"idempotency-policy-v1"};
const policy={...defaultProductionExecutionDurableStoragePolicy,enabled:true,idempotencyPolicy:idPolicy};
const auth:ProductionExecutionAuthorizationResult={schemaVersion:"1",decisionId:"authorization-1",decision:"allow",authorized:true,reasonCode:"AUTHORIZED",reason:"safe",evaluatedAt:t0,requestId:"request-1",idempotencyKey:"execution-1",executionFingerprint:"snapshot-1",actorId:"actor-1",actorType:"user",projectSlug:"project-1",operation,action:"retry-stage",stage:"script",requiredCapabilities:[],grantedCapabilities:[],missingCapabilities:[],policyVersion:"authorization-policy-v1",risk:"high",requiresConfirmation:true,requiredConfirmationLevel:"high",evidence:[]};
const confirmation:ProductionExecutionConfirmationValidationResult={schemaVersion:"1",decision:"valid",valid:true,reasonCode:"CONFIRMATION_VALID",reason:"safe",evaluatedAt:t0,confirmationId:"confirmation-1",confirmationRequestId:"confirmation-request-1",authorizationDecisionId:"authorization-1",requestId:"request-1",idempotencyKey:"execution-1",actorId:"actor-1",projectSlug:"project-1",operation,action:"retry-stage",stage:"script",riskLevel:"high",requiredConfirmationLevel:"high",providedConfirmationLevel:"high",bindingMatches:true,bindingFingerprint:"confirmation-binding-1",expired:false,singleUse:true,consumed:false,policyVersion:"authorization-policy-v1",evidence:[]};
const identity=buildProductionExecutionIdempotencyIdentity({authorization:auth,confirmation},{evaluatedAt:t0,policy:idPolicy}).identity!;
function record(recordId="record-1",idempotencyKey="execution-1",requestId="request-1"):ProductionExecutionIdempotencyRecord{return{schemaVersion:"1",recordId,identityFingerprint:identity.identityFingerprint,idempotencyKey,requestId,executionFingerprint:identity.executionFingerprint,bindingFingerprint:identity.bindingFingerprint,actorId:identity.actorId,projectSlug:identity.projectSlug,operation:identity.operation,action:identity.action,stage:identity.stage,authorizationDecisionId:identity.authorizationDecisionId,confirmationRequestId:identity.confirmationRequestId,confirmationId:identity.confirmationId,policyVersion:identity.policyVersion,riskLevel:identity.riskLevel,state:"reserved",attempt:1,maxAttempts:3,createdAt:t0,updatedAt:t0,reservedAt:t0,evidence:[],integrity:{algorithm:"stable-production-id-v1",fingerprint:identity.identityFingerprint,version:1}}}
let count=0;async function scenario(name:string,run:()=>void|Promise<void>){await run();count++;void name}
function finding(scan:Awaited<ReturnType<ProductionExecutionDurableRecoveryService["scan"]>>,code:string){return scan.findings.find(item=>item.reasonCode===code)}
async function snapshot(root:string){const output:string[]=[];async function walk(directory:string){let names:string[];try{names=(await fs.readdir(directory)).sort()}catch{return}for(const name of names){const full=path.join(directory,name),stat=await fs.stat(full);if(stat.isDirectory())await walk(full);else output.push(`${path.relative(root,full)}:${await fs.readFile(full,"utf8")}`)}}await walk(root);return output}

async function main(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"atolye-recovery-"));try{
  const recovery=new ProductionExecutionDurableRecoveryService({trustedRootDirectory:root,trustedAttemptIdFactory:()=>"attempt-fixed"});
  const store=new AdapterBackedProductionExecutionDurableStorage(new ProductionExecutionFilePersistenceAdapter({trustedRootDirectory:root,trustedAttemptIdFactory:()=>"write-fixed"}));
  await scenario("clean storage scan",async()=>{const scan=await recovery.scan();assert.equal(scan.decision,"clean");assert.equal(scan.writeFree,true)});
  await store.createRecord(record(),{evaluatedAt:t1,policy});
  await scenario("valid canonical record",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_RECORD_VALID")));
  await scenario("missing index",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INDEX_MISSING")));
  await scenario("scan write free",async()=>{const before=await snapshot(root);await recovery.scan();assert.deepEqual(await snapshot(root),before)});
  const first=await recovery.rebuildIndex();
  await scenario("deterministic index rebuild",async()=>{const second=await recovery.rebuildIndex();assert.deepEqual(second.index,first.index);assert.equal(second.created,false)});
  await scenario("lookup idempotency match",async()=>assert.equal((await recovery.lookup("idempotency-key","execution-1")).match?.recordId,"record-1"));
  await scenario("lookup request match",async()=>assert.equal((await recovery.lookup("request-id","request-1")).match?.recordId,"record-1"));
  await store.createRecord(record("record-2"),{evaluatedAt:t1,policy});
  await scenario("stale index",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INDEX_STALE")));
  const rebuilt=await recovery.rebuildIndex();
  await scenario("rebuild after stale lookup",async()=>assert.equal((await recovery.lookup("idempotency-key","execution-1")).index?.idempotencyKeys.length,2));
  const indexPath=path.join(root,"indexes",`lookup-${rebuilt.index!.sourceFingerprint}.json`),indexBytes=await fs.readFile(indexPath,"utf8");
  await fs.writeFile(indexPath,"{","utf8");
  await scenario("corrupt index",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INDEX_MALFORMED")));
  await fs.writeFile(indexPath,JSON.stringify({...rebuilt.index,integrity:{algorithm:"sha256",fingerprint:"0".repeat(64)}}),"utf8");
  await scenario("index integrity mismatch",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INDEX_INTEGRITY_MISMATCH")));
  await fs.writeFile(indexPath,indexBytes,"utf8");
  const idem=path.join(root,"idempotency"),canonical=path.join(idem,"record-1-v1.json"),validBytes=await fs.readFile(canonical,"utf8");
  await fs.writeFile(`${canonical}.orphan-a.tmp`,validBytes,"utf8");
  await scenario("valid target plus orphan temp",async()=>{const item=finding(await recovery.scan(),"RECOVERY_ORPHAN_TEMP");assert.equal(item?.canonicalTargetPresent,true);assert.equal(item?.applyAllowed,true)});
  await fs.writeFile(path.join(idem,"orphan-v1.json.orphan-b.tmp"),validBytes,"utf8");
  await scenario("orphan temp detection",async()=>assert.ok((await recovery.scan()).findings.filter(item=>item.reasonCode==="RECOVERY_ORPHAN_TEMP").length>=2));
  await fs.writeFile(path.join(idem,"bad-v1.json.bad.tmp"),JSON.stringify({schemaVersion:"1"}),"utf8");
  await scenario("malformed temp",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INTEGRITY_MISMATCH")));
  await fs.writeFile(path.join(idem,"partial-v1.json.partial.tmp"),"{","utf8");
  await scenario("partial json temp",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_PARTIAL_ARTIFACT")));
  await fs.writeFile(path.join(idem,"mystery.tmp"),"opaque","utf8");
  await scenario("ambiguous artifact recovery required",async()=>{const scan=await recovery.scan();assert.equal(scan.decision,"recovery-required");assert.equal(finding(scan,"RECOVERY_ARTIFACT_AMBIGUOUS")?.applyAllowed,false)});
  await scenario("explicit cleanup only allowed artifact",async()=>{const scan=await recovery.scan(),allowed=scan.findings.find(item=>item.reasonCode==="RECOVERY_ORPHAN_TEMP")!;const result=await recovery.apply({artifactId:allowed.artifactId,operation:"cleanup",scan});assert.equal(result.applied,true);await fs.access(path.join(idem,"mystery.tmp"))});
  await scenario("ambiguous cleanup denied",async()=>{const scan=await recovery.scan(),ambiguous=finding(scan,"RECOVERY_ARTIFACT_AMBIGUOUS")!;assert.equal((await recovery.apply({artifactId:ambiguous.artifactId,operation:"cleanup",scan})).reasonCode,"RECOVERY_APPLY_NOT_ALLOWED")});
  await fs.writeFile(path.join(idem,"corrupt-v1.json"),"{","utf8");
  await scenario("corrupt canonical not overwritten",async()=>{const before=await fs.readFile(path.join(idem,"corrupt-v1.json"),"utf8");assert.ok(finding(await recovery.scan(),"RECOVERY_RECORD_MALFORMED"));assert.equal(await fs.readFile(path.join(idem,"corrupt-v1.json"),"utf8"),before)});
  await fs.writeFile(path.join(idem,"schema-v1.json"),JSON.stringify({...JSON.parse(validBytes),schemaVersion:"2"}),"utf8");
  await scenario("unsupported schema",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_SCHEMA_UNSUPPORTED")));
  await fs.writeFile(path.join(idem,"storage-v1.json"),JSON.stringify({...JSON.parse(validBytes),storageVersion:"2"}),"utf8");
  await scenario("unsupported storage version",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_STORAGE_VERSION_UNSUPPORTED")));
  await fs.writeFile(path.join(idem,"integrity-v1.json"),JSON.stringify({...JSON.parse(validBytes),lifecycleState:"queued"}),"utf8");
  await scenario("canonical integrity mismatch",async()=>assert.ok(finding(await recovery.scan(),"RECOVERY_INTEGRITY_MISMATCH")));
  await scenario("traversal rejected",async()=>assert.equal((await recovery.lookup("request-id","../escape")).reasonCode,"RECOVERY_TRAVERSAL_DENIED"));
  await scenario("absolute path rejected",async()=>assert.equal((await recovery.lookup("request-id","C:\\escape")).reasonCode,"RECOVERY_PATH_INVALID"));
  await scenario("public safe diagnostics",async()=>{const text=JSON.stringify(await recovery.lookup("request-id","C:\\secret-stack"));assert.ok(!/secret|stack trace|C:\\/i.test(text))});
  await scenario("unsupported directory durability",()=>{const result=evaluateProductionExecutionDirectoryDurability({platform:"test-platform",directorySyncSupported:false});assert.equal(result.status,"unsupported");assert.equal(result.durable,false)});
  await scenario("failed directory durability safe",()=>assert.deepEqual(evaluateProductionExecutionDirectoryDurability({platform:"test",directorySyncSupported:true,syncOutcome:"failed"}).evidence,["directory-durability:failed"]));
  await scenario("source of truth preserved",async()=>assert.equal(await fs.readFile(canonical,"utf8"),validBytes));
  await scenario("no orchestration integration",async()=>{const source=await fs.readFile("src/lib/production/ProductionExecutionPersistence.ts","utf8");assert.ok(!/setInterval|setTimeout|NextResponse|POST\(|enqueue\(|worker_threads/i.test(source))});
  assert.ok(count>=27);console.log(`Sprint 99.1 durable storage recovery and index hardening smoke: PASS (${count} scenarios)`);
}finally{await fs.rm(root,{recursive:true,force:true});await assert.rejects(fs.access(root))}}
void main();
