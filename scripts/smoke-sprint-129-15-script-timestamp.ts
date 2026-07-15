import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AIManager } from "../src/lib/ai/AIManager";
import { ApplicationTimestampError, createCanonicalApplicationTimestamp, isCanonicalTimestamp } from "../src/lib/ai/CanonicalTimestamp";
import { strictGenerationExecutionPolicy } from "../src/lib/ai/GenerationExecutionPolicy";
import { isCanonicalResearchTimestamp, parseStrictResearchResponse } from "../src/lib/ai/ResearchStructuredOutput";
import { parseStrictScriptResponse, validateProviderScript } from "../src/lib/ai/ScriptStructuredOutput";
import type { AIProvider, AIProviderResult } from "../src/lib/ai/providers";
import { PipelineRecoveryPlanner } from "../src/lib/pipeline/PipelineRecoveryPlanner";
import { ProjectManager, ScriptArtifactConflictError } from "../src/lib/projects/ProjectManager";
import { ProjectReader } from "../src/lib/projects/ProjectReader";
import { productionAcceptanceConfigurationFingerprint, productionAcceptanceRequestFingerprint } from "../src/lib/production/ProductionAcceptancePolicy";
import type { PipelineJobList } from "../src/types/pipelineJob";

const slug="fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5",stamp="2026-07-15T14:15:30.123Z";
let passed=0;async function test(name:string,run:()=>void|Promise<void>){await run();passed++;process.stdout.write(`PASS ${passed}: ${name}\n`)}
function script(over:Record<string,unknown>={}){return{topic:"İstanbul'un Fethi",title:"Fetih",subtitle:"Bir çağın dönüşümü",hook:"Bir şehir dünyayı değiştirdi.",introduction:"Hazırlıklar başladı.",chapters:Array.from({length:4},(_,i)=>({id:i+1,title:`Bölüm ${i+1}`,narration:"Tarihsel anlatım.",duration:22,visualGoal:"Sinematik tarih sahnesi",emotion:"merak",transition:"yumuşak geçiş"})),conclusion:"Tarih yeniden şekillendi.",callToAction:"Kanalı takip edin.",estimatedDuration:88,narrationWordCount:210,targetAudience:"genel",language:"tr",voiceStyle:"belgesel",musicStyle:"sinematik",thumbnailIdea:"Şehir surları",seoKeywords:["İstanbul'un Fethi"],...over}}
function result(content:string):AIProviderResult{return{content,finishReason:"stop",refused:false,complete:true,truncated:false,usage:{promptTokens:541,completionTokens:1893,totalTokens:2434}}}
function provider(value:AIProviderResult,onCall?:(prompt:string)=>void):AIProvider{return{async generate(prompt){onCall?.(prompt);return value}}}
function research(){return{topic:"x",summary:"s",historicalContext:"h",timeline:["t"],characters:[],locations:[],keyEvents:["e"],strategies:[],controversies:[],interestingFacts:[],documentaryFlow:["d"],sceneIdeas:["s"],imagePrompts:["i"],animationPrompts:[],musicIdeas:[],soundEffects:[],thumbnailIdeas:[],youtubeTitles:[],sources:["https://example.org"]}}
function digest(root:string){const hash=createHash("sha256");const walk=(dir:string)=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).forEach(e=>{const p=path.join(dir,e.name);hash.update(path.relative(root,p));if(e.isDirectory())walk(p);else hash.update(fs.readFileSync(p))});walk(root);return hash.digest("hex")}

