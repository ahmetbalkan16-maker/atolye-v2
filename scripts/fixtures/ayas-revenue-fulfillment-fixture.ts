/** Stage16.3B synthetic order receipts; no actual customer, platform order, file delivery or payment. */
import type { AyasRevenueFulfillmentInput } from "../../src/lib/ayas/revenue/AyasRevenueFulfillment";
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { revenueOfferFixture } from "./ayas-revenue-offer-fixture";
import { revenueFreeFirstDigest as digest } from "./ayas-revenue-free-first-fixture";
type Mutable<T> = T extends string ? string : T extends readonly (infer I)[] ? Mutable<I>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export type RevenueFulfillmentFixture = Mutable<AyasRevenueFulfillmentInput>;
export const REVENUE_FULFILLMENT_ACCEPTED_AT = "2026-10-03T13:00:00.000Z";
export const REVENUE_FULFILLMENT_NOW = "2026-10-03T15:00:00.000Z";
export function revenueFulfillmentArtifact(tag: string, round = 0): RevenueFulfillmentFixture["artifacts"][number] {
  return { deliverableCode: "DESIGN_ASSET", round, artifactDigest: digest(`delivery-${tag}`), bytes: 2048, mediaClass: "IMAGE_PNG", producedAt: "2026-10-03T14:00:00.000Z",
    costClass: "local-zero-cost", rightsState: "CLEAR", rightsEvidenceDigest: digest("delivery-rights"), attributionRequired: false, attributionDigest: null };
}
export function revenueFulfillmentReceipt(tag: string, state = "PASS", sourceClass = "DETERMINISTIC_CHECK"): RevenueFulfillmentFixture["qa"][number] {
  return { artifactDigest: digest(`delivery-${tag}`), checkCode: "FORMAT_CHECK", state, sourceClass, receiptDigest: digest(`qa-${tag}-${state}-${sourceClass}`), checkedAt: "2026-10-03T14:10:00.000Z" };
}
export function revenueFulfillmentFixture(): RevenueFulfillmentFixture {
  const offerInput = revenueOfferFixture();
  return { schemaVersion: "1", offerInput,
    order: { orderId: "order-fixture", offerId: offerInput.offer.offerId, offerRevision: digestAyasRevenueData(offerInput)!, platform: "lemon-squeezy",
      acceptedAt: REVENUE_FULFILLMENT_ACCEPTED_AT, deadlineAt: "2026-10-03T17:00:00.000Z", revisionsAllowed: 1, round: 0, deliverables: [{ code: "DESIGN_ASSET", units: 2 }] },
    requirements: [{ deliverableCode: "DESIGN_ASSET", code: "FORMAT", state: "COMPLETE", evidenceDigest: digest("requirement-format") },
      { deliverableCode: "DESIGN_ASSET", code: "DIMENSIONS", state: "COMPLETE", evidenceDigest: digest("requirement-dimensions") }],
    artifacts: [revenueFulfillmentArtifact("1"), revenueFulfillmentArtifact("2")],
    qa: [revenueFulfillmentReceipt("1"), revenueFulfillmentReceipt("2")],
    handoff: { state: "NOT_STARTED", manifestDigest: null, handedOffAt: null, evidenceDigest: null },
    completion: { state: "NOT_OBSERVED", sourceClass: null, observedAt: null, evidenceDigest: null },
  };
}
