/** Stage16.3A:59 primary +10 frozen held-out. Pure local drafts, no platform/provider/storage effects. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildAyasRevenueOffer, AYAS_REVENUE_OFFER_DRAFT_OPERATION } from "../src/lib/ayas/revenue/AyasRevenueOfferFactory";
import { digestAyasRevenueData } from "../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenueLedgerEntry } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { revenueOfferFixture as fixture, type RevenueOfferFixture } from "./fixtures/ayas-revenue-offer-fixture";
import { revenueFreeFirstDigest as digest, revenueFreeFirstPlatform as platform, REVENUE_FREE_FIRST_AT as AT, REVENUE_FREE_FIRST_NOW as NOW } from "./fixtures/ayas-revenue-free-first-fixture";
const selected = process.env.AYAS_REVENUE_OFFER_MUTATION_CASE;
if (selected !== undefined) { const cwd = fs.realpathSync.native(process.cwd()); assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-offer-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(selected, /^[PH]\d{2}$/); }
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
const status = (raw: unknown, expected: string) => { const r = buildAyasRevenueOffer(raw, NOW); assert.equal(r.status, expected, r.reasonCodes.join(",")); assert.equal(r.authority, "NONE");
  assert.equal(r.sellableAutonomously, false); assert.equal(r.externalWrite, false); assert.equal(r.grantsSpendAuthority, false); if (r.deliveryScenario) assert.equal(r.deliveryScenario.reservedCapacity, false); return r; };
function run(set: "primary" | "held-out", id: string, name: string, body: () => void) { if (selected !== undefined && selected !== id) return;
  if (selected !== undefined) { body(); results.push({ id, set, ok: true }); return; }
  try { body(); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
}
const shared = (f: RevenueOfferFixture) => f.validationInput.evidence.find(e => e.kind === "LOCAL_DELIVERABLE_PROOF")!;
/** Separate deliverable and rights records, so each binding can fail alone. */
function split() {
  const f = fixture(), d = shared(f); d.facts = ["DELIVERABLE_PROVEN"];
  const r = { ...d, evidenceDigest: digest("rights-only"), sourceIdentityDigest: digest("source-rights-only"), facts: ["RIGHTS_CLEAR"] }; f.validationInput.evidence.push(r);
  f.validationInput.rights.evidenceDigest = r.evidenceDigest; f.fulfillmentProofs[0]!.rightsEvidenceDigest = r.evidenceDigest; return { f, d, r };
}
const p = (id: string, name: string, body: () => void) => run("primary", id, name, body);
const h = (id: string, name: string, body: () => void) => run("held-out", id, name, body);
function main() {
  p("P01", "bound proof produces an owner-review local offer", () => { const r = status(fixture(), "OWNER_REVIEW_READY"); assert.match(r.revision!, /^[a-f0-9]{64}$/); assert.equal(r.offer!.priceScenario.label, "ASSUMED"); assert.equal(r.deliveryScenario!.label, "ASSUMED"); assert.equal(r.deliveryScenario!.workMinutes, 75); assert.equal(r.deliveryScenario!.occupiedWindowMinutes, 105); });
  p("P02", "availability alone does not prove fulfillment", () => { const f = fixture(); f.fulfillmentProofs = []; status(f, "DRAFT_INCOMPLETE"); });
  p("P03", "missing capability blocks", () => { const f = fixture(); f.validationInput.capabilities[0]!.status = "MISSING"; status(f, "BLOCKED"); });
  p("P04", "degraded capability blocks", () => { const f = fixture(); f.validationInput.capabilities[0]!.status = "DEGRADED"; status(f, "BLOCKED"); });
  p("P05", "unmeasured quality is incomplete", () => { const f = fixture(); f.fulfillmentProofs[0]!.qualityState = "UNMEASURED"; status(f, "DRAFT_INCOMPLETE"); });
  p("P06", "failed quality blocks", () => { const f = fixture(); f.fulfillmentProofs[0]!.qualityState = "FAIL"; status(f, "BLOCKED"); });
  p("P07", "another deliverable class cannot prove this offer", () => { const f = fixture(); f.fulfillmentProofs[0]!.deliverableClass = "VIDEO"; status(f, "DRAFT_INCOMPLETE"); });
  p("P08", "another capability cannot prove this deliverable", () => { const f = fixture(); f.fulfillmentProofs[0]!.capabilityKey = "video.render"; status(f, "DRAFT_INCOMPLETE"); });
  p("P09", "portfolio hash mismatch invalidates sample", () => { const f = fixture(); f.portfolio[0]!.artifactDigest = digest("changed-file"); status(f, "DRAFT_INCOMPLETE"); });
  p("P10", "unknown sample rights cannot clear an offer", () => { const f = fixture(); f.fulfillmentProofs[0]!.rightsState = "UNKNOWN"; status(f, "DRAFT_INCOMPLETE"); });
  p("P11", "blocked sample rights block", () => { const f = fixture(); f.fulfillmentProofs[0]!.rightsState = "BLOCKED"; status(f, "BLOCKED"); });
  p("P12", "required attribution without proof is incomplete", () => { const f = fixture(); f.fulfillmentProofs[0]!.attributionRequired = true; status(f, "DRAFT_INCOMPLETE"); });
  p("P13", "paid fulfillment proof is rejected", () => { const f = fixture(); f.fulfillmentProofs[0]!.costClass = "paid"; status(f, "BLOCKED"); });
  p("P14", "model quality claim cannot replace measured proof", () => { const f = fixture(); f.fulfillmentProofs[0]!.sourceClass = "MODEL_OPINION"; status(f, "DRAFT_INCOMPLETE"); });
  p("P15", "stale sample is not current capability proof", () => { const f = fixture(); f.fulfillmentProofs[0]!.observedAt = "2026-08-01T12:00:00.000Z"; status(f, "DRAFT_INCOMPLETE"); });
  p("P16", "future sample cannot prove capability", () => { const f = fixture(); f.fulfillmentProofs[0]!.observedAt = "2026-10-05T12:00:00.000Z"; status(f, "DRAFT_INCOMPLETE"); });
  p("P17", "model-described portfolio is not a local artifact", () => { const f = fixture(); f.portfolio[0]!.sourceClass = "MODEL_DESCRIPTION"; status(f, "DRAFT_INCOMPLETE"); });
  p("P18", "missing portfolio artifact is incomplete", () => { const f = fixture(); f.portfolio = []; status(f, "DRAFT_INCOMPLETE"); });
  p("P19", "sample digest must match current deliverable evidence reference", () => { const f = fixture(); const x = f.validationInput.evidence.find(e => e.kind === "LOCAL_DELIVERABLE_PROOF")!; x.referenceDigest = digest("another-proof-artifact"); status(f, "DRAFT_INCOMPLETE"); });
  p("P20", "sample must match current capability proof digest", () => { const f = fixture(); f.fulfillmentProofs[0]!.capabilityProofDigest = digest("other-capability-proof"); status(f, "DRAFT_INCOMPLETE"); });
  p("P21", "sample must match accepted current deliverable evidence", () => { const f = fixture(); f.fulfillmentProofs[0]!.deliverableEvidenceDigest = digest("orphan-deliverable"); status(f, "DRAFT_INCOMPLETE"); });
  p("P22", "sample must match accepted current rights evidence", () => { const f = fixture(); f.fulfillmentProofs[0]!.rightsEvidenceDigest = digest("orphan-rights"); status(f, "DRAFT_INCOMPLETE"); });
  p("P23", "unknown capacity cannot promise delivery", () => { const f = fixture(); f.capacity = { state: "UNKNOWN", windowMinutes: null, maxWorkMinutes: null, committedWorkMinutes: null, observedAt: null, evidenceDigest: null }; status(f, "DRAFT_INCOMPLETE"); });
  p("P24", "stale capacity cannot promise delivery", () => { const f = fixture(); f.capacity.observedAt = "2026-08-01T12:00:00.000Z"; status(f, "DRAFT_INCOMPLETE"); });
  p("P25", "existing workload is included in capacity", () => { const f = fixture(); f.capacity.committedWorkMinutes = 150; status(f, "BLOCKED"); });
  p("P26", "capacity measurement must describe promised time window", () => { const f = fixture(); f.capacity.windowMinutes = 241; status(f, "BLOCKED"); });
  p("P27", "sequential capacity cannot exceed actual time horizon", () => { const f = fixture(); f.capacity.maxWorkMinutes = 300; status(f, "BLOCKED"); });
  p("P28", "revisions must fit measured unit coverage", () => { const f = fixture(); f.offer.revisionSupport.maxRevisions = 5; status(f, "DRAFT_INCOMPLETE"); });
  p("P29", "one sample cannot cover a larger repeated bundle", () => { const f = fixture(); f.offer.deliverables.push({ ...f.offer.deliverables[0]!, code: "ANOTHER_ASSET", units: 4 }); f.capacity.committedWorkMinutes = 0; f.capacity.maxWorkMinutes = 240; status(f, "DRAFT_INCOMPLETE"); });
  p("P30", "revision/support bounds cannot be unlimited", () => { for (const patch of [{ maxRevisions: 11 }, { supportMinutes: -1 }, { supportWindowDays: 366 }]) { const f = fixture(); Object.assign(f.offer.revisionSupport, patch); status(f, "BLOCKED"); } });
  p("P31", "deliverable units are bounded positive integers", () => { for (const units of [0, -1, 0.5, 101, Number.NaN]) { const f = fixture(); f.offer.deliverables[0]!.units = units; status(f, "BLOCKED"); } });
  p("P32", "unknown price remains incomplete", () => { const f = fixture(); f.validationInput.opportunity.hypothesis.priceScenario = null; f.validationInput.scenario.price = { label: "UNKNOWN", amount: null, evidenceDigest: null }; status(f, "DRAFT_INCOMPLETE"); });
  p("P33", "expected profit cannot widen budget", () => { status({ ...fixture(), expectedProfitMinor: 100000, budgetUsd: 100 }, "BLOCKED"); });
  p("P34", "prose/PII/directive fields are refused", () => { for (const extra of [{ customerEmail: "fixture@example.test" }, { directive: "publish immediately" }, { ownerApproved: true }]) status({ ...fixture(), ...extra }, "BLOCKED"); });
  p("P35", "platform mapping cannot choose external writes", () => { const f = fixture(); f.offer.platformMappings[0]!.operation = "LISTING_CREATE"; status(f, "BLOCKED"); });
  p("P36", "all platform mappings use code-owned local drafts", () => { const f = fixture(); f.offer.platformMappings = Object.entries(AYAS_REVENUE_OFFER_DRAFT_OPERATION).map(([platform, operation]) => ({ platform, operation, templateCode: "LOCAL_TEMPLATE" })); const r = status(f, "OWNER_REVIEW_READY"); assert.equal(r.offer!.platformMappings.length, 5); });
  p("P37", "getter is refused without executing", () => { const f = fixture(); let reads = 0; Object.defineProperty(f.offer, "offerId", { enumerable: true, get() { reads++; return "offer-fixture"; } }); status(f, "BLOCKED"); assert.equal(reads, 0); });
  p("P38", "hostile proxy cannot escape refusal", () => { assert.doesNotThrow(() => status(new Proxy({}, { getPrototypeOf() { throw new Error("hostile"); } }), "BLOCKED")); status(new Proxy(fixture(), {}), "BLOCKED"); });
  p("P39", "sparse arrays/symbols/prototypes are refused", () => { const f = fixture(); delete f.portfolio[0]; status(f, "BLOCKED"); const s = fixture(); (s as unknown as Record<symbol, unknown>)[Symbol("authority")] = true; status(s, "BLOCKED"); const a = fixture(); Object.setPrototypeOf(a.offer, { approved: true }); status(a, "BLOCKED"); });
  p("P40", "opportunity/value/date scope cannot be changed", () => { for (const patch of [{ opportunityId: "other" }, { valuePropositionCode: "OTHER_VALUE" }, { createdAt: "2026-10-05T12:00:00.000Z" }]) { const f = fixture(); Object.assign(f.offer, patch); status(f, "BLOCKED"); } });
  p("P41", "future price cannot be relabelled observed", () => { const f = fixture(); f.validationInput.scenario.price.label = "OBSERVED"; f.validationInput.scenario.price.evidenceDigest = digest("price"); status(f, "BLOCKED"); });
  p("P42", "negative economics cannot produce a ready offer", () => { const f = fixture(); f.validationInput.scenario.deliveryCost.amount!.valueMinor = 2000; status(f, "BLOCKED"); });
  p("P43", "measured time has a conservative buffer and support cost", () => { const f = fixture(); f.fulfillmentProofs[0]!.measuredMinutes = 101; const r = status(f, "OWNER_REVIEW_READY"); assert.equal(r.deliveryScenario!.workMinutes, 76); });
  p("P44", "object insertion order does not change revision identity", () => { const f = fixture(); const reversed = JSON.parse(JSON.stringify(f, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v)); assert.equal(status(f, "OWNER_REVIEW_READY").revision, status(reversed, "OWNER_REVIEW_READY").revision); assert.equal(digestAyasRevenueData({ b: 1, a: 2 }), digestAyasRevenueData({ a: 2, b: 1 })); });
  p("P45", "revision changes with commercial terms and snapshots freeze", () => { const f = fixture(); const r = status(f, "OWNER_REVIEW_READY"); f.offer.revisionSupport.supportMinutes = 16; assert.notEqual(status(f, "OWNER_REVIEW_READY").revision, r.revision); assert.equal(r.offer!.revisionSupport.supportMinutes, 15); assert.ok(Object.isFrozen(r.offer!.deliverables)); assert.ok(Object.isFrozen(r.deliveryScenario)); });
  p("P46", "missing quality digest is schema-invalid", () => { const f = fixture(); f.fulfillmentProofs[0]!.qualityReceiptDigest = ""; status(f, "BLOCKED"); });
  p("P47", "a different offer class cannot borrow quality proof", () => { const f = fixture(); f.fulfillmentProofs[0]!.offerClass = "COURSE_PACKAGE"; status(f, "DRAFT_INCOMPLETE"); });
  p("P48", "all outcomes retain authority NONE and no reserved slot", () => { const a = fixture(); const b = fixture(); b.fulfillmentProofs = []; const c = fixture(); c.offer.platformMappings[0]!.operation = "FUNDS_WITHDRAW"; status(a, "OWNER_REVIEW_READY"); status(b, "DRAFT_INCOMPLETE"); status(c, "BLOCKED"); });
  p("P49", "core and yardstick cannot rewrite themselves or call IO", () => { for (const file of ["src/lib/ayas/revenue/AyasRevenueOfferFactory.ts", "src/lib/ayas/revenue/AyasRevenueDigest.ts", "scripts/smoke-ayas-revenue-offer-factory.ts", "scripts/smoke-ayas-revenue-offer-factory-mutations.ts", "scripts/fixtures/ayas-revenue-offer-fixture.ts", "docs/AYAS_REVENUE_OFFER_FACTORY.md"]) assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS", file);
    for (const file of ["AyasRevenueOfferFactory.ts", "AyasRevenueDigest.ts"]) assert.doesNotMatch(fs.readFileSync(`src/lib/ayas/revenue/${file}`, "utf8"), /node:(?:fs|http|https|child_process)|fetch\s*\(|process\.env|LedgerStore|AdapterRegistry/); });
  p("P50", "measurements cannot be zero, negative or fractional", () => { for (const value of [0, -1, 0.5, 10001, Number.NaN]) { const f = fixture(); f.fulfillmentProofs[0]!.measuredUnits = value; status(f, "BLOCKED"); } for (const value of [0, -1, 0.5, 43201]) { const f = fixture(); f.fulfillmentProofs[0]!.measuredMinutes = value; status(f, "BLOCKED"); } });
  p("P51", "deliverable or rights proof bound to another capability cannot prove this deliverable", () => { const a = split(); a.d.capabilityKey = "video.render"; status(a.f, "DRAFT_INCOMPLETE");
    const b = split(); b.r.capabilityKey = "video.render"; status(b.f, "DRAFT_INCOMPLETE"); const c = split(); c.d.capabilityKey = "digital.design"; c.r.capabilityKey = "digital.design"; status(c.f, "OWNER_REVIEW_READY"); });
  p("P52", "deliverable capability outside the validated opportunity blocks", () => { const f = fixture(); f.offer.deliverables[0]!.capabilityKey = "video.render"; f.fulfillmentProofs[0]!.capabilityKey = "video.render"; f.portfolio[0]!.capabilityKey = "video.render";
    f.validationInput.capabilities.push({ key: "video.render", status: "AVAILABLE", proofDigest: digest("capability") }); status(f, "BLOCKED"); });
  p("P53", "service offer with uncertain global rights stays incomplete", () => { const f = fixture(); platform(f.validationInput, "upwork"); f.validationInput.opportunity.offerType = "FREELANCE_SERVICE";
    f.offer.platformMappings = [{ platform: "upwork", operation: "PROPOSAL_DRAFT", templateCode: "SERVICE_TEMPLATE" }]; f.validationInput.rights.state = "UNCERTAIN"; status(f, "DRAFT_INCOMPLETE"); });
  p("P54", "owner-review opportunity with contradicted deliverable proof stays incomplete", () => { const f = fixture(); platform(f.validationInput, "MULTI"); const d = shared(f);
    f.validationInput.evidence.push({ ...d, evidenceDigest: digest("deliverable-contradiction"), sourceIdentityDigest: digest("source-deliverable-contradiction"), facts: ["DELIVERABLE_NOT_PROVEN"] }); status(f, "DRAFT_INCOMPLETE"); });
  p("P55", "uncorroborated demand cannot produce an offer", () => { const f = fixture(); f.validationInput.evidence = f.validationInput.evidence.filter(e => e.evidenceDigest !== digest("demand-b")); status(f, "DRAFT_INCOMPLETE"); });
  p("P56", "stale deliverable or rights evidence cannot back a sample", () => { for (const field of ["deliverableEvidenceDigest", "rightsEvidenceDigest"] as const) { const f = fixture(), d = shared(f), stale = digest("deliverable-stale");
    f.validationInput.evidence.push({ ...d, evidenceDigest: stale, sourceIdentityDigest: digest("source-deliverable-stale"), observedAt: "2026-08-01T12:00:00.000Z", freshUntil: "2026-08-02T12:00:00.000Z" }); f.fulfillmentProofs[0]![field] = stale; status(f, "DRAFT_INCOMPLETE"); } });
  p("P57", "deliverable and rights evidence are each bound to the sample artifact and fact", () => { status(split().f, "OWNER_REVIEW_READY");
    const a = split(); a.d.referenceDigest = digest("other-artifact"); status(a.f, "DRAFT_INCOMPLETE"); const b = split(); b.r.referenceDigest = digest("other-artifact"); status(b.f, "DRAFT_INCOMPLETE");
    const c = split(); c.f.fulfillmentProofs[0]!.deliverableEvidenceDigest = c.r.evidenceDigest; status(c.f, "DRAFT_INCOMPLETE"); const e = split(); e.f.fulfillmentProofs[0]!.rightsEvidenceDigest = e.d.evidenceDigest; status(e.f, "DRAFT_INCOMPLETE");
    const low = split(); low.f.validationInput.evidence.push({ ...low.d, evidenceDigest: digest("deliverable-low"), sourceIdentityDigest: digest("source-deliverable-low"), confidence: 0.7 }); low.f.fulfillmentProofs[0]!.deliverableEvidenceDigest = digest("deliverable-low"); status(low.f, "DRAFT_INCOMPLETE"); });
  p("P58", "portfolio entry must name the same sample, deliverable and capability", () => { for (const patch of [{ portfolioId: "portfolio-other" }, { deliverableClass: "VIDEO" }, { capabilityKey: "video.render" }]) { const f = fixture(); Object.assign(f.portfolio[0]!, patch); status(f, "DRAFT_INCOMPLETE"); } });
  p("P59", "the slowest covering sample sets the delivery scenario", () => { const f = fixture(), d = shared(f), artifact = digest("portfolio-artifact-2"), evidence = digest("deliverable-2");
    f.validationInput.evidence.push({ ...d, evidenceDigest: evidence, sourceIdentityDigest: digest("source-deliverable-2"), referenceDigest: artifact }); f.portfolio.push({ ...f.portfolio[0]!, portfolioId: "portfolio-design-2", artifactDigest: artifact });
    f.fulfillmentProofs.push({ ...f.fulfillmentProofs[0]!, portfolioId: "portfolio-design-2", artifactDigest: artifact, deliverableEvidenceDigest: evidence, rightsEvidenceDigest: evidence, measuredMinutes: 200 });
    assert.equal(status(f, "OWNER_REVIEW_READY").deliveryScenario!.workMinutes, 135); });
  // Frozen before initial run; independent platform/quantity/rights/economics combinations.
  h("H01", "Fiverr model sample is still incomplete", () => { const f = fixture(); platform(f.validationInput, "fiverr"); f.fulfillmentProofs[0]!.sourceClass = "MODEL_OPINION"; status(f, "DRAFT_INCOMPLETE"); });
  h("H02", "Udemy course cannot reuse generic asset proof", () => { const f = fixture(); platform(f.validationInput, "udemy"); f.validationInput.opportunity.offerType = "COURSE"; f.validationInput.opportunity.deliverableClass = "COURSE_PACKAGE"; status(f, "DRAFT_INCOMPLETE"); });
  h("H03", "Upwork freelance source offer has local proposal mapping", () => { const f = fixture(); platform(f.validationInput, "upwork"); f.validationInput.opportunity.offerType = "FREELANCE_SERVICE"; f.offer.offerId = "123"; f.offer.platformMappings = [{ platform: "upwork", operation: "PROPOSAL_DRAFT", templateCode: "SERVICE_TEMPLATE" }]; status(f, "OWNER_REVIEW_READY"); });
  h("H04", "multi-platform fixture remains owner-review-only", () => { const f = fixture(); platform(f.validationInput, "MULTI"); status(f, "OWNER_REVIEW_READY"); });
  h("H05", "zero-price JPY offer remains explicitly hypothetical", () => { const f = fixture(); f.validationInput.opportunity.hypothesis.priceScenario = { valueMinor: 0, currency: "JPY" }; for (const q of [f.validationInput.scenario.price, f.validationInput.scenario.platformFee, f.validationInput.scenario.paymentProcessingFee, f.validationInput.scenario.deliveryCost]) q.amount = { valueMinor: 0, currency: "JPY" }; const r = status(f, "OWNER_REVIEW_READY"); assert.equal(r.offer!.priceScenario.label, "ASSUMED"); });
  h("H06", "Etsy unknown capacity prevents delivery promise", () => { const f = fixture(); platform(f.validationInput, "etsy"); f.capacity = { state: "UNKNOWN", windowMinutes: null, maxWorkMinutes: null, committedWorkMinutes: null, observedAt: null, evidenceDigest: null }; status(f, "DRAFT_INCOMPLETE"); });
  h("H07", "a faster deadline cannot exceed measured scenario", () => { const f = fixture(); f.offer.deliveryWindowMinutes = 60; f.capacity.windowMinutes = 60; f.capacity.maxWorkMinutes = 60; f.capacity.committedWorkMinutes = 0; status(f, "BLOCKED"); });
  h("H08", "global rights uncertainty overrides attractive measured sample", () => { const f = fixture(); f.validationInput.rights.state = "UNCERTAIN"; status(f, "BLOCKED"); });
  h("H09", "offer price is not a realized ledger input", () => { const r = status(fixture(), "OWNER_REVIEW_READY"); assert.throws(() => createAyasRevenueLedgerEntry(r.offer, AT), /AYAS_REVENUE_LEDGER_INVALID_INPUT/); assert.throws(() => createAyasRevenueLedgerEntry(r.offer!.priceScenario, AT), /AYAS_REVENUE_LEDGER_INVALID_INPUT/); });
  h("H10", "duplicated portfolio bytes cannot make two samples", () => { const f = fixture(); f.portfolio.push({ ...f.portfolio[0]!, portfolioId: "another-portfolio" }); status(f, "BLOCKED"); });
  if (selected === undefined) { assert.equal(results.filter(r => r.set === "primary").length, 59); assert.equal(results.filter(r => r.set === "held-out").length, 10); } else assert.equal(results.length, 1);
  console.log(JSON.stringify({ status: results.every(r => r.ok) ? "PASS" : "FAIL", primary: { passed: results.filter(r => r.set === "primary" && r.ok).length, total: results.filter(r => r.set === "primary").length },
    heldOut: { passed: results.filter(r => r.set === "held-out" && r.ok).length, total: results.filter(r => r.set === "held-out").length }, authority: "NONE", results }, null, 2)); if (results.some(r => !r.ok)) process.exitCode = 1;
}
main();
