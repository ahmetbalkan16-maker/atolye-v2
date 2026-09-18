import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadAyasOwnerRecommendationsView } from "../src/lib/brain/autonomy/AyasOwnerRecommendationsView";
import { createAyasApprovalInboxStore, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { AyasDevelopmentCenter } from "../src/components/brain/AyasDevelopmentCenter";

/**
 * Owner-approval model — the read-only view a Brain UI page render actually
 * calls (`app/brain/observerActions.ts`'s `refreshAyasOwnerRecommendations`,
 * and `app/brain/page.tsx`'s initial load both wrap this directly). Proves
 * it never mutates the inbox (no `.decide()` call reachable from this
 * module — see the "no decide" source-contract scenario below) and only
 * ever surfaces RECOMMEND_FOR_APPROVAL + executable proposals.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }
function tmpInbox() { return createAyasApprovalInboxStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-owner-rec-view-")) }); }

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
  scenario("a SAFE, ready, PENDING proposal is surfaced as a recommendation with a plain-language request + binding", () => {
    const inbox = tmpInbox();
    const created = inbox.createProposal(proposalInput() as never);
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.connected, true);
    assert.equal(view.recommendations.length, 1);
    assert.equal(view.recommendations[0]?.binding.proposalId, created.proposalId);
    assert.equal(view.recommendations[0]?.request.recommendation, "PROCEED");
    assert.equal(view.recommendations[0]?.request.executable, true);
  });

  scenario("a REVIEW_REQUIRED proposal is never surfaced — deferred internally, not shown to the owner", () => {
    const inbox = tmpInbox();
    inbox.createProposal(proposalInput({ safetyClassification: "REVIEW_REQUIRED" as never, exactFiles: ["src/lib/audio/AudioMixer.ts"], mutationKind: undefined } as never) as never);
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 0);
  });

  scenario("a FORBIDDEN_AUTONOMOUS proposal is never surfaced", () => {
    const inbox = tmpInbox();
    inbox.createProposal(proposalInput({ safetyClassification: "FORBIDDEN_AUTONOMOUS" as never, exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"], mutationKind: undefined } as never) as never);
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 0);
  });

  scenario("a non-PENDING proposal (already APPROVED/REJECTED/STALE/etc.) is never re-surfaced", () => {
    const inbox = tmpInbox();
    const created = inbox.createProposal(proposalInput() as never);
    inbox.decide(created.proposalId, "REJECT", "2026-09-18T00:00:01.000Z");
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 0);
  });

  scenario("an insufficient-evidence proposal is never surfaced", () => {
    const inbox = tmpInbox();
    inbox.createProposal(proposalInput({ evidence: [], graphifyEvidence: [] } as never) as never);
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 0);
  });

  scenario("no `.decide(` call is reachable from this module's own source — a page render can never mutate the inbox", () => {
    const raw = fs.readFileSync(path.join(process.cwd(), "src/lib/brain/autonomy/AyasOwnerRecommendationsView.ts"), "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!code.includes(".decide("), "AyasOwnerRecommendationsView.ts must never call inbox.decide()");
  });

  scenario("a broken inbox (throws on load) is reported as disconnected, not crashed", () => {
    const throwingInbox = { load: () => { throw new Error("boom"); }, stateFile: "", save: () => { throw new Error("unused"); }, createProposal: () => { throw new Error("unused"); }, decide: () => { throw new Error("unused"); }, reconcileStale: () => { throw new Error("unused"); }, markStale: () => { throw new Error("unused"); }, consumeApproval: () => { throw new Error("unused"); }, reserveApproval: () => { throw new Error("unused"); }, finalizeApproval: () => { throw new Error("unused"); }, recordResult: () => { throw new Error("unused"); } } as never;
    const view = loadAyasOwnerRecommendationsView(throwingInbox);
    assert.equal(view.connected, false);
    assert.equal(view.recommendations.length, 0);
    assert.match(view.error ?? "", /boom/);
  });

  scenario("the recommendation card renders plain-language fields and both actions, no hashes visible outside the <details> disclosure", () => {
    const inbox = tmpInbox();
    inbox.createProposal(proposalInput({ objective: "assert çağrılarına teşhis mesajı ekle", expectedUserBenefit: "hata ayıklama süresi kısalır" }) as never);
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 1);
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, {
      inbox: { connected: true, pending: [], today: [], history: [] },
      ownerRecommendations: view.recommendations,
    }));
    assert.match(html, /AYAS'ın Önerileri|AYAS&#x27;ın Önerileri/);
    assert.match(html, /assert çağrılarına teşhis mesajı ekle/);
    assert.match(html, /hata ayıklama süresi kısalır/);
    assert.match(html, />ONAYLA</);
    assert.match(html, />REDDET</);
    assert.match(html, /AYAS tavsiyesi: DEVAM ET/);
    // the technical identity is present, but only inside <details> — never
    // required to read the plain-language summary above it.
    const beforeDetails = html.slice(0, html.indexOf("<details"));
    assert.doesNotMatch(beforeDetails, /fixture-hash|ayas-patch-artifact-fixture/);
    assert.match(html, /fixture-hash|ayas-patch-artifact-fixture/);
  });

  scenario("an empty recommendations list renders no owner-recommendations section at all", () => {
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, {
      inbox: { connected: true, pending: [], today: [], history: [] },
      ownerRecommendations: [],
    }));
    assert.doesNotMatch(html, /ayas-owner-recommendations/);
  });

  // --- durable one-click correction: pendingExecution (Step 3/4) ---

  scenario("a proposal durably APPROVED via the owner-approval model (owner-approved: reason) is surfaced in pendingExecution, not recommendations", () => {
    const inbox = tmpInbox();
    const created = inbox.createProposal(proposalInput() as never);
    inbox.decide(created.proposalId, "APPROVE", "2026-09-18T00:00:01.000Z", "owner-approved: pending execution enablement");
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.recommendations.length, 0, "must not appear as an actionable recommendation any more");
    assert.equal(view.pendingExecution.length, 1);
    assert.equal(view.pendingExecution[0]?.proposalId, created.proposalId);
  });

  scenario("a proposal APPROVED via the legacy manual ONAYLA flow (no owner-approved reason) never appears in pendingExecution", () => {
    const inbox = tmpInbox();
    const created = inbox.createProposal(proposalInput() as never);
    inbox.decide(created.proposalId, "APPROVE", "2026-09-18T00:00:01.000Z"); // no reason at all — the legacy `decideAyasApproval` shape
    const view = loadAyasOwnerRecommendationsView(inbox);
    assert.equal(view.pendingExecution.length, 0);
  });

  scenario("the pendingExecution card renders a durable ONAYLANDI notice with no ONAYLA/REDDET/VAZGEÇ action at all", () => {
    const inbox = tmpInbox();
    const created = inbox.createProposal(proposalInput({ objective: "assert çağrılarına teşhis mesajı ekle" }) as never);
    inbox.decide(created.proposalId, "APPROVE", "2026-09-18T00:00:01.000Z", "owner-approved: pending execution enablement");
    const view = loadAyasOwnerRecommendationsView(inbox);
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, {
      inbox: { connected: true, pending: [], today: [], history: [] },
      ownerApprovalPendingExecution: view.pendingExecution,
    }));
    assert.match(html, /Onaylandı — Yürütme Bekleniyor/);
    assert.match(html, />ONAYLANDI</);
    assert.match(html, /assert çağrılarına teşhis mesajı ekle/);
    assert.match(html, /Otomatik yürütme şu anda devre dışı/);
    assert.doesNotMatch(html, />ONAYLA</);
    assert.doesNotMatch(html, />REDDET</);
    assert.doesNotMatch(html, />VAZGEÇ</);
  });

  scenario("an empty pendingExecution list renders no such section at all", () => {
    const html = renderToStaticMarkup(createElement(AyasDevelopmentCenter, {
      inbox: { connected: true, pending: [], today: [], history: [] },
      ownerApprovalPendingExecution: [],
    }));
    assert.doesNotMatch(html, /ayas-owner-pending-execution/);
  });

  console.log(`AYAS owner recommendations view smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-recommendations-view", scenarios: count }));
}
main();
