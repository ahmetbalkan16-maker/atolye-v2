/** Frozen Stage16.3 fixture schema. Digests identify synthetic evidence, never live accounts or prices. */
import { createHash } from "node:crypto";
import type { AyasRevenueValidationInput } from "../../src/lib/ayas/revenue/AyasRevenueValidation";
type MutableFixture<T> = T extends string ? string : T extends readonly (infer I)[] ? MutableFixture<I>[] : T extends object ? { -readonly [K in keyof T]: MutableFixture<T[K]> } : T;
export type RevenueFreeFirstFixture = MutableFixture<AyasRevenueValidationInput>;
export const REVENUE_FREE_FIRST_AT = "2026-10-03T12:00:00.000Z";
export const REVENUE_FREE_FIRST_NOW = "2026-10-04T12:00:00.000Z";
export const revenueFreeFirstDigest = (tag: string): string => createHash("sha256").update(`stage16.3-fixture:${tag}`).digest("hex");
export function revenueFreeFirstFixture(): RevenueFreeFirstFixture {
  const digest = revenueFreeFirstDigest;
  const make = (tag: string, kind: string, sourceClass: string, facts: string[], platform = "lemon-squeezy", capabilityKey: string | null = null) => ({
    kind, sourceClass, opportunityId: "opportunity-fixture", platform, targetMarketCode: "TR", observedAt: REVENUE_FREE_FIRST_AT, freshUntil: "2026-11-01T12:00:00.000Z",
    costClass: sourceClass === "LOCAL_FACT" ? "local-zero-cost" : "free-public", confidence: 0.95,
    sourceIdentityDigest: digest(`source-${tag}`), evidenceDigest: digest(tag), referenceDigest: digest(`reference-${tag}`), capabilityKey, facts,
  });
  return {
    schemaVersion: "1", opportunity: { schemaVersion: "1", opportunityId: "opportunity-fixture", platform: "lemon-squeezy", offerType: "DIGITAL_PRODUCT",
      capabilityKeys: ["digital.design"], deliverableClass: "DIGITAL_ASSET", targetMarketCode: "TR", observedAt: REVENUE_FREE_FIRST_AT, authority: "NONE",
      hypothesis: { problemCode: "DESIGN_NEED", valuePropositionCode: "REUSABLE_ASSET", priceScenario: { valueMinor: 1000, currency: "USD" } } },
    scenario: { schemaVersion: "1", price: { label: "ASSUMED", amount: { valueMinor: 1000, currency: "USD" }, evidenceDigest: null },
      platformFee: { label: "OBSERVED", amount: { valueMinor: 100, currency: "USD" }, evidenceDigest: digest("fees") },
      paymentProcessingFee: { label: "OBSERVED", amount: { valueMinor: 50, currency: "USD" }, evidenceDigest: digest("fees") },
      deliveryCost: { label: "ASSUMED", amount: { valueMinor: 200, currency: "USD" }, evidenceDigest: null } },
    capabilities: [{ key: "digital.design", status: "AVAILABLE", proofDigest: digest("capability") }],
    prerequisites: [{ code: "LOCAL_VALIDATION", state: "READY", costClass: "local-zero-cost", evidenceDigest: digest("capability") },
      { code: "PLATFORM_READINESS", state: "READY", costClass: "free-public", evidenceDigest: digest("fees") }],
    rights: { state: "CLEAR", evidenceDigest: digest("deliverable") }, securityBlockers: [],
    evidence: [make("capability", "LOCAL_CAPABILITY", "LOCAL_FACT", ["CAPABILITY_AVAILABLE"], "MULTI", "digital.design"),
      make("deliverable", "LOCAL_DELIVERABLE_PROOF", "LOCAL_FACT", ["DELIVERABLE_PROVEN", "RIGHTS_CLEAR"], "MULTI"),
      make("demand-a", "PUBLIC_DEMAND_SIGNAL", "PUBLIC_FACT", ["DEMAND_OBSERVED"]),
      make("demand-b", "PUBLIC_DEMAND_SIGNAL", "PUBLIC_FACT", ["DEMAND_OBSERVED"]),
      make("competition", "PUBLIC_COMPETITION_SIGNAL", "PUBLIC_FACT", ["COMPETITION_OBSERVED", "DIFFERENTIATION_OBSERVED"]),
      make("fees", "PLATFORM_READ_ONLY_SIGNAL", "PLATFORM_FACT", ["FEE_SCHEDULE_OBSERVED"])],
  };
}
export function revenueFreeFirstPlatform(f: RevenueFreeFirstFixture, platform: string): void {
  f.opportunity.platform = platform; for (const e of f.evidence) if (e.platform !== "MULTI") e.platform = platform;
}
