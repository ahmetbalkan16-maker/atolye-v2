import {AUDIT_CLASSES,AUDIT_CODES,AUDIT_SEVERITIES,AUDIT_STATES,auditExact,auditHash,auditHead,auditInteger,auditRecord,auditTime,freezeAudit,snapshotAudit,type AyasAuditEvidence,type AyasAuditState,type AyasSystemAuditInput} from "./AyasSystemAuditModel";
import {AYAS_AUDIT_CHECKS} from "./AyasSystemAuditRegistry";
export interface AyasAuditAssessment {input:AyasSystemAuditInput|null;reasons:readonly string[];evidence:readonly AyasAuditEvidence[]}
export function assessAyasSystemAudit(raw:unknown):AyasAuditAssessment {
  const v=snapshotAudit(raw),invalid=()=>freezeAudit({input:null,reasons:["INVALID_AUDIT_METADATA"],evidence:[]});
  if(!auditRecord(v)||!auditExact(v,["schemaVersion","auditId","branch","head","startedAt","completedAt","machineEvidenceAt","machineStatus","graphify","evidence","coverage","mutation","ownerReviewDigest"]))return invalid();
  if(v.schemaVersion!=="1"||!auditHash(v.auditId)||!auditHead(v.head)||typeof v.branch!=="string"||!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,127}$/.test(v.branch)||v.branch.includes("..")
    ||!auditTime(v.startedAt)||!auditTime(v.completedAt)||Date.parse(v.completedAt)<Date.parse(v.startedAt)||Date.parse(v.completedAt)-Date.parse(v.startedAt)>86400000
    ||!["ALLOW","THROTTLE","PAUSE","UNKNOWN"].includes(v.machineStatus as string)||!(v.machineEvidenceAt===null||auditTime(v.machineEvidenceAt)&&Date.parse(v.machineEvidenceAt)<=Date.parse(v.completedAt))||!(v.ownerReviewDigest===null||auditHash(v.ownerReviewDigest))||!Array.isArray(v.evidence)||v.evidence.length>1024)return invalid();
  const g=v.graphify,c=v.coverage,m=v.mutation;
  if(!auditRecord(g)||!auditExact(g,["sourceHead","lastAnalyzedHead","builtFromHead","stale","needsUpdate","integrityViolations","structural","semantic"])
    ||![g.sourceHead,g.lastAnalyzedHead,g.builtFromHead].every(h=>h===null||auditHead(h))||![g.stale,g.needsUpdate].every(b=>b===null||typeof b==="boolean")
    ||!(g.integrityViolations===null||auditInteger(g.integrityViolations))||!["CURRENT","PARTIAL","STALE","INVALID","MISSING"].includes(g.structural as string)||!["CURRENT","PENDING"].includes(g.semantic as string)
    ||!auditRecord(c)||!auditExact(c,["declared","executed"])||!auditInteger(c.declared)||c.declared<1||!auditInteger(c.executed)||c.executed>c.declared
    ||!auditRecord(m)||!auditExact(m,["beforeDigest","afterDigest","complete","attribution","writerEvidenceDigest"])||!auditHash(m.beforeDigest)||!auditHash(m.afterDigest)||typeof m.complete!=="boolean"
    ||!["NONE","AUDIT","BACKGROUND","UNKNOWN"].includes(m.attribution as string)||!(m.writerEvidenceDigest===null||auditHash(m.writerEvidenceDigest)))return invalid();
  const reasons:string[]=[],rows:AyasAuditEvidence[]=[],seen=new Set<string>();
  for(const rawRow of v.evidence){
    if(!auditRecord(rawRow)||!auditExact(rawRow,["domain","checkId","checkVersion","evidenceClass","head","headIndependent","observedAt","sourceRef","sourceDigest","state","severity","findingCode","liveRequired"]))return invalid();
    const spec=AYAS_AUDIT_CHECKS.find(s=>s.id===rawRow.checkId);
    if(!spec||seen.has(spec.id)||rawRow.domain!==spec.domain||rawRow.checkVersion!==spec.version||rawRow.evidenceClass!==spec.evidenceClass||rawRow.sourceRef!==spec.sourceRef||rawRow.liveRequired!==spec.liveRequired
      ||!AUDIT_CLASSES.includes(rawRow.evidenceClass as never)||!AUDIT_STATES.includes(rawRow.state as never)||!AUDIT_SEVERITIES.includes(rawRow.severity as never)||!AUDIT_CODES.includes(rawRow.findingCode as never)
      ||!(rawRow.head===null||auditHead(rawRow.head))||typeof rawRow.headIndependent!=="boolean"||!auditTime(rawRow.observedAt)||Date.parse(rawRow.observedAt)>Date.parse(v.completedAt)
      ||!(rawRow.sourceDigest===null||auditHash(rawRow.sourceDigest))||rawRow.state==="PASS"&&rawRow.sourceDigest===null
      ||rawRow.headIndependent&&(rawRow.evidenceClass!=="EXTERNAL_OFFICIAL"||rawRow.head!==null)
      ||rawRow.state==="NOT_APPLICABLE"&&!spec.allowNotApplicable)return invalid();
    seen.add(spec.id);let state=rawRow.state as AyasAuditState;
    if(!rawRow.headIndependent&&rawRow.head!==v.head){state="STALE";reasons.push("HEAD_MISMATCH:"+spec.id);}
    if(Date.parse(v.completedAt)-Date.parse(rawRow.observedAt)>86400000){state="STALE";reasons.push("EVIDENCE_EXPIRED:"+spec.id);}
    if(state==="PASS"&&rawRow.findingCode==="KNOWN_LIMIT_REVIEW_REQUIRED"){state="BLOCKED";reasons.push("UNEXPECTED_KNOWN_LIMIT_PASS:"+spec.id);}
    rows.push({...rawRow,state,severity:state==="FAIL"||state==="BLOCKED"?"MAJOR":rawRow.severity} as unknown as AyasAuditEvidence);
  }
  for(const spec of AYAS_AUDIT_CHECKS)if(!seen.has(spec.id))reasons.push("MISSING_CHECK:"+spec.id);
  if(g.sourceHead!==v.head||g.lastAnalyzedHead!==v.head||g.builtFromHead!==v.head||g.stale!==false||g.needsUpdate!==false||g.integrityViolations!==0||!["CURRENT","PARTIAL"].includes(g.structural as string))reasons.push("GRAPH_NOT_CURRENT_OR_CORRUPT");
  if(m.beforeDigest!==m.afterDigest)reasons.push(m.attribution==="BACKGROUND"&&auditHash(m.writerEvidenceDigest)?"PROTECTED_BACKGROUND_CHANGE_REPORTED":"PROTECTED_CHANGE_UNATTRIBUTED");
  if(!m.complete)reasons.push("PROTECTED_SCOPE_INCOMPLETE");
  if(v.machineEvidenceAt!==null&&Date.parse(v.completedAt)-Date.parse(v.machineEvidenceAt)>86400000)reasons.push("MACHINE_EVIDENCE_EXPIRED");
  return freezeAudit({input:v as unknown as AyasSystemAuditInput,reasons,evidence:rows});
}
