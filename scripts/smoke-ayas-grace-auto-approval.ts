/**
 * Grace auto-approval (owner instruction 2026-11-19: "5 dakika orada onayda beklesin, ben onay vermezsem bile kendisi
 * işleme alsın ve onaylasın"). Proves, on TEMP stores only (no network, no live app, no canonical checkout):
 *   - nothing is approved before the full wait; at the wait the SAME service is called with the same id + hash;
 *   - an owner decision or hold inside the wait stops it; a changed hash (drift) waits again from the start;
 *   - excluded kinds (REVIEW_REQUIRED, approval machinery, homepage, eval pins, restart/config, new vulnerabilities)
 *     are never approved; AYAS_GRACE_AUTO_APPROVE=0 turns it off; at most one item per tick;
 *   - the standing-grace admission is told apart from an owner click (own auth method, own seal domain, ready time
 *     and elapsed wait on record) and is accepted only for the four one-click actions, by the same strict stores.
 *
 *   npx tsx scripts/smoke-ayas-grace-auto-approval.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import type { AyasApprovalInboxHandle, AyasInboxProposal } from "../src/lib/brain/autonomy/AyasApprovalInboxStore";
import { ayasCodeBuildHash, type AyasCodeBuild } from "../src/lib/brain/autonomy/AyasCodeChangeLane";
import { createAyasCodeChangeStore, listAyasCodeApplyDecisions, selectAyasCodeApplyJob } from "../src/lib/brain/autonomy/AyasCodeChangeStore";
import {
  AYAS_GRACE_DEFAULT_MS, ayasGraceFileExclusions, ayasGraceKey, buildAyasGraceView, createAyasGraceStore, emptyAyasGraceState, planAyasGraceTick, resolveAyasGracePolicy,
  sealAyasGraceReady, type AyasGraceCandidate, type AyasGraceState,
} from "../src/lib/brain/autonomy/AyasGraceAutoApproval";
import { runAyasGraceAutoApprovalTick, type AyasGraceRunnerDeps } from "../src/lib/brain/autonomy/AyasGraceAutoApprovalRunner";
import { createAyasMicroBatchStore, type AyasMicroBatchStoreHandle } from "../src/lib/brain/autonomy/AyasMicroBatch";
import {
  AYAS_OWNER_ADMISSION_AUTH_METHOD, AYAS_OWNER_GRACE_AUTH_METHOD, admitAyasOwnerApproval, checkAyasOwnerAdmissionBinding, isAyasOwnerAdmissionActionCompatible,
  isAyasOwnerAdmissionShape, isAyasOwnerGraceAdmission, mintAyasOwnerGraceAdmission, verifyAyasOwnerAdmissionSealSync, type AyasOwnerAdmissionSubject,
} from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import type { AyasOwnerPublicationRequest } from "../src/lib/brain/autonomy/AyasOwnerPublicationWorker";
import { createAyasUpdateApprovalStore, decideAyasUpdateApproval, listAyasUpdateApplyDecisions } from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import { ayasUpdateRadarItemHash, type AyasUpdateRadarItem } from "../src/lib/brain/autonomy/AyasUpdateRadar";
import { ayasUpdateTrialHash, createAyasUpdateTrialStore, newAyasUpdateTrialId, type AyasUpdateTrialRecord } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "grace-auto-approval-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-grace-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try { await fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
};
const rejectsCode = (fn: () => unknown, code: string) => assert.throws(fn, (error: unknown) => (error as { code?: string }).code === code);

const GRACE = AYAS_GRACE_DEFAULT_MS;
const T0 = Date.parse("2026-11-19T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const HEAD = "a".repeat(40);
const sealReady = (subject: AyasGraceCandidate["subject"], readyAt: string) => sealAyasGraceReady(KEY, subject, readyAt);
const policy = { enabled: true, graceMs: GRACE };
const candidate = (id: string, hash: string, extra: Partial<AyasGraceCandidate> = {}): AyasGraceCandidate =>
  ({ subject: { kind: "proposal", id, hash }, title: id, exclusions: [], v3: false, ...extra });
const plan = (state: AyasGraceState, nowMs: number, candidates: readonly AyasGraceCandidate[], extra: Partial<Parameters<typeof planAyasGraceTick>[0]> = {}) =>
  planAyasGraceTick({ policy, now: iso(nowMs), state, holds: [], candidates, sealReady, v3Busy: false, publicationActive: false, ...extra });

let dirIndex = 0;
const freshDir = (name: string) => { const dir = path.join(temp, `${name}-${dirIndex++}`); fs.mkdirSync(dir, { recursive: true }); return dir; };

const EXPLAINED = {
  currentProblem: "p", selectionReason: "s", expectedUserBenefit: "b", expectedBehaviorChange: "c", unchangedBehavior: "u", riskIfNotDone: "r", technicalRisk: "t", productionImpact: "none",
};
function proposal(id: string, extra: Partial<AyasInboxProposal> = {}): AyasInboxProposal {
  return {
    schemaVersion: 1, proposalId: id, createdAt: iso(T0), lastUpdatedAt: iso(T0), baseBranch: "main", baseHead: HEAD, objective: `Hedef ${id}`, ...EXPLAINED,
    rationale: "r", evidence: ["e"], graphifyEvidence: ["g"], candidateRank: 1, risk: "low", safetyClassification: "SAFE", exactFiles: ["scripts/smoke-ayas-error-code-sample.ts"],
    expectedDiffScope: "one new smoke", testsPlanned: ["npx tsx scripts/smoke-ayas-error-code-sample.ts"], estimatedCost: "zero-cost", proposalHash: `hash-${id}-1`,
    status: "PENDING", createdBy: "ayas-daemon", mutationKind: "patch-artifact:v1", patchArtifactId: `artifact-${id}`, patchHash: "ph", ...extra,
  } as AyasInboxProposal;
}
function fakeInbox(proposals: AyasInboxProposal[], decisions: { proposalId: string; proposalHash: string; decision: string; decidedAt: string; reason?: string }[] = []): AyasApprovalInboxHandle & { proposals: AyasInboxProposal[] } {
  const handle = { proposals, load: () => ({ schemaVersion: 1, revision: 0, proposals: handle.proposals, decisions, results: [] }) };
  return handle as unknown as AyasApprovalInboxHandle & { proposals: AyasInboxProposal[] };
}
const emptyBatches = { load: () => ({ schemaVersion: 1, revision: 0, batches: [], decisions: [], results: [] }) } as unknown as AyasMicroBatchStoreHandle;

/** Runner deps on TEMP stores with a controllable clock and a recording publish seam. */
function runnerFixture(input: { proposals?: AyasInboxProposal[]; builds?: Map<string, AyasCodeBuild>; env?: Record<string, string>; batchStore?: AyasMicroBatchStoreHandle } = {}) {
  const dir = freshDir("runner");
  let nowMs = T0;
  const published: AyasOwnerPublicationRequest[] = [];
  const reports: { jobId: string; reasons: readonly string[] }[] = [];
  const inbox = fakeInbox(input.proposals ?? []);
  const store = createAyasGraceStore({ rootDir: path.join(dir, "grace") });
  const codeStore = createAyasCodeChangeStore({ rootDir: path.join(dir, "code") });
  const deps: AyasGraceRunnerDeps = {
    repoRoot: dir, head: HEAD, key: KEY, env: input.env ?? {}, now: () => new Date(nowMs),
    codeBuilds: async () => input.builds ?? new Map(), reportCode: async (jobId, reasons) => { reports.push({ jobId, reasons }); },
    v3Busy: async () => false, store, inbox, batchStore: input.batchStore ?? emptyBatches, codeStore,
    updateApprovals: createAyasUpdateApprovalStore({ rootDir: path.join(dir, "approvals") }), trials: createAyasUpdateTrialStore({ rootDir: path.join(dir, "trials") }),
    publish: async (request) => { published.push(request); return { ok: true, commitSha: "c".repeat(40), pushed: true, changedFiles: [], graphifyEvidenceItemIds: [] }; },
    publicationActive: () => false,
  };
  return { deps, store, codeStore, inbox, published, reports, at: (ms: number) => { nowMs = ms; } };
}

