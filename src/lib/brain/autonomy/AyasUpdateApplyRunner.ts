import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runGuardedAyasPublication, type AyasGuardedPublicationGuardDeps } from "./AyasGuardedPublication";
import { closeAyasPostPublication } from "./AyasPostPublicationClosure";
import { AYAS_DEPENDENCY_UPDATE_FILES } from "./AyasProposalRuntimeImpact";
import type { AyasUpdateApplyDecisionRecord } from "./AyasUpdateApprovalStore";
import { runAyasCommand, type AyasChildEnv, type AyasCommandRunner } from "./AyasUpdateTrialRunner";
import {
  ayasUpdateTrialSha256, isAyasUpdateTrialIntact, requestAyasCanonicalDependencySync, type AyasUpdateApplyRecord, type AyasUpdateTrialRecord, type AyasUpdateTrialStore,
} from "./AyasUpdateTrialStore";

/**
 * Carries out one owner "Uygula" (owner decisions 2026-10-15; CLAUDE.md standing exception for this click). The
 * passed trial's exact package.json and package-lock.json bytes are committed and pushed through the guarded
 * publication's dependency-update lane: clean tree, the trial's own base HEAD, exact two-file staging, one commit, a
 * plain push, local HEAD equal to the remote afterwards, then the established post-publication closure (Graphify for
 * the new HEAD). Only after the guard has closed is the live copy republished by scripts/ayas-publish-live.ps1, whose
 * health check rolls the live copy back by itself. Nothing is ever force-pushed, reset after a commit, or retried
 * after something real may have happened.
 *
 * Effectful (git, PowerShell): reached only from scripts/ayas-update-executor.ts.
 */
export interface AyasUpdateApplyDeps {
  readonly repoRoot: string;
  readonly gateRoot?: string;
  readonly store: AyasUpdateTrialStore;
  readonly remoteName?: string;
  readonly now?: () => string;
  readonly guard?: AyasGuardedPublicationGuardDeps;
  /** Test seam; production runs the established `graphify update` closure for the new HEAD. */
  readonly postPublicationClosure?: (head: string) => void;
  /** Test seam; production runs scripts/ayas-publish-live.ps1 -Commit <sha> -Apply. */
  readonly publishLive?: (commitSha: string) => Promise<{ readonly status: "PUBLISHED" | "ROLLED_BACK" | "FAILED"; readonly summary: string }>;
  readonly run?: AyasCommandRunner;
  readonly env?: AyasChildEnv;
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 120_000 }).trim();
}

