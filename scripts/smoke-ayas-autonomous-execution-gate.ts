import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { evaluateAyasInternalDecision } from "../src/lib/brain/autonomy/AyasInternalDecision";
import { buildAyasOwnerApprovalRequest } from "../src/lib/brain/autonomy/AyasOwnerApprovalRequest";
import { bindAyasOwnerApproval, reevaluateAyasApprovalBinding } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { reviewAyasPendingProposals } from "../src/lib/brain/autonomy/AyasAutonomousReview";
import {
  decideAyasOwnerApproval,
  isAyasAutonomousExecutionEnabled,
  AYAS_AUTONOMOUS_EXECUTION_ENV_VAR,
} from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON, isAyasOwnerApprovedDecisionReason } from "../src/lib/brain/autonomy/AyasOwnerApprovalProvenance";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

/**
 * Owner-approval-model correction — the internal REJECT/DEFER/
 * RECOMMEND_FOR_APPROVAL filter, the plain-language approval request, the
 * approval binding/invalidation, and the final autonomous-execution gate.
 * Deliberately does NOT re-test what `smoke-ayas-proposal-approval-service.ts`
 * already proves (staging scope, revert-to-HEAD, Graphify mismatch, push
 * failure, replay refusal at the service layer) — this suite covers only the
 * new layer sitting in front of that service.
 */
let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-autonomous-gate-")); }
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim(); }

function proposalInput(overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  return {
    createdAt: "2026-09-17T00:00:00.000Z",
    baseBranch: "master",
    baseHead: "will-be-overridden",
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
    // Not part of the real create-input type (the store sets it), but pure
    // unit tests below cast this object directly to AyasInboxProposal
    // without going through the real store, so it needs a stand-in value.
    status: "PENDING" as const,
    ...overrides,
  };
}

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly inboxRootDir: string;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function makeFixture(): Fixture {
  const remoteDir = root();
  git(remoteDir, "init", "-q", "--bare");
  const repoRoot = root();
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "f@example.com");
  git(repoRoot, "config", "user.name", "f");
  fs.mkdirSync(path.join(repoRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, "scripts", "existing.ts"), "export const existing = 1;\n");
  fs.writeFileSync(path.join(repoRoot, ".gitignore"), "node_modules/\n.graphify/\nscripts/.graphify/\n");
  fs.writeFileSync(
    path.join(repoRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "ES2020", module: "commonjs", moduleResolution: "node", esModuleInterop: true, strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, include: ["src/**/*.ts", "scripts/**/*.ts"], exclude: ["node_modules"] }, null, 2),
    "utf8",
  );
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir);
  git(repoRoot, "push", "-q", "-u", "origin", "master");
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  for (const dep of ["tsx", "typescript", "@types"]) {
    fs.symlinkSync(path.join(process.cwd(), "node_modules", dep), path.join(repoRoot, "node_modules", dep), process.platform === "win32" ? "junction" : "dir");
  }
  const inboxRootDir = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-autonomous-gate-inbox-"));
  return {
    repoRoot, remoteDir,
    gateRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-autonomous-gate-root-")),
    inbox: createAyasApprovalInboxStore({ rootDir: inboxRootDir }),
    inboxRootDir,
    artifactStore: createAyasPatchArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "ayas-autonomous-gate-artifacts-")) }),
    // The real post-push Graphify/health closure is covered by
    // smoke-ayas-proposal-approval-service.ts; this throwaway repo has no
    // graph or health CLI, so only the published HEAD is verified here.
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

function seedNewFileProposal(f: Fixture, overrides: Partial<Omit<AyasInboxProposal, "schemaVersion" | "proposalId" | "lastUpdatedAt" | "proposalHash" | "status" | "createdBy">> = {}) {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const content = 'console.log(JSON.stringify({ status: "PASS", suite: "fixture-generated", scenarios: 1 }));\n';
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${Math.random().toString(36).slice(2)}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: ["scripts/smoke-fixture-generated.ts"], allowedRoots: ["scripts/"],
    replacements: [{ filePath: "scripts/smoke-fixture-generated.ts", expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { "scripts/smoke-fixture-generated.ts": 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-09-17T00:00:00.000Z",
  } as never);
  const proposal = f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash, ...overrides } as never));
  return { proposal, artifact, head };
}

