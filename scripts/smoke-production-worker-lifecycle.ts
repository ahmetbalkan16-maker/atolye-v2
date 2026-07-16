import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProductionRuntimeInitializer } from "../src/lib/production/ProductionRuntimeInitializer";
import { ProductionWorkerLifecycle, ProductionWorkerLifecycleExecutionRejectedError } from "../src/lib/production/ProductionWorkerLifecycle";
import {
  executeConfiguredProductionPipelineStage,
  installCanonicalProductionPipelineExecution,
} from "../src/lib/production/ProductionPipelineExecutionFactory";
import { createRuntimeStorageContext } from "../src/lib/runtime/RuntimeStoragePaths";
import {
  createProductionRuntimeOperationContext,
  getActiveProductionRuntimeOperationContext,
  initialRuntimeAuthorityGeneration,
  ProductionRuntimeOperationContextError,
  runWithProductionRuntimeOperationContext,
} from "../src/lib/runtime/ProductionRuntimeOperationContext";
import type { ProductionExecutionRecoveryBootstrapResult } from "../src/types/productionExecutionRecoveryBootstrap";
import type { ProductionRuntimeInitializationSuccess } from "../src/types/productionRuntimeInitialization";

const initializedAt="2026-07-13T12:00:00.000Z";
function bootstrap(decision:ProductionExecutionRecoveryBootstrapResult["decision"]="ready"):ProductionExecutionRecoveryBootstrapResult{return{schemaVersion:"1",bootstrapId:`bootstrap-${decision}`,evaluatedAt:initializedAt,decision,writeFree:true,attempts:[],plannerPlans:[],counts:{active:0,running:0,terminal:0,orphaned:0,"expired-lease":0,replayable:0},evidence:["bootstrap:read-only"]}}
function initialization(worker:ProductionWorkerLifecycle):ProductionRuntimeInitializationSuccess{return{schemaVersion:"1",ok:true,decision:"ready",reasonCode:"RUNTIME_INITIALIZED",initializedAt,writeFree:true,partialInitialization:false,projects:[],counts:{active:0,running:0,terminal:0,orphaned:0,"expired-lease":0,replayable:0},worker:worker.snapshot(),evidence:["runtime:ready"]}}
async function durableEvidence(root:string){const count=async(name:string)=>{try{return(await fs.readdir(path.join(root,name))).length}catch{return 0}};return{reservations:await count("reservations"),claims:await count("claims"),idempotency:await count("idempotency"),attempts:await count("attempts")}}

