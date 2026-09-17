import assert from "node:assert/strict";

import { buildAyasApprovalInboxView, type AyasPublicationDisplayState } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import { buildAyasMicroBatchDevelopmentView } from "../src/lib/brain/autonomy/AyasMicroBatchDevelopmentView";
import type { AyasApprovalInboxReadState, AyasInboxProposalRead } from "../src/lib/brain/autonomy/AyasApprovalInboxReader";
import type { AyasMicroBatchReadState, AyasMicroBatchRead } from "../src/lib/brain/autonomy/AyasMicroBatchReader";

/**
 * Approval-race UX hardening (AYAS CONTINUOUS EXTERNAL INTELLIGENCE sprint,
 * Part A). This exercises the exact live incident this sprint reconciled
 * against real durable state before starting: a MICRO_SAFE batch and an
 * individual PRIORITY_SAFE proposal both looked "ready" against the same
 * `baseHead`; whichever published first silently made the other stale. The
 * underlying authority/staleness machinery was already correct and lost no
 * work — these scenarios prove the NEW read-only signal (`displayState`)
 * that lets a human see the race coming instead of discovering its outcome
 * only in history, without granting or blocking any actual authority.
 */
let count = 0;
function scenario(name: string, fn: () => void) { fn(); count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }

const NOW = "2026-09-17T12:00:00.000Z";

function proposal(overrides: Partial<AyasInboxProposalRead>): AyasInboxProposalRead {
  return {
    proposalId: "p1", proposalHash: "hash1", createdAt: NOW, lastUpdatedAt: NOW, objective: "obj",
    rationale: "r", evidence: [], graphifyEvidence: ["ok"], exactFiles: ["scripts/target.ts"],
    expectedDiffScope: "scope", risk: "low", safetyClassification: "SAFE", testsPlanned: ["t"],
    status: "PENDING", baseHead: "head-a", mutationKind: "patch-artifact:v1",
    ...overrides,
  };
}

function batch(overrides: Partial<AyasMicroBatchRead>): AyasMicroBatchRead {
  return {
    batchId: "b1", batchVersion: 1, baseHead: "head-a", baseBranch: "main", items: [],
    exactFilesUnion: ["scripts/target.ts"], validatorUnion: [], batchHash: "bhash1",
    createdAt: NOW, lastUpdatedAt: NOW, validationSummary: [], aggregateRisk: "low",
    status: "READY_FOR_REVIEW",
    ...overrides,
  };
}

function findProposalDisplayState(view: ReturnType<typeof buildAyasApprovalInboxView>, id: string): AyasPublicationDisplayState | undefined {
  return [...view.pending, ...view.today, ...view.history].find((p) => p.proposalId === id)?.displayState;
}

scenario("no live signal available (activity unknown) leaves every proposal NORMAL — the pre-existing behavior is untouched by default", () => {
  const state: AyasApprovalInboxReadState = { proposals: [proposal({})], decisions: [], results: [] };
  const view = buildAyasApprovalInboxView(state, NOW);
  assert.equal(findProposalDisplayState(view, "p1"), "NORMAL");
});

scenario("gate open, this proposal never reserved it -> WAITING_OTHER_PUBLICATION, and its ONAYLA VE UYGULA control must not be presented as actionable", () => {
  const state: AyasApprovalInboxReadState = { proposals: [proposal({ status: "PENDING" })], decisions: [], results: [] };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-a", publicationActive: true });
  assert.equal(findProposalDisplayState(view, "p1"), "WAITING_OTHER_PUBLICATION");
});

scenario("gate open AND this proposal is the one that reserved it (reservedAt set, not yet finalized) -> EXECUTING_NOW, not WAITING", () => {
  const state: AyasApprovalInboxReadState = {
    proposals: [proposal({ status: "APPROVED" })],
    decisions: [{ decisionId: "d1", proposalId: "p1", decision: "APPROVE", decidedAt: NOW, reservedAt: NOW }],
    results: [],
  };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-a", publicationActive: true });
  assert.equal(findProposalDisplayState(view, "p1"), "EXECUTING_NOW");
});

scenario("live HEAD has already moved past baseHead but the store has not reconciled to STALE yet -> REVALIDATING_FOR_NEW_HEAD, never presented as plain PENDING", () => {
  const state: AyasApprovalInboxReadState = { proposals: [proposal({ status: "PENDING", baseHead: "head-a" })], decisions: [], results: [] };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-b", publicationActive: false });
  assert.equal(findProposalDisplayState(view, "p1"), "REVALIDATING_FOR_NEW_HEAD");
});

scenario("STALE proposal with a fresh rediscovery already PENDING for the same exact files -> STALE_SUPERSEDED, points at the successor", () => {
  const state: AyasApprovalInboxReadState = {
    proposals: [
      proposal({ proposalId: "p-old", status: "STALE", baseHead: "head-a", createdAt: "2026-09-17T09:00:00.000Z", exactFiles: ["scripts/target.ts"] }),
      proposal({ proposalId: "p-fresh", status: "PENDING", baseHead: "head-b", createdAt: "2026-09-17T09:05:00.000Z", exactFiles: ["scripts/target.ts"] }),
    ],
    decisions: [], results: [],
  };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-b", publicationActive: false });
  const old = [...view.pending, ...view.today, ...view.history].find((p) => p.proposalId === "p-old");
  assert.equal(old?.displayState, "STALE_SUPERSEDED");
  assert.equal(old?.supersededByProposalId, "p-fresh");
});

