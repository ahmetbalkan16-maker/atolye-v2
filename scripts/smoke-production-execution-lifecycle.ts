import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionCoordinator } from "../src/lib/production/ProductionExecutionCoordinator";
import { ProductionExecutionLifecycle } from "../src/lib/production/ProductionExecutionLifecycle";
import { AdapterBackedProductionExecutionClaimService, defaultProductionExecutionClaimPolicy } from "../src/lib/production/ProductionExecutionDurableClaim";
import { AdapterBackedProductionExecutionDurableLeaseService, defaultProductionExecutionDurableLeasePolicy } from "../src/lib/production/ProductionExecutionDurableLease";
import { AdapterBackedProductionExecutionDurableStorage, defaultProductionExecutionDurableStoragePolicy } from "../src/lib/production/ProductionExecutionDurableStorage";
import { defaultProductionExecutionAttemptPolicy } from "../src/lib/production/ProductionExecutionDurableAttempt";
import { buildProductionExecutionIdempotencyIdentity, defaultProductionExecutionIdempotencyPolicy } from "../src/lib/production/ProductionExecutionIdempotency";
import { ProductionExecutionFilePersistenceAdapter } from "../src/lib/production/ProductionExecutionPersistence";
import type { ProductionExecutionCoordinatorRequest } from "../src/types/productionExecutionCoordinator";
import type { ProductionExecutionAuthorizationResult } from "../src/types/productionExecutionAuthorization";
import type { ProductionExecutionConfirmationValidationResult } from "../src/types/productionExecutionConfirmation";
import type { ProductionExecutionDurableWorkerIdentity, ProductionExecutionWorkerSessionIdentity } from "../src/types/productionExecutionDurableLease";
import type { ProductionExecutionIdempotencyRecord, ProductionExecutionIdempotencyReservationRequest } from "../src/types/productionExecutionIdempotency";

