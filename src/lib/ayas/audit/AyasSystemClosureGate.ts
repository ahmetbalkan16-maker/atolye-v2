import {freezeAudit,type AyasSystemClosureDecision} from "./AyasSystemAuditModel";
import {AYAS_AUDIT_CHECKS} from "./AyasSystemAuditRegistry";
import {assessAyasSystemAudit} from "./AyasSystemAuditPolicy";
export function evaluateAyasSystemClosure(raw:unknown){
  const a=assessAyasSystemAudit(raw),out=(decision:AyasSystemClosureDecision,reasons:readonly string[])=>freezeAudit({decision,reasons,assessment:a,
    grantsAuthority:false as const,executionAuthority:"NONE" as const,autonomousSpend:0 as const,evidenceVerification:"NORMALIZED_METADATA_NOT_ATTESTATION" as const,ownerPromotion:"SEPARATE_OWNER_REVIEW_REQUIRED" as const});
  if(!a.input)return out("BLOCKED",a.reasons);
  if(a.reasons.some(r=>r.startsWith("GRAPH_")||r.startsWith("PROTECTED_")||r.startsWith("UNEXPECTED_"))||a.evidence.some(e=>e.state==="FAIL"||e.state==="BLOCKED"))return out("BLOCKED",a.reasons);
  const passed=(kind:string)=>AYAS_AUDIT_CHECKS.filter(s=>s.kind===kind).every(s=>a.evidence.some(e=>e.checkId===s.id&&e.state==="PASS"));
  if(!passed("SOURCE"))return out("BLOCKED",[...a.reasons,"SOURCE_COVERAGE_INCOMPLETE"]);
  if(!passed("TEST")||!passed("LIVE"))return out("STATIC_AUDIT_COMPLETE",[...a.reasons,"LOCAL_OR_LIVE_QUALIFICATION_INCOMPLETE"]);
  if(a.input.coverage.executed!==a.input.coverage.declared||a.input.ownerReviewDigest===null||a.input.machineEvidenceAt===null||a.input.machineStatus!=="ALLOW"||a.reasons.includes("MACHINE_EVIDENCE_EXPIRED"))return out("LOCAL_VALIDATION_COMPLETE",[...a.reasons,"FULL_BASELINE_MACHINE_OR_OWNER_REVIEW_INCOMPLETE"]);
  const owner=a.evidence.find(e=>e.checkId==="O_LIVE");
  if(owner?.sourceDigest!==a.input.ownerReviewDigest)return out("LOCAL_VALIDATION_COMPLETE",[...a.reasons,"OWNER_REVIEW_DIGEST_MISMATCH"]);
  return out("FOUNDATION_CLOSED",a.reasons);
}
