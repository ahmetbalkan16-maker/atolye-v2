import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate, verifySession, AYAS_SESSION_TTL_SECONDS } from "../src/lib/auth/accessGate";
import { admitAyasOwnerApproval, checkAyasOwnerExecutionAdmission, AYAS_OWNER_ADMISSION_MAX_AGE_MS, AyasOwnerAdmissionError, type AyasOwnerAdmission, type AyasOwnerAdmissionAction } from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { resumeAyasOwnerApprovedProposals, type AyasOwnerApprovalResumeAttempt, type AyasOwnerApprovalResumeDeps } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { publishAlreadyOwnerApprovedAyasProposal, AyasProposalApprovalError } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { decideAyasOwnerApproval, AYAS_AUTONOMOUS_EXECUTION_ENV_VAR } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { bindAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON } from "../src/lib/brain/autonomy/AyasOwnerApprovalProvenance";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasExecutionJournal, type AyasExecutionJournalPhase } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { isolatedStabilityGuardDeps } from "./ayas-isolated-stability-guard";

/**
 * Resume regression V2 — a separately versioned successor to
 * `smoke-ayas-owner-approval-resume.ts`, which stays byte-identical with its
 * preserved raw FAIL. That suite expected an unattended worker to publish a
 * durably approved proposal; the owner's K3 policy (2026-10-08) forbids it.
 * Only lowering its expectation from 1 to 0 would stop its stale-HEAD and
 * multi-proposal checks from ever running, so V2 re-proves them under a
 * currently valid manual authorization: a sealed historical APPROVE plus a
 * fresh, separately verified EXECUTE for exactly one subject and an explicit
 * server-side owner action.
 *
 * Case IDs R01–R10 follow the V2 contract in
 * docs/ayas-execution/2026-09-27-master/05_STAGE17/implementation/v1-push-morning-20261008/V2_INDEPENDENT_REVIEW_PACKET.md.
 *
 * Isolation: every repository is a throwaway Git repo with a local bare
 * remote under one run root in the OS temp directory; the access key is a
 * synthetic in-process value; the stability guard gets isolated stores and a
 * fake listener table. Nothing reads or writes `data/brain`, the live
 * runtime, the network or a model. The run root is removed at the end,
 * `node_modules` junctions first.
 */

