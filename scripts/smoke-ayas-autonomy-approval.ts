import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-approval-")); }
function read(relPath: string): string { return fs.readFileSync(path.join(process.cwd(), relPath), "utf8"); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-15T12:00:00.000Z",
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
    testsPlanned: ["smoke-ayas-autonomy-approval"],
    estimatedCost: "zero-cost" as const,
    mutationKind: "test-fixture-mutation",
    ...overrides,
  };
}

async function main() {
  await scenario("a SAFE proposal can be approved and mints an authorization", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    const { decision } = inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.equal(decision.decision, "APPROVE");
    assert.ok(decision.authorizationId);
  });

  await scenario("a REVIEW_REQUIRED proposal cannot be approved — fails at the Store", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput({ safetyClassification: "REVIEW_REQUIRED" }));
    assert.throws(
      () => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z"),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL",
    );
  });

  await scenario("a FORBIDDEN_AUTONOMOUS proposal cannot be approved — fails at the Store", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput({ safetyClassification: "FORBIDDEN_AUTONOMOUS" }));
    assert.throws(
      () => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z"),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL",
    );
  });

  await scenario("a direct, unwrapped Store call cannot bypass the SAFE-only rule", () => {
    // No caller-side pre-check at all here — proves the invariant lives in
    // the Store itself, not merely in `app/brain/actions.ts`'s own guard.
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput({ safetyClassification: "REVIEW_REQUIRED" }));
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z"));
    const state = inbox.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "PENDING");
    assert.equal(state.decisions.length, 0);
  });

  await scenario("a naive caller that skips its own safety pre-check still fails at the Store", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput({ safetyClassification: "FORBIDDEN_AUTONOMOUS" }));
    const naiveCallerApprove = (proposalId: string) => inbox.decide(proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.throws(() => naiveCallerApprove(proposal.proposalId));
  });

  await scenario("authorization ID is minted only for a valid SAFE APPROVE", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    const { decision } = inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.ok(decision.authorizationId);
  });

  await scenario("REJECT mints no authorization", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    const { decision } = inbox.decide(proposal.proposalId, "REJECT", "2026-09-15T12:01:00.000Z");
    assert.equal(decision.authorizationId, undefined);
  });

  await scenario("LATER (defer) mints no authorization", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    const { decision, proposal: updated } = inbox.decide(proposal.proposalId, "LATER", "2026-09-15T12:01:00.000Z");
    assert.equal(decision.authorizationId, undefined);
    assert.equal(updated.status, "DEFERRED");
    assert.ok(updated.nextEligibleAt);
  });

  await scenario("proposal-hash binding is enforced at consumption", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, "wrong-hash", proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z"));
  });

  await scenario("base-HEAD binding is enforced at consumption", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, "wrong-head", proposal.exactFiles, "2026-09-15T12:02:00.000Z"));
  });

  await scenario("exact-file-scope binding is enforced at consumption", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, ["scripts/other.ts"], "2026-09-15T12:02:00.000Z"));
  });

  await scenario("a consumed authorization cannot replay", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:02:00.000Z");
    assert.throws(() => inbox.consumeApproval(proposal.proposalId, proposal.proposalHash, proposal.baseHead, proposal.exactFiles, "2026-09-15T12:03:00.000Z"));
  });

  await scenario("corrupt durable inbox fails closed", () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "autonomy", "approval-inbox.json"), "not json");
    const inbox = createAyasApprovalInboxStore({ rootDir: workspace });
    assert.throws(
      () => inbox.load(),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_CORRUPT",
    );
  });

  await scenario("schema mismatch fails closed", () => {
    const workspace = root();
    fs.mkdirSync(path.join(workspace, "autonomy"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "autonomy", "approval-inbox.json"), JSON.stringify({ schemaVersion: "99", revision: 0, proposals: [], decisions: [], results: [] }));
    const inbox = createAyasApprovalInboxStore({ rootDir: workspace });
    assert.throws(
      () => inbox.load(),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_SCHEMA_MISMATCH",
    );
  });

  await scenario("duplicate proposal hash is suppressed — no second row is created", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const first = inbox.createProposal(proposalInput());
    const second = inbox.createProposal(proposalInput());
    assert.equal(first.proposalId, second.proposalId);
    assert.equal(inbox.load().proposals.length, 1);
  });

  await scenario("a rejected proposal does not silently resurface as a new pending candidate on an identical re-submission", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "REJECT", "2026-09-15T12:01:00.000Z");
    const resubmitted = inbox.createProposal(proposalInput());
    assert.equal(resubmitted.proposalId, proposal.proposalId);
    assert.equal(resubmitted.status, "REJECTED");
    assert.equal(inbox.load().proposals.length, 1);
  });

  await scenario("a deferred proposal cannot be approved or rejected directly — only re-deferred", () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: root() });
    const proposal = inbox.createProposal(proposalInput());
    inbox.decide(proposal.proposalId, "LATER", "2026-09-15T12:01:00.000Z");
    assert.throws(() => inbox.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:02:00.000Z"));
    assert.throws(() => inbox.decide(proposal.proposalId, "REJECT", "2026-09-15T12:02:00.000Z"));
    const { proposal: reDeferred } = inbox.decide(proposal.proposalId, "LATER", "2026-09-15T12:02:00.000Z");
    assert.equal(reDeferred.status, "DEFERRED");
  });

  await scenario("restart preserves proposal and decision state", () => {
    const workspace = root();
    const first = createAyasApprovalInboxStore({ rootDir: workspace });
    const proposal = first.createProposal(proposalInput());
    first.decide(proposal.proposalId, "APPROVE", "2026-09-15T12:01:00.000Z");
    const second = createAyasApprovalInboxStore({ rootDir: workspace });
    const state = second.load();
    assert.equal(state.proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "APPROVED");
    assert.equal(state.decisions.length, 1);
  });

  await scenario("Stage 7B decision/display files have zero import of AyasExecutionGateStore or executeApproved", () => {
    // `app/brain/actions.ts` is deliberately EXCLUDED as of M15: it now hosts
    // the one real, session-gated `executeAyasApprovedProposal` action. Every
    // other file in Stage 7B's decision/display path stays execution-free —
    // the invariant this scenario always proved.
    const files = [
      "src/lib/brain/autonomy/AyasApprovalInboxStore.ts",
      "src/components/brain/AyasApprovalInboxPanel.tsx",
      "src/components/brain/BrainCoreConsole.tsx",
      "app/brain/page.tsx",
    ];
    for (const file of files) {
      assert.doesNotMatch(read(file), /AyasExecutionGateStore|executeApproved/, `${file} must not reach execution authority`);
    }
  });
  await scenario("M15: actions.ts reaches execution ONLY through executeAyasApprovedProposal, never through decideAyasApproval", () => {
    const src = read("app/brain/actions.ts");
    assert.match(src, /AyasProposalExecutionService/, "actions.ts must delegate execution to the extracted, testable service — not reimplement it inline");
    const decideBody = src.slice(src.indexOf("export async function decideAyasApproval"), src.indexOf("export async function decideAyasApproval") + src.slice(src.indexOf("export async function decideAyasApproval")).indexOf("\n}\n"));
    assert.doesNotMatch(decideBody, /executeAyasApprovedProposalWith|AyasAutonomyDaemon/, "decideAyasApproval must never call into execution");
    const executeBody = src.slice(src.indexOf("export async function executeAyasApprovedProposal"));
    assert.match(executeBody, /requireBrainSession/, "the execution action must independently verify the session, not rely on middleware alone");
    assert.match(executeBody, /executeAyasApprovedProposalWith/, "the execution action must delegate to Package C via the extracted service");
  });
  await scenario("M15.1 fix: executeAyasApprovedProposal returns a result rather than letting a thrown error cross the Server Action boundary unconverted", () => {
    // The bug this fixes: BrainCoreConsole.tsx's `onExecuteProposal` used to
    // do `try { setApprovalInbox(await executeProposal(input)); } catch { }`
    // — any thrown error (e.g. AYAS_MUTATION_KIND_UNKNOWN because the
    // running server had a stale build) was silently discarded, so a human
    // clicking YÜRÜT saw nothing happen at all with no explanation.
    const actionsSrc = read("app/brain/actions.ts");
    const executeBody = actionsSrc.slice(actionsSrc.indexOf("export async function executeAyasApprovedProposal"));
    assert.match(executeBody, /catch\s*\(error\)/, "the action itself must catch the thrown execution error");
    assert.match(executeBody, /ok:\s*false/, "a failure must be a normal returned value, not a re-thrown error, so Next.js never redacts the reason in production");
    const consoleSrc = read("src/components/brain/BrainCoreConsole.tsx");
    const onExecuteBody = consoleSrc.slice(consoleSrc.indexOf("const onExecuteProposal"), consoleSrc.indexOf("const onExecuteProposal") + 700);
    assert.doesNotMatch(onExecuteBody, /catch\s*\{\s*\/\*\s*retain last durable view\s*\*\/\s*\}/, "the silent-discard catch must be gone from the execution handler");
    assert.match(onExecuteBody, /setExecutionError/, "a failed result must be recorded in visible state, not discarded");
  });

  console.log(`AYAS autonomy approval smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomy-approval", scenarios: count }));
}
main().catch((error) => { console.error("AYAS autonomy approval smoke FAILED:", error); process.exitCode = 1; });
