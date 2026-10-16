import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AYAS_EVOLUTION_PLAN_MUTATION_KIND } from "../src/lib/ayas/evolution/AyasEvolutionIntegration";
import { createAyasApprovalInboxStore } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { buildAyasApprovalInboxView } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import { createAyasAutonomyDaemon, type AyasDaemonCandidate } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { reviewAyasPendingProposals } from "../src/lib/brain/autonomy/AyasAutonomousReview";
import { AYAS_DESIGN_REVIEW_MUTATION_KINDS, isAyasDesignReviewMutationKind } from "../src/lib/brain/autonomy/AyasDesignReviewKinds";
import { createAyasExternalResearchStore } from "../src/lib/brain/autonomy/AyasExternalResearchStore";
import { evaluateAyasInternalDecision } from "../src/lib/brain/autonomy/AyasInternalDecision";
import { isAyasMutationKindRegistered } from "../src/lib/brain/autonomy/AyasMutationRegistry";
import { loadAyasOwnerRecommendationsView } from "../src/lib/brain/autonomy/AyasOwnerRecommendationsView";
import { AYAS_RESEARCH_ADAPTATION_PLAN_MUTATION_KIND, discoverAyasResearchProposalCandidates } from "../src/lib/brain/autonomy/AyasResearchProposalBridge";

