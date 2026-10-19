/**
 * The update executor (owner decisions 2026-10-15: "dene, sonra uygula", no Claude/Codex in the loop).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/ayas-update-executor.ts [--dry-run]
 *
 * Started by the observer on every tick while the machine is ALLOW and the tree is clean (and runnable by hand). It
 * does at most one job and exits, the owner's clicks first:
 *   - LIVE_PUBLISH: a committed and pushed update whose live copy is not yet published (bounded attempts).
 *   - APPLY: an owner "Uygula" on a passed trial: commit + push through the guarded dependency-update lane, Graphify
 *     closure, then the live publish (AyasUpdateApplyRunner; CLAUDE.md standing exception for this click).
 *   - MODEL_SWITCH: an owner "Bu modele geç": AYAS_OLLAMA_MODEL in both .env.local files, a live restart and a short
 *     chat check, rolled back on failure (AyasModelSwitchRunner). No Git change.
 *   - AUTO_LIVE_PUBLISH: a finished task, i.e. the pushed HEAD with an application change the live copy lacks, goes
 *     live through the same publish as an "Uygula" (owner decision 2026-10-19, AyasAutoLivePublish; it waits while
 *     the owner chatted in the last 5 minutes; AYAS_AUTO_LIVE_PUBLISH=0 turns it off). No Git change.
 *   - TRIAL: the oldest owner-approved npm update without a trial on this HEAD is installed and checked in a separate
 *     worktree (AyasUpdateTrialRunner). The canonical tree, its node_modules and the live copy are not written.
 *   - MODEL_TRIAL: an owner "İndir ve ölç": one bounded download slice from the loopback Ollama, then the frozen
 *     benchmark once the approved bytes are in place (AyasModelTrialRunner). No configuration change.
 * Nothing runs without an owner approval whose seal verifies under AYAS_ACCESS_KEY (hence .env.local), apart from the
 * automatic live publish that the owner's standing decision covers (CLAUDE.md, 2026-10-19), nothing runs in
 * SAFE_READ_ONLY, and one executor at a time holds data/brain/self-improvement/update-trials/executor.lock. Prints one
 * JSON line; exits 0 unless something unexpected throws.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveOllamaConfig } from "../src/lib/ai/OllamaConfig";
import { resolveAccessGate } from "../src/lib/auth/accessGate";
import { resolveAyasChatModelProfile } from "../src/lib/ayas/AyasModelProfile";
import { runAyasChatModelBenchmark } from "../src/lib/ayas/model/AyasChatModelBenchmark";
import { ayasSafeModeHold } from "../src/lib/ayas/safety/AyasSafeModeReader";
import { createAyasModelOperationStore, selectAyasModelJob } from "../src/lib/brain/autonomy/AyasModelOperationStore";
import { reconcileAyasModelSwitchOrphan, runAyasModelSwitch } from "../src/lib/brain/autonomy/AyasModelSwitchRunner";
import { runAyasModelTrial } from "../src/lib/brain/autonomy/AyasModelTrialRunner";
import { readAyasOwnerChatActivityAt } from "../src/lib/ayas/AyasOwnerChatActivity";
import { AYAS_LIVE_APP_PATHS, decideAyasAutoLivePublish, readAyasAutoLiveAttempts, type AyasAutoLiveFacts } from "../src/lib/brain/autonomy/AyasAutoLivePublish";
import { reconcileAyasUpdateApplyOrphan, runAyasAutoLivePublish, runAyasUpdateApply, runAyasUpdateLivePublish } from "../src/lib/brain/autonomy/AyasUpdateApplyRunner";
import { createAyasUpdateApprovalStore, listAyasUpdateApplyDecisions, listAyasUpdateApprovals } from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import { resolveAyasUpdateTrialRoots, runAyasUpdateTrial } from "../src/lib/brain/autonomy/AyasUpdateTrialRunner";
import { createAyasUpdateTrialStore, selectAyasUpdateApplyJob, selectAyasUpdateTrialJob } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";
import { probeAyasModelHardware } from "./lib/AyasModelHardwareProbe";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
/** A trial needs a full node_modules, a build and the worktree itself; refuse well before the disk is tight. */
const MIN_FREE_BYTES = 15 * 1024 ** 3;

const report = (status: string, extra: Record<string, unknown> = {}): void => { console.log(JSON.stringify({ status, ...extra })); };
const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();

const tryGit = (args: readonly string[]): string | undefined => { try { return git(args); } catch { return undefined; } };