function writeAtomic(file: string, content: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/** Every path that differs from HEAD: modified, staged or untracked (each listed by name, never parsed from status columns). */
function changedPaths(repoRoot: string): string[] {
  const list = (args: readonly string[]) => git(repoRoot, args).split(/\r?\n/).filter(Boolean);
  return [...new Set([...list(["diff", "--name-only"]), ...list(["diff", "--cached", "--name-only"]), ...list(["ls-files", "--others", "--exclude-standard"])])].sort();
}

/** Put the two files back exactly as HEAD has them. Used only before a commit exists. */
function restoreDependencyFiles(repoRoot: string): void {
  git(repoRoot, ["reset", "-q", "--", ...AYAS_DEPENDENCY_UPDATE_FILES]);
  git(repoRoot, ["checkout", "--", ...AYAS_DEPENDENCY_UPDATE_FILES]);
}

type LaneOutcome = { readonly ok: true; readonly commitSha: string } | { readonly ok: false; readonly stage: string; readonly reason: string; readonly commitSha?: string };

function commitMessage(trial: AyasUpdateTrialRecord): readonly string[] {
  const checks = trial.steps.map((step) => step.name).join(", ");
  return [
    `chore(deps): ${trial.toolName} ${trial.installedVersion} -> ${trial.targetVersion}`,
    `Owner-approved update (Gelişim Merkezi radar: dene, sonra uygula). The trial installed ${trial.installSpecs.join(", ")} in a separate worktree of ${trial.baseHead.slice(0, 8)} and passed: ${checks}.`,
    `AYAS-Update-Trial: ${trial.trialId}`,
  ];
}

/** The dependency-update lane's own pipeline, handed to the guard unmodified. */
function publishDependencyUpdate(trial: AyasUpdateTrialRecord, artifacts: { readonly packageJson: string; readonly packageLock: string }, repoRoot: string, remoteName: string): LaneOutcome {
  if (git(repoRoot, ["status", "--porcelain"]).length) return { ok: false, stage: "PRECONDITION", reason: "working tree is not clean" };
  if (git(repoRoot, ["rev-parse", "HEAD"]) !== trial.baseHead) return { ok: false, stage: "PRECONDITION", reason: "HEAD moved since the trial" };
  try {
    writeAtomic(path.join(repoRoot, "package.json"), artifacts.packageJson);
    writeAtomic(path.join(repoRoot, "package-lock.json"), artifacts.packageLock);
    const changed = changedPaths(repoRoot);
    if (JSON.stringify(changed) !== JSON.stringify(AYAS_DEPENDENCY_UPDATE_FILES)) { restoreDependencyFiles(repoRoot); return { ok: false, stage: "SCOPE", reason: `changed ${JSON.stringify(changed)} instead of package.json and package-lock.json` }; }
    for (const [file, expected] of [["package.json", trial.packageJsonSha256], ["package-lock.json", trial.packageLockSha256]] as const) {
      if (ayasUpdateTrialSha256(fs.readFileSync(path.join(repoRoot, file), "utf8")) !== expected) { restoreDependencyFiles(repoRoot); return { ok: false, stage: "SCOPE", reason: `${file} does not match the tested bytes` }; }
    }
    git(repoRoot, ["add", "--", ...AYAS_DEPENDENCY_UPDATE_FILES]);
    const staged = git(repoRoot, ["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean).sort();
    if (JSON.stringify(staged) !== JSON.stringify(AYAS_DEPENDENCY_UPDATE_FILES)) { restoreDependencyFiles(repoRoot); return { ok: false, stage: "STAGING", reason: `staged ${JSON.stringify(staged)}` }; }
    git(repoRoot, ["diff", "--cached", "--check"]);
  } catch (error) {
    try { restoreDependencyFiles(repoRoot); } catch { /* the guard's rollback check reports what is left */ }
    return { ok: false, stage: "STAGING", reason: error instanceof Error ? error.message : String(error) };
  }
  let commitSha: string;
  try {
    git(repoRoot, ["commit", "-q", ...commitMessage(trial).flatMap((paragraph) => ["-m", paragraph])]);
    commitSha = git(repoRoot, ["rev-parse", "HEAD"]);
  } catch (error) {
    // Content staged but the commit did not complete: left as found for a human, never reset here.
    return { ok: false, stage: "COMMIT", reason: error instanceof Error ? error.message : String(error) };
  }
  const branch = git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  try { git(repoRoot, ["push", remoteName, branch]); } catch (error) {
    return { ok: false, stage: "PUSH", reason: error instanceof Error ? error.message : String(error), commitSha };
  }
  const remoteHead = git(repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (remoteHead !== commitSha) return { ok: false, stage: "PUSH", reason: `remote ${remoteName}/${branch} is ${remoteHead}, not ${commitSha}`, commitSha };
  return { ok: true, commitSha };
}

/** The established live publish, as a child process outside the live app's own process tree. */
export function createAyasLivePublisher(repoRoot: string, run: AyasCommandRunner, env: AyasChildEnv): (commitSha: string) => Promise<{ readonly status: "PUBLISHED" | "ROLLED_BACK" | "FAILED"; readonly summary: string }> {
  return async (commitSha) => {
    const script = path.join(repoRoot, "scripts", "ayas-publish-live.ps1");
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Commit", commitSha, "-Apply"], { cwd: repoRoot, timeoutMs: 45 * 60_000, env });
    const lines = result.output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\[(TAMAM|SORUN|YAPILDI|BILGI)\]/.test(line));
    const summary = lines.slice(-4).join(" | ").slice(0, 600) || (result.timedOut ? "yayın süre sınırını aştı" : "yayın çıktısı okunamadı");
    if (result.code === 0 && lines.some((line) => /^\[TAMAM\] (Yayinda:|Bu commit zaten canlida|Uygulama kodu canlidakiyle ayni)/.test(line))) return { status: "PUBLISHED", summary };
    if (lines.some((line) => /^\[TAMAM\] Onceki surum yeniden yayinda/.test(line))) return { status: "ROLLED_BACK", summary };
    return { status: "FAILED", summary };
  };
}

function childEnv(deps: AyasUpdateApplyDeps): AyasChildEnv {
  if (deps.env) return deps.env;
  const studioPrivate = path.resolve(deps.repoRoot, "..", "..", "private");
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|^OPENAI|^ANTHROPIC|^ELEVENLABS|^YOUTUBE/i.test(key)) delete env[key];
  return { ...env, TEMP: path.join(studioPrivate, "temp"), TMP: path.join(studioPrivate, "temp"), NPM_CONFIG_CACHE: path.join(studioPrivate, "npm-cache") };
}

/** Publishes a committed update's live copy; bounded by the job selection, never touching Git. */
export async function runAyasUpdateLivePublish(apply: AyasUpdateApplyRecord, deps: AyasUpdateApplyDeps): Promise<AyasUpdateApplyRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const publish = deps.publishLive ?? createAyasLivePublisher(deps.repoRoot, deps.run ?? runAyasCommand, childEnv(deps));
  const live = await publish(apply.commitSha!);
  const attempts = (apply.live?.attempts ?? 0) + 1;
  const next: AyasUpdateApplyRecord = { ...apply, live: { ...live, attempts, at: now() }, livePending: live.status !== "PUBLISHED" };
  deps.store.upsertApply(next);
  return next;
}

/**
 * Carries out one admitted "Uygula". The decision and the trial must still bind: same trial hash, intact artifacts,
 * and the trial's own base HEAD as the current HEAD (otherwise STALE, and the executor re-runs the trial on the new
 * HEAD for a fresh click).
 */
export async function runAyasUpdateApply(decision: AyasUpdateApplyDecisionRecord, trial: AyasUpdateTrialRecord, deps: AyasUpdateApplyDeps): Promise<AyasUpdateApplyRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const remoteName = deps.remoteName ?? "origin";
  let record: AyasUpdateApplyRecord = {
    schemaVersion: 1, applyId: `ayas-update-apply-run-${crypto.randomUUID()}`, applyDecisionId: decision.decisionId, trialId: trial.trialId,
    sourceId: trial.sourceId, toolName: trial.toolName, installedVersion: trial.installedVersion, targetVersion: trial.targetVersion,
    baseHead: git(deps.repoRoot, ["rev-parse", "HEAD"]), status: "RUNNING", startedAt: now(),
  };
  const save = (patch: Partial<AyasUpdateApplyRecord>): AyasUpdateApplyRecord => { record = { ...record, ...patch }; deps.store.upsertApply(record); return record; };
  save({});

  const artifacts = deps.store.readArtifacts(trial.trialId);
  if (decision.trialHash !== trial.trialHash || !isAyasUpdateTrialIntact(trial, artifacts)) return save({ status: "REFUSED", finishedAt: now(), reasons: ["denenen paket dosyaları değişmiş ya da eksik"] });
  if (record.baseHead !== trial.baseHead) return save({ status: "STALE", finishedAt: now(), reasons: ["deneme yapıldıktan sonra kod değişti; güncelleme yeni koda göre yeniden denenecek"] });

  let lane: LaneOutcome | undefined;
  const result = await runGuardedAyasPublication<LaneOutcome>({
    lane: "dependency-update", subjectId: trial.trialId, exactFiles: AYAS_DEPENDENCY_UPDATE_FILES, repoRoot: deps.repoRoot,
    gateRoot: deps.gateRoot ?? path.join(deps.repoRoot, "data", "brain", "self-improvement"),
    publish: async () => (lane = publishDependencyUpdate(trial, artifacts!, deps.repoRoot, remoteName)),
    ...(deps.guard ? { guard: deps.guard } : {}),
  });
  const laneReason = lane && !lane.ok ? [`${lane.stage}: ${lane.reason}`] : [];
  if (result.state !== "COMPLETED" || !lane?.ok) {
    const status = result.state === "COMPLETED" ? "FAILED" : result.state === "REFUSED" ? "REFUSED" : result.state === "ROLLED_BACK" ? "ROLLED_BACK" : result.state;
    return save({ status, finishedAt: now(), reasons: [...laneReason, ...("reasons" in result ? result.reasons : [])].slice(0, 6),
      ...(lane && !lane.ok && lane.commitSha ? { commitSha: lane.commitSha } : {}) });
  }

  save({ commitSha: lane.commitSha, pushed: true, livePending: true });
  const syncProblem = requestCanonicalSync(record, lane.commitSha, deps);
  if (syncProblem) save({ reasons: [syncProblem] });
  try {
    (deps.postPublicationClosure ?? ((head) => { closeAyasPostPublication(head, { repoRoot: deps.repoRoot, remoteName }); }))(lane.commitSha);
    save({ closure: { ok: true, summary: "Graphify yeni HEAD için güncel" } });
  } catch (error) {
    save({ closure: { ok: false, summary: (error instanceof Error ? error.message : String(error)).slice(0, 400) } });
  }
  save({ status: "COMPLETED", finishedAt: now() });
  return runAyasUpdateLivePublish(record, deps);
}

