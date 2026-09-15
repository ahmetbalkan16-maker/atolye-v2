import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { buildAyasApprovalInboxView } from "../src/lib/brain/autonomy/AyasApprovalInboxView";
import { isAyasDeferredEligibleNow } from "../src/lib/brain/autonomy/AyasDeferredEligibility";
import { computeAyasDevelopmentStatusData } from "../src/lib/ayas/execution/AyasDevelopmentStatus";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-deferred-")); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-15T09:00:00.000Z",
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
    testsPlanned: ["smoke-ayas-deferred-reeligibility"],
    estimatedCost: "zero-cost" as const,
    ...overrides,
  };
}

const T0 = "2026-09-15T12:00:00.000Z";
const NEXT_ELIGIBLE = "2026-09-16T12:00:00.000Z"; // T0 + 24h, matching decide()'s LATER computation
const BEFORE = "2026-09-16T11:59:59.999Z";
const AT = NEXT_ELIGIBLE;
const AFTER = "2026-09-16T12:00:00.001Z";

function deferredFixture(rootDir: string, overrides: Parameters<typeof proposalInput>[0] = {}) {
  const inbox = createAyasApprovalInboxStore({ rootDir });
  const p = inbox.createProposal(proposalInput(overrides));
  inbox.decide(p.proposalId, "LATER", T0);
  return { inbox, proposal: p };
}

