/** Load-valid independent violations must reach named assertions. A runtime/import failure never counts. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-business-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
  if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const base=m[1]!.startsWith("@/")?path.join(repo,"src",m[1]!.slice(2)):path.resolve(path.dirname(path.join(repo,file)),m[1]!);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const memory="src/lib/ayas/revenue/AyasRevenueMemory.ts",temporal="src/lib/ayas/revenue/AyasRevenueTemporal.ts",intelligence="src/lib/ayas/revenue/AyasRevenueIntelligence.ts",context="src/lib/ayas/revenue/AyasRevenueContext.ts";
const memoryGrader="scripts/smoke-ayas-revenue-memory.ts",intelligenceGrader="scripts/smoke-ayas-revenue-intelligence.ts";
const controls:readonly(readonly[string,string,string,string,string,string])[]=[
 ["owner review receipt ignored",memory,'||!isAyasRevenueDigest(raw.reviewEvidenceDigest)','',memoryGrader,'P31'],
 ["future observation accepted",memory,'||Date.parse(raw.observedAt)>Date.parse(recordedAt)','',memoryGrader,'P32'],
 ["duplicate event overwrites material",memory,'if(digestAyasRevenueData(inputOf(previous))!==digestAyasRevenueData(inputOf(candidate)))','if(false)',memoryGrader,'P51'],
 ["memory identity not checked",memory,'item.recordId!==expected.recordId||','',memoryGrader,'P54'],
 ["foreign slot admitted",memory,'item.factKey!==expected.factKey||','',memoryGrader,'P53'],
 ["model correction overrides owner",memory,'||ayasRevenueFactTrust(candidate.factClass)<ayasRevenueFactTrust(target.factClass)','',memoryGrader,'H10'],
 ["source rank inverted",temporal,'Math.max(...eligible.map(v=>ayasRevenueFactTrust(v.factClass)))','Math.min(...eligible.map(v=>ayasRevenueFactTrust(v.factClass)))',memoryGrader,'P41'],
 ["future version made current",temporal,'Date.parse(v.effectiveFrom)<=at','true',memoryGrader,'P44'],
 ["disputed current accepted",temporal,'values.size>1?"disputed":','false?"disputed":',memoryGrader,'P42'],
 ["closed offer resurrected",intelligence,'&&!closed.has(v.offerDigest)&&','&&',intelligenceGrader,'P06'],
 ["model plan owner-promoted",intelligence,'&&v.factClass==="OWNER_DECISION"','',intelligenceGrader,'P05'],
 ["ledger reference mismatch hidden",intelligence,'v.ledgerRef.digest!==ledgerDigest||v.ledgerRef.revision!==state.revision','false',intelligenceGrader,'P14'],
 ["stale plan masked by fresh ledger",intelligence,'||current.some(v=>known-Date.parse(v.observedAt)>7*86400000)','',intelligenceGrader,'P23'],
 ["known-at ignored",intelligence,'Date.parse(v.recordedAt)<=known&&','',intelligenceGrader,'H02'],
 ["context made authoritative",context,'grantsAuthority:false','grantsAuthority:true',intelligenceGrader,'P25'],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string)=>spawnSync(process.execPath,["--import","tsx",script],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try{
  copy(memoryGrader);copy(intelligenceGrader);copy("src/lib/ayas/AyasChatStream.ts");copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  for(const grader of [memoryGrader,intelligenceGrader]){const r=run(grader);assert.equal(r.status,0,r.stderr+r.stdout);}
  for(const [name,file,before,after,grader,caseId]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": exact mutation");let r:ReturnType<typeof run>;
    try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader);}finally{fs.writeFileSync(target,original);}
    assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/);assert.match(r.stderr,new RegExp("(?:^|\\n)"+caseId+":"),name+": named assertion missing");
    const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.ok(result.results.some((v:{id:string;ok:boolean})=>v.id===caseId&&!v.ok));rows.push({name,assertion:caseId,status:"ASSERTION_CAUGHT"});
  }
  for(const grader of [memoryGrader,intelligenceGrader])assert.equal(run(grader).status,0);
  console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",fixture:"GITLESS_TEMP_NO_AUTHORITY_OR_LIVE_DATA",rows}));
}finally{const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-business-controls-"));fs.rmSync(temp,{recursive:true,force:true});}