/** The live snapshot's build commit from the files scripts/ayas-publish-live.ps1 swaps; undefined without a live copy here. */
function readLiveHead(): string | undefined {
  const accessDir = path.resolve(root, "..", "..", "private", "AtolyeAyasAccess");
  try {
    if (!fs.statSync(path.join(accessDir, "published-application-v1.json")).isFile()) return undefined;
    const head = (JSON.parse(fs.readFileSync(path.join(accessDir, "prebuilt-runtime-v1.json"), "utf8")) as { readonly buildHead?: unknown }).buildHead;
    return typeof head === "string" && /^[0-9a-f]{40}$/.test(head) ? head : undefined;
  } catch { return undefined; }
}

function autoLiveFacts(head: string, storeRoot: string): AyasAutoLiveFacts {
  const liveHead = readLiveHead();
  return {
    enabled: process.env.AYAS_AUTO_LIVE_PUBLISH !== "0",
    head,
    // The upstream as this repository last saw it (a push updates it); no fetch.
    upstreamHead: tryGit(["rev-parse", "--verify", "--quiet", "@{u}"]),
    liveHead,
    liveIsAncestor: () => liveHead !== undefined && tryGit(["merge-base", "--is-ancestor", liveHead, head]) !== undefined,
    appChanged: () => liveHead !== undefined && (tryGit(["diff", "--name-only", liveHead, head, "--", ...AYAS_LIVE_APP_PATHS]) ?? "").length > 0,
    ownerChatAt: readAyasOwnerChatActivityAt(root),
    nowMs: Date.now(),
    attempts: readAyasAutoLiveAttempts(storeRoot),
  };
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** Exclusive executor lock; a lock left by a dead process is taken over. Returns a release function or undefined. */
function acquireLock(file: string): (() => void) | undefined {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => { try { if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.rmSync(file); } catch { /* already gone */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder: number | undefined;
      try { holder = Number(JSON.parse(fs.readFileSync(file, "utf8")).pid); } catch { holder = undefined; }
      if (holder !== undefined && Number.isInteger(holder) && processAlive(holder)) return undefined;
      fs.rmSync(file, { force: true });
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const hold = ayasSafeModeHold(root);
  if (hold) return report("SAFE_MODE_HOLD", { code: hold });
  // Owner seals verify only under the access key; without it no approval counts, so nothing may run.
  if (resolveAccessGate().mode !== "enforced") return report("NO_ACCESS_KEY");

  const trials = createAyasUpdateTrialStore();
  const release = acquireLock(path.join(trials.rootDir, "executor.lock"));
  if (!release) return report("BUSY");
  try {
    // Holding the lock proves no other executor runs, so a RUNNING trial or apply was interrupted.
    for (const trial of trials.load().trials) {
      if (trial.status === "RUNNING") trials.upsert({ ...trial, status: "ABANDONED", finishedAt: new Date().toISOString(), failureReason: "deneme yarıda kesildi (süreç sonlandı)" });
    }
    for (const apply of trials.load().applies ?? []) if (apply.status === "RUNNING") reconcileAyasUpdateApplyOrphan(apply, { repoRoot: root, store: trials });
    const models = createAyasModelOperationStore();
    for (const entry of models.loadJobs().switches) if (entry.status === "RUNNING") reconcileAyasModelSwitchOrphan(entry, { repoRoot: root, store: models });
    if (git(["status", "--porcelain"]).length) return report("SKIPPED_DIRTY_TREE");
    const head = git(["rev-parse", "HEAD"]);
    const approvalState = createAyasUpdateApprovalStore().load();

    const applyJob = selectAyasUpdateApplyJob({ decisions: listAyasUpdateApplyDecisions(approvalState), trials: trials.load().trials, applies: trials.load().applies ?? [] });
    if (applyJob.kind !== "NONE" && dryRun) return report("DRY_RUN", { job: applyJob.kind, head });
    if (applyJob.kind === "LIVE_PUBLISH") {
      const done = await runAyasUpdateLivePublish(applyJob.apply, { repoRoot: root, store: trials });
      return report("LIVE_" + (done.live?.status ?? "FAILED"), { applyId: done.applyId, commit: done.commitSha?.slice(0, 8), attempts: done.live?.attempts });
    }
    if (applyJob.kind === "APPLY") {
      const done = await runAyasUpdateApply(applyJob.decision, applyJob.trial, { repoRoot: root, store: trials });
      return report("APPLY_" + done.status, { applyId: done.applyId, sourceId: done.sourceId, targetVersion: done.targetVersion, commit: done.commitSha?.slice(0, 8), live: done.live?.status, reasons: done.reasons });
    }

    // Model operations: the same owner-sealed decisions, carried out with the AYAS chat path and the loopback Ollama.
    const ollama = resolveOllamaConfig(process.env);
    const incumbentModel = resolveAyasChatModelProfile(process.env).model;
    const modelJob = selectAyasModelJob({ decisions: models.loadDecisions(), jobs: models.loadJobs() });
    if (modelJob.kind === "SWITCH") {
      if (dryRun) return report("DRY_RUN", { job: "MODEL_SWITCH", tag: modelJob.decision.tag, from: modelJob.decision.fromModel });
      const done = await runAyasModelSwitch(modelJob.decision, modelJob.previous, {
        repoRoot: root, store: models, incumbentModel,
        probe: (model, caseIds) => runAyasChatModelBenchmark({ model, env: process.env, caseIds }),
      });
      return report("MODEL_SWITCH_" + done.status, { tag: done.tag, from: done.fromModel, attempts: done.attempts, reasons: done.reasons });
    }

    // Owner decision 2026-10-19: after the owner's own clicks and before the background trials, so a finished task
    // does not wait behind a long trial.
    const autoLive = decideAyasAutoLivePublish(autoLiveFacts(head, trials.rootDir));
    if (autoLive.kind === "PUBLISH") {
      if (dryRun) return report("DRY_RUN", { job: "AUTO_LIVE_PUBLISH", commit: autoLive.commitSha.slice(0, 8), live: autoLive.liveHead.slice(0, 8) });
      // A publish builds a new snapshot next to the live one (node_modules and .next).
      const free = fs.statfsSync(path.resolve(root, ".."));
      if (free.bavail * free.bsize < MIN_FREE_BYTES) return report("SKIPPED_LOW_DISK", { job: "AUTO_LIVE_PUBLISH", freeGb: Math.floor((free.bavail * free.bsize) / 1024 ** 3) });
      const done = await runAyasAutoLivePublish(autoLive.commitSha, { repoRoot: root, store: trials });
      return report("AUTO_LIVE_" + done.status, { commit: done.commitSha.slice(0, 8), from: autoLive.liveHead.slice(0, 8), summary: done.summary });
    }

    const approvals = listAyasUpdateApprovals({ decisions: approvalState.decisions, radar: [], repoRoot: root });
    const job = selectAyasUpdateTrialJob({ approvals, trials: trials.load().trials, head });
    if (job.kind === "NONE" && modelJob.kind === "TRIAL") {
      if (dryRun) return report("DRY_RUN", { job: "MODEL_TRIAL", tag: modelJob.decision.tag, status: modelJob.trial?.status ?? "NEW" });
      // The model store new-pc-setup points OLLAMA_MODELS at: a real profile folder on the system disk since
      // 2026-10-19 (the HDD bundle copy stays as the portable source).
      const modelsDir = process.env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");
      const done = await runAyasModelTrial(modelJob.decision, modelJob.trial, {
        store: models, baseUrl: ollama.baseUrl, incumbentModel,
        measure: (model) => runAyasChatModelBenchmark({
          model, env: process.env,
          probeHardware: (tag) => probeAyasModelHardware({ fetcher: fetch, baseUrl: ollama.baseUrl, model: tag, timeoutMs: ollama.timeoutMs }),
        }),
        freeBytes: () => { try { const stat = fs.statfsSync(modelsDir); return stat.bavail * stat.bsize; } catch { return undefined; } },
      });
      return report("MODEL_TRIAL_" + done.status, {
        tag: done.tag, slices: done.slices, ...(done.totalBytes ? { progress: `${Math.floor(((done.completedBytes ?? 0) / done.totalBytes) * 100)}%` } : {}),
        ...(done.measured ? { measured: `${done.measured.passed}/${done.measured.total}`, verdict: done.measured.verdict } : {}),
        ...(done.failureReason ? { reason: done.failureReason } : done.lastError ? { note: done.lastError } : {}),
      });
    }
    if (job.kind === "NONE") return report("IDLE", { reason: job.reason, autoLive: autoLive.reason });
    if (dryRun) return report("DRY_RUN", { job: job.kind, reason: job.reason, sourceId: job.approval.sourceId, targetVersion: job.approval.targetVersion, head });

    const trialRoots = resolveAyasUpdateTrialRoots(root);
    fs.mkdirSync(trialRoots.root, { recursive: true });
    const free = fs.statfsSync(trialRoots.root);
    if (free.bavail * free.bsize < MIN_FREE_BYTES) return report("SKIPPED_LOW_DISK", { freeGb: Math.floor((free.bavail * free.bsize) / 1024 ** 3) });

    const trial = await runAyasUpdateTrial(job.approval, head, { repoRoot: root, store: trials, trialRoots });
    report("TRIAL_" + trial.status, {
      trialId: trial.trialId, sourceId: trial.sourceId, targetVersion: trial.targetVersion, head: head.slice(0, 8),
      steps: trial.steps.map((step) => `${step.name}:${step.ok ? "ok" : "FAIL"}`), ...(trial.failedStep ? { failedStep: trial.failedStep } : {}),
    });
  } finally { release(); }
}

main().catch((error) => { console.error("AYAS update executor FAILED:", error instanceof Error ? error.message : error); process.exitCode = 1; });
