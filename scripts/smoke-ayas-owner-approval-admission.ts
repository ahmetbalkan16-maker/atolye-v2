/**
 * Owner provenance for approval decisions (owner decision 3, 2026-10-08).
 *
 * Positive, negative, replay and bypass scenarios for `AyasOwnerApprovalAdmission`
 * and its use by the approval stores, the owner-approval gate, the resume
 * worker and the owner server actions. Every store lives in a fresh TEMP
 * directory; nothing reads or writes `data/brain`, git, the network or a model.
 * The server-action guard is the real function from `app/brain/actions.ts`,
 * run in a VM that supplies only Next's cookie boundary and the env.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createAyasAutonomyDaemon } from "../src/lib/brain/autonomy/AyasAutonomyDaemon";
import { createAyasExecutionJournal } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { createAyasMicroBatchAsInboxAdapter } from "../src/lib/brain/autonomy/AyasMicroBatchExecutionService";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

import { AYAS_SESSION_COOKIE, AYAS_SESSION_TTL_SECONDS, issueSession, readVerifiedSessionClaims, resolveAccessGate, verifySession } from "../src/lib/auth/accessGate";
import { createAyasApprovalInboxStore, AyasApprovalInboxStoreError, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasMicroBatchStore, AyasMicroBatchStoreError, type AyasMicroBatch } from "../src/lib/brain/autonomy/AyasMicroBatch";
import {
  AYAS_OWNER_ADMISSION_MAX_AGE_MS,
  AyasOwnerAdmissionError,
  admitAyasOwnerApproval,
  checkAyasOwnerAdmissionBinding,
  checkAyasOwnerExecutionAdmission,
  isAyasApprovalDecisionOwnerAdmitted,
  isAyasOwnerAdmissionShape,
  isAyasReservedDecisionReason,
  verifyAyasOwnerAdmissionSeal,
  type AyasOwnerAdmission,
  type AyasOwnerAdmissionSubject,
} from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { decideAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { bindAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { resumeAyasOwnerApprovedProposals } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { approveAndExecuteAyasProposal } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";

const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "owner-admission-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const OTHER_KEY = "another-owner-admission-smoke-key";
const enforced = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = (label: string) => fs.mkdtempSync(path.join(os.tmpdir(), `ayas-owner-admission-${label}-`));

let scenarios = 0;
async function scenario(name: string, run: () => Promise<void> | void) {
  await run();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

function proposalInput(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-10-08T09:00:00.000Z", baseBranch: "wip/test", baseHead: "base-head-fixture",
    objective: "fixture objective", currentProblem: "fixture problem", selectionReason: "fixture reason",
    expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1, risk: "low",
    safetyClassification: "SAFE" as const, exactFiles: ["scripts/smoke-fixture-owner-admission.ts"], expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-owner-admission"], estimatedCost: "zero-cost" as const, mutationKind: "fixture-static-kind",
    ...overrides,
  };
}

function batchInput(): Omit<AyasMicroBatch, "schemaVersion" | "batchId" | "batchHash" | "lastUpdatedAt" | "status"> {
  return {
    batchVersion: 1, baseHead: "abc123", baseBranch: "wip/test",
    items: [{ microItemId: "ayas-micro-item-a", semanticKey: "ayas-novel-a", patchArtifactId: "ayas-patch-artifact-a", patchHash: "hash-a", exactFiles: ["scripts/smoke-a.ts"] }],
    exactFilesUnion: ["scripts/smoke-a.ts"], validatorUnion: ["scripts/smoke-a.ts"], worktreeBaseHead: "abc123",
    createdAt: "2026-10-08T09:00:00.000Z", validationSummary: ["fixture"], aggregateRisk: "low",
  };
}

const proposalSubject = (p: Pick<AyasInboxProposal, "proposalId" | "proposalHash">, decision: "APPROVE" | "REJECT" | "LATER" | "EXECUTE"): Extract<AyasOwnerAdmissionSubject, { kind: "proposal" }> =>
  ({ kind: "proposal", proposalId: p.proposalId, proposalHash: p.proposalHash, decision });

async function admit(subject: AyasOwnerAdmissionSubject, at = Date.now(), token?: string): Promise<AyasOwnerAdmission> {
  return admitAyasOwnerApproval({ gate: enforced, token: token ?? await issueSession(KEY, at), action: subject.kind === "micro-batch" ? subject.decision === "EXECUTE" ? "executeAyasApprovedMicroBatch" : "batchOnaylaVeUygula" : subject.decision === "EXECUTE" ? "executeAyasApprovedProposal" : "decideAyasApproval", subject, now: at });
}

async function rejectsWith(code: string, run: () => Promise<unknown>) {
  await assert.rejects(run, (error: unknown) => error instanceof AyasOwnerAdmissionError && error.code === code && error.message === code);
}

function refusedStore(run: () => unknown, code: string, pattern?: RegExp) {
  assert.throws(run, (error: unknown) => (error instanceof AyasApprovalInboxStoreError || error instanceof AyasMicroBatchStoreError) && error.code === code && (!pattern || pattern.test(error.message)));
}

/* ---------------------------------------------- the real server-action guard --- */
const actionsText = fs.readFileSync(path.join(__dirname, "../app/brain/actions.ts"), "utf8");
const actionsSource = ts.createSourceFile("actions.ts", actionsText, ts.ScriptTarget.Latest, true);
const fnNamed = (name: string) => actionsSource.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
const guardDecl = fnNamed("requireOwnerApprovalAdmission");
assert.ok(guardDecl, "requireOwnerApprovalAdmission must exist in app/brain/actions.ts");
const guardJs = ts.transpileModule(guardDecl.getText(actionsSource), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
let guardEnv: Record<string, string | undefined> = { AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" };
let guardCookie: string | undefined;
const realGuard = vm.runInNewContext(`${guardJs}\nrequireOwnerApprovalAdmission`, {
  process: { get env() { return guardEnv; } }, resolveAccessGate, AYAS_SESSION_COOKIE, admitAyasOwnerApproval,
  cookies: async () => ({ get: (name: string) => name === AYAS_SESSION_COOKIE && guardCookie !== undefined ? { value: guardCookie } : undefined }),
}) as (action: string, subject: AyasOwnerAdmissionSubject) => Promise<AyasOwnerAdmission>;

const APPROVAL_ACTIONS = ["decideAyasApproval", "executeAyasApprovedProposal", "batchOnaylaVeUygula", "proposalOnaylaVeUygula", "ayasOwnerApprovalDecision"] as const;
/** The worker lane each one-click publication action hands its click to (`AyasOwnerPublicationWorker`). */
const WORKER_LANES: Readonly<Partial<Record<(typeof APPROVAL_ACTIONS)[number], string>>> = { batchOnaylaVeUygula: "micro-batch", proposalOnaylaVeUygula: "proposal", ayasOwnerApprovalDecision: "owner-approve" };

async function main() {
  const subject: AyasOwnerAdmissionSubject = { kind: "proposal", proposalId: "ayas-proposal-x", proposalHash: "hash-x", decision: "APPROVE" };

  /* ------------------------------------------------------------ admission --- */
  await scenario("a verified owner session yields a complete, sealed admission", async () => {
    const at = Date.now(); const token = await issueSession(KEY, at);
    const admission = await admit(subject, at, token);
    assert.ok(isAyasOwnerAdmissionShape(admission));
    assert.equal(admission.principal, "OWNER");
    assert.deepEqual(admission.subject, subject);
    assert.equal(admission.verifiedAt, new Date(at).toISOString());
    const claims = await readVerifiedSessionClaims(token, KEY, at);
    assert.ok(claims);
    assert.equal(admission.sessionIssuedAt, new Date(claims.issuedAt * 1000).toISOString());
    assert.equal(admission.sessionExpiresAt, new Date(claims.expiresAt * 1000).toISOString());
    assert.equal(await verifyAyasOwnerAdmissionSeal(admission, KEY), true);
  });
  await scenario("the admission holds neither the cookie nor the key, and its session reference is not the cookie signature", async () => {
    const at = Date.now(); const token = await issueSession(KEY, at);
    const text = JSON.stringify(await admit(subject, at, token));
    for (const part of [token, ...token.split("."), KEY]) assert.ok(!text.includes(part), "admission must not carry a credential");
  });
  await scenario("one login keeps one session reference; another login gets another; every call gets its own action reference", async () => {
    const at = Date.now(); const first = await issueSession(KEY, at); const second = await issueSession(KEY, at);
    const a = await admit(subject, at, first); const b = await admit(subject, at, first); const c = await admit(subject, at, second);
    assert.equal(a.sessionRef, b.sessionRef);
    assert.notEqual(a.sessionRef, c.sessionRef);
    assert.notEqual(a.actionRef, b.actionRef);
  });
  await scenario("local dev with no access key yields no admission (fail closed, unlike read-only actions)", async () => {
    await rejectsWith("OWNER_ADMISSION_GATE_UNAVAILABLE", () => admitAyasOwnerApproval({ gate: resolveAccessGate({ NODE_ENV: "development" }), token: undefined, action: "decideAyasApproval", subject }));
  });
  await scenario("a misconfigured gate yields no admission", async () => {
    await rejectsWith("OWNER_ADMISSION_GATE_UNAVAILABLE", () => admitAyasOwnerApproval({ gate: resolveAccessGate({ AYAS_ACCESS_KEY: "short", NODE_ENV: "production" }), token: undefined, action: "decideAyasApproval", subject }));
  });
  await scenario("missing, malformed, foreign, expired, future and tampered sessions yield no admission", async () => {
    const at = Date.now();
    for (const token of [undefined, "owner-approved:allow", await issueSession(OTHER_KEY, at), await issueSession(KEY, at - (AYAS_SESSION_TTL_SECONDS + 10) * 1000), await issueSession(KEY, at + 120_000), `${await issueSession(KEY, at)}x`]) {
      await rejectsWith("OWNER_ADMISSION_REQUIRED", () => admitAyasOwnerApproval({ gate: enforced, token, action: "decideAyasApproval", subject, now: at }));
    }
  });
  await scenario("an empty or unknown subject or action yields no admission", async () => {
    const token = await issueSession(KEY);
    for (const bad of [{ ...subject, proposalId: "" }, { ...subject, proposalHash: " " }, { ...subject, decision: "DONE" }, { kind: "other" }] as AyasOwnerAdmissionSubject[]) {
      await rejectsWith("OWNER_ADMISSION_INVALID_SUBJECT", () => admitAyasOwnerApproval({ gate: enforced, token, action: "decideAyasApproval", subject: bad }));
    }
    await rejectsWith("OWNER_ADMISSION_INVALID_SUBJECT", () => admitAyasOwnerApproval({ gate: enforced, token, action: "approveEverything" as never, subject }));
  });
  await scenario("the seal fails under another key and after any field is edited", async () => {
    const admission = await admit(subject);
    assert.equal(await verifyAyasOwnerAdmissionSeal(admission, OTHER_KEY), false);
    const edits: Partial<AyasOwnerAdmission>[] = [
      { subject: { ...subject, proposalId: "ayas-proposal-y" } }, { subject: { ...subject, decision: "REJECT" } },
      { verifiedAt: new Date(Date.parse(admission.verifiedAt) + 1000).toISOString() }, { sessionRef: "0".repeat(64) },
      { actionRef: "ayas-owner-action-00000000-0000-4000-8000-000000000000" }, { action: "proposalOnaylaVeUygula" },
    ];
    for (const edit of edits) assert.equal(await verifyAyasOwnerAdmissionSeal({ ...admission, ...edit } as AyasOwnerAdmission, KEY), false);
  });
  await scenario("a client-shaped admission with extra or missing fields is malformed", async () => {
    const admission = await admit(subject);
    const { seal: _seal, ...withoutSeal } = admission; void _seal;
    for (const value of [{ ...admission, principal: "ahmet" }, { ...admission, extra: true }, withoutSeal, { ...admission, authMethod: "CLIENT_CLAIM" }, null, "owner"]) {
      assert.equal(isAyasOwnerAdmissionShape(value), false);
      assert.deepEqual(checkAyasOwnerAdmissionBinding(value, { subject, at: admission.verifiedAt, usedActionRefs: new Set() }), { ok: false, reason: "MALFORMED" });
    }
  });

  /* ------------------------------------------------------------ inbox store --- */
  await scenario("an owner-action store refuses APPROVE, REJECT and LATER without an admission and writes nothing", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("strict"), requireOwnerAdmission: true });
    const p = store.createProposal(proposalInput());
    const before = fs.readFileSync(store.stateFile, "utf8");
    for (const decision of ["APPROVE", "REJECT", "LATER"] as const) refusedStore(() => store.decide(p.proposalId, decision, new Date().toISOString()), "AYAS_INBOX_UNSAFE_APPROVAL", /owner admission is required/);
    assert.equal(fs.readFileSync(store.stateFile, "utf8"), before);
  });
  await scenario("an admitted APPROVE is recorded with the exact admission, and its seal still verifies from disk", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("approve"), requireOwnerAdmission: true });
    const p = store.createProposal(proposalInput());
    const at = Date.now(); const admission = await admit(proposalSubject(p, "APPROVE"), at);
    const { decision } = store.decide(p.proposalId, "APPROVE", new Date(at + 1000).toISOString(), undefined, admission);
    assert.deepEqual(decision.ownerAdmission, admission);
    const persisted = store.load().decisions.at(-1)!;
    assert.deepEqual(persisted.ownerAdmission, admission);
    assert.equal(await verifyAyasOwnerAdmissionSeal(persisted.ownerAdmission!, KEY), true);
    assert.equal(isAyasApprovalDecisionOwnerAdmitted(persisted, p), true);
  });
  await scenario("an admission for another proposal, decision or hash is refused", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("mismatch"), requireOwnerAdmission: true });
    const p = store.createProposal(proposalInput());
    const q = store.createProposal(proposalInput({ objective: "second fixture" }));
    const at = Date.now();
    for (const wrong of [proposalSubject(q, "APPROVE"), proposalSubject(p, "REJECT"), proposalSubject(p, "EXECUTE"), { ...proposalSubject(p, "APPROVE"), proposalHash: "stale-hash" }] as AyasOwnerAdmissionSubject[]) {
      const admission = await admit(wrong, at);
      refusedStore(() => store.decide(p.proposalId, "APPROVE", new Date(at).toISOString(), undefined, admission), "AYAS_INBOX_INVALID", /SUBJECT_MISMATCH/);
    }
    assert.equal(store.load().decisions.length, 0);
  });
  await scenario("replay: one admission is accepted once, even for a decision the status still allows", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("replay"), requireOwnerAdmission: true });
    const p = store.createProposal(proposalInput());
    const at = Date.now(); const admission = await admit(proposalSubject(p, "LATER"), at);
    store.decide(p.proposalId, "LATER", new Date(at).toISOString(), undefined, admission);
    refusedStore(() => store.decide(p.proposalId, "LATER", new Date(at + 1000).toISOString(), undefined, admission), "AYAS_INBOX_INVALID", /ACTION_REF_REUSED/);
    assert.equal(store.load().decisions.length, 1);
  });
  await scenario("an admission older than the window, or from the future, is refused", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("fresh"), requireOwnerAdmission: true });
    const p = store.createProposal(proposalInput());
    const at = Date.now();
    const old = await admit(proposalSubject(p, "APPROVE"), at - AYAS_OWNER_ADMISSION_MAX_AGE_MS - 1000);
    refusedStore(() => store.decide(p.proposalId, "APPROVE", new Date(at).toISOString(), undefined, old), "AYAS_INBOX_INVALID", /STALE/);
    const future = await admit(proposalSubject(p, "APPROVE"), at + 120_000);
    refusedStore(() => store.decide(p.proposalId, "APPROVE", new Date(at).toISOString(), undefined, future), "AYAS_INBOX_INVALID", /FUTURE/);
  });
  await scenario("an explicitly isolated legacy fixture stays unattributed", async () => {
    const store = createAyasApprovalInboxStore({ rootDir: temp("legacy") });
    const p = store.createProposal(proposalInput());
    const { decision } = store.decide(p.proposalId, "APPROVE", new Date().toISOString());
    assert.equal("ownerAdmission" in decision, false);
    assert.equal(isAyasApprovalDecisionOwnerAdmitted(decision, p), false);
  });
  await scenario("earlier unattributed decisions stay byte-identical; nothing is added to them later", async () => {
    const root = temp("history");
    const legacy = createAyasApprovalInboxStore({ rootDir: root });
    const old = legacy.createProposal(proposalInput({ objective: "historical" }));
    legacy.decide(old.proposalId, "REJECT", "2026-09-24T10:00:00.000Z");
    const historical = JSON.stringify(legacy.load().decisions[0]);
    const strict = createAyasApprovalInboxStore({ rootDir: root, requireOwnerAdmission: true });
    const fresh = strict.createProposal(proposalInput({ objective: "new" }));
    const at = Date.now();
    strict.decide(fresh.proposalId, "APPROVE", new Date(at).toISOString(), undefined, await admit(proposalSubject(fresh, "APPROVE"), at));
    const decisions = strict.load().decisions;
    assert.equal(JSON.stringify(decisions[0]), historical);
    assert.equal("ownerAdmission" in decisions[0]!, false);
  });

  /* ------------------------------------------------------- micro-batch store --- */
  await scenario("micro-batch: strict store refuses without admission; admitted APPROVE is recorded; mismatch and replay are refused", async () => {
    const store = createAyasMicroBatchStore({ rootDir: temp("batch"), requireOwnerAdmission: true });
    const batch = store.createOrVersion(batchInput());
    store.markReadyForReview(batch.batchId, "2026-10-08T09:01:00.000Z");
    refusedStore(() => store.decide(batch.batchId, "APPROVE", batch.batchHash, new Date().toISOString()), "AYAS_MICRO_BATCH_UNSAFE_APPROVAL", /owner admission is required/);
    const at = Date.now();
    const wrong = await admit({ kind: "micro-batch", batchId: batch.batchId, batchHash: "other-hash", decision: "APPROVE" }, at);
    refusedStore(() => store.decide(batch.batchId, "APPROVE", batch.batchHash, new Date(at).toISOString(), wrong), "AYAS_MICRO_BATCH_INVALID", /SUBJECT_MISMATCH/);
    const proposalShaped = await admit({ kind: "proposal", proposalId: batch.batchId, proposalHash: batch.batchHash, decision: "APPROVE" }, at);
    refusedStore(() => store.decide(batch.batchId, "APPROVE", batch.batchHash, new Date(at).toISOString(), proposalShaped), "AYAS_MICRO_BATCH_INVALID", /SUBJECT_MISMATCH/);
    const reject = await admit({ kind: "micro-batch", batchId: batch.batchId, batchHash: batch.batchHash, decision: "REJECT" }, at);
    store.decide(batch.batchId, "REJECT", batch.batchHash, new Date(at).toISOString(), reject);
    store.markReadyForReview(batch.batchId, new Date(at).toISOString());
    refusedStore(() => store.decide(batch.batchId, "REJECT", batch.batchHash, new Date(at + 1000).toISOString(), reject), "AYAS_MICRO_BATCH_INVALID", /ACTION_REF_REUSED/);
    const approve = await admit({ kind: "micro-batch", batchId: batch.batchId, batchHash: batch.batchHash, decision: "APPROVE" }, at);
    const { decision } = store.decide(batch.batchId, "APPROVE", batch.batchHash, new Date(at).toISOString(), approve);
    assert.deepEqual(decision.ownerAdmission, approve);
  });

  /* ------------------------------------------------- gate, publish and resume --- */
  await scenario("owner-approval gate on an owner-action store: no admission, no decision; admitted REJECT and APPROVE are attributed", async () => {
    const repoRoot = temp("gate-repo"); const gateRoot = temp("gate-root");
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("gate-inbox"), requireOwnerAdmission: true });
    const p = inbox.createProposal(proposalInput());
    const deps = { repoRoot, gateRoot, inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "0" } };
    await assert.rejects(() => decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date().toISOString()), "REJECT", deps), (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL");
    await assert.rejects(() => decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date().toISOString()), "APPROVE", deps), (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL");
    assert.equal(inbox.load().decisions.length, 0);
    const at = Date.now();
    const approved = await decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date(at).toISOString()), "APPROVE", { ...deps, ownerAdmission: await admit(proposalSubject(p, "APPROVE"), at) });
    assert.equal(approved.executed, false);
    assert.equal(approved.executed === false && approved.reason, "APPROVED_PENDING_EXECUTION");
    const decision = inbox.load().decisions.at(-1)!;
    assert.equal(isAyasApprovalDecisionOwnerAdmitted(decision, p), true);
    const q = inbox.createProposal(proposalInput({ objective: "reject me" }));
    await decideAyasOwnerApproval(bindAyasOwnerApproval(q, new Date(at).toISOString()), "REJECT", { ...deps, ownerAdmission: await admit(proposalSubject(q, "REJECT"), at) });
    assert.equal(inbox.load().decisions.at(-1)!.ownerAdmission?.subject.decision, "REJECT");
  });
  await scenario("one-click publish on an owner-action store refuses before minting any decision when the admission is missing", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("publish-inbox"), requireOwnerAdmission: true });
    const p = inbox.createProposal(proposalInput({ mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND, patchArtifactId: "ayas-patch-artifact-fixture", patchHash: "fixture-patch-hash" }));
    await assert.rejects(() => approveAndExecuteAyasProposal(p.proposalId, p.proposalHash, { repoRoot: temp("publish-repo"), gateRoot: temp("publish-gate"), inbox, traceEnabled: false }),
      (error: unknown) => error instanceof AyasApprovalInboxStoreError && error.code === "AYAS_INBOX_UNSAFE_APPROVAL" && /owner admission is required/.test(error.message));
    assert.equal(inbox.load().decisions.length, 0);
    assert.equal(inbox.load().proposals[0]!.status, "PENDING");
  });
  await scenario("resume never publishes an unattributed APPROVE, even one carrying the owner-approved reason", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("resume-legacy") });
    const p = inbox.createProposal(proposalInput());
    inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), "owner-approved: pending execution enablement");
    const attempts = await resumeAyasOwnerApprovedProposals({ repoRoot: temp("resume-repo"), gateRoot: temp("resume-gate"), inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" } });
    assert.deepEqual(attempts, []);
    assert.equal(inbox.load().proposals[0]!.status, "APPROVED");
  });
  await scenario("durable consent cannot automatically resume; a fresh exact manual action is required", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("resume-admitted") });
    const p = inbox.createProposal(proposalInput());
    const at = Date.now();
    inbox.decide(p.proposalId, "APPROVE", new Date(at).toISOString(), "owner-approved: pending execution enablement", await admit(proposalSubject(p, "APPROVE"), at));
    const attempts = await resumeAyasOwnerApprovedProposals({ repoRoot: temp("resume-repo2"), gateRoot: temp("resume-gate2"), inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" } });
    assert.deepEqual(attempts, []);
    assert.deepEqual(await resumeAyasOwnerApprovedProposals({ repoRoot: temp("no-click-repo"), gateRoot: temp("no-click-gate"), inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" }, executionOwnerAdmission: await admit(proposalSubject(p, "EXECUTE")) }), []);
    const manualAttempts = await resumeAyasOwnerApprovedProposals({ repoRoot: temp("manual-resume-repo"), gateRoot: temp("manual-resume-gate"), inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" }, explicitManualOwnerAction: true, executionOwnerAdmission: await admit(proposalSubject(p, "EXECUTE")) });
    assert.equal(manualAttempts.length, 1);
    assert.equal(manualAttempts[0]!.outcome.ok, false); // fixture kind is not a patch artifact: the existing guard refuses it
    assert.equal(!manualAttempts[0]!.outcome.ok && manualAttempts[0]!.outcome.code, "NOT_PATCH_ARTIFACT");
  });
  await scenario("a typed reason cannot pose as a server provenance marker", () => {
    for (const reason of ["owner-approved: x", "  Owner-Approved: x", "ｏｗｎｅｒ-approved: x", "owner-rejected: y", "AYAS-INTERNAL: z"]) assert.equal(isAyasReservedDecisionReason(reason), true, reason);
    for (const reason of [undefined, "", "owner approved this", "onaylandı", "approved: owner"]) assert.equal(isAyasReservedDecisionReason(reason), false, String(reason));
  });

  /* ------------------------------------------------------- real action guard --- */
  await scenario("real action guard: verified cookie → admission; no cookie, foreign cookie, dev mode or misconfigured gate → refused", async () => {
    guardEnv = { AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" }; guardCookie = await issueSession(KEY);
    const admission = await realGuard("proposalOnaylaVeUygula", subject);
    assert.equal(admission.action, "proposalOnaylaVeUygula");
    assert.equal(await verifyAyasOwnerAdmissionSeal(admission, KEY), true);
    guardCookie = undefined; await rejectsWith("OWNER_ADMISSION_REQUIRED", () => realGuard("proposalOnaylaVeUygula", subject));
    guardCookie = await issueSession(OTHER_KEY); await rejectsWith("OWNER_ADMISSION_REQUIRED", () => realGuard("proposalOnaylaVeUygula", subject));
    guardEnv = { NODE_ENV: "development" }; guardCookie = undefined; await rejectsWith("OWNER_ADMISSION_GATE_UNAVAILABLE", () => realGuard("proposalOnaylaVeUygula", subject));
    guardEnv = { NODE_ENV: "production" }; await rejectsWith("OWNER_ADMISSION_GATE_UNAVAILABLE", () => realGuard("proposalOnaylaVeUygula", subject));
  });
  await scenario("every approval-capable action keeps the session guard first, then derives its own admission and decides only through an owner-action store", () => {
    for (const name of APPROVAL_ACTIONS) {
      const fn = fnNamed(name);
      assert.ok(fn?.body, `missing owner action ${name}`);
      const first = fn.body.statements[0]!;
      assert.ok(ts.isExpressionStatement(first) && ts.isAwaitExpression(first.expression) && ts.isCallExpression(first.expression.expression) && first.expression.expression.expression.getText(actionsSource) === "requireBrainSession", `${name}: requireBrainSession must stay first`);
      const body = fn.body.getText(actionsSource);
      assert.ok(body.includes(`requireOwnerApprovalAdmission("${name}"`), `${name} must derive its own admission`);
      const params = fn.parameters.map((p) => p.getText(actionsSource)).join(",");
      assert.ok(!/\b(?:ownerAdmission|admission|principal|actor|identity|sessionRef|decidedBy|approvedBy)\b/i.test(params), `${name} must not accept an identity from the client`);
      // A one-click publication runs its service in the owner publication worker; that lane's store is checked there, below.
      const lane = WORKER_LANES[name];
      if (lane) assert.ok(new RegExp(`runAyasOwnerPublicationInWorker\\(\\{ lane: "${lane}", [^}]*\\bownerAdmission, executionOwnerAdmission \\}\\)`).test(body), `${name} must hand both of its admissions to the worker`);
      if (name !== "executeAyasApprovedProposal" && name !== "batchOnaylaVeUygula" && name !== "proposalOnaylaVeUygula") assert.ok(/create(?:AyasApprovalInbox|AyasMicroBatch)Store\(\{ requireOwnerAdmission: true \}\)/.test(body), `${name} must decide through an owner-action store`);
    }
    // The worker builds, per lane, the same strict owner-action store the actions used to build in-process.
    const workerSource = fs.readFileSync(path.join(__dirname, "../src/lib/brain/autonomy/AyasOwnerPublicationWorker.ts"), "utf8");
    const perform = workerSource.slice(workerSource.indexOf("export async function performAyasOwnerPublication"), workerSource.indexOf("export function ayasOwnerPublicationErrorReply"));
    for (const [lane, store] of [["proposal", "createAyasApprovalInboxStore"], ["micro-batch", "createAyasMicroBatchStore"], ["owner-approve", "createAyasApprovalInboxStore"]] as const) {
      const branch = perform.slice(perform.indexOf(`case "${lane}":`));
      const text = branch.slice(0, branch.indexOf("case ", 1) > 0 ? branch.indexOf("case ", 1) : undefined);
      assert.ok(text.includes(`${store}({ requireOwnerAdmission: true })`), `worker lane ${lane} must decide through an owner-action store`);
      assert.ok(text.includes("ownerAdmission: request.ownerAdmission,") && text.includes("executionOwnerAdmission: request.executionOwnerAdmission,"), `worker lane ${lane} must hand both admissions to the service`);
    }
    const before = (text: string, guard: string, effect: string) => text.indexOf(guard) >= 0 && text.indexOf(effect) >= 0 && text.indexOf(guard) < text.indexOf(effect);
    const legacy = fnNamed("decideAyasApproval")!.body!.getText(actionsSource);
    assert.ok(before(legacy, "isAyasReservedDecisionReason(input.reason)", "store.decide("), "the reserved-reason check must run before the decision");
    assert.ok(legacy.includes("store.decide(input.proposalId, input.decision, new Date().toISOString(), input.reason, admission);"), "the legacy decision must record its admission");
    const execute = fnNamed("executeAyasApprovedProposal")!.body!.getText(actionsSource);
    assert.ok(before(execute, "if (!isAyasApprovalDecisionOwnerAdmitted(approval, proposal))", "executeAyasApprovedProposalWith("), "execution must check the attributed approval first");
    for (const name of ["batchOnaylaVeUygula", "proposalOnaylaVeUygula", "ayasOwnerApprovalDecision"]) {
      const text = fnNamed(name)!.body!.getText(actionsSource);
      assert.ok(/\n\s+ownerAdmission,\n/.test(text) || /runAyasOwnerPublicationInWorker\(\{[^}]*\bownerAdmission, executionOwnerAdmission \}\)/.test(text), `${name} must hand its admission to the service`);
    }
  });

  await scenario("every service decision an owner action reaches passes the admission on to the store", () => {
    const read = (file: string) => fs.readFileSync(path.join(__dirname, "../src/lib/brain/autonomy", file), "utf8");
    const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
    assert.equal(count(read("AyasProposalApprovalService.ts"), /deps\.inbox\.decide\(proposalId, "APPROVE", [^;\n]*, deps\.ownerAdmission\);/g), 1);
    assert.equal(count(read("AyasMicroBatchApprovalService.ts"), /batchStore\.decide\(batchId, "APPROVE", approvedBatchHash, now\(\), deps\.ownerAdmission\);/g), 1);
    const gate = read("AyasAutonomousExecutionGate.ts");
    assert.equal(count(gate, /deps\.inbox\.decide\(/g), 3);
    assert.equal(count(gate, /deps\.inbox\.decide\([^;\n]*, deps\.ownerAdmission\);/g), 3);
  });


  await scenario("old signed cookies remain valid for general access but require login for privileged admission", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ v: 1, iat, exp: iat + 3600 })).toString("base64url");
    const token = body + "." + crypto.createHmac("sha256", KEY).update(body).digest("base64url");
    assert.equal(await verifySession(token, KEY), true);
    await rejectsWith("OWNER_ADMISSION_REQUIRED", () => admit(subject, Date.now(), token));
  });
  await scenario("forged admission cannot mutate an inbox even when its shape and subject match", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("forged"), requireOwnerAdmission: true });
    const p = inbox.createProposal(proposalInput()); const a = await admit(proposalSubject(p, "APPROVE"));
    const before = fs.readFileSync(inbox.stateFile);
    for (const seal of ["0".repeat(64), "broken", "", a.seal.slice(1)]) {
      refusedStore(() => inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), undefined, { ...a, seal }), "AYAS_INBOX_INVALID");
      assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
    }
    const foreign = await admitAyasOwnerApproval({ gate: resolveAccessGate({ AYAS_ACCESS_KEY: OTHER_KEY }), token: await issueSession(OTHER_KEY), action: "decideAyasApproval", subject: proposalSubject(p, "APPROVE") });
    refusedStore(() => inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), undefined, foreign), "AYAS_INBOX_INVALID", /INVALID_SEAL/);
    assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
  });
  await scenario("session expiry is checked at decision time with zero persistent effects", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("decision-expiry"), requireOwnerAdmission: true }); const p = inbox.createProposal(proposalInput());
    const at = Date.now(); const token = await issueSession(KEY, at - (AYAS_SESSION_TTL_SECONDS - 1) * 1000);
    const admission = await admit(proposalSubject(p, "APPROVE"), at, token); const before = fs.readFileSync(inbox.stateFile);
    refusedStore(() => inbox.decide(p.proposalId, "APPROVE", new Date(at + 2000).toISOString(), undefined, admission), "AYAS_INBOX_INVALID", /STALE/);
    assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
  });
  await scenario("different verified sessions preserve approval/execution provenance and exact authorization/reservation links", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("cross-session"), requireOwnerAdmission: true }); const p = inbox.createProposal(proposalInput());
    // Historical consent survives original session expiry, but it supplies no current authority.
    const old = Date.now() - (AYAS_SESSION_TTL_SECONDS + 100) * 1000;
    const approval = await admit(proposalSubject(p, "APPROVE"), old);
    const record = inbox.decide(p.proposalId, "APPROVE", new Date(old).toISOString(), undefined, approval).decision;
    assert.equal(isAyasApprovalDecisionOwnerAdmitted(record, p), true);
    const execution = await admit(proposalSubject(p, "EXECUTE"));
    assert.notEqual(execution.sessionRef, approval.sessionRef);
    const before = fs.readFileSync(inbox.stateFile);
    for (const bad of [undefined, approval, { ...execution, seal: "0".repeat(64) }, await admit({ ...proposalSubject(p, "EXECUTE"), proposalHash: "changed" })]) {
      refusedStore(() => inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, new Date().toISOString(), bad), "AYAS_INBOX_UNSAFE_APPROVAL");
      assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
    }
    const reservation = inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, new Date().toISOString(), execution);
    const persisted = inbox.load().decisions.at(-1)!;
    assert.deepEqual(persisted.ownerAdmission, approval); assert.deepEqual(persisted.executionOwnerAdmission, execution);
    assert.equal(persisted.decisionId, reservation.decisionId); assert.equal(persisted.authorizationId, reservation.authorizationId); assert.equal(persisted.reservationId, reservation.reservationId);
    const reserved = fs.readFileSync(inbox.stateFile);
    refusedStore(() => inbox.reserveApproval(p.proposalId, p.proposalHash, p.baseHead, p.exactFiles, new Date().toISOString(), execution), "AYAS_INBOX_INVALID");
    assert.deepEqual(fs.readFileSync(inbox.stateFile), reserved);
    const d = { ...record, authorizationId: "forged-authorization" };
    assert.equal(checkAyasOwnerExecutionAdmission(d, execution, proposalSubject(p, "EXECUTE"), new Date().toISOString(), new Set()), false);
    assert.equal(checkAyasOwnerExecutionAdmission({ ...record, decisionId: "forged-decision" }, execution, proposalSubject(p, "EXECUTE"), new Date().toISOString(), new Set()), false);
  });
  await scenario("missing verification key refuses before decision and default production stores remain strict", async () => {
    assert.equal(createAyasApprovalInboxStore().requiresOwnerAdmission, true);
    assert.equal(createAyasApprovalInboxStore({ requireOwnerAdmission: false }).requiresOwnerAdmission, true);
    assert.equal(createAyasMicroBatchStore().requiresOwnerAdmission, true);
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("missing-key"), requireOwnerAdmission: true }); const p = inbox.createProposal(proposalInput()); const a = await admit(proposalSubject(p, "APPROVE")); const before = fs.readFileSync(inbox.stateFile);
    delete process.env.AYAS_ACCESS_KEY;
    try { refusedStore(() => inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), undefined, a), "AYAS_INBOX_INVALID", /INVALID_SEAL/); } finally { process.env.AYAS_ACCESS_KEY = KEY; }
    assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
  });


  await scenario("fresh manual resume refuses historical APPROVE action replay and expired/cross-subject EXECUTE", async () => {
    const inbox = createAyasApprovalInboxStore({ rootDir: temp("resume-negatives"), requireOwnerAdmission: true }); const p = inbox.createProposal(proposalInput());
    const ownerAdmission = await admitAyasOwnerApproval({ gate: enforced, token: await issueSession(KEY), action: "ayasOwnerApprovalDecision", subject: proposalSubject(p, "APPROVE") });
    inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), "owner-approved: pending execution enablement", ownerAdmission);
    const deps = { repoRoot: temp("resume-neg-repo"), gateRoot: temp("resume-neg-gate"), inbox, traceEnabled: false, envOverride: { AYAS_AUTONOMOUS_EXECUTION_ENABLED: "1" }, explicitManualOwnerAction: true };
    const expiredAt = Date.now() - (AYAS_OWNER_ADMISSION_MAX_AGE_MS + 1000);
    for (const executionOwnerAdmission of [ownerAdmission, { ...await admit(proposalSubject(p, "EXECUTE")), seal: "0".repeat(64) }, await admit({ ...proposalSubject(p, "EXECUTE"), proposalHash: "other" }), await admit(proposalSubject(p, "EXECUTE"), expiredAt)]) {
      const before = fs.readFileSync(inbox.stateFile); assert.deepEqual(await resumeAyasOwnerApprovedProposals({ ...deps, executionOwnerAdmission }), []); assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
    }
  });
  await scenario("strict daemon authenticates before journal/reservation and records both verified sessions on real isolated execution", async () => {
    const repoRoot = temp("daemon-repo"); const gateRoot = temp("daemon-gate"); const inbox = createAyasApprovalInboxStore({ rootDir: temp("daemon-inbox"), requireOwnerAdmission: true });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-q"); git("config", "user.name", "Isolated K3 fixture"); git("config", "user.email", "fixture@example.invalid"); fs.mkdirSync(path.join(repoRoot, "scripts")); const file = "scripts/smoke-fixture-owner-admission.ts"; fs.writeFileSync(path.join(repoRoot, file), "before\n"); git("add", "."); git("commit", "-qm", "isolated base");
    const p = inbox.createProposal(proposalInput({ baseHead: git("rev-parse", "HEAD") }));
    const approval = await admit(proposalSubject(p, "APPROVE")); inbox.decide(p.proposalId, "APPROVE", new Date().toISOString(), undefined, approval);
    let calls = 0; const execution = await admit(proposalSubject(p, "EXECUTE"));
    const daemon = createAyasAutonomyDaemon({ inbox, repoRoot, gateRoot });
    const input = { proposalId: p.proposalId, proposalHash: p.proposalHash, baseHead: p.baseHead, currentHead: p.baseHead, exactFiles: p.exactFiles, currentExactFiles: p.exactFiles, repoClean: true, applyWhileExecuting: async () => { calls++; fs.writeFileSync(path.join(repoRoot, file), "after\n"); return { changedFiles: p.exactFiles, diffFingerprint: "", testsRun: ["synthetic callback"], testResults: ["PASS"] }; } };
    for (const executionOwnerAdmission of [undefined, approval, { ...execution, seal: "0".repeat(64) }]) {
      const before = fs.readFileSync(inbox.stateFile); await assert.rejects(() => daemon.executeApproved({ ...input, executionOwnerAdmission }), /OWNER_ADMISSION_REQUIRED/); assert.deepEqual(fs.readFileSync(inbox.stateFile), before); assert.equal(createAyasExecutionJournal({ rootDir: gateRoot }).list().length, 0); assert.equal(calls, 0);
    }
    const result = await daemon.executeApproved({ ...input, executionOwnerAdmission: execution }); assert.equal(result.status, "COMPLETED"); assert.equal(calls, 1);
    const journal = createAyasExecutionJournal({ rootDir: gateRoot }).list()[0]!; const d = inbox.load().decisions.at(-1)!;
    assert.deepEqual(journal.executionOwnerAdmission, execution); assert.deepEqual(journal.approvalOwnerAdmission, approval); assert.equal(journal.ownerApprovalDecisionId, d.decisionId); assert.equal(journal.authorizationId, d.authorizationId); assert.equal(journal.reservationId, d.reservationId);
    await assert.rejects(() => daemon.executeApproved({ ...input, executionOwnerAdmission: execution })); assert.equal(calls, 1);
  });
  await scenario("strict daemon rechecks session expiry and durable provenance after asynchronous gate phases before mutation", async () => {
    for (const mode of ["expiry", "tamper"] as const) {
      const inbox = createAyasApprovalInboxStore({ rootDir: temp("async-" + mode), requireOwnerAdmission: true }); const p = inbox.createProposal(proposalInput()); const gateRoot = temp("async-gate"); const repoRoot = temp("async-repo");
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
      git("init", "-q"); git("config", "user.name", "Isolated K3"); git("config", "user.email", "fixture@example.invalid"); fs.mkdirSync(path.join(repoRoot, "scripts")); fs.writeFileSync(path.join(repoRoot, p.exactFiles[0]!), "before\n"); git("add", "."); git("commit", "-qm", "base");
      // Recreate exact subject using the fixture's actual HEAD.
      const q = inbox.createProposal(proposalInput({ objective: "async exact fixture", baseHead: git("rev-parse", "HEAD") })); let at = Date.now();
      const approve = await admit(proposalSubject(q, "APPROVE"), at); inbox.decide(q.proposalId, "APPROVE", new Date(at).toISOString(), undefined, approve);
      const token = await issueSession(KEY, at - (AYAS_SESSION_TTL_SECONDS - 1) * 1000); const execute = await admit(proposalSubject(q, "EXECUTE"), at, token); let calls = 0;
      const daemon = createAyasAutonomyDaemon({ inbox, repoRoot, gateRoot, now: () => new Date(at).toISOString(), onJournalPhase: phase => { if (phase !== "EXECUTING") return; if (mode === "expiry") at += 2000; else { const state = inbox.load(); inbox.save({ ...state, decisions: state.decisions.map(d => ({ ...d, authorizationId: "forged-after-reservation" })) }); } } });
      await assert.rejects(() => daemon.executeApproved({ proposalId: q.proposalId, proposalHash: q.proposalHash, baseHead: q.baseHead, currentHead: q.baseHead, exactFiles: q.exactFiles, currentExactFiles: q.exactFiles, repoClean: true, executionOwnerAdmission: execute, applyWhileExecuting: async () => { calls++; return { changedFiles: [], diffFingerprint: "", testsRun: [], testResults: [] }; } }));
      assert.equal(calls, 0); assert.equal(fs.readFileSync(path.join(repoRoot, q.exactFiles[0]!), "utf8"), "before\n");
    }
  });
  await scenario("strict micro-batch adapter preserves separate approval/execute provenance and refuses approval replay", async () => {
    const store = createAyasMicroBatchStore({ rootDir: temp("batch-reservation"), requireOwnerAdmission: true }); const b = store.createOrVersion(batchInput()); store.markReadyForReview(b.batchId, new Date().toISOString());
    const approve = await admit({ kind: "micro-batch", batchId: b.batchId, batchHash: b.batchHash, decision: "APPROVE" }); store.decide(b.batchId, "APPROVE", b.batchHash, new Date().toISOString(), approve);
    const execute = await admit({ kind: "micro-batch", batchId: b.batchId, batchHash: b.batchHash, decision: "EXECUTE" }); const adapter = createAyasMicroBatchAsInboxAdapter(store, b.batchId); const before = fs.readFileSync(store.stateFile);
    refusedStore(() => adapter.reserveApproval(b.batchId, b.batchHash, b.baseHead, b.exactFilesUnion, new Date().toISOString(), approve), "AYAS_MICRO_BATCH_UNSAFE_APPROVAL"); assert.deepEqual(fs.readFileSync(store.stateFile), before);
    const reservation = adapter.reserveApproval(b.batchId, b.batchHash, b.baseHead, b.exactFilesUnion, new Date().toISOString(), execute); const d = adapter.load().decisions[0]!; assert.deepEqual(d.ownerAdmission, approve); assert.deepEqual(d.executionOwnerAdmission, execute); assert.equal(d.reservationId, reservation.reservationId); assert.equal(d.authorizationId, reservation.authorizationId);
  });

  await scenario("production defaults preserve unattributed internal REJECT/LATER while APPROVE stays fail-closed", () => {
    const previous = process.cwd(); const fixture = temp("production-default"); process.chdir(fixture);
    try { const inbox = createAyasApprovalInboxStore();
      for (const decision of ["REJECT", "LATER"] as const) { const p = inbox.createProposal(proposalInput({ objective: "internal " + decision })); const d = inbox.decide(p.proposalId, decision, new Date().toISOString()).decision; assert.equal(d.ownerAdmission, undefined); }
      const p = inbox.createProposal(proposalInput({ objective: "blocked owner APPROVE" })); const before = fs.readFileSync(inbox.stateFile); refusedStore(() => inbox.decide(p.proposalId, "APPROVE", new Date().toISOString()), "AYAS_INBOX_UNSAFE_APPROVAL"); assert.deepEqual(fs.readFileSync(inbox.stateFile), before);
    } finally { process.chdir(previous); }
  });
  console.log(`AYAS owner approval admission smoke: PASS (${scenarios} scenarios)`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey; });