async function main(): Promise<void> {
  // --- 1-2-3: internal review filters before anything reaches an owner ---

  await scenario("1. a bad proposal (FORBIDDEN_AUTONOMOUS target) is internally REJECTed, never reaches RECOMMEND_FOR_APPROVAL", () => {
    const decision = evaluateAyasInternalDecision(proposalInput({ safetyClassification: "FORBIDDEN_AUTONOMOUS", exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"] } as never) as unknown as AyasInboxProposal);
    assert.equal(decision.decision, "REJECT");
    assert.equal(decision.executable, false);
  });

  await scenario("2. an insufficient-evidence proposal is internally DEFERred, never reaches RECOMMEND_FOR_APPROVAL", () => {
    const decision = evaluateAyasInternalDecision(proposalInput({ evidence: [], graphifyEvidence: [] } as never) as unknown as AyasInboxProposal);
    assert.equal(decision.decision, "DEFER");
  });

  await scenario("3. a valid, useful, SAFE, sandbox-validated proposal becomes RECOMMEND_FOR_APPROVAL and executable", () => {
    const decision = evaluateAyasInternalDecision(proposalInput() as unknown as AyasInboxProposal);
    assert.equal(decision.decision, "RECOMMEND_FOR_APPROVAL");
    assert.equal(decision.executable, true);
  });

  await scenario("4. reviewAyasPendingProposals never mutates the repo — recommended proposals stay PENDING, rejected/deferred ones are decided but no file changes", async () => {
    const f = makeFixture();
    seedNewFileProposal(f); // RECOMMEND_FOR_APPROVAL candidate
    const { proposal: badProposal } = seedNewFileProposal(f, { safetyClassification: "FORBIDDEN_AUTONOMOUS" as never, exactFiles: ["src/lib/ayas/execution/AyasExecutionGateStore.ts"] });
    const outcome = reviewAyasPendingProposals(f.inbox);
    assert.equal(outcome.recommended.length, 1);
    assert.equal(outcome.rejected.length, 1);
    assert.equal(outcome.rejected[0]?.proposalId, badProposal.proposalId);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === outcome.recommended[0]!.request.proposalId)!.status, "PENDING");
    assert.equal(git(f.repoRoot, "status", "--short"), "", "review alone must never touch the working tree");
  });

  // --- 5-6-7: owner APPROVE/REJECT ---

  await scenario("5. APPROVE with autonomous execution enabled results in exactly one real execution", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const outcome = await decideAyasOwnerApproval(binding, "APPROVE", { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } });
    assert.equal(outcome.executed, true);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
    const remoteHead = git(f.remoteDir, "rev-parse", "master");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), remoteHead);
  });

  await scenario("6. REJECT prevents execution — decided REJECTED, zero mutation", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const outcome = await decideAyasOwnerApproval(binding, "REJECT", { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } });
    assert.equal(outcome.executed, false);
    if (!outcome.executed) assert.equal(outcome.reason, "OWNER_REJECTED");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "REJECTED");
    assert.equal(git(f.repoRoot, "status", "--short"), "");
  });

  await scenario("7 / 17 / 19. no second approval: a duplicate APPROVE delivery on an already-COMPLETED proposal cannot double-execute", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const deps = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const first = await decideAyasOwnerApproval(binding, "APPROVE", deps);
    assert.equal(first.executed, true);
    const headAfterFirst = git(f.repoRoot, "rev-parse", "HEAD");
    const second = await decideAyasOwnerApproval(binding, "APPROVE", deps); // simulates a duplicate delivery, or a restart replaying the same click
    assert.equal(second.executed, false);
    if (!second.executed) assert.equal(second.reason, "NOT_PENDING");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), headAfterFirst, "no second commit");
  });

  // --- 8-12: approval binding invalidation ---

  await scenario("8. stale HEAD (baseHead drift) invalidates the binding", () => {
    const proposal = { ...proposalInput({ baseHead: "abc123" }) } as unknown as AyasInboxProposal;
    const binding = bindAyasOwnerApproval(proposal, "2026-09-17T00:00:00.000Z");
    const drifted = { ...proposal, baseHead: "def456" } as AyasInboxProposal;
    const evaluation = reevaluateAyasApprovalBinding(binding, drifted);
    assert.equal(evaluation.valid, false);
    if (!evaluation.valid) assert.equal(evaluation.reason, "BASE_HEAD_CHANGED");
  });

  await scenario("9. changed scope (exactFiles) invalidates the binding", () => {
    const proposal = proposalInput({ baseHead: "abc123" }) as unknown as AyasInboxProposal;
    const binding = bindAyasOwnerApproval(proposal, "2026-09-17T00:00:00.000Z");
    const scopeDrifted = { ...proposal, exactFiles: [...proposal.exactFiles, "scripts/unexpected-extra.ts"] } as AyasInboxProposal;
    const evaluation = reevaluateAyasApprovalBinding(binding, scopeDrifted);
    assert.equal(evaluation.valid, false);
    if (!evaluation.valid) assert.equal(evaluation.reason, "SCOPE_CHANGED");
  });

  await scenario("10. changed patch-artifact identity/hash invalidates the binding", () => {
    const proposal = proposalInput({ baseHead: "abc123", patchArtifactId: "ayas-patch-artifact-a", patchHash: "hash-a" }) as unknown as AyasInboxProposal;
    const binding = bindAyasOwnerApproval(proposal, "2026-09-17T00:00:00.000Z");
    const artifactDrifted = { ...proposal, patchArtifactId: "ayas-patch-artifact-b", patchHash: "hash-b" } as AyasInboxProposal;
    const evaluation = reevaluateAyasApprovalBinding(binding, artifactDrifted);
    assert.equal(evaluation.valid, false);
    if (!evaluation.valid) assert.equal(evaluation.reason, "PATCH_ARTIFACT_CHANGED");
  });

  await scenario("11. changed risk classification invalidates the binding", () => {
    const proposal = proposalInput({ baseHead: "abc123", safetyClassification: "SAFE" }) as unknown as AyasInboxProposal;
    const binding = bindAyasOwnerApproval(proposal, "2026-09-17T00:00:00.000Z");
    const riskDrifted = { ...proposal, safetyClassification: "REVIEW_REQUIRED" } as unknown as AyasInboxProposal;
    const evaluation = reevaluateAyasApprovalBinding(binding, riskDrifted);
    assert.equal(evaluation.valid, false);
    if (!evaluation.valid) assert.equal(evaluation.reason, "RISK_CLASSIFICATION_CHANGED");
  });

  await scenario("12. any other content drift not covered by a specific field check still invalidates via the generic proposalHash comparison (covers a future dependency/cost-impact field the same way)", () => {
    const proposal = { ...proposalInput({ baseHead: "abc123" }), proposalHash: "hash-a" } as unknown as AyasInboxProposal;
    const binding = bindAyasOwnerApproval(proposal, "2026-09-17T00:00:00.000Z");
    const otherDrift = { ...proposal, proposalHash: "hash-b" } as AyasInboxProposal;
    const evaluation = reevaluateAyasApprovalBinding(binding, otherDrift);
    assert.equal(evaluation.valid, false);
    if (!evaluation.valid) assert.equal(evaluation.reason, "PROPOSAL_HASH_CHANGED");
  });

  // --- 13-14: regeneration / no authority transfer ---

  await scenario("13 / 14. a regenerated proposal (new id + hash) requires a brand-new approval — the old binding cannot be reused and does not transfer", async () => {
    const f = makeFixture();
    const { proposal: oldProposal } = seedNewFileProposal(f);
    const oldBinding = bindAyasOwnerApproval(oldProposal, new Date().toISOString());
    // Simulate the old proposal going STALE and a fresh one being discovered against a new HEAD.
    f.inbox.markStale(oldProposal.proposalId, new Date().toISOString());
    const deps = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const outcomeOnOldBinding = await decideAyasOwnerApproval(oldBinding, "APPROVE", deps);
    assert.equal(outcomeOnOldBinding.executed, false);
    if (!outcomeOnOldBinding.executed) assert.equal(outcomeOnOldBinding.reason, "NOT_PENDING");
    assert.equal(git(f.repoRoot, "status", "--short"), "", "the stale binding must never reach execution");
  });

  // --- 15-16: REVIEW_REQUIRED handling ---

  await scenario("15. a REVIEW_REQUIRED proposal that also fails an evidence check is DEFERred, not automatically recommended", () => {
    const decision = evaluateAyasInternalDecision(proposalInput({ safetyClassification: "REVIEW_REQUIRED" as never, exactFiles: ["src/lib/audio/AudioMixer.ts"], evidence: [] } as never) as unknown as AyasInboxProposal);
    assert.equal(decision.decision, "DEFER");
  });

  await scenario("16. Version-1 rule: a REVIEW_REQUIRED proposal is DEFERred internally, never RECOMMEND_FOR_APPROVAL — the owner is never shown a fake approve button", () => {
    const proposal = proposalInput({ safetyClassification: "REVIEW_REQUIRED" as never, exactFiles: ["src/lib/audio/AudioMixer.ts"] }) as unknown as AyasInboxProposal;
    const decision = evaluateAyasInternalDecision(proposal);
    assert.equal(decision.decision, "DEFER");
    assert.equal(decision.executable, false);
    assert.throws(() => buildAyasOwnerApprovalRequest(proposal, decision), /non-RECOMMEND_FOR_APPROVAL/);
  });

  await scenario("16b. even if an owner somehow approves a REVIEW_REQUIRED binding, the gate refuses before execution — the existing AyasApprovalInboxStore fail-closed invariant is never weakened", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f, { safetyClassification: "REVIEW_REQUIRED" as never, mutationKind: undefined });
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const outcome = await decideAyasOwnerApproval(binding, "APPROVE", { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } });
    assert.equal(outcome.executed, false);
    if (!outcome.executed) assert.equal(outcome.reason, "NOT_EXECUTABLE_CLASSIFICATION");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "PENDING", "the store's own decide() is never even called for this");
  });

  // --- 18: restart safety (stateless-by-construction) ---

  await scenario("18. restart cannot double-execute: the gate holds no in-memory state between calls, so a second call after a simulated restart behaves identically to a duplicate delivery (see scenario 7)", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const deps = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    await decideAyasOwnerApproval(binding, "APPROVE", deps);
    // A fresh inbox handle pointed at the SAME rootDir simulates a process restart reading only durable state.
    const rebootedInbox = createAyasApprovalInboxStore({ rootDir: f.inboxRootDir });
    const afterReboot = rebootedInbox.load().proposals.find((p) => p.proposalId === proposal.proposalId);
    assert.equal(afterReboot?.status, "COMPLETED", "durable state alone must reflect completion after a restart");
    const second = await decideAyasOwnerApproval(binding, "APPROVE", deps);
    assert.equal(second.executed, false);
  });

  // --- 20: disabled by default ---

  await scenario("20. autonomous execution is disabled by default in this session's real environment", () => {
    assert.equal(isAyasAutonomousExecutionEnabled(), false, `${AYAS_AUTONOMOUS_EXECUTION_ENV_VAR} must not be set to "1" in this session`);
  });

  await scenario("20b. APPROVE with the flag left disabled (no override) never touches the real repo, but IS durably recorded as APPROVED — the durable one-click correction", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const outcome = await decideAyasOwnerApproval(binding, "APPROVE", f); // no envOverride at all
    assert.equal(outcome.executed, false);
    if (!outcome.executed) assert.equal(outcome.reason, "APPROVED_PENDING_EXECUTION");
    const stored = f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!;
    assert.equal(stored.status, "APPROVED", "the owner's APPROVE must be durably recorded even though live execution is off — this is the fix for the old client-only Set approach");
    assert.equal(git(f.repoRoot, "status", "--short"), "", "zero repo mutation while the flag is off");
    const decision = [...f.inbox.load().decisions].reverse().find((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
    assert.ok(isAyasOwnerApprovedDecisionReason(decision?.reason), "the decision record must carry the owner-approval provenance marker so the resume worker and the view layer can find it");
  });

  await scenario("20c. that durable APPROVED status survives a simulated restart (fresh inbox handle, same rootDir) — not React memory", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    await decideAyasOwnerApproval(binding, "APPROVE", f);
    const rebooted = createAyasApprovalInboxStore({ rootDir: f.inboxRootDir });
    assert.equal(rebooted.load().proposals.find((p) => p.proposalId === proposal.proposalId)?.status, "APPROVED");
  });

  await scenario("20d. a second APPROVE on the same (now stale) binding is refused, not a duplicate authorization — no second ONAYLA is possible", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    await decideAyasOwnerApproval(binding, "APPROVE", f);
    const second = await decideAyasOwnerApproval(binding, "APPROVE", f);
    assert.equal(second.executed, false);
    if (!second.executed) assert.equal(second.reason, "NOT_PENDING");
    const decisions = f.inbox.load().decisions.filter((d) => d.proposalId === proposal.proposalId && d.decision === "APPROVE");
    assert.equal(decisions.length, 1, "exactly one durable APPROVE decision — never two");
  });

  await scenario("20e. once the flag turns on, the resume worker picks up the durably-approved proposal automatically — no second owner click, no daemon involved", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    const binding = bindAyasOwnerApproval(proposal, new Date().toISOString());
    const disabledOutcome = await decideAyasOwnerApproval(binding, "APPROVE", f);
    assert.equal(disabledOutcome.executed, false);

    const stillOff = await resumeAyasOwnerApprovedProposals(f);
    assert.deepEqual(stillOff, [], "resume must no-op while the flag is still off — never a fail-open resume");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "APPROVED");
    assert.equal(git(f.repoRoot, "status", "--short"), "");

    const enabled = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const attempts = await resumeAyasOwnerApprovedProposals(enabled);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].proposalId, proposal.proposalId);
    assert.equal(attempts[0].outcome.ok, true);
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "COMPLETED");
    assert.notEqual(git(f.repoRoot, "log", "-1", "--format=%s"), "initial", "a real commit was published");

    const again = await resumeAyasOwnerApprovedProposals(enabled);
    assert.deepEqual(again, [], "a completed proposal is no longer APPROVED, so a second resume call finds nothing — no double execution");
  });

  await scenario("20f. the resume worker never touches a proposal approved through the legacy manual ONAYLA flow (no owner-approval provenance marker)", async () => {
    const f = makeFixture();
    const { proposal } = seedNewFileProposal(f);
    // Simulates the pre-existing `decideAyasApproval` path in app/brain/actions.ts, which calls
    // `inbox.decide()` directly with no reason at all — never through the owner-approval gate.
    f.inbox.decide(proposal.proposalId, "APPROVE", new Date().toISOString());
    const enabled = { ...f, envOverride: { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" } };
    const attempts = await resumeAyasOwnerApprovedProposals(enabled);
    assert.deepEqual(attempts, [], "a legacy-approved proposal must be left exactly alone — its own manual YÜRÜT control is still how a human resumes it");
    assert.equal(f.inbox.load().proposals.find((p) => p.proposalId === proposal.proposalId)!.status, "APPROVED", "untouched");
  });

  await scenario("20g. AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON itself is recognized by isAyasOwnerApprovedDecisionReason", () => {
    assert.equal(isAyasOwnerApprovedDecisionReason(AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON), true);
    assert.equal(isAyasOwnerApprovedDecisionReason(undefined), false);
    assert.equal(isAyasOwnerApprovedDecisionReason("some operator-typed note"), false);
  });

  await scenario("20h. the Server Action maps BOTH non-mutating accepted outcomes (APPROVED_PENDING_EXECUTION and OWNER_REJECTED) to ok:true — an accepted owner decision must never surface as an error", () => {
    // `app/brain/actions.ts` is a "use server" module (it imports next/headers
    // transitively via requireBrainSession) and cannot be imported under plain
    // tsx, so this asserts the mapping by source inspection — the same
    // technique `smoke-ayas-proposal-approval-service.ts` uses to prove the
    // absence of broad staging commands. What matters is that neither reason
    // can drift into the ok:false branch below it: both are decisions that were
    // accepted and durably recorded, with zero repository mutation.
    const source = fs.readFileSync(path.join(__dirname, "..", "app", "brain", "actions.ts"), "utf8");
    const okBranch = /if \(outcome\.reason === "APPROVED_PENDING_EXECUTION" \|\| outcome\.reason === "OWNER_REJECTED"\) \{\s*return \{ ok: true,/;
    assert.match(source, okBranch, "both accepted, non-mutating outcomes must return ok:true from ayasOwnerApprovalDecision");
  });

  await scenario("20i. the Server Action's catch prefers AyasProposalApprovalError's stable short code over its English prose, matching proposalOnaylaVeUygula", () => {
    // Without this, a thrown service error (NOT_SAFE / PROPOSAL_HASH_MISMATCH /
    // NOT_PATCH_ARTIFACT / …) reaches the owner-facing label lookup in
    // AyasDevelopmentCenter as a raw internal sentence, which can never match
    // `ayasOwnerDecisionErrorLabel` and so renders untranslated internals.
    const source = fs.readFileSync(path.join(__dirname, "..", "app", "brain", "actions.ts"), "utf8");
    const action = source.slice(source.indexOf("export async function ayasOwnerApprovalDecision"));
    const body = action.slice(0, action.indexOf("export interface RecordSelfHealDecisionInput"));
    assert.match(body, /error instanceof AyasProposalApprovalError \? error\.code/, "ayasOwnerApprovalDecision must unwrap the service error's code first");
  });

  console.log(`AYAS autonomous execution gate smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-autonomous-execution-gate", scenarios: count }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
