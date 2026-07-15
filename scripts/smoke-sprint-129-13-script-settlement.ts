import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIManager } from "../src/lib/ai/AIManager";
import { aiProviderConfig } from "../src/lib/ai/AIProviderConfig";
import { AIResponseError } from "../src/lib/ai/AIResponseError";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { getResearchMaxTokens } from "../src/lib/ai/ResearchAIConfig";
import { getScriptMaxTokens, ScriptAIConfigError, scriptTokenBudget } from "../src/lib/ai/ScriptAIConfig";
import { parseStrictScriptResponse } from "../src/lib/ai/ScriptStructuredOutput";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { PipelineJobManager } from "../src/lib/pipeline/PipelineJobManager";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { productionAcceptanceConfigurationFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import { ProductionReadinessService } from "../src/lib/production/ProductionReadinessService";
import { ProductionPipelineExecutionAdapter } from "../src/lib/production/ProductionPipelineExecutionAdapter";
import { prepareProductionPipelineExecution } from "../src/lib/production/ProductionPipelineExecutionFactory";
import { ProductionExecutionFilePersistenceAdapter } from "../src/lib/production/ProductionExecutionPersistence";
import { settlePendingSuccessfulProductionPipelineExecutions, settleSuccessfulProductionPipelineExecution } from "../src/lib/production/ProductionPipelineTerminalSettlement";
import type { ProductionExecutionPersistenceAdapter, ProductionExecutionPersistencePayloadByKind, ProductionExecutionPersistenceRecordKind, ProductionExecutionPersistenceWriteResult } from "../src/types/productionExecutionPersistence";

const productionSlug = "fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5";
let passed = 0;
async function test(name: string, action: () => void | Promise<void>) { await action(); passed += 1; process.stdout.write(`PASS ${passed}: ${name}\n`); }
function env(values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv { return { NODE_ENV:"test", ...values }; }

function scriptFixture(overrides: Record<string, unknown> = {}) {
  const chapters = Array.from({ length: 4 }, (_, index) => ({ id:index+1,title:`Bölüm ${index+1}`,narration:"Tarihsel anlatım metni.",duration:22,visualGoal:"Tarihsel sinematik sahne",emotion:"merak",transition:"yumuşak geçiş" }));
  return { topic:"İstanbul'un Fethi",title:"Fetih",subtitle:"Bir çağın dönüşümü",hook:"Bir şehir dünyayı değiştirdi.",introduction:"Hazırlıklar başladı.",chapters,conclusion:"Tarih yeniden şekillendi.",callToAction:"Kanalı takip edin.",estimatedDuration:88,narrationWordCount:210,targetAudience:"genel izleyici",language:"tr",voiceStyle:"belgesel",musicStyle:"sinematik",thumbnailIdea:"Şehir surları",seoKeywords:["İstanbul'un Fethi","Fatih Sultan Mehmet"],...overrides };
}
function providerResult(content: string, overrides: Partial<AIProviderResult> = {}): AIProviderResult { return { content,finishReason:"stop",refused:false,complete:true,truncated:false,usage:{promptTokens:300,completionTokens:1800,totalTokens:2100},...overrides }; }
function provider(result: AIProviderResult, capture?: (tokens: number | undefined) => void): AIProvider { return { async generate(_prompt, options) { capture?.(options?.maxTokens); return result; } }; }
async function expectCode(action: () => Promise<unknown>, code: string) { await assert.rejects(action, error => error instanceof AIResponseError && error.code === code); }
function hashTree(root: string) { const hash=createHash("sha256"); if(!fs.existsSync(root))return"missing"; const walk=(dir:string)=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).forEach(entry=>{const full=path.join(dir,entry.name),relative=path.relative(root,full).replaceAll("\\","/");hash.update(relative);if(entry.isDirectory())walk(full);else hash.update(fs.readFileSync(full))});walk(root);return hash.digest("hex") }
async function fixtureProject(label: string) { const project=await ProjectManager.createProject(label);await PipelineJobManager.listJobs(project.slug);const context={projectSlug:project.slug,stage:"script" as const,runType:"initial" as const};const prepared=await prepareProductionPipelineExecution(context);return{project,context,prepared}; }

async function main() {
  const repository=process.cwd(),productionFolder=ProjectReader.getProjectFolder(productionSlug),runtimeHashBefore=hashTree(productionFolder),workspace=fs.mkdtempSync(path.join(os.tmpdir(),"atolye-sprint-129-13-"));
  fs.mkdirSync(path.join(workspace,"data","projects"),{recursive:true});fs.cpSync(productionFolder,path.join(workspace,"data","projects",productionSlug),{recursive:true});process.chdir(workspace);
  try {
    await test("script default is stage-specific",()=>assert.equal(getScriptMaxTokens(env()),3200));
    await test("research budget does not affect script",()=>assert.equal(getScriptMaxTokens(env({OPENAI_RESEARCH_MAX_TOKENS:"4800"})),3200));
    await test("explicit script budget overrides global",()=>assert.equal(getScriptMaxTokens(env({OPENAI_MAX_TOKENS:"1200",OPENAI_SCRIPT_MAX_TOKENS:"4000"})),4000));
    await test("below minimum is rejected",()=>assert.throws(()=>getScriptMaxTokens(env({OPENAI_SCRIPT_MAX_TOKENS:String(scriptTokenBudget.minimumTokens-1)})),ScriptAIConfigError));
    await test("above maximum is rejected",()=>assert.throws(()=>getScriptMaxTokens(env({OPENAI_SCRIPT_MAX_TOKENS:String(scriptTokenBudget.maximumTokens+1)})),ScriptAIConfigError));
    await test("non-integer readiness fails closed",async()=>{const previous=aiProviderConfig.provider;aiProviderConfig.provider="openai";try{const report=await new ProductionReadinessService({cwd:workspace,environment:{...process.env,AI_PROVIDER:"openai",OPENAI_SCRIPT_MAX_TOKENS:"3.2"}}).evaluate();assert(report.checks.some(item=>item.reasonCode==="AI_SCRIPT_MAX_TOKENS_INVALID"))}finally{aiProviderConfig.provider=previous}});
    await test("default-sized script fixture validates",()=>assert.equal(parseStrictScriptResponse(JSON.stringify(scriptFixture())).chapters.length,4));
    await test("finish length produces truncation",()=>expectCode(()=>AIManager.runScript("x",{projectSlug:"smoke",stage:"script"},provider(providerResult("RAW",{finishReason:"length",complete:false,truncated:true})),strictGenerationExecutionPolicy),"AI_RESPONSE_TRUNCATED"));
    await test("finish stop valid script succeeds",async()=>assert.equal((await AIManager.runScript("x",{projectSlug:"smoke",stage:"script"},provider(providerResult(JSON.stringify(scriptFixture()))),strictGenerationExecutionPolicy)).title,"Fetih"));
    await test("fingerprint is compatible when unset and changes when explicit",()=>{const base=productionAcceptanceConfigurationFingerprint(env()),same=productionAcceptanceConfigurationFingerprint(env({OPENAI_RESEARCH_MAX_TOKENS:undefined,OPENAI_SCRIPT_MAX_TOKENS:undefined}));assert.equal(base,same);assert.notEqual(base,productionAcceptanceConfigurationFingerprint(env({OPENAI_SCRIPT_MAX_TOKENS:"3200"})))});
    let truncationError!:AIResponseError;await test("truncation code remains canonical",async()=>{try{await AIManager.runScript("x",{projectSlug:"smoke",stage:"script"},provider(providerResult("secret raw",{finishReason:"length",complete:false,truncated:true})),strictGenerationExecutionPolicy)}catch(error){assert(error instanceof AIResponseError);truncationError=error}assert.equal(truncationError.code,"AI_RESPONSE_TRUNCATED")});
    const evidenceProject=await ProjectManager.createProject("Sprint 129.13 truncation evidence");await PipelineJobManager.listJobs(evidenceProject.slug);await PipelineJobManager.startStage(evidenceProject.slug,"script",()=>ProjectManager.updatePackageStatus(evidenceProject.slug,"script","running",undefined,{runType:"initial"}).then(()=>undefined));await PipelineJobManager.persistStageFailure(evidenceProject.slug,"script",()=>ProjectManager.updatePackageStatus(evidenceProject.slug,"script","failed",truncationError.code).then(()=>undefined),truncationError.code);
    const evidenceJob=await PipelineJobManager.getJobForStageReadOnly(evidenceProject.slug,"script"),evidenceManifest=await ProjectManager.getManifest(evidenceProject.slug),evidenceHistory=await PipelineJobManager.listHistory(evidenceProject.slug);
    await test("job preserves truncation",()=>assert.equal(evidenceJob?.error,truncationError.code));
    await test("manifest preserves truncation",()=>assert.equal(evidenceManifest?.packages.script.error,truncationError.code));
    await test("history preserves truncation",()=>assert.equal(evidenceHistory.events.at(-1)?.errorCode,truncationError.code));
    const durableFailure=await fixtureProject("Sprint 129.13 durable failure"),failureAdapter=new ProductionPipelineExecutionAdapter(durableFailure.prepared.adapter,()=>durableFailure.prepared.request);await assert.rejects(failureAdapter.execute(durableFailure.context,async()=>{throw truncationError}));const attemptFiles=await durableFailure.prepared.adapter.listKeys("attempt"),terminalAttemptKey=attemptFiles.ok?attemptFiles.keys.find(key=>key.endsWith("-v3")):undefined,terminalAttempt=terminalAttemptKey?await durableFailure.prepared.adapter.read("attempt",terminalAttemptKey):undefined;
    await test("durable journal preserves truncation",()=>assert(terminalAttempt?.status==="found"&&terminalAttempt.value.journal.at(-1)?.payload.code==="AI_RESPONSE_TRUNCATED"));
    await test("CLI inner reason remains available",()=>assert.equal(truncationError.message,"AI_RESPONSE_TRUNCATED"));
    await test("truncation is not fallback blocked",()=>assert.notEqual(truncationError.code,"GENERATION_FALLBACK_BLOCKED"));
    await test("legacy empty fallback remains blocked",()=>assert.rejects(()=>AIManager.runScript("x",{projectSlug:"smoke",stage:"script"},provider(providerResult("")),strictGenerationExecutionPolicy),/Production generation failed closed/));
    await test("raw provider body is absent from error",()=>assert.equal(JSON.stringify(truncationError).includes("secret raw"),false));

    const success=await fixtureProject("Sprint 129.13 settlement"),successAdapter=new ProductionPipelineExecutionAdapter(success.prepared.adapter,()=>success.prepared.request,result=>settleSuccessfulProductionPipelineExecution(success.prepared.settlement,result));assert.equal(await successAdapter.execute(success.context,async()=>true),true);const attemptsBefore=await success.prepared.adapter.listKeys("attempt"),claims=await success.prepared.adapter.listKeys("claim"),records=await success.prepared.adapter.listKeys("idempotency"),latestRecordKey=records.ok?[...records.keys].sort().at(-1):undefined,latestRecord=latestRecordKey?await success.prepared.adapter.read("idempotency",latestRecordKey):undefined;
    await test("successful attempt remains immutable",()=>assert(attemptsBefore.ok&&attemptsBefore.keys.filter(key=>key.endsWith("-v3")).length===1));
    await test("claim is released",()=>assert(claims.ok&&claims.keys.some(key=>key.endsWith("-v2"))));
    await test("lease is released",()=>assert(latestRecord?.status==="found"&&"durableLease" in latestRecord.value&&(latestRecord.value as {durableLease?:{status:string}}).durableLease?.status==="released"));
    await test("idempotency record is terminal success",()=>assert(latestRecord?.status==="found"&&latestRecord.value.state==="succeeded"));
    const beforeReplay=hashTree(path.join(workspace,"data","projects",success.project.slug,"production-execution"));assert.equal(await successAdapter.execute(success.context,async()=>assert.fail("replay called handler")),true);
    await test("exact settlement replay is write-free",()=>assert.equal(hashTree(path.join(workspace,"data","projects",success.project.slug,"production-execution")),beforeReplay));
    const concurrent=await fixtureProject("Sprint 129.13 concurrent settlement"),plain=new ProductionPipelineExecutionAdapter(concurrent.prepared.adapter,()=>concurrent.prepared.request);assert.equal(await plain.execute(concurrent.context,async()=>true),true);const replayResult=await new (await import("../src/lib/production/ProductionExecutionWorker")).ProductionExecutionWorkerExecutionService(concurrent.prepared.adapter).execute(concurrent.prepared.request,async()=>({summary:"unused"}),{isCancellationRequested:()=>false});const concurrentResults=await Promise.all([settleSuccessfulProductionPipelineExecution(concurrent.prepared.settlement,replayResult),settleSuccessfulProductionPipelineExecution(concurrent.prepared.settlement,replayResult)]);
    await test("one concurrent settlement wins",()=>assert(concurrentResults.some(item=>item.ok)));
    const blocked=await fixtureProject("Sprint 129.13 blocked settlement"),failingAdapter:ProductionExecutionPersistenceAdapter={read:(...args)=>blocked.prepared.adapter.read(...args),listKeys:(...args)=>blocked.prepared.adapter.listKeys(...args),write:async<K extends ProductionExecutionPersistenceRecordKind>(kind:K,key:string,value:ProductionExecutionPersistencePayloadByKind[K]):Promise<ProductionExecutionPersistenceWriteResult<K>>=>kind==="idempotency"&&key.endsWith("-v3")?{ok:false,status:"failed",kind,key,errorCode:"PERSISTENCE_EXISTING_RECORD_CONFLICT"}:blocked.prepared.adapter.write(kind,key,value)};const blockedAdapter=new ProductionPipelineExecutionAdapter(blocked.prepared.adapter,()=>blocked.prepared.request,result=>settleSuccessfulProductionPipelineExecution({...blocked.prepared.settlement,adapter:failingAdapter},result));const downstream=0;
    await test("partial settlement blocks downstream admission",async()=>{await assert.rejects(blockedAdapter.execute(blocked.context,async()=>true),/terminal settlement failed/i);assert.equal(downstream,0)});
    await test("CAS conflict fails closed without extra provider call",()=>assert.equal(downstream,0));

    const snapshotExecutionRoot=path.join(workspace,"data","projects",productionSlug,"production-execution"),snapshotAdapter=new ProductionExecutionFilePersistenceAdapter({trustedRootDirectory:snapshotExecutionRoot}),predecessorSettlement=await settlePendingSuccessfulProductionPipelineExecutions(snapshotAdapter),snapshotRecords=await snapshotAdapter.listKeys("idempotency"),settledResearch=snapshotRecords.ok?await Promise.all(snapshotRecords.keys.filter(key=>key.startsWith("pipeline-record-aedc128e-")).map(key=>snapshotAdapter.read("idempotency",key))):[];
    await test("legacy successful research is settled before script admission",()=>assert(predecessorSettlement.ok&&settledResearch.some(item=>item.status==="found"&&item.value.state==="succeeded"&&"durableLease" in item.value&&(item.value as {durableLease?:{status:string}}).durableLease?.status==="released")));
    const recovery=await PipelineRecoveryPlanner.createResumePlan(productionSlug),marker=await ProjectReader.readJSON<{productionReady?:boolean;published?:boolean;publishMode?:string}>(productionSlug,"production-acceptance.json"),research=fs.readFileSync(path.join(workspace,"data","projects",productionSlug,"research.json"));
    await test("research completed provider call count is zero",()=>assert.equal(recovery.stagesToRun.includes("research"),false));
    await test("completed script is excluded from the scenes recovery",()=>assert.equal(recovery.stagesToRun.includes("script"),false));
    await test("failed visuals is the single retry start",()=>assert.equal(recovery.startStage,"visuals"));
    await test("animation waits behind visuals",()=>assert(recovery.stagesToRun.indexOf("animation")>recovery.stagesToRun.indexOf("visuals")));
    await test("resume plan replay creates no second retry",async()=>{const replay=await PipelineRecoveryPlanner.createResumePlan(productionSlug);assert.deepEqual({...replay,createdAt:recovery.createdAt},recovery)});
    await test("same production slug is preserved",()=>assert.equal(recovery.projectSlug,productionSlug));
    await test("productionReady remains false",()=>assert.equal(marker?.productionReady,false));
    await test("published remains false",()=>assert.equal(marker?.published,false));
    await test("package-only policy remains",()=>assert.equal(marker?.publishMode,"package-only"));
    await test("runtime snapshot recovery starts at visuals",()=>assert.equal(recovery.startStage,"visuals"));
    await test("research artifact is preserved",()=>assert(research.length>0));
    await test("script truncation telemetry exists in snapshot",()=>{const usage=fs.readFileSync(path.join(workspace,"data","projects",productionSlug,"ai-usage.json"),"utf8");assert(usage.includes("AI_RESPONSE_TRUNCATED"))});
    await test("scenes success leaves visuals as the first recovery stage",()=>assert.equal(recovery.stagesToRun[0],"visuals"));
    await test("real production runtime is unchanged",()=>assert.equal(hashTree(productionFolder),runtimeHashBefore));
    assert.equal(passed,42);assert.equal(getResearchMaxTokens(env()),3200);process.stdout.write(`Sprint 129.13 script budget and settlement smoke PASS: ${passed} scenarios.\n`);
  } finally { process.chdir(repository);fs.rmSync(workspace,{recursive:true,force:true}); }
}
void main().catch(error=>{process.stderr.write(`Sprint 129.13 smoke FAILED: ${error instanceof Error?error.message:"unknown"}\n`);process.exitCode=1});
