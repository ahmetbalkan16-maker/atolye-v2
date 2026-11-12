import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ayasCodeBuildHash, ayasCodeContentSha256, ayasCodeJobTrailer, ayasCodeLaneRefusals, type AyasCodeBuild } from "./AyasCodeChangeLane";
import type { AyasCodeApplyDecisionRecord, AyasCodeApplyRecord, AyasCodeApplyStatus, AyasCodeChangeStore } from "./AyasCodeChangeStore";
import { ayasCheckEnv } from "./AyasCheckEnv";
import { pushAyasBranchWithRetry } from "./AyasGitPushRetry";
import { runGuardedAyasPublication, type AyasGuardedPublicationGuardDeps } from "./AyasGuardedPublication";
import { closeAyasPostPublication } from "./AyasPostPublicationClosure";

/**
 * Carries out one owner "ONAYLA VE UYGULA" on a developer build (owner decision 2026-11-09; CLAUDE.md standing
 * exception for this click). First the build is proven from Git alone: its branch still points at the commit the owner
 * approved, whose only parent is the build's base, which changes exactly the recorded files to exactly the recorded
 * bytes and carries the job trailer; every file is inside the code lane. Then:
 *   - HEAD is still the build's base: the build commit itself is fast-forwarded (the published commit is the reviewed
 *     one, its checks stand);
 *   - HEAD moved on: none of the build's files may have changed since its base (else STALE: the job goes back to the
 *     queue and is built again on the new code), and the build's checks run again in a separate worktree of HEAD with
 *     the build's files in place (failing: STALE as well); only then is the commit cherry-picked.
 * The commit and the push go through the guarded publication's code-change lane (clean tree, exact files, no force,
 * never a reset after a commit), then the established post-publication closure (Graphify for the new HEAD). The live
 * copy follows through the standing automatic live publish (AyasAutoLivePublish) on the executor's next run.
 *
 * Effectful (git, node): reached only from scripts/ayas-update-executor.ts.
 */
export interface AyasCodeApplyOutcome {
  readonly status: AyasCodeApplyStatus;
  readonly commitSha?: string;
  readonly reasons: readonly string[];
}

export interface AyasCodeApplyDeps {
  readonly repoRoot: string;
  readonly gateRoot?: string;
  readonly store: AyasCodeChangeStore;
  readonly remoteName?: string;
  readonly now?: () => string;
  readonly guard?: AyasGuardedPublicationGuardDeps;
  /** Test seam; production runs the established `graphify update` closure for the new HEAD. */
  readonly postPublicationClosure?: (head: string) => void;
  /** Test seam; production runs the build's checks in a separate worktree of `head` (reverifyAyasCodeBuild). */
  readonly reverify?: (head: string, build: AyasCodeBuild) => Promise<{ readonly ok: boolean; readonly summary: string }>;
  /** Writes the outcome into the development queue's job (the executor passes the V3 store). Best effort. */
  readonly report?: (jobId: string, outcome: AyasCodeApplyOutcome) => Promise<void>;
  readonly push?: (repoRoot: string, remoteName: string, branch: string) => void;
}

const git = (repoRoot: string, args: readonly string[]): string =>
  execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 16_000_000 }).trim();
