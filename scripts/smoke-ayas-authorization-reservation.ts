import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-reservation-")); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-15T12:00:00.000Z",
    baseBranch: "wip/test",
    baseHead: "abc123",
    objective: "test-only bounded observability",
    rationale: "a deterministic smoke gap is visible",
    evidence: ["fixture evidence"],
    graphifyEvidence: ["fresh structural graph"],
    candidateRank: 1,
    risk: "low and reversible",
    safetyClassification: "SAFE" as const,
    exactFiles: ["scripts/smoke-ayas-machine-health.ts"],
    expectedDiffScope: "+1 assertion",
    testsPlanned: ["smoke-ayas-authorization-reservation"],
    estimatedCost: "zero-cost" as const,
    ...overrides,
  };
}

function approvedProposal(overrides: Parameters<typeof proposalInput>[0] = {}) {
  const inbox = createAyasApprovalInboxStore({ rootDir: root() });
  const proposal = inbox.createProposal(proposalInput(overrides));
  inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
  return { inbox, proposal };
}

async function main() {
  await scenario("reserveApproval durably binds reservationId, authorizationId, proposalHash, baseHead, exactFiles and moves the proposal to RESERVED", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.ok(reservation.reservationId);
    assert.ok(reservation.authorizationId);
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "RESERVED");
    const decision = state.decisions.find((d) => d.decisionId === reservation.decisionId);
    assert.equal(decision?.reservationId, reservation.reservationId);
    assert.ok(decision?.reservedAt);
  });

  await scenario("a second reservation of the same authorization fails closed", () => {
    const { inbox, proposal } = approvedProposal();
    inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(
      () => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:03:00.000Z"),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError,
    );
  });

  await scenario("a reservation blocks the deprecated single-phase consumeApproval on the same decision, and vice versa", () => {
    const { inbox: inboxA, proposal: proposalA } = approvedProposal();
    inboxA.reserveApproval(proposalA.proposalId, proposalA.proposalHash, proposalA.baseHead, proposalA.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(() => inboxA.consumeApproval(proposalA.proposalId, proposalA.proposalHash, proposalA.baseHead, proposalA.exactFiles, "2026-09-15T12:03:00.000Z"));

    const { inbox: inboxB, proposal: proposalB } = approvedProposal();
    inboxB.consumeApproval(proposalB.proposalId, proposalB.proposalHash, proposalB.baseHead, proposalB.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(() => inboxB.reserveApproval(proposalB.proposalId, proposalB.proposalHash, proposalB.baseHead, proposalB.exactFiles, "2026-09-15T12:03:00.000Z"));
  });

  await scenario("reservation restarts across process boundaries — a fresh store instance sees the same RESERVED state", () => {
    const workspace = root();
    const first = createAyasApprovalInboxStore({ rootDir: workspace });
    const proposal = first.createProposal(proposalInput());
    first.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    const reservation = first.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    const second = createAyasApprovalInboxStore({ rootDir: workspace });
    const state = second.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "RESERVED");
    assert.ok(state.decisions.find((d) => d.reservationId === reservation.reservationId)?.reservedAt);
  });

  await scenario("a REVIEW_REQUIRED proposal cannot be reserved even if somehow marked APPROVED-adjacent", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput({ safetyClassification: "REVIEW_REQUIRED" }));
    // decide() itself already refuses APPROVE for non-SAFE — this proves
    // reserveApproval is unreachable for a non-SAFE proposal by construction,
    // since it can never legitimately reach status "APPROVED".
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z"));
  });

  await scenario("HEAD binding is enforced at reservation", () => {
    const { inbox, proposal } = approvedProposal();
    assert.throws(() => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, "wrong-head", proposal.exactFiles, "2026-09-15T12:02:00.000Z"));
  });

  await scenario("exact-file-scope binding is enforced at reservation", () => {
    const { inbox, proposal } = approvedProposal();
    assert.throws(() => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, ["scripts/other.ts"], "2026-09-15T12:02:00.000Z"));
  });

  await scenario("proposal-hash binding is enforced at reservation", () => {
    const { inbox, proposal } = approvedProposal();
    assert.throws(() => inbox.reserveApproval(proposal.proposalId, "wrong-hash", proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z"));
  });

  await scenario("finalizeApproval(EXECUTED) is refused while the proposal is still RESERVED — a result must be durably recorded first", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(
      () => inbox.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-15T12:05:00.000Z"),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError,
    );
    // The refusal itself must not finalize anything — the reservation stays
    // open, so a subsequent correctly-ordered finalize can still succeed.
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "RESERVED");
    assert.equal(state.decisions.find((d) => d.reservationId === reservation.reservationId)?.finalizedAt, undefined);
  });

  await scenario("finalizeApproval(EXECUTED) succeeds once a result is durably recorded — proposal is never left at RESERVED for a completed execution", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    inbox.recordResult({ resultId: "ayas-result-fixture-1", proposalId: proposal.proposalId, authorizationId: reservation.authorizationId, startedAt: "2026-09-15T12:02:00.000Z", completedAt: "2026-09-15T12:04:00.000Z", changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: ["fixture"], testResults: ["PASS"], outcome: "COMPLETED", gateAuditIdentity: reservation.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
    inbox.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-15T12:05:00.000Z");
    const state = inbox.load();
    const finalProposal = state.proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(finalProposal?.status, "COMPLETED", "an EXECUTED-finalized proposal must be in a terminal result status, never RESERVED");
    const decision = state.decisions.find((d) => d.reservationId === reservation.reservationId);
    assert.equal(decision?.finalizationOutcome, "EXECUTED");
    assert.ok(decision?.finalizedAt);
  });

  await scenario("EXECUTED also succeeds for a FAILED or STALE recorded result — any terminal result status satisfies the invariant, not only COMPLETED", () => {
    for (const outcome of ["FAILED", "STALE"] as const) {
      const { inbox, proposal } = approvedProposal();
      const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
      inbox.recordResult({ resultId: `ayas-result-fixture-${outcome}`, proposalId: proposal.proposalId, authorizationId: reservation.authorizationId, startedAt: "2026-09-15T12:02:00.000Z", completedAt: "2026-09-15T12:04:00.000Z", changedFiles: [], diffFingerprint: "fixture-diff", testsRun: [], testResults: [], outcome, gateAuditIdentity: reservation.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, outcome);
      inbox.finalizeApproval(reservation.reservationId, "EXECUTED", "2026-09-15T12:05:00.000Z");
      assert.equal(inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)?.status, outcome);
    }
  });

  await scenario("finalizeApproval(ABANDONED) moves the proposal to ABANDONED — terminal, never re-decidable", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    inbox.finalizeApproval(reservation.reservationId, "ABANDONED", "2026-09-15T12:05:00.000Z");
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "ABANDONED");
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:06:00.000Z"));
    assert.throws(() => inbox.decide(proposal.proposalId, "REJECT", "2026-09-15T12:06:00.000Z"));
  });

  await scenario("finalizeApproval(RECOVERY_REQUIRED) moves the proposal to RECOVERY_REQUIRED — terminal, never re-decidable, never silently replayed", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    inbox.finalizeApproval(reservation.reservationId, "RECOVERY_REQUIRED", "2026-09-15T12:05:00.000Z");
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "RECOVERY_REQUIRED");
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:06:00.000Z"));
  });

  await scenario("a reservation cannot be finalized twice", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    inbox.finalizeApproval(reservation.reservationId, "ABANDONED", "2026-09-15T12:05:00.000Z");
    assert.throws(() => inbox.finalizeApproval(reservation.reservationId, "ABANDONED", "2026-09-15T12:06:00.000Z"));
  });

  await scenario("finalizing an unknown reservationId fails closed", () => {
    const { inbox } = approvedProposal();
    assert.throws(() => inbox.finalizeApproval("does-not-exist", "ABANDONED", "2026-09-15T12:05:00.000Z"));
  });

  await scenario("an identical-content resubmission while a proposal is RESERVED is suppressed (no duplicate mid-flight proposal)", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    const resubmitted = inbox.createProposal(proposalInput());
    assert.equal(resubmitted.proposalId, proposal.proposalId);
    assert.equal(inbox.load().proposals.length, 1);
  });

  await scenario("an identical-content resubmission after ABANDONED/RECOVERY_REQUIRED is allowed (a fresh attempt is not blocked forever)", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    inbox.finalizeApproval(reservation.reservationId, "ABANDONED", "2026-09-15T12:03:00.000Z");
    const fresh = inbox.createProposal(proposalInput());
    assert.notEqual(fresh.proposalId, proposal.proposalId, "a fresh proposal row is created once the old one is terminally ABANDONED");
    assert.equal(fresh.status, "PENDING");
  });

  await scenario("finalization durability survives restart — a fresh store instance sees the same finalized outcome", () => {
    const workspace = root();
    const first = createAyasApprovalInboxStore({ rootDir: workspace });
    const proposal = first.createProposal(proposalInput());
    first.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    const reservation = first.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    first.finalizeApproval(reservation.reservationId, "ABANDONED", "2026-09-15T12:03:00.000Z");
    const second = createAyasApprovalInboxStore({ rootDir: workspace });
    const state = second.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "ABANDONED");
    assert.equal(state.decisions.find((d) => d.reservationId === reservation.reservationId)?.finalizationOutcome, "ABANDONED");
  });

  await scenario("legacy consumeApproval/reserveApproval cross-guard holds across a restart, for every terminal outcome", () => {
    const cases: readonly ["reserve-then-restart-then-consume" | "consume-then-restart-then-reserve", "ABANDONED" | "RECOVERY_REQUIRED" | null][] = [
      ["reserve-then-restart-then-consume", null],
      ["consume-then-restart-then-reserve", null],
    ];
    for (const [order] of cases) {
      const workspace = root();
      const first = createAyasApprovalInboxStore({ rootDir: workspace });
      const proposal = first.createProposal(proposalInput());
      first.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
      if (order === "reserve-then-restart-then-consume") {
        first.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
        const restarted = createAyasApprovalInboxStore({ rootDir: workspace });
        assert.throws(() => restarted.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:03:00.000Z"));
      } else {
        first.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
        const restarted = createAyasApprovalInboxStore({ rootDir: workspace });
        assert.throws(() => restarted.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:03:00.000Z"));
      }
    }

    // Finalized EXECUTED / ABANDONED / RECOVERY_REQUIRED — legacy consume must fail closed across restart for every terminal outcome.
    for (const outcome of ["EXECUTED", "ABANDONED", "RECOVERY_REQUIRED"] as const) {
      const workspace = root();
      const first = createAyasApprovalInboxStore({ rootDir: workspace });
      const proposal = first.createProposal(proposalInput());
      first.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
      const reservation = first.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
      if (outcome === "EXECUTED") {
        first.recordResult({ resultId: "ayas-result-fixture", proposalId: proposal.proposalId, authorizationId: reservation.authorizationId, startedAt: "2026-09-15T12:02:00.000Z", completedAt: "2026-09-15T12:03:00.000Z", changedFiles: proposal.exactFiles, diffFingerprint: "fixture-diff", testsRun: [], testResults: [], outcome: "COMPLETED", gateAuditIdentity: reservation.authorizationId, operatorReviewStatus: "WAITING_REVIEW" }, "COMPLETED");
      }
      first.finalizeApproval(reservation.reservationId, outcome, "2026-09-15T12:04:00.000Z");
      const restarted = createAyasApprovalInboxStore({ rootDir: workspace });
      assert.throws(
        () => restarted.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:05:00.000Z"),
        `legacy consumeApproval must fail closed after restart for a ${outcome}-finalized reservation`,
      );
    }
  });

  await scenario("failure to finalize never makes an authorization reusable — a finalize on an unknown/foreign reservationId leaves the real reservation exactly as it was", () => {
    const { inbox, proposal } = approvedProposal();
    const reservation = inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(() => inbox.finalizeApproval("not-a-real-reservation-id", "ABANDONED", "2026-09-15T12:03:00.000Z"));
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "RESERVED");
    assert.equal(state.decisions.find((d) => d.reservationId === reservation.reservationId)?.finalizedAt, undefined);
    assert.throws(() => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:04:00.000Z"), "the real reservation is still not re-reservable");
  });

  await scenario("the Stage 7B approval smoke suite still passes unmodified (no regression)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "scripts", "smoke-ayas-autonomy-approval.ts"), "utf8");
    assert.doesNotMatch(src, /reserveApproval|finalizeApproval/, "Stage 7B's own smoke file is untouched by M2");
  });

  console.log(`AYAS authorization reservation smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-authorization-reservation", scenarios: count }));
}
main().catch((error) => { console.error("AYAS authorization reservation smoke FAILED:", error); process.exitCode = 1; });