/**
 * Owner request 2026-10-16: research/evolution design reviews were deferred by
 * the internal review ("no registered mutationKind") and so never reached the
 * owner. They now stay PENDING as never-executable recommendations; every other
 * unregistered kind is still deferred, and nothing here can execute.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function temp(prefix: string) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
const NOW = "2026-10-16T08:00:00.000Z";
const observation = { now: NOW, branch: "wip/test", head: "1".repeat(40), repoClean: true, graphifyFresh: true, machineAction: "ALLOW" as const, gaps: [] as string[] };

function researchCandidate(): AyasDaemonCandidate {
  const research = createAyasExternalResearchStore({ rootDir: temp("ayas-design-review-research-") });
  research.record({ provider: "Ollama", capability: "MEMORY_CONTEXT", category: "MEMORY_CONTEXT", problemSolved: "longer local context", sourceUrl: "https://github.com/ollama/ollama/releases/tag/v0.40.5", isOfficialSource: true, featureDate: null, lastCheckedAt: NOW, confidence: "high", licenseCostStatus: "open-source", licenseCostNotes: "MIT", atolyeGapStatus: "missing", atolyeGapNotes: "fixture gap", disposition: "ACTIONABLE_PROPOSAL_CANDIDATE", dispositionReason: "OFFICIAL_HIGH_CONFIDENCE_GAP", researchMode: "DEEP" });
  const [candidate] = discoverAyasResearchProposalCandidates(research.list(), []);
  assert.ok(candidate);
  return candidate;
}

function evolutionCandidate(): AyasDaemonCandidate {
  return {
    ...researchCandidate(), objective: "MEMORY_CONTEXT evrim fırsatını sahip incelemesi için bağımsız bir tasarım kaydına dönüştür",
    exactFiles: ["docs/brain/proposals/evolution-fixture.md"], mutationKind: AYAS_EVOLUTION_PLAN_MUTATION_KIND, discoverySource: "LOCAL_DISCOVERY", sourceReference: "evolution-fixture",
    // Stage 13 never claims a licensing verdict, so a real evolution proposal always carries this.
    structuredImpact: { dependencyImpact: "local-free", externalServiceImpact: "none", estimatedCost: "zero-cost", paidCommitmentRequired: false, licensingImpact: "unresolved", licensingStatus: "unresolved", securityImpact: "none", authorityImpact: "none", storageImpact: "none", productionImpact: "none", reversibility: "fully-reversible", validationConfidence: "low" },
  };
}

function discovered(candidates: readonly AyasDaemonCandidate[]) {
  const inbox = createAyasApprovalInboxStore({ rootDir: temp("ayas-design-review-inbox-") });
  const proposals = createAyasAutonomyDaemon({ inbox }).discover(observation, candidates);
  assert.equal(proposals.length, candidates.length);
  return { inbox, proposals };
}

function main() {
  scenario("the design-review set mirrors both producers and neither kind is registered", () => {
    assert.deepEqual([...AYAS_DESIGN_REVIEW_MUTATION_KINDS].sort(), [AYAS_RESEARCH_ADAPTATION_PLAN_MUTATION_KIND, AYAS_EVOLUTION_PLAN_MUTATION_KIND].sort());
    for (const kind of AYAS_DESIGN_REVIEW_MUTATION_KINDS) { assert.equal(isAyasMutationKindRegistered(kind), false, kind); assert.equal(isAyasDesignReviewMutationKind(kind), true); }
    assert.equal(isAyasDesignReviewMutationKind("patch-artifact:v1"), false);
    assert.equal(isAyasDesignReviewMutationKind(undefined), false);
  });

  scenario("research and evolution design reviews are recommended to the owner but never executable", () => {
    const { proposals } = discovered([researchCandidate(), evolutionCandidate()]);
    for (const proposal of proposals) {
      assert.equal(proposal.safetyClassification, "SAFE");
      const decision = evaluateAyasInternalDecision(proposal);
      assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL", proposal.mutationKind);
      assert.equal(decision.executable, false, proposal.mutationKind);
      assert.match(decision.reasons[0] ?? "", /design review only/);
    }
    const evolution = evaluateAyasInternalDecision(proposals[1]!);
    assert.ok(evolution.reasons.includes("unresolved licensing status"), "impact concerns travel along as owner context");
  });

  scenario("the daemon review keeps them PENDING and records no decision; the owner pending list shows them", () => {
    const { inbox, proposals } = discovered([researchCandidate(), evolutionCandidate()]);
    const outcome = reviewAyasPendingProposals(inbox, () => NOW);
    assert.equal(outcome.deferred.length, 0); assert.equal(outcome.rejected.length, 0);
    assert.deepEqual(outcome.recommended.map((entry) => entry.request.executable), [false, false]);
    const state = inbox.load();
    assert.deepEqual(state.proposals.map((proposal) => proposal.status), ["PENDING", "PENDING"]);
    assert.equal(state.decisions.length, 0, "the internal review grants no approval");
    const view = buildAyasApprovalInboxView(state, NOW);
    assert.deepEqual(view.pending.map((proposal) => proposal.proposalId).sort(), proposals.map((proposal) => proposal.proposalId).sort());
    assert.ok(view.pending.every((proposal) => proposal.approvalReady));
  });

  scenario("the executable-only recommendation surface never lists a design review", () => {
    const { inbox } = discovered([researchCandidate(), evolutionCandidate()]);
    for (const env of [{}, { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" }]) {
      const view = loadAyasOwnerRecommendationsView(inbox, env);
      assert.equal(view.connected, true); assert.equal(view.recommendations.length, 0);
    }
  });

  scenario("an owner APPROVE only records the decision", () => {
    const { inbox, proposals } = discovered([researchCandidate()]);
    inbox.decide(proposals[0]!.proposalId, "APPROVE", NOW, "owner fixture approval");
    const state = inbox.load();
    assert.equal(state.proposals[0]?.status, "APPROVED");
    assert.equal(state.results.length, 0, "no execution result exists");
  });

  scenario("guards still hold: no evidence, a non-SAFE domain and other unregistered kinds stay hidden", () => {
    const base = discovered([researchCandidate()]).proposals[0]!;
    assert.equal(evaluateAyasInternalDecision({ ...base, evidence: [] }).decision, "DEFER");
    const reviewDomain = evaluateAyasInternalDecision({ ...base, exactFiles: ["src/lib/audio/AudioMixer.ts"] });
    assert.equal(reviewDomain.decision, "DEFER"); assert.equal(reviewDomain.executable, false);
    assert.equal(evaluateAyasInternalDecision({ ...base, safetyClassification: "REVIEW_REQUIRED" }).decision, "DEFER");
    const other = evaluateAyasInternalDecision({ ...base, mutationKind: "research-experiment-proposal:v1" });
    assert.equal(other.decision, "DEFER"); assert.match(other.reasons[0] ?? "", /no registered mutationKind/);
    assert.equal(evaluateAyasInternalDecision({ ...base, status: "STALE" }).decision, "REJECT");
  });

  console.log(`AYAS design-review proposals smoke: PASS (${count} scenarios)`);
}
main();
