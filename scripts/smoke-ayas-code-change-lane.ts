import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { issueSession, resolveAccessGate } from "../src/lib/auth/accessGate";
import {
  isAyasCodeApplyPushPending, reconcileAyasCodeApplyOrphan, recoverAyasCodeApplyPushes, reverifyAyasCodeBuild, runAyasCodeChangeApply,
} from "../src/lib/brain/autonomy/AyasCodeChangeApplyRunner";
import { ayasCodeBuildHash, ayasCodeContentSha256, ayasCodeJobTrailer, ayasCodeLaneRefusals, type AyasCodeBuild } from "../src/lib/brain/autonomy/AyasCodeChangeLane";
import {
  AYAS_CODE_APPLY_MAX_ABANDONED, ayasCodeBuildDecisionOpen, createAyasCodeChangeStore, decideAyasCodeChangeApply, listAyasCodeApplyDecisions, selectAyasCodeApplyJob,
  type AyasCodeApplyDecisionRecord, type AyasCodeChangeStore,
} from "../src/lib/brain/autonomy/AyasCodeChangeStore";
import {
  admitAyasOwnerApproval, checkAyasOwnerExecutionAdmission, isAyasOwnerAdmissionActionCompatible, type AyasOwnerAdmissionAction, type AyasOwnerAdmissionSubject,
} from "../src/lib/brain/autonomy/AyasOwnerApprovalAdmission";
import { classifyAyasCodeChangeImpact, classifyAyasRuntimeImpact } from "../src/lib/brain/autonomy/AyasProposalRuntimeImpact";
import { createAyasResearchSchedulerStateStore, ayasResearchSchedulerStateSchemaVersion } from "../src/lib/brain/autonomy/AyasResearchSchedulerStateStore";
import { createAyasStabilityTransactionStore } from "../src/lib/brain/autonomy/AyasRuntimeStabilityTransaction";

/**
 * The code lane (owner decision 2026-11-09: "ayas tamamen otomatik çalışacak, benim onay uygula diye tıklama ile onay
 * alıp yapacak"; CLAUDE.md standing exception for "ONAYLA VE UYGULA" on a developer build). Which files a model-written
 * change may touch, the build identity the click binds to, the sealed decision, and the executor's apply through the
 * real guarded publication's code-change lane in a TEMP repository with a bare remote. The Graphify closure and the
 * re-verification are stubs except in the one scenario that runs the real re-verification on a fixture with stub tools.
 * No network, model, real port, live copy or production state.
 */
const originalKey = process.env.AYAS_ACCESS_KEY;
const KEY = "code-change-lane-smoke-key-long-enough";
process.env.AYAS_ACCESS_KEY = KEY;
const gate = resolveAccessGate({ AYAS_ACCESS_KEY: KEY, NODE_ENV: "production" });
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ayas-code-lane-"));
let count = 0;
const scenario = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  try { await fn(); } catch (error) { console.error(`FAIL: ${name}`); throw error; }
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
};
const git = (cwd: string, ...args: string[]): string => execFileSync("git", ["-c", "user.email=f@example.com", "-c", "user.name=f", ...args], { cwd, encoding: "utf8", windowsHide: true }).trim();
const admit = (action: AyasOwnerAdmissionAction) => async (subject: AyasOwnerAdmissionSubject) => admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action, subject });
const rejects = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => (error as { code?: string }).code === code);