function codeBuild(jobId: string, files: readonly string[], commitChar = "b"): AyasCodeBuild {
  return {
    jobId, scope: "ayas", title: `Yapı ${jobId}`, branch: `gelistirme/${jobId}`, commit: commitChar.repeat(40), baseHead: HEAD,
    files: files.map((file) => ({ path: file, sha256: crypto.createHash("sha256").update(file).digest("hex") })), checks: ["tsc"], smokes: [],
  };
}

async function main(): Promise<void> {
  await scenario("policy: on by default with a 5-minute wait, =0 turns it off, the wait is clamped and never immediate", () => {
    assert.deepEqual(resolveAyasGracePolicy({}), { enabled: true, graceMs: 300_000 });
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE: "0" }).enabled, false);
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE: "1" }).enabled, true);
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE_MS: "600000" }).graceMs, 600_000);
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE_MS: "10" }).graceMs, 60_000);
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE_MS: "-5" }).graceMs, 300_000);
    assert.equal(resolveAyasGracePolicy({ AYAS_GRACE_AUTO_APPROVE_MS: "beş" }).graceMs, 300_000);
  });

  await scenario("mint: refuses before the wait, for a non one-click action, and below the minimum wait; accepted after it", () => {
    const subject: AyasOwnerAdmissionSubject = { kind: "proposal", proposalId: "p1", proposalHash: "h1", decision: "APPROVE" };
    const readyAt = iso(T0);
    rejectsCode(() => mintAyasOwnerGraceAdmission({ key: KEY, action: "proposalOnaylaVeUygula", subject, readyAt, graceMs: GRACE, now: T0 + GRACE - 1 }), "OWNER_GRACE_NOT_ELAPSED");
    rejectsCode(() => mintAyasOwnerGraceAdmission({ key: KEY, action: "proposalOnaylaVeUygula", subject, readyAt, graceMs: 1_000, now: T0 + GRACE }), "OWNER_GRACE_NOT_ELAPSED");
    for (const action of ["decideAyasApproval", "ayasOwnerApprovalDecision", "executeAyasApprovedProposal", "decideAyasUpdateRadar", "switchAyasModel"] as const) {
      rejectsCode(() => mintAyasOwnerGraceAdmission({ key: KEY, action, subject, readyAt, graceMs: GRACE, now: T0 + GRACE }), "OWNER_ADMISSION_INVALID_SUBJECT");
    }
    rejectsCode(() => mintAyasOwnerGraceAdmission({ key: KEY, action: "decideAyasModelTrial", subject: { kind: "model-trial", tag: "a:b", registryDigest: "0".repeat(64), decision: "APPROVE" }, readyAt, graceMs: GRACE, now: T0 + GRACE }), "OWNER_ADMISSION_INVALID_SUBJECT");
    rejectsCode(() => mintAyasOwnerGraceAdmission({ key: undefined, action: "proposalOnaylaVeUygula", subject, readyAt, graceMs: GRACE, now: T0 + GRACE }), "OWNER_ADMISSION_GATE_UNAVAILABLE");
    const admission = mintAyasOwnerGraceAdmission({ key: KEY, action: "proposalOnaylaVeUygula", subject, readyAt, graceMs: GRACE, now: T0 + GRACE });
    assert.ok(isAyasOwnerAdmissionShape(admission));
    assert.ok(verifyAyasOwnerAdmissionSealSync(admission, KEY));
    assert.ok(isAyasOwnerGraceAdmission(admission));
    assert.equal(admission.sessionIssuedAt, readyAt);
    assert.equal(Date.parse(admission.verifiedAt) - Date.parse(admission.sessionIssuedAt), GRACE);
    assert.deepEqual(checkAyasOwnerAdmissionBinding(admission, { subject, at: iso(T0 + GRACE), usedActionRefs: new Set() }), { ok: true });
    assert.equal(checkAyasOwnerAdmissionBinding(admission, { subject: { ...subject, proposalHash: "h2" }, at: iso(T0 + GRACE), usedActionRefs: new Set() }).ok, false);
    assert.equal(checkAyasOwnerAdmissionBinding(admission, { subject, at: iso(T0 + GRACE), usedActionRefs: new Set([admission.actionRef]) }).ok, false);
  });

  await scenario("provenance: a grace admission is told apart from an owner click and cannot pass as one", async () => {
    const subject: AyasOwnerAdmissionSubject = { kind: "micro-batch", batchId: "b1", batchHash: "bh", decision: "APPROVE" };
    const owner = await admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "batchOnaylaVeUygula", subject });
    const grace = mintAyasOwnerGraceAdmission({ key: KEY, action: "batchOnaylaVeUygula", subject, readyAt: iso(Date.now() - GRACE), graceMs: GRACE });
    assert.equal(owner.authMethod, AYAS_OWNER_ADMISSION_AUTH_METHOD);
    assert.equal(grace.authMethod, AYAS_OWNER_GRACE_AUTH_METHOD);
    assert.equal(isAyasOwnerGraceAdmission(owner), false);
    // Relabelling either one breaks its seal: the two kinds have separate seal domains.
    assert.equal(verifyAyasOwnerAdmissionSealSync({ ...grace, authMethod: AYAS_OWNER_ADMISSION_AUTH_METHOD }, KEY), false);
    assert.equal(verifyAyasOwnerAdmissionSealSync({ ...owner, authMethod: AYAS_OWNER_GRACE_AUTH_METHOD, sessionIssuedAt: iso(Date.parse(owner.verifiedAt) - GRACE) }, KEY), false);
    // A grace admission may stand in for the four one-click actions only.
    assert.equal(isAyasOwnerAdmissionActionCompatible({ ...grace, action: "decideAyasApproval", subject: { kind: "proposal", proposalId: "p", proposalHash: "h", decision: "APPROVE" } }), false);
    assert.equal(isAyasOwnerAdmissionActionCompatible({ ...grace, action: "proposalOnaylaVeUygula", subject: { kind: "proposal", proposalId: "p", proposalHash: "h", decision: "APPROVE" } }), true);
    assert.equal(isAyasOwnerAdmissionActionCompatible({ ...owner, action: "decideAyasApproval", subject: { kind: "proposal", proposalId: "p", proposalHash: "h", decision: "APPROVE" } }), true);
    // A record claiming a grace wait shorter than the minimum is not even well formed.
    assert.equal(isAyasOwnerAdmissionShape({ ...grace, sessionIssuedAt: iso(Date.parse(grace.verifiedAt) - 1_000) }), false);
  });

  await scenario("planner: the wait starts at first sight, nothing before it ends, one item exactly at the end", () => {
    const c = candidate("p1", "h1");
    const first = plan(emptyAyasGraceState(), T0, [c]);
    assert.equal(first.approve, undefined);
    assert.equal(first.state.entries[0]!.status, "WAITING");
    assert.equal(first.state.entries[0]!.readyAt, iso(T0));
    assert.equal(first.nextDueAt, iso(T0 + GRACE));
    assert.equal(plan(first.state, T0 + GRACE - 1, [c]).approve, undefined);
    const due = plan(first.state, T0 + GRACE, [c]);
    assert.equal(due.approve?.candidate.subject.id, "p1");
    assert.equal(due.approve?.elapsedMs, GRACE);
  });

  await scenario("planner: an owner hold, rejection or deferral inside the wait means no automatic approval", () => {
    const c = candidate("p1", "h1");
    const first = plan(emptyAyasGraceState(), T0, [c]);
    const hold = { key: ayasGraceKey(c.subject), kind: c.subject.kind, id: "p1", hash: "h1", heldAt: iso(T0 + 1000) };
    assert.equal(plan(first.state, T0 + 10 * GRACE, [c], { holds: [hold] }).approve, undefined);
    // Rejected/deferred: it is no longer a candidate, so its entry leaves; returning later waits the full time again.
    const left = plan(first.state, T0 + 1000, []);
    assert.equal(left.state.entries[0]!.status, "LEFT");
    const back = plan(left.state, T0 + 2 * GRACE, [c]);
    assert.equal(back.approve, undefined);
    assert.equal(back.state.entries.find((e) => e.key === ayasGraceKey(c.subject))!.readyAt, iso(T0 + 2 * GRACE));
    // A decision recorded on the same item after it became ready restarts the wait.
    const touched = plan(first.state, T0 + GRACE, [{ ...c, touchedAt: iso(T0 + 1000) }]);
    assert.equal(touched.approve, undefined);
    assert.equal(touched.state.entries.find((e) => e.key === ayasGraceKey(c.subject))!.readyAt, iso(T0 + GRACE));
  });

  await scenario("planner: drift (a new hash) is a new item that waits again; an edited ready time is not trusted", () => {
    const first = plan(emptyAyasGraceState(), T0, [candidate("p1", "h1")]);
    const drift = plan(first.state, T0 + GRACE, [candidate("p1", "h2")]);
    assert.equal(drift.approve, undefined);
    assert.equal(drift.state.entries.find((e) => e.hash === "h1")!.status, "LEFT");
    assert.equal(drift.state.entries.find((e) => e.hash === "h2")!.readyAt, iso(T0 + GRACE));
    const forged: AyasGraceState = { ...first.state, entries: first.state.entries.map((e) => ({ ...e, readyAt: iso(T0 - 10 * GRACE) })) };
    const afterForge = plan(forged, T0 + 1000, [candidate("p1", "h1")]);
    assert.equal(afterForge.approve, undefined);
    assert.equal(afterForge.state.entries[0]!.readyAt, iso(T0 + 1000));
  });

  await scenario("planner: excluded items are never approved; off means no countdown and a full wait after turning on", () => {
    const excluded = candidate("p2", "h2", { exclusions: ["güvenlik sınıfı REVIEW_REQUIRED"] });
    const first = plan(emptyAyasGraceState(), T0, [excluded]);
    assert.equal(first.state.entries[0]!.status, "EXCLUDED");
    assert.equal(plan(first.state, T0 + 100 * GRACE, [excluded]).approve, undefined);
    const waiting = plan(emptyAyasGraceState(), T0, [candidate("p1", "h1")]);
    const off = plan(waiting.state, T0 + GRACE, [candidate("p1", "h1")], { policy: { enabled: false, graceMs: GRACE } });
    assert.equal(off.wait, "DISABLED");
    assert.equal(off.approve, undefined);
    assert.equal(off.state.entries[0]!.status, "LEFT");
    const on = plan(off.state, T0 + 2 * GRACE, [candidate("p1", "h1")]);
    assert.equal(on.approve, undefined);
    assert.equal(on.state.entries[0]!.readyAt, iso(T0 + 2 * GRACE));
  });

  await scenario("planner: one item per tick, oldest first; owner chat, a running publication and a busy V3 make it wait", () => {
    const a = candidate("pa", "ha"); const b = candidate("pb", "hb");
    const s1 = plan(emptyAyasGraceState(), T0, [a]);
    const s2 = plan(s1.state, T0 + 1000, [a, b]);
    const due = plan(s2.state, T0 + 3 * GRACE, [a, b]);
    assert.equal(due.approve?.candidate.subject.id, "pa");
    assert.equal(plan(s2.state, T0 + 3 * GRACE, [a, b], { ownerChatAt: iso(T0 + 3 * GRACE - 60_000) }).wait, "OWNER_CHAT");
    assert.equal(plan(s2.state, T0 + 3 * GRACE, [a, b], { ownerChatAt: iso(T0 + 3 * GRACE - 6 * 60_000) }).approve?.candidate.subject.id, "pa");
    assert.equal(plan(s2.state, T0 + 3 * GRACE, [a, b], { publicationActive: true }).wait, "PUBLICATION_ACTIVE");
    const v3 = { ...a, v3: true };
    assert.equal(plan(s2.state, T0 + 3 * GRACE, [v3, b], { v3Busy: true }).approve?.candidate.subject.id, "pb");
    assert.equal(plan(s2.state, T0 + 3 * GRACE, [v3], { v3Busy: true }).wait, "V3_BUSY");
  });

  await scenario("exclusions: approval machinery, homepage, eval pins, packages and restart files always wait for the owner", () => {
    for (const file of ["src/lib/brain/autonomy/AyasCodeChangeLane.ts", "src/components/homepage/AyasHomepage.tsx", "app/page.tsx", "scripts/smoke-ayas-action-firewall-closure.ts",
      "package.json", ".env.local", "CLAUDE.md", "scripts/ayas-update-executor.ts", "app/brain/actions.ts", "src/lib/auth/accessGate.ts", "src/components/brain/AyasDevelopmentCenter.tsx",
      "src/lib/production/ProductionAcceptance.ts", "docs/ayas-execution/x.md", "src/lib/v3/council/DevQueue.ts"]) {
      assert.ok(ayasGraceFileExclusions([file]).length > 0, file);
    }
    assert.deepEqual(ayasGraceFileExclusions(["scripts/smoke-ayas-error-code-sample.ts"]), []);
  });

  await scenario("runner: a proposal is published through the worker's call only after the wait, bound to the same id + hash", async () => {
    const f = runnerFixture({ proposals: [proposal("p1")] });
    f.at(T0); assert.equal((await runAyasGraceAutoApprovalTick(f.deps)).acted, false);
    f.at(T0 + GRACE - 1000); assert.equal((await runAyasGraceAutoApprovalTick(f.deps)).acted, false);
    assert.equal(f.published.length, 0);
    f.at(T0 + GRACE);
    const report = await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(report.acted, true);
    assert.equal(f.published.length, 1);
    const request = f.published[0]! as Extract<AyasOwnerPublicationRequest, { lane: "proposal" }>;
    assert.equal(request.lane, "proposal"); assert.equal(request.proposalId, "p1"); assert.equal(request.proposalHash, "hash-p1-1");
    assert.equal(request.ownerAdmission.action, "proposalOnaylaVeUygula");
    assert.equal(request.executionOwnerAdmission.action, "executeAyasApprovedProposal");
    assert.ok(isAyasOwnerGraceAdmission(request.ownerAdmission) && isAyasOwnerGraceAdmission(request.executionOwnerAdmission));
    assert.equal(checkAyasOwnerAdmissionBinding(request.ownerAdmission, { subject: { kind: "proposal", proposalId: "p1", proposalHash: "hash-p1-1", decision: "APPROVE" }, at: iso(T0 + GRACE), usedActionRefs: new Set() }).ok, true);
    assert.equal(checkAyasOwnerAdmissionBinding(request.executionOwnerAdmission, { subject: { kind: "proposal", proposalId: "p1", proposalHash: "hash-p1-1", decision: "EXECUTE" }, at: iso(T0 + GRACE), usedActionRefs: new Set() }).ok, true);
    const entry = f.store.load().entries.find((e) => e.id === "p1")!;
    assert.equal(entry.status, "APPROVED");
    assert.equal(entry.provenance, `owner-standing-grace: ${GRACE} ms elapsed since ${iso(T0)}`);
    assert.ok(f.store.load().events.some((e) => e.event === "APPROVED" && e.detail?.startsWith("owner-standing-grace:")));
    // Never twice: the same item is not published again.
    f.at(T0 + 3 * GRACE); assert.equal((await runAyasGraceAutoApprovalTick(f.deps)).acted, false);
    assert.equal(f.published.length, 1);
    const view = buildAyasGraceView({ policy, state: f.store.load(), holds: [], now: iso(T0 + 3 * GRACE) });
    assert.equal(view.entries.find((e) => e.id === "p1")!.status, "APPROVED");
  });

  await scenario("runner: owner rejection inside the wait, a hold, REVIEW_REQUIRED and an earlier owner deferral mean no publish", async () => {
    const f = runnerFixture({ proposals: [proposal("p1"), proposal("p2", { safetyClassification: "REVIEW_REQUIRED" })] });
    f.at(T0); await runAyasGraceAutoApprovalTick(f.deps);
    f.inbox.proposals = [{ ...f.inbox.proposals[0]!, status: "REJECTED" }, f.inbox.proposals[1]!];
    f.at(T0 + 10 * GRACE); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(f.published.length, 0);
    assert.equal(f.store.load().entries.find((e) => e.id === "p2")!.status, "EXCLUDED");
    assert.ok(f.store.load().entries.find((e) => e.id === "p2")!.exclusions!.some((line) => line.startsWith("güvenlik sınıfı REVIEW_REQUIRED")));
    const g = runnerFixture({ proposals: [proposal("p3")] });
    g.at(T0); await runAyasGraceAutoApprovalTick(g.deps);
    g.store.hold({ kind: "proposal", id: "p3", hash: "hash-p3-1" }, iso(T0 + 1000));
    g.at(T0 + 10 * GRACE); await runAyasGraceAutoApprovalTick(g.deps);
    assert.equal(g.published.length, 0);
    assert.equal(buildAyasGraceView({ policy, state: g.store.load(), holds: g.store.loadHolds().holds, now: iso(T0) }).entries[0]!.held, true);
    const deferred = runnerFixture({ proposals: [proposal("p4")] });
    (deferred.deps as { inbox: AyasApprovalInboxHandle }).inbox = fakeInbox([proposal("p4")], [{ proposalId: "p4", proposalHash: "hash-p4-1", decision: "LATER", decidedAt: iso(T0 - 1000), reason: "owner" }]);
    deferred.at(T0); await runAyasGraceAutoApprovalTick(deferred.deps);
    deferred.at(T0 + 10 * GRACE); await runAyasGraceAutoApprovalTick(deferred.deps);
    assert.equal(deferred.published.length, 0);
    assert.equal(deferred.store.load().entries[0]!.status, "EXCLUDED");
  });

  await scenario("runner: AYAS_GRACE_AUTO_APPROVE=0 records nothing and approves nothing", async () => {
    const f = runnerFixture({ proposals: [proposal("p1")], env: { AYAS_GRACE_AUTO_APPROVE: "0" } });
    f.at(T0); await runAyasGraceAutoApprovalTick(f.deps);
    f.at(T0 + 10 * GRACE); const report = await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(report.acted, false);
    assert.equal(f.published.length, 0);
    assert.equal(f.store.load().entries.length, 0);
  });

  await scenario("runner: one item per tick; a service refusal is FAILED and never retried; an interrupted run is FAILED", async () => {
    const f = runnerFixture({ proposals: [proposal("p1"), proposal("p2")] });
    f.at(T0); await runAyasGraceAutoApprovalTick(f.deps);
    f.at(T0 + GRACE); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(f.published.length, 1);
    f.at(T0 + GRACE + 1000); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(f.published.length, 2);
    const g = runnerFixture({ proposals: [proposal("p5")] });
    (g.deps as { publish: AyasGraceRunnerDeps["publish"] }).publish = async () => { throw Object.assign(new Error("the proposal changed"), { code: "PROPOSAL_HASH_MISMATCH" }); };
    g.at(T0); await runAyasGraceAutoApprovalTick(g.deps);
    g.at(T0 + GRACE); const failed = await runAyasGraceAutoApprovalTick(g.deps);
    assert.equal(failed.acted && failed.status, "GRACE_FAILED");
    assert.equal(g.store.load().entries[0]!.outcome?.code, "PROPOSAL_HASH_MISMATCH");
    g.at(T0 + 3 * GRACE); assert.equal((await runAyasGraceAutoApprovalTick(g.deps)).acted, false);
    const h = runnerFixture({ proposals: [proposal("p6")] });
    h.at(T0); await runAyasGraceAutoApprovalTick(h.deps);
    const state = h.store.load();
    h.store.save({ ...state, entries: state.entries.map((e) => ({ ...e, status: "APPROVING" as const })) });
    h.at(T0 + 2 * GRACE); await runAyasGraceAutoApprovalTick(h.deps);
    assert.equal(h.store.load().entries[0]!.status, "FAILED");
    assert.equal(h.store.load().entries[0]!.outcome?.code, "GRACE_INTERRUPTED");
    assert.equal(h.published.length, 0);
  });

  await scenario("runner: a micro-batch is published through the worker's call; the strict batch store accepts the grace admissions like a click", async () => {
    const dir = freshDir("batch");
    const batchStore = createAyasMicroBatchStore({ rootDir: dir, requireOwnerAdmission: true });
    const batch = batchStore.createOrVersion({ batchVersion: 1, baseHead: HEAD, baseBranch: "main", items: [{ microItemId: "mi-1", semanticKey: "k1", patchArtifactId: "pa-1", patchHash: "ph-1", exactFiles: ["scripts/smoke-ayas-error-code-sample.ts"] }],
      exactFilesUnion: ["scripts/smoke-ayas-error-code-sample.ts"], validatorUnion: [], worktreeBaseHead: HEAD, createdAt: iso(T0), validationSummary: ["fixture"], aggregateRisk: "low" } as never);
    batchStore.markReadyForReview(batch.batchId, iso(T0));
    const f = runnerFixture({ batchStore });
    const realNow = Date.now();
    f.at(realNow - GRACE); await runAyasGraceAutoApprovalTick(f.deps);
    f.at(realNow); await runAyasGraceAutoApprovalTick(f.deps);
    const request = f.published[0]! as Extract<AyasOwnerPublicationRequest, { lane: "micro-batch" }>;
    assert.equal(request.lane, "micro-batch"); assert.equal(request.batchId, batch.batchId); assert.equal(request.batchHash, batch.batchHash);
    // What the worker's service then does with them: the strict store records the APPROVE and the reservation.
    const decided = batchStore.decide(batch.batchId, "APPROVE", batch.batchHash, iso(realNow), request.ownerAdmission);
    assert.equal(decided.decision.ownerAdmission?.authMethod, AYAS_OWNER_GRACE_AUTH_METHOD);
    const reserved = batchStore.reserveApproval(batch.batchId, batch.batchHash, HEAD, iso(realNow), request.executionOwnerAdmission);
    assert.ok(reserved.reservationId);
    // The batch is decided once: the same item cannot be approved a second time.
    assert.throws(() => batchStore.decide(batch.batchId, "APPROVE", batch.batchHash, iso(realNow), request.ownerAdmission));
  });

  await scenario("runner: a developer build gets the same sealed decision the click records, carried out by the existing CODE_APPLY selection", async () => {
    const build = codeBuild("job-1", ["src/lib/ayas/Greeting.ts"]);
    const hash = ayasCodeBuildHash(build);
    const f = runnerFixture({ builds: new Map([["job-1", build]]) });
    const realNow = Date.now();
    f.at(realNow - GRACE); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(f.codeStore.load().decisions.length, 0);
    f.at(realNow - 1000); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(f.codeStore.load().decisions.length, 0);
    f.at(realNow); const report = await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(report.acted && report.status, "GRACE_APPROVED");
    const decisions = listAyasCodeApplyDecisions(f.codeStore.load());
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]!.buildHash, hash);
    assert.equal(decisions[0]!.ownerAdmission.authMethod, AYAS_OWNER_GRACE_AUTH_METHOD);
    assert.equal(decisions[0]!.ownerAdmission.sessionIssuedAt, iso(realNow - GRACE));
    const job = selectAyasCodeApplyJob({ state: f.codeStore.load(), builds: new Map([["job-1", build]]) });
    assert.equal(job.kind, "APPLY");
    assert.match(f.reports[0]!.reasons[0]!, /^owner-standing-grace: \d+ ms elapsed since /);
    // A build touching the approval machinery is never approved by itself.
    const g = runnerFixture({ builds: new Map([["job-2", codeBuild("job-2", ["src/lib/brain/autonomy/AyasGraceAutoApproval.ts"])]]) });
    g.at(realNow - 10 * GRACE); await runAyasGraceAutoApprovalTick(g.deps);
    g.at(realNow); await runAyasGraceAutoApprovalTick(g.deps);
    assert.equal(g.codeStore.load().decisions.length, 0);
    assert.equal(g.store.load().entries[0]!.status, "EXCLUDED");
  });

  await scenario("runner: a passed update trial on this HEAD gets the same sealed Uygula; one bringing a new vulnerability waits for the owner", async () => {
    const realNow = Date.now();
    const seed = async (f: ReturnType<typeof runnerFixture>, introduced: number) => {
      const item0 = { sourceId: "nextjs", provider: "Vercel", toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", latestVersion: "16.4.2", bump: "PATCH" as const,
        newerStableReleases: 1, latestUrl: "https://example.test", lastSeenAt: iso(T0), applyChannel: "DEVELOPMENT_SESSION" as const, evidence: [],
        brief: { summary: "", affectedFileCount: 0, affectedFiles: [], validation: [], risk: "" } };
      const item: AyasUpdateRadarItem = { ...item0, itemHash: ayasUpdateRadarItemHash(item0) } as AyasUpdateRadarItem;
      const approval = await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: item.itemHash, decision: "APPROVE" }, {
        radar: [item], store: f.deps.updateApprovals!, safeModeHold: () => undefined,
        admit: async (subject) => admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "decideAyasUpdateRadar", subject }),
      });
      const artifacts = { packageJson: "{\"n\":2}\n", packageLock: "{\"l\":2}\n" };
      const sha = (t: string) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
      const trialId = newAyasUpdateTrialId();
      const tested = { trialId, itemHash: item.itemHash, baseHead: HEAD, installSpecs: ["next@16.4.2"], packageJsonSha256: sha(artifacts.packageJson), packageLockSha256: sha(artifacts.packageLock) };
      const record: AyasUpdateTrialRecord = {
        schemaVersion: 1, ...tested, approvalDecisionId: approval.decisionId, sourceId: "nextjs", toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", targetVersion: "16.4.2",
        bump: "PATCH", status: "PASSED", startedAt: iso(T0), finishedAt: iso(T0), trialHash: ayasUpdateTrialHash(tested),
        steps: (["WORKTREE", "NPM_CI", "NPM_INSTALL", "LOCK_CHECK", "SIGNATURES", "TYPECHECK", "LINT", "BUILD", "SMOKES"] as const).map((name) => ({ name, ok: true, durationMs: 1, summary: "ok" })),
        ...(introduced ? { vulnerabilities: { before: 0, after: introduced, introduced: Array.from({ length: introduced }, (_, i) => ({ id: `GHSA-${i}`, packageName: "x", version: "1" })) as never } } : {}),
      };
      f.deps.trials!.writeArtifacts(trialId, artifacts); f.deps.trials!.upsert(record);
      return record;
    };
    const f = runnerFixture();
    const trial = await seed(f, 0);
    f.at(realNow - GRACE); await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(listAyasUpdateApplyDecisions(f.deps.updateApprovals!.load()).length, 0);
    f.at(realNow); const report = await runAyasGraceAutoApprovalTick(f.deps);
    assert.equal(report.acted && report.status, "GRACE_APPROVED", JSON.stringify(report));
    const decisions = listAyasUpdateApplyDecisions(f.deps.updateApprovals!.load());
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]!.trialId, trial.trialId); assert.equal(decisions[0]!.trialHash, trial.trialHash);
    assert.ok(isAyasOwnerGraceAdmission(decisions[0]!.ownerAdmission));
    const g = runnerFixture();
    await seed(g, 1);
    g.at(realNow - 10 * GRACE); await runAyasGraceAutoApprovalTick(g.deps);
    g.at(realNow); await runAyasGraceAutoApprovalTick(g.deps);
    assert.equal(listAyasUpdateApplyDecisions(g.deps.updateApprovals!.load()).length, 0);
    assert.equal(g.store.load().entries[0]!.status, "EXCLUDED");
  });

  await scenario("wiring: only the executor's runner mints a grace admission; the owner's server actions cannot", () => {
    const repo = process.cwd();
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const item of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
        if (item.name === "node_modules" || item.name.startsWith(".")) continue;
        const rel = `${dir}/${item.name}`;
        if (item.isDirectory()) walk(rel);
        else if (/\.(?:ts|tsx)$/.test(item.name) && fs.readFileSync(path.join(repo, rel), "utf8").includes("mintAyasOwnerGraceAdmission(")) callers.push(rel);
      }
    };
    for (const dir of ["src", "app", "scripts"]) walk(dir);
    assert.deepEqual(callers.sort(), ["scripts/smoke-ayas-grace-auto-approval.ts", "src/lib/brain/autonomy/AyasGraceAutoApprovalRunner.ts", "src/lib/brain/autonomy/AyasOwnerApprovalAdmission.ts"]);
    const actions = fs.readFileSync(path.join(repo, "app", "brain", "actions.ts"), "utf8");
    assert.ok(!actions.includes("AyasGraceAutoApprovalRunner") && !actions.includes("mintAyasOwnerGraceAdmission"));
    const executor = fs.readFileSync(path.join(repo, "scripts", "ayas-update-executor.ts"), "utf8");
    assert.match(executor, /runAyasGraceAutoApprovalTick\(/);
    // A grace-approved update's live publish waits for the owner's batched go-live.
    assert.match(executor, /AYAS_AUTO_LIVE_PUBLISH === "0" && graceDecisionIds\.has\(apply\.applyDecisionId\)/);
  });
}

main()
  .then(() => { console.log(`AYAS grace auto-approval smoke: PASS (${count} scenarios)`); })
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey;
    fs.rmSync(temp, { recursive: true, force: true });
  });
