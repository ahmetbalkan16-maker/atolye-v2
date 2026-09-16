import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, type AyasInboxProposal, type AyasInboxProposalStatus } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

/**
 * `AyasApprovalInboxStore.createProposal` dedupes an identical candidate
 * (same `proposalHash`) only while a prior instance is still in an
 * ACTIONABLE status (PENDING/APPROVED/REJECTED/DEFERRED/RESERVED). This
 * suite proves the other half of that boundary, which had no coverage: once
 * a prior instance has reached a TERMINAL outcome (COMPLETED, ABANDONED,
 * RECOVERY_REQUIRED, STALE, FAILED), re-proposing the exact same content
 * must create a genuinely NEW, independent proposal — never silently reuse
 * or resurrect the old one — while the old terminal record stays intact in
 * history. Without this, a real improvement that legitimately recurs after
 * a prior execution finished (successfully or not) could never be proposed
 * again, or worse, could be silently conflated with a closed case.
 */

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-terminal-dedup-")); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-16T09:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "test-only bounded observability",
    currentProblem: "fixture misses one deterministic assertion",
    selectionReason: "the fixture evidence identifies this bounded gap",
    expectedUserBenefit: "the regression is caught before it reaches the user",
    expectedBehaviorChange: "the smoke test checks one additional invariant",
    unchangedBehavior: "production execution and user data do not change",
    riskIfNotDone: "the regression could remain unnoticed",
    technicalRisk: "low; one reversible assertion",
    productionImpact: "none until a separately authorized execution",
    rationale: "a deterministic smoke gap is visible",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    expectedDiffScope: "+1 assertion",
    testsPlanned: ["smoke-ayas-proposal-terminal-state-dedup"],
    estimatedCost: "zero-cost" as const,
    mutationKind: "test-fixture-mutation",
    ...overrides,
  };
}

/** Drives one proposal to the given terminal status via the real, existing durable-state API — never by writing state directly. */
function driveToTerminal(inbox: ReturnType<typeof createAyasApprovalInboxStore>, proposalId: string, proposalHash: string, baseHead: string, exactFiles: readonly string[], status: "COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED"): void {
  inbox.decide(proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
  if (status === "ABANDONED" || status === "RECOVERY_REQUIRED") {
    const reservation = inbox.reserveApproval(proposalId, proposalHash, baseHead, exactFiles, "2026-09-16T09:02:00.000Z");
    inbox.finalizeApproval(reservation.reservationId, status, "2026-09-16T09:03:00.000Z");
    return;
  }
  const reservation = inbox.reserveApproval(proposalId, proposalHash, baseHead, exactFiles, "2026-09-16T09:02:00.000Z");
  inbox.recordResult({ resultId: `result-${proposalId}`, proposalId, authorizationId: reservation.authorizationId, startedAt: "2026-09-16T09:02:30.000Z", completedAt: "2026-09-16T09:03:00.000Z", changedFiles: exactFiles, diffFingerprint: "fixture-fingerprint", testsRun: ["fixture"], testResults: ["PASS"], outcome: status, gateAuditIdentity: "fixture", operatorReviewStatus: "WAITING_REVIEW" }, status);
  inbox.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-16T09:03:30.000Z");
}

const ACTIONABLE: readonly AyasInboxProposalStatus[] = ["PENDING", "APPROVED", "REJECTED", "DEFERRED", "RESERVED"];
const TERMINAL: readonly ("COMPLETED" | "FAILED" | "STALE" | "ABANDONED" | "RECOVERY_REQUIRED")[] = ["COMPLETED", "FAILED", "STALE", "ABANDONED", "RECOVERY_REQUIRED"];

async function main() {
  await scenario("baseline: an identical PENDING candidate is deduped (returns the same instance)", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const p1 = inbox.createProposal(proposalInput());
    const p2 = inbox.createProposal(proposalInput());
    assert.equal(p2.proposalId, p1.proposalId);
    assert.equal(inbox.load().proposals.length, 1);
  });

  for (const status of ACTIONABLE) {
    await scenario(`an identical candidate is deduped while a prior instance is ${status}`, () => {
      const inbox = createAyasApprovalInboxStore({ rootDir: root() });
      const p1 = inbox.createProposal(proposalInput());
      if (status !== "PENDING") {
        if (status === "APPROVED") inbox.decide(p1.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z");
        else if (status === "REJECTED") inbox.decide(p1.proposalId, "REJECT", "2026-09-16T09:01:00.000Z");
        else if (status === "DEFERRED") inbox.decide(p1.proposalId, "LATER", "2026-09-16T09:01:00.000Z");
        else if (status === "RESERVED") { inbox.decide(p1.proposalId, "APPROVE", "2026-09-16T09:01:00.000Z"); inbox.reserveApproval(p1.proposalId, p1.proposalHash, p1.baseHead, p1.exactFiles, "2026-09-16T09:02:00.000Z"); }
      }
      assert.equal(inbox.load().proposals.find((p) => p.proposalId === p1.proposalId)?.status, status);
      const p2 = inbox.createProposal(proposalInput());
      assert.equal(p2.proposalId, p1.proposalId, `expected dedup while status is ${status}`);
      assert.equal(inbox.load().proposals.length, 1);
    });
  }

  for (const status of TERMINAL) {
    await scenario(`an identical candidate creates a NEW proposal once a prior instance reached ${status}, and history is preserved`, () => {
      const inbox = createAyasApprovalInboxStore({ rootDir: root() });
      const p1 = inbox.createProposal(proposalInput());
      driveToTerminal(inbox, p1.proposalId, p1.proposalHash, p1.baseHead, p1.exactFiles, status);
      assert.equal(inbox.load().proposals.find((p) => p.proposalId === p1.proposalId)?.status, status);
      const p2 = inbox.createProposal(proposalInput());
      assert.notEqual(p2.proposalId, p1.proposalId, `expected a fresh proposal once status is ${status}`);
      assert.equal(p2.status, "PENDING");
      assert.equal(p2.proposalHash, p1.proposalHash, "content is identical, so the hash must still match");
      const state = inbox.load();
      assert.equal(state.proposals.length, 2);
      assert.equal(state.proposals.find((p) => p.proposalId === p1.proposalId)?.status, status, "the old terminal proposal must remain untouched in history");
    });
  }

  await scenario("a genuinely different candidate (different exactFiles) is never deduped against a PENDING one", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const p1 = inbox.createProposal(proposalInput());
    const p2 = inbox.createProposal(proposalInput({ exactFiles: ["scripts/smoke-ayas-other.ts"] }));
    assert.notEqual(p2.proposalId, p1.proposalId);
    assert.notEqual(p2.proposalHash, p1.proposalHash);
    assert.equal(inbox.load().proposals.length, 2);
  });

  console.log(`AYAS proposal terminal-state dedup smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-proposal-terminal-state-dedup", scenarios: count }));
}
void main();
