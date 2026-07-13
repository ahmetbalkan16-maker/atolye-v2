import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { ProductionRuntimeInitializer } from "../src/lib/production/ProductionRuntimeInitializer";
import { ProductionWorkerLifecycle, ProductionWorkerLifecycleExecutionRejectedError } from "../src/lib/production/ProductionWorkerLifecycle";
import { createProductionPipelineExecutionExecutor } from "../src/lib/production/ProductionPipelineExecutionFactory";
import type { ProductionExecutionRecoveryBootstrapResult } from "../src/types/productionExecutionRecoveryBootstrap";
import type { ProductionRuntimeInitializationSuccess } from "../src/types/productionRuntimeInitialization";

const initializedAt="2026-07-13T12:00:00.000Z";
function bootstrap(decision:ProductionExecutionRecoveryBootstrapResult["decision"]="ready"):ProductionExecutionRecoveryBootstrapResult{return{schemaVersion:"1",bootstrapId:`bootstrap-${decision}`,evaluatedAt:initializedAt,decision,writeFree:true,attempts:[],plannerPlans:[],counts:{active:0,running:0,terminal:0,orphaned:0,"expired-lease":0,replayable:0},evidence:["bootstrap:read-only"]}}
function initialization(worker:ProductionWorkerLifecycle):ProductionRuntimeInitializationSuccess{return{schemaVersion:"1",ok:true,decision:"ready",reasonCode:"RUNTIME_INITIALIZED",initializedAt,writeFree:true,partialInitialization:false,projects:[],counts:{active:0,running:0,terminal:0,orphaned:0,"expired-lease":0,replayable:0},worker:worker.snapshot(),evidence:["runtime:ready"]}}

async function main(){let scenarios=0;const scenario=async(name:string,run:()=>unknown|Promise<unknown>)=>{await run();scenarios++;void name};
  const runtimeWorker=new ProductionWorkerLifecycle(),runtime=new ProductionRuntimeInitializer({now:()=>initializedAt,listProjectSlugs:async()=>["project-1"],createRecoveryBootstrap:()=>({bootstrapRecovery:async()=>bootstrap()}),workerLifecycle:runtimeWorker}),runtimeResult=await runtime.initialize();
  await scenario("successful startup reaches ready",()=>{assert.equal(runtimeResult.ok,true);assert.equal(runtimeWorker.snapshot().state,"ready");assert.equal(runtimeResult.worker.state,"ready")});

  const repeated=new ProductionWorkerLifecycle(),startOne=repeated.start({initialization:initialization(repeated)}),startTwo=repeated.start({initialization:initialization(repeated)});
  await scenario("repeated start is idempotent",async()=>{assert.strictEqual(startOne,startTwo);assert.equal((await startOne).reasonCode,"WORKER_LIFECYCLE_STARTED");assert.equal(repeated.snapshot().state,"ready")});

  const invalidWorker=new ProductionWorkerLifecycle(),invalidRuntime=await new ProductionRuntimeInitializer({now:()=>initializedAt,listProjectSlugs:async()=>["project-1"],createRecoveryBootstrap:()=>({bootstrapRecovery:async()=>bootstrap("indeterminate")}),workerLifecycle:invalidWorker}).initialize();
  await scenario("recovery validation failure never readies worker",()=>{assert.equal(invalidRuntime.ok,false);assert.equal(invalidRuntime.reasonCode,"RUNTIME_BOOTSTRAP_INVALID");assert.equal(invalidWorker.snapshot().state,"failed");assert.equal(invalidWorker.snapshot().acceptingExecutions,false)});

  const beforeReady=new ProductionWorkerLifecycle();let beforeCalled=false;
  await scenario("execution rejected before ready",async()=>{await assert.rejects(beforeReady.execute(async()=>{beforeCalled=true}),ProductionWorkerLifecycleExecutionRejectedError);assert.equal(beforeCalled,false);assert.equal(beforeReady.snapshot().activeExecutions,0)});
  let factoryHandlerCalled=false;const gatedExecutor=createProductionPipelineExecutionExecutor(beforeReady);
  await scenario("real factory path rejects before persistence preparation",async()=>{await assert.rejects(gatedExecutor.execute({projectSlug:"worker-lifecycle-gate",stage:"script",runType:"initial"},async()=>{factoryHandlerCalled=true;return true}),ProductionWorkerLifecycleExecutionRejectedError);assert.equal(factoryHandlerCalled,false)});

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

  await scenario("composition root shares central lifecycle",async()=>{const root=await fs.readFile("src/lib/runtime/ProductionRuntimeCompositionRoot.ts","utf8"),factory=await fs.readFile("src/lib/production/ProductionPipelineExecutionFactory.ts","utf8");assert.match(root,/workerLifecycle:\s*productionWorkerLifecycle/);assert.match(root,/configureProductionPipelineExecution\(\{ lifecycle: productionWorkerLifecycle \}\)/);assert.ok(factory.indexOf("lifecycle.execute")<factory.indexOf("prepareProductionPipelineExecution(context)"));assert.ok(!/PipelineQueueScheduler|SIGTERM|SIGINT|process\.on/.test(root+factory))});
  assert.equal(scenarios,16);console.log(`Sprint 110 production worker lifecycle smoke: PASS (${scenarios}/16 scenarios)`);
}
void main();
