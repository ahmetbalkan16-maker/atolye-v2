/** Synthetic Fiverr drafts and explicit owner reports; no account, browser, delivery or payment. */
import { digestAyasRevenueData } from "../../src/lib/ayas/revenue/AyasRevenueDigest";
import { revenueFulfillmentFixture, REVENUE_FULFILLMENT_NOW } from "./ayas-revenue-fulfillment-fixture";
export const FIVERR_NOW = REVENUE_FULFILLMENT_NOW, FIVERR_ACCOUNT = "fiverr-owner-main";
export const fiverrDigest = (s: string) => digestAyasRevenueData({ synthetic: s })!;
export const fiverrMoney = (valueMinor: number, currency = "USD") => ({ valueMinor, currency });
export function fiverrGig(overrides: Record<string, unknown> = {}) { return { title: "I will design a clear city map", categoryCode: "GRAPHICS_DESIGN", description: "A custom map with agreed formats, dimensions and one revision.",
  faq: [{ question: "What is included?", answer: "Two map files and one revision." }], packages: [{ tier: "BASIC", name: "Map package", scope: "Two map files", price: fiverrMoney(1500), deliveryDays: 3, revisions: 1 }],
  requirements: ["Map area and output dimensions"], tags: ["map", "design"], mediaDigests: [fiverrDigest("media")], rightsEvidenceDigest: fiverrDigest("rights"), offerRevision: fiverrDigest("offer"), ...overrides }; }
export function fiverrMessage(overrides: Record<string, unknown> = {}) { return { purpose: "ORDER_REPLY", conversationDigest: fiverrDigest("conversation"), orderDigest: fiverrDigest("order"),
  text: "Please confirm the desired map dimensions before I prepare the files.", unresolvedQuestions: ["Which output dimensions?"], ...overrides }; }
export function fiverrDelivery(platform = "fiverr") { const fulfillment = revenueFulfillmentFixture(); fulfillment.order.platform = platform; fulfillment.offerInput.offer.platformMappings[0]!.platform = platform;
  fulfillment.offerInput.validationInput.opportunity.platform = platform;
  for (const e of fulfillment.offerInput.validationInput.evidence) if (e.platform === "lemon-squeezy") e.platform = platform;
  fulfillment.order.offerRevision = digestAyasRevenueData(fulfillment.offerInput)!;
  return { fulfillment, message: "Here are the prepared map files for your review." }; }
export function fiverrSnapshot(kind = "ACCOUNT", data: unknown = { state: "ACTIVE" }, overrides: Record<string, unknown> = {}) { return { schemaVersion: "1", platform: "fiverr", accountRef: FIVERR_ACCOUNT,
  kind, observedAt: FIVERR_NOW, evidenceDigest: fiverrDigest("owner-snapshot"), data, ...overrides }; }
export function fiverrEconomics(overrides: Record<string, unknown> = {}) { return { schemaVersion: "1", platform: "fiverr", source: "OWNER_INPUT", accountRef: FIVERR_ACCOUNT, eventRefDigest: fiverrDigest("economic-event"), orderDigest: fiverrDigest("order"),
  orderState: "COMPLETED_OBSERVED", completedAt: "2026-10-03T14:00:00.000Z", gross: fiverrMoney(1500), fee: fiverrMoney(300), payout: fiverrMoney(1200), payoutState: "WITHDRAWN_OBSERVED",
  cashMovementAt: "2026-10-03T14:30:00.000Z", observedAt: FIVERR_NOW, evidenceDigest: fiverrDigest("owner-economic-proof"), ...overrides }; }
