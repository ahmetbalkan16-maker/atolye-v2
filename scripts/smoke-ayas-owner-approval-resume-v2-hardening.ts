import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate, AYAS_SESSION_TTL_SECONDS } from "../src/lib/auth/accessGate";
import { admitAyasOwnerApproval, type AyasOwnerAdmission } from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { resumeAyasOwnerApprovedProposals, type AyasOwnerApprovalResumeAttempt, type AyasOwnerApprovalResumeDeps } from "../src/lib/brain/autonomy/AyasOwnerApprovalResume";
import { publishAlreadyOwnerApprovedAyasProposal } from "../src/lib/brain/autonomy/AyasProposalApprovalService";
import { decideAyasOwnerApproval, AYAS_AUTONOMOUS_EXECUTION_ENV_VAR } from "../src/lib/brain/autonomy/AyasAutonomousExecutionGate";
import { bindAyasOwnerApproval } from "../src/lib/brain/autonomy/AyasApprovalBinding";
import { createAyasApprovalInboxStore, type AyasApprovalInboxHandle, type AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { createAyasPatchArtifactStore, type AyasPatchArtifactStore } from "../src/lib/brain/autonomy/AyasPatchArtifact";
import { AYAS_PATCH_ARTIFACT_MUTATION_KIND } from "../src/lib/brain/autonomy/AyasNovelPatchDiscovery";
import { createAyasExecutionJournal, type AyasExecutionJournalPhase } from "../src/lib/brain/autonomy/AyasExecutionJournal";
import { isolatedStabilityGuardDeps } from "./ayas-isolated-stability-guard";

/**
 * Resume V2 hardening — a narrow addendum to
 * `smoke-ayas-owner-approval-resume-v2.ts` (left byte-identical, it is the
 * reviewed V2 artifact). V2's R05c/R05d accept "at most one" publication, so
 * they would also pass if both clicks failed, and the recorded run shows the
 * second click never reached the service (attempts: 1 in total); R07 accepts
 * either status for B; R10a/R10b do not pin why the run was refused. Here:
 *
 * - H05c/H05d pin the sequential double click exactly, and H05f runs the
 *   SAME EXECUTE twice interleaved (the in-flight actionRef replay V2 does
 *   not cover; R05e interleaves two different EXECUTEs).
 * - H07 pins B as APPROVED and byte-identical after A, and B's own action
 *   as exactly one STALE_APPROVAL attempt.
 * - H10a/H10b pin OWNER_ADMISSION_REQUIRED at EXECUTION, the
 *   RECOVERY_REQUIRED journal/proposal state, and that no later EXECUTE can
 *   replay it.
 * - K3a/K3b prove the actionRef replay check on its own, at the resume filter
 *   and again at the service, so removing either is visible to V2 review.
 *
 * Not covered, and reported as NOT_RUN: a race between two OS processes and a
 * real server restart. Every race here is in one process.
 *
 * Isolation: as V2 — throwaway Git repos with local bare remotes under one
 * run root, synthetic in-process access key, isolated stability guard. This
 * process's own temp directory is pointed inside the run root, so the
 * guard's `ayas-guard-*` stores are removed with it.
 */

const KEY = "resume-v2-hardening-synthetic-key";
process.env.AYAS_ACCESS_KEY = KEY;
delete process.env[AYAS_AUTONOMOUS_EXECUTION_ENV_VAR];
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const ON = { [AYAS_AUTONOMOUS_EXECUTION_ENV_VAR]: "1" };
const OFF: Record<string, string | undefined> = {};
const HISTORICAL_MS = 2 * 60 * 60 * 1000;

const RUN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-resume-v2-hardening-"));
const PROCESS_TMP = path.join(RUN_ROOT, "os-tmp");
fs.mkdirSync(PROCESS_TMP);
process.env.TEMP = PROCESS_TMP; process.env.TMP = PROCESS_TMP; process.env.TMPDIR = PROCESS_TMP;
assert.equal(path.resolve(os.tmpdir()), path.resolve(PROCESS_TMP), "guard stores land inside the run root");
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
  readonly inbox: AyasApprovalInboxHandle;
  readonly artifactStore: AyasPatchArtifactStore;
  readonly stabilityGuard: ReturnType<typeof isolatedStabilityGuardDeps>;
  readonly postPublicationClosure: (expectedHead: string) => void;
}

