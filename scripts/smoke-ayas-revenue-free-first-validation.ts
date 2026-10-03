/** Stage16.3: 66 primary +12 frozen held-out, deterministic pure validation. No live acquisition or mutation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateAyasRevenueFreeFirst, AYAS_REVENUE_VALIDATION_STATUSES } from "../src/lib/ayas/revenue/AyasRevenueValidation";
import { computeAyasRevenueScenarioEconomics } from "../src/lib/ayas/revenue/AyasRevenueScenarioEconomics";
import { snapshotAyasRevenueOpportunity } from "../src/lib/ayas/revenue/AyasRevenueOpportunity";
import { createAyasRevenueLedgerEntry } from "../src/lib/ayas/revenue/AyasRevenueLedger";
import { decideAyasRevenueSpend } from "../src/lib/ayas/revenue/AyasRevenueSpendPolicy";
import { classifyPatchTarget } from "../src/lib/brain/selfheal/BrainPatchSafety";
import { REVENUE_FREE_FIRST_AT as AT, REVENUE_FREE_FIRST_NOW as NOW, revenueFreeFirstDigest as digest, revenueFreeFirstFixture as fixture,
  revenueFreeFirstPlatform as platform, type RevenueFreeFirstFixture as Fixture } from "./fixtures/ayas-revenue-free-first-fixture";
const selected = process.env.AYAS_REVENUE_FREE_FIRST_MUTATION_CASE;
if (selected !== undefined) { const cwd = fs.realpathSync.native(process.cwd()); assert.equal(path.dirname(cwd).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(cwd).startsWith("ayas-revenue-free-first-audit-")); assert.ok(!fs.existsSync(path.join(cwd, ".git"))); assert.match(selected, /^[PH]\d{2}$/); }
const results: { id: string; set: string; ok: boolean; detail?: string }[] = [];
const e = (f: Fixture, kind: string) => f.evidence.find(e => e.kind === kind)!;
const demands = (f: Fixture) => f.evidence.filter(e => e.kind === "PUBLIC_DEMAND_SIGNAL");
const status = (f: unknown, expected: string, now = NOW) => { const r = validateAyasRevenueFreeFirst(f, now); assert.equal(r.status, expected, r.reasonCodes.join(","));
  assert.equal(r.authority, "NONE"); assert.equal(r.grantsActionAuthority, false); assert.equal(r.grantsSpendAuthority, false); assert.equal(r.realizedLedgerVerified, false); return r; };
function run(set: "primary" | "held-out", id: string, name: string, body: () => void) {
  if (selected !== undefined && selected !== id) return;
  if (selected !== undefined) { body(); results.push({ id, set, ok: true }); return; }
  try { body(); results.push({ id, set, ok: true }); } catch (err) { results.push({ id, set, ok: false, detail: `${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }); }
}
const p = (id: string, name: string, body: () => void) => run("primary", id, name, body);
const h = (id: string, name: string, body: () => void) => run("held-out", id, name, body);
const unknown = () => ({ label: "UNKNOWN", amount: null, evidenceDigest: null });
function main() {
  p("P01", "fresh corroborated free evidence gives conditional pilot advice", () => { const r = status(fixture(), "PILOT_CANDIDATE"); assert.equal(Object.keys(r.dimensions).length, 10);
    assert.ok(r.scenario?.valid); assert.equal(r.scenario.contribution.amount!.valueMinor, 650); assert.equal(r.scenario.contribution.label, "ASSUMED"); assert.equal(r.scenario.realized, false); });
  p("P02", "every status is reachable and grants no authority", () => {
    const all: string[] = []; const f = fixture(); all.push(status(f, "PILOT_CANDIDATE").status);
    f.securityBlockers.push("SECURITY"); all.push(status(f, "BLOCKED").status); f.securityBlockers = [];
    f.evidence = f.evidence.filter(e => e.kind !== "PUBLIC_DEMAND_SIGNAL"); all.push(status(f, "INSUFFICIENT_EVIDENCE").status);
    const u = fixture(); u.scenario.platformFee = unknown(); all.push(status(u, "RESEARCH_REQUIRED").status);
    const d = fixture(); e(d, "LOCAL_DELIVERABLE_PROOF").facts = ["RIGHTS_CLEAR"]; all.push(status(d, "FREE_VALIDATION_READY").status);
    const n = fixture(); n.scenario.deliveryCost.amount!.valueMinor = 2000; all.push(status(n, "DO_NOT_PURSUE").status);
    const o = fixture(); o.prerequisites[1]!.state = "OWNER_REQUIRED"; all.push(status(o, "OWNER_REVIEW_REQUIRED").status);
    assert.deepEqual([...new Set(all)].sort(), [...AYAS_REVENUE_VALIDATION_STATUSES].sort());
  });
  p("P03", "model opinion cannot prove demand", () => { const f = fixture(); for (const x of f.evidence) if (x.kind.startsWith("PUBLIC_")) x.sourceClass = "MODEL_OPINION"; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P04", "missing local capability blocks", () => { const f = fixture(); f.capabilities[0]!.status = "MISSING"; status(f, "BLOCKED"); });
  p("P05", "degraded local capability blocks", () => { const f = fixture(); f.capabilities[0]!.status = "DEGRADED"; status(f, "BLOCKED"); });
  p("P06", "claim without a proof digest blocks", () => { const f = fixture(); f.capabilities[0]!.proofDigest = null; status(f, "BLOCKED"); });
  p("P07", "separate current missing-capability evidence defeats positive proof", () => { const f = fixture(); const x = structuredClone(e(f, "LOCAL_CAPABILITY")); x.evidenceDigest = digest("negative-cap"); x.facts = ["CAPABILITY_MISSING"]; f.evidence.push(x); status(f, "BLOCKED"); });
  p("P08", "weak capability confidence cannot prove production", () => { const f = fixture(); e(f, "LOCAL_CAPABILITY").confidence = 0.7; status(f, "BLOCKED"); });
  p("P09", "unproven deliverable needs local free validation", () => { const f = fixture(); e(f, "LOCAL_DELIVERABLE_PROOF").facts = ["DELIVERABLE_NOT_PROVEN", "RIGHTS_CLEAR"]; status(f, "FREE_VALIDATION_READY"); });
  p("P10", "separate current unproven-deliverable evidence defeats positive proof", () => { const f = fixture(); const x = structuredClone(e(f, "LOCAL_DELIVERABLE_PROOF")); x.evidenceDigest = digest("negative-deliv"); x.facts = ["DELIVERABLE_NOT_PROVEN"]; f.evidence.push(x); status(f, "FREE_VALIDATION_READY"); });
  p("P11", "paid prerequisite blocks", () => { const f = fixture(); f.prerequisites[0]!.costClass = "paid"; status(f, "BLOCKED"); });
  p("P12", "unknown prerequisite cost blocks", () => { const f = fixture(); f.prerequisites[0]!.costClass = "unknown-cost"; status(f, "BLOCKED"); });
  p("P13", "unknown prerequisite state blocks", () => { const f = fixture(); f.prerequisites[0]!.state = "UNKNOWN"; status(f, "BLOCKED"); });
  p("P14", "missing mandatory prerequisite blocks", () => { const f = fixture(); f.prerequisites.pop(); status(f, "BLOCKED"); });
  p("P15", "paid evidence cannot satisfy a free pilot", () => { const f = fixture(); demands(f)[0]!.costClass = "paid"; status(f, "BLOCKED"); });
  p("P16", "metered/subscription/unknown evidence remains denied", () => { for (const cost of ["metered-free-tier", "subscription", "unknown-cost"]) { const f = fixture(); demands(f)[0]!.costClass = cost; status(f, "BLOCKED"); } });
  p("P17", "unknown fees remain unknown and require research", () => { const f = fixture(); f.scenario.platformFee = unknown(); const r = status(f, "RESEARCH_REQUIRED"); assert.ok(r.scenario?.valid); assert.equal(r.scenario.contribution.label, "UNKNOWN"); assert.equal(r.scenario.contribution.amount, null); });
  p("P18", "observed zero fee without proof is invalid", () => { const f = fixture(); f.scenario.platformFee.amount!.valueMinor = 0; f.scenario.platformFee.evidenceDigest = null; status(f, "BLOCKED"); });
  p("P19", "unknown hypothetical price cannot become revenue", () => { const f = fixture(); f.scenario.price = unknown(); f.opportunity.hypothesis.priceScenario = null; status(f, "RESEARCH_REQUIRED"); });
  p("P20", "assumed fee without current platform basis cannot yield pilot", () => { const f = fixture(); f.scenario.platformFee.label = "ASSUMED"; f.scenario.platformFee.evidenceDigest = null; status(f, "RESEARCH_REQUIRED"); });
  p("P21", "two pages from one source are one demand source", () => { const f = fixture(); demands(f)[1]!.sourceIdentityDigest = demands(f)[0]!.sourceIdentityDigest; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P22", "exact duplicate evidence does not corroborate demand", () => { const f = fixture(); f.evidence = f.evidence.filter(x => x !== demands(f)[1]); f.evidence.push(structuredClone(demands(f)[0]!)); status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P23", "mirrors of one original reference do not corroborate demand", () => { const f = fixture(); demands(f)[1]!.referenceDigest = demands(f)[0]!.referenceDigest; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P24", "payload freshness cannot widen a code-owned category ceiling", () => { const f = fixture(); for (const x of demands(f)) { x.observedAt = "2026-08-01T12:00:00.000Z"; } status(f, "RESEARCH_REQUIRED"); });
  p("P25", "future demand cannot corroborate", () => { const f = fixture(); demands(f)[1]!.observedAt = "2026-10-05T12:00:00.000Z"; status(f, "RESEARCH_REQUIRED"); });
  p("P26", "expired demand is not current", () => { const f = fixture(); demands(f)[1]!.freshUntil = AT; status(f, "RESEARCH_REQUIRED"); });
  p("P27", "weak market confidence cannot corroborate", () => { const f = fixture(); demands(f)[1]!.confidence = 0.59; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P28", "NaN confidence invalidates input", () => { const f = fixture(); demands(f)[1]!.confidence = Number.NaN; status(f, "BLOCKED"); });
  p("P29", "competition alone is not demand", () => { const f = fixture(); f.evidence = f.evidence.filter(x => x.kind !== "PUBLIC_DEMAND_SIGNAL"); status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P30", "listing counts do not prove demand", () => { const f = fixture(); for (const x of demands(f)) x.facts = ["LISTING_COUNT_OBSERVED"]; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P31", "owner enthusiasm is not market demand", () => { const f = fixture(); for (const x of demands(f)) { x.kind = "OWNER_INTEREST_SIGNAL"; x.sourceClass = "OWNER_INPUT"; x.facts = ["OWNER_INTERESTED"]; } status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P32", "claimed realized ledger signals are not independently verified demand", () => { const f = fixture(); for (const x of demands(f)) { x.kind = "REALIZED_LEDGER_SIGNAL"; x.sourceClass = "LOCAL_FACT"; x.facts = ["REALIZED_REVENUE_OBSERVED"]; } status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P33", "absence of competition is not a positive signal", () => { const f = fixture(); e(f, "PUBLIC_COMPETITION_SIGNAL").facts = ["COMPETITION_NOT_OBSERVED", "DIFFERENTIATION_OBSERVED"]; status(f, "RESEARCH_REQUIRED"); });
  p("P34", "differentiation requires evidence", () => { const f = fixture(); e(f, "PUBLIC_COMPETITION_SIGNAL").facts = ["COMPETITION_OBSERVED", "DIFFERENTIATION_NOT_PROVEN"]; status(f, "RESEARCH_REQUIRED"); });
  p("P35", "negative hypothetical contribution is not pursued", () => { const f = fixture(); f.scenario.deliveryCost.amount!.valueMinor = 2000; status(f, "DO_NOT_PURSUE"); });
  p("P36", "uncertain digital asset rights block", () => { const f = fixture(); f.rights.state = "UNCERTAIN"; status(f, "BLOCKED"); });
  p("P37", "security/license/rights blockers block", () => { for (const blocker of ["SECURITY", "LICENSE", "RIGHTS"]) { const f = fixture(); f.securityBlockers.push(blocker); status(f, "BLOCKED"); } });
  p("P38", "orphan rights digest cannot clear rights", () => { const f = fixture(); f.rights.evidenceDigest = digest("orphan"); assert.equal(status(f, "BLOCKED").dimensions.rights, "UNPROVEN"); });
  p("P39", "separate current rights uncertainty defeats clear proof", () => { const f = fixture(); const x = structuredClone(e(f, "LOCAL_DELIVERABLE_PROOF")); x.evidenceDigest = digest("uncertain-rights"); x.facts = ["RIGHTS_UNCERTAIN"]; f.evidence.push(x); assert.equal(status(f, "BLOCKED").dimensions.rights, "UNCERTAIN"); });
  p("P40", "owner account prerequisite produces owner review advice", () => { const f = fixture(); f.prerequisites[1]!.state = "OWNER_REQUIRED"; status(f, "OWNER_REVIEW_REQUIRED"); });
  p("P41", "multi-platform pilot still needs owner platform review", () => { const f = fixture(); platform(f, "MULTI"); status(f, "OWNER_REVIEW_REQUIRED"); });
  p("P42", "another platform cannot corroborate demand", () => { const f = fixture(); demands(f)[1]!.platform = "etsy"; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P43", "another target market cannot corroborate demand", () => { const f = fixture(); demands(f)[1]!.targetMarketCode = "DE"; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P44", "another opportunity cannot corroborate demand", () => { const f = fixture(); demands(f)[1]!.opportunityId = "other-opportunity"; status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P45", "future opportunity is invalid advice", () => { const f = fixture(); f.opportunity.observedAt = "2026-10-05T12:00:00.000Z"; status(f, "BLOCKED"); });
  p("P46", "currency conversion is not implicit", () => { const f = fixture(); f.scenario.deliveryCost.amount!.currency = "EUR"; status(f, "BLOCKED"); });
  p("P47", "money is bounded nonnegative minor units", () => { for (const value of [-1, -0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000_000_001, Number.MAX_SAFE_INTEGER]) { const f = fixture(); f.scenario.platformFee.amount!.valueMinor = value; status(f, "BLOCKED"); } });
  p("P48", "unknown raw fields, PII and directives are rejected", () => { for (const patch of [{ email: "fixture@example.test" }, { directive: "publish now" }, { operation: "LISTING_CREATE" }, { budgetUsd: 100 }]) status({ ...fixture(), ...patch }, "BLOCKED"); });
  p("P49", "accessors cannot execute before refusal", () => { const f = fixture(); let reads = 0; Object.defineProperty(f.rights, "state", { enumerable: true, get() { reads++; return "CLEAR"; } }); status(f, "BLOCKED"); assert.equal(reads, 0); });
  p("P50", "hostile proxy exception is a bounded refusal", () => { assert.doesNotThrow(() => status(new Proxy({}, { getPrototypeOf() { throw new Error("hostile"); } }), "BLOCKED")); status(new Proxy(fixture(), {}), "BLOCKED"); });
  p("P51", "symbols, sparse arrays, functions and prototypes are refused", () => {
    const a = fixture(); Object.defineProperty(a.capabilities, "0", { get() { throw new Error("array accessor executed"); } }); status(a, "BLOCKED");
    const b = fixture(); (b as unknown as Record<symbol, unknown>)[Symbol("authority")] = true; status(b, "BLOCKED");
    const c = fixture(); delete c.evidence[1]; status(c, "BLOCKED"); const d = fixture(); Object.setPrototypeOf(d.rights, { ownerApproved: true }); status(d, "BLOCKED");
  });
  p("P52", "evidence cannot choose operations or grant authority", () => { const f = fixture(); e(f, "PUBLIC_COMPETITION_SIGNAL").facts.push("LISTING_CREATE owner approved"); status(f, "BLOCKED"); status({ ...fixture(), authority: "EXECUTE" }, "BLOCKED"); const o = fixture(); o.opportunity.authority = "EXECUTE"; status(o, "BLOCKED"); });
  p("P53", "economic equality is independent of JSON property insertion order", () => { const f = fixture(); f.opportunity.hypothesis.priceScenario = { currency: "USD", valueMinor: 1000 }; status(f, "PILOT_CANDIDATE"); });
  p("P54", "a reused digest with changed evidence is a conflict", () => { const f = fixture(); demands(f)[1]!.evidenceDigest = demands(f)[0]!.evidenceDigest; status(f, "BLOCKED"); });
  p("P55", "future selling price cannot be labelled observed", () => { const f = fixture(); f.scenario.price.label = "OBSERVED"; f.scenario.price.evidenceDigest = digest("price"); status(f, "BLOCKED"); });
  p("P56", "hypothetical scenario is not a realized ledger fact or spend authority", () => { const f = fixture(); const r = status(f, "PILOT_CANDIDATE"); assert.throws(() => createAyasRevenueLedgerEntry(r.scenario, AT), /AYAS_REVENUE_LEDGER_INVALID_INPUT/);
    assert.throws(() => createAyasRevenueLedgerEntry(r, AT), /AYAS_REVENUE_LEDGER_INVALID_INPUT/);
    const d = decideAyasRevenueSpend({ schemaVersion: "1", platform: "lemon-squeezy", operation: "LISTING_LIST_READ", event: "AD_SPEND", amount: { valueMinor: 1, currency: "USD" }, costClass: "free-public", source: "LOCAL_PLAN", requestedAt: AT }); assert.equal(d.allowedAutonomously, false); });
  p("P57", "snapshots are deeply frozen and detached", () => { const f = fixture(); const r = status(f, "PILOT_CANDIDATE"); f.scenario.price.amount!.valueMinor = 1; f.evidence[0]!.facts = []; assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.reasonCodes)); assert.ok(r.scenario?.valid); assert.equal(r.scenario.input.price.amount!.valueMinor, 1000);
    assert.ok(Object.isFrozen(r.scenario.input.price.amount)); assert.ok(Object.isFrozen(snapshotAyasRevenueOpportunity(f.opportunity)!.capabilityKeys)); });
  p("P58", "contradictory competition or differentiation cannot support pilot", () => { for (const fact of ["COMPETITION_NOT_OBSERVED", "DIFFERENTIATION_NOT_PROVEN"]) { const f = fixture(); e(f, "PUBLIC_COMPETITION_SIGNAL").facts.push(fact); status(f, "RESEARCH_REQUIRED"); } });
  p("P59", "orphan READY prerequisite digest does not prove readiness", () => { const f = fixture(); f.prerequisites[1]!.evidenceDigest = digest("orphan-platform"); status(f, "BLOCKED"); });
  p("P60", "stale prerequisite proof cannot support readiness", () => { const f = fixture(); const x = structuredClone(e(f, "PLATFORM_READ_ONLY_SIGNAL")); x.evidenceDigest = digest("stale-prereq"); x.observedAt = "2026-08-01T12:00:00.000Z"; f.evidence.push(x); f.prerequisites[1]!.evidenceDigest = x.evidenceDigest; status(f, "BLOCKED"); });
  p("P61", "all valid opportunity ID forms can match evidence", () => { for (const id of ["123", "op:42", "a"]) { const f = fixture(); f.opportunity.opportunityId = id; for (const x of f.evidence) x.opportunityId = id; assert.ok(snapshotAyasRevenueOpportunity(f.opportunity)); status(f, "PILOT_CANDIDATE"); } });
  p("P62", "source-reference aliases are grouped transitively", () => { const f = fixture(); const [a, b] = demands(f); b!.referenceDigest = a!.referenceDigest; const c = structuredClone(b!); c.evidenceDigest = digest("demand-c"); c.referenceDigest = digest("ref-c"); f.evidence.push(c); status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P63", "platform ceiling constrains otherwise fresh course signals", () => { const f = fixture(); f.opportunity.offerType = "COURSE"; platform(f, "upwork"); for (const x of demands(f)) x.observedAt = "2026-09-20T12:00:00.000Z"; status(f, "RESEARCH_REQUIRED"); });
  p("P64", "pure modules and evaluators are protected from self-rewrite", () => {
    for (const file of ["AyasRevenueOpportunity.ts", "AyasRevenueValidation.ts", "AyasRevenueScenarioEconomics.ts"]) { const filePath = `src/lib/ayas/revenue/${file}`; const source = fs.readFileSync(filePath, "utf8"); assert.doesNotMatch(source, /node:(?:fs|http|https|child_process)|fetch\s*\(|process\.env|AyasRevenueLedgerStore|AyasRevenueAdapterRegistry/); assert.equal(classifyPatchTarget(filePath).level, "FORBIDDEN_AUTONOMOUS"); }
    for (const file of ["scripts/smoke-ayas-revenue-free-first-validation.ts", "scripts/smoke-ayas-revenue-free-first-validation-mutations.ts", "scripts/fixtures/ayas-revenue-free-first-fixture.ts", "docs/AYAS_REVENUE_FREE_FIRST_VALIDATION.md"]) assert.equal(classifyPatchTarget(file).level, "FORBIDDEN_AUTONOMOUS");
  });
  p("P65", "a negative signal in the same provenance group defeats demand", () => { const f = fixture(); const x = structuredClone(demands(f)[0]!); x.evidenceDigest = digest("negative-demand"); x.facts = ["DEMAND_ABSENT"]; f.evidence.push(x); status(f, "INSUFFICIENT_EVIDENCE"); });
  p("P66", "actual price mismatch and unknown currencies are refused", () => { const f = fixture(); f.opportunity.hypothesis.priceScenario!.valueMinor = 999; status(f, "BLOCKED"); const c = fixture(); c.scenario.platformFee.amount!.currency = "BTC"; status(c, "BLOCKED");
    const u = fixture(); u.opportunity.hypothesis.priceScenario!.currency = "BTC"; for (const q of [u.scenario.price, u.scenario.platformFee, u.scenario.paymentProcessingFee, u.scenario.deliveryCost]) q.amount!.currency = "BTC"; status(u, "BLOCKED"); });
  // Frozen before the first evaluator run. These are separate combinations, never selected from mutation failures.
  h("H01", "Upwork freelance fixture remains conditional local advice", () => { const f = fixture(); platform(f, "upwork"); f.opportunity.offerType = "FREELANCE_SERVICE"; status(f, "PILOT_CANDIDATE"); });
  h("H02", "Fiverr owner account requirement needs owner review", () => { const f = fixture(); platform(f, "fiverr"); f.opportunity.offerType = "FREELANCE_SERVICE"; f.prerequisites[1]!.state = "OWNER_REQUIRED"; status(f, "OWNER_REVIEW_REQUIRED"); });
  h("H03", "Udemy licensing uncertainty blocks a course", () => { const f = fixture(); platform(f, "udemy"); f.opportunity.offerType = "COURSE"; f.rights.state = "UNCERTAIN"; status(f, "BLOCKED"); });
  h("H04", "Etsy mixed-currency scenario is refused", () => { const f = fixture(); platform(f, "etsy"); f.scenario.paymentProcessingFee.amount!.currency = "TRY"; status(f, "BLOCKED"); });
  h("H05", "multi-platform opportunity cannot inherit single-platform market or fee evidence", () => { const f = fixture(); f.opportunity.platform = "MULTI"; f.prerequisites[1]!.state = "OWNER_REQUIRED"; status(f, "RESEARCH_REQUIRED"); });
  h("H06", "course evidence older than sixty days remains stale", () => { const f = fixture(); platform(f, "udemy"); f.opportunity.offerType = "COURSE"; for (const x of demands(f)) x.observedAt = "2026-07-01T12:00:00.000Z"; status(f, "RESEARCH_REQUIRED"); });
  h("H07", "JPY minor units use direct integer arithmetic", () => { const f = fixture(); for (const q of Object.values(f.scenario)) if (typeof q === "object" && q.amount) q.amount.currency = "JPY";
    f.opportunity.hypothesis.priceScenario = { valueMinor: 199, currency: "JPY" }; f.scenario.price.amount!.valueMinor = 199; f.scenario.platformFee.amount!.valueMinor = 0; f.scenario.paymentProcessingFee.amount!.valueMinor = 0; status(f, "DO_NOT_PURSUE"); });
  h("H08", "explicit zero observations support a zero-price scenario with no margin", () => { const f = fixture(); f.opportunity.hypothesis.priceScenario!.valueMinor = 0;
    for (const q of Object.values(f.scenario)) if (typeof q === "object" && q.amount) q.amount.valueMinor = 0; const r = status(f, "PILOT_CANDIDATE"); assert.ok(r.scenario?.valid); assert.equal(r.scenario.contributionMargin, null); });
  h("H09", "unknown delivery cost requires research despite available capability", () => { const f = fixture(); f.scenario.deliveryCost = unknown(); status(f, "RESEARCH_REQUIRED"); });
  h("H10", "model-claimed fee schedule is not a known platform basis", () => { const f = fixture(); e(f, "PLATFORM_READ_ONLY_SIGNAL").sourceClass = "MODEL_OPINION"; f.prerequisites[1]!.state = "OWNER_REQUIRED"; status(f, "RESEARCH_REQUIRED"); });
  h("H11", "fee assumptions with an observed current basis retain assumed labels", () => { const f = fixture(); f.scenario.platformFee.label = "ASSUMED"; f.scenario.paymentProcessingFee.label = "ASSUMED"; const r = status(f, "PILOT_CANDIDATE"); assert.ok(r.scenario?.valid); assert.equal(r.scenario.variableCosts.label, "ASSUMED"); assert.equal(r.evidenceVerification, "NORMALIZED_INPUT_NOT_EXTERNAL_CERTIFICATION"); });
  h("H12", "schema injection into an economic quote cannot choose an action", () => { const f = fixture(); (f.scenario.platformFee as unknown as Record<string, unknown>).operation = "FUNDS_WITHDRAW"; status(f, "BLOCKED"); assert.equal(computeAyasRevenueScenarioEconomics(f.scenario).valid, false); });
  if (selected === undefined) { assert.equal(results.filter(r => r.set === "primary").length, 66); assert.equal(results.filter(r => r.set === "held-out").length, 12); }
  else assert.equal(results.length, 1, "selected assertion must exist");
  console.log(JSON.stringify({ status: results.every(r => r.ok) ? "PASS" : "FAIL", primary: { passed: results.filter(r => r.set === "primary" && r.ok).length, total: results.filter(r => r.set === "primary").length },
    heldOut: { passed: results.filter(r => r.set === "held-out" && r.ok).length, total: results.filter(r => r.set === "held-out").length }, authority: "NONE", noLiveIO: true, results }, null, 2));
  if (results.some(r => !r.ok)) process.exitCode = 1;
}
main();
