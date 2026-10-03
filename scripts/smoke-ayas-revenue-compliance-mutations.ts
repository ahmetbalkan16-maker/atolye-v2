/** Independent load-valid violations; only a named contract assertion can count as caught. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-revenue-compliance-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
 if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const base=m[1]!.startsWith("@/")?path.join(repo,"src",m[1]!.slice(2)):path.resolve(path.dirname(path.join(repo,file)),m[1]!);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const file="src/lib/ayas/revenue/compliance/AyasRevenueCompliance.ts",grader="scripts/smoke-ayas-revenue-compliance.ts",heldout="scripts/adversarial-ayas-revenue-compliance.ts";
const controls:readonly(readonly[string,string,string,string])[]=[
 ["scope binding lost","BOUND_KEYS.some(k=>r[k]!==v[k])","false","P26"],
 ["restricted account ignored",'if(r.state === "RESTRICTED")','if(false)',"P19"],
 ["scope expiry ignored","scopeAt>time||time-scopeAt>DAY","scopeAt>time","P33"],
 ["future receipt accepted","at>time||time-at>MAX_AGE[requirement]","time-at>MAX_AGE[requirement]","P34"],
 ["receipt expiry ignored","time-at>MAX_AGE[requirement]","false","P10"],
 ["duplicate terms hidden","if(rows.has(r.requirement))","if(false)","P35"],
 ["Etsy public API terms treated as permission",'r.automationBasis === "WRITTEN_PLATFORM_PERMISSION" && r.source === "PLATFORM_PERMISSION"',"true","P36"],
 ["Upwork key treated as approved use case",'r.automationBasis === "APPROVED_API_USE_CASE" && r.source === "PLATFORM_PERMISSION"',"true","P37"],
 ["financial action no longer refused",'AYAS_REVENUE_OPERATION_EFFECT[v.operation] === "FINANCIAL_COMMITMENT"',"false","P49"],
 ["metadata becomes authority","grantsAuthority:false as const","grantsAuthority:true as const","P01"],
 ["checklist becomes pilot activation","pilotActivationAllowed:false as const","pilotActivationAllowed:true as const","P01"],
 ["accessor executes before refusal","if(!proxyFree(raw)||!isAyasRevenueBoundedJson(raw,32768))return null;","","P51"],
 ["public reference replaces professional review","SOURCES[v.requirement as Requirement].includes(v.source as Source)","true","P41"],
 ["unknown jurisdiction hidden",'new Set<Requirement>(["JURISDICTION","TAX_REVIEW","LEGAL_REVIEW"])','new Set<Requirement>(["TAX_REVIEW","LEGAL_REVIEW"])',"P07"],
 ["forbidden dynamic capability",'/** `now` is supplied by trusted application code.', 'const forbiddenProbe = () => import("node:os");\n/** `now` is supplied by trusted application code.',"P60"],
 ["native proxy refusal lost","if(types.isProxy(v))return false;","","P62"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string)=>spawnSync(process.execPath,["--import","tsx",script],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try {
 copy(grader);copy(heldout);copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
 for(const script of [grader,heldout]){const r=run(script);assert.equal(r.status,0,r.stdout+r.stderr);}
 const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");
 for(const [name,before,after,id]of controls){assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;
  try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader);}finally{fs.writeFileSync(target,original);}
  assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/);
  assert.match(r.stderr,new RegExp("(?:^|\\n)"+id+":"),name+": named assertion missing");const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.ok(result.results.some((v:{id:string;ok:boolean})=>v.id===id&&!v.ok));rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
 }
 for(const script of [grader,heldout])assert.equal(run(script).status,0);
 console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"OWNED_GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
}finally{
 const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-revenue-compliance-controls-"));fs.rmSync(temp,{recursive:true,force:true});
}
