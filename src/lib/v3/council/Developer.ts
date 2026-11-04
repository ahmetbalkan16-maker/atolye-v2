import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { runProcess } from "../util/Proc";
import { DEVELOPER_RULES, type DevJob, forbiddenChanges, taskPacket, usageLimitUntil } from "./DevQueue";
import { type DevProposal, improvementDir, updateProposal } from "./SelfImprovement";

/**
 * The studio's developer (DevQueue): builds one approved proposal in a git worktree of its own, branched from the
 * checkout's HEAD. An unattended Claude Code run (`claude -p`, edits and test commands only, no git) writes the change;
 * the studio then checks it — only V3 files changed, the type check, every V3 smoke and the lint pass — and commits a
 * kept build on its own local branch. It never pushes, never touches the checkout it branched from, and removes its
 * worktree when done (the branch stays for a kept build).
 */
export interface DeveloperDeps {
  /** The git checkout to branch from (the studio's own; its working tree is never changed). */
  readonly repoRoot: string;
  /** The V3 runtime root (proposals, transcripts). */
  readonly workRoot: string;
  /** Where the sandbox worktrees go (default: `gelistirme` next to the checkout). */
  readonly worktreeRoot?: string;
  /** The agent: executable and arguments; the task goes in on stdin, the summary comes out on stdout. */
  readonly agent?: readonly string[];
  /** Commands run in the worktree after the agent, each must exit 0 (default: tsc, every V3 smoke, the lint). */
  readonly checks?: readonly (readonly string[])[];
  readonly agentTimeoutMs?: number;
  /** The developer brain's research note for the job (DevResearch), added to the task. */
  readonly research?: string;
  readonly log: (s: string) => void;
}

const AGENT_TIMEOUT_MS = 45 * 60_000;
const CHECK_TIMEOUT_MS = 20 * 60_000;
/** The agent may read and edit files and run only the type check and the test scripts. */
const AGENT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npx tsc:*)", "Bash(npx tsx scripts/smoke-v3-:*)"];

