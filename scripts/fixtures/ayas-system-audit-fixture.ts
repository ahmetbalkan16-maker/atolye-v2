import {AYAS_AUDIT_CHECKS} from "../../src/lib/ayas/audit/AyasSystemAuditRegistry";
import type {AyasSystemAuditInput} from "../../src/lib/ayas/audit/AyasSystemAuditModel";
import type {AyasGraphifyFacts} from "../../src/lib/ayas/developer/AyasGraphifyState";
export const AUDIT_NOW="2026-10-05T10:00:00.000Z",AUDIT_HEAD="1".repeat(40),AUDIT_HASH="a".repeat(64);
export function auditFixture():AyasSystemAuditInput{return {schemaVersion:"1",auditId:AUDIT_HASH,branch:"codex/audit-fixture",head:AUDIT_HEAD,startedAt:AUDIT_NOW,completedAt:AUDIT_NOW,machineEvidenceAt:AUDIT_NOW,machineStatus:"ALLOW",
  graphify:{sourceHead:AUDIT_HEAD,lastAnalyzedHead:AUDIT_HEAD,builtFromHead:AUDIT_HEAD,stale:false,needsUpdate:false,integrityViolations:0,structural:"CURRENT",semantic:"CURRENT"},
  evidence:AYAS_AUDIT_CHECKS.map(s=>({domain:s.domain,checkId:s.id,checkVersion:1,evidenceClass:s.evidenceClass,head:AUDIT_HEAD,headIndependent:false,observedAt:AUDIT_NOW,sourceRef:s.sourceRef,sourceDigest:AUDIT_HASH,state:"PASS",severity:"INFO",findingCode:"CHECK_PASSED",liveRequired:s.liveRequired})),
  coverage:{declared:163,executed:163},mutation:{beforeDigest:AUDIT_HASH,afterDigest:AUDIT_HASH,complete:true,attribution:"NONE",writerEvidenceDigest:null},ownerReviewDigest:null};}
export function auditFault(v:AyasSystemAuditInput,domain:string,fault:string){const row=(kind:string)=>v.evidence.find(e=>e.checkId===domain+"_"+kind)!;
  switch(fault){case "MISSING_SOURCE":v.evidence=v.evidence.filter(e=>e.checkId!==domain+"_SOURCE");break;case "OLD_SOURCE_HEAD":row("SOURCE").head="2".repeat(40);break;
    case "TEST_FAIL":row("TEST").state="FAIL";break;case "TEST_NOT_RUN":row("TEST").state="NOT_RUN";break;case "LIVE_NOT_RUN":row("LIVE").state="NOT_RUN";break;
    case "LIVE_FAIL":row("LIVE").state="FAIL";break;case "OLD_TEST_HEAD":row("TEST").head="2".repeat(40);break;case "OLD_LIVE_HEAD":row("LIVE").head="2".repeat(40);break;
    case "WRONG_CLASS":row("TEST").evidenceClass="OWNER_DECISION";break;case "OWNER_OVERRIDES_TEST":row("TEST").state="FAIL";v.ownerReviewDigest=AUDIT_HASH;break;default:throw Error("UNKNOWN_FIXTURE_FAULT");}return v;}
export function auditGraphFixture():AyasGraphifyFacts{return {sourceHead:AUDIT_HEAD,dirtyPaths:[],dirtyUncoveredPaths:[],worktreeFingerprint:null,branch:{lastSeenHead:AUDIT_HEAD,lastAnalyzedHead:AUDIT_HEAD,stale:false,staleReason:null},
  graph:{builtFromHead:AUDIT_HEAD,nodes:1,links:0,duplicateIds:0,duplicateEdges:0,dangling:0,selfLoops:0},needsUpdateFlag:false,semanticPendingMarker:false,extractionGaps:[],projectConfig:"VALID",cli:{available:true,version:"fixture"},localMcpServerAvailable:false,consumers:[]};}