async function main(){let scenarios=0;const scenario=async(name:string,run:()=>unknown|Promise<unknown>)=>{await run();scenarios++;void name};
  const runtimeWorker=new ProductionWorkerLifecycle(),runtime=new ProductionRuntimeInitializer({now:()=>initializedAt,listProjectSlugs:async()=>["project-1"],createRecoveryBootstrap:()=>({bootstrapRecovery:async()=>bootstrap()}),workerLifecycle:runtimeWorker}),runtimeResult=await runtime.initialize();
  await scenario("successful startup reaches ready",()=>{assert.equal(runtimeResult.ok,true);assert.equal(runtimeWorker.snapshot().state,"ready");assert.equal(runtimeResult.worker.state,"ready")});

  const repeated=new ProductionWorkerLifecycle(),startOne=repeated.start({initialization:initialization(repeated)}),startTwo=repeated.start({initialization:initialization(repeated)});
  await scenario("repeated start is idempotent",async()=>{assert.strictEqual(startOne,startTwo);assert.equal((await startOne).reasonCode,"WORKER_LIFECYCLE_STARTED");assert.equal(repeated.snapshot().state,"ready")});

  const invalidWorker=new ProductionWorkerLifecycle(),invalidRuntime=await new ProductionRuntimeInitializer({now:()=>initializedAt,listProjectSlugs:async()=>["project-1"],createRecoveryBootstrap:()=>({bootstrapRecovery:async()=>bootstrap("indeterminate")}),workerLifecycle:invalidWorker}).initialize();
  await scenario("recovery validation failure never readies worker",()=>{assert.equal(invalidRuntime.ok,false);assert.equal(invalidRuntime.reasonCode,"RUNTIME_BOOTSTRAP_INVALID");assert.equal(invalidWorker.snapshot().state,"failed");assert.equal(invalidWorker.snapshot().acceptingExecutions,false)});

  const temporaryRoot=await fs.mkdtemp(path.join(os.tmpdir(),"atolye-worker-lifecycle-"));
  const storageContext=createRuntimeStorageContext({environment:{ATOLYE_RUNTIME_ROOT:path.join(temporaryRoot,"runtime")},workspaceRoot:temporaryRoot,authorityRoot:path.join(temporaryRoot,"authority")});
  const projectSlug="worker-lifecycle-gate",durableRoot=path.join(storageContext.projectsRoot,projectSlug,"production-execution");
  const beforeReady=new ProductionWorkerLifecycle();let beforeCalled=false;
  await scenario("execution rejected before ready",async()=>{await assert.rejects(beforeReady.execute(async()=>{beforeCalled=true}),ProductionWorkerLifecycleExecutionRejectedError);assert.equal(beforeCalled,false);assert.equal(beforeReady.snapshot().activeExecutions,0)});
  const beforeReadyContext=createProductionRuntimeOperationContext({operationId:"worker-lifecycle-gate",operationType:"pipeline-stage-execution",authorityGeneration:initialRuntimeAuthorityGeneration,storageContext});beforeReady.bindRuntimeOperationContext(beforeReadyContext);
  let handlerCalls=0;
  installCanonicalProductionPipelineExecution(beforeReady,beforeReadyContext);
  await scenario("real factory path rejects before persistence preparation",async()=>{await assert.rejects(executeConfiguredProductionPipelineStage({projectSlug,stage:"script",runType:"initial"},async()=>{handlerCalls++;return true}),ProductionWorkerLifecycleExecutionRejectedError);assert.deepEqual(await durableEvidence(durableRoot),{reservations:0,claims:0,idempotency:0,attempts:0});assert.equal(handlerCalls,0)});
  await beforeReady.start({initialization:initialization(beforeReady)});
  await scenario("factory behavior requires real durable preparation before handler",async()=>{assert.equal(await executeConfiguredProductionPipelineStage({projectSlug,stage:"script",runType:"initial"},async()=>{assert.ok(getActiveProductionRuntimeOperationContext());assert.equal(beforeReady.snapshot().activeExecutions,1);const evidence=await durableEvidence(durableRoot);assert.ok(evidence.reservations>0);assert.ok(evidence.claims>0);assert.ok(evidence.idempotency>0);assert.ok(evidence.attempts>0);handlerCalls++;return true}),true);assert.equal(handlerCalls,1)});
  const durableAfterSuccess=await durableEvidence(durableRoot);
  const divergentContext=createProductionRuntimeOperationContext({operationId:"worker-lifecycle-divergent",operationType:"pipeline-stage-execution",authorityGeneration:"runtime-authority-generation-v2",storageContext});
  await scenario("mismatched context rejects before durable preparation",async()=>{await assert.rejects(runWithProductionRuntimeOperationContext(divergentContext,()=>executeConfiguredProductionPipelineStage({projectSlug,stage:"script",runType:"initial"},async()=>true)),(error:unknown)=>error instanceof ProductionRuntimeOperationContextError&&error.code==="RUNTIME_OPERATION_CONTEXT_MISMATCH");assert.deepEqual(await durableEvidence(durableRoot),durableAfterSuccess);assert.equal(handlerCalls,1)});
  await scenario("revoked context rejects before durable preparation",async()=>{const observed=new Promise<unknown>((resolve)=>{runWithProductionRuntimeOperationContext(beforeReadyContext,()=>{setTimeout(async()=>{try{await executeConfiguredProductionPipelineStage({projectSlug,stage:"script",runType:"initial"},async()=>true);resolve("unexpected")}catch(error){resolve(error)}},0)})});const error=await observed;assert.ok(error instanceof ProductionRuntimeOperationContextError);assert.equal(error.code,"RUNTIME_OPERATION_CONTEXT_MISSING");assert.deepEqual(await durableEvidence(durableRoot),durableAfterSuccess);assert.equal(handlerCalls,1)});
  await scenario("durable preparation failure never reaches handler",async()=>{const blockedSlug="worker-lifecycle-blocked",blockedFolder=path.join(storageContext.projectsRoot,blockedSlug);await fs.mkdir(blockedFolder,{recursive:true});await fs.writeFile(path.join(blockedFolder,"production-execution"),"blocked","utf8");let blockedHandlerCalls=0;await assert.rejects(executeConfiguredProductionPipelineStage({projectSlug:blockedSlug,stage:"script",runType:"initial"},async()=>{blockedHandlerCalls++;return true}));assert.equal(blockedHandlerCalls,0);assert.equal(beforeReady.snapshot().activeExecutions,0)});
  await scenario("handler rejection releases lifecycle and records failed attempt",async()=>{const failingSlug="worker-lifecycle-handler-failure";await assert.rejects(executeConfiguredProductionPipelineStage({projectSlug:failingSlug,stage:"script",runType:"initial"},async()=>{throw new Error("handler failure")}),/Pipeline stage execution failed/);assert.equal(beforeReady.snapshot().activeExecutions,0);const evidence=await durableEvidence(path.join(storageContext.projectsRoot,failingSlug,"production-execution"));assert.ok(evidence.attempts>0)});

  const throwing=new ProductionWorkerLifecycle();await throwing.start({initialization:initialization(throwing)});
  await scenario("sync and async execution failures release active count",async()=>{await assert.rejects(throwing.execute(()=>{throw new Error("sync failure")}),/sync failure/);assert.equal(throwing.snapshot().activeExecutions,0);await assert.rejects(throwing.execute(async()=>{throw new Error("async failure")}),/async failure/);assert.equal(throwing.snapshot().activeExecutions,0)});

  const idleDrain=new ProductionWorkerLifecycle();await idleDrain.start({initialization:initialization(idleDrain)});
  await scenario("drain without active execution completes immediately",async()=>{const result=await idleDrain.drain();assert.equal(result.ok,true);assert.equal(result.snapshot.state,"draining");assert.equal(result.snapshot.activeExecutions,0)});

  const failedGate=new ProductionWorkerLifecycle();failedGate.fail("TEST_STARTUP_FAILURE");let failedCalled=false;
  await scenario("failed lifecycle rejects execution deterministically",async()=>{await assert.rejects(failedGate.execute(async()=>{failedCalled=true}),ProductionWorkerLifecycleExecutionRejectedError);assert.equal(failedCalled,false);assert.equal(failedGate.snapshot().state,"failed");assert.equal(failedGate.snapshot().activeExecutions,0)});

  let release!:()=>void;const gate=new Promise<void>((resolve)=>{release=resolve}),active=repeated.execute(async()=>{await gate;return"completed"});
  const drainOne=repeated.drain(),drainTwo=repeated.drain();let drained=false;void drainOne.then(()=>{drained=true});await Promise.resolve();
  await scenario("drain waits for active execution",()=>{assert.strictEqual(drainOne,drainTwo);assert.equal(repeated.snapshot().state,"draining");assert.equal(repeated.snapshot().activeExecutions,1);assert.equal(drained,false)});
  let afterDrainCalled=false;
  await scenario("new execution rejected after drain",async()=>{await assert.rejects(repeated.execute(async()=>{afterDrainCalled=true}),ProductionWorkerLifecycleExecutionRejectedError);assert.equal(afterDrainCalled,false)});
  release();assert.equal(await active,"completed");const drainedResult=await drainOne;
  await scenario("drain completes after execution",()=>{assert.equal(drainedResult.ok,true);assert.equal(drainedResult.snapshot.activeExecutions,0);assert.equal(drained,true)});
  await scenario("repeated drain is idempotent",async()=>{assert.strictEqual(repeated.drain(),drainOne);assert.strictEqual(await repeated.drain(),drainedResult)});
  const stopOne=repeated.stop(),stopTwo=repeated.stop();
  await scenario("repeated stop is idempotent",async()=>{assert.strictEqual(stopOne,stopTwo);assert.equal((await stopOne).snapshot.state,"stopped")});
  await scenario("execution rejected after stop",async()=>assert.rejects(repeated.execute(async()=>"unexpected"),ProductionWorkerLifecycleExecutionRejectedError));

  const racing=new ProductionWorkerLifecycle();await racing.start({initialization:initialization(racing)});let finishRace!:()=>void;const raceGate=new Promise<void>((resolve)=>{finishRace=resolve}),accepted=racing.execute(()=>raceGate),raceDrain=racing.drain();let rejectedCalled=false;const rejected=racing.execute(async()=>{rejectedCalled=true});
  await scenario("concurrent acceptance drain race is safe",async()=>{assert.equal(racing.snapshot().state,"draining");assert.equal(racing.snapshot().activeExecutions,1);await assert.rejects(rejected,ProductionWorkerLifecycleExecutionRejectedError);assert.equal(rejectedCalled,false);finishRace();await accepted;await raceDrain;assert.equal(racing.snapshot().activeExecutions,0)});

  await scenario("composition root shares central lifecycle",async()=>{const root=await fs.readFile("src/lib/runtime/ProductionRuntimeCompositionRoot.ts","utf8"),factory=await fs.readFile("src/lib/production/ProductionPipelineExecutionFactory.ts","utf8");assert.match(root,/workerLifecycle:\s*productionWorkerLifecycle/);assert.match(root,/runtimeOperationContext:\s*processRuntimeOperationContext/);assert.ok(!/PipelineQueueScheduler|SIGTERM|SIGINT|process\.on/.test(root+factory))});
  await fs.rm(temporaryRoot,{recursive:true,force:true});
  assert.equal(scenarios,21);console.log(`Sprint 110 production worker lifecycle smoke: PASS (${scenarios}/21 scenarios)`);
}
void main();
