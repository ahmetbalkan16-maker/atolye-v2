/** Fixed read-only local collector. No daemon, provider, repair, account, env-file or execution service is loaded. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {evaluateAyasGraphifyState,type AyasGraphifyFacts} from "../developer/AyasGraphifyState";
import {auditInteger,auditTime,freezeAudit,type AyasAuditEvidence,type AyasSystemAuditInput} from "./AyasSystemAuditModel";
import {AYAS_AUDIT_CHECKS,AYAS_AUDIT_PROTECTED_ROOTS} from "./AyasSystemAuditRegistry";
import {buildAyasSystemAuditReport} from "./AyasSystemAuditReport";
export const auditDigest=(bytes:Uint8Array|string)=>crypto.createHash("sha256").update(bytes).digest("hex");
/** Credential-named paths are never opened by any protected inventory. */
export const AYAS_AUDIT_CREDENTIAL_PATH=/(^|\/)(?:\.env(?:\.|$)|.*(?:credential|secret|token|\.key$|\.pem$))/i;
export interface AyasAuditInventory {digest:string;complete:boolean;files:number;scope:"FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED"|"COMBINED_REPOSITORY_RUNTIME_AUTHORITY_V1";localComplete?:boolean;externalRuntimeQualified?:boolean;coverageManifestDigest?:string;bytesHashed?:number;mode?:"STREAMING_LOCAL_HASH_ONLY";exclusions?:{credentialFiles:number;sizeOrByteBudgetFiles:number;linkOrSpecialEntries:number;depthOrFileLimitStops:number;unreadableRoots:number};
  // Combined scope only (F98): what the receipt must carry so a reviewer can see each root, store, budget and reason.
  coverage?:string;budget?:unknown;externalBinding?:unknown;roots?:readonly unknown[];stores?:readonly unknown[];incompleteReasons?:readonly string[]}
