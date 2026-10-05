/** Isolated assertion-caught CF49 controls. No remote, model, credentials or live stores. */
import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";import {spawnSync} from "node:child_process";
const sourceRoot=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),"ayas-cf49-mutations-"));
const file="src/lib/ayas/memory/AyasMemoryTemporal.ts",original=fs.readFileSync(path.join(sourceRoot,file),"utf8");
const mutations=[
  ["KEYLESS_V2_GAP",' || derived?.key === "user.decision.computer-purchase-plan"',""],
  ["UNTRUSTED_DERIVATION",') && isAuthoritative(record) ? derived : null;',') ? derived : null;'],
  ["FORGED_VALUE",'derived.value === factValue','true'],
  ["UNBOUND_COMPUTER_METADATA",'factKey !== "user.decision.render-tool" && factKey !== "user.decision.computer-purchase-plan"','factKey !== "user.decision.render-tool"'],
  ["NEGATED_PURCHASE",'karar verdim$/.test(value)','karar\\b/.test(value)'],
  ["QUESTION_AS_DECISION",'if (!purchaseDecision || indirect) return null;','if (!purchaseDecision) return null;'],
  ["FUTURE_SUPERSESSION",'if (assertion !== "current") {','if (assertion === "historical") {'],
  ["OLDER_WINS",'Date.parse(left.observedAt) - Date.parse(right.observedAt) || left.recordId.localeCompare(right.recordId)','Date.parse(right.observedAt) - Date.parse(left.observedAt) || left.recordId.localeCompare(right.recordId)'],
  ["TIE_NOT_DISPUTED",'if (last && last.observedMs === observedMs) {','if (false) {'],
  ["WRONG_PURCHASE_OBJECT",'if (!purchaseDecision || indirect) return null;','if (!/\\b(?:almaya|toplamaya|kurmaya) karar verdim$/.test(value) || indirect) return null;'],
  ["UNTRUSTED_LEGACY",'return derived?.key === "user.decision.computer-purchase-plan" && !isAuthoritative(record) ? null : derived;','return derived;'],
  ["QUOTED_DECISION",'const quoted = /(?:^|[^\\p{L}\\p{N}])[\'‘’]|[\'‘’](?:$|[^\\p{L}\\p{N}])/u.test(input.body);','const quoted = false;'],
] as const;
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const results:{id:string;caught:boolean;assertionCases:string[]}[]=[];
function run(script="scripts/smoke-ayas-cf49-remediation.ts",args:string[]=[]){const r=spawnSync(process.execPath,["--import","tsx",script,...args],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:200000});assert.ok(!r.error,"CONTROL_EXECUTION_ERROR");const row=r.stdout.trim().split(/\r?\n/).map(x=>{try{return JSON.parse(x);}catch{return null;}}).find(x=>x?.results);assert.ok(row,"CONTROL_REPORT_MISSING");return {run:r,row};}
try{
  for(const dir of ["src","app","scripts"])fs.cpSync(path.join(sourceRoot,dir),path.join(temp,dir),{recursive:true});
  for(const f of ["tsconfig.json","package.json"])fs.copyFileSync(path.join(sourceRoot,f),path.join(temp,f));
  fs.symlinkSync(path.join(sourceRoot,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  const baseline=run();assert.equal(baseline.run.status,0);assert.equal(baseline.row.status,"PASS");
  const reviewed=run("scripts/smoke-ayas-cf49-frozen-review.ts",["--scope-only"]);assert.equal(reviewed.run.status,0);
  for(const [id,from,to] of mutations){assert.equal(original.split(from).length,2,"MUTATION_ANCHOR_NOT_UNIQUE:"+id);fs.writeFileSync(path.join(temp,file),original.replace(from,to));const r=run(),failed=r.row.results.filter((x:{ok:boolean;failureKind?:string})=>!x.ok);
    const review=run("scripts/smoke-ayas-cf49-frozen-review.ts",["--scope-only"]),reviewFailed=review.row.results.filter((x:{ok:boolean})=>!x.ok);
    if(id==="WRONG_PURCHASE_OBJECT")assert.equal(reviewFailed.length,12,"ALL_FROZEN_CASES_CATCH_SCOPE_WIDENING");
    else {assert.ok(failed.length&&failed.every((x:{failureKind:string})=>x.failureKind==="ASSERTION"),"NOT_ASSERTION_CAUGHT:"+id);assert.equal(r.run.status,1);}
    if(id==="KEYLESS_V2_GAP")assert.equal(reviewFailed.length,12,"ALL_FROZEN_CASES_DEPEND_ON_READER_FIX");
    results.push({id,caught:true,assertionCases:[...failed.map((x:{id:string})=>x.id),...reviewFailed.map((x:{id:string})=>x.id)]});}
  fs.writeFileSync(path.join(temp,file),original);assert.equal(run().run.status,0);assert.equal(run("scripts/smoke-ayas-cf49-frozen-review.ts",["--scope-only"]).run.status,0);
  assert.equal(fs.readFileSync(path.join(sourceRoot,file),"utf8"),original);
  console.log(JSON.stringify({status:"PASS",controls:results.length,caught:results.length,fixture:"EXPLICIT_TEMP_NO_REMOTE_NETWORK_MODEL_OR_CREDENTIAL_ENV",results}));
}finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.ok(path.basename(temp).startsWith("ayas-cf49-mutations-"));fs.rmSync(temp,{recursive:true,force:true});}