let fixtureIndex = 0;
/** A repository with a bare remote, the guard's isolated stores and a code-change store. */
function makeFixture() {
  const base = path.join(temp, `f${fixtureIndex++}`);
  const remoteDir = path.join(base, "remote.git"); const repoRoot = path.join(base, "repo");
  fs.mkdirSync(remoteDir, { recursive: true }); fs.mkdirSync(path.join(repoRoot, "src", "lib", "ayas"), { recursive: true });
  git(remoteDir, "init", "-q", "--bare");
  git(repoRoot, "init", "-q", "-b", "master");
  git(repoRoot, "config", "core.autocrlf", "false");
  fs.writeFileSync(path.join(repoRoot, "src", "lib", "ayas", "Greeting.ts"), "export const greeting = \"merhaba\";\n");
  fs.writeFileSync(path.join(repoRoot, "src", "lib", "ayas", "Other.ts"), "export const other = 1;\n");
  fs.writeFileSync(path.join(repoRoot, "README.md"), "fixture\n"); fs.writeFileSync(path.join(repoRoot, ".gitignore"), "data/\nnode_modules/\n");
  git(repoRoot, "add", "-A"); git(repoRoot, "commit", "-q", "-m", "initial");
  git(repoRoot, "remote", "add", "origin", remoteDir); git(repoRoot, "push", "-q", "-u", "origin", "master");
  const schedulerStore = createAyasResearchSchedulerStateStore({ rootDir: path.join(base, "sched") });
  schedulerStore.write({ schemaVersion: ayasResearchSchedulerStateSchemaVersion, nextLightAt: "2026-11-09T17:00:00.000Z", nextDeepAt: "2026-11-09T18:00:00.000Z", lastSuccessfulResearchAt: "2026-11-09T11:00:00.000Z", consecutiveFailures: 0 });
  const listeners = new Map<number, number>([[3000, 15844]]);
  const guard = {
    store: createAyasStabilityTransactionStore({ rootDir: path.join(base, "tx") }), observedPorts: [3000],
    snapshot: { schedulerStore, env: { NODE_ENV: "test" }, portProbe: (port: number) => listeners.get(port), commandProbe: () => "node fixture-server" },
  };
  const store = createAyasCodeChangeStore({ rootDir: path.join(base, "code-changes") });
  const closures: string[] = []; const reports: { jobId: string; status: string }[] = [];
  let reverifyOk = true; const reverified: string[] = [];
  const deps = {
    repoRoot, gateRoot: path.join(base, "gate"), store, guard,
    postPublicationClosure: (head: string) => { closures.push(head); },
    reverify: async (head: string) => { reverified.push(head); return { ok: reverifyOk, summary: reverifyOk ? "ok" : "tsc --noEmit: TS2304" }; },
    report: async (jobId: string, outcome: { status: string }) => { reports.push({ jobId, status: outcome.status }); },
  };
  return { base, remoteDir, repoRoot, store, deps, closures, reports, reverified, setReverify: (ok: boolean) => { reverifyOk = ok; } };
}

/** A developer build on its own branch, made the way Developer.develop makes one (job trailer, recorded identity). */
function makeBuild(f: { repoRoot: string }, jobId: string, changes: Readonly<Record<string, string | null>>, smokes: readonly string[] = []): AyasCodeBuild {
  const baseHead = git(f.repoRoot, "rev-parse", "HEAD");
  const branch = `gelistirme/${jobId}`;
  const wt = path.join(path.dirname(f.repoRoot), `wt-${jobId}`);
  git(f.repoRoot, "worktree", "add", "-q", "-b", branch, wt, "HEAD");
  for (const [file, content] of Object.entries(changes)) {
    const target = path.join(wt, ...file.split("/"));
    if (content === null) fs.rmSync(target);
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  }
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", `feat(ayas): ${jobId}`, "-m", "AYAS geliştiricisi (Claude).", "-m", ayasCodeJobTrailer(jobId));
  const commit = git(wt, "rev-parse", "HEAD");
  git(f.repoRoot, "worktree", "remove", "--force", wt);
  const files = Object.keys(changes).sort().map((file) => {
    let bytes: Buffer | undefined;
    try { bytes = execFileSync("git", ["show", `${commit}:${file}`], { cwd: f.repoRoot, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }); } catch { bytes = undefined; }
    return { path: file, sha256: bytes ? ayasCodeContentSha256(bytes) : null };
  });
  return { jobId, scope: "ayas", title: `İş ${jobId}`, branch, commit, baseHead, files, checks: ["node_modules/typescript/bin/tsc --noEmit", ...smokes], smokes };
}

async function decide(store: AyasCodeChangeStore, build: AyasCodeBuild): Promise<AyasCodeApplyDecisionRecord> {
  return decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: ayasCodeBuildHash(build) }, { store, build: async () => build, admit: admit("applyAyasCodeChange"), safeModeHold: () => undefined });
}

