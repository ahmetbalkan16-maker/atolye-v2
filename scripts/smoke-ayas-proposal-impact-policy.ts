import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  evaluateAyasImpactPolicy,
  describeAyasProposalImpactForOwner,
  isWellFormedAyasStructuredImpact,
  AYAS_UNRESOLVED_STRUCTURED_IMPACT,
  type AyasProposalStructuredImpact,
} from "../src/lib/brain/autonomy/AyasProposalImpact";
import { evaluateAyasInternalDecision } from "../src/lib/brain/autonomy/AyasInternalDecision";
import { buildAyasOwnerApprovalRequest } from "../src/lib/brain/autonomy/AyasOwnerApprovalRequest";
import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * Step 2/3 of the owner-approval-model completion pass: structured impact
 * metadata (`AyasProposalImpact.ts`) and the cost/dependency/licensing
 * policy it feeds into `AyasInternalDecision.ts`. Backward compatibility is
 * the load-bearing property throughout — a proposal with no `structuredImpact`
 * at all must evaluate exactly as it did before this module existed.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpInbox() { return createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-impact-policy-")) }); }

const SAFE_IMPACT: AyasProposalStructuredImpact = {
  dependencyImpact: "none",
  externalServiceImpact: "none",
  estimatedCost: "zero-cost",
  paidCommitmentRequired: false,
  licensingImpact: "none",
  licensingStatus: "not-applicable",
  securityImpact: "none",
  authorityImpact: "none",
  storageImpact: "none",
  productionImpact: "none",
  reversibility: "fully-reversible",
  validationConfidence: "high",
};

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-18T00:00:00.000Z",
    baseBranch: "master",
    baseHead: "abc123",
    objective: "AYAS-generated fixture improvement",
    currentProblem: "fixture problem",
    selectionReason: "fixture selection reason",
    expectedUserBenefit: "a regression that would otherwise go unnoticed is now caught",
    expectedBehaviorChange: "fixture change",
    unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk",
    technicalRisk: "low",
    productionImpact: "none",
    rationale: "fixture rationale",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fixture graphify evidence"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-fixture-generated.ts"],
    expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"],
    estimatedCost: "zero-cost" as const,
    mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    patchArtifactId: "ayas-patch-artifact-fixture",
    patchHash: "fixture-hash",
    ...overrides,
  };
}

