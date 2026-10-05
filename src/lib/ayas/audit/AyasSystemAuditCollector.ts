/** Fixed read-only local collector. No daemon, provider, repair, account, env-file or execution service is loaded. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {collectAyasGraphifyFacts} from "../developer/AyasGraphifyStateCollector";
import {evaluateAyasGraphifyState,type AyasGraphifyFacts} from "../developer/AyasGraphifyState";
import {auditHead,auditInteger,auditTime,freezeAudit,type AyasAuditEvidence,type AyasSystemAuditInput} from "./AyasSystemAuditModel";
import {AYAS_AUDIT_CHECKS,AYAS_AUDIT_PROTECTED_ROOTS} from "./AyasSystemAuditRegistry";
import {buildAyasSystemAuditReport} from "./AyasSystemAuditReport";
export const auditDigest=(bytes:Uint8Array|string)=>crypto.createHash("sha256").update(bytes).digest("hex");
export interface AyasAuditInventory {digest:string;complete:boolean;files:number;scope:"FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED"}
function contained(root:string,target:string){const relative=path.relative(root,target);return relative===""||!relative.startsWith("..")&&!path.isAbsolute(relative);}
function ancestry(root:string,target:string){if(!contained(root,target))return false;let at=root;for(const part of path.relative(root,target).split(path.sep).filter(Boolean)){at=path.join(at,part);if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())return false;}return true;}
export function inventoryAyasAuditProtectedRoots(root:string):AyasAuditInventory {
  if(!path.isAbsolute(root)||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())throw Error("AUDIT_ROOT_INVALID");
  const resolved=fs.realpathSync.native(root),parts:string[]=[];let complete=true,files=0,total=0;
  const visit=(file:string,depth:number)=>{if(depth>20||files>20000){complete=false;return;}if(!ancestry(resolved,file)){complete=false;return;}
    const s=fs.lstatSync(file);if(s.isDirectory()){for(const name of fs.readdirSync(file).sort())visit(path.join(file,name),depth+1);return;}
    if(!s.isFile()||s.nlink!==1){complete=false;return;}files++;const relative=path.relative(resolved,file).replace(/\\/g,"/");
    // Do not read credentials or media bodies. Incomplete coverage never becomes mutation proof.
    if(/(^|\/)(?:\.env(?:\.|$)|.*(?:credential|secret|token|\.key$|\.pem$))/i.test(relative)||s.size>16*1024*1024||total+s.size>128*1024*1024){complete=false;parts.push(relative+":UNMEASURED:"+s.size+":"+s.mtimeMs);return;}
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));try{const opened=fs.fstatSync(fd);if(opened.ino!==s.ino||opened.nlink!==1)throw Error("AUDIT_FILE_CHANGED");const bytes=fs.readFileSync(fd);total+=bytes.length;parts.push(relative+":"+auditDigest(bytes));}finally{fs.closeSync(fd);}
  };
  for(const relative of AYAS_AUDIT_PROTECTED_ROOTS){const file=path.join(resolved,relative);try{if(fs.existsSync(file))visit(file,0);else parts.push(relative+":ABSENT");}catch{complete=false;parts.push(relative+":UNREADABLE");}}
  return freezeAudit({digest:auditDigest(parts.join("\n")),complete,files,scope:"FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED"});
}
export interface AyasAuditCollectorDeps {
  repository:()=>{head:string|null;branch:string};clock:()=>string;graph:()=>Promise<AyasGraphifyFacts>;
  readSource:(file:string)=>Uint8Array|null;inventory:()=>AyasAuditInventory;
  declaredSuites:number; trustedEvidence?:readonly AyasAuditEvidence[];
}
export async function collectAyasSystemAudit(deps:AyasAuditCollectorDeps){
  const start=deps.clock(),repo=deps.repository(),before=deps.inventory(),facts=await deps.graph(),status=evaluateAyasGraphifyState(facts),graph=typeof facts.graph==="string"?null:facts.graph;
  const evidence:AyasAuditEvidence[]=[],trusted=deps.trustedEvidence??[];
  for(const spec of AYAS_AUDIT_CHECKS){const provided=trusted.filter(e=>e.checkId===spec.id);if(provided.length){evidence.push(...provided);continue;}
    let bytes:Uint8Array|null=null;try{if(spec.kind==="SOURCE")bytes=deps.readSource(spec.sourceRef);}catch{/* closed absence, no raw exception body */}
    evidence.push({domain:spec.domain,checkId:spec.id,checkVersion:1,evidenceClass:spec.evidenceClass,head:repo.head,headIndependent:false,observedAt:start,sourceRef:spec.sourceRef,
      sourceDigest:bytes===null?null:auditDigest(bytes),state:spec.kind==="SOURCE"?bytes===null?"FAIL":"PASS":"NOT_RUN",severity:spec.kind==="SOURCE"&&bytes===null?"MAJOR":"INFO",
      findingCode:spec.kind==="SOURCE"?bytes===null?"SOURCE_ABSENT":"SOURCE_PRESENT":"COLLECTOR_NOT_BOUND",liveRequired:spec.liveRequired});
  }
  const after=deps.inventory(),finalFacts=await deps.graph(),finalStatus=evaluateAyasGraphifyState(finalFacts),end=deps.clock(),finalRepo=deps.repository();
  const input:AyasSystemAuditInput={schemaVersion:"1",auditId:auditDigest(JSON.stringify({head:repo.head,start,end,before:before.digest,after:after.digest})),branch:repo.branch,head:repo.head??"UNKNOWN",
    startedAt:start,completedAt:end,machineEvidenceAt:null,machineStatus:"UNKNOWN",graphify:{sourceHead:facts.sourceHead,lastAnalyzedHead:status.lastAnalyzedHead,builtFromHead:status.graphBuiltFromHead,
      stale:status.structuralStatus==="STALE"||finalStatus.structuralStatus==="STALE"||finalRepo.head!==repo.head||finalRepo.branch!==repo.branch||finalFacts.sourceHead!==facts.sourceHead||finalFacts.worktreeFingerprint!==facts.worktreeFingerprint,
      needsUpdate:facts.needsUpdateFlag||finalFacts.needsUpdateFlag,integrityViolations:graph?graph.duplicateIds+graph.duplicateEdges+graph.dangling+graph.selfLoops:null,structural:status.structuralStatus,semantic:status.semanticStatus},
    evidence,coverage:{declared:deps.declaredSuites,executed:0},mutation:{beforeDigest:before.digest,afterDigest:after.digest,complete:before.complete&&after.complete,attribution:before.digest===after.digest?"NONE":"UNKNOWN",writerEvidenceDigest:null},ownerReviewDigest:null};
  return freezeAudit({report:buildAyasSystemAuditReport(input),input,protectedScope:before.scope,protectedFilesBefore:before.files,protectedFilesAfter:after.files,
    branchOrHeadChanged:finalRepo.head!==repo.head||finalRepo.branch!==repo.branch});
}
export function createLocalAyasAuditCollector(root:string):AyasAuditCollectorDeps {
  if(!path.isAbsolute(root)||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())throw Error("AUDIT_ROOT_INVALID");const resolved=fs.realpathSync.native(root);
  const git=(args:readonly string[])=>{try{return execFileSync("git",["-c","core.fsmonitor=false","-c","core.quotePath=false",...args],{cwd:resolved,encoding:"utf8",windowsHide:true,timeout:15000,maxBuffer:2e6,env:{...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_TERMINAL_PROMPT:"0"}}).trim();}catch{return null;}};
  let declared=0;try{const file=path.join(resolved,"docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json");if(ancestry(resolved,file)){const m=JSON.parse(fs.readFileSync(file,"utf8"));if(Array.isArray(m.suites)&&auditInteger(m.suites.length))declared=m.suites.length;}}catch{/* unknown coverage remains invalid */}
  return {repository:()=>{const h=git(["rev-parse","--verify","HEAD"]);return {head:auditHead(h)?h:null,branch:git(["rev-parse","--abbrev-ref","HEAD"])??"UNKNOWN"};},clock:()=>new Date().toISOString(),graph:()=>collectAyasGraphifyFacts({cwd:resolved,includeUserConsumers:false}),
    inventory:()=>inventoryAyasAuditProtectedRoots(resolved),declaredSuites:declared,readSource:(file)=>{if(!AYAS_AUDIT_CHECKS.some(s=>s.sourceRef===file))throw Error("AUDIT_SOURCE_NOT_REGISTERED");const target=path.join(resolved,file);if(!ancestry(resolved,target))return null;
      try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.nlink!==1||stat.size>4*1024*1024)return null;const fd=fs.openSync(target,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));try{const opened=fs.fstatSync(fd);if(opened.ino!==stat.ino||opened.nlink!==1)return null;return fs.readFileSync(fd);}finally{fs.closeSync(fd);}}catch{return null;}}};
}
export function validateAyasAuditClock(value:string){if(!auditTime(value))throw Error("AUDIT_CLOCK_INVALID");return value;}
