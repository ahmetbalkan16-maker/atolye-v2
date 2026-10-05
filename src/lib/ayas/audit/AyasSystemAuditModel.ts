/** Closed audit metadata. It carries no bodies, credentials, execution capability or grants. */
import { types } from "node:util";
export const AUDIT_DOMAINS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O"] as const;
export type AyasAuditDomain = typeof AUDIT_DOMAINS[number];
export const AUDIT_CLASSES = ["STATIC_SOURCE","DETERMINISTIC_TEST","LIVE_READ_ONLY","EXTERNAL_OFFICIAL","OWNER_DECISION"] as const;
export type AyasAuditClass = typeof AUDIT_CLASSES[number];
export const AUDIT_STATES = ["PASS","FAIL","BLOCKED","NOT_RUN","STALE","UNKNOWN","NOT_APPLICABLE"] as const;
export type AyasAuditState = typeof AUDIT_STATES[number];
export const AUDIT_SEVERITIES = ["INFO","MINOR","MAJOR","BLOCKER"] as const;
export type AyasAuditSeverity = typeof AUDIT_SEVERITIES[number];
export type AyasSystemClosureDecision = "OPEN" | "BLOCKED" | "STATIC_AUDIT_COMPLETE" | "LOCAL_VALIDATION_COMPLETE" | "FOUNDATION_CLOSED";
export const AUDIT_CODES = ["SOURCE_PRESENT","SOURCE_ABSENT","CHECK_PASSED","CHECK_FAILED","COLLECTOR_NOT_BOUND","HEAD_MISMATCH","EVIDENCE_EXPIRED","KNOWN_LIMIT_REVIEW_REQUIRED","OWNER_REVIEW_REQUIRED","NOT_APPLICABLE_REVIEWED","UNQUALIFIED_LIVE_PATH"] as const;
export interface AyasAuditEvidence {
  domain: AyasAuditDomain; checkId: string; checkVersion: 1; evidenceClass: AyasAuditClass; head: string | null;
  headIndependent: boolean; observedAt: string; sourceRef: string; sourceDigest: string | null; state: AyasAuditState;
  severity: AyasAuditSeverity; findingCode: typeof AUDIT_CODES[number]; liveRequired: boolean;
}
export interface AyasAuditGraph {
  sourceHead: string | null; lastAnalyzedHead: string | null; builtFromHead: string | null;
  stale: boolean | null; needsUpdate: boolean | null; integrityViolations: number | null;
  structural: "CURRENT" | "PARTIAL" | "STALE" | "INVALID" | "MISSING"; semantic: "CURRENT" | "PENDING";
}
export interface AyasSystemAuditInput {
  schemaVersion: "1"; auditId: string; branch: string; head: string; startedAt: string; completedAt: string;
  machineEvidenceAt: string | null; machineStatus: "ALLOW" | "THROTTLE" | "PAUSE" | "UNKNOWN"; graphify: AyasAuditGraph; evidence: AyasAuditEvidence[];
  coverage: {declared: number; executed: number};
  mutation: {beforeDigest: string; afterDigest: string; complete: boolean; attribution: "NONE" | "AUDIT" | "BACKGROUND" | "UNKNOWN"; writerEvidenceDigest: string | null};
  ownerReviewDigest: string | null;
}
export const auditHead = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
export const auditHash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export const auditTime = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const auditInteger = (v: unknown): v is number => Number.isSafeInteger(v) && !Object.is(v,-0) && (v as number) >= 0;
export const auditRecord = (v: unknown): v is Record<string,unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
export const auditExact = (v: Record<string,unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
export function freezeAudit<T>(v: T): T { if(v && typeof v === "object") { for(const child of Object.values(v)) freezeAudit(child); Object.freeze(v); } return v; }
/** Refuse native proxies, accessors, hidden/symbol properties, cycles and oversized inputs before serializing. */
export function snapshotAudit(raw: unknown): unknown {
  try { let count=0; const seen=new Set<object>();
    const visit=(v:unknown,depth:number):boolean=>{
      if(++count>100000 || depth>10) return false;
      if(v===null || typeof v==="boolean") return true;
      if(typeof v==="string") return v.length<=4096;
      if(typeof v==="number") return Number.isFinite(v) && !Object.is(v,-0);
      if(typeof v!=="object" || types.isProxy(v) || seen.has(v)) return false;
      const array=Array.isArray(v); if(!array && Object.getPrototypeOf(v)!==Object.prototype) return false;
      const keys=Reflect.ownKeys(v), descriptors=Object.getOwnPropertyDescriptors(v);
      if(keys.some(k=>typeof k!=="string" || (!(array&&k==="length") && !descriptors[k]!.enumerable))) return false;
      seen.add(v);const valid=keys.every(k=>Object.hasOwn(descriptors[k as string]!,"value") && visit(descriptors[k as string]!.value,depth+1));seen.delete(v);return valid;
    };
    if(!visit(raw,0) || JSON.stringify(raw).length>4*1024*1024) return null;
    return freezeAudit(structuredClone(raw));
  } catch { return null; }
}