function main(): void {
  // --- pure policy unit tests -------------------------------------------
  scenario("undefined impact is treated as fully unresolved: mustDefer AND mustNeverExecute", () => {
    const result = evaluateAyasImpactPolicy(undefined);
    assert.equal(result.mustDefer, true);
    assert.equal(result.mustNeverExecute, true);
    assert.ok(result.reasons.length > 0);
  });

  scenario("a malformed/partial object is treated exactly like undefined (fails closed, does not crash)", () => {
    const malformed = { dependencyImpact: "none" } as unknown as AyasProposalStructuredImpact;
    assert.equal(isWellFormedAyasStructuredImpact(malformed), false);
    const result = evaluateAyasImpactPolicy(malformed);
    assert.equal(result.mustDefer, true);
  });

  scenario("a fully-safe, fully-resolved impact never defers and never blocks execution", () => {
    const result = evaluateAyasImpactPolicy(SAFE_IMPACT);
    assert.equal(result.mustDefer, false);
    assert.equal(result.mustNeverExecute, false);
  });

  scenario("unresolved licensing status defers", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, licensingStatus: "unresolved" });
    assert.equal(result.mustDefer, true);
  });

  scenario("incompatible-or-unknown licensing defers (never even reaches a recommend-but-non-executable state)", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, licensingStatus: "incompatible-or-unknown" });
    assert.equal(result.mustDefer, true);
  });

  scenario("unresolved dependency impact defers", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, dependencyImpact: "unresolved" });
    assert.equal(result.mustDefer, true);
  });

  scenario("unresolved cost estimate defers", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, estimatedCost: "unresolved" });
    assert.equal(result.mustDefer, true);
  });

  scenario("paidCommitmentRequired never defers by itself, but always blocks autonomous execution", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, paidCommitmentRequired: true, dependencyImpact: "external-paid-service", estimatedCost: "non-zero" });
    assert.equal(result.mustDefer, false);
    assert.equal(result.mustNeverExecute, true);
  });

  scenario("a new package dependency is never autonomously executable — no install bypass", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, dependencyImpact: "new-package" });
    assert.equal(result.mustNeverExecute, true);
  });

  scenario("a known-free external service dependency is disclosed but never autonomously executable", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, dependencyImpact: "external-free-service" });
    assert.equal(result.mustDefer, false);
    assert.equal(result.mustNeverExecute, true);
  });

  scenario("an irreversible change is never autonomously executable", () => {
    const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, reversibility: "irreversible" });
    assert.equal(result.mustNeverExecute, true);
  });

  for (const field of ["securityImpact", "authorityImpact", "storageImpact", "productionImpact", "externalServiceImpact"] as const) {
    scenario(`a "high" ${field} is never autonomously executable`, () => {
      const result = evaluateAyasImpactPolicy({ ...SAFE_IMPACT, [field]: "high" });
      assert.equal(result.mustNeverExecute, true);
    });
  }

  scenario("AYAS_UNRESOLVED_STRUCTURED_IMPACT is itself well-formed and evaluates as fully blocked", () => {
    assert.equal(isWellFormedAyasStructuredImpact(AYAS_UNRESOLVED_STRUCTURED_IMPACT), true);
    const result = evaluateAyasImpactPolicy(AYAS_UNRESOLVED_STRUCTURED_IMPACT);
    assert.equal(result.mustDefer, true);
    assert.equal(result.mustNeverExecute, true);
  });

  // --- plain-language disclosure -----------------------------------------
  scenario("plain-language disclosure for an unassessed proposal says so, not a raw enum", () => {
    assert.match(describeAyasProposalImpactForOwner(undefined), /not been assessed/);
  });

  scenario("plain-language disclosure for the safe fixture mentions no new dependency and no ongoing cost", () => {
    const text = describeAyasProposalImpactForOwner(SAFE_IMPACT);
    assert.match(text, /no new dependency/);
    assert.match(text, /no ongoing cost/);
  });

  // --- integration with AyasInternalDecision: backward compatibility -----
  scenario("a proposal WITHOUT structuredImpact still reaches RECOMMEND_FOR_APPROVAL via the unchanged legacy path", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput() as never);
    assert.equal(proposal.structuredImpact, undefined);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
    assert.equal(decision.executable, true);
  });

  // --- integration with AyasInternalDecision: structured path ------------
  scenario("a proposal WITH a fully-safe structuredImpact reaches RECOMMEND_FOR_APPROVAL, executable", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput({ structuredImpact: SAFE_IMPACT } as never) as never);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
    assert.equal(decision.executable, true);
  });

  scenario("a proposal WITH unresolved licensing in structuredImpact is DEFERRED, never recommended", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput({ structuredImpact: { ...SAFE_IMPACT, licensingStatus: "unresolved" } } as never) as never);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "DEFER");
  });

  scenario("a proposal WITH a new-package dependency is still RECOMMENDED (owner should see it) but NOT executable — mirrors the REVIEW_REQUIRED precedent", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput({ structuredImpact: { ...SAFE_IMPACT, dependencyImpact: "new-package" } } as never) as never);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
    assert.equal(decision.executable, false);
  });

  scenario("structuredImpact supersedes the free-text licensing heuristic — a proposal with clean structured data is not deferred even if evidence text loosely matches the old regex", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput({
      structuredImpact: SAFE_IMPACT,
      currentProblem: "licensing status: unresolved in an unrelated third-party tool we don't touch",
    } as never) as never);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
  });

  // --- owner-facing request formatting ------------------------------------
  scenario("buildAyasOwnerApprovalRequest exposes dependencyDisclosure and hides raw structuredImpact unless advanced is opened", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput({ structuredImpact: SAFE_IMPACT } as never) as never);
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
    const request = buildAyasOwnerApprovalRequest(proposal, decision);
    assert.match(request.dependencyDisclosure, /no new dependency/);
    assert.deepEqual(request.advanced?.structuredImpact, SAFE_IMPACT);
  });

  scenario("buildAyasOwnerApprovalRequest omits `advanced` entirely for a legacy proposal with no structuredImpact", () => {
    const inbox = tmpInbox();
    const proposal = inbox.createProposal(proposalInput() as never);
    const decision = evaluateAyasInternalDecision(proposal);
    const request = buildAyasOwnerApprovalRequest(proposal, decision);
    assert.equal(request.advanced, undefined);
  });

  // --- proposalHash / binding invalidation coverage (matrix items 17-19) -
  scenario("changing structuredImpact changes proposalHash — proves AyasApprovalBinding's existing PROPOSAL_HASH_CHANGED check already covers dependency/cost/licensing drift with no new code", () => {
    const inboxA = tmpInbox();
    const inboxB = tmpInbox();
    const a = inboxA.createProposal(proposalInput({ structuredImpact: SAFE_IMPACT } as never) as never);
    const b = inboxB.createProposal(proposalInput({ structuredImpact: { ...SAFE_IMPACT, dependencyImpact: "new-package" } } as never) as never);
    assert.notEqual(a.proposalHash, b.proposalHash, "a materially different structuredImpact must change the proposal's identity hash");
  });

  console.log(`AYAS proposal impact policy smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-impact-policy", scenarios: count }));
}
main();
