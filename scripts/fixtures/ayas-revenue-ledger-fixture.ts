/** Deterministic non-personal Stage16.2 facts; no live root or network. */
import { createAyasRevenueLedgerEntry, digestAyasRevenueExternalId, validateAyasRevenueLedgerState,
  type AyasRevenueEconomicEvent, type AyasRevenueLedgerInput, type AyasRevenueLedgerState } from "../../src/lib/ayas/revenue/AyasRevenueLedger";
export const REVENUE_LEDGER_FIXTURE_AT = "2026-10-03T12:00:00.000Z";
export function revenueLedgerFixtureFact(tag: string, event: AyasRevenueEconomicEvent = "GROSS_REVENUE", valueMinor = 1000,
  patch: Record<string, unknown> = {}): AyasRevenueLedgerInput {
  return { schemaVersion: "1", platform: "etsy", event, amount: { valueMinor, currency: "USD" }, occurredAt: REVENUE_LEDGER_FIXTURE_AT,
    externalEventDigest: digestAyasRevenueExternalId(tag), orderDigest: digestAyasRevenueExternalId("fixture-order-one"),
    offerDigest: digestAyasRevenueExternalId("fixture-offer-one"), activityDigest: digestAyasRevenueExternalId("fixture-activity-one"),
    evidence: { source: "OWNER_IMPORT", adapterId: null, adapterVersion: null, observedAt: REVENUE_LEDGER_FIXTURE_AT, evidenceDigest: digestAyasRevenueExternalId(`evidence-${tag}`) },
    reversesEntryId: null, notesCode: null, ...patch } as AyasRevenueLedgerInput;
}
export function revenueLedgerFixtureState(...facts: readonly AyasRevenueLedgerInput[]): AyasRevenueLedgerState {
  return validateAyasRevenueLedgerState({ schemaVersion: "1", revision: facts.length, entries: facts.map((v) => createAyasRevenueLedgerEntry(v, REVENUE_LEDGER_FIXTURE_AT)) });
}
