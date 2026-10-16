import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import { runGuardedAyasPublication } from "../src/lib/brain/autonomy/AyasGuardedPublication";
import { admitAyasOwnerApproval, type AyasOwnerAdmissionAction, type AyasOwnerAdmissionSubject } from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { classifyAyasDependencyUpdateImpact, classifyAyasRuntimeImpact } from "../src/lib/brain/autonomy/AyasProposalRuntimeImpact";
import { createAyasResearchSchedulerStateStore, ayasResearchSchedulerStateSchemaVersion } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasStabilityTransactionStore } from "../src/lib/brain/autonomy/AyasRuntimeStabilityTransaction";
import { createAyasLivePublisher, reconcileAyasUpdateApplyOrphan, runAyasUpdateApply, runAyasUpdateLivePublish } from "../src/lib/brain/autonomy/AyasUpdateApplyRunner";
import {
  AyasUpdateApprovalError, createAyasUpdateApprovalStore, decideAyasUpdateApply, decideAyasUpdateApproval, isAyasUpdateApplyOwnerAdmitted, listAyasUpdateApplyDecisions,
  type AyasUpdateApplyDecisionRecord,
} from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import { ayasUpdateRadarItemHash, type AyasUpdateRadarItem } from "../src/lib/brain/autonomy/AyasUpdateRadar";
import {
  ayasUpdateTrialHash, createAyasUpdateTrialStore, newAyasUpdateTrialId, readAyasCanonicalSyncRequest, type AyasUpdateApplyRecord, type AyasUpdateTrialRecord, type AyasUpdateTrialStore,
} from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

/**
 * "Uygula" for a passed update trial (owner decisions 2026-10-15; CLAUDE.md standing exception). The owner decision is
 * bound to the exact trial; the commit and push go through the real guarded publication's dependency-update lane in a
 * TEMP repository with a bare remote; the live publish and the Graphify closure are stubs. No network, model, real
 * port, live copy or production state.
 */
const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "update-apply-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-update-apply-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try { await fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
};
const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
const sha = (text: string): string => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const admit = (action: AyasOwnerAdmissionAction) => async (subject: AyasOwnerAdmissionSubject) => admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action, subject });

const PACKAGE_JSON = `${JSON.stringify({ name: "fixture", dependencies: { next: "16.4.1" } }, null, 2)}\n`;
const LOCK = `${JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "fixture" }, "node_modules/next": { version: "16.4.1" } } }, null, 2)}\n`;
const NEW_PACKAGE_JSON = PACKAGE_JSON.replace("16.4.1", "16.4.2");
const NEW_LOCK = LOCK.replace("16.4.1", "16.4.2");

let fixtureIndex = 0;
function makeFixture() {
  const base = path.join(temp, `f${fixtureIndex++}`);
  const remoteDir = path.join(base, "remote.git"); const repoRoot = path.join(base, "repo");
  fs.mkdirSync(remoteDir, { recursive: true }); fs.mkdirSync(repoRoot, { recursive: true });
  git(remoteDir, "init", "-q", "--bare");
  git(repoRoot, "init", "-q", "-b", "master");
  git(repoRoot, "config", "user.email", "f@example.com"); git(repoRoot, "config", "user.name", "f"); git(repoRoot, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repoRoot, "package.json"), PACKAGE_JSON); fs.writeFileSync(path.join(repoRoot, "package-lock.json"), LOCK);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n"); fs.writeFileSync(path.join(repoRoot, ".gitignore"), "data/\n");
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir); git(repoRoot, "push", "-q", "-u", "origin", "master");
  const schedulerStore = createAyasResearchSchedulerStateStore({ rootDir: path.join(base, "sched") });
  schedulerStore.write({ schemaVersion: ayasResearchSchedulerStateSchemaVersion, nextLightAt: "2026-10-15T17:00:00.000Z", nextDeepAt: "2026-10-15T18:00:00.000Z", lastSuccessfulResearchAt: "2026-10-15T11:00:00.000Z", consecutiveFailures: 0 });
  const listeners = new Map<number, number>([[3000, 15844]]);
  const guard = {
    store: createAyasStabilityTransactionStore({ rootDir: path.join(base, "tx") }), observedPorts: [3000],
    snapshot: { schedulerStore, env: { NODE_ENV: "test" }, portProbe: (port: number) => listeners.get(port), commandProbe: () => "node fixture-server" },
  };
  const trials = createAyasUpdateTrialStore({ rootDir: path.join(base, "trials") });
  const approvals = createAyasUpdateApprovalStore({ rootDir: path.join(base, "approvals") });
  const closures: string[] = []; const published: string[] = [];
  let liveOutcome: "PUBLISHED" | "ROLLED_BACK" | "FAILED" = "PUBLISHED";
  const deps = {
    repoRoot, gateRoot: path.join(base, "gate"), store: trials, guard,
    postPublicationClosure: (head: string) => { closures.push(head); },
    publishLive: async (commit: string) => { published.push(commit); return { status: liveOutcome, summary: liveOutcome }; },
  };
  return { base, remoteDir, repoRoot, trials, approvals, deps, closures, published, setLive: (status: typeof liveOutcome) => { liveOutcome = status; } };
}