const tryGit = (repoRoot: string, args: readonly string[]): string | undefined => { try { return git(repoRoot, args); } catch { return undefined; } };
/** A file's exact bytes at a commit, or undefined when the commit has no such file. */
function showBytes(repoRoot: string, commit: string, file: string): Buffer | undefined {
  try { return execFileSync("git", ["show", `${commit}:${file}`], { cwd: repoRoot, windowsHide: true, timeout: 120_000, maxBuffer: 64_000_000, stdio: ["ignore", "pipe", "ignore"] }); } catch { return undefined; }
}
const lines = (text: string | undefined): string[] => (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const sortedPaths = (build: Pick<AyasCodeBuild, "files">): string[] => build.files.map((file) => file.path).sort();

/** Read-only proof that the branch still holds exactly the build the owner approved. Returns why not, or undefined. */
export function proveAyasCodeBuild(repoRoot: string, build: AyasCodeBuild, buildHash: string): string | undefined {
  if (ayasCodeBuildHash(build) !== buildHash) return "yapının kimliği onaylanan karttaki ile aynı değil";
  const refused = ayasCodeLaneRefusals(build.files.map((file) => file.path));
  if (refused.length) return `kod hattının dışında dosya: ${refused.map((entry) => `${entry.file} (${entry.why})`).join(", ").slice(0, 300)}`;
  if (tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${build.branch}^{commit}`]) !== build.commit) return `dal ${build.branch} artık onaylanan commit'i göstermiyor`;
  const parents = (tryGit(repoRoot, ["rev-list", "--parents", "-n", "1", build.commit]) ?? "").split(/\s+/).filter(Boolean).slice(1);
  if (JSON.stringify(parents) !== JSON.stringify([build.baseHead])) return "yapı commit'inin tabanı kayıttaki taban değil";
  const changed = lines(tryGit(repoRoot, ["diff", "--name-only", "--no-renames", build.baseHead, build.commit])).sort();
  if (JSON.stringify(changed) !== JSON.stringify(sortedPaths(build))) return "yapının değiştirdiği dosyalar kayıttakiyle aynı değil";
  for (const file of build.files) {
    const bytes = showBytes(repoRoot, build.commit, file.path);
    if (file.sha256 === null ? bytes !== undefined : bytes === undefined || ayasCodeContentSha256(bytes) !== file.sha256) return `${file.path} onaylanan içerikte değil`;
  }
  if (!(tryGit(repoRoot, ["log", "-1", "--format=%B", build.commit]) ?? "").includes(ayasCodeJobTrailer(build.jobId))) return "yapı commit'i iş etiketini taşımıyor";
  return undefined;
}

/**
 * The environment a build's re-verification runs with: secrets never reach a check (the shared `ayasCheckEnv` rule,
 * the same one the V3 developer's checks use — owner 2026-11-12, "kalan güvenlik açıklarını kapatalım": this runner's
 * own list had drifted and still passed GEMINI/GOOGLE/GH_* credentials, GIT_ASKPASS, passphrases, sessions and V3's
 * secrets-file pointer), and TEMP/TMP and the npm cache stay on D (owner rule). Pure; exported for its smoke.
 */
export function ayasCodeCheckEnv(repoRoot: string, env: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  const temp = path.join(path.resolve(repoRoot, "..", "..", "private", "temp"));
  return { ...ayasCheckEnv(env), TEMP: temp, TMP: temp, NPM_CONFIG_CACHE: path.join(path.resolve(repoRoot, "..", "..", "private", "npm-cache")) };
}

const LINKS = ["node_modules", path.join("remotion-v3", "node_modules")];

/** A junction is removed on its own (never entered): removing the worktree with it in place could empty the checkout's node_modules. */
function removeLink(link: string): boolean {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(link); } catch { return true; }
  if (!stat.isSymbolicLink()) return !stat.isDirectory();
  try { fs.unlinkSync(link); } catch { try { fs.rmdirSync(link); } catch { return false; } }
  return !fs.existsSync(link);
}

function dropVerifyWorktree(repoRoot: string, dir: string): void {
  if (fs.existsSync(dir)) {
    // A link that would not go keeps the worktree: never risk deleting through it.
    if (!LINKS.every((link) => removeLink(path.join(dir, link)))) return;
    tryGit(repoRoot, ["worktree", "remove", "--force", dir]);
  }
  tryGit(repoRoot, ["worktree", "prune"]);
}

/**
 * The build's checks on a newer HEAD: a detached worktree of `head` with the build's files written in, the
 * checkout's dependencies linked, then the type check, the lint and the build's own smoke suites. Nothing in the
 * checkout changes; the worktree goes afterwards.
 */
export async function reverifyAyasCodeBuild(repoRoot: string, head: string, build: AyasCodeBuild): Promise<{ readonly ok: boolean; readonly summary: string }> {
  const dir = path.join(path.dirname(path.resolve(repoRoot)), "gelistirme", `_uygula-${build.jobId}`);
  dropVerifyWorktree(repoRoot, dir);
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    git(repoRoot, ["worktree", "add", "--detach", dir, head]);
    for (const link of LINKS) {
      const target = path.join(path.resolve(repoRoot), link);
      if (fs.existsSync(target) && !fs.existsSync(path.join(dir, link))) fs.symlinkSync(target, path.join(dir, link), "junction");
    }
    for (const file of build.files) {
      const target = path.join(dir, ...file.path.split("/"));
      if (file.sha256 === null) { fs.rmSync(target, { force: true }); continue; }
      const bytes = showBytes(repoRoot, build.commit, file.path);
      if (!bytes) return { ok: false, summary: `${file.path} yapıdan okunamadı` };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    const tsx = path.join("node_modules", "tsx", "dist", "cli.mjs");
    const checks: { readonly label: string; readonly args: readonly string[] }[] = [
      { label: "tsc --noEmit", args: [path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit"] },
      { label: "lint", args: [path.join("scripts", "lint-yerel.mjs")] },
      ...build.smokes.filter((smoke) => fs.existsSync(path.join(dir, ...smoke.split("/")))).slice(0, 40).map((smoke) => ({ label: smoke, args: [tsx, path.join(...smoke.split("/"))] })),
    ];
    const env = ayasCodeCheckEnv(repoRoot);
    for (const check of checks) {
      const run = spawnSync(process.execPath, [...check.args], { cwd: dir, env: env as NodeJS.ProcessEnv, encoding: "utf8", windowsHide: true, timeout: 20 * 60_000, maxBuffer: 32_000_000 });
      if (run.status !== 0) return { ok: false, summary: `${check.label}: ${`${run.stdout ?? ""}${run.stderr ?? ""}`.trim().slice(-300) || (run.error?.message ?? `çıkış ${run.status}`)}` };
    }
    return { ok: true, summary: `${checks.length} kontrol yeni kodda geçti` };
  } catch (error) {
    return { ok: false, summary: `yeniden doğrulama yapılamadı: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}` };
  } finally {
    dropVerifyWorktree(repoRoot, dir);
  }
}

type LaneOutcome = { readonly ok: true; readonly commitSha: string } | { readonly ok: false; readonly stage: string; readonly reason: string; readonly commitSha?: string };

/** The code-change lane's own pipeline, handed to the guard unmodified. */
function publishCodeChange(build: AyasCodeBuild, head: string, repoRoot: string, remoteName: string, push: NonNullable<AyasCodeApplyDeps["push"]>): LaneOutcome {
  if (git(repoRoot, ["status", "--porcelain"]).length) return { ok: false, stage: "PRECONDITION", reason: "çalışma ağacı temiz değil" };
  if (git(repoRoot, ["rev-parse", "HEAD"]) !== head) return { ok: false, stage: "PRECONDITION", reason: "HEAD doğrulamadan sonra değişti" };
  const branch = tryGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch) return { ok: false, stage: "PRECONDITION", reason: "depo bir dalda değil" };
  try {
    if (head === build.baseHead) git(repoRoot, ["merge", "--ff-only", "--quiet", build.commit]);
    else git(repoRoot, ["cherry-pick", "--no-edit", build.commit]);
  } catch (error) {
    // Nothing was committed: a failed fast-forward changes nothing, a failed cherry-pick is aborted.
    if (head !== build.baseHead) tryGit(repoRoot, ["cherry-pick", "--abort"]);
    return { ok: false, stage: "MERGE", reason: (error instanceof Error ? error.message : String(error)).slice(0, 300) };
  }
  const commitSha = git(repoRoot, ["rev-parse", "HEAD"]);
  const changed = lines(tryGit(repoRoot, ["diff", "--name-only", "--no-renames", head, commitSha])).sort();
  if (JSON.stringify(changed) !== JSON.stringify(sortedPaths(build))) return { ok: false, stage: "SCOPE", reason: `commit ${JSON.stringify(changed)} dosyalarını değiştirdi`, commitSha };
  for (const file of build.files) {
    if (tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${commitSha}:${file.path}`]) !== tryGit(repoRoot, ["rev-parse", "--verify", "--quiet", `${build.commit}:${file.path}`])) {
      return { ok: false, stage: "SCOPE", reason: `${file.path} onaylanan içerikte değil`, commitSha };
    }
  }
  try { push(repoRoot, remoteName, branch); } catch (error) {
    return { ok: false, stage: "PUSH", reason: (error instanceof Error ? error.message : String(error)).slice(0, 300), commitSha };
  }
  const remoteHead = tryGit(repoRoot, ["rev-parse", `${remoteName}/${branch}`]);
  if (remoteHead !== commitSha) return { ok: false, stage: "PUSH", reason: `uzak dal ${remoteName}/${branch} ${remoteHead ?? "?"}, ${commitSha} değil`, commitSha };
  return { ok: true, commitSha };
}

/** Carries out one admitted "ONAYLA VE UYGULA". */
export async function runAyasCodeChangeApply(decision: AyasCodeApplyDecisionRecord, build: AyasCodeBuild, deps: AyasCodeApplyDeps): Promise<AyasCodeApplyRecord> {
  const now = deps.now ?? (() => new Date().toISOString());
  const remoteName = deps.remoteName ?? "origin";
  const head = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  let record: AyasCodeApplyRecord = {
    schemaVersion: 1, applyId: `ayas-code-apply-run-${crypto.randomUUID()}`, decisionId: decision.decisionId, jobId: decision.jobId, buildHash: decision.buildHash,
    baseHead: head, status: "RUNNING", startedAt: now(),
  };
  const save = (patch: Partial<AyasCodeApplyRecord>): AyasCodeApplyRecord => { record = { ...record, ...patch }; deps.store.upsertApply(record); return record; };
  const finish = async (patch: Partial<AyasCodeApplyRecord>): Promise<AyasCodeApplyRecord> => {
    const done = save({ ...patch, finishedAt: now() });
    try { await deps.report?.(done.jobId, { status: done.status, ...(done.commitSha ? { commitSha: done.commitSha } : {}), reasons: done.reasons ?? [] }); } catch { /* the queue's record is best effort; this store is the authority */ }
    return done;
  };
  save({});
  try { await deps.report?.(decision.jobId, { status: "RUNNING", reasons: [] }); } catch { /* best effort */ }

  const unproven = decision.jobId !== build.jobId ? "karar başka bir işe ait" : proveAyasCodeBuild(deps.repoRoot, build, decision.buildHash);
  if (unproven) return finish({ status: "REFUSED", reasons: [unproven] });

  let verified: AyasCodeApplyRecord["verified"] = "SAME_BASE";
  if (head !== build.baseHead) {
    if (tryGit(deps.repoRoot, ["merge-base", "--is-ancestor", build.baseHead, head]) === undefined) return finish({ status: "STALE", reasons: ["yapının tabanı bu dalın geçmişinde değil; iş yeni koda göre yeniden yapılacak"] });
    const touched = lines(tryGit(deps.repoRoot, ["diff", "--name-only", "--no-renames", build.baseHead, head, "--", ...sortedPaths(build)]));
    if (touched.length) return finish({ status: "STALE", reasons: [`yapıdan sonra değişen dosya: ${touched.slice(0, 5).join(", ")}; iş yeni koda göre yeniden yapılacak`] });
    const again = await (deps.reverify ?? ((h: string, b: AyasCodeBuild) => reverifyAyasCodeBuild(deps.repoRoot, h, b)))(head, build);
    if (!again.ok) return finish({ status: "STALE", reasons: [`yeni kodda kontroller geçmedi: ${again.summary}`.slice(0, 400)] });
    verified = "REVERIFIED";
  }

  let lane: LaneOutcome | undefined;
  const result = await runGuardedAyasPublication<LaneOutcome>({
    lane: "code-change", subjectId: decision.decisionId, exactFiles: sortedPaths(build), repoRoot: deps.repoRoot,
    gateRoot: deps.gateRoot ?? path.join(deps.repoRoot, "data", "brain", "self-improvement"),
    publish: async () => (lane = publishCodeChange(build, head, deps.repoRoot, remoteName, deps.push ?? ((repo, remote, branch) => { pushAyasBranchWithRetry(repo, remote, branch); }))),
    ...(deps.guard ? { guard: deps.guard } : {}),
  });
  const laneReason = lane && !lane.ok ? [`${lane.stage}: ${lane.reason}`] : [];
  if (result.state !== "COMPLETED" || !lane?.ok) {
    const status: AyasCodeApplyStatus = result.state === "COMPLETED" ? "FAILED" : result.state === "REFUSED" ? "REFUSED" : result.state === "ROLLED_BACK" ? "ROLLED_BACK" : result.state;
    return finish({ status, verified, reasons: [...laneReason, ...("reasons" in result ? result.reasons : [])].slice(0, 6),
      ...(lane && !lane.ok && lane.commitSha ? { commitSha: lane.commitSha, pushed: false } : {}) });
  }

  save({ commitSha: lane.commitSha, pushed: true, verified });
  try {
    (deps.postPublicationClosure ?? ((h) => { closeAyasPostPublication(h, { repoRoot: deps.repoRoot, remoteName }); }))(lane.commitSha);
    save({ closure: { ok: true, summary: "Graphify yeni HEAD için güncel" } });
  } catch (error) {
    save({ closure: { ok: false, summary: (error instanceof Error ? error.message : String(error)).slice(0, 400) } });
  }
  return finish({ status: "COMPLETED", reasons: [verified === "SAME_BASE" ? "yapının kendi commit'i yayınlandı" : "yeni kodda kontroller yeniden geçti; commit üstüne alındı"] });
}

/**
 * An apply left RUNNING by a dead executor. Same HEAD as it started and a clean tree prove nothing happened
 * (ABANDONED, tried again a bounded number of times); a commit carrying the job trailer on the remote is COMPLETED; the
 * same commit only local is a push still owed (FAILED with its commit, for recoverAyasCodeApplyPushes); anything else
 * waits for a human (RECOVERY_REQUIRED).
 */
export function reconcileAyasCodeApplyOrphan(apply: AyasCodeApplyRecord, deps: Pick<AyasCodeApplyDeps, "repoRoot" | "store" | "now" | "remoteName">): AyasCodeApplyRecord {
  const now = deps.now ?? (() => new Date().toISOString());
  const head = git(deps.repoRoot, ["rev-parse", "HEAD"]);
  const clean = git(deps.repoRoot, ["status", "--porcelain"]).length === 0;
  let next: AyasCodeApplyRecord;
  if (head === apply.baseHead && clean) next = { ...apply, status: "ABANDONED", finishedAt: now(), reasons: ["uygulama yarıda kesildi; hiçbir şey değişmemişti"] };
  else {
    const message = tryGit(deps.repoRoot, ["log", "-1", "--format=%B", head]) ?? "";
    const branch = tryGit(deps.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    const remote = branch ? tryGit(deps.repoRoot, ["rev-parse", `${deps.remoteName ?? "origin"}/${branch}`]) : undefined;
    const parents = (tryGit(deps.repoRoot, ["rev-list", "--parents", "-n", "1", head]) ?? "").split(/\s+/).filter(Boolean).slice(1);
    const ours = clean && message.includes(ayasCodeJobTrailer(apply.jobId)) && JSON.stringify(parents) === JSON.stringify([apply.baseHead]);
    next = ours && remote === head
      ? { ...apply, status: "COMPLETED", commitSha: head, pushed: true, finishedAt: now(), reasons: ["uygulama yarıda kesilmişti; commit ve push tamamlanmış bulundu"] }
      : ours
        ? { ...apply, status: "FAILED", commitSha: head, pushed: false, finishedAt: now(), reasons: ["uygulama yarıda kesildi; commit duruyor, push sonra tamamlanacak"] }
        : { ...apply, status: "RECOVERY_REQUIRED", finishedAt: now(), reasons: ["uygulama yarıda kesildi; depo durumu elle doğrulanmalı"] };
  }
  deps.store.upsertApply(next);
  return next;
}

/** An apply whose commit stood but whose push failed (the guard never resets after a commit). */
export function isAyasCodeApplyPushPending(apply: AyasCodeApplyRecord): boolean {
  return !!apply.commitSha && apply.pushed !== true && (apply.status === "FAILED" || apply.status === "RECOVERY_REQUIRED");
}

/**
 * Self-heal for the code-change lane, the same shape as the other lanes' recovery push: the local HEAD must be exactly
 * this apply's commit (its job trailer, the apply's start HEAD as its only parent, a clean tree) and the remote branch
 * still that parent; then one plain push (never force), the remote proven, and the apply completes.
 */
export function recoverAyasCodeApplyPushes(deps: Pick<AyasCodeApplyDeps, "repoRoot" | "store" | "now" | "remoteName" | "push" | "postPublicationClosure">): readonly { readonly applyId: string; readonly outcome: "PUSHED" | "ALREADY_ON_REMOTE" | "BLOCKED" | "FAILED"; readonly reason: string }[] {
  const now = deps.now ?? (() => new Date().toISOString());
  const remoteName = deps.remoteName ?? "origin";
  const out: { applyId: string; outcome: "PUSHED" | "ALREADY_ON_REMOTE" | "BLOCKED" | "FAILED"; reason: string }[] = [];
  for (const apply of deps.store.load().applies.filter(isAyasCodeApplyPushPending)) {
    const commitSha = apply.commitSha!;
    const branch = tryGit(deps.repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (!branch || tryGit(deps.repoRoot, ["status", "--porcelain"]) !== "") { out.push({ applyId: apply.applyId, outcome: "BLOCKED", reason: "dal yok ya da çalışma ağacı temiz değil" }); continue; }
    const message = tryGit(deps.repoRoot, ["log", "-1", "--format=%B", commitSha]) ?? "";
    const parents = (tryGit(deps.repoRoot, ["rev-list", "--parents", "-n", "1", commitSha]) ?? "").split(/\s+/).filter(Boolean).slice(1);
    if (!message.includes(ayasCodeJobTrailer(apply.jobId)) || JSON.stringify(parents) !== JSON.stringify([apply.baseHead])) { out.push({ applyId: apply.applyId, outcome: "BLOCKED", reason: "yereldeki commit bu uygulamanın commit'i olarak kanıtlanamadı" }); continue; }
    const remoteRef = `${remoteName}/${branch}`;
    tryGit(deps.repoRoot, ["fetch", "--quiet", remoteName, branch]);
    let outcome: "PUSHED" | "ALREADY_ON_REMOTE";
    if (tryGit(deps.repoRoot, ["merge-base", "--is-ancestor", commitSha, remoteRef]) !== undefined) outcome = "ALREADY_ON_REMOTE";
    else {
      if (tryGit(deps.repoRoot, ["rev-parse", "HEAD"]) !== commitSha || tryGit(deps.repoRoot, ["rev-parse", remoteRef]) !== apply.baseHead) { out.push({ applyId: apply.applyId, outcome: "BLOCKED", reason: "uzak dal ya da HEAD bu commit'in tabanında değil" }); continue; }
      try { (deps.push ?? ((repo, remote, b) => { pushAyasBranchWithRetry(repo, remote, b); }))(deps.repoRoot, remoteName, branch); } catch (error) {
        out.push({ applyId: apply.applyId, outcome: "FAILED", reason: `push yine olmadı: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}` }); continue;
      }
      if (tryGit(deps.repoRoot, ["rev-parse", remoteRef]) !== commitSha) { out.push({ applyId: apply.applyId, outcome: "FAILED", reason: "push başarılı dedi ama uzak dalda commit görünmüyor" }); continue; }
      outcome = "PUSHED";
    }
    let record: AyasCodeApplyRecord = { ...apply, status: "COMPLETED", pushed: true, finishedAt: now(), reasons: [...(apply.reasons ?? []), outcome === "PUSHED" ? "push yarıda kalmıştı; commit kanıtlanıp gönderildi" : "commit uzak dalda bulundu"].slice(-6) };
    deps.store.upsertApply(record);
    try {
      (deps.postPublicationClosure ?? ((h) => { closeAyasPostPublication(h, { repoRoot: deps.repoRoot, remoteName }); }))(commitSha);
      record = { ...record, closure: { ok: true, summary: "Graphify yeni HEAD için güncel" } };
    } catch (error) {
      record = { ...record, closure: { ok: false, summary: (error instanceof Error ? error.message : String(error)).slice(0, 400) } };
    }
    deps.store.upsertApply(record);
    out.push({ applyId: apply.applyId, outcome, reason: outcome === "PUSHED" ? "kanıtlandı ve gönderildi" : "zaten uzak dalda" });
  }
  return out;
}