function makeFixture(): Fixture {
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
  return {
    repoRoot, remoteDir,
    gateRoot: dir("gate"),
    inbox: createAyasApprovalInboxStore({ rootDir: dir("inbox"), requireOwnerAdmission: true }),
    artifactStore: createAyasPatchArtifactStore({ rootDir: dir("artifacts") }),
    stabilityGuard: isolatedStabilityGuardDeps(),
    postPublicationClosure: (expectedHead) => {
      assert.equal(git(repoRoot, "rev-parse", "HEAD"), expectedHead);
      assert.equal(git(remoteDir, "rev-parse", "master"), expectedHead);
    },
  };
}

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
  return f.inbox.createProposal({
    createdAt: "2026-10-08T09:00:00.000Z", baseBranch: "master", baseHead: head,
    objective: "AYAS-generated fixture improvement", currentProblem: "fixture problem", selectionReason: "fixture selection reason",
    expectedUserBenefit: "fixture benefit", expectedBehaviorChange: "fixture change", unchangedBehavior: "fixture unchanged",
    riskIfNotDone: "fixture risk", technicalRisk: "low", productionImpact: "none", rationale: "fixture rationale",
    evidence: ["fixture evidence"], graphifyEvidence: ["fixture graphify evidence"], candidateRank: 1,
    risk: "low and reversible", safetyClassification: "SAFE", expectedDiffScope: "+1 file",
    testsPlanned: ["smoke-fixture-generated"], estimatedCost: "zero-cost", mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND,
    exactFiles: artifact.exactFiles, patchArtifactId: artifact.artifactId, patchHash: artifact.patchHash,
  } as never);
}

const subject = (p: Pick<AyasInboxProposal, "proposalId" | "proposalHash">, decision: "APPROVE" | "EXECUTE") => ({ kind: "proposal" as const, proposalId: p.proposalId, proposalHash: p.proposalHash, decision });
function baseDeps(f: Fixture) {
  return { repoRoot: f.repoRoot, gateRoot: f.gateRoot, inbox: f.inbox, artifactStore: f.artifactStore, stabilityGuard: f.stabilityGuard, postPublicationClosure: f.postPublicationClosure, traceEnabled: false };
}
async function ownerApproveHistorically(f: Fixture, p: AyasInboxProposal, at = Date.now() - HISTORICAL_MS): Promise<AyasOwnerAdmission> {
  const ownerAdmission = await admitAyasOwnerApproval({ gate, token: await issueSession(KEY, at - 60_000), action: "ayasOwnerApprovalDecision", subject: subject(p, "APPROVE"), now: at });
  const outcome = await decideAyasOwnerApproval(bindAyasOwnerApproval(p, new Date(at).toISOString()), "APPROVE", { ...baseDeps(f), ownerAdmission, envOverride: OFF, now: () => new Date(at).toISOString() });
  assert.equal(!outcome.executed && outcome.reason, "APPROVED_PENDING_EXECUTION");
  return ownerAdmission;
}
async function admitExecute(p: Pick<AyasInboxProposal, "proposalId" | "proposalHash">, issuedAt = Date.now()): Promise<AyasOwnerAdmission> {
  return admitAyasOwnerApproval({ gate, token: await issueSession(KEY, issuedAt), action: "executeAyasApprovedProposal", subject: subject(p, "EXECUTE"), now: Date.now() });
}
function manualResume(f: Fixture, executionOwnerAdmission: AyasOwnerAdmission, extra: Partial<AyasOwnerApprovalResumeDeps> = {}): Promise<readonly AyasOwnerApprovalResumeAttempt[]> {
  return resumeAyasOwnerApprovedProposals({ ...baseDeps(f), envOverride: ON, explicitManualOwnerAction: true, executionOwnerAdmission, ...extra });
}
function proposalNow(f: Fixture, id: string) { return f.inbox.load().proposals.find((p) => p.proposalId === id)!; }
function approveDecision(f: Fixture, id: string) { return [...f.inbox.load().decisions].reverse().find((d) => d.proposalId === id && d.decision === "APPROVE")!; }
function recordedActionRefs(f: Fixture) { return f.inbox.load().decisions.flatMap((d) => [d.ownerAdmission?.actionRef, d.executionOwnerAdmission?.actionRef]).filter((v): v is string => !!v); }
function commitsSince(f: Fixture, base: string) { return Number(git(f.repoRoot, "rev-list", "--count", `${base}..HEAD`)); }
function journalPhases(f: Fixture) { return createAyasExecutionJournal({ rootDir: f.gateRoot }).list().map((entry) => entry.phase); }
function failure(attempt: AyasOwnerApprovalResumeAttempt | undefined) { assert.ok(attempt && !attempt.outcome.ok, "a refused attempt"); return attempt.outcome as { code: string; stage: string; message: string }; }
interface Snapshot { readonly head: string; readonly remote: string; readonly status: string; readonly inbox: string; readonly journal: number }
function snapshot(f: Fixture): Snapshot {
  return { head: git(f.repoRoot, "rev-parse", "HEAD"), remote: git(f.remoteDir, "rev-parse", "master"), status: git(f.repoRoot, "status", "--porcelain"), inbox: sha256(fs.readFileSync(f.inbox.stateFile)), journal: createAyasExecutionJournal({ rootDir: f.gateRoot }).list().length };
}

