/** Actual platform verification is reused. No generic verified flag or webhook executor exists. */
import { verifyAyasEtsyWebhook,type AyasEtsyWebhookInput } from "../adapters/etsy/AyasEtsyWebhook";
import { verifyAyasLemonWebhook,refreshAyasLemonVerifiedNotification } from "../adapters/lemon/AyasLemonWebhook";
import { revenueRiskEvidence } from "./AyasRevenueThreatModel";
export function inspectAyasEtsyRevenueWebhook(input:AyasEtsyWebhookInput) {
  const r=verifyAyasEtsyWebhook(input),codes=r.status==="DUPLICATE"?["REPLAYED_WEBHOOK" as const]:r.status==="REJECTED"?["FORGED_WEBHOOK" as const]:[];
  return Object.freeze({state:codes.length?"BLOCKED_WEBHOOK":"VERIFIED_NOTIFICATION_ONLY",canonicalReadRequired:true,timestampProtection:"SIGNED_5_MINUTE_WINDOW",durableDedupe:"UNBOUND",...revenueRiskEvidence(codes,r.pointer)});
}
export function inspectAyasLemonRevenueWebhook(...input:Parameters<typeof verifyAyasLemonWebhook>) {
  const r=verifyAyasLemonWebhook(...input),codes=r===null?["FORGED_WEBHOOK" as const]:r.state==="REPLAY"?["REPLAYED_WEBHOOK" as const]:[];
  return Object.freeze({state:codes.length?"BLOCKED_WEBHOOK":"VERIFIED_NOTIFICATION_ONLY",canonicalReadRequired:true,eventDigest:r?.eventDigest??null,timestampProtection:"NOT_PROVIDED_BY_PLATFORM",durableDedupe:"UNBOUND",...revenueRiskEvidence(codes,null)});
}
export async function rereadAyasLemonRevenueWebhook(...input:Parameters<typeof refreshAyasLemonVerifiedNotification>) {
  const r=await refreshAyasLemonVerifiedNotification(...input),codes=r.state==="REPLAY"?["REPLAYED_WEBHOOK" as const]:r.state!=="CANONICAL_FACTS_READY"?["CANONICAL_STATE_MISMATCH" as const]:[];
  // Mapping is deliberately excluded: signed notification/read truth cannot itself mutate money.
  return Object.freeze({state:codes.length?"BLOCKED_WEBHOOK":"CANONICAL_FACTS_OBSERVED",canonicalReadDigest:r.canonicalReadDigest??null,durableDedupe:"UNBOUND",writesLedger:false,externalWrite:false,...revenueRiskEvidence(codes,null)});
}
export const refuseUnknownAyasRevenueWebhook=()=>Object.freeze({state:"BLOCKED_WEBHOOK",...revenueRiskEvidence(["UNKNOWN_RISK"],null)});