const radarItem = (): AyasUpdateRadarItem => {
  const item = { sourceId: "nextjs", provider: "Vercel", toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", latestVersion: "16.4.2", bump: "PATCH" as const,
    newerStableReleases: 1, latestUrl: "https://example.test", lastSeenAt: "2026-10-15T06:00:00.000Z", applyChannel: "DEVELOPMENT_SESSION" as const, evidence: [],
    brief: { summary: "", affectedFileCount: 0, affectedFiles: [], validation: [], risk: "" } };
  return { ...item, itemHash: ayasUpdateRadarItemHash(item) };
};

/** An admitted approval, and a PASSED trial of it on the fixture's HEAD with stored artifacts. */
async function seedPassedTrial(f: ReturnType<typeof makeFixture>, artifacts = { packageJson: NEW_PACKAGE_JSON, packageLock: NEW_LOCK }): Promise<AyasUpdateTrialRecord> {
  const item = radarItem();
  const approval = await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: item.itemHash, decision: "APPROVE" }, { radar: [item], store: f.approvals, admit: admit("decideAyasUpdateRadar"), safeModeHold: () => undefined });
  const trialId = newAyasUpdateTrialId();
  const tested = { trialId, itemHash: item.itemHash, baseHead: git(f.repoRoot, "rev-parse", "HEAD"), installSpecs: ["next@16.4.2"], packageJsonSha256: sha(artifacts.packageJson), packageLockSha256: sha(artifacts.packageLock) };
  const record: AyasUpdateTrialRecord = {
    schemaVersion: 1, ...tested, approvalDecisionId: approval.decisionId, sourceId: "nextjs", toolName: "Next.js", target: "npm:next", installedVersion: "16.4.1", targetVersion: "16.4.2",
    bump: "PATCH", status: "PASSED", startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    steps: (["WORKTREE", "NPM_CI", "NPM_INSTALL", "LOCK_CHECK", "SIGNATURES", "TYPECHECK", "LINT", "BUILD", "SMOKES"] as const).map((name) => ({ name, ok: true, durationMs: 1, summary: "ok" })),
    trialHash: ayasUpdateTrialHash(tested),
  };
  f.trials.writeArtifacts(trialId, artifacts);
  f.trials.upsert(record);
  return record;
}

async function applyDecision(f: ReturnType<typeof makeFixture>, trial: AyasUpdateTrialRecord): Promise<AyasUpdateApplyDecisionRecord> {
  return decideAyasUpdateApply({ trialId: trial.trialId, trialHash: trial.trialHash! }, { approvals: f.approvals, trials: f.trials, head: git(f.repoRoot, "rev-parse", "HEAD"), admit: admit("applyAyasUpdate"), safeModeHold: () => undefined });
}

const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code);