const combinedSummary=(v:AyasAuditInventory)=>({coverage:v.coverage??null,budget:v.budget??null,externalBinding:v.externalBinding??null,roots:v.roots??[],stores:v.stores??[],incompleteReasons:v.incompleteReasons??[]});
function contained(root:string,target:string){const relative=path.relative(root,target);return relative===""||!relative.startsWith("..")&&!path.isAbsolute(relative);}
function ancestry(root:string,target:string){if(!contained(root,target))return false;let at=root;for(const part of path.relative(root,target).split(path.sep).filter(Boolean)){at=path.join(at,part);if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())return false;}return true;}
function sameAuditFile(a:fs.Stats,b:fs.Stats){return b.isFile()&&b.nlink===1&&a.ino===b.ino&&a.dev===b.dev&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
/** Exact bounded reads; a changed or replaced file supplies no qualified digest. */
function readAuditFile(root:string,file:string,stat:fs.Stats,maxBytes:number,includeBody=false){
  if(!stat.isFile()||stat.nlink!==1||stat.size>maxBytes)throw Error("AUDIT_FILE_BOUND");
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
  try{
    const opened=fs.fstatSync(fd);if(!sameAuditFile(stat,opened))throw Error("AUDIT_FILE_CHANGED");
    const hash=crypto.createHash("sha256"),chunk=Buffer.alloc(Math.min(256*1024,opened.size)),body=includeBody?Buffer.alloc(opened.size):null;let offset=0;
    while(offset<opened.size){const length=Math.min(chunk.length,opened.size-offset),n=fs.readSync(fd,chunk,0,length,offset);if(n<=0||n>length)throw Error("AUDIT_FILE_CHANGED");hash.update(chunk.subarray(0,n));body?.set(chunk.subarray(0,n),offset);offset+=n;}
    if(!sameAuditFile(opened,fs.fstatSync(fd))||!ancestry(root,file)||!sameAuditFile(opened,fs.lstatSync(file)))throw Error("AUDIT_FILE_CHANGED");
    return {digest:hash.digest("hex"),body};
  }finally{fs.closeSync(fd);}
}
export function inventoryAyasAuditProtectedRoots(root:string,mode:"BOUNDED_DEFAULT"|"STREAMING_LOCAL_HASH_ONLY"="BOUNDED_DEFAULT"):AyasAuditInventory {
  if(mode!=="BOUNDED_DEFAULT"&&mode!=="STREAMING_LOCAL_HASH_ONLY")throw Error("AUDIT_INVENTORY_MODE_INVALID");
  if(!path.isAbsolute(root)||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())throw Error("AUDIT_ROOT_INVALID");
  const resolved=fs.realpathSync.native(root),parts:string[]=[];let complete=true,files=0,total=0;
  // The explicit operator path hashes more local bytes with bounded memory. Default limits stay frozen.
  const streaming=mode==="STREAMING_LOCAL_HASH_ONLY",byteBudget=(streaming?1024:128)*1024*1024,deadline=Date.now()+120000;
  const exclusions={credentialFiles:0,sizeOrByteBudgetFiles:0,linkOrSpecialEntries:0,depthOrFileLimitStops:0,unreadableRoots:0};
  const visit=(file:string,depth:number)=>{if(streaming&&Date.now()>deadline)throw Error("AUDIT_INVENTORY_TIME_BOUND");if(depth>20||files>=20000){complete=false;exclusions.depthOrFileLimitStops++;return;}if(!ancestry(resolved,file)){complete=false;exclusions.linkOrSpecialEntries++;return;}
    const s=fs.lstatSync(file);if(s.isDirectory()){for(const name of fs.readdirSync(file).sort())visit(path.join(file,name),depth+1);return;}
    if(!s.isFile()||s.nlink!==1){complete=false;exclusions.linkOrSpecialEntries++;return;}files++;const relative=path.relative(resolved,file).replace(/\\/g,"/");
    // Credentials are never opened. Inventory stores only hashes, never private/media bodies.
    const credential=AYAS_AUDIT_CREDENTIAL_PATH.test(relative);
    if(credential||s.size>16*1024*1024||total+s.size>byteBudget){complete=false;if(credential)exclusions.credentialFiles++;else exclusions.sizeOrByteBudgetFiles++;parts.push(relative+":UNMEASURED:"+s.size+":"+s.mtimeMs);return;}
    const measured=readAuditFile(resolved,file,s,Math.min(16*1024*1024,byteBudget-total));total+=s.size;parts.push(relative+":"+measured.digest);
  };
  for(const relative of AYAS_AUDIT_PROTECTED_ROOTS){const file=path.join(resolved,relative);try{if(fs.existsSync(file))visit(file,0);else parts.push(relative+":ABSENT");}catch{complete=false;exclusions.unreadableRoots++;parts.push(relative+":UNREADABLE");}}
  return freezeAudit({digest:auditDigest(parts.join("\n")),complete:streaming?false:complete,files,scope:"FIXED_REPOSITORY_ROOTS_EXTERNAL_RUNTIME_UNQUALIFIED",exclusions,
    ...(streaming?{localComplete:complete,externalRuntimeQualified:false as const,bytesHashed:total,mode:"STREAMING_LOCAL_HASH_ONLY" as const}:{})});
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
  // Both inventories of one interval must measure the same coverage manifest (absent for the local scopes).
  const manifestStable=before.coverageManifestDigest===after.coverageManifestDigest;
  const input:AyasSystemAuditInput={schemaVersion:"1",auditId:auditDigest(JSON.stringify({head:repo.head,start,end,before:before.digest,after:after.digest})),branch:repo.branch,head:repo.head??"UNKNOWN",
    startedAt:start,completedAt:end,machineEvidenceAt:null,machineStatus:"UNKNOWN",graphify:{sourceHead:facts.sourceHead,lastAnalyzedHead:status.lastAnalyzedHead,builtFromHead:status.graphBuiltFromHead,
      stale:status.structuralStatus==="STALE"||finalStatus.structuralStatus==="STALE"||finalRepo.head!==repo.head||finalRepo.branch!==repo.branch||finalFacts.sourceHead!==facts.sourceHead||finalFacts.worktreeFingerprint!==facts.worktreeFingerprint,
      needsUpdate:facts.needsUpdateFlag||finalFacts.needsUpdateFlag,integrityViolations:graph?graph.duplicateIds+graph.duplicateEdges+graph.dangling+graph.selfLoops:null,structural:status.structuralStatus,semantic:status.semanticStatus},
    evidence,coverage:{declared:deps.declaredSuites,executed:0},mutation:{beforeDigest:before.digest,afterDigest:after.digest,complete:before.complete&&after.complete&&manifestStable,attribution:before.digest===after.digest?"NONE":"UNKNOWN",writerEvidenceDigest:null},ownerReviewDigest:null};
  return freezeAudit({report:buildAyasSystemAuditReport(input),input,protectedScope:before.scope,protectedFilesBefore:before.files,protectedFilesAfter:after.files,
    protectedExclusionsBefore:before.exclusions??null,protectedExclusionsAfter:after.exclusions??null,
    ...(before.localComplete===undefined?{}:{protectedLocalCompleteBefore:before.localComplete,protectedLocalCompleteAfter:after.localComplete??false,externalRuntimeQualified:false as const,protectedBytesHashedBefore:before.bytesHashed??0,protectedBytesHashedAfter:after.bytesHashed??0}),
    ...(before.coverageManifestDigest===undefined?{}:{protectedCoverageManifestBefore:before.coverageManifestDigest,protectedCoverageManifestAfter:after.coverageManifestDigest??null,protectedCoverageManifestStable:manifestStable,
      externalRuntimeQualified:before.externalRuntimeQualified===true&&after.externalRuntimeQualified===true&&manifestStable,protectedBytesHashedBefore:before.bytesHashed??0,protectedBytesHashedAfter:after.bytesHashed??0,
      // Attribution NONE compares the two endpoint snapshots only: a write reverted inside the interval is not seen.
      protectedCombinedBefore:combinedSummary(before),protectedCombinedAfter:combinedSummary(after),protectedAttributionScope:"ENDPOINT_SNAPSHOTS_ONLY" as const}),
    branchOrHeadChanged:finalRepo.head!==repo.head||finalRepo.branch!==repo.branch});
}
export function createLocalAyasAuditCollector(root:string,probes:Pick<AyasAuditCollectorDeps,"repository"|"graph">):AyasAuditCollectorDeps {
  if(!probes||typeof probes.repository!=="function"||typeof probes.graph!=="function")throw Error("AUDIT_PROBES_REQUIRED");
  if(!path.isAbsolute(root)||!fs.existsSync(root)||fs.lstatSync(root).isSymbolicLink())throw Error("AUDIT_ROOT_INVALID");const resolved=fs.realpathSync.native(root);
  let declared=0;try{const file=path.join(resolved,"docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15F/EVAL_MANIFEST.json");if(ancestry(resolved,file)){const m=JSON.parse(fs.readFileSync(file,"utf8"));if(Array.isArray(m.suites)&&auditInteger(m.suites.length))declared=m.suites.length;}}catch{/* unknown coverage remains invalid */}
  return {repository:probes.repository,clock:()=>new Date().toISOString(),graph:probes.graph,
    inventory:()=>inventoryAyasAuditProtectedRoots(resolved),declaredSuites:declared,readSource:(file)=>{if(!AYAS_AUDIT_CHECKS.some(s=>s.sourceRef===file))throw Error("AUDIT_SOURCE_NOT_REGISTERED");const target=path.join(resolved,file);if(!ancestry(resolved,target))return null;
      try{const stat=fs.lstatSync(target);if(!stat.isFile()||stat.nlink!==1||stat.size>4*1024*1024)return null;return readAuditFile(resolved,target,stat,4*1024*1024,true).body;}catch{return null;}}};
}
export function validateAyasAuditClock(value:string){if(!auditTime(value))throw Error("AUDIT_CLOCK_INVALID");return value;}
export {ancestry as auditAncestry,readAuditFile as auditReadFile};