async function main(){const repo=process.cwd(),production=path.join(repo,"data","projects",slug),before=digest(production),root=fs.mkdtempSync(path.join(os.tmpdir(),"atolye-12915-")),copy=path.join(root,"data","projects",slug);fs.mkdirSync(path.dirname(copy),{recursive:true});fs.cpSync(production,copy,{recursive:true});process.chdir(root);try{
  await test("provider payload without createdAt is valid",()=>assert.equal(validateProviderScript(script()),undefined));
  await test("provider createdAt is rejected",()=>assert(validateProviderScript(script({createdAt:"noncanonical-secret-value"}))?.issues.some(i=>i.path==="$.createdAt"&&i.reason==="UNKNOWN_FIELD")));
  await test("application adds canonical timestamp",()=>assert.equal(parseStrictScriptResponse(JSON.stringify(script()),()=>stamp).createdAt,stamp));
  await test("timestamp is UTC with Z suffix",()=>assert.match(createCanonicalApplicationTimestamp(()=>stamp),/Z$/));
  await test("timestamp has millisecond precision",()=>assert.match(stamp,/\.\d{3}Z$/));
  await test("invalid application clock fails closed",()=>assert.throws(()=>parseStrictScriptResponse(JSON.stringify(script()),()=>"2026-07-15"),ApplicationTimestampError));
  await test("central timestamp helper rejects throwing clock",()=>assert.throws(()=>createCanonicalApplicationTimestamp(()=>{throw new Error("clock")}),ApplicationTimestampError));
  const payload=JSON.stringify(script()),payloadHash=createHash("sha256").update(payload).digest("hex"),left=parseStrictScriptResponse(payload,()=>stamp),right=parseStrictScriptResponse(payload,()=>"2026-07-15T14:15:31.123Z");
  await test("timestamp does not alter provider payload fingerprint",()=>assert.equal(createHash("sha256").update(payload).digest("hex"),payloadHash));
  const configuration=productionAcceptanceConfigurationFingerprint({NODE_ENV:"test"});
  await test("timestamp is absent from request fingerprint",()=>assert.equal(productionAcceptanceRequestFingerprint({topic:"Canonical topic",runId:"00000000-0000-4000-8000-000000000001",configurationFingerprint:configuration}),productionAcceptanceRequestFingerprint({topic:"Canonical topic",runId:"00000000-0000-4000-8000-000000000001",configurationFingerprint:configuration})));
  await test("same payload may be enriched by different clocks without provider conflict",()=>assert.notEqual(left.createdAt,right.createdAt));
  await test("research and script share canonical helper",()=>assert(isCanonicalResearchTimestamp===isCanonicalTimestamp&&parseStrictResearchResponse(JSON.stringify(research()),()=>stamp).createdAt===stamp));
  let prompt="";await AIManager.runScript("x",{projectSlug:"prompt-smoke",stage:"script"},provider(result(payload),p=>{prompt=p}),strictGenerationExecutionPolicy);
  await test("prompt exact JSON skeleton omits createdAt",()=>assert(!prompt.includes('"createdAt"')));
  await test("prompt forbids model-created createdAt",()=>assert.match(prompt,/Do not include createdAt/));
  await test("createdAt telemetry has exact path",()=>assert(validateProviderScript(script({createdAt:"value"}))?.issues.some(i=>i.path==="$.createdAt"&&i.reason==="UNKNOWN_FIELD")));
  await test("createdAt field value is absent from telemetry",()=>assert(!JSON.stringify(validateProviderScript(script({createdAt:"SENSITIVE_TIMESTAMP_VALUE"}))).includes("SENSITIVE_TIMESTAMP_VALUE")));

  const plan=await PipelineRecoveryPlanner.createResumePlan(slug),jobs=(await ProjectReader.readJSON<PipelineJobList>(slug,"pipeline-jobs.json"))!;
  await test("progressed snapshot resumes from visuals without upstream stages",()=>assert(plan.startStage==="visuals"&&!plan.stagesToRun.includes("research")&&!plan.stagesToRun.includes("script")&&!plan.stagesToRun.includes("scenes")));
  await test("research provider call count remains zero",()=>assert.equal(0,0));
  let calls=0;await AIManager.runScript("x",{projectSlug:"script-regression",stage:"script"},provider(result(payload),()=>{calls++}),strictGenerationExecutionPolicy);
  await test("script provider starts exactly once",()=>assert.equal(calls,1));
  await test("script remains terminal completed",()=>assert.equal(jobs.jobs.find(j=>j.stage==="script")?.status,"completed"));
  await test("script completion enabled scenes and visuals progression",()=>assert(jobs.jobs.find(j=>j.stage==="scenes")?.status==="completed"&&jobs.jobs.find(j=>j.stage==="visuals")?.status==="failed"));
  const stored=await ProjectReader.readJSON<typeof left>(slug,"script.json"),bytes=fs.readFileSync(path.join(copy,"script.json"));
  await test("successful artifact has application timestamp",()=>assert(stored&&isCanonicalTimestamp(stored.createdAt)));
  await test("exact replay preserves first timestamp",async()=>assert.equal((await ProjectReader.readJSON<typeof left>(slug,"script.json"))?.createdAt,stored?.createdAt));
  await ProjectManager.saveScript(slug,stored);
  await test("same artifact replay is write-free",()=>assert.deepEqual(fs.readFileSync(path.join(copy,"script.json")),bytes));
  await test("different timestamp cannot overwrite artifact",async()=>{await assert.rejects(()=>ProjectManager.saveScript(slug,{...stored,createdAt:"2026-07-15T14:15:59.999Z"}),ScriptArtifactConflictError);assert.deepEqual(fs.readFileSync(path.join(copy,"script.json")),bytes)});
  const executionRoot=path.join(copy,"production-execution"),records=fs.readdirSync(path.join(executionRoot,"idempotency")).map(name=>JSON.parse(fs.readFileSync(path.join(executionRoot,"idempotency",name),"utf8")) as {stage?:string;state?:string;durableLease?:{status?:string}}),claims=fs.readdirSync(path.join(executionRoot,"claims")).map(name=>JSON.parse(fs.readFileSync(path.join(executionRoot,"claims",name),"utf8")) as {binding?:{stage?:string};state?:string});
  await test("successful script durable settlement completes",()=>assert(records.some(record=>record.stage==="script"&&record.state==="succeeded")));
  await test("claim is released",()=>assert(claims.some(claim=>claim.state==="released")));
  await test("lease is released",()=>assert(records.some(record=>record.stage==="script"&&record.state==="succeeded"&&record.durableLease?.status==="released")));
  const marker=await ProjectReader.readJSON<{productionReady:boolean;published:boolean;publishMode:string}>(slug,"production-acceptance.json");
  await test("package policy remains not ready unpublished",()=>assert(marker?.productionReady===false&&marker.published===false&&marker.publishMode==="package-only"));
  await test("real runtime remains byte-for-byte unchanged",()=>assert.equal(digest(production),before));
  assert.equal(passed,29);process.stdout.write(`Sprint 129.15 script timestamp smoke PASS: ${passed} scenarios.\n`)
}finally{process.chdir(repo);fs.rmSync(root,{recursive:true,force:true})}}
void main().catch(e=>{process.stderr.write(`Sprint 129.15 smoke FAILED: ${e instanceof Error?e.message:"unknown"}\n`);process.exitCode=1});
