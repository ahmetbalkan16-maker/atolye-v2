/** Closed evidence vocabulary. Trust labels are descriptive; they never authenticate an owner. */
import { digestAyasRevenueData } from "../AyasRevenueDigest";
import { isAyasRevenueBoundedJson, deepFreezeAyasRevenueValue } from "../AyasRevenueRedaction";
export const AYAS_REVENUE_TRUST_CLASSES = Object.freeze(["LOCAL_TRUSTED_CODE","OWNER_CONFIRMED","OFFICIAL_PLATFORM_CANONICAL","OFFICIAL_PLATFORM_NOTIFICATION","EXTERNAL_UNTRUSTED_TEXT","EXTERNAL_UNTRUSTED_FILE","UNKNOWN"] as const);
export const AYAS_REVENUE_RISK_CODES = Object.freeze(["PROMPT_INJECTION","PHISHING_LINK","OFF_PLATFORM_PAYMENT_REQUEST","CREDENTIAL_REQUEST","MALICIOUS_ATTACHMENT","ARCHIVE_TRAVERSAL","EXECUTABLE_ATTACHMENT","FORGED_WEBHOOK","REPLAYED_WEBHOOK","CANONICAL_STATE_MISMATCH","ACCOUNT_TAKEOVER_SIGNAL","SESSION_SCOPE_DRIFT","MFA_OR_AUTH_CHANGE","UNKNOWN_TOOL_OR_SCOPE","UNEXPECTED_FINANCIAL_EFFECT","DUPLICATE_EXTERNAL_WRITE","RESOURCE_ID_CONFUSION","SECRET_LEAK","PII_OVEREXPOSURE","UNVERIFIED_SUPPORT_REQUEST","POLICY_BYPASS_DIRECTIVE","UNKNOWN_RISK"] as const);
export type AyasRevenueRiskCode = typeof AYAS_REVENUE_RISK_CODES[number];
export const AYAS_REVENUE_SECURITY_LIMITS = Object.freeze({ textBytes:262144,fileBytes:4*1024*1024,accountAgeMs:86400000,history:1000 });
/** Descriptor preflight precedes the single clone, including nested properties. */
export function revenueSecuritySnapshot(raw:unknown,maxBytes=65536):unknown {
  try { if(!isAyasRevenueBoundedJson(raw,maxBytes))return null;return deepFreezeAyasRevenueValue(structuredClone(raw)); } catch { return null; }
}
export function revenueRiskEvidence(codes:readonly AyasRevenueRiskCode[],material:unknown) {
  const risks=Object.freeze([...new Set(codes)].sort());
  return Object.freeze({risks,severity:risks.length?"BLOCKING" as const:"INFO" as const,reasonCode:risks[0]??"NO_DETECTED_RISK",materialDigest:digestAyasRevenueData(material),rawRetention:"NONE" as const,grantsAuthority:false as const,monetaryAuthority:"NONE" as const});
}