const t0="2026-07-13T03:00:00.000Z",t1="2026-07-13T03:01:00.000Z",t2="2026-07-13T03:02:00.000Z",t3="2026-07-13T03:03:00.000Z",t4="2026-07-13T03:04:00.000Z",operation="pipeline.stage.retry.preview";
const idPolicy={...defaultProductionExecutionIdempotencyPolicy,enabled:true,reservationTtlSeconds:600},storagePolicy={...defaultProductionExecutionDurableStoragePolicy,enabled:true,reservationTtlSeconds:600,idempotencyPolicy:idPolicy},leasePolicy={...defaultProductionExecutionDurableLeasePolicy,reservationTtlSeconds:600,maximumLeaseDurationSeconds:600},claimPolicy={...defaultProductionExecutionClaimPolicy,reservationTtlSeconds:600},attemptPolicy={...defaultProductionExecutionAttemptPolicy,reservationTtlSeconds:600};
const authorization:ProductionExecutionAuthorizationResult={schemaVersion:"1",decisionId:"authorization-1",decision:"allow",authorized:true,reasonCode:"AUTHORIZED",reason:"safe",evaluatedAt:t0,requestId:"request-1",idempotencyKey:"execution-1",executionFingerprint:"snapshot-1",actorId:"actor-1",actorType:"user",projectSlug:"project-1",operation,action:"retry-stage",stage:"script",requiredCapabilities:[],grantedCapabilities:[],missingCapabilities:[],policyVersion:"authorization-policy-v1",risk:"high",requiresConfirmation:true,requiredConfirmationLevel:"high",evidence:[]};
const confirmation:ProductionExecutionConfirmationValidationResult={schemaVersion:"1",decision:"valid",valid:true,reasonCode:"CONFIRMATION_VALID",reason:"safe",evaluatedAt:t0,confirmationId:"confirmation-1",confirmationRequestId:"confirmation-request-1",authorizationDecisionId:"authorization-1",requestId:"request-1",idempotencyKey:"execution-1",actorId:"actor-1",projectSlug:"project-1",operation,action:"retry-stage",stage:"script",riskLevel:"high",requiredConfirmationLevel:"high",providedConfirmationLevel:"high",bindingMatches:true,bindingFingerprint:"confirmation-binding-1",expired:false,singleUse:true,consumed:false,policyVersion:"authorization-policy-v1",evidence:[]};
const identity=buildProductionExecutionIdempotencyIdentity({authorization,confirmation},{evaluatedAt:t0,policy:idPolicy}).identity!;
const worker:ProductionExecutionDurableWorkerIdentity={schemaVersion:"1",workerId:"worker-1",workerType:"server",operationScope:[operation],identitySource:"trusted-server"},session:ProductionExecutionWorkerSessionIdentity={schemaVersion:"1",workerSessionId:"session-1",workerId:"worker-1",startedAt:t0,identitySource:"trusted-server"};
const request=(over:Partial<ProductionExecutionCoordinatorRequest["attempt"]>={}):ProductionExecutionCoordinatorRequest=>({
  claim:{claimId:"claim-1",recordId:"record-1",reservationId:identity.identityFingerprint,requestId:"request-1",idempotencyKey:"execution-1",executionFingerprint:"snapshot-1",workerId:"worker-1",workerSessionId:"session-1",leaseId:"lease-1",expectedReservationVersion:1,expectedIdempotencyVersion:2,expectedLeaseVersion:1,expectedClaimVersion:0,evaluatedAt:t2},
  attempt:{attemptId:"attempt-1",claimId:"claim-1",reservationId:identity.identityFingerprint,recordId:"record-1",requestId:"request-1",idempotencyKey:"execution-1",executionFingerprint:"snapshot-1",workerId:"worker-1",workerSessionId:"session-1",leaseId:"lease-1",expectedClaimVersion:1,expectedAttemptVersion:0,evaluatedAt:t2,...over},
});
async function setup(root:string,name:string){
  const directory=path.join(root,name),adapter=new ProductionExecutionFilePersistenceAdapter({trustedRootDirectory:directory,trustedAttemptIdFactory:()=>"fixed"}),storage=new AdapterBackedProductionExecutionDurableStorage(adapter),leases=new AdapterBackedProductionExecutionDurableLeaseService(adapter),claims=new AdapterBackedProductionExecutionClaimService(adapter);
  const reservation:ProductionExecutionIdempotencyReservationRequest={schemaVersion:"1",identity,authorization,confirmation,requestedAt:t0,expectedInitialState:"reserved",attempt:1,maxAttempts:3,reservationTtlSeconds:600,policyContext:{source:"server",environment:"test"},metadata:{source:"server"}};
  const record:ProductionExecutionIdempotencyRecord={schemaVersion:"1",recordId:"record-1",identityFingerprint:identity.identityFingerprint,idempotencyKey:identity.idempotencyKey,requestId:identity.requestId,executionFingerprint:identity.executionFingerprint,bindingFingerprint:identity.bindingFingerprint,actorId:identity.actorId,projectSlug:identity.projectSlug,operation:identity.operation,action:identity.action,stage:identity.stage,authorizationDecisionId:identity.authorizationDecisionId,confirmationRequestId:identity.confirmationRequestId,confirmationId:identity.confirmationId,policyVersion:identity.policyVersion,riskLevel:identity.riskLevel,state:"reserved",attempt:1,maxAttempts:3,createdAt:t0,updatedAt:t0,reservedAt:t0,evidence:[],integrity:{algorithm:"stable-production-id-v1",fingerprint:identity.identityFingerprint,version:1}};
  await storage.createReservation(reservation,{evaluatedAt:t1,policy:storagePolicy});await storage.createRecord(record,{evaluatedAt:t1,policy:storagePolicy});
  await leases.acquire({recordId:"record-1",expectedVersion:1,evaluatedAt:t1,worker,session,leaseId:"lease-1",acquiredAt:t1,heartbeatAt:t1,expiresAt:t4},leasePolicy);
  await claims.acquireExecutionClaim(request().claim,claimPolicy);
  return{directory,adapter,coordinator:new ProductionExecutionCoordinator(adapter),lifecycle:new ProductionExecutionLifecycle(adapter)};
}
async function tree(directory:string){const out:string[]=[];async function walk(current:string){for(const item of await fs.readdir(current,{withFileTypes:true})){const full=path.join(current,item.name);if(item.isDirectory())await walk(full);else out.push(path.relative(directory,full)+":"+(await fs.readFile(full,"utf8")))}}await walk(directory);return out.sort()}
async function main(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"atolye-lifecycle-"));let scenarios=0;const scenario=async(name:string,run:()=>unknown|Promise<unknown>)=>{await run();scenarios++;void name};const mutation=(transition:"running"|"completed"|"failed"|"cancelled",version:number,eventId:string,over:Record<string,unknown>={})=>({attemptId:"attempt-1",claimId:"claim-1",workerId:"worker-1",workerSessionId:"session-1",leaseId:"lease-1",expectedAttemptVersion:version,eventId,transition,evaluatedAt:t3,metadata:{code:`LIFECYCLE_${transition.toUpperCase()}`,summary:`Attempt ${transition}.`,evidence:[`lifecycle:${transition}`]},...over});try{
  async function opened(name:string){const value=await setup(root,name);await value.coordinator.coordinate(request(),{claim:claimPolicy,attempt:attemptPolicy});return value}
  const completed=await opened("completed"),running=await completed.lifecycle.mutate(mutation("running",1,"event-running"),{attempt:attemptPolicy});
  await scenario("created to running",()=>{assert.equal(running.reasonCode,"LIFECYCLE_TRANSITION_APPLIED");assert.equal(running.attempt?.state,"active")});
  await scenario("one version per running mutation",()=>assert.equal(running.attempt?.attemptVersion,2));
  const beforeReplay=await tree(completed.directory),replayed=await completed.lifecycle.mutate(mutation("running",1,"event-running"),{attempt:attemptPolicy});
  await scenario("exact replay write free",async()=>{assert.equal(replayed.reasonCode,"LIFECYCLE_TRANSITION_REPLAYED");assert.equal(replayed.writeFree,true);assert.deepEqual(await tree(completed.directory),beforeReplay)});
  await scenario("event id payload conflict",async()=>assert.equal((await completed.lifecycle.mutate({...mutation("running",2,"event-running"),metadata:{code:"DIFFERENT",summary:"Different.",evidence:["different"]}},{attempt:attemptPolicy})).reasonCode,"LIFECYCLE_EVENT_ID_CONFLICT"));
  await scenario("stale version conflict",async()=>assert.equal((await completed.lifecycle.mutate(mutation("completed",1,"event-completed"),{attempt:attemptPolicy})).reasonCode,"LIFECYCLE_STALE_WRITE"));
  const done=await completed.lifecycle.mutate(mutation("completed",2,"event-completed"),{attempt:attemptPolicy});
  await scenario("running to completed",()=>{assert.equal(done.state,"completed");assert.equal(done.attempt?.state,"succeeded");assert.equal(done.attempt?.attemptVersion,3)});
  await scenario("terminal cannot mutate",async()=>assert.equal((await completed.lifecycle.mutate(mutation("cancelled",3,"event-late"),{attempt:attemptPolicy})).reasonCode,"LIFECYCLE_TERMINAL_ATTEMPT"));
  await scenario("journal contiguous monotonic",()=>assert.deepEqual(done.attempt?.journal.map((entry:{sequence:number})=>entry.sequence),[1,2,3]));
  const failed=await opened("failed");await failed.lifecycle.mutate(mutation("running",1,"event-running"),{attempt:attemptPolicy});const failure=await failed.lifecycle.mutate(mutation("failed",2,"event-failed"),{attempt:attemptPolicy});
  await scenario("running to failed",()=>assert.equal(failure.attempt?.state,"failed"));
  const cancelled=await opened("cancelled"),cancel=await cancelled.lifecycle.mutate(mutation("cancelled",1,"event-cancelled"),{attempt:attemptPolicy});
  await scenario("active attempt cancelled",()=>assert.equal(cancel.attempt?.state,"cancelled"));
  const invalid=await opened("invalid");await scenario("invalid transition order",async()=>assert.equal((await invalid.lifecycle.mutate(mutation("completed",1,"event-completed"),{attempt:attemptPolicy})).reasonCode,"LIFECYCLE_TRANSITION_INVALID"));
  for(const[name,over,code]of[["worker",{workerId:"worker-2"},"LIFECYCLE_WORKER_MISMATCH"],["session",{workerSessionId:"session-2"},"LIFECYCLE_SESSION_MISMATCH"],["lease",{leaseId:"lease-2"},"LIFECYCLE_LEASE_MISMATCH"],["claim",{claimId:"claim-2"},"LIFECYCLE_CLAIM_MISMATCH"]]as const)await scenario(`${name} mismatch`,async()=>assert.equal((await invalid.lifecycle.mutate(mutation("running",1,`event-${name}`,over),{attempt:attemptPolicy})).reasonCode,code));
  await scenario("real mutations increment exactly once",()=>{assert.equal(failure.attempt?.attemptVersion,3);assert.equal(cancel.attempt?.attemptVersion,2)});
  assert.equal(scenarios,16);console.log(`Sprint 104 durable attempt lifecycle smoke: PASS (${scenarios} scenarios)`);
}finally{await fs.rm(root,{recursive:true,force:true})}}
void main();