const KEY = "resume-v2-isolated-synthetic-key";
process.env.AYAS_ACCESS_KEY = KEY;
delete process.env[AYAS_AUTONOMOUS_EXECUTION_ENV_VAR];
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const ON = { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" };
const OFF: Record<string, string | undefined> = {};
const HISTORICAL_MS = 2 * 60 * 60 * 1000;

const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-resume-v2-"));
const junctions: string[] = [];
const rows: Record<string, unknown>[] = [];
let count = 0;

async function scenario(id: string, name: string, fn: () => Promise<Record<string, unknown> | void>) {
  const observed = await fn();
  count += 1;
  rows.push({ id, name, outcome: "PASS", ...(observed ?? {}) });
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${id} ${name}`);
}

function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function sha256(bytes: Buffer | string) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function dir(label: string) { return fs.mkdtempSync(path.join(RUN_ROOT, `${label}-`)); }
function sleepSync(ms: number) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

interface Fixture {
  readonly repoRoot: string;
  readonly remoteDir: string;
  readonly gateRoot: string;
  readonly inboxRoot: string;
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly stabilityGuard: ReturnType<typeof isolatedStabilityGuardDeps>;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function makeFixture(options: { readonly strict?: boolean } = {}): Fixture {
  const remoteDir = dir("remote");
  git(remoteDir, "init", "-q", "--bare");
  const repoRoot = dir("repo");
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
    const link = path.join(repoRoot, "node_modules", dep);
    fs.symlinkSync(fs.realpathSync.native(path.join(process.cwd(), "node_modules", dep)), link, process.platform === "win32" ? "junction" : "dir");
    junctions.push(link);
  }
  const inboxRoot = dir("inbox");
  return {
    repoRoot, remoteDir, inboxRoot,
    gateRoot: dir("gate"),
    inbox: createAyasApprovalInboxStore({ rootDir: inboxRoot, ...(options.strict === false ? {} : { requireOwnerAdmission: true }) }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: dir("artifacts") }),
    stabilityGuard: isolatedStabilityGuardDeps(),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

function proposalInput(overrides: Record<string, unknown>) {
  return {
    createdAt: "2026-10-08T09:00:00.000Z", baseBranch: "master", baseHead: "will-be-overridden",
    objective: "AYAS-generated fixture improvement", currentProblem: "fixture problem", selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1,
    risk: "low and reversible", safetyClassification: "SAFE" as const, expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"], estimatedCost: "zero-cost" as const, mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    ...overrides,
  };
}

/** A publishable new-file patch-artifact proposal at the current HEAD. */
function seedProposal(f: Fixture, fileName: string): AyasInboxProposal {
  const head = git(f.repoRoot, "rev-parse", "HEAD");
  const file = `scripts/${fileName}.ts`;
  const content = `console.log(JSON.stringify({ status: "PASS", suite: "${fileName}", scenarios: 1 }));\n`;
  const artifact = f.artifactStore.freeze({
    artifactId: `ayas-patch-artifact-${crypto.randomUUID()}`,
    candidateId: "ayas-novel-fixture", generatorIdentity: "ayas-detector:diagnostic-quality-gap-v1",
    baseBranch: "master", baseHead: head, exactFiles: [file], allowedRoots: ["scripts/"],
    replacements: [{ filePath: file, expectedHash: null, content, allowCreate: true }],
    validatorScripts: [], graphifyEvidence: ["fixture"], graphifyImportCounts: { [file]: 0 },
    safetyClassification: "SAFE", problemStatement: "p", rationale: "r", expectedUserBenefit: "b", expectedBehaviorChange: "c",
    unchangedBehavior: "u", risk: "low", productionImpact: "none", sandboxValidationSummary: ["PASS"], generatedAt: "2026-10-08T09:00:00.000Z",
  } as never);
  return f.inbox.createProposal(proposalInput({ baseHead: head, exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash }) as never);
}

const subject = (p: Pick<AyasInboxProposal, "proposalId" | "proposalHash">, decision: "APPROVE" | "EXECUTE", proposalHash = p.proposalHash) =>
  ({ kind: "proposal" as const, proposalId: p.proposalId, proposalHash, decision });

/**
 * Historical consent through the real owner-approval gate with execution off:
 * the owner's sealed APPROVE is recorded two hours ago, from its own session.
 */
async function ownerApproveHistorically(f: Fixture, p: AyasInboxProposal, at = Date.now() - HISTORICAL_MS): Promise<AyasOwnerAdmission> {
  const ownerAdmission = await admitAyasOwnerApproval({ gate, token: await issueSession(KEY, at - 60_000), action: "ayasOwnerApprovalDecision", subject: subject(p, "APPROVE"), now: at });
  const outcome = await decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date(at).toISOString()), "APPROVE",
    { ...baseDeps(f), ownerAdmission, envOverride: OFF, now: () => new Date(at).toISOString() });
  assert.equal(outcome.executed, false);
  assert.equal(!outcome.executed && outcome.reason, "APPROVED_PENDING_EXECUTION");
  return ownerAdmission;
}

/** A fresh EXECUTE verification from its own newly issued session. */
async function admitExecute(p: Pick<AyasInboxProposal, "proposalId" | "proposalHash">, options: { readonly at?: number; readonly token?: string; readonly action?: AyasOwnerAdmissionAction; readonly proposalHash?: string } = {}): Promise<AyasOwnerAdmission> {
  const at = options.at ?? Date.now();
  return admitAyasOwnerApproval({ gate, token: options.token ?? await issueSession(KEY, at), action: options.action ?? "executeAyasApprovedProposal", subject: subject(p, "EXECUTE", options.proposalHash), now: at });
}

function baseDeps(f: Fixture) {
  return { repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, artifactStore: f.artifactStore, stabilityGuard: f.stabilityGuard, postPublicationClosure: f.postPublicationClosure, traceEnabled: false };
}

function manualResume(f: Fixture, executionOwnerAdmission: AyasOwnerAdmission | undefined, extra: Partial<AyasOwnerApprovalResumeDeps> = {}): Promise<readonly AyasOwnerApprovalResumeAttempt[]> {
  return resumeAyasOwnerApprovedProposals({ ...baseDeps(f), envOverride: ON, explicitManualOwnerAction: true, ...(executionOwnerAdmission ? { executionOwnerAdmission } : {}), ...extra });
}

interface Snapshot { readonly head: string; readonly remote: string; readonly status: string; readonly inbox: string; readonly journal: number }
function snapshot(f: Fixture): Snapshot {
  return {
    head: git(f.repoRoot, "rev-parse", "HEAD"),
    remote: git(f.remoteDir, "rev-parse", "master"),
    status: git(f.repoRoot, "status", "--porcelain"),
    inbox: sha256(fs.readFileSync(f.inbox.stateFile)),
    journal: createAyasExecutionJournal({ rootDir: f.gateRoot }).list().length,
  };
}
/** No commit, no push, no worktree change, no journal; the inbox is byte-identical unless the caller allows a recorded state change. */
function assertNoEffect(f: Fixture, before: Snapshot, label: string, options: { readonly inboxMayChange?: boolean } = {}) {
  const after = snapshot(f);
  assert.equal(after.head, before.head, `${label}: no local commit`);
  assert.equal(after.remote, before.remote, `${label}: no push`);
  assert.equal(after.status, before.status, `${label}: worktree unchanged`);
  assert.equal(after.journal, before.journal, `${label}: no execution journal entry`);
  if (!options.inboxMayChange) assert.equal(after.inbox, before.inbox, `${label}: approval inbox byte-identical`);
}
function proposalNow(f: Fixture, proposalId: string) { return f.inbox.load().proposals.find((p) => p.proposalId === proposalId)!; }
function approveDecision(f: Fixture, proposalId: string) { return [...f.inbox.load().decisions].reverse().find((d) => d.proposalId === proposalId && d.decision === "APPROVE")!; }
function usedRefs(f: Fixture) { return new Set(f.inbox.load().decisions.flatMap((d) => [d.ownerAdmission?.actionRef, d.executionOwnerAdmission?.actionRef]).filter((v): v is string => !!v)); }
/** Independent proof that an EXECUTE admission is valid right now, so a later refusal is not an authentication refusal. */
function assertExecutionAdmissionValid(f: Fixture, p: AyasInboxProposal, admission: AyasOwnerAdmission) {
  assert.equal(checkAyasOwnerExecutionAdmission(approveDecision(f, p.proposalId), admission, subject(p, "EXECUTE"), new Date().toISOString(), usedRefs(f)), true, "control: the EXECUTE admission itself is valid");
}
function spyInbox(inbox: AyasApprovalInboxHandle) {
  let loads = 0;
  const spy: AyasApprovalInboxHandle = { ...inbox, load: () => { loads += 1; return inbox.load(); } };
  return { spy, loads: () => loads };
}
/** A session cookie in the pre-K3 format: valid signature and expiry, no nonce. */
function legacyNonceLessToken(at = Date.now()): string {
  const iat = Math.floor(at / 1000);
  const body = Buffer.from(JSON.stringify({ v: 1, iat, exp: iat + AYAS_SESSION_TTL_SECONDS })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", KEY).update(body).digest("base64url")}`;
}

async function main(): Promise<void> {
  // --- R01/R02: no manual action or no fresh EXECUTE — a no-op before any state access ---

  for (const [id, name, deps] of [
    ["R01a", "flag on, sealed historical APPROVE, neither manual action nor EXECUTE", { envOverride: ON }],
    ["R01b", "flag on, fresh EXECUTE present, no explicit manual action", { envOverride: ON, withExecute: true }],
    ["R02a", "flag on, explicit manual action, no EXECUTE", { envOverride: ON, explicitManualOwnerAction: true }],
    ["R02b", "explicit manual action and fresh EXECUTE, flag off", { envOverride: OFF, explicitManualOwnerAction: true, withExecute: true }],
  ] as const) {
    await scenario(id, `${name}: zero attempts, zero state loads, zero effect`, async () => {
      const f = makeFixture();
      const p = seedProposal(f, "smoke-fixture-r01");
      await ownerApproveHistorically(f, p);
      const executionOwnerAdmission = "withExecute" in deps ? await admitExecute(p) : undefined;
      const before = snapshot(f);
      const { spy, loads } = spyInbox(f.inbox);
      const attempts = await resumeAyasOwnerApprovedProposals({ ...baseDeps(f), inbox: spy, envOverride: deps.envOverride,
        ...("explicitManualOwnerAction" in deps ? { explicitManualOwnerAction: true } : {}), ...(executionOwnerAdmission ? { executionOwnerAdmission } : {}) });
      assert.deepEqual(attempts, []);
      assert.equal(loads(), 0, "the worker returns before reading the approval inbox");
      assertNoEffect(f, before, id);
      assert.equal(proposalNow(f, p.proposalId).status, "APPROVED");
      return { attempts: 0, inboxLoads: 0, commits: 0, pushes: 0 };
    });
  }

  // --- R03: forged, replayed, malformed, expired, future, stale, legacy or cross-subject EXECUTE ---

  await scenario("R03", "every invalid EXECUTE admission is refused by the manual resume path with zero effect", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r03");
    const approval = await ownerApproveHistorically(f, p);
    const valid = await admitExecute(p);
    const unsealed = Object.fromEntries(Object.entries(valid).filter(([field]) => field !== "seal"));
    const now = Date.now();
    const cases: [string, unknown][] = [
      ["approve-admission-replayed-as-execute", approval],
      ["execute-subject-under-approve-action", await admitExecute(p, { action: "ayasOwnerApprovalDecision" })],
      ["malformed-missing-seal", unsealed],
      ["forged-seal", { ...valid, seal: "0".repeat(64) }],
      ["session-expired-before-use", await admitExecute(p, { at: now - 2000, token: await issueSession(KEY, now - (AYAS_SESSION_TTL_SECONDS + 1) * 1000) })],
      ["future-verification", await admitExecute(p, { at: now + 5 * 60 * 1000 })],
      ["stale-verification", await admitExecute(p, { at: now - (AYAS_OWNER_ADMISSION_MAX_AGE_MS + 1000) })],
      ["cross-subject-hash", await admitExecute(p, { proposalHash: "f".repeat(64) })],
    ];
    for (const [label, admission] of cases) {
      const before = snapshot(f);
      assert.equal(checkAyasOwnerExecutionAdmission(approveDecision(f, p.proposalId), admission, subject(p, "EXECUTE"), new Date().toISOString(), usedRefs(f)), false, `${label}: refused by the admission check`);
      assert.deepEqual(await manualResume(f, admission as AyasOwnerAdmission), [], label);
      assertNoEffect(f, before, label);
    }
    // A pre-K3 cookie still opens the studio, but it can never mint an execution admission.
    const legacy = legacyNonceLessToken();
    assert.equal(await verifySession(legacy, KEY), true, "legacy cookie remains valid for general access");
    await assert.rejects(() => admitExecute(p, { token: legacy }), (error: unknown) => error instanceof AyasOwnerAdmissionError && error.code === "OWNER_ADMISSION_REQUIRED");
    assert.equal(proposalNow(f, p.proposalId).status, "APPROVED");
    assert.equal(approveDecision(f, p.proposalId).reservationId, undefined, "the approval was never reserved");
    return { refused: [...cases.map(([label]) => label), "legacy-nonce-less-session"], commits: 0, pushes: 0 };
  });

  // --- R04: historical consent + fresh EXECUTE from a different verified session + explicit manual action ---

  let completed: { f: Fixture; p: AyasInboxProposal; publishedHead: string; execute: AyasOwnerAdmission } | undefined;
  await scenario("R04", "valid historical APPROVE, fresh EXECUTE from a different session and an explicit manual action publish exactly once", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r04");
    const approval = await ownerApproveHistorically(f, p);
    const execute = await admitExecute(p);
    assertExecutionAdmissionValid(f, p, execute);
    const before = snapshot(f);
    const attempts = await manualResume(f, execute);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.proposalId, p.proposalId);
    assert.equal(attempts[0]!.outcome.ok, true, JSON.stringify(attempts[0]!.outcome));
    const publishedHead = git(f.repoRoot, "rev-parse", "HEAD");
    assert.notEqual(publishedHead, before.head);
    assert.equal(git(f.remoteDir, "rev-parse", "master"), publishedHead);
    assert.equal(git(f.repoRoot, "rev-list", "--count", `${before.head}..${publishedHead}`), "1", "exactly one commit");
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.equal(proposalNow(f, p.proposalId).status, "COMPLETED");
    const decision = approveDecision(f, p.proposalId);
    assert.deepEqual(decision.ownerAdmission, approval);
    assert.deepEqual(decision.executionOwnerAdmission, execute);
    assert.equal(decision.reason, AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON);
    assert.notEqual(approval.sessionRef, execute.sessionRef, "two verified logins");
    assert.notEqual(approval.actionRef, execute.actionRef, "two server actions");
    assert.ok(Date.parse(execute.verifiedAt) - Date.parse(decision.decidedAt) >= HISTORICAL_MS - 1000, "consent is historical, execution is fresh");
    const journal = createAyasExecutionJournal({ rootDir: f.gateRoot }).list();
    assert.equal(journal.length, 1);
    assert.equal(journal[0]!.ownerApprovalDecisionId, decision.decisionId);
    assert.equal(journal[0]!.authorizationId, decision.authorizationId);
    assert.equal(journal[0]!.reservationId, decision.reservationId);
    completed = { f, p, publishedHead, execute };
    return { attempts: 1, isolatedCommits: 1, isolatedBarePushes: 1, journalPhase: journal[0]!.phase, distinctSessions: true, distinctActions: true };
  });

  // --- R05: duplicate execution and replay after completion, restart and concurrency ---

  await scenario("R05a", "the same EXECUTE replayed after completion yields no attempt and no second commit", async () => {
    const { f, publishedHead, execute } = completed!;
    const before = snapshot(f);
    assert.deepEqual(await manualResume(f, execute), []);
    assertNoEffect(f, before, "R05a");
    assert.equal(before.head, publishedHead);
    return { attempts: 0, commits: 0, pushes: 0 };
  });

  await scenario("R05b", "after a simulated restart (fresh inbox handle) a brand-new EXECUTE still cannot re-publish a completed proposal", async () => {
    const { f, p, publishedHead } = completed!;
    const restarted = { ...f, inbox: createAyasApprovalInboxStore({ rootDir: f.inboxRoot, requireOwnerAdmission: true }) };
    assert.equal(proposalNow(restarted, p.proposalId).status, "COMPLETED", "durable state alone reflects completion");
    const before = snapshot(restarted);
    assert.deepEqual(await manualResume(restarted, await admitExecute(p)), []);
    await assert.rejects(() => publishAlreadyOwnerApprovedAyasProposal(p.proposalId, p.proposalHash, { ...baseDeps(restarted), executionOwnerAdmission: undefined }),
      (error: unknown) => error instanceof AyasProposalApprovalError && error.code === "NOT_READY", "the service refuses on its own, not only the resume filter");
    assertNoEffect(restarted, before, "R05b");
    assert.equal(before.head, publishedHead);
    return { attempts: 0, commits: 0, pushes: 0 };
  });

  // R05c/R05d start both calls in one tick. The first runs synchronously through its
  // reservation before the second reads state, so these prove back-to-back clicks;
  // R05e below forces a real interleaving past the eligibility check.
  for (const [id, name, distinct] of [
    ["R05c", "two back-to-back manual resumes with the SAME EXECUTE", false],
    ["R05d", "two back-to-back manual resumes with two DIFFERENT fresh EXECUTEs (two tabs)", true],
  ] as const) {
    await scenario(id, `${name}: at most one publication`, async () => {
      const f = makeFixture();
      const p = seedProposal(f, `smoke-fixture-${id.toLowerCase()}`);
      await ownerApproveHistorically(f, p);
      const first = await admitExecute(p);
      const second = distinct ? await admitExecute(p) : first;
      const base = git(f.repoRoot, "rev-parse", "HEAD");
      const results = await Promise.all([manualResume(f, first), manualResume(f, second)]);
      const outcomes = results.flat().map((a) => a.outcome);
      const okCount = outcomes.filter((o) => o.ok).length;
      const commits = Number(git(f.repoRoot, "rev-list", "--count", `${base}..HEAD`));
      assert.ok(okCount <= 1, `at most one successful publication, saw ${okCount}`);
      assert.equal(commits, okCount, "a commit exists only for a successful publication");
      assert.equal(git(f.remoteDir, "rev-parse", "master"), git(f.repoRoot, "rev-parse", "HEAD"), "local and remote agree");
      assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
      const reservations = f.inbox.load().decisions.filter((d) => d.proposalId === p.proposalId && d.reservationId).length;
      assert.ok(reservations <= 1, `one approval is reserved at most once, saw ${reservations}`);
      return { attempts: outcomes.length, successful: okCount, commits, reservations, refusedCodes: outcomes.filter((o) => !o.ok).map((o) => (o as { code: string }).code), finalStatus: proposalNow(f, p.proposalId).status };
    });
  }

  await scenario("R05e", "interleaved race: a second manual resume starts after the first passed eligibility and authentication but before its reservation — one publication", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r05e");
    await ownerApproveHistorically(f, p);
    const first = await admitExecute(p);
    const second = await admitExecute(p);
    const base = git(f.repoRoot, "rev-parse", "HEAD");
    let racer: Promise<readonly AyasOwnerApprovalResumeAttempt[]> | undefined;
    const onJournalPhase = (phase: AyasExecutionJournalPhase) => { if (phase === "APPROVED_NOT_STARTED" && !racer) racer = manualResume(f, second); };
    const firstAttempts = await manualResume(f, first, { onJournalPhase });
    assert.ok(racer, "the second resume was started inside the first's pre-reservation window");
    const secondAttempts = await racer;
    assert.equal(secondAttempts.length, 1, "the second call passed eligibility (the proposal was still APPROVED), so the race is real");
    assert.equal(firstAttempts.length, 1);
    assert.equal(firstAttempts[0]!.outcome.ok, true, JSON.stringify(firstAttempts[0]!.outcome));
    assert.equal(secondAttempts[0]!.outcome.ok, false);
    const refused = secondAttempts[0]!.outcome as { code: string; stage: string };
    assert.equal(git(f.repoRoot, "rev-list", "--count", `${base}..HEAD`), "1", "exactly one commit");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), git(f.repoRoot, "rev-parse", "HEAD"));
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.equal(f.inbox.load().decisions.filter((d) => d.proposalId === p.proposalId && d.reservationId).length, 1);
    assert.equal(approveDecision(f, p.proposalId).executionOwnerAdmission?.actionRef, first.actionRef, "the reservation is bound to the winning action only");
    return { firstOk: true, secondCode: refused.code, secondStage: refused.stage, commits: 1, pushes: 1, reservations: 1 };
  });

  // --- R06: with a currently valid manual authorization, stale HEAD / dirty repo / scope drift are still refused ---

  await scenario("R06a", "stale HEAD under valid manual authorization: reconciled to STALE, never published, approval not reserved", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r06a");
    await ownerApproveHistorically(f, p);
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "existing.ts"), "export const existing = 2;\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-q", "-m", "repo moved on before the manual resume");
    const execute = await admitExecute(p);
    assertExecutionAdmissionValid(f, p, execute);
    const before = snapshot(f);
    const attempts = await manualResume(f, execute);
    assert.equal(attempts.length, 1, "authentication passed, so the worker made exactly one attempt");
    assert.equal(attempts[0]!.outcome.ok, false);
    const code = (attempts[0]!.outcome as { code: string }).code;
    assert.equal(code, "STALE_APPROVAL");
    assertNoEffect(f, before, "R06a", { inboxMayChange: true });
    assert.equal(proposalNow(f, p.proposalId).status, "STALE");
    assert.equal(approveDecision(f, p.proposalId).reservationId, undefined);
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts", "smoke-fixture-r06a.ts")), false);
    return { attempts: 1, code, finalStatus: "STALE", reserved: false, commits: 0, pushes: 0 };
  });

  await scenario("R06b", "dirty repository under valid manual authorization: refused before reservation, dirty bytes untouched, approval kept", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r06b");
    await ownerApproveHistorically(f, p);
    const dirtyFile = path.join(f.repoRoot, "scripts", "existing.ts");
    fs.writeFileSync(dirtyFile, "export const existing = 'uncommitted owner work';\n");
    const dirtyBytes = sha256(fs.readFileSync(dirtyFile));
    const execute = await admitExecute(p);
    assertExecutionAdmissionValid(f, p, execute);
    const before = snapshot(f);
    const attempts = await manualResume(f, execute);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.outcome.ok, false);
    const outcome = attempts[0]!.outcome as { code: string; stage: string; message: string };
    assert.match(`${outcome.code} ${outcome.stage}`, /DIRTY|STABILITY_GUARD/);
    assert.match(outcome.message, /dirty|uncommitted|working tree/i, `refused for the dirty tree, not something unrelated: ${outcome.message}`);
    assertNoEffect(f, before, "R06b", { inboxMayChange: true });
    assert.equal(sha256(fs.readFileSync(dirtyFile)), dirtyBytes, "the owner's uncommitted bytes are untouched");
    assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts", "smoke-fixture-r06b.ts")), false);
    assert.equal(proposalNow(f, p.proposalId).status, "APPROVED", "a refusal does not consume the approval");
    assert.equal(approveDecision(f, p.proposalId).reservationId, undefined);
    return { attempts: 1, code: outcome.code, stage: outcome.stage, reserved: false, commits: 0, pushes: 0 };
  });

  await scenario("R06c", "exact scope drift with the hash kept (tampered record): refused by the artifact scope binding before reservation", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r06c");
    await ownerApproveHistorically(f, p);
    const state = f.inbox.load();
    f.inbox.save({ ...state, proposals: state.proposals.map((x) => x.proposalId === p.proposalId ? { ...x, exactFiles: [...x.exactFiles, "scripts/smoke-fixture-r06c-extra.ts"] } : x) });
    const execute = await admitExecute(p);
    assertExecutionAdmissionValid(f, p, execute);
    const before = snapshot(f);
    const attempts = await manualResume(f, execute);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]!.outcome.ok, false);
    const code = (attempts[0]!.outcome as { code: string }).code;
    assert.equal(code, "AYAS_PATCH_ARTIFACT_MUTATION_SCOPE_MISMATCH");
    assertNoEffect(f, before, "R06c", { inboxMayChange: true });
    assert.equal(approveDecision(f, p.proposalId).reservationId, undefined);
    return { attempts: 1, code, reserved: false, commits: 0, pushes: 0 };
  });

  await scenario("R06d", "content drift that changes the proposal hash: the sealed APPROVE no longer binds, so nothing is attempted", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r06d");
    await ownerApproveHistorically(f, p);
    const drifted = { ...p, proposalHash: "d".repeat(64) };
    const state = f.inbox.load();
    f.inbox.save({ ...state, proposals: state.proposals.map((x) => x.proposalId === p.proposalId ? { ...x, proposalHash: drifted.proposalHash } : x) });
    const before = snapshot(f);
    for (const execute of [await admitExecute(p), await admitExecute(drifted)]) assert.deepEqual(await manualResume(f, execute), []);
    assertNoEffect(f, before, "R06d");
    return { attempts: 0, commits: 0, pushes: 0 };
  });

  // --- R07: two approved proposals at one baseHead — one exact EXECUTE runs only its own subject ---

  await scenario("R07", "two approved proposals share a baseHead: an EXECUTE for A publishes only A; B needs its own action and is then stale", async () => {
    const f = makeFixture();
    const a = seedProposal(f, "smoke-fixture-r07a");
    const b = seedProposal(f, "smoke-fixture-r07b");
    assert.equal(a.baseHead, b.baseHead);
    await ownerApproveHistorically(f, a);
    await ownerApproveHistorically(f, b);
    const base = git(f.repoRoot, "rev-parse", "HEAD");
    const attempts = await manualResume(f, await admitExecute(a));
    assert.deepEqual(attempts.map((x) => x.proposalId), [a.proposalId], "only the exact subject is attempted");
    assert.equal(attempts[0]!.outcome.ok, true, JSON.stringify(attempts[0]!.outcome));
    const afterA = git(f.repoRoot, "rev-parse", "HEAD");
    assert.equal(git(f.repoRoot, "rev-list", "--count", `${base}..${afterA}`), "1");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), afterA);
    assert.equal(proposalNow(f, a.proposalId).status, "COMPLETED");
    const bDecision = approveDecision(f, b.proposalId);
    assert.equal(bDecision.reservationId, undefined, "B was never reserved");
    assert.equal(bDecision.executionOwnerAdmission, undefined, "B carries no execution admission");
    assert.equal(git(f.remoteDir, "ls-tree", "-r", "--name-only", "master").split("\n").includes("scripts/smoke-fixture-r07b.ts"), false, "B was never published");
    const bStatusAfterA = proposalNow(f, b.proposalId).status;
    assert.ok(bStatusAfterA === "APPROVED" || bStatusAfterA === "STALE", `unexpected B status ${bStatusAfterA}`);

    const before = snapshot(f);
    const bAttempts = await manualResume(f, await admitExecute(b));
    assert.ok(bAttempts.every((x) => x.proposalId === b.proposalId && !x.outcome.ok), "B's own action cannot publish against a moved HEAD");
    assertNoEffect(f, before, "R07-B", { inboxMayChange: true });
    assert.equal(proposalNow(f, b.proposalId).status, "STALE");
    return { firstAction: { attempted: ["A"], commits: 1 }, bStatusAfterA, secondAction: { attempts: bAttempts.length, codes: bAttempts.map((x) => (x.outcome as { code?: string }).code ?? null), commits: 0 }, bFinal: "STALE" };
  });

  // --- R08: unattributed or legacy approvals are never resumed and never gain an actor ---

  await scenario("R08", "unattributed, legacy and manual-ONAYLA approvals are not resumable even with a fresh EXECUTE; no actor is backfilled", async () => {
    const results: Record<string, string> = {};
    for (const variant of ["owner-reason-without-admission", "legacy-onayla-no-reason", "admitted-manual-onayla-without-owner-reason"] as const) {
      const f = makeFixture({ strict: variant === "admitted-manual-onayla-without-owner-reason" });
      const p = seedProposal(f, "smoke-fixture-r08");
      const at = new Date().toISOString();
      if (variant === "owner-reason-without-admission") f.inbox.decide(p.proposalId, "APPROVE", at, AYAS_OWNER_APPROVED_PENDING_EXECUTION_REASON);
      if (variant === "legacy-onayla-no-reason") f.inbox.decide(p.proposalId, "APPROVE", at);
      if (variant === "admitted-manual-onayla-without-owner-reason") {
        f.inbox.decide(p.proposalId, "APPROVE", at, undefined, await admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "decideAyasApproval", subject: subject(p, "APPROVE") }));
      }
      const before = snapshot(f);
      assert.deepEqual(await manualResume(f, await admitExecute(p)), [], variant);
      assertNoEffect(f, before, variant);
      assert.equal(proposalNow(f, p.proposalId).status, "APPROVED");
      results[variant] = "NO_ATTEMPT_NO_BACKFILL";
    }
    return results;
  });

  // --- R09: an exact-patch proposal stays outside the publication resume ---

  await scenario("R09", "a proposal carrying an exact-patch safety proof marker is never handed to the publication resume", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-r09");
    await ownerApproveHistorically(f, p);
    const state = f.inbox.load();
    f.inbox.save({ ...state, proposals: state.proposals.map((x) => x.proposalId === p.proposalId ? { ...x, exactPatchSafetyProof: { fixture: "presence-only" } as never } : x) });
    const execute = await admitExecute(p);
    assertExecutionAdmissionValid(f, p, execute);
    const before = snapshot(f);
    assert.deepEqual(await manualResume(f, execute), []);
    await assert.rejects(() => publishAlreadyOwnerApprovedAyasProposal(p.proposalId, p.proposalHash, { ...baseDeps(f), executionOwnerAdmission: execute }),
      (error: unknown) => error instanceof AyasProposalApprovalError && error.code === "EXACT_PATCH_LOCAL_EXECUTION_ONLY");
    assertNoEffect(f, before, "R09");
    return { attempts: 0, serviceCode: "EXACT_PATCH_LOCAL_EXECUTION_ONLY", limitation: "presence marker only; real exact-proof construction not exercised" };
  });

  // --- R10: authority that lapses or changes after reservation is refused before the mutation callback ---

  for (const [id, name, lapse] of [
    ["R10a", "the EXECUTE session expires after reservation", "expire"],
    ["R10b", "the sealed APPROVE decision is altered after reservation", "tamper"],
  ] as const) {
    await scenario(id, `${name}: refused before any file is written, nothing committed or pushed`, async () => {
      const f = makeFixture();
      const p = seedProposal(f, `smoke-fixture-${id.toLowerCase()}`);
      await ownerApproveHistorically(f, p);
      const issuedAt = lapse === "expire" ? Date.now() - (AYAS_SESSION_TTL_SECONDS - 8) * 1000 : Date.now();
      const execute = await admitExecute(p, { token: await issueSession(KEY, issuedAt) });
      assertExecutionAdmissionValid(f, p, execute);
      const before = snapshot(f);
      let reservedHookRan = false;
      const onJournalPhase = (phase: AyasExecutionJournalPhase) => {
        if (phase !== "AUTHORIZATION_RESERVED" || reservedHookRan) return;
        reservedHookRan = true;
        if (lapse === "expire") {
          const wait = Date.parse(execute.sessionExpiresAt) - Date.now() + 1500;
          if (wait > 0) sleepSync(wait);
        } else {
          const state = f.inbox.load();
          f.inbox.save({ ...state, decisions: state.decisions.map((d) => d.proposalId === p.proposalId && d.decision === "APPROVE" ? { ...d, ownerDecisionSeal: "0".repeat(64) } : d) });
        }
      };
      const attempts = await manualResume(f, execute, { onJournalPhase });
      assert.equal(reservedHookRan, true, "the lapse happened after authentication and reservation");
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0]!.outcome.ok, false);
      const outcome = attempts[0]!.outcome as { code: string; stage: string };
      assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts", `smoke-fixture-${id.toLowerCase()}.ts`)), false, "the mutation callback never wrote the file");
      const after = snapshot(f);
      assert.equal(after.head, before.head, "no commit");
      assert.equal(after.remote, before.remote, "no push");
      assert.equal(after.status, before.status, "worktree unchanged");
      const journal = createAyasExecutionJournal({ rootDir: f.gateRoot }).list();
      return { attempts: 1, code: outcome.code, stage: outcome.stage, journalPhase: journal.at(-1)?.phase ?? null, finalStatus: proposalNow(f, p.proposalId).status, commits: 0, pushes: 0 };
    });
  }

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-approval-resume-v2", scenarios: count, scope: "TEMP Git repositories with local bare remotes; synthetic in-process access key; isolated stability guard; no network, model, live runtime or data/brain", rows }, null, 2));
  console.log(`AYAS owner-approval resume V2 smoke: PASS (${count} scenarios)`);
}

/** Junctions first, each proven gone with its target intact, before the run root is removed. */
function cleanup(): { readonly removedRunRoot: boolean; readonly junctionsRemoved: number } {
  let junctionsRemoved = 0;
  for (const link of junctions) {
    const target = fs.existsSync(link) ? fs.realpathSync.native(link) : null;
    try { fs.rmdirSync(link); } catch { /* checked below */ }
    let stillThere = true;
    try { fs.lstatSync(link); } catch { stillThere = false; }
    if (stillThere) return { removedRunRoot: false, junctionsRemoved };
    if (target) assert.ok(fs.existsSync(target), `junction target ${target} must survive cleanup`);
    junctionsRemoved += 1;
  }
  fs.rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 3 });
  return { removedRunRoot: !fs.existsSync(RUN_ROOT), junctionsRemoved };
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    const result = cleanup();
    if (!result.removedRunRoot) console.error(`cleanup incomplete: run root kept at ${RUN_ROOT} (${result.junctionsRemoved}/${junctions.length} junctions removed)`);
  });
