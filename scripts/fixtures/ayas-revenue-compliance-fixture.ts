/** Synthetic metadata: no actual platform permission, professional advice, account or owner decision. */
import { createHash } from "node:crypto";
import { AYAS_REVENUE_COMPLIANCE_REQUIREMENTS, type AyasRevenueComplianceInput } from "../../src/lib/ayas/revenue/compliance/AyasRevenueCompliance";
export const RC_NOW="2026-10-03T20:00:00.000Z";
export const rcDigest=(v:string)=>createHash("sha256").update("SYNTHETIC-COMPLIANCE:"+v).digest("hex");
export function rcInput(patch:Partial<AyasRevenueComplianceInput>={}):AyasRevenueComplianceInput {
  const scope={schemaVersion:"1" as const,platform:"etsy" as const,accountDigest:rcDigest("account"),offerDigest:rcDigest("offer"),operation:"LISTING_CREATE" as const,
    transport:"OFFICIAL_API" as const,termsDigest:rcDigest("terms"),scopeDigest:rcDigest("scope"),observedAt:RC_NOW,...patch};
  const records=AYAS_REVENUE_COMPLIANCE_REQUIREMENTS.map(requirement=>({requirement,state:"REVIEWED" as const,
    source:requirement==="ACCOUNT_STANDING"?"OFFICIAL_ACCOUNT_READER" as const:requirement==="AUTOMATION_PERMISSION"?
      (scope.transport==="MANUAL_HANDOFF"?"OWNER_REVIEW" as const:scope.platform==="etsy"||scope.platform==="upwork"?"PLATFORM_PERMISSION" as const:"OFFICIAL_REFERENCE" as const):
      requirement==="JURISDICTION"||requirement==="OFFER_RIGHTS"?"OWNER_REVIEW" as const:requirement==="TAX_REVIEW"||requirement==="LEGAL_REVIEW"?"PROFESSIONAL_REVIEW" as const:"OFFICIAL_REFERENCE" as const,
    evidenceDigest:rcDigest(requirement),observedAt:RC_NOW,platform:scope.platform,accountDigest:scope.accountDigest,offerDigest:scope.offerDigest,
    operation:scope.operation,termsDigest:scope.termsDigest,scopeDigest:scope.scopeDigest,
    automationBasis:requirement!=="AUTOMATION_PERMISSION"?"NOT_APPLICABLE" as const:scope.transport==="MANUAL_HANDOFF"?"MANUAL_ONLY" as const:
      scope.platform==="etsy"?"WRITTEN_PLATFORM_PERMISSION" as const:scope.platform==="upwork"?"APPROVED_API_USE_CASE" as const:"OFFICIAL_API_TERMS" as const}));
  return {...scope,records:patch.records??records};
}
export const rcRecord=(requirement:string,patch:Record<string,unknown>)=>({...rcInput(),records:rcInput().records.map(r=>r.requirement===requirement?{...r,...patch}:r)});