scenario("STALE proposal with no fresh rediscovery yet -> STALE_AWAITING_REDISCOVERY, never silently disappears without explanation", () => {
  const state: AyasApprovalInboxReadState = { proposals: [proposal({ status: "STALE" })], decisions: [], results: [] };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-b", publicationActive: false });
  assert.equal(findProposalDisplayState(view, "p1"), "STALE_AWAITING_REDISCOVERY");
});

scenario("a COMPLETED proposal is never given a race-related displayState, regardless of live gate/HEAD signals", () => {
  const state: AyasApprovalInboxReadState = { proposals: [proposal({ status: "COMPLETED" })], decisions: [], results: [] };
  const view = buildAyasApprovalInboxView(state, NOW, { liveCurrentHead: "head-b", publicationActive: true });
  assert.equal(findProposalDisplayState(view, "p1"), "NORMAL");
});

// ---- Batch lane: the mirror-image scenarios, matching AyasMicroBatchDevelopmentView -------------

function findBatchEntry(view: ReturnType<typeof buildAyasMicroBatchDevelopmentView>, id: string) {
  return [view.active, ...view.history].filter((b): b is NonNullable<typeof b> => b !== null).find((b) => b.batchId === id);
}

scenario("batch: gate open for a DIFFERENT publication -> WAITING_OTHER_PUBLICATION, BATCH ONAYLA VE UYGULA must not be presented as actionable", () => {
  const state: AyasMicroBatchReadState = { batches: [batch({ status: "READY_FOR_REVIEW" })], decisions: [], results: [] };
  const view = buildAyasMicroBatchDevelopmentView(state, { liveCurrentHead: "head-a", publicationActive: true });
  assert.equal(findBatchEntry(view, "b1")?.displayState, "WAITING_OTHER_PUBLICATION");
});

scenario("batch: this exact batch holds the reservation while the gate is open -> EXECUTING_NOW", () => {
  const state: AyasMicroBatchReadState = {
    batches: [batch({ status: "APPROVED" })],
    decisions: [{ decisionId: "d1", batchId: "b1", decision: "APPROVE", decidedAt: NOW, reservedAt: NOW }],
    results: [],
  };
  const view = buildAyasMicroBatchDevelopmentView(state, { liveCurrentHead: "head-a", publicationActive: true });
  assert.equal(findBatchEntry(view, "b1")?.displayState, "EXECUTING_NOW");
});

scenario("batch: exactly the live incident this sprint reconciled — an APPROVED batch whose baseHead a sibling publication has already superseded, before the store's own reconciliation pass runs -> REVALIDATING_FOR_NEW_HEAD, never shown as plain-actionable APPROVED", () => {
  const state: AyasMicroBatchReadState = { batches: [batch({ status: "APPROVED", baseHead: "5fd40df" })], decisions: [], results: [] };
  const view = buildAyasMicroBatchDevelopmentView(state, { liveCurrentHead: "dc33c69", publicationActive: false });
  assert.equal(findBatchEntry(view, "b1")?.displayState, "REVALIDATING_FOR_NEW_HEAD");
});

scenario("batch: STALE with a fresh ACCUMULATING batch already reforming over overlapping files -> STALE_SUPERSEDED, points at the successor (the UI never just reports it as gone)", () => {
  const state: AyasMicroBatchReadState = {
    batches: [
      batch({ batchId: "b-old", status: "STALE", baseHead: "5fd40df", createdAt: "2026-09-17T09:25:31.920Z", exactFilesUnion: ["scripts/a.ts", "scripts/b.ts", "scripts/c.ts"] }),
      batch({ batchId: "b-fresh", status: "ACCUMULATING", baseHead: "dc33c69", createdAt: "2026-09-17T09:36:20.578Z", exactFilesUnion: ["scripts/a.ts"] }),
    ],
    decisions: [], results: [],
  };
  const view = buildAyasMicroBatchDevelopmentView(state, { liveCurrentHead: "dc33c69", publicationActive: false });
  const old = findBatchEntry(view, "b-old");
  assert.equal(old?.displayState, "STALE_SUPERSEDED");
  assert.equal(old?.supersededByBatchId, "b-fresh");
});

scenario("batch: STALE with no successor yet -> STALE_AWAITING_REDISCOVERY", () => {
  const state: AyasMicroBatchReadState = { batches: [batch({ status: "STALE" })], decisions: [], results: [] };
  const view = buildAyasMicroBatchDevelopmentView(state, { liveCurrentHead: "head-b", publicationActive: false });
  assert.equal(findBatchEntry(view, "b1")?.displayState, "STALE_AWAITING_REDISCOVERY");
});

scenario("no activity snapshot supplied at all (default parameter) -> every existing pre-Part-A test call site keeps working exactly as before, entirely NORMAL", () => {
  const state: AyasMicroBatchReadState = { batches: [batch({})], decisions: [], results: [] };
  const view = buildAyasMicroBatchDevelopmentView(state);
  assert.equal(findBatchEntry(view, "b1")?.displayState, "NORMAL");
});

console.log(`AYAS publication activity (approval-race UX) smoke: PASS (${count} scenarios)`);
console.log(JSON.stringify({ status: "PASS", suite: "ayas-publication-activity", scenarios: count }));
