/** External/model supplied severity or trust never lowers a detected risk. Unknown input blocks. */
import { AYAS_REVENUE_RISK_CODES,revenueRiskEvidence,revenueSecuritySnapshot,type AyasRevenueRiskCode } from "./AyasRevenueThreatModel";
export function classifyAyasRevenueRisk(raw:unknown) {
  try { const value=revenueSecuritySnapshot(raw);if(!Array.isArray(value)||value.length>AYAS_REVENUE_RISK_CODES.length||!value.every(v=>(AYAS_REVENUE_RISK_CODES as readonly unknown[]).includes(v)))return revenueRiskEvidence(["UNKNOWN_RISK"],null);
    return revenueRiskEvidence(value as AyasRevenueRiskCode[],null);
  } catch { return revenueRiskEvidence(["UNKNOWN_RISK"],null); }
}
