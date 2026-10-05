import {AUDIT_DOMAINS,freezeAudit} from "./AyasSystemAuditModel";
import {evaluateAyasSystemClosure} from "./AyasSystemClosureGate";
export function buildAyasSystemAuditReport(raw:unknown){const closure=evaluateAyasSystemClosure(raw);return freezeAudit({schemaVersion:"1" as const,
  auditId:closure.assessment.input?.auditId??null,head:closure.assessment.input?.head??null,branch:closure.assessment.input?.branch??null,
  startedAt:closure.assessment.input?.startedAt??null,completedAt:closure.assessment.input?.completedAt??null,
  domains:AUDIT_DOMAINS.map(domain=>({domain,evidence:closure.assessment.evidence.filter(e=>e.domain===domain),qualified:closure.assessment.evidence.filter(e=>e.domain===domain&&e.state==="PASS").length})),
  closure:closure.decision,reasons:closure.reasons,coverage:closure.assessment.input?.coverage??null,
  mutation:closure.assessment.input?.mutation??null,grantsAuthority:false as const,executionAuthority:"NONE" as const,autonomousSpend:0 as const,
  evidenceVerification:closure.evidenceVerification,ownerPromotion:closure.ownerPromotion});}