/**
 * An apply left RUNNING by a dead executor. Same HEAD as it started and a clean tree prove nothing happened (ABANDONED,
 * retried a bounded number of times); a pushed commit carrying its trial trailer is COMPLETED with the live publish
 * still pending; anything else is RECOVERY_REQUIRED and waits for a human.
 */
export function reconcileAyasUpdateApplyOrphan(apply: AyasUpdateApplyRecord, deps: Pick<AyasUpdateApplyDeps, "repoRoot" | "store" | "now" | "remoteName">): AyasUpdateApplyRecord {
  const now = deps.now ?? (() => new Date().toISOString());
  const head = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const clean = git(deps.repoRoot, ["status", "--porcelain"]).length === 0;
  let next: AyasUpdateApplyRecord;
  if (head === apply.baseHead && clean) next = { ...apply, status: "ABANDONED", finishedAt: now(), reasons: ["uygulama yarıda kesildi; hiçbir şey değişmemişti"] };
  else {
    const trailer = `AYAS-Update-Trial: ${apply.trialId}`;
    const message = (() => { try { return git(deps.repoRoot, ["log", "-1", "--format=%B", head]); } catch { return ""; } })();
    const branch = git(deps.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const remote = (() => { try { return git(deps.repoRoot, ["rev-parse", `${deps.remoteName ?? "origin"}/${branch}`]); } catch { return ""; } })();
    next = clean && message.includes(trailer) && remote === head
      ? { ...apply, status: "COMPLETED", commitSha: head, pushed: true, livePending: true, finishedAt: now(), reasons: ["uygulama yarıda kesilmişti; commit ve push tamamlanmış bulundu"] }
      : { ...apply, status: "RECOVERY_REQUIRED", finishedAt: now(), reasons: ["uygulama yarıda kesildi; depo durumu elle doğrulanmalı"] };
    if (next.status === "COMPLETED") {
      const syncProblem = requestCanonicalSync(next, head, deps);
      if (syncProblem) next = { ...next, reasons: [...(next.reasons ?? []), syncProblem] };
    }
  }
  deps.store.upsertApply(next);
  return next;
}

/**
 * Leaves the canonical node_modules sync request for the observer's wrapper (see AYAS_CANONICAL_SYNC_MARKER), bound
 * to the committed lock. Best effort: the commit already stands, so a failure is reported, never thrown.
 */
function requestCanonicalSync(apply: AyasUpdateApplyRecord, commitSha: string, deps: Pick<AyasUpdateApplyDeps, "repoRoot" | "store" | "now">): string | undefined {
  try {
    requestAyasCanonicalDependencySync(deps.store.rootDir, {
      requestedAt: (deps.now ?? (() => new Date().toISOString()))(), applyId: apply.applyId, commitSha,
      packageLockSha256: ayasUpdateTrialSha256(fs.readFileSync(path.join(deps.repoRoot, "package-lock.json"), "utf8")),
    });
    return undefined;
  } catch (error) {
    return `ana kopyanın node_modules eşitleme isteği yazılamadı: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`;
  }
}