async function main(): Promise<void> {
  await scenario("the code lane allows the source areas and refuses the homepage, the authority machinery, the yardstick, packages and the production layers", () => {
    const allowed = ["src/lib/ayas/AyasChatStream.ts", "app/brain/actions.ts", "app/api/ayas/chat/stream/route.ts", "src/components/brain/AtolyeBrainsPanel.tsx",
      "scripts/smoke-ayas-new-feature.ts", "docs/AYAS_NEW.md", "content/v3/kanal-hedefleri.json", "remotion-v3/src/Episode.tsx", "src/lib/v3/maps/MapView.ts", "src/lib/brain/ui/BrainConsoleSnapshot.ts"];
    assert.deepEqual(ayasCodeLaneRefusals(allowed), [], JSON.stringify(ayasCodeLaneRefusals(allowed)));
    const refused = ["src/components/homepage/AyasHomepage.tsx", "app/page.tsx", "app/layout.tsx", "src/components/brain/BrainConsoleView.tsx", "src/lib/v3/council/BrainCouncilFeed.ts",
      "src/lib/brain/autonomy/AyasCodeChangeLane.ts", "src/lib/brain/autonomy/AyasGuardedPublication.ts", "src/lib/brain/autonomy/AyasOwnerApprovalAdmission.ts",
      "src/lib/brain/selfheal/BrainPatchSafety.ts", "src/lib/brain/security/X.ts", "src/lib/ayas/execution/AyasExecutionPolicy.ts", "src/lib/ayas/governance/X.ts", "src/lib/ayas/safety/X.ts",
      "scripts/ayas-update-executor.ts", "scripts/ayas-publish-live.ps1", "scripts/lint-yerel.mjs", "scripts/smoke-ayas-guarded-publication.ts", "scripts/lib/AyasGoldenVaultFiles.ts",
      "src/lib/v3/council/Developer.ts", "src/lib/v3/council/DevQueue.ts", "src/lib/v3/council/SelfImprovement.ts", "scripts/v3/yapim.ts", "scripts/v3/gelistirici.ts",
      "src/lib/production/X.ts", "src/lib/pipeline/PipelineRunner.ts", "src/lib/runtime/RuntimeStoragePaths.ts", "src/lib/storage/FileStorage.ts",
      "package.json", "package-lock.json", "remotion-v3/package.json", ".env.local", ".gitignore", "AGENTS.md", "CLAUDE.md", ".claude/skills/ayas-gelistirici/SKILL.md",
      "docs/ayas-execution/2026-09-27-master/x.md", "data/brain/x.json", "middleware.ts", "next.config.ts", "../escape.ts", "C:/x.ts", "src//double.ts", "src/../x.ts"];
    const reasons = ayasCodeLaneRefusals(refused);
    assert.deepEqual(reasons.map((r) => r.file.replace(/\\/g, "/")), refused, `every one is refused: ${JSON.stringify(refused.filter((file) => !reasons.some((r) => r.file === file)))}`);
    assert.ok(reasons.every((r) => r.why.length > 5));
  });

  await scenario("the code-change lane's impact: V3 content and Remotion sources are source only there, nowhere else; heavier classes stay unpublishable", () => {
    assert.equal(classifyAyasCodeChangeImpact(["content/v3/x.json", "remotion-v3/src/Episode.tsx", "src/lib/ayas/A.ts"]).publishable, true);
    assert.equal(classifyAyasCodeChangeImpact(["scripts/smoke-ayas-x.ts"]).impactClass, "TEST_ONLY");
    assert.equal(classifyAyasRuntimeImpact(["content/v3/x.json"]).publishable, false, "the other one-click lanes are unchanged");
    for (const files of [["package.json"], ["src/a.ts", "data/brain/x.json"], ["middleware.ts"], ["src/lib/brain/autonomy/AyasGuardedPublication.ts"], [], ["remotion-v3/package.json"]]) {
      assert.equal(classifyAyasCodeChangeImpact(files).publishable, false, JSON.stringify(files));
    }
    assert.ok(classifyAyasCodeChangeImpact(["src/a.ts"]).notApplicable.length === 3 && Object.isFrozen(classifyAyasRuntimeImpact(["src/a.ts"]).notApplicable));
  });

  await scenario("the build identity covers job, branch, commit, base, every file's bytes and the checks; file order does not matter", () => {
    const build: AyasCodeBuild = { jobId: "j1", scope: "ayas", title: "t", branch: "gelistirme/j1", commit: "a".repeat(40), baseHead: "b".repeat(40),
      files: [{ path: "src/b.ts", sha256: "1".repeat(64) }, { path: "src/a.ts", sha256: null }], checks: ["tsc"], smokes: ["scripts/smoke-x.ts"] };
    const hash = ayasCodeBuildHash(build);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(ayasCodeBuildHash({ ...build, files: [...build.files].reverse() }), hash);
    for (const changed of [{ commit: "c".repeat(40) }, { baseHead: "d".repeat(40) }, { files: [{ path: "src/b.ts", sha256: "2".repeat(64) }, { path: "src/a.ts", sha256: null }] }, { smokes: [] }, { jobId: "j2" }, { branch: "gelistirme/j2" }, { checks: [] }]) {
      assert.notEqual(ayasCodeBuildHash({ ...build, ...changed }), hash, JSON.stringify(changed));
    }
  });

  await scenario("the owner admission for a build is its own action: it authorizes no proposal, batch, update or execution, and no other action authorizes it", async () => {
    const subject: AyasOwnerAdmissionSubject = { kind: "code-apply", jobId: "j1", buildHash: "e".repeat(64), decision: "APPLY" };
    const admission = await admit("applyAyasCodeChange")(subject);
    assert.equal(isAyasOwnerAdmissionActionCompatible(admission), true);
    const wrong = await admit("applyAyasUpdate")(subject);
    assert.equal(isAyasOwnerAdmissionActionCompatible(wrong), false);
    const asProposal = await admit("applyAyasCodeChange")({ kind: "proposal", proposalId: "p", proposalHash: "f".repeat(64), decision: "APPROVE" });
    assert.equal(isAyasOwnerAdmissionActionCompatible(asProposal), false);
    assert.equal(checkAyasOwnerExecutionAdmission({ decisionId: "d", decidedAt: new Date().toISOString(), ownerAdmission: admission }, admission, subject, new Date().toISOString(), new Set()), false);
    await assert.rejects(admitAyasOwnerApproval({ gate, token: await issueSession(KEY), action: "applyAyasCodeChange", subject: { ...subject, jobId: "../x" } }), (error: unknown) => (error as { code?: string }).code === "OWNER_ADMISSION_INVALID_SUBJECT");
  });

  await scenario("ONAYLA VE UYGULA records one sealed decision bound to the exact build; a changed build, a file outside the lane, a second click or safe mode is refused", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "karar-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    await rejects(decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: "0".repeat(64) }, { store: f.store, build: async () => build, admit: admit("applyAyasCodeChange"), safeModeHold: () => undefined }), "CODE_APPLY_BUILD_CHANGED");
    await rejects(decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: ayasCodeBuildHash(build) }, { store: f.store, build: async () => undefined, admit: admit("applyAyasCodeChange"), safeModeHold: () => undefined }), "CODE_APPLY_BUILD_NOT_FOUND");
    await rejects(decideAyasCodeChangeApply({ jobId: "bad id!", buildHash: ayasCodeBuildHash(build) }, { store: f.store, build: async () => build, admit: admit("applyAyasCodeChange"), safeModeHold: () => undefined }), "CODE_APPLY_INVALID_INPUT");
    const outside = { ...build, files: [...build.files, { path: "package.json", sha256: "1".repeat(64) }] };
    await rejects(decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: ayasCodeBuildHash(outside) }, { store: f.store, build: async () => outside, admit: admit("applyAyasCodeChange"), safeModeHold: () => undefined }), "CODE_APPLY_OUTSIDE_LANE");
    await assert.rejects(decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: ayasCodeBuildHash(build) }, { store: f.store, build: async () => build, admit: admit("applyAyasCodeChange"), safeModeHold: () => "AYAS_SAFE_READ_ONLY" }), /AYAS_SAFE_READ_ONLY/);
    await rejects(decideAyasCodeChangeApply({ jobId: build.jobId, buildHash: ayasCodeBuildHash(build) }, { store: f.store, build: async () => build, admit: admit("applyAyasUpdate"), safeModeHold: () => undefined }), "CODE_APPLY_ADMISSION_REJECTED");
    assert.equal(f.store.load().decisions.length, 0, "nothing recorded by a refusal");
    const decision = await decide(f.store, build);
    assert.equal(decision.commit, build.commit);
    assert.equal(listAyasCodeApplyDecisions(f.store.load()).length, 1);
    await rejects(decide(f.store, build), "CODE_APPLY_ALREADY_DECIDED");
    // An edited record is never trusted.
    const tampered = { ...f.store.load(), decisions: f.store.load().decisions.map((d) => ({ ...d, buildHash: "9".repeat(64) })) };
    assert.equal(listAyasCodeApplyDecisions(tampered).length, 0);
  });

  await scenario("same base: the build commit itself is fast-forwarded and pushed through the guarded code-change lane; Graphify closure; the queue hears RUNNING then COMPLETED", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "ileri-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n", "scripts/smoke-ayas-greeting.ts": "console.log(\"PASS (1 scenarios)\");\n" });
    const decision = await decide(f.store, build);
    const job = selectAyasCodeApplyJob({ state: f.store.load(), builds: new Map([[build.jobId, build]]) });
    assert.equal(job.kind, "APPLY");
    const done = await runAyasCodeChangeApply(decision, build, f.deps);
    assert.equal(done.status, "COMPLETED", JSON.stringify(done.reasons));
    assert.deepEqual([done.commitSha, done.pushed, done.verified], [build.commit, true, "SAME_BASE"], "the published commit is the reviewed one");
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), build.commit);
    assert.equal(git(f.remoteDir, "rev-parse", "master"), build.commit);
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.deepEqual(f.closures, [build.commit]);
    assert.deepEqual(f.reverified, [], "no re-verification on the build's own base");
    assert.deepEqual(f.reports.map((r) => r.status), ["RUNNING", "COMPLETED"]);
    assert.equal(selectAyasCodeApplyJob({ state: f.store.load(), builds: new Map([[build.jobId, build]]) }).kind, "NONE", "a decision is carried out once");
    assert.equal(ayasCodeBuildDecisionOpen(f.store.load(), build.jobId, ayasCodeBuildHash(build)), false);
  });

  await scenario("HEAD moved on other files: the checks run again on the new HEAD, then the build is cherry-picked with the reviewed bytes", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "ustune-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    fs.writeFileSync(path.join(f.repoRoot, "src", "lib", "ayas", "Other.ts"), "export const other = 2;\n");
    git(f.repoRoot, "commit", "-qam", "someone else's work"); git(f.repoRoot, "push", "-q");
    const moved = git(f.repoRoot, "rev-parse", "HEAD");
    const decision = await decide(f.store, build);
    const done = await runAyasCodeChangeApply(decision, build, f.deps);
    assert.equal(done.status, "COMPLETED", JSON.stringify(done.reasons));
    assert.equal(done.verified, "REVERIFIED");
    assert.deepEqual(f.reverified, [moved]);
    assert.notEqual(done.commitSha, build.commit);
    assert.equal(git(f.repoRoot, "rev-parse", `${done.commitSha}^`), moved, "on top of the moved HEAD");
    assert.equal(git(f.repoRoot, "rev-parse", `${done.commitSha}:src/lib/ayas/Greeting.ts`), git(f.repoRoot, "rev-parse", `${build.commit}:src/lib/ayas/Greeting.ts`), "the reviewed bytes");
    assert.ok(git(f.repoRoot, "log", "-1", "--format=%B").includes(ayasCodeJobTrailer(build.jobId)));
    assert.equal(git(f.remoteDir, "rev-parse", "master"), done.commitSha);
  });

  await scenario("STALE: a build file changed since its base, or the checks fail on the new HEAD — nothing is committed and the job goes back to be built again", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "bayat-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    fs.writeFileSync(path.join(f.repoRoot, "src", "lib", "ayas", "Greeting.ts"), "export const greeting = \"hey\";\n");
    git(f.repoRoot, "commit", "-qam", "the same file moved on");
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const stale = await runAyasCodeChangeApply(await decide(f.store, build), build, f.deps);
    assert.equal(stale.status, "STALE");
    assert.match(stale.reasons![0]!, /Greeting\.ts/);
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), head);
    const g = makeFixture();
    const other = makeBuild(g, "bayat-2", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    fs.writeFileSync(path.join(g.repoRoot, "README.md"), "moved\n"); git(g.repoRoot, "commit", "-qam", "readme");
    const before = git(g.repoRoot, "rev-parse", "HEAD");
    g.setReverify(false);
    const failed = await runAyasCodeChangeApply(await decide(g.store, other), other, g.deps);
    assert.equal(failed.status, "STALE");
    assert.match(failed.reasons![0]!, /yeni kodda kontroller geçmedi: tsc/);
    assert.equal(git(g.repoRoot, "rev-parse", "HEAD"), before);
    assert.equal(git(g.repoRoot, "status", "--porcelain"), "");
    assert.deepEqual(g.reports.map((r) => r.status), ["RUNNING", "STALE"]);
  });

  await scenario("REFUSED: a branch moved after the build, a changed recorded byte or a file outside the lane is never applied", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "kanit-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    const decision = await decide(f.store, build);
    git(f.repoRoot, "branch", "-f", build.branch, "HEAD");
    const moved = await runAyasCodeChangeApply(decision, build, f.deps);
    assert.equal(moved.status, "REFUSED");
    assert.match(moved.reasons![0]!, /artık onaylanan commit'i göstermiyor/);
    git(f.repoRoot, "branch", "-f", build.branch, build.commit);
    const lying = { ...build, files: [{ path: "src/lib/ayas/Greeting.ts", sha256: "1".repeat(64) }] };
    assert.match((await runAyasCodeChangeApply({ ...decision, buildHash: ayasCodeBuildHash(lying) }, lying, f.deps)).reasons![0]!, /onaylanan içerikte değil/);
    const pkg = makeBuild(f, "kanit-2", { "package.json": "{}\n" });
    const refused = await runAyasCodeChangeApply({ ...decision, jobId: pkg.jobId, buildHash: ayasCodeBuildHash(pkg) }, pkg, f.deps);
    assert.equal(refused.status, "REFUSED");
    assert.match(refused.reasons![0]!, /kod hattının dışında dosya: package\.json/);
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), build.baseHead, "nothing moved");
    // The executor closes a decision whose build is gone as REFUSED.
    const g = makeFixture();
    const gone = makeBuild(g, "kanit-3", { "src/lib/ayas/Greeting.ts": "x\n" });
    await decide(g.store, gone);
    assert.equal(selectAyasCodeApplyJob({ state: g.store.load(), builds: new Map() }).kind, "REFUSE");
  });

  await scenario("a failed push leaves the commit standing (never reset); the self-heal proves and pushes it once the remote answers", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "push-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    const done = await runAyasCodeChangeApply(await decide(f.store, build), build, { ...f.deps, push: () => { throw new Error("remote: Internal Server Error"); } });
    assert.notEqual(done.status, "COMPLETED");
    assert.equal(done.commitSha, build.commit);
    assert.equal(git(f.repoRoot, "rev-parse", "HEAD"), build.commit, "the commit stands");
    assert.ok(isAyasCodeApplyPushPending(f.store.load().applies.find((a) => a.applyId === done.applyId)!));
    const recovered = recoverAyasCodeApplyPushes({ repoRoot: f.repoRoot, store: f.store, postPublicationClosure: (head) => { f.closures.push(head); } });
    assert.deepEqual(recovered.map((r) => r.outcome), ["PUSHED"]);
    assert.equal(git(f.remoteDir, "rev-parse", "master"), build.commit);
    assert.equal(f.store.load().applies.find((a) => a.applyId === done.applyId)?.status, "COMPLETED");
    assert.equal(recoverAyasCodeApplyPushes({ repoRoot: f.repoRoot, store: f.store }).length, 0);
  });

  await scenario("an apply left RUNNING by a dead executor: untouched → ABANDONED and retried a bounded number of times; its pushed commit → COMPLETED", async () => {
    const f = makeFixture();
    const build = makeBuild(f, "yetim-1", { "src/lib/ayas/Greeting.ts": "export const greeting = \"selam\";\n" });
    const decision = await decide(f.store, build);
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    const running = { schemaVersion: 1 as const, applyId: "run-1", decisionId: decision.decisionId, jobId: build.jobId, buildHash: decision.buildHash, baseHead: head, status: "RUNNING" as const, startedAt: new Date().toISOString() };
    f.store.upsertApply(running);
    assert.equal(reconcileAyasCodeApplyOrphan(running, { repoRoot: f.repoRoot, store: f.store }).status, "ABANDONED");
    assert.equal(selectAyasCodeApplyJob({ state: f.store.load(), builds: new Map([[build.jobId, build]]) }).kind, "APPLY", "tried again");
    f.store.upsertApply({ ...running, applyId: "run-2", status: "ABANDONED" });
    assert.equal(f.store.load().applies.filter((a) => a.status === "ABANDONED").length, AYAS_CODE_APPLY_MAX_ABANDONED);
    assert.equal(selectAyasCodeApplyJob({ state: f.store.load(), builds: new Map([[build.jobId, build]]) }).kind, "NONE", "not forever");
    assert.equal(ayasCodeBuildDecisionOpen(f.store.load(), build.jobId, decision.buildHash), true, "the owner may click again");
    git(f.repoRoot, "merge", "--ff-only", "-q", build.commit); git(f.repoRoot, "push", "-q");
    const second = { ...running, applyId: "run-3" };
    f.store.upsertApply(second);
    assert.equal(reconcileAyasCodeApplyOrphan(second, { repoRoot: f.repoRoot, store: f.store }).status, "COMPLETED");
  });

  await scenario("the real re-verification: a detached worktree of HEAD with the build's files, the checkout's node_modules linked and never entered on removal", async () => {
    const f = makeFixture();
    // Stub tools in the checkout's node_modules (ignored): tsc and tsx exit 0, unless a suite says FAIL.
    const nm = path.join(f.repoRoot, "node_modules");
    fs.mkdirSync(path.join(nm, "typescript", "bin"), { recursive: true }); fs.mkdirSync(path.join(nm, "tsx", "dist"), { recursive: true });
    fs.writeFileSync(path.join(nm, "typescript", "bin", "tsc"), "process.exit(0);\n");
    fs.writeFileSync(path.join(nm, "tsx", "dist", "cli.mjs"), "import fs from 'node:fs'; process.exit(fs.readFileSync(process.argv[2], 'utf8').includes('FAIL') ? 1 : 0);\n");
    fs.writeFileSync(path.join(nm, "keep.txt"), "the checkout's own dependency");
    fs.mkdirSync(path.join(f.repoRoot, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(f.repoRoot, "scripts", "lint-yerel.mjs"), "process.exit(0);\n");
    git(f.repoRoot, "add", "-A"); git(f.repoRoot, "commit", "-qm", "tools");
    const good = makeBuild(f, "dogrula-1", { "scripts/smoke-ayas-greeting.ts": "// PASS\n" }, ["scripts/smoke-ayas-greeting.ts"]);
    const head = git(f.repoRoot, "rev-parse", "HEAD");
    assert.deepEqual(await reverifyAyasCodeBuild(f.repoRoot, head, good), { ok: true, summary: "3 kontrol yeni kodda geçti" });
    const bad = makeBuild(f, "dogrula-2", { "scripts/smoke-ayas-greeting.ts": "// FAIL\n" }, ["scripts/smoke-ayas-greeting.ts"]);
    const failed = await reverifyAyasCodeBuild(f.repoRoot, head, bad);
    assert.equal(failed.ok, false);
    assert.match(failed.summary, /^scripts\/smoke-ayas-greeting\.ts/);
    assert.equal(fs.readFileSync(path.join(nm, "keep.txt"), "utf8"), "the checkout's own dependency", "removing the worktree never entered the linked node_modules");
    assert.equal(fs.existsSync(path.join(path.dirname(f.repoRoot), "gelistirme", "_uygula-dogrula-2")), false, "the worktree is gone");
    assert.equal(git(f.repoRoot, "status", "--porcelain"), "");
    assert.equal(git(f.repoRoot, "worktree", "list").split(/\r?\n/).length, 1);
  });

  console.log(`PASS (${count} scenarios)`);
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    if (originalKey === undefined) delete process.env.AYAS_ACCESS_KEY; else process.env.AYAS_ACCESS_KEY = originalKey;
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* temp */ }
  });
