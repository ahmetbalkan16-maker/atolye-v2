/** Stage16.3B:61 primary +10 frozen held-out. Pure order gate, no delivery/platform/provider/ledger/storage effects. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { evaluateAyasRevenueFulfillment, AYAS_REVENUE_FULFILLMENT_STATUSES } from "../src/lib/ayas/revenue/AyasRevenueFulfillment";
import { digestAyasRevenueData } from "../src/lib/ayas/revenue/AyasRevenueDigest";
import { createAyasRevenueLedgerEntry } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { revenueFulfillmentFixture as fixture, revenueFulfillmentArtifact as artifact, revenueFulfillmentReceipt as receipt, type RevenueFulfillmentFixture,
  REVENUE_FULFILLMENT_NOW as NOW } from "./fixtures/ayas-revenue-fulfillment-fixture";
import { revenueFreeFirstDigest as digest, revenueFreeFirstPlatform as platform } from "./fixtures/ayas-revenue-free-first-fixture";
const selected = process.env.AYAS_REVENUE_FULFILLMENT_MUTATION_CASE;
if (selected !== undefined) { const cwd = fs.realpathSync.native(process.cwd()); assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-fulfillment-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(selected, /^[PH]\d{2}$/); }
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
const status = (raw: unknown, expected: string, now = NOW) => { const r = evaluateAyasRevenueFulfillment(raw, now); assert.equal(r.status, expected, r.reasonCodes.join(","));
  assert.equal(r.authority, "NONE"); assert.equal(r.deliversAutonomously, false); assert.equal(r.externalWrite, false); assert.equal(r.grantsSpendAuthority, false); assert.equal(r.createsLedgerEntry, false);
  assert.equal(r.realizedLedgerEligible, r.status === "COMPLETED_OBSERVED"); assert.ok(AYAS_REVENUE_FULFILLMENT_STATUSES.includes(r.status)); return r; };
const HANDOFF = "2026-10-03T14:30:00.000Z", OBSERVED = "2026-10-03T14:45:00.000Z";
/** The owner hands off exactly the manifest the gate produced. */
function handedOff(f: RevenueFulfillmentFixture, at = HANDOFF, now = NOW, expected = "HANDOFF_READY") {
  const ready = status(f, expected, now); f.handoff = { state: "HANDED_OFF", manifestDigest: ready.deliveryManifest!.digest, handedOffAt: at, evidenceDigest: digest("handoff") }; return f;
}
function observed(f: RevenueFulfillmentFixture, state: string, at = OBSERVED, sourceClass: string | null = "PLATFORM_READ") {
  f.completion = { state, sourceClass, observedAt: at, evidenceDigest: digest(`completion-${state}`) }; return f;
}
/** Round-1 artifacts produced after the round-0 receipts. */
function roundOne(f: RevenueFulfillmentFixture) {
  f.order.round = 1; for (const tag of ["r1-1", "r1-2"]) { f.artifacts.push({ ...artifact(tag, 1), producedAt: "2026-10-03T14:20:00.000Z" }); f.qa.push({ ...receipt(tag), checkedAt: "2026-10-03T14:25:00.000Z" }); } return f;
}
function run(set: "primary" | "held-out", id: string, name: string, body: () => void) { if (selected !== undefined && selected !== id) return;
  if (selected !== undefined) { body(); results.push({ id, set, ok: true }); return; }
  try { body(); results.push({ id, set, ok: true }); } catch (e) { results.push({ id, set, ok: false, detail: `${name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }); }
}
const p = (id: string, name: string, body: () => void) => run("primary", id, name, body);
const h = (id: string, name: string, body: () => void) => run("held-out", id, name, body);
function main() {
  p("P01", "complete passing order is ready for owner handoff only", () => { const r = status(fixture(), "HANDOFF_READY"); assert.equal(r.deliveryManifest!.items.length, 2); assert.match(r.deliveryManifest!.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(r.deadline, { state: "ON_TRACK", remainingMinutes: 120, plannedWorkMinutes: 75 }); assert.deepEqual(r.reasonCodes, ["OWNER_HANDOFF_REQUIRED"]); assert.equal(r.orderId, "order-fixture"); assert.equal(r.round, 0); });
  p("P02", "missing requirement needs clarification", () => { const f = fixture(); f.requirements[0]!.state = "MISSING"; status(f, "REQUIREMENTS_INCOMPLETE"); });
  p("P03", "ambiguous requirement needs clarification", () => { const f = fixture(); f.requirements[1]!.state = "AMBIGUOUS"; status(f, "REQUIREMENTS_INCOMPLETE"); });
  p("P04", "complete requirement needs evidence", () => { const f = fixture(); f.requirements[0]!.evidenceDigest = null; status(f, "REQUIREMENTS_INCOMPLETE"); });
  p("P05", "a deliverable without any requirement is incomplete", () => { const f = fixture(); f.requirements = []; status(f, "REQUIREMENTS_INCOMPLETE"); });
  p("P06", "out-of-scope requirement is an unsupported promise", () => { const f = fixture(); f.requirements[0]!.state = "OUT_OF_SCOPE"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P07", "requirement for an unordered deliverable is unbound", () => { const f = fixture(); f.requirements.push({ deliverableCode: "OTHER_ASSET", code: "FORMAT", state: "COMPLETE", evidenceDigest: digest("other") }); status(f, "BLOCKED"); });
  p("P08", "more units than the offer is unsupported", () => { const f = fixture(); f.order.deliverables[0]!.units = 3; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P09", "a deliverable outside the offer is unsupported", () => { const f = fixture(); f.order.deliverables[0]!.code = "VIDEO_EDIT"; f.requirements.forEach(r => r.deliverableCode = "VIDEO_EDIT"); f.artifacts.forEach(a => a.deliverableCode = "VIDEO_EDIT"); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P10", "more revisions than the offer is unsupported", () => { const f = fixture(); f.order.revisionsAllowed = 2; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P11", "a round beyond the revision budget is unsupported", () => { const f = fixture(); f.order.revisionsAllowed = 0; f.order.round = 1; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P12", "a deadline faster than the offer window is unsupported", () => { const f = fixture(); f.order.deadlineAt = "2026-10-03T16:59:00.000Z"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNSUPPORTED_PROMISE"]); });
  p("P13", "deadline at or before acceptance is invalid", () => { const f = fixture(); f.order.deadlineAt = f.order.acceptedAt; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["INVALID_ORDER_TIMELINE"]); });
  p("P14", "order must name the exact offer revision", () => { const f = fixture(); f.order.offerRevision = digest("older-offer"); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["OFFER_REVISION_OR_PLATFORM_MISMATCH"]); });
  p("P15", "order must name the same offer", () => { const f = fixture(); f.order.offerId = "other-offer"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["OFFER_REVISION_OR_PLATFORM_MISMATCH"]); });
  p("P16", "order platform must be a mapped platform", () => { const f = fixture(); f.order.platform = "etsy"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["OFFER_REVISION_OR_PLATFORM_MISMATCH"]); });
  p("P17", "an offer without fulfillment proof cannot be sold", () => { const f = fixture(); f.offerInput.fulfillmentProofs = []; f.order.offerRevision = digestAyasRevenueData(f.offerInput)!; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["OFFER_NOT_PROVEN_AT_ACCEPTANCE"]); });
  p("P18", "future acceptance is invalid", () => { const f = fixture(); f.order.acceptedAt = "2026-10-03T15:30:00.000Z"; f.order.deadlineAt = "2026-10-03T20:00:00.000Z"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["INVALID_ORDER_TIMELINE"]); });
  p("P19", "one of two units is still in production", () => { const f = fixture(); f.artifacts.pop(); f.qa.pop(); const r = status(f, "IN_PRODUCTION"); assert.equal(r.deliveryManifest, null); assert.equal(r.deadline!.state, "ON_TRACK"); });
  p("P20", "little time left before a planned remaining workload is at risk", () => { const f = fixture(); f.artifacts.pop(); f.qa.pop(); const r = status(f, "IN_PRODUCTION", "2026-10-03T16:00:00.000Z");
    assert.equal(r.deadline!.state, "AT_RISK"); assert.deepEqual(r.reasonCodes, ["DEADLINE_AT_RISK", "PASSING_ARTIFACTS_INCOMPLETE"]); });
  p("P21", "a missed deadline without handoff needs the owner", () => { const f = fixture(); f.artifacts.pop(); f.qa.pop(); const r = status(f, "OWNER_REVIEW_REQUIRED", "2026-10-03T17:01:00.000Z"); assert.equal(r.deadline!.state, "MISSED"); assert.deepEqual(r.reasonCodes, ["DEADLINE_MISSED"]); assert.equal(r.deliveryManifest, null); });
  p("P22", "a failed unreplaced artifact needs rework", () => { const f = fixture(); f.qa.push({ ...receipt("2", "FAIL"), checkedAt: "2026-10-03T14:20:00.000Z" }); status(f, "QA_REWORK_REQUIRED"); });
  p("P23", "a replaced failed artifact is excluded from the manifest", () => { const f = fixture(); f.qa.push(receipt("2", "FAIL")); f.artifacts.push(artifact("3")); f.qa.push(receipt("3"));
    const r = status(f, "HANDOFF_READY"); assert.deepEqual(r.deliveryManifest!.items.map(i => i.artifactDigest).sort(), [digest("delivery-1"), digest("delivery-3")].sort()); });
  p("P24", "unmeasured quality is still production", () => { const f = fixture(); f.qa[1] = receipt("2", "UNMEASURED"); status(f, "IN_PRODUCTION"); });
  p("P25", "a model opinion cannot pass quality", () => { const f = fixture(); f.qa[1] = receipt("2", "PASS", "MODEL_OPINION"); status(f, "IN_PRODUCTION"); });
  p("P26", "owner review and local measurement count as quality checks", () => { const f = fixture(); f.qa[0] = receipt("1", "PASS", "OWNER_REVIEW"); f.qa[1] = receipt("2", "PASS", "LOCAL_MEASUREMENT"); status(f, "HANDOFF_READY"); });
  p("P27", "a receipt cannot predate the file it checks", () => { const f = fixture(); f.qa[0]!.checkedAt = "2026-10-03T13:59:00.000Z"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNBOUND_FULFILLMENT_RECORD"]); });
  p("P28", "a receipt for an unknown file is unbound", () => { const f = fixture(); f.qa.push(receipt("missing")); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNBOUND_FULFILLMENT_RECORD"]); });
  p("P29", "unknown artifact rights are not deliverable", () => { const f = fixture(); f.artifacts[0]!.rightsState = "UNKNOWN"; status(f, "IN_PRODUCTION"); });
  p("P30", "clear rights without evidence are not deliverable", () => { const f = fixture(); f.artifacts[0]!.rightsEvidenceDigest = null; status(f, "IN_PRODUCTION"); });
  p("P31", "blocked artifact rights block the order", () => { const f = fixture(); f.artifacts[0]!.rightsState = "BLOCKED"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["ARTIFACT_RIGHTS_BLOCKED"]); });
  p("P32", "required attribution needs proof", () => { const f = fixture(); f.artifacts[0]!.attributionRequired = true; status(f, "IN_PRODUCTION"); f.artifacts[0]!.attributionDigest = digest("attribution"); status(f, "HANDOFF_READY"); });
  p("P33", "paid or unknown production cost blocks", () => { for (const cost of ["paid", "subscription", "metered-free-tier", "unknown-cost"]) { const f = fixture(); f.artifacts[0]!.costClass = cost; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["NONZERO_OR_UNKNOWN_FULFILLMENT_COST"]); } });
  p("P34", "an artifact for an unordered deliverable is unbound", () => { const f = fixture(); f.artifacts.push({ ...artifact("x"), deliverableCode: "OTHER_ASSET" }); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNBOUND_FULFILLMENT_RECORD"]); });
  p("P35", "an artifact from a future round is unbound", () => { const f = fixture(); f.artifacts.push(artifact("x", 1)); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["UNBOUND_FULFILLMENT_RECORD"]); });
  p("P36", "one file cannot count twice in one round", () => { const f = fixture(); f.artifacts[1] = { ...artifact("1") }; f.qa.pop(); status(f, "BLOCKED"); });
  p("P37", "a future file is invalid", () => { const f = fixture(); f.artifacts[0]!.producedAt = "2026-10-03T15:01:00.000Z"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["INVALID_ORDER_TIMELINE"]); });
  p("P38", "handoff of the gated manifest awaits observed completion", () => { const r = status(handedOff(fixture()), "AWAITING_OBSERVED_COMPLETION"); assert.equal(r.deadline!.state, "MET_AT_HANDOFF"); assert.equal(r.deliveryManifest!.items.length, 2); });
  p("P39", "handoff of a different manifest is refused", () => { const f = handedOff(fixture()); f.handoff.manifestDigest = digest("other-manifest"); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["HANDOFF_MANIFEST_MISMATCH"]); });
  p("P40", "files changed after handoff break the manifest binding", () => { const f = handedOff(fixture()); f.artifacts[1]!.bytes = 4096; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["HANDOFF_MANIFEST_MISMATCH"]); });
  p("P41", "handoff before the quality gate is refused", () => { const f = handedOff(fixture()); f.qa[1] = receipt("2", "UNMEASURED"); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["HANDOFF_BEFORE_QUALITY_GATE"]); });
  p("P42", "handoff with incomplete requirements is refused", () => { const f = handedOff(fixture()); f.requirements[0]!.state = "AMBIGUOUS"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["HANDOFF_BEFORE_QUALITY_GATE"]); });
  p("P43", "late handoff is recorded as missed, not hidden", () => { const f = fixture(); const r = status(handedOff(f, "2026-10-03T17:30:00.000Z", "2026-10-03T18:00:00.000Z", "OWNER_REVIEW_REQUIRED"), "AWAITING_OBSERVED_COMPLETION", "2026-10-03T18:00:00.000Z"); assert.equal(r.deadline!.state, "MISSED_AT_HANDOFF"); });
  p("P44", "handoff before acceptance is invalid", () => { const f = handedOff(fixture()); f.handoff.handedOffAt = "2026-10-03T12:59:00.000Z"; assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["INVALID_ORDER_TIMELINE"]); });
  p("P45", "platform-observed acceptance completes the order without writing money", () => { const r = status(observed(handedOff(fixture()), "ACCEPTED"), "COMPLETED_OBSERVED"); assert.equal(r.realizedLedgerEligible, true); assert.deepEqual(r.reasonCodes, ["REALIZED_MONEY_STILL_REQUIRES_LEDGER_EVIDENCE"]); });
  p("P46", "owner-recorded acceptance also completes", () => { status(observed(handedOff(fixture()), "ACCEPTED", OBSERVED, "OWNER_INPUT"), "COMPLETED_OBSERVED"); });
  p("P47", "completion observed before handoff is invalid", () => { const f = observed(handedOff(fixture()), "ACCEPTED", "2026-10-03T14:29:00.000Z"); assert.deepEqual(status(f, "BLOCKED").reasonCodes, ["INVALID_ORDER_TIMELINE"]); });
  p("P48", "acceptance or revision request without handoff is refused", () => { for (const s of ["ACCEPTED", "REVISION_REQUESTED"]) assert.deepEqual(status(observed(fixture(), s), "BLOCKED").reasonCodes, ["COMPLETION_WITHOUT_HANDOFF"]); });
  p("P49", "revision request within budget opens the next round", () => { status(observed(handedOff(fixture()), "REVISION_REQUESTED"), "REVISION_REQUIRED"); });
  p("P50", "revision request beyond budget needs the owner", () => { const f = handedOff(roundOne(fixture())); assert.deepEqual(status(observed(f, "REVISION_REQUESTED"), "OWNER_REVIEW_REQUIRED").reasonCodes, ["REVISION_BUDGET_EXHAUSTED"]); });
  p("P51", "a new round does not reuse the previous round's files", () => { const f = fixture(); f.order.round = 1; const r = status(f, "IN_PRODUCTION"); assert.equal(r.round, 1); status(roundOne(fixture()), "HANDOFF_READY"); });
  p("P52", "an old receipt does not pass re-produced bytes", () => { const f = fixture(); f.order.round = 1; f.artifacts.push({ ...artifact("1", 1), producedAt: "2026-10-03T14:20:00.000Z" }, { ...artifact("2", 1), producedAt: "2026-10-03T14:20:00.000Z" }); status(f, "IN_PRODUCTION"); });
  p("P53", "dispute and cancellation need the owner", () => { assert.deepEqual(status(observed(handedOff(fixture()), "DISPUTED"), "OWNER_REVIEW_REQUIRED").reasonCodes, ["ORDER_DISPUTED"]);
    assert.deepEqual(status(observed(fixture(), "CANCELLED"), "OWNER_REVIEW_REQUIRED").reasonCodes, ["ORDER_CANCELLED"]); });
  p("P54", "completion evidence must come from the platform or owner with a digest", () => { status(observed(handedOff(fixture()), "ACCEPTED", OBSERVED, "MODEL_OPINION"), "BLOCKED");
    const f = observed(handedOff(fixture()), "ACCEPTED"); f.completion.evidenceDigest = null; status(f, "BLOCKED"); const g = handedOff(fixture()); g.handoff.evidenceDigest = null; status(g, "BLOCKED"); });
  p("P55", "a gate result is not a ledger fact", () => { const r = status(observed(handedOff(fixture()), "ACCEPTED"), "COMPLETED_OBSERVED"); assert.throws(() => createAyasRevenueLedgerEntry(r, NOW), /AYAS_REVENUE_LEDGER_INVALID_INPUT/);
    assert.throws(() => createAyasRevenueLedgerEntry(r.deliveryManifest, NOW), /AYAS_REVENUE_LEDGER_INVALID_INPUT/); });
  p("P56", "manifest identity ignores record order and binds file bytes", () => { const f = fixture(), g = fixture(); g.artifacts.reverse(); g.qa.reverse(); const a = status(f, "HANDOFF_READY"), b = status(g, "HANDOFF_READY");
    assert.equal(a.deliveryManifest!.digest, b.deliveryManifest!.digest); g.artifacts[0]!.bytes = 4097; assert.notEqual(status(g, "HANDOFF_READY").deliveryManifest!.digest, a.deliveryManifest!.digest);
    const other = fixture(); other.order.orderId = "order-other"; assert.notEqual(status(other, "HANDOFF_READY").deliveryManifest!.digest, a.deliveryManifest!.digest); });
  p("P57", "prose, PII and directive fields are refused", () => { for (const extra of [{ customerEmail: "fixture@example.test" }, { directive: "deliver now" }, { ownerApproved: true }]) status({ ...fixture(), ...extra }, "BLOCKED");
    const f = fixture(); (f.order as Record<string, unknown>).autoDeliver = true; status(f, "BLOCKED"); });
  p("P58", "getters, hostile proxies, sparse arrays, symbols and prototypes are refused", () => { const f = fixture(); let reads = 0; Object.defineProperty(f.order, "orderId", { enumerable: true, get() { reads++; return "order-fixture"; } });
    status(f, "BLOCKED"); assert.equal(reads, 0); assert.doesNotThrow(() => status(new Proxy({}, { getPrototypeOf() { throw new Error("hostile"); } }), "BLOCKED")); status(new Proxy(fixture(), {}), "BLOCKED");
    const s = fixture(); delete s.artifacts[0]; status(s, "BLOCKED"); const y = fixture(); (y as unknown as Record<symbol, unknown>)[Symbol("authority")] = true; status(y, "BLOCKED"); const z = fixture(); Object.setPrototypeOf(z.handoff, { state: "HANDED_OFF" }); status(z, "BLOCKED"); });
  p("P59", "results are frozen snapshots", () => { const f = fixture(); const r = status(f, "HANDOFF_READY"); f.artifacts[0]!.bytes = 1; assert.equal(r.deliveryManifest!.items.find(i => i.artifactDigest === digest("delivery-1"))!.bytes, 2048);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.deliveryManifest!.items) && Object.isFrozen(r.deadline)); });
  p("P60", "core and yardstick cannot rewrite themselves or call IO", () => { for (const file of ["src/lib/ayas/revenue/AyasRevenueFulfillment.ts", "scripts/smoke-ayas-revenue-fulfillment-gate.ts", "scripts/smoke-ayas-revenue-fulfillment-gate-mutations.ts",
    "scripts/fixtures/ayas-revenue-fulfillment-fixture.ts", "docs/AYAS_REVENUE_FULFILLMENT_GATE.md"]) assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS", file);
    assert.doesNotMatch(fs.readFileSync("src/lib/ayas/revenue/AyasRevenueFulfillment.ts", "utf8"), /node:(?:fs|http|https|child_process)|fetch\s*\(|process\.env|LedgerStore|AdapterRegistry/); });
  p("P61", "a complete late order keeps its gated manifest for an owner-chosen late handoff", () => { const late = "2026-10-03T17:01:00.000Z", a = status(fixture(), "OWNER_REVIEW_REQUIRED", late);
    assert.notEqual(a.deliveryManifest, null); assert.equal(a.deliveryManifest!.digest, status(fixture(), "HANDOFF_READY").deliveryManifest!.digest); const f = fixture(); f.requirements[0]!.state = "AMBIGUOUS"; assert.equal(status(f, "OWNER_REVIEW_REQUIRED", late).deliveryManifest, null); });
  // Frozen before the first run: independent platform, quantity, revision and timing combinations.
  h("H01", "Upwork service order is gated like any other", () => { const f = fixture(); platform(f.offerInput.validationInput, "upwork"); f.offerInput.validationInput.opportunity.offerType = "FREELANCE_SERVICE";
    f.offerInput.offer.platformMappings = [{ platform: "upwork", operation: "PROPOSAL_DRAFT", templateCode: "SERVICE_TEMPLATE" }]; f.order.platform = "upwork"; f.order.offerRevision = digestAyasRevenueData(f.offerInput)!; status(f, "HANDOFF_READY"); });
  h("H02", "ordering one of two offered units needs one file", () => { const f = fixture(); f.order.deliverables[0]!.units = 1; f.artifacts.pop(); f.qa.pop(); assert.equal(status(f, "HANDOFF_READY").deliveryManifest!.items.length, 1); });
  h("H03", "a pass and a fail on the same file is not a pass", () => { const f = fixture(); f.qa.push(receipt("1", "FAIL", "LOCAL_MEASUREMENT")); status(f, "QA_REWORK_REQUIRED"); });
  h("H04", "cancellation after handoff needs the owner", () => { status(observed(handedOff(fixture()), "CANCELLED"), "OWNER_REVIEW_REQUIRED"); });
  h("H05", "late but accepted delivery completes and stays marked late", () => { const now = "2026-10-03T19:00:00.000Z"; const f = handedOff(fixture(), "2026-10-03T17:30:00.000Z", now, "OWNER_REVIEW_REQUIRED");
    const r = status(observed(f, "ACCEPTED", "2026-10-03T18:00:00.000Z"), "COMPLETED_OBSERVED", now); assert.equal(r.deadline!.state, "MISSED_AT_HANDOFF"); });
  h("H06", "a zero-revision offer escalates any revision request", () => { const f = fixture(); f.offerInput.offer.revisionSupport.maxRevisions = 0; f.order.revisionsAllowed = 0; f.order.offerRevision = digestAyasRevenueData(f.offerInput)!;
    status(observed(handedOff(f), "REVISION_REQUESTED"), "OWNER_REVIEW_REQUIRED"); });
  h("H07", "an extra passing file is delivered, not hidden", () => { const f = fixture(); f.artifacts.push(artifact("3")); f.qa.push(receipt("3")); assert.equal(status(f, "HANDOFF_READY").deliveryManifest!.items.length, 3); });
  h("H08", "paid work in an earlier round is still surfaced", () => { const f = roundOne(fixture()); f.artifacts[0]!.costClass = "paid"; status(f, "BLOCKED"); });
  h("H09", "a fully passing order at the deadline minute is still ready", () => { const r = status(fixture(), "HANDOFF_READY", "2026-10-03T17:00:00.000Z"); assert.equal(r.deadline!.remainingMinutes, 0); });
  h("H10", "an order accepted after the offer's proof expired is refused", () => { const f = fixture(); f.order.acceptedAt = "2026-10-11T13:00:00.000Z"; f.order.deadlineAt = "2026-10-11T17:00:00.000Z";
    status(f, "BLOCKED", "2026-10-11T15:00:00.000Z"); });
  if (selected === undefined) { assert.equal(results.filter(r => r.set === "primary").length, 61); assert.equal(results.filter(r => r.set === "held-out").length, 10); } else assert.equal(results.length, 1);
  console.log(JSON.stringify({ status: results.every(r => r.ok) ? "PASS" : "FAIL", primary: { passed: results.filter(r => r.set === "primary" && r.ok).length, total: results.filter(r => r.set === "primary").length },
    heldOut: { passed: results.filter(r => r.set === "held-out" && r.ok).length, total: results.filter(r => r.set === "held-out").length }, authority: "NONE", results }, null, 2)); if (results.some(r => !r.ok)) process.exitCode = 1;
}
main();
