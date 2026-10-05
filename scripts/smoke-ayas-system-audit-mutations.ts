/** Independent load-valid policy faults; named assertions in an owned gitless TEMP projection. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-system-audit-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
  if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const dep=m[1]!,base=dep.startsWith("@/")?path.join(repo,"src",dep.slice(2)):path.resolve(path.dirname(path.join(repo,file)),dep);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const policy="src/lib/ayas/audit/AyasSystemAuditPolicy.ts",gate="src/lib/ayas/audit/AyasSystemClosureGate.ts",grader="scripts/smoke-ayas-system-audit.ts",held="scripts/adversarial-ayas-system-audit.ts";
const controls:readonly(readonly[string,string,string,string,string])[]=[
 ["wrong proof class accepted",policy,"rawRow.evidenceClass!==spec.evidenceClass","false","P008"],
 ["old source HEAD accepted",policy,"rawRow.head!==v.head","false","P003"],
 ["needs_update ignored",policy,"g.needsUpdate!==false","false","P121"],
 ["technical failure ignored",gate,'e.state==="FAIL"||e.state==="BLOCKED"','e.state==="BLOCKED"',"P004"],
 ["partial baseline closes foundation",gate,"a.input.coverage.executed!==a.input.coverage.declared","false","P127"],
 ["protected mutation ignored",policy,"m.beforeDigest!==m.afterDigest","false","P130"],
 ["known limit silently promoted",policy,'state==="PASS"&&rawRow.findingCode==="KNOWN_LIMIT_REVIEW_REQUIRED"','false',"P129"],
 ["expired proof accepted",policy,"Date.parse(v.completedAt)-Date.parse(rawRow.observedAt)>86400000","false","P133"],
 ["source coverage absent",gate,'!passed("SOURCE")','false',"P002"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string,args:string[]=[])=>spawnSync(process.execPath,["--import","tsx",script,...args],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try{
  copy(grader);copy(held);copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  for(const script of [grader,held]){const r=run(script);assert.equal(r.status,0,r.stdout+r.stderr);}
  for(const [name,file,before,after,id]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;
    try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(grader,["--case",id]);}finally{fs.writeFileSync(target,original);}
    assert.equal(r.status,1,name+": did not assertion-fail");assert.match(r.stderr,/AssertionError|ERR_ASSERTION/);assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function|Cannot read properties/);
    const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.equal(result.completePrimary,false);assert.equal(result.primary.total,1);assert.doesNotMatch(JSON.stringify(result.results),/Cannot read properties|is not a function|is not defined/);assert.deepEqual(result.results.map((v:{id:string;ok:boolean})=>({id:v.id,ok:v.ok})),[{id,ok:false}]);rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
  }
  for(const script of [grader,held])assert.equal(run(script).status,0);console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
}finally{const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-system-audit-controls-"));fs.rmSync(temp,{recursive:true,force:true});}