async function main() {
  // --- 1/7: view visibility before/after eligibility -------------------------
  await scenario("a deferred proposal before its nextEligibleAt is NOT shown as pending", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const view = buildAyasApprovalInboxView(inbox.load(), BEFORE);
    assert.equal(view.pending.some((x) => x.proposalId === proposal.proposalId), false);
  });

  await scenario("a deferred proposal at/after its nextEligibleAt IS shown as pending", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const view = buildAyasApprovalInboxView(inbox.load(), AT);
    assert.ok(view.pending.some((x) => x.proposalId === proposal.proposalId));
  });

  // --- 2/3: APPROVE/REJECT rejected before eligibility ------------------------
  await scenario("before eligibility, APPROVE is rejected by the Store", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", BEFORE), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  await scenario("before eligibility, REJECT is rejected by the Store", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    assert.throws(() => inbox.decide(proposal.proposalId, "REJECT", BEFORE), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  // --- 4/5: reserve/consume rejected before eligibility (status never reaches APPROVED) ---
  await scenario("before eligibility, reserveApproval is rejected (the proposal never reached APPROVED)", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    assert.throws(
      () => inbox.reserveApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, BEFORE),
      (e: unknown) => e instanceof AyasApprovalInboxStoreError,
    );
  });

  await scenario("before eligibility, the deprecated consumeApproval is rejected (the proposal never reached APPROVED)", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    assert.throws(
      () => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, BEFORE),
      (e: unknown) => e instanceof AyasApprovalInboxStoreError,
    );
  });

  // --- 6: exact boundary ---------------------------------------------------------
  await scenario("eligibility is inclusive of the exact nextEligibleAt instant, and false one millisecond before it", () => {
    assert.equal(isAyasDeferredEligibleNow(NEXT_ELIGIBLE, BEFORE), false);
    assert.equal(isAyasDeferredEligibleNow(NEXT_ELIGIBLE, AT), true);
    assert.equal(isAyasDeferredEligibleNow(NEXT_ELIGIBLE, AFTER), true);
  });

  // --- 8/9: APPROVE/REJECT succeed after eligibility -------------------------------
  await scenario("after eligibility, APPROVE succeeds for a SAFE, explanation-ready proposal", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const { proposal: decided } = inbox.decide(proposal.proposalId, "APPROVE", AT);
    assert.equal(decided.status, "APPROVED");
  });

  await scenario("after eligibility, REJECT succeeds", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const { proposal: decided } = inbox.decide(proposal.proposalId, "REJECT", AT);
    assert.equal(decided.status, "REJECTED");
  });

  // --- 10/11: re-defer -------------------------------------------------------------
  await scenario("after eligibility, LATER re-defers correctly with a fresh nextEligibleAt", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const { proposal: redeferred } = inbox.decide(proposal.proposalId, "LATER", AT);
    assert.equal(redeferred.status, "DEFERRED");
    assert.equal(redeferred.nextEligibleAt, new Date(Date.parse(AT) + 24 * 60 * 60 * 1000).toISOString());
    assert.notEqual(redeferred.nextEligibleAt, NEXT_ELIGIBLE, "re-defer must compute a NEW eligibility time, not reuse the old one");
  });

  await scenario("a still-not-yet-eligible deferred proposal can still be re-deferred further (unchanged, pre-existing behavior)", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const { proposal: redeferred } = inbox.decide(proposal.proposalId, "LATER", BEFORE);
    assert.equal(redeferred.status, "DEFERRED");
  });

  // --- 12/13: no side effect merely from clock passage -----------------------------
  await scenario("merely reading the view across the eligibility boundary mints no authorization and writes no decision", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const stateFile = inbox.stateFile;
    const before = fs.readFileSync(stateFile, "utf8");
    buildAyasApprovalInboxView(inbox.load(), BEFORE);
    buildAyasApprovalInboxView(inbox.load(), AT);
    buildAyasApprovalInboxView(inbox.load(), AFTER);
    const after = fs.readFileSync(stateFile, "utf8");
    assert.equal(after, before, "reading status/eligibility must never write to the durable store");
    void proposal;
  });

  // --- 14: no duplicate proposal --------------------------------------------------
  await scenario("re-proposing identical content while eligible-again-deferred returns the SAME proposal, never a duplicate", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    const state = inbox.load();
    const countBefore = state.proposals.length;
    const again = inbox.createProposal(proposalInput());
    assert.equal(again.proposalId, proposal.proposalId);
    assert.equal(inbox.load().proposals.length, countBefore);
  });

  // --- 15/16: restart safety (fresh store handle) ----------------------------------
  await scenario("restart-safety: a FRESH store handle before eligibility still rejects APPROVE", () => {
    const rootDir = root();
    const { proposal } = deferredFixture(rootDir);
    const restarted = createAyasApprovalInboxStore({ rootDir });
    assert.throws(() => restarted.decide(proposal.proposalId, "APPROVE", BEFORE), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  await scenario("restart-safety: a FRESH store handle after eligibility accepts APPROVE — no in-memory timer is authoritative", () => {
    const rootDir = root();
    const { proposal } = deferredFixture(rootDir);
    const restarted = createAyasApprovalInboxStore({ rootDir });
    const { proposal: decided } = restarted.decide(proposal.proposalId, "APPROVE", AT);
    assert.equal(decided.status, "APPROVED");
  });

  // --- 17/18: cross-surface consistency --------------------------------------------
  await scenario("the Gelişim Merkezi view and the Store agree exactly on what is decidable, both before and after eligibility", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir);
    for (const [now, expectDecidable] of [[BEFORE, false], [AT, true]] as const) {
      const view = buildAyasApprovalInboxView(inbox.load(), now);
      const viewSaysPending = view.pending.some((x) => x.proposalId === proposal.proposalId);
      assert.equal(viewSaysPending, expectDecidable, `view/store mismatch at ${now}`);
    }
  });

  await scenario("the M7 natural-language status response agrees with the Store — never claims a proposal is pending when the Store would reject it", () => {
    const rootDir = root();
    const { proposal } = deferredFixture(rootDir);
    const beforeData = computeAyasDevelopmentStatusData("ne onay bekliyorsun", BEFORE, { rootDir });
    assert.equal(beforeData.pending.some((x) => x.proposalId === proposal.proposalId), false);
    const afterData = computeAyasDevelopmentStatusData("ne onay bekliyorsun", AT, { rootDir });
    assert.ok(afterData.pending.some((x) => x.proposalId === proposal.proposalId));
  });

  // --- 19/20/21/22: safety invariants survive expiry --------------------------------
  await scenario("SAFE-only invariant: a non-SAFE deferred-then-eligible proposal still cannot be APPROVEd", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir, { safetyClassification: "REVIEW_REQUIRED" });
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", AT), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  await scenario("REVIEW_REQUIRED cannot become approvable through deferred expiry alone", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir, { safetyClassification: "REVIEW_REQUIRED" });
    assert.throws(
      () => inbox.decide(proposal.proposalId, "APPROVE", AT),
      (e: unknown) => e instanceof AyasApprovalInboxStoreError && e.code === "AYAS_INBOX_UNSAFE_APPROVAL",
    );
    // REJECT (which has no SAFE-only gate) still works once eligible — proves the block is specifically the safety classification, not a blanket lockout.
    const { proposal: rejected } = inbox.decide(proposal.proposalId, "REJECT", AT);
    assert.equal(rejected.status, "REJECTED");
  });

  await scenario("FORBIDDEN_AUTONOMOUS cannot become approvable through deferred expiry alone", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir, { safetyClassification: "FORBIDDEN_AUTONOMOUS" });
    assert.throws(
      () => inbox.decide(proposal.proposalId, "APPROVE", AT),
      (e: unknown) => e instanceof AyasApprovalInboxStoreError && e.code === "AYAS_INBOX_UNSAFE_APPROVAL",
    );
  });

  await scenario("a missing M6 explanation field remains non-approvable after deferred expiry", () => {
    const rootDir = root();
    const { inbox, proposal } = deferredFixture(rootDir, { expectedUserBenefit: "" });
    assert.throws(
      () => inbox.decide(proposal.proposalId, "APPROVE", AT),
      (e: unknown) => e instanceof AyasApprovalInboxStoreError && e.code === "AYAS_INBOX_UNSAFE_APPROVAL",
    );
  });

  // --- 23/24/25: terminal statuses are unaffected ----------------------------------
  await scenario("a REJECTED (terminal) proposal is unaffected — still not decidable, before or after any clock", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput());
    inbox.decide(p.proposalId, "REJECT", T0);
    assert.throws(() => inbox.decide(p.proposalId, "APPROVE", AFTER), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  await scenario("a COMPLETED (terminal, post-execution) proposal is unaffected", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput());
    inbox.decide(p.proposalId, "APPROVE", T0);
    const reservation = inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, T0);
    inbox.recordResult(
      { resultId: "r1", proposalId: p.proposalId, authorizationId: reservation.authorizationId, startedAt: T0, completedAt: T0, changedFiles: p.exactFiles, diffFingerprint: "x", testsRun: ["t"], testResults: ["PASS"], outcome: "COMPLETED", gateAuditIdentity: "g1", operatorReviewStatus: "WAITING_REVIEW" },
      "COMPLETED",
    );
    inbox.finalizeApproval(reservation.reservationId, "EXECUTED", T0);
    assert.throws(() => inbox.decide(p.proposalId, "APPROVE", AFTER), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  await scenario("a RECOVERY_REQUIRED proposal is unaffected", () => {
    const rootDir = root();
    const inbox = createAyasApprovalInboxStore({ rootDir });
    const p = inbox.createProposal(proposalInput());
    inbox.decide(p.proposalId, "APPROVE", T0);
    const reservation = inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, T0);
    inbox.finalizeApproval(reservation.reservationId, "RECOVERY_REQUIRED", T0);
    assert.throws(() => inbox.decide(p.proposalId, "APPROVE", AFTER), (e: unknown) => e instanceof AyasApprovalInboxStoreError);
  });

  // --- 26: pure-function fail-closed edge cases ------------------------------------
  await scenario("the pure eligibility predicate fails closed on edge-case input: no restriction when nextEligibleAt is absent, never-eligible on an unparseable date", () => {
    assert.equal(isAyasDeferredEligibleNow(undefined, T0), true);
    assert.equal(isAyasDeferredEligibleNow("not-a-date", T0), false);
  });

  await scenario("the shared predicate module has zero dependency on the Store, daemon, gate, or execution authority", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasDeferredEligibility.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasAutonomyDaemon|AyasExecutionGateStore|reserveApproval|finalizeApproval/);
  });

  console.log(`AYAS deferred re-eligibility smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-deferred-reeligibility", scenarios: count }));
}
main().catch((error) => { console.error("AYAS deferred re-eligibility smoke FAILED:", error); process.exitCode = 1; });
