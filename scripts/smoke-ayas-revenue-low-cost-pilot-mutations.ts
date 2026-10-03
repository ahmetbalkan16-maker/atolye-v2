/** Independent load-valid model/admission violations; named assertions, never loader/runtime failures. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-revenue-pilot-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
 if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const base=m[1]!.startsWith("@/")?path.join(repo,"src",m[1]!.slice(2)):path.resolve(path.dirname(path.join(repo,file)),m[1]!);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const base="src/lib/ayas/revenue/pilot/",model=base+"AyasRevenuePilot.ts",policy=base+"AyasRevenuePilotPolicy.ts",grader="scripts/smoke-ayas-revenue-low-cost-pilot.ts",held="scripts/adversarial-ayas-revenue-low-cost-pilot.ts";
const controls:readonly(readonly[string,string,string,string,string])[]=[
 ["bounded integer ceilings lost",model,"(v as number)<=max","true","P10"],
 ["cross-platform action admitted",model,"AYAS_REVENUE_PILOT_ACTIONS[platform].includes(v.operation)","true","P15"],
 ["proxy reflection executes",model,"if(types.isProxy(v))return false;","","P52"],
 ["rejected owner metadata accepted",policy,'r.decision!=="APPROVE"',"false","P27"],
 ["plan decision rebound",policy,"r.planDigest!==p.planDigest","false","P25"],
 ["transition decision rebound",policy,"r.transitionDigest!==transitionDigest","false","P26"],
 ["stale review accepted",policy,"Date.parse(now)-Date.parse(r.decidedAt)>86400000","false","P28"],
 ["paid launch cost admitted",policy,"!evaluateAyasZeroCost(v.costClass).allowed","false","P32"],
 ["blocking risk ignored",policy,'classifyAyasRevenueRisk(v.securityRiskCodes).severity!=="INFO"',"false","P35"],
 ["professional review ignored",policy,'c.state!=="REVIEW_CHECKLIST_COMPLETE_NOT_AUTHORITY"||',"","P41"],
 ["free-first failure ignored",policy,'f.status!=="PILOT_CANDIDATE"||',"","P61"],
 ["metadata becomes authority",policy,"grantsAuthority:false as const","grantsAuthority:true as const","P23"],
 ["expired pilot resumes",policy,'requestedState==="ACTIVE"&&stopAt!==null&&Date.parse(now)>=Date.parse(stopAt)',"false","P49"],
 ["foreign fee proof accepted",policy,"!f.acceptedEvidenceDigests.includes(v.passiveFeesEvidenceDigest)","false","P38"],
 ["forbidden dynamic capability",policy,'/** Reader must eventually reuse', 'const forbiddenProbe = () => import("node:os");\n/** Reader must eventually reuse',"P56"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string)=>spawnSync(process.execPath,["--import","tsx",script],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try{
 copy(grader);copy(held);copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
 for(const script of [grader,held]){const r=run(script);assert.equal(r.status,0,r.stdout+r.stderr);}
 for(const [name,file,before,after,id]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;
  try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader);}finally{fs.writeFileSync(target,original);}
  assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function|Cannot read properties/);
  assert.match(r.stderr,new RegExp("(?:^|\\n)"+id+":"),name+": named assertion missing");const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.ok(result.results.some((v:{id:string;ok:boolean})=>v.id===id&&!v.ok));rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
 }
 for(const script of [grader,held])assert.equal(run(script).status,0);console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"MODEL_OWNER_ADMISSION_OWNED_GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
}finally{const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-revenue-pilot-controls-"));fs.rmSync(temp,{recursive:true,force:true});}
