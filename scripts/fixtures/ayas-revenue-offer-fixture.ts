/** Stage16.3A synthetic normalized receipts; no actual portfolio/account or delivery attestation. */
import type { AyasRevenueOfferFactoryInput } from "../../src/lib/ayas/revenue/AyasRevenueOfferFactory";
import { revenueFreeFirstFixture, revenueFreeFirstDigest as digest, REVENUE_FREE_FIRST_AT as AT } from "./ayas-revenue-free-first-fixture";
type Mutable<T> = T extends string ? string : T extends readonly (infer I)[] ? Mutable<I>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export type RevenueOfferFixture = Mutable<AyasRevenueOfferFactoryInput>;
export function revenueOfferFixture(): RevenueOfferFixture {
  const validationInput = revenueFreeFirstFixture(), artifactDigest = digest("portfolio-artifact");
  validationInput.evidence.find(e => e.kind === "LOCAL_DELIVERABLE_PROOF")!.referenceDigest = artifactDigest;
  return { schemaVersion: "1", validationInput,
    offer: { schemaVersion: "1", offerId: "offer-fixture", opportunityId: validationInput.opportunity.opportunityId, valuePropositionCode: "REUSABLE_ASSET", customerSegmentCode: "CREATORS", createdAt: AT,
      deliverables: [{ code: "DESIGN_ASSET", deliverableClass: "DIGITAL_ASSET", capabilityKey: "digital.design", units: 2 }],
      revisionSupport: { maxRevisions: 1, supportMinutes: 15, supportWindowDays: 7 }, deliveryWindowMinutes: 240,
      platformMappings: [{ platform: "lemon-squeezy", operation: "LISTING_DRAFT", templateCode: "ASSET_TEMPLATE" }] },
    fulfillmentProofs: [{ portfolioId: "portfolio-design", offerClass: "DIGITAL_ASSET", deliverableClass: "DIGITAL_ASSET", capabilityKey: "digital.design",
      capabilityProofDigest: digest("capability"), deliverableEvidenceDigest: digest("deliverable"), artifactDigest, qualityReceiptDigest: digest("quality-receipt"), qualityState: "PASS",
      rightsEvidenceDigest: digest("deliverable"), rightsState: "CLEAR", attributionRequired: false, attributionDigest: null,
      sourceClass: "LOCAL_MEASUREMENT", costClass: "local-zero-cost", measuredUnits: 10, measuredMinutes: 100, observedAt: AT, freshUntil: "2026-10-11T12:00:00.000Z" }],
    portfolio: [{ portfolioId: "portfolio-design", artifactDigest, deliverableClass: "DIGITAL_ASSET", capabilityKey: "digital.design", sourceClass: "LOCAL_ARTIFACT" }],
    capacity: { state: "MEASURED", windowMinutes: 240, maxWorkMinutes: 180, committedWorkMinutes: 30, observedAt: AT, evidenceDigest: digest("capacity-measurement") },
  };
}
