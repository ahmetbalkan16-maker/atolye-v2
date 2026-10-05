/** Independent load-valid policy faults; named assertions in an owned gitless TEMP projection. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-scaling-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
  if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const dep=m[1]!,base=dep.startsWith("@/")?path.join(repo,"src",dep.slice(2)):path.resolve(path.dirname(path.join(repo,file)),dep);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const model="src/lib/ayas/revenue/scaling/AyasRevenueScaling.ts",policy="src/lib/ayas/revenue/scaling/AyasRevenueScalingPolicy.ts",grader="scripts/smoke-ayas-revenue-profit-gated-scaling.ts",held="scripts/adversarial-ayas-revenue-profit-gated-scaling.ts";
const controls:readonly(readonly[string,string,string,string,string])[]=[
  ["two times ceiling removed",policy,"BigInt(v.proposedLevel) > BigInt(v.currentLevel) * BigInt(2)","false","P10"],
  ["metric minimum removed",policy,"r.metricFloorBps === 0","false","P71"],
  ["single pilot treated as repetition",model,'repeatCount < (q.intent === "BROADER_CHANNEL" ? 3 : 2)',"false","P05"],
  ["broader channel treated as two windows",model,'q.intent === "BROADER_CHANNEL" ? 3 : 2',"2","P07"],
  ["prior loss discarded",model,'return done("ECONOMICS_BLOCKED", "PRIOR_LOSS_RETAINED");','void 0;',"P30"],
  ["security state ignored",model,'ready.security !== "CLEAR" || ',"","P35"],
  ["delivery quality ignored",model,'ready.deliveryQuality !== "ACCEPTABLE" || ',"","P38"],
  ["support measurement ignored",model,'ready.supportMeasured !== true || ',"","P39"],
  ["capacity ceiling ignored",model,'q.proposedLevel > ready.maxLevel || ',"","P41"],
  ["refund bound ignored",model,'ready.refundRevenueBps > q.rollback.maxRefundRevenueBps || ',"","P43"],
  ["free first review ignored",model,'ready.freeFirstReview !== "REVIEWED" || ',"","P46"],
  ["paid candidate expiry ignored",model,'reinvestmentExpiresAt === null ? Infinity : Date.parse(reinvestmentExpiresAt)',"Infinity","P67"],
  ["plan manufactures spend authority",model,'grantsSpendAuthority: false as const','grantsSpendAuthority: true as const',"P62"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string,args:string[]=[])=>spawnSync(process.execPath,["--import","tsx",script,...args],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try{
  copy(grader);copy(held);copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  for(const script of [grader,held]){const r=run(script);assert.equal(r.status,0,r.stdout+r.stderr);}
  for(const [name,file,before,after,id]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;
    try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader,["--case",id]);}finally{fs.writeFileSync(target,original);}
    assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function|Cannot read properties/);
    const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.equal(result.completePrimary,false);assert.equal(result.primary.total,1);assert.deepEqual(result.results.map((v:{id:string;ok:boolean})=>({id:v.id,ok:v.ok})),[{id,ok:false}]);rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
  }
  for(const script of [grader,held])assert.equal(run(script).status,0);console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
}finally{const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-scaling-controls-"));fs.rmSync(temp,{recursive:true,force:true});}
