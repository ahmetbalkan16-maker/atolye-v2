/** Independent load-valid policy faults; named assertions in an owned gitless TEMP projection. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-closure-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
  if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const dep=m[1]!,base=dep.startsWith("@/")?path.join(repo,"src",dep.slice(2)):path.resolve(path.dirname(path.join(repo,file)),dep);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const model="src/lib/ayas/revenue/activity/AyasRevenueCenterClosure.ts",report="src/lib/ayas/revenue/activity/AyasRevenueActivityReport.ts",activity="src/lib/ayas/revenue/activity/AyasRevenueActivity.ts",safe="src/lib/ayas/safety/AyasSafeModeStore.ts",grader="scripts/smoke-ayas-revenue-center-closure.ts",held="scripts/adversarial-ayas-revenue-center-closure.ts";
const controls:readonly(readonly[string,string,string,string,string])[]=[
 ["profit omitted platform fee", "src/lib/ayas/revenue/AyasRevenueEconomics.ts", "[platformFeesMinor, paymentProcessingFeesMinor, variableDeliveryCostMinor, adSpendMinor, otherCostMinor]", "[paymentProcessingFeesMinor, variableDeliveryCostMinor, adSpendMinor, otherCostMinor]", "P003"],
 ["unknown fee assumed complete", "src/lib/ayas/revenue/AyasRevenueEconomics.ts", "incompleteEvidence ? null : observedContributionProfitMinor", "observedContributionProfitMinor", "P006"],
 ["connected activity requirement removed", report, 'a.connection === "CONNECTED" && records.length === 0', 'false', "P010"],
 ["account head binding removed", report, 'a.activityHeadDigest !== (records.at(-1)?.recordDigest ?? null)', 'false', "P011"],
 ["chain tampering accepted", activity, 'recordDigest !== hash(material)', 'false', "P016"],
 ["future observation allowed", report, 'Date.parse(v.observedAt) > Date.parse(now)', 'false', "P021"],
 ["expired source accepted", report, 'Date.parse(v.freshUntil) <= Date.parse(now)', 'false', "P022"],
 ["fixture discharges live debt", model, '!['+'"LIVE_READ_ONLY", "OWNER_WRITE_VALIDATION"].includes(r.evidenceKind as string)', '!['+'"DETERMINISTIC_TEST", "LIVE_READ_ONLY", "OWNER_WRITE_VALIDATION"].includes(r.evidenceKind as string)', "P024"],
 ["major ignored", model, 'f.unresolvedMajors !== 0', 'false', "P025"],
 ["spend default ignored", model, 'd.autonomousSpend !== 0', 'false', "P026"],
 ["stale graph ignored", model, 'g.stale !== false', 'false', "P028"],
 ["graph corruption ignored", model, 'g.integrityViolations !== 0', 'false', "P029"],
 ["relative safe root accepted", safe, '|| !path.isAbsolute(input.repoRoot)', '', "P125"],
 ["late old event hides owner gate", report, 'activity.records.slice().sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.sequence-b.sequence)', 'activity.records', "P126"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string,args:string[]=[])=>spawnSync(process.execPath,["--import","tsx",script,...args],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try{
  copy(grader);copy(held);copy("app/brain/revenue/page.tsx");copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  for(const script of [grader,held]){const r=run(script);assert.equal(r.status,0,r.stdout+r.stderr);}
  for(const [name,file,before,after,id]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;
    try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader,["--case",id]);}finally{fs.writeFileSync(target,original);}
    assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function|Cannot read properties/);
    const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.equal(result.completePrimary,false);assert.equal(result.primary.total,1);assert.doesNotMatch(JSON.stringify(result.results),/Cannot read properties|is not a function|is not defined/);assert.deepEqual(result.results.map((v:{id:string;ok:boolean})=>({id:v.id,ok:v.ok})),[{id,ok:false}]);rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
  }
  for(const script of [grader,held])assert.equal(run(script).status,0);console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
}finally{const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-closure-controls-"));fs.rmSync(temp,{recursive:true,force:true});}
