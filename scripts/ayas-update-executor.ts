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
 *   - TRIAL: the oldest owner-approved npm update without a trial on this HEAD is installed and checked in a separate
 *     worktree (AyasUpdateTrialRunner). The canonical tree, its node_modules and the live copy are not written.
 * Nothing runs without an owner approval whose seal verifies under AYAS_ACCESS_KEY (hence .env.local), nothing runs in
 * SAFE_READ_ONLY, and one executor at a time holds data/brain/self-improvement/update-trials/executor.lock. Prints one
 * JSON line; exits 0 unless something unexpected throws.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { resolveAccessGate } from "../src/lib/auth/accessGate";
import { ayasSafeModeHold } from "../src/lib/ayas/safety/AyasSafeModeReader";
import { reconcileAyasUpdateApplyOrphan, runAyasUpdateApply, runAyasUpdateLivePublish } from "../src/lib/brain/autonomy/AyasUpdateApplyRunner";
import { createAyasUpdateApprovalStore, listAyasUpdateApplyDecisions, listAyasUpdateApprovals } from "../src/lib/brain/autonomy/AyasUpdateApprovalStore";
import { resolveAyasUpdateTrialRoots, runAyasUpdateTrial } from "../src/lib/brain/autonomy/AyasUpdateTrialRunner";
import { createAyasUpdateTrialStore, selectAyasUpdateApplyJob, selectAyasUpdateTrialJob } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

const root = process.cwd();
const dryRun = process.argv.includes("--dry-run");
/** A trial needs a full node_modules, a build and the worktree itself; refuse well before the disk is tight. */
const MIN_FREE_BYTES = 15 * 1024 ** 3;

const report = (status: string, extra: Record<string, unknown> = {}): void => { console.log(JSON.stringify({ status, ...extra })); };
const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: root, encoding: "utf8", windowsHide: true }).trim();

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

    const approvals = listAyasUpdateApprovals({ decisions: approvalState.decisions, radar: [], repoRoot: root });
    const job = selectAyasUpdateTrialJob({ approvals, trials: trials.load().trials, head });
    if (job.kind === "NONE") return report("IDLE", { reason: job.reason });
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
