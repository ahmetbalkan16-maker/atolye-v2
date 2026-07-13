import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionExecutionCoordinator } from "../src/lib/production/ProductionExecutionCoordinator";
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

const t0="2026-07-13T03:00:00.000Z",t1="2026-07-13T03:01:00.000Z",t2="2026-07-13T03:02:00.000Z",t4="2026-07-13T03:04:00.000Z",operation="pipeline.stage.retry.preview";
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
  return{directory,adapter,coordinator:new ProductionExecutionCoordinator(adapter)};
}
async function tree(directory:string){const out:string[]=[];async function walk(current:string){for(const item of await fs.readdir(current,{withFileTypes:true})){const full=path.join(current,item.name);if(item.isDirectory())await walk(full);else out.push(path.relative(directory,full)+":"+(await fs.readFile(full,"utf8")))}}await walk(directory);return out.sort()}
async function main(){const root=await fs.mkdtemp(path.join(os.tmpdir(),"atolye-coordinator-"));let scenarios=0;const scenario=async(name:string,run:()=>unknown|Promise<unknown>)=>{await run();scenarios++;void name};try{
  const base=await setup(root,"base"),first=await base.coordinator.coordinate(request(),{claim:claimPolicy,attempt:attemptPolicy});
  await scenario("first call opens",()=>{assert.equal(first.reasonCode,"ATTEMPT_OPENED");assert.equal(first.attempt?.attemptVersion,1);assert.equal(first.attempt?.journal.length,1)});
  const before=await tree(base.directory),replay=await base.coordinator.coordinate(request(),{claim:claimPolicy,attempt:attemptPolicy}),after=await tree(base.directory);
  await scenario("same request replays same attempt",()=>{assert.equal(replay.reasonCode,"ATTEMPT_REPLAYED");assert.equal(replay.attempt?.integrity.fingerprint,first.attempt?.integrity.fingerprint)});
  await scenario("exact replay is write free",()=>{assert.equal(replay.writeFree,true);assert.deepEqual(after,before)});
  await scenario("attempt version and journal integrity",()=>{assert.equal(replay.attempt?.attemptVersion,1);assert.deepEqual(replay.attempt?.journal,first.attempt?.journal)});
  for(const [name,change,code] of [["claim",{claimId:"claim-2"},"ATTEMPT_CLAIM_CONFLICT"],["worker",{workerId:"worker-2"},"ATTEMPT_OWNER_MISMATCH"],["session",{workerSessionId:"session-2"},"ATTEMPT_SESSION_MISMATCH"],["lease",{leaseId:"lease-2"},"ATTEMPT_LEASE_MISMATCH"]] as const){await scenario(`${name} mismatch`,async()=>assert.equal((await base.coordinator.coordinate(request(change),{claim:claimPolicy,attempt:attemptPolicy})).reasonCode,code))}
  await scenario("different idempotency payload conflicts",async()=>assert.equal((await base.coordinator.coordinate(request({executionFingerprint:"snapshot-2"}),{claim:claimPolicy,attempt:attemptPolicy})).reasonCode,"ATTEMPT_FINGERPRINT_CONFLICT"));
  assert.equal(scenarios,9);console.log(`Sprint 103 production execution coordinator smoke: PASS (${scenarios} scenarios)`);
}finally{await fs.rm(root,{recursive:true,force:true})}}
void main();