async function main(): Promise<void> {
  await scenario("the dependency-update lane accepts exactly package.json + package-lock.json; the other lanes still refuse them", () => {
    assert.equal(classifyAyasDependencyUpdateImpact(["package.json", "package-lock.json"]).publishable, true);
    assert.equal(classifyAyasDependencyUpdateImpact(["package-lock.json", "package.json"]).serviceRestartApplicable, false);
    for (const files of [["package.json"], ["package.json", "package-lock.json", "src/a.ts"], ["package.json", "package-lock.json", ".env.local"], ["../package.json", "package-lock.json"], []]) {
      assert.equal(classifyAyasDependencyUpdateImpact(files).publishable, false, JSON.stringify(files));
    }
    assert.equal(classifyAyasRuntimeImpact(["package.json", "package-lock.json"]).publishable, false, "the one-click lanes are unchanged");
    assert.equal(classifyAyasRuntimeImpact(["package.json", "package-lock.json"]).impactClass, "RUNTIME_CONFIG");
  });

  await scenario("the guard refuses a dependency-update publication that declares any other file, before touching anything", async () => {
    const f = makeFixture();
    let ran = false;
    const result = await runGuardedAyasPublication({ lane: "dependency-update", subjectId: "x", exactFiles: ["package.json", "package-lock.json", "src/a.ts"], repoRoot: f.repoRoot, gateRoot: f.deps.gateRoot, guard: f.deps.guard, publish: async () => { ran = true; return { ok: true }; } });
    assert.equal(result.state, "REFUSED"); assert.equal(ran, false);
  });

  await scenario("Uygula is recorded only for a passed, intact trial of the active approval on the current HEAD, once", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const deps = { approvals: f.approvals, trials: f.trials, head, admit: admit("applyAyasUpdate"), safeModeHold: () => undefined };
    await rejects(decideAyasUpdateApply({ trialId: newAyasUpdateTrialId(), trialHash: trial.trialHash! }, deps), "UPDATE_APPLY_TRIAL_NOT_FOUND");
    await rejects(decideAyasUpdateApply({ trialId: trial.trialId, trialHash: "0".repeat(64) }, deps), "UPDATE_APPLY_TRIAL_CHANGED");
    await rejects(decideAyasUpdateApply({ trialId: trial.trialId, trialHash: trial.trialHash! }, { ...deps, head: "f".repeat(40) }), "UPDATE_APPLY_TRIAL_STALE");
    await rejects(decideAyasUpdateApply({ trialId: "../x", trialHash: trial.trialHash! }, deps), "UPDATE_APPROVAL_INVALID_INPUT");
    await rejects(decideAyasUpdateApply({ trialId: trial.trialId, trialHash: trial.trialHash! }, { ...deps, admit: admit("decideAyasUpdateRadar") }), "UPDATE_APPROVAL_ADMISSION_REJECTED");
    await assert.rejects(decideAyasUpdateApply({ trialId: trial.trialId, trialHash: trial.trialHash! }, { ...deps, safeModeHold: () => "AYAS_SAFE_READ_ONLY" }), (error: unknown) => (error as { code?: string }).code === "AYAS_SAFE_READ_ONLY");
    const decision = await applyDecision(f, trial);
    assert.equal(decision.decision, "APPLY"); assert.equal(decision.ownerAdmission.action, "applyAyasUpdate"); assert.ok(isAyasUpdateApplyOwnerAdmitted(decision));
    assert.equal(listAyasUpdateApplyDecisions(f.approvals.load()).length, 1);
    await rejects(applyDecision(f, trial), "UPDATE_APPLY_ALREADY_DECIDED");
    for (const edit of [{ trialHash: "1".repeat(64) }, { trialId: newAyasUpdateTrialId() }, { decidedAt: "2026-01-01T00:00:00.000Z" }]) assert.equal(isAyasUpdateApplyOwnerAdmitted({ ...decision, ...edit }), false, JSON.stringify(edit));
  });

  await scenario("a tampered or not-passed trial, or a withdrawn approval, cannot be applied", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    f.trials.writeArtifacts(trial.trialId, { packageJson: NEW_PACKAGE_JSON, packageLock: NEW_LOCK.replace("16.4.2", "9.9.9") });
    await rejects(applyDecision(f, trial), "UPDATE_APPLY_TRIAL_CHANGED");
    const g = makeFixture();
    const failed = await seedPassedTrial(g);
    g.trials.upsert({ ...failed, status: "FAILED" });
    await rejects(applyDecision(g, failed), "UPDATE_APPLY_TRIAL_NOT_PASSED");
    const h = makeFixture();
    const passed = await seedPassedTrial(h);
    const item = radarItem();
    await decideAyasUpdateApproval({ sourceId: "nextjs", itemHash: item.itemHash, decision: "WITHDRAW" }, { radar: [item], store: h.approvals, admit: admit("decideAyasUpdateRadar"), safeModeHold: () => undefined });
    await rejects(applyDecision(h, passed), "UPDATE_APPLY_APPROVAL_WITHDRAWN");
  });

  await scenario("a completed apply commits exactly the tested bytes of the two files with its trailer, pushes, closes and publishes live", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const decision = await applyDecision(f, trial);
    const done = await runAyasUpdateApply(decision, trial, f.deps);
    assert.equal(done.status, "COMPLETED", JSON.stringify(done.reasons)); assert.equal(done.pushed, true);
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    assert.equal(done.commitSha, head); assert.equal(git(f.remoteDir, "rev-parse", "master"), head, "the remote has the commit");
    assert.deepEqual(git(f.repoRoot, "show", "--name-only", "--format=", "HEAD").split(/\r?\n/).filter(Boolean).sort(), ["package-lock.json", "package.json"]);
    assert.equal(git(f.repoRoot, "show", "HEAD:package.json") + "\n", NEW_PACKAGE_JSON); assert.equal(git(f.repoRoot, "show", "HEAD:package-lock.json") + "\n", NEW_LOCK);
    assert.match(git(f.repoRoot, "log", "-1", "--format=%B"), new RegExp(`AYAS-Update-Trial: ${trial.trialId}`));
    assert.match(git(f.repoRoot, "log", "-1", "--format=%s"), /^chore\(deps\): Next\.js 16\.4\.1 -> 16\.4\.2$/);
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.deepEqual(f.closures, [head]); assert.deepEqual(f.published, [head]);
    assert.equal(done.live?.status, "PUBLISHED"); assert.equal(done.livePending, false); assert.equal(done.closure?.ok, true);
    assert.equal(f.trials.load().applies?.length, 1);
    // The canonical node_modules sync is requested for exactly the committed lock (the observer's wrapper carries it out).
    const sync = readAyasCanonicalSyncRequest(f.trials.rootDir);
    assert.equal(sync?.commitSha, head); assert.equal(sync?.applyId, done.applyId); assert.equal(sync?.packageLockSha256, sha(NEW_LOCK));
    assert.equal(done.reasons, undefined);
  });

  await scenario("HEAD moved since the trial: STALE, nothing committed", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const decision = await applyDecision(f, trial);
    fs.writeFileSync(path.join(f.repoRoot, "README.md"), "moved on\n"); git(f.repoRoot, "commit", "-qam", "moved on");
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const done = await runAyasUpdateApply(decision, trial, f.deps);
    assert.equal(done.status, "STALE"); assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), head); assert.deepEqual(f.published, []);
    assert.equal(readAyasCanonicalSyncRequest(f.trials.rootDir), undefined, "nothing committed, so no node_modules sync");
  });

  await scenario("tampered artifacts: REFUSED; a dirty tree: refused by the guard; nothing changes either way", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const decision = await applyDecision(f, trial);
    f.trials.writeArtifacts(trial.trialId, { packageJson: NEW_PACKAGE_JSON + " ", packageLock: NEW_LOCK });
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    assert.equal((await runAyasUpdateApply(decision, trial, f.deps)).status, "REFUSED");
    const g = makeFixture();
    const trial2 = await seedPassedTrial(g);
    const decision2 = await applyDecision(g, trial2);
    fs.writeFileSync(path.join(g.repoRoot, "README.md"), "dirty\n");
    const refused = await runAyasUpdateApply(decision2, trial2, g.deps);
    assert.equal(refused.status, "REFUSED", JSON.stringify(refused.reasons));
    assert.equal(fs.readFileSync(path.join(g.repoRoot, "package.json"), "utf8"), PACKAGE_JSON, "the package files were not written");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), head);
  });

  await scenario("a push failure after the commit is never reset: RECOVERY_REQUIRED with the local commit named", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const decision = await applyDecision(f, trial);
    git(f.repoRoot, "remote", "set-url", "origin", path.join(f.base, "missing-remote.git"));
    const done = await runAyasUpdateApply(decision, trial, f.deps);
    assert.ok(done.status === "RECOVERY_REQUIRED" || done.status === "FAILED", done.status);
    assert.equal(done.commitSha, git(f.repoRoot, "rev-parse", "HEAD"), "the commit stays for a human");
    assert.match(done.reasons!.join(" "), /PUSH/); assert.deepEqual(f.published, []);
  });

  await scenario("a live publish rolled back by its health check stays pending and is published again, bounded", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const decision = await applyDecision(f, trial);
    f.setLive("ROLLED_BACK");
    const first = await runAyasUpdateApply(decision, trial, f.deps);
    assert.equal(first.status, "COMPLETED"); assert.equal(first.live?.status, "ROLLED_BACK"); assert.equal(first.livePending, true); assert.equal(first.live?.attempts, 1);
    f.setLive("PUBLISHED");
    const second = await runAyasUpdateLivePublish(first, f.deps);
    assert.equal(second.live?.status, "PUBLISHED"); assert.equal(second.livePending, false); assert.equal(second.live?.attempts, 2);
  });

  await scenario("an interrupted apply is reconciled: untouched -> ABANDONED, pushed with its trailer -> COMPLETED, else RECOVERY_REQUIRED", async () => {
    const f = makeFixture();
    const trial = await seedPassedTrial(f);
    const running = (over: Partial<AyasUpdateApplyRecord> = {}): AyasUpdateApplyRecord => ({ schemaVersion: 1, applyId: `run-${crypto.randomUUID()}`, applyDecisionId: "d", trialId: trial.trialId, sourceId: "nextjs", toolName: "Next.js",
      installedVersion: "16.4.1", targetVersion: "16.4.2", baseHead: git(f.repoRoot, "rev-parse", "HEAD"), status: "RUNNING", startedAt: new Date().toISOString(), ...over });
    assert.equal(reconcileAyasUpdateApplyOrphan(running(), { repoRoot: f.repoRoot, store: f.trials }).status, "ABANDONED");
    assert.equal(readAyasCanonicalSyncRequest(f.trials.rootDir), undefined);
    const before = running();
    fs.writeFileSync(path.join(f.repoRoot, "package.json"), NEW_PACKAGE_JSON); fs.writeFileSync(path.join(f.repoRoot, "package-lock.json"), NEW_LOCK);
    git(f.repoRoot, "commit", "-qam", "chore(deps): x", "-m", `AYAS-Update-Trial: ${trial.trialId}`); git(f.repoRoot, "push", "-q", "origin", "master");
    const recovered = reconcileAyasUpdateApplyOrphan(before, { repoRoot: f.repoRoot, store: f.trials });
    assert.equal(recovered.status, "COMPLETED"); assert.equal(recovered.livePending, true); assert.equal(recovered.commitSha, git(f.repoRoot, "rev-parse", "HEAD"));
    assert.equal(readAyasCanonicalSyncRequest(f.trials.rootDir)?.commitSha, recovered.commitSha, "a recovered commit still asks for the node_modules sync");
    fs.writeFileSync(path.join(f.repoRoot, "README.md"), "unknown\n"); git(f.repoRoot, "commit", "-qam", "someone else");
    assert.equal(reconcileAyasUpdateApplyOrphan(running({ baseHead: "0".repeat(40) }), { repoRoot: f.repoRoot, store: f.trials }).status, "RECOVERY_REQUIRED");
  });

  await scenario("the live publisher reads the publish script's own outcome lines", async () => {
    const outputs: Record<string, { code: number; output: string }> = {
      ok: { code: 0, output: "[BILGI] Mod: UYGULA\n[TAMAM] Yayinda: D:\\x\\ayas-live-abc (PID 1, dis erisim: healthy)\n" },
      same: { code: 0, output: "[TAMAM] Bu commit zaten canlida.\n" },
      rolled: { code: 1, output: "[SORUN] Yeni snapshot 240 sn icinde saglikli olmadi; geri donuluyor.\n[TAMAM] Onceki surum yeniden yayinda: D:\\x\n" },
      busy: { code: 1, output: "[SORUN] Canli uygulamada calisan alt is var\n" },
    };
    for (const [name, expected] of [["ok", "PUBLISHED"], ["same", "PUBLISHED"], ["rolled", "ROLLED_BACK"], ["busy", "FAILED"]] as const) {
      let args: readonly string[] = [];
      const publish = createAyasLivePublisher("D:\\repo", async (command, given) => { args = given; void command; return { ...outputs[name]!, durationMs: 1, timedOut: false }; }, {});
      assert.equal((await publish("a".repeat(40))).status, expected, name);
      assert.deepEqual(args.slice(-3), ["-Commit", "a".repeat(40), "-Apply"]);
    }
  });

  void (null as unknown as AyasUpdateTrialStore);
  assert.ok(new AyasUpdateApprovalError("UPDATE_APPLY_TRIAL_STALE").message === "UPDATE_APPLY_TRIAL_STALE");
}

main().then(() => {
  fs.rmSync(temp, { recursive: true, force: true });
  if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey;
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-update-apply", scenarios: count, modelRuns: 0, networkCalls: 0 }));
}, (error: unknown) => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
  console.error(error);
  process.exit(1);
});