/** The Claude Code command line (its Node entry, so no shell parses the arguments). */
export function claudeAgent(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const cli = env.ATOLYE_V3_CLAUDE_CLI || path.join(env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs");
  return [process.execPath, cli, "-p", "--permission-mode", "acceptEdits", `--allowedTools=${AGENT_TOOLS.join(",")}`, "--append-system-prompt", DEVELOPER_RULES, "--output-format", "text"];
}

/** The checks a build must pass, run with the worktree's own scripts and the checkout's tools. */
export async function defaultChecks(dir: string): Promise<string[][]> {
  const smokes = (await fs.readdir(path.join(dir, "scripts"))).filter((f) => /^smoke-v3-[\w-]+\.ts$/.test(f)).sort();
  return [
    [process.execPath, path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit"],
    ...smokes.map((s) => [process.execPath, path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", s)]),
    [process.execPath, path.join("scripts", "lint-yerel.mjs")],
  ];
}

/** The paths `git status --porcelain` lists as changed (a rename counts as its new path). */
export function changedPaths(porcelain: string): string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""));
}

const git = (cwd: string, args: readonly string[]) => runProcess("git", ["-c", "core.quotepath=false", ...args], { cwd });

/**
 * A directory link (junction) removed on its own: the folder it points to is never entered. Removing the worktree with
 * its links in place could delete the checkout's own node_modules.
 */
async function removeLink(link: string): Promise<void> {
  const st = await fs.lstat(link).catch(() => undefined);
  if (!st?.isSymbolicLink()) return;
  await fs.unlink(link).catch(() => fs.rmdir(link));
}

const LINKS = ["node_modules", path.join("remotion-v3", "node_modules")];

async function dropWorktree(repoRoot: string, dir: string): Promise<void> {
  for (const l of LINKS) await removeLink(path.join(dir, l));
  if (existsSync(dir)) await git(repoRoot, ["worktree", "remove", "--force", dir]);
  await git(repoRoot, ["worktree", "prune"]);
}

/** Builds one proposal; returns it as it ends up (hazir, yapilamadi, or yapildi when nothing needed changing). */
export async function develop(p: DevProposal, d: DeveloperDeps): Promise<DevProposal> {
  const root = d.worktreeRoot ?? path.join(path.dirname(path.resolve(d.repoRoot)), "gelistirme");
  const dir = path.join(root, p.id);
  const branch = `gelistirme/${p.id}`;
  const record = path.join(improvementDir(d.workRoot), "isler", p.id);
  await fs.mkdir(record, { recursive: true });
  const job: DevJob = { deneme: (p.is?.deneme ?? 0) + 1, baslangic: new Date().toISOString(), kayit: record };
  await updateProposal(d.workRoot, p.id, (q) => ({ ...q, durum: "yapiliyor", is: job }));
  const finish = (durum: DevProposal["durum"], extra: Partial<DevJob>) => updateProposal(d.workRoot, p.id, (q) => ({ ...q, durum, is: { ...job, ...extra, bitis: new Date().toISOString() } }));
  const fail = async (sorunlar: string[]) => {
    d.log(`  geliştirici: "${p.baslik}" tutulmadı — ${sorunlar.join(" | ").slice(0, 300)}`);
    await dropWorktree(d.repoRoot, dir).catch(() => undefined);
    await git(d.repoRoot, ["branch", "-D", branch]).catch(() => undefined);
    return finish("yapilamadi", { sorunlar });
  };
  try {
    // A leftover of an interrupted attempt goes first.
    await dropWorktree(d.repoRoot, dir);
    await git(d.repoRoot, ["branch", "-D", branch]);
    await fs.mkdir(root, { recursive: true });
    const add = await git(d.repoRoot, ["worktree", "add", "-b", branch, dir, "HEAD"]);
    if (add.code !== 0) return await fail([`çalışma kopyası açılamadı: ${(add.stderr || add.stdout).slice(-300)}`]);
    for (const l of LINKS) if (existsSync(path.join(d.repoRoot, l))) await fs.symlink(path.join(path.resolve(d.repoRoot), l), path.join(dir, l), "junction");
    const packet = taskPacket(p, p.is, d.research);
    await fs.writeFile(path.join(record, `gorev-${job.deneme}.md`), packet);
    d.log(`  geliştirici: "${p.baslik}" — ${dir} içinde çalışıyor (deneme ${job.deneme})`);
    const agent = d.agent ?? claudeAgent();
    const run = await runProcess(agent[0]!, agent.slice(1), { cwd: dir, input: packet, timeoutMs: d.agentTimeoutMs ?? AGENT_TIMEOUT_MS });
    await fs.writeFile(path.join(record, `ajan-${job.deneme}.log`), `${run.stdout}\n--- stderr ---\n${run.stderr}`);
    const ozet = run.stdout.trim().slice(-1500);
    const until = run.code !== 0 ? usageLimitUntil(`${run.stdout}\n${run.stderr}`) : undefined;
    if (until) {
      // Claude's usage limit, not the job: back in the queue until it resets, this try not counted.
      const sorun = `Claude kullanım sınırı: ${(run.stderr || run.stdout).trim().slice(-200)}`;
      d.log(`  geliştirici: "${p.baslik}" — ${sorun}; ${until.slice(0, 16)} sonrasına bırakıldı (deneme sayılmadı)`);
      await dropWorktree(d.repoRoot, dir).catch(() => undefined);
      await git(d.repoRoot, ["branch", "-D", branch]).catch(() => undefined);
      return await updateProposal(d.workRoot, p.id, (q) => ({ ...q, durum: "onaylandi", is: { ...job, deneme: job.deneme - 1, bitis: new Date().toISOString(), bekle: until, sorunlar: [sorun] } }));
    }
    if (run.code !== 0) return await fail([`ajan çıkış kodu ${run.code}: ${(run.stderr || run.stdout).trim().slice(-300)}`]);
    const status = await git(dir, ["status", "--porcelain", "-uall"]);
    const dosyalar = changedPaths(status.stdout);
    if (!dosyalar.length) {
      // The agent found the studio already does it (or could do nothing): the owner reads why in the summary.
      d.log(`  geliştirici: "${p.baslik}" — değişiklik gerekmedi`);
      await dropWorktree(d.repoRoot, dir);
      await git(d.repoRoot, ["branch", "-D", branch]);
      return await finish("yapildi", { ozet: `Değişiklik yapılmadı — ${ozet}`, dosyalar: [] });
    }
    const bad = forbiddenChanges(dosyalar);
    if (bad.length) return await fail([`izin dışı dosyalar değişti: ${bad.join(", ")}`]);
    const checks = d.checks ?? (await defaultChecks(dir));
    const outputs: string[] = [];
    for (const c of checks) {
      const r = await runProcess(c[0]!, c.slice(1), { cwd: dir, timeoutMs: CHECK_TIMEOUT_MS });
      outputs.push(`$ ${c.slice(1).join(" ")}\n${r.stdout.slice(-2000)}${r.stderr.slice(-1000)}`);
      if (r.code !== 0) {
        await fs.writeFile(path.join(record, `kontrol-${job.deneme}.log`), outputs.join("\n\n"));
        return await fail([`kontrol geçmedi: ${c.slice(1).join(" ")} — ${(r.stdout + r.stderr).trim().slice(-300)}`]);
      }
    }
    await fs.writeFile(path.join(record, `kontrol-${job.deneme}.log`), outputs.join("\n\n"));
    await git(dir, ["add", "-A"]);
    const commit = await git(dir, ["commit", "-q", "-m", `feat(v3): ${p.baslik.slice(0, 90)}\n\nAtölye geliştiricisi, öneri ${p.id} (owner onayı ${p.karar?.tarih?.slice(0, 10) ?? "?"}).\nKontroller: ${checks.length} komut geçti.\n\n${ozet.slice(0, 1200)}`]);
    if (commit.code !== 0) return await fail([`commit yapılamadı: ${(commit.stderr || commit.stdout).slice(-300)}`]);
    await dropWorktree(d.repoRoot, dir);
    d.log(`  geliştirici: "${p.baslik}" hazır — dal ${branch} (${dosyalar.length} dosya, ${checks.length} kontrol geçti)`);
    return await finish("hazir", { dal: branch, ozet, dosyalar });
  } catch (e) {
    return fail([`geliştirici hatası: ${(e as Error).message.slice(0, 300)}`]);
  }
}

/** One developer at a time: a second one finds the lock of a live process and stops. */
export async function developerLock(workRoot: string): Promise<(() => Promise<void>) | undefined> {
  const lock = path.join(improvementDir(workRoot), ".gelistirici.pid");
  if (existsSync(lock)) {
    const pid = Number((await fs.readFile(lock, "utf8")).trim());
    try {
      if (pid) {
        process.kill(pid, 0);
        return undefined;
      }
    } catch {
      // A lock left by a process that is gone.
    }
  }
  await fs.mkdir(path.dirname(lock), { recursive: true });
  await fs.writeFile(lock, String(process.pid));
  return () => fs.rm(lock, { force: true });
}

/**
 * A kept build into the checkout's current branch (a development session or the owner runs it): fast-forward when it
 * can, else a merge without conflicts; a conflict leaves the branch as it was. The checks run again before any push,
 * which stays the caller's step.
 */
export async function applyBuild(p: DevProposal, cwd: string): Promise<{ ok: boolean; neden: string }> {
  if (p.durum !== "hazir" || !p.is?.dal) return { ok: false, neden: `öneri hazır değil (${p.durum})` };
  const clean = await git(cwd, ["status", "--porcelain"]);
  if (clean.stdout.trim()) return { ok: false, neden: "çalışma ağacı temiz değil" };
  const ff = await git(cwd, ["merge", "--ff-only", p.is.dal]);
  if (ff.code === 0) return { ok: true, neden: `ileri sarıldı (${p.is.dal})` };
  const merge = await git(cwd, ["merge", "--no-edit", p.is.dal]);
  if (merge.code === 0) return { ok: true, neden: `birleştirildi (${p.is.dal})` };
  await git(cwd, ["merge", "--abort"]);
  return { ok: false, neden: `çakışma: ${(merge.stdout + merge.stderr).trim().slice(-300)}` };
}
