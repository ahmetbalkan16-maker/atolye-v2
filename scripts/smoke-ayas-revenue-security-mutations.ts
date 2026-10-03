/** Independent load-valid contract violations must fail named assertions, never loader/runtime errors. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(),parent=fs.realpathSync.native(os.tmpdir()),temp=fs.mkdtempSync(path.join(parent,"ayas-revenue-security-controls-")),copied=new Set<string>();
function copy(file:string){if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
 if(!/\.tsx?$/.test(file))return;for(const m of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+|@\/[^'"]+)['"]/g)){const base=m[1]!.startsWith("@/")?path.join(repo,"src",m[1]!.slice(2)):path.resolve(path.dirname(path.join(repo,file)),m[1]!);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}}}
const base="src/lib/ayas/revenue/security/",grader="scripts/smoke-ayas-revenue-security.ts",heldout="scripts/adversarial-ayas-revenue-security.ts",registry="src/lib/ayas/revenue/AyasRevenuePlatformRegistry.ts";
const controls:readonly(readonly[string,string,string,string,string])[]=[
 ["prompt instruction lost",base+"AyasRevenueContentFirewall.ts",'codes.push("PROMPT_INJECTION")','codes.push(...[])',"P02"],
 ["fake owner claim allowed",base+"AyasRevenueContentFirewall.ts",'codes.push("POLICY_BYPASS_DIRECTIVE")','codes.push(...[])',"P03"],
 ["payment scam allowed",base+"AyasRevenueContentFirewall.ts",'codes.push("OFF_PLATFORM_PAYMENT_REQUEST")','codes.push(...[])',"P05"],
 ["foreign host admitted",base+"AyasRevenueContentFirewall.ts",'!HOSTS[platform].includes(u.hostname)','false',"P21"],
 ["nested getter executed",base+"AyasRevenueThreatModel.ts",'if(!isAyasRevenueBoundedJson(raw,maxBytes))return null;','',"P17"],
 ["secret-bearing external text admitted",base+"AyasRevenueContentFirewall.ts",'containsAyasRevenueSensitiveData(copied)||isAyasRevenueSensitiveText(text)','false',"P13"],
 ["archive disguised as text",base+"AyasRevenueFileSafety.ts",'head.subarray(0,2).toString()==="PK"','false',"P100"],
 ["forbidden dynamic module",base+"AyasRevenueActionGuard.ts",'/** Additional refusal only.','const forbiddenProbe = () => import("node:os");\n/** Additional refusal only.',"P98"],
 ["token revocation ignored",base+"AyasRevenueAccountSafety.ts",'b.credentialState!=="ACTIVE"||b.unfamiliarDevice','b.unfamiliarDevice',"P51"],
 ["scope drift ignored",base+"AyasRevenueAccountSafety.ts",'a.scopeDigest!==b.scopeDigest','false',"P52"],
 ["tool catalog drift ignored",base+"AyasRevenueAccountSafety.ts",'a.toolCatalogDigest!==b.toolCatalogDigest||b.unexpectedWrite','b.unexpectedWrite',"P57"],
 ["duplicate journal action admitted",base+"AyasRevenueActionGuard.ts",'if(j.some(v=>v.actionDigest===a.actionDigest||v.nonceDigest===a.nonceDigest))','if(false)',"P68"],
 ["canonical read drift ignored",base+"AyasRevenueActionGuard.ts",'a.canonicalDigest!==b.canonicalDigest||','',"P72"],
 ["request firewall skipped",registry,'const security = guardAyasRevenueAction(sent);','const security = {decision:"ALLOW_READ"};',"P87"],
 ["result firewall skipped",registry,'inspectAyasRevenueContent(normalized.result.data, sent.platform).decision === "BLOCK"','false',"P88"],
 ["financial operations read-allowed",base+"AyasRevenueActionGuard.ts",'if(effect==="FINANCIAL_COMMITMENT")','if(false)',"P91"],
 ["guard gains authority",base+"AyasRevenueThreatModel.ts",'grantsAuthority:false as const','grantsAuthority:true as const',"P01"],
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=(script:string)=>spawnSync(process.execPath,["--import","tsx",script],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});
const rows:{name:string;assertion:string;status:string}[]=[];
try {
 copy(grader);copy(heldout);for(const f of fs.readdirSync(path.join(repo,base)))copy(base+f);copy("tsconfig.json");copy("package.json");fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
 for(const file of [grader,heldout]){const r=run(file);assert.equal(r.status,0,r.stdout+r.stderr);}
 for(const [name,file,before,after,id]of controls){const target=path.join(temp,file),original=fs.readFileSync(target,"utf8");assert.equal(original.split(before).length-1,1,name+": mutation anchor");let r:ReturnType<typeof run>;const selected=id.startsWith("H")?heldout:grader;
   try{fs.writeFileSync(target,original.replace(before,()=>after));r=run(selected);}finally{fs.writeFileSync(target,original);}
   assert.equal(r.status,1,name+": did not assertion-fail");assert.doesNotMatch(r.stderr,/SyntaxError|TransformError|ERR_MODULE_NOT_FOUND|Cannot find module|is not defined|is not a function/);assert.match(r.stderr,new RegExp("(?:^|\\n)"+id+":"),name+": named assertion missing");const result=JSON.parse(r.stdout.trim());assert.equal(result.status,"FAIL");assert.ok(result.results.some((v:{id:string;ok:boolean})=>v.id===id&&!v.ok));rows.push({name,assertion:id,status:"ASSERTION_CAUGHT"});
 }
 for(const file of [grader,heldout])assert.equal(run(file).status,0);console.log(JSON.stringify({status:"PASS",caught:rows.length,total:controls.length,equivalents:0,baselineAndRecovered:"PASS",scope:"OWNED_GITLESS_TEMP_NO_LIVE_DATA_OR_AUTHORITY",rows}));
} finally {
 const link=path.join(temp,"node_modules");if(fs.existsSync(link)){if(process.platform==="win32")fs.rmdirSync(link);else fs.unlinkSync(link);}assert.equal(path.dirname(fs.realpathSync.native(temp)).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(temp).startsWith("ayas-revenue-security-controls-"));fs.rmSync(temp,{recursive:true,force:true});
}
