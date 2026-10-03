/** Owner review material only. No checkout, product, subscription or license API write exists here. */
import { digestAyasRevenueData } from "../../AyasRevenueDigest";
import { buildAyasRevenueOffer } from "../../AyasRevenueOfferFactory";
import { evaluateAyasRevenueFulfillment } from "../../AyasRevenueFulfillment";
import { isAyasRevenueDataArray, isAyasRevenueDigest, isAyasRevenueNeutralCode, isAyasRevenueScenarioMoney } from "../../AyasRevenueOpportunity";
import { containsAyasRevenueSensitiveData, deepFreezeAyasRevenueValue, hasExactAyasRevenueKeys, isAyasRevenuePlainRecord, isAyasRevenueSensitiveText, isAyasRevenueTimestamp } from "../../AyasRevenueRedaction";
import { lemonId, lemonInteger, snapshotAyasLemonValue } from "./AyasLemonSchemas";

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !isAyasRevenueSensitiveText(v)
  && !/[<>\u0000-\u0008\u000b-\u001f]|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|app|link)\b/i.test(v);
export function buildAyasLemonLocalDraft(raw: unknown, now: string): Readonly<Record<string, unknown>> | null {
  const p = snapshotAyasLemonValue(raw, 65_536); if (!isAyasRevenuePlainRecord(p) || containsAyasRevenueSensitiveData(p) || !isAyasRevenueTimestamp(now) || p.schemaVersion !== "1") return null;
  let draft: unknown, issues: string[] = [];
  if (p.kind === "PRODUCT") {
    if (!hasExactAyasRevenueKeys(p, ["schemaVersion", "kind", "title", "description", "version", "classCode", "price", "rightsEvidenceDigest", "fulfillmentOffer", "deliverableDigests", "taxNotes", "updatePolicy", "refundPolicyDigest"])
      || !text(p.title, 120) || !text(p.description, 3000) || !lemonInteger(p.version, 1, 10_000) || !isAyasRevenueNeutralCode(p.classCode) || !isAyasRevenueScenarioMoney(p.price)
      || !(p.rightsEvidenceDigest === null || isAyasRevenueDigest(p.rightsEvidenceDigest)) || !isAyasRevenueDataArray(p.deliverableDigests, 20) || p.deliverableDigests.length === 0
      || !p.deliverableDigests.every(isAyasRevenueDigest) || new Set(p.deliverableDigests).size !== p.deliverableDigests.length || !text(p.taxNotes, 500) || !text(p.updatePolicy, 500) || !isAyasRevenueDigest(p.refundPolicyDigest)) return null;
    const offer = buildAyasRevenueOffer(p.fulfillmentOffer, now);
    if (offer.status !== "OWNER_REVIEW_READY" || offer.offer === null || !offer.offer.platformMappings.some(x => x.platform === "lemon-squeezy") || offer.revision === null) return null;
    const input = p.fulfillmentOffer as Record<string, unknown>;
    const proofs = input.fulfillmentProofs as Record<string, unknown>[], portfolio = input.portfolio as Record<string, unknown>[];
    if (!p.deliverableDigests.every(d => proofs.some(x => x.artifactDigest === d) && portfolio.some(x => x.artifactDigest === d))
      || digestAyasRevenueData(p.price) !== digestAyasRevenueData(offer.offer.priceScenario.amount)) return null;
    if (p.rightsEvidenceDigest === null) issues.push("RIGHTS_EVIDENCE_MISSING");
    draft = { ...p, fulfillmentOffer: { revision: offer.revision, deliveryScenario: offer.deliveryScenario }, priceQualification: "HYPOTHETICAL_NOT_CANONICAL_QUOTE" };
  } else if (p.kind === "CHECKOUT_PLAN" || p.kind === "SUBSCRIPTION_PLAN") {
    if (!hasExactAyasRevenueKeys(p, ["schemaVersion", "kind", "storeRef", "productRef", "variantRef", "priceRef", "price", "sourceReadDigests", "fulfillmentDigest", "refundPolicyDigest", "commercialReviewDigest", "renewalInterval", "renewalCount"])
      || ![p.storeRef, p.productRef, p.variantRef, p.priceRef].every(x => lemonId(x) === x) || !isAyasRevenueScenarioMoney(p.price)
      || !isAyasRevenueDataArray(p.sourceReadDigests, 3) || p.sourceReadDigests.length !== 3 || !p.sourceReadDigests.every(isAyasRevenueDigest) || new Set(p.sourceReadDigests).size !== 3
      || !isAyasRevenueDigest(p.fulfillmentDigest) || !isAyasRevenueDigest(p.refundPolicyDigest) || !(p.commercialReviewDigest === null || isAyasRevenueDigest(p.commercialReviewDigest))) return null;
    if (p.kind === "SUBSCRIPTION_PLAN" ? !["day", "week", "month", "year"].includes(p.renewalInterval as string) || !lemonInteger(p.renewalCount, 1, 12) : p.renewalInterval !== null || p.renewalCount !== null) return null;
    issues = ["CURRENT_PRODUCT_VARIANT_PRICE_CURRENCY_PROOF_REQUIRED", "UNKNOWN_FEE_TAX_AND_SELLER_COMMITMENT", "SPEND_GATE_AND_EXACT_OWNER_APPROVAL_REQUIRED", "REVIEWED_WRITE_PATH_UNIMPLEMENTED"];
    draft = { ...p, priceQualification: "OWNER_SCENARIO_NOT_CURRENT_API_QUOTE" };
  } else if (p.kind === "LICENSE_DELIVERY_PLAN") {
    if (!hasExactAyasRevenueKeys(p, ["schemaVersion", "kind", "fulfillment", "licenseTermsDigest", "supportPolicyDigest"]) || !isAyasRevenueDigest(p.licenseTermsDigest) || !isAyasRevenueDigest(p.supportPolicyDigest)
      || !isAyasRevenuePlainRecord(p.fulfillment) || !isAyasRevenuePlainRecord(p.fulfillment.order) || p.fulfillment.order.platform !== "lemon-squeezy") return null;
    const f = evaluateAyasRevenueFulfillment(p.fulfillment, now); if (f.status !== "HANDOFF_READY" || f.deliveryManifest === null) return null;
    draft = { kind: p.kind, manifest: f.deliveryManifest, fulfillmentDigest: digestAyasRevenueData(f), licenseTermsDigest: p.licenseTermsDigest, supportPolicyDigest: p.supportPolicyDigest };
  } else return null;
  return deepFreezeAyasRevenueValue({ kind: p.kind, draft, draftDigest: digestAyasRevenueData(draft), issues, local: true, ownerReviewRequired: true,
    publication: "CLOSED", checkoutCreation: "CLOSED", subscriptionMutation: "CLOSED", licenseMutation: "CLOSED", externalWrite: false, monetaryMutation: false, authority: "NONE" });
}
