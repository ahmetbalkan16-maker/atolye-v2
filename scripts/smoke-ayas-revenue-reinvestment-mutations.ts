/** Counterfactuals in gitless TEMP projections. Named assertion failures only; load/runtime errors never count. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const repo=process.cwd(), parent=fs.realpathSync.native(os.tmpdir()), temp=fs.mkdtempSync(path.join(parent,"ayas-reinvestment-controls-")), copied=new Set<string>();
const policy="src/lib/ayas/revenue/AyasRevenueReinvestmentPolicy.ts", grader="scripts/smoke-ayas-revenue-reinvestment-policy.ts";
function copy(file:string) {
  if(copied.has(file))return;copied.add(file);const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(repo,file),target);
  if(!/\.tsx?$/.test(file))return;
  for(const match of fs.readFileSync(target,"utf8").matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    const base=path.resolve(path.dirname(path.join(repo,file)),match[1]!);const found=[base,base+".ts",base+".tsx",base+".json",path.join(base,"index.ts")].find(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
    if(found){const rel=path.relative(repo,found).replace(/\\/g,"/");assert.ok(!rel.startsWith("..")&&!path.isAbsolute(rel));copy(rel);}
  }
}
const mutants:readonly(readonly[string,string,string,string])[]=[
  ["default policy guard removed","if (!reviewed.enabled)","if (false && !reviewed.enabled)","P01"],
  ["percentage rounded up","BigInt(available) * BigInt(reviewed.basisPoints) / BigInt(10_000)","(BigInt(available) * BigInt(reviewed.basisPoints) + BigInt(9999)) / BigInt(10_000)","P11"],
  ["absolute cap widened","Math.min(absolute, safe(","Math.max(absolute, safe(","P12"],
  ["reserve ignored","safe(BigInt(realized) - BigInt(reserved))","safe(BigInt(realized))","P08"],
  ["amount cap removed","p.amount.valueMinor > ceiling","false","P13"],
  ["currency isolation removed"," && v.amount.currency === p.amount.currency","","P15"],
  ["debt accepted","r.debtMinor !== 0 || ","","P16"],
  ["unknown settlement accepted","r.settlement !== \"SETTLED\"\n        || ","","P10"],
  ["history completeness removed","r.historyCoverage !== \"COMPLETE\" || ","","P48"],
  ["unknown fee coverage accepted","r.fees !== \"COMPLETE\" || ","","P54"],
  ["refund uncertainty accepted","r.refunds !== \"BOUNDED\" || ","","P55"],
  ["dispute uncertainty accepted","r.disputes !== \"BOUNDED\" || ","","P56"],
  ["tax uncertainty accepted","r.tax !== \"CLEAR_OR_RESERVED\" || ","","P57"],
  ["ledger digest mismatch accepted","r.ledgerDigest !== ledgerDigest || ","","P36"],
  ["ledger revision mismatch accepted","r.ledgerRevision !== state.revision","false","P37"],
  ["purpose allowlist ignored","!reviewed.allowedPurposes.includes(p.purpose)","false","P38"],
  ["free-first readiness ignored","f.status !== \"PILOT_CANDIDATE\" || ","","P19"],
  ["equivalent free alternative ignored","p.freeAlternative.state !== \"NO_EQUIVALENT_FREE\" || ","","P17"],
  ["free alternative proof ignored","p.freeAlternative.evidenceDigest === null","false","H12"],
  ["risk classes ignored","[p.risks.security, p.risks.licensing, p.risks.privacy].some(v => v !== \"LOW\")","false","P20"],
  ["risk evidence ignored","p.risks.evidenceDigest === null","false","P60"],
  ["irreversible effect accepted","![\"REVERSIBLE\", \"PARTIALLY_REVERSIBLE\"].includes(e.reversibility)","false","P23"],
  ["recurring effect accepted"," || e.recurring","","P25"],
  ["credit accepted"," || e.creditOrDebt","","P26"],
  ["loss chasing accepted"," || e.lossChasing","","P27"],
  ["automatic scaling accepted"," || e.automaticScale","","P28"],
  ["one shot not required"," || !e.oneShot","","P29"],
  ["downside amount mismatch accepted"," || e.maxDownside.valueMinor !== p.amount.valueMinor","","P30"],
  ["downside currency mismatch accepted","e.maxDownside.currency !== p.amount.currency || ","","P31"],
  ["subscription accepted"," || e.costClass === \"subscription\"","","P32"],
  ["unknown cost accepted"," || e.costClass === \"unknown-cost\"","","P33"],
  ["expired effect accepted"," || Date.parse(e.expiresAt) <= Date.parse(now)","","P34"],
  ["effect outlives evidence"," || Date.parse(e.expiresAt) > Math.min(Date.parse(r.freshUntil), Date.parse(r.observedAt) + 86_400_000)","","P35"],
  ["effect outlives effective age ceiling","Date.parse(e.expiresAt) > Math.min(Date.parse(r.freshUntil), Date.parse(r.observedAt) + 86_400_000)","Date.parse(e.expiresAt) > Date.parse(r.freshUntil)","P62"],
  ["prior loss ignored","BigInt(Math.min(0, prior))","BigInt(0)","P61"],
  ["loss after window ignored","Math.min(lifetime, safe(BigInt(profit) + BigInt(Math.min(0, prior))))","safe(BigInt(profit) + BigInt(Math.min(0, prior)))","P53"],
  ["reversed payout reused"," && !reversed.has(v.entryId)","","H08"],
  ["proposal self-authorizes","executionAuthority: \"NONE\" as const","executionAuthority: \"AUTHORIZED\" as const","P03"],
  ["proposal automatic renewal","automaticRenewal: false as const","automaticRenewal: true as const","P03"],
  ["unrelated order payout reused","v.platform + ':' + v.orderDigest","\"all-orders\"","P63"]
];
const env:NodeJS.ProcessEnv={NODE_ENV:"test"};for(const key of ["SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","HOME"])if(process.env[key])env[key]=process.env[key];
const run=()=>{const memory=os.freemem()/os.totalmem();assert.ok(memory>0.1,"HOST_PROTECTION");return spawnSync(process.execPath,["--import","tsx",grader],{cwd:temp,env,encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:3e6});};
try {
  copy(grader);fs.symlinkSync(path.join(repo,"node_modules"),path.join(temp,"node_modules"),"junction");
  const baseline=run();assert.equal(baseline.status,0,baseline.stderr);const baselineReport=JSON.parse(baseline.stdout.trim());assert.equal(baselineReport.status,"PASS");
  const file=path.join(temp,policy), original=fs.readFileSync(file,"utf8"), rows=[];
  for(const [name,find,replacement,id] of mutants) {
    assert.equal(original.split(find).length-1,1,"MUTATION_TARGET_NOT_EXACT: "+name);fs.writeFileSync(file,original.replace(find,replacement));
    const r=run();let report:{results:{id:string;ok:boolean}[];status:string}|null=null;try{report=JSON.parse(r.stdout.trim());}catch{}
    const caught=r.status===1&&report?.status==="FAIL"&&report.results.some(x=>x.id===id&&!x.ok)===true&&r.stderr.includes(id+": ");
    assert.ok(caught,JSON.stringify({name,id,exit:r.status,signal:r.signal,stderr:r.stderr.slice(-800),stdout:r.stdout.slice(-800)}));rows.push({name,scenario:id,status:"ASSERTION_CAUGHT"});
  }
  fs.writeFileSync(file,original);assert.equal(run().status,0);
  console.log(JSON.stringify({status:"PASS",baseline:{primary:baselineReport.primary,heldOut:baselineReport.heldOut},total:rows.length,caught:rows.length,equivalents:0,fixture:"GITLESS_TEMP_NO_NETWORK_MODEL_CREDENTIAL_OR_OWNER_POLICY",mutations:rows}));
} finally {
  assert.equal(path.dirname(fs.realpathSync.native(temp)),parent);assert.ok(path.basename(temp).startsWith("ayas-reinvestment-controls-"));fs.rmSync(temp,{recursive:true,force:true});
}