async function main(): Promise<void> {
  // --- H05: double click, exactly ---

  for (const [id, name, distinct] of [
    ["H05c", "SAME EXECUTE clicked twice back-to-back", false],
    ["H05d", "two DIFFERENT fresh EXECUTEs clicked back-to-back", true],
  ] as const) {
    await scenario(id, `${name}: exactly one publication; the second click is filtered because the proposal already left APPROVED`, async () => {
      const f = makeFixture();
      const p = seedProposal(f, `smoke-fixture-${id.toLowerCase()}`);
      await ownerApproveHistorically(f, p);
      const first = await admitExecute(p);
      const second = distinct ? await admitExecute(p) : first;
      const base = git(f.repoRoot, "rev-parse", "HEAD");
      let secondSawStatus: string | undefined;
      const [a, b] = await Promise.all([
        manualResume(f, first),
        (async () => { secondSawStatus = proposalNow(f, p.proposalId).status; return manualResume(f, second); })(),
      ]);
      assert.equal(a.length, 1, "the first click made exactly one attempt");
      assert.equal(a[0]!.outcome.ok, true, JSON.stringify(a[0]!.outcome));
      assert.deepEqual(b, [], "the second click made no attempt");
      assert.notEqual(secondSawStatus, "APPROVED", "…because when it read state the first click had already reserved the approval");
      assert.equal(commitsSince(f, base), 1, "exactly one commit");
      assert.equal(git(f.remoteDir, "rev-parse", "master"), git(f.repoRoot, "rev-parse", "HEAD"), "exactly one push, local equals remote");
      assert.equal(f.inbox.load().decisions.filter((d) => d.proposalId === p.proposalId && d.reservationId).length, 1, "exactly one reservation");
      assert.equal(approveDecision(f, p.proposalId).executionOwnerAdmission?.actionRef, first.actionRef, "bound to the first click");
      if (distinct) assert.equal(recordedActionRefs(f).includes(second.actionRef), false, "the second click's action is never recorded");
      assert.equal(proposalNow(f, p.proposalId).status, "COMPLETED");
      assert.equal(journalPhases(f).length, 1, "one execution journal");
      return { attempts: 1, successful: 1, commits: 1, reservations: 1, secondSawStatus, secondAttempts: 0 };
    });
  }

  await scenario("H05f", "SAME EXECUTE interleaved: the replay starts inside the first click's pre-reservation window and is refused; one publication", async () => {
    const f = makeFixture();
    const p = seedProposal(f, "smoke-fixture-h05f");
    await ownerApproveHistorically(f, p);
    const execute = await admitExecute(p);
    const base = git(f.repoRoot, "rev-parse", "HEAD");
    let racer: Promise<readonly AyasOwnerApprovalResumeAttempt[]> | undefined;
    const onJournalPhase = (phase: AyasExecutionJournalPhase) => { if (phase === "APPROVED_NOT_STARTED" && !racer) racer = manualResume(f, execute); };
    const firstAttempts = await manualResume(f, execute, { onJournalPhase });
    assert.ok(racer, "the replay was started inside the window");
    const secondAttempts = await racer;
    assert.equal(firstAttempts.length, 1);
    assert.equal(firstAttempts[0]!.outcome.ok, true, JSON.stringify(firstAttempts[0]!.outcome));
    assert.equal(secondAttempts.length, 1, "the replay passed the eligibility filter (actionRef not yet recorded), so it really reached the service");
    const refused = failure(secondAttempts[0]);
    // The publication lock refuses an in-flight duplicate first; the actionRef check is the next layer (K3a/K3b).
    assert.ok(["AYAS_PROPOSAL_STABILITY_GUARD_REFUSED", "OWNER_ADMISSION_REQUIRED"].includes(refused.code), `refused by a known protection: ${refused.code} ${refused.stage}`);
    assert.equal(commitsSince(f, base), 1, "exactly one commit");
    assert.equal(git(f.remoteDir, "rev-parse", "master"), git(f.repoRoot, "rev-parse", "HEAD"));
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.equal(f.inbox.load().decisions.filter((d) => d.proposalId === p.proposalId && d.reservationId).length, 1, "exactly one reservation");
    assert.equal(recordedActionRefs(f).filter((ref) => ref === execute.actionRef).length, 1, "the action is recorded once");
    return { firstOk: true, replayCode: refused.code, replayStage: refused.stage, commits: 1, reservations: 1 };
  });

  // --- H07: two approved proposals at one baseHead ---

  await scenario("H07", "EXECUTE for A publishes only A; B stays APPROVED and byte-identical; B's own EXECUTE is exactly one STALE_APPROVAL attempt", async () => {
    const f = makeFixture();
    const a = seedProposal(f, "smoke-fixture-h07a");
    const b = seedProposal(f, "smoke-fixture-h07b");
    await ownerApproveHistorically(f, a);
    await ownerApproveHistorically(f, b);
    const bRecord = () => JSON.stringify({ proposal: proposalNow(f, b.proposalId), decisions: f.inbox.load().decisions.filter((d) => d.proposalId === b.proposalId) });
    const bBefore = bRecord();
    const base = git(f.repoRoot, "rev-parse", "HEAD");
    const attempts = await manualResume(f, await admitExecute(a));
    assert.deepEqual(attempts.map((x) => x.proposalId), [a.proposalId]);
    assert.equal(attempts[0]!.outcome.ok, true, JSON.stringify(attempts[0]!.outcome));
    assert.equal(commitsSince(f, base), 1);
    assert.equal(proposalNow(f, b.proposalId).status, "APPROVED", "B is not reconciled by A's publication");
    assert.equal(bRecord(), bBefore, "B's proposal and decisions are byte-identical after A");
    assert.equal(git(f.remoteDir, "ls-tree", "-r", "--name-only", "master").split("\n").includes("scripts/smoke-fixture-h07b.ts"), false);
    const before = snapshot(f);
    const bAttempts = await manualResume(f, await admitExecute(b));
    assert.equal(bAttempts.length, 1, "B's own action is attempted exactly once");
    assert.equal(bAttempts[0]!.proposalId, b.proposalId);
    assert.equal(failure(bAttempts[0]).code, "STALE_APPROVAL");
    const after = snapshot(f);
    assert.deepEqual({ head: after.head, remote: after.remote, status: after.status, journal: after.journal }, { head: before.head, remote: before.remote, status: before.status, journal: before.journal });
    assert.equal(proposalNow(f, b.proposalId).status, "STALE");
    assert.equal(approveDecision(f, b.proposalId).reservationId, undefined, "B was never reserved");
    return { bStatusAfterA: "APPROVED", bByteIdenticalAfterA: true, bAttempts: 1, bCode: "STALE_APPROVAL", bFinal: "STALE" };
  });

  // --- H10: authority lapses after reservation ---

  for (const [id, name, lapse] of [
    ["H10a", "the EXECUTE session expires after reservation", "expire"],
    ["H10b", "the sealed APPROVE decision is altered after reservation", "tamper"],
  ] as const) {
    await scenario(id, `${name}: refused for the owner check at EXECUTION, RECOVERY_REQUIRED, and never replayable`, async () => {
      const f = makeFixture();
      const p = seedProposal(f, `smoke-fixture-${id.toLowerCase()}`);
      await ownerApproveHistorically(f, p);
      const execute = await admitExecute(p, lapse === "expire" ? Date.now() - (AYAS_SESSION_TTL_SECONDS - 8) * 1000 : Date.now());
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
      assert.equal(reservedHookRan, true);
      assert.equal(attempts.length, 1);
      const outcome = failure(attempts[0]);
      assert.equal(outcome.code, "OWNER_ADMISSION_REQUIRED", `refused by the owner re-check, not something else: ${outcome.code} ${outcome.message}`);
      assert.equal(outcome.stage, "EXECUTION");
      assert.equal(fs.existsSync(path.join(f.repoRoot, "scripts", `smoke-fixture-${id.toLowerCase()}.ts`)), false, "the mutation callback never wrote the file");
      const after = snapshot(f);
      assert.equal(after.head, before.head); assert.equal(after.remote, before.remote); assert.equal(after.status, before.status);
      assert.deepEqual(journalPhases(f), ["RECOVERY_REQUIRED"], "the journal records the consumed approval for a human");
      assert.equal(proposalNow(f, p.proposalId).status, "RECOVERY_REQUIRED");
      assert.equal(approveDecision(f, p.proposalId).finalizationOutcome, "RECOVERY_REQUIRED");
      // A later fresh EXECUTE cannot replay a RECOVERY_REQUIRED proposal, by resume or by the service.
      const later = await admitExecute(p);
      const frozen = snapshot(f);
      assert.deepEqual(await manualResume(f, later), []);
      await assert.rejects(() => publishAlreadyOwnerApprovedAyasProposal(p.proposalId, p.proposalHash, { ...baseDeps(f), executionOwnerAdmission: later }));
      assert.deepEqual(snapshot(f), frozen, "no replay effect");
      return { code: outcome.code, stage: outcome.stage, journal: "RECOVERY_REQUIRED", finalStatus: "RECOVERY_REQUIRED", laterReplayAttempts: 0, commits: 0, pushes: 0 };
    });
  }

  // --- K3: actionRef replay protection on its own, independent of status transitions ---

  async function recordedElsewhere(label: string) {
    const f = makeFixture();
    const p = seedProposal(f, `smoke-fixture-${label}`);
    await ownerApproveHistorically(f, p);
    const other = seedProposal(f, `smoke-fixture-${label}-other`);
    await ownerApproveHistorically(f, other);
    const execute = await admitExecute(p);
    // The EXECUTE's actionRef already appears on another durable decision while p is still APPROVED.
    const state = f.inbox.load();
    f.inbox.save({ ...state, decisions: state.decisions.map((d) => d.proposalId === other.proposalId && d.decision === "APPROVE" ? { ...d, executionOwnerAdmission: execute } : d) });
    assert.equal(proposalNow(f, p.proposalId).status, "APPROVED", "status alone would allow execution");
    return { f, p, execute };
  }

  await scenario("K3a", "an EXECUTE whose actionRef is already recorded is filtered by the resume eligibility check — zero attempts, zero effect", async () => {
    const { f, p, execute } = await recordedElsewhere("k3a");
    const before = snapshot(f);
    assert.deepEqual(await manualResume(f, execute), []);
    assert.deepEqual(snapshot(f), before);
    const control = await manualResume(f, await admitExecute(p));
    assert.equal(control.length, 1, "control: a fresh, unrecorded EXECUTE for the same proposal is eligible");
    assert.equal(control[0]!.outcome.ok, true, JSON.stringify(control[0]!.outcome));
    return { replayAttempts: 0, controlAttempts: 1 };
  });

  await scenario("K3b", "the same replayed actionRef handed straight to the service (bypassing the resume filter) is refused by the owner check — zero effect", async () => {
    const { f, p, execute } = await recordedElsewhere("k3b");
    const before = snapshot(f);
    const outcome = await publishAlreadyOwnerApprovedAyasProposal(p.proposalId, p.proposalHash, { ...baseDeps(f), executionOwnerAdmission: execute });
    assert.equal(outcome.ok, false);
    assert.equal((outcome as { code: string }).code, "OWNER_ADMISSION_REQUIRED");
    const after = snapshot(f);
    assert.deepEqual({ head: after.head, remote: after.remote, status: after.status, journal: after.journal }, { head: before.head, remote: before.remote, status: before.status, journal: before.journal });
    assert.equal(approveDecision(f, p.proposalId).reservationId, undefined, "refused before reservation");
    return { serviceCode: "OWNER_ADMISSION_REQUIRED", reserved: false };
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-owner-approval-resume-v2-hardening", scenarios: count, notRun: ["cross-process race", "real server restart"], rows }, null, 2));
  console.log(`AYAS owner-approval resume V2 hardening smoke: PASS (${count} scenarios)`);
}

function cleanup(): boolean {
  for (const link of junctions) {
    const target = fs.existsSync(link) ? fs.realpathSync.native(link) : null;
    try { fs.rmdirSync(link); } catch { /* checked below */ }
    let stillThere = true;
    try { fs.lstatSync(link); } catch { stillThere = false; }
    if (stillThere) return false;
    if (target) assert.ok(fs.existsSync(target), `junction target ${target} must survive cleanup`);
  }
  fs.rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 3 });
  return !fs.existsSync(RUN_ROOT);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { if (!cleanup()) console.error(`cleanup incomplete: run root kept at ${RUN_ROOT}`); });
