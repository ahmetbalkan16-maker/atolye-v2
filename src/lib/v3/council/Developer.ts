import { execFileSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { type AyasCodeBuild, type AyasCodeScope, ayasCodeBuildHash, ayasCodeContentSha256, ayasCodeJobTrailer } from "../../brain/autonomy/AyasCodeChangeLane";
import { ayasCheckEnv, isAyasCheckEnvDenied } from "../../brain/autonomy/AyasCheckEnv";
import { runProcess } from "../util/Proc";
import { BRAIN_NAMES } from "./Council";
import { ayasPastChanges, similarCaseLines } from "./DevBrain";
import { attemptProblems, AYAS_DEVELOPER_RULES, ayasTaskPacket, DEVELOPER_RULES, type DevJob, forbiddenChanges, LIMIT_PROBLEM, measuredFaults, scopeOf, taskPacket, usageLimitUntil } from "./DevQueue";
import { type DevProposal, improvementDir, listProposals, updateProposal } from "./SelfImprovement";

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
  /** Who writes: Claude (default) or the studio's own apprentice (DevWriter, scripts/v3/cirak-yaz.ts). */
  readonly yazan?: "claude" | "cirak";
}

const AGENT_TIMEOUT_MS = 45 * 60_000;
const CHECK_TIMEOUT_MS = 20 * 60_000;
/**
 * The agent may read and edit files and run only the type checks, the test scripts and the local lint (since 6 Nov
 * 2026: a lint failure used to surface only in the studio's checks after the run and threw the whole build away).
 */
const AGENT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npx tsc:*)", "Bash(npx tsx scripts/smoke-v3-:*)", "Bash(node scripts/lint-yerel.mjs:*)", "Bash(node remotion-v3/node_modules/typescript/bin/tsc:*)"];
/**
 * A main-AYAS job (owner decision 2026-11-09) may run any smoke suite and, after a UI change, the project's UI audit
 * skill (its own throwaway server on 127.0.0.1:3210, refused in the live checkout) — never the suite that registers a
 * real Windows scheduled task.
 */
const AYAS_AGENT_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npx tsc:*)", "Bash(npx tsx scripts/smoke-:*)", "Bash(node scripts/lint-yerel.mjs:*)", "Bash(node remotion-v3/node_modules/typescript/bin/tsc:*)", "Bash(node .claude/skills/ayas-ui-audit/scripts/run-audit.mjs:*)"];
const AYAS_AGENT_DENIED = ["Bash(npx tsx scripts/smoke-ayas-observer-autostart.ts:*)"];

/** The Claude Code command line (its Node entry, so no shell parses the arguments). */
export function claudeAgent(env: Readonly<Record<string, string | undefined>> = process.env, kapsam: AyasCodeScope = "v3"): string[] {
  const cli = env.ATOLYE_V3_CLAUDE_CLI || path.join(env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "cli-wrapper.cjs");
  if (kapsam === "ayas") return [process.execPath, cli, "-p", "--permission-mode", "acceptEdits", `--allowedTools=${AYAS_AGENT_TOOLS.join(",")}`, `--disallowedTools=${AYAS_AGENT_DENIED.join(",")}`, "--append-system-prompt", AYAS_DEVELOPER_RULES, "--output-format", "text"];
  return [process.execPath, cli, "-p", "--permission-mode", "acceptEdits", `--allowedTools=${AGENT_TOOLS.join(",")}`, "--append-system-prompt", DEVELOPER_RULES, "--output-format", "text"];
}

/**
 * What Windows, Node and Git Bash need for Claude Code and the commands it may run (npx tsc, npx tsx, node) to start:
 * the search path, the system and user folders, TEMP/TMP, the processor description and locale, the npm cache and
 * Node's own options. Compared upper-cased (Windows names are case-insensitive: `Path` is PATH).
 */
const AGENT_ENV_SYSTEM: ReadonlySet<string> = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS", "TEMP", "TMP", "TMPDIR",
  "USERPROFILE", "HOME", "HOMEDRIVE", "HOMEPATH", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "ALLUSERSPROFILE", "PUBLIC", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL", "PROCESSOR_REVISION", "LANG", "LC_ALL", "TZ", "TERM", "NPM_CONFIG_CACHE", "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
]);
/**
 * Claude Code's own sign-in and configuration, passed only when set. On this machine it signs in with the owner's
 * Claude login (`%USERPROFILE%\.claude\.credentials.json`, found through USERPROFILE — no variable at all); an API key,
 * token, endpoint or config folder set for Claude Code itself still reaches it. Bedrock/Vertex switches are not
 * passed: they would hand Claude the AWS/Google credentials the studio's providers use.
 */
const AGENT_ENV_CLAUDE: ReadonlySet<string> = new Set([
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH",
]);

/**
 * The environment the unattended Claude Code build agent (`claude -p`) runs with (owner 2026-11-12: "kalan güvenlik
 * açıklarını kapatalım"). Until then it got the order watcher's whole environment — the OpenAI key (a Windows user
 * variable here), YouTube OAuth, GitHub tokens, V3's secrets-file pointer, AYAS's own keys — while its task comes
 * partly from LLM-written reports of fetched material and its Bash runs the code it writes. An allow list: only
 * `AGENT_ENV_SYSTEM` (still without anything credential-shaped by the shared check rule) and Claude's own
 * `AGENT_ENV_CLAUDE`. Nested-session markers of a Claude session that started the queue (CLAUDECODE,
 * CLAUDE_CODE_SESSION_ID, its messaging socket…) do not pass either. The apprentice (yazan "cirak") is not covered: its
 * writer needs the studio's model key and keeps the full environment, its checks stay scrubbed (DevWriter.runChecks).
 * Pure; files are not covered (an agent can still read a file by its path).
 */
export function claudeAgentEnv(env: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (AGENT_ENV_CLAUDE.has(upper) || (AGENT_ENV_SYSTEM.has(upper) && !isAyasCheckEnvDenied(name))) out[name] = value;
  }
  return out as NodeJS.ProcessEnv;
}

/** Suites never run by a build's checks: helpers another suite spawns, the scheduled-task probe, frozen evidence. */
const NOT_RUN = new Set(["smoke-ayas-observer-autostart.ts", "smoke-sprint-129-36-race-worker.ts", "smoke-ayas-retrieval-evaluation.ts", "smoke-ayas-owner-approval-resume.ts"]);
/** Every main-AYAS build: no new effectful reach left unclassified, and the eval yardstick's protection intact. */
const AYAS_ALWAYS = ["smoke-ayas-action-firewall-closure.ts", "smoke-ayas-eval-yardstick-protection.ts"];
export const MAX_AYAS_SMOKES = 40;

/**
 * A main-AYAS build's checks (CLAUDE.md: grep scripts/ for a changed file's name to find its suites): the type check,
 * the suites the build changed, the two closure suites above, every suite that names a changed module, every V3 suite
 * when V3 files changed (at most MAX_AYAS_SMOKES suites), then the lint.
 */
export async function ayasChecks(dir: string, files: readonly string[]): Promise<string[][]> {
  const all = (await fs.readdir(path.join(dir, "scripts"))).filter((f) => /^smoke-[\w.-]+\.ts$/.test(f) && !NOT_RUN.has(f)).sort();
  const changed = files.map((f) => f.replace(/\\/g, "/"));
  const changedSmokes = changed.filter((f) => /^scripts\/smoke-[\w.-]+\.ts$/.test(f)).map((f) => f.slice("scripts/".length)).filter((f) => all.includes(f));
  const names = [...new Set(changed.filter((f) => !/^scripts\/smoke-/.test(f) && /\.(?:tsx?|mjs|json)$/.test(f)).map((f) => path.posix.basename(f).replace(/\.(?:tsx?|mjs|json)$/, "")))].filter((n) => n.length >= 4);
  const related: string[] = [];
  if (names.length) {
    for (const s of all) {
      if (changedSmokes.includes(s)) continue;
      const text = await fs.readFile(path.join(dir, "scripts", s), "utf8").catch(() => "");
      if (names.some((n) => text.includes(`/${n}"`) || text.includes(`/${n}'`) || text.includes(`/${n}.`))) related.push(s);
    }
  }
  const v3 = changed.some((f) => /^(?:src\/lib\/v3\/|scripts\/v3\/|remotion-v3\/src\/|content\/v3\/)/.test(f)) ? all.filter((s) => s.startsWith("smoke-v3-")) : [];
  const smokes = [...new Set([...changedSmokes, ...AYAS_ALWAYS.filter((s) => all.includes(s)), ...related, ...v3])].slice(0, MAX_AYAS_SMOKES);
  const remotionTsc = path.join("remotion-v3", "node_modules", "typescript", "bin", "tsc");
  const remotion = changed.some((f) => f.startsWith("remotion-v3/src/")) && existsSync(path.join(dir, remotionTsc));
  return [
    [process.execPath, path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit"],
    ...(remotion ? [[process.execPath, remotionTsc, "--noEmit", "-p", "remotion-v3"]] : []),
    ...smokes.map((s) => [process.execPath, path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", s)]),
    [process.execPath, path.join("scripts", "lint-yerel.mjs")],
  ];
}

/** A check as the build records it: its arguments after node, forward-slashed. */
const checkLabel = (c: readonly string[]): string => c.slice(1).map((a) => a.replace(/\\/g, "/")).join(" ");
/** The smoke suite a check runs, or undefined. */
const smokeOf = (c: readonly string[]): string | undefined => c.slice(1).map((a) => a.replace(/\\/g, "/")).find((a) => /^scripts\/smoke-[\w.-]+\.ts$/.test(a));

/** A file's exact bytes at a commit of `cwd`'s repository, or undefined when the commit has no such file. */
function showBytes(cwd: string, commit: string, file: string): Buffer | undefined {
  try {
    return execFileSync("git", ["show", `${commit}:${file}`], { cwd, windowsHide: true, timeout: 120_000, maxBuffer: 64_000_000, stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return undefined;
  }
}

/**
 * The checks a build must pass, run with the worktree's own scripts and the checkout's tools. The Remotion package has
 * its own type check (the root tsconfig excludes remotion-v3), run when its dependencies are linked in.
 */
export async function defaultChecks(dir: string): Promise<string[][]> {
  const smokes = (await fs.readdir(path.join(dir, "scripts"))).filter((f) => /^smoke-v3-[\w-]+\.ts$/.test(f)).sort();
  const remotionTsc = path.join("remotion-v3", "node_modules", "typescript", "bin", "tsc");
  return [
    [process.execPath, path.join("node_modules", "typescript", "bin", "tsc"), "--noEmit"],
    ...(existsSync(path.join(dir, remotionTsc)) ? [[process.execPath, remotionTsc, "--noEmit", "-p", "remotion-v3"]] : []),
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

/** The skill folders under `.claude/skills` (one level, and the `ayas` group's members). */
async function skillFolders(root: string): Promise<string[]> {
  const base = path.join(root, ".claude", "skills");
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const e of await fs.readdir(base, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (existsSync(path.join(base, e.name, "SKILL.md"))) out.push(e.name);
    else for (const f of await fs.readdir(path.join(base, e.name), { withFileTypes: true }).catch(() => [])) if (f.isDirectory() && existsSync(path.join(base, e.name, f.name, "SKILL.md"))) out.push(path.join(e.name, f.name));
  }
  return out;
}

/**
 * The checkout's dependencies and its untracked skills, linked into a sandbox worktree (junctions; nothing copied). The
 * Remotion skills are not tracked, so a worktree has only the tracked ones (v3-gelistirici, ayas/*): Claude's evening
 * run and the apprentice see them all (owner, 6 Nov 2026: "skilleri entegre et kullansın").
 */
export async function linkShared(repoRoot: string, dir: string): Promise<void> {
  for (const l of LINKS) if (existsSync(path.join(repoRoot, l)) && !existsSync(path.join(dir, l))) await fs.symlink(path.join(path.resolve(repoRoot), l), path.join(dir, l), "junction");
  for (const s of await skillFolders(repoRoot)) {
    const target = path.join(dir, ".claude", "skills", s);
    if (existsSync(target)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(path.join(path.resolve(repoRoot), ".claude", "skills", s), target, "junction");
  }
}

/** The links go first (never entered), then the worktree and its record. */
export async function dropWorktree(repoRoot: string, dir: string): Promise<void> {
  for (const l of LINKS) await removeLink(path.join(dir, l));
  const skills = path.join(dir, ".claude", "skills");
  for (const e of await fs.readdir(skills, { withFileTypes: true }).catch(() => [])) {
    await removeLink(path.join(skills, e.name));
    if (e.isDirectory()) for (const f of await fs.readdir(path.join(skills, e.name)).catch(() => [])) await removeLink(path.join(skills, e.name, f));
  }
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
  const kapsam = scopeOf(p);
  /** A worktree of the build's base, opened only when a suite fails, to tell an older fault from the build's own. */
  const base: { dir?: string } = {};
  const yazan = d.yazan ?? "claude";
  const job: DevJob = { deneme: (p.is?.deneme ?? 0) + 1, baslangic: new Date().toISOString(), kayit: record, yazan, pid: process.pid };
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
    await linkShared(d.repoRoot, dir);
    const taban = (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
    let packet: string;
    // Every job also gets the most similar past cases (symptom → cause → fix → files; the case library, no model).
    // An AYAS job also gets how the nearest past AYAS changes were done (the developer brain's Git-read code memory).
    if (kapsam === "ayas") packet = ayasTaskPacket(p, p.is, undefined, await similarCaseLines(d.workRoot, `${p.baslik} ${p.neden}`)) + (await ayasPastChanges(d.workRoot, `${p.baslik} ${p.neden}`).catch(() => ""));
    else {
      // The exact faults behind the idea: what its productions measured for this brain (their KURUL.md).
      const kurul = await Promise.all(p.kaynaklar.map((id) => fs.readFile(path.join(d.workRoot, "bolumler", id, "KURUL.md"), "utf8").catch(() => "")));
      const measured = [...new Set(kurul.flatMap((t) => measuredFaults(t, BRAIN_NAMES[p.beyin] ?? p.beyin)))].slice(0, 8);
      packet = taskPacket(p, p.is, d.research, measured, await similarCaseLines(d.workRoot, [p.baslik, p.neden, ...measured].join(" ")));
    }
    await fs.writeFile(path.join(record, `gorev-${job.deneme}.md`), packet);
    d.log(`  geliştirici: "${p.baslik}"${kapsam === "ayas" ? " (ana AYAS)" : ""} — ${dir} içinde ${yazan === "cirak" ? "çırak" : "Claude"} çalışıyor (deneme ${job.deneme})`);
    const agent = d.agent ?? claudeAgent(process.env, kapsam);
    // Claude Code gets only what it needs to start and sign in (claudeAgentEnv); the apprentice keeps its model key.
    const agentEnv = yazan === "claude" ? claudeAgentEnv(process.env) : process.env;
    const run = await runProcess(agent[0]!, agent.slice(1), { cwd: dir, env: agentEnv, input: packet, timeoutMs: d.agentTimeoutMs ?? AGENT_TIMEOUT_MS });
    await fs.writeFile(path.join(record, `ajan-${job.deneme}.log`), `${run.stdout}\n--- stderr ---\n${run.stderr}`);
    const ozet = run.stdout.trim().slice(-1500);
    const until = run.code !== 0 && yazan === "claude" ? usageLimitUntil(`${run.stdout}\n${run.stderr}`) : undefined;
    if (until) {
      // Claude's usage limit, not the job: back in the queue until it resets, this try not counted; why a real try
      // before it was thrown away stays for the next task (attemptProblems).
      const sorun = `${LIMIT_PROBLEM}: ${(run.stderr || run.stdout).trim().slice(-200)}`;
      d.log(`  geliştirici: "${p.baslik}" — ${sorun}; ${until.slice(0, 16)} sonrasına bırakıldı (deneme sayılmadı)`);
      await dropWorktree(d.repoRoot, dir).catch(() => undefined);
      await git(d.repoRoot, ["branch", "-D", branch]).catch(() => undefined);
      return await updateProposal(d.workRoot, p.id, (q) => ({ ...q, durum: "onaylandi", is: { ...job, deneme: job.deneme - 1, bitis: new Date().toISOString(), bekle: until, sorunlar: [sorun, ...attemptProblems(p.is?.sorunlar)] } }));
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
    const bad = forbiddenChanges(dosyalar, kapsam);
    if (bad.length) return await fail([`izin dışı dosyalar değişti: ${bad.join(", ")}`]);
    const checks = d.checks ?? (kapsam === "ayas" ? await ayasChecks(dir, dosyalar) : await defaultChecks(dir));
    const outputs: string[] = [];
    const tabandaDusen: string[] = [];
    const changedSet = new Set(dosyalar.map((f) => f.replace(/\\/g, "/")));
    for (const c of checks) {
      const r = await runProcess(c[0]!, c.slice(1), { cwd: dir, env: ayasCheckEnv(process.env) as NodeJS.ProcessEnv, timeoutMs: CHECK_TIMEOUT_MS });
      outputs.push(`$ ${c.slice(1).join(" ")}\n${r.stdout.slice(-2000)}${r.stderr.slice(-1000)}`);
      if (r.code !== 0) {
        // A main-AYAS build runs suites it did not write: one that fails on the untouched base too (this machine's
        // environment, an older fault) is not the build's, and is recorded instead. A suite the build changed counts.
        const smoke = smokeOf(c);
        if (kapsam === "ayas" && smoke && !changedSet.has(smoke) && (await failsOnBase(d.repoRoot, `${dir}-taban`, taban, c, base))) {
          tabandaDusen.push(smoke);
          outputs.push(`(${smoke} tabanda da düşüyor — yapının hatası sayılmadı)`);
          continue;
        }
        await fs.writeFile(path.join(record, `kontrol-${job.deneme}.log`), outputs.join("\n\n"));
        return await fail([`kontrol geçmedi: ${c.slice(1).join(" ")} — ${(r.stdout + r.stderr).trim().slice(-300)}`]);
      }
    }
    await fs.writeFile(path.join(record, `kontrol-${job.deneme}.log`), outputs.join("\n\n"));
    await git(dir, ["add", "-A"]);
    const who = yazan === "cirak" ? "Atölye çırağı (kendi yazdı, Claude olmadan)" : kapsam === "ayas" ? "AYAS geliştiricisi (Claude)" : "Atölye geliştiricisi (Claude)";
    const source = p.kaynakTuru === "istek" ? `owner isteği ${p.id}` : `öneri ${p.id} (owner onayı ${p.karar?.tarih?.slice(0, 10) ?? "?"})`;
    const commit = await git(dir, ["commit", "-q", "-m", `feat(${kapsam}): ${p.baslik.slice(0, 90)}\n\n${who}, ${source}.\nKontroller: ${checks.length - tabandaDusen.length} komut geçti${tabandaDusen.length ? `, ${tabandaDusen.length} tabanda da düşüyordu` : ""}.\n\n${ozet.slice(0, 1200)}\n\n${ayasCodeJobTrailer(p.id)}`]);
    if (commit.code !== 0) return await fail([`commit yapılamadı: ${(commit.stderr || commit.stdout).slice(-300)}`]);
    // The build's identity, which the owner's "ONAYLA VE UYGULA" binds to (AyasCodeChangeLane).
    const head = (await git(dir, ["rev-parse", "HEAD"])).stdout.trim();
    const names = (await git(dir, ["diff", "--name-only", "--no-renames", taban, head])).stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).sort();
    const dosyaHash = names.map((f) => {
      const bytes = showBytes(dir, head, f);
      return { path: f, sha256: bytes ? ayasCodeContentSha256(bytes) : null };
    });
    const kontroller = checks.map(checkLabel);
    const smokelar = checks.map(smokeOf).filter((s): s is string => !!s && !tabandaDusen.includes(s));
    const build: AyasCodeBuild = { jobId: p.id, scope: kapsam, title: p.baslik, branch, commit: head, baseHead: taban, files: dosyaHash, checks: kontroller, smokes: smokelar };
    await dropWorktree(d.repoRoot, dir);
    d.log(`  geliştirici: "${p.baslik}" hazır — dal ${branch} (${dosyalar.length} dosya, ${checks.length - tabandaDusen.length} kontrol geçti${tabandaDusen.length ? `, ${tabandaDusen.length} tabanda da düşüyordu` : ""})`);
    return await finish("hazir", {
      dal: branch, ozet, dosyalar, commit: head, taban, dosyaHash, kontroller, smokelar, yapiHash: ayasCodeBuildHash(build),
      ...(tabandaDusen.length ? { tabandaDusen } : {}),
    });
  } catch (e) {
    return fail([`geliştirici hatası: ${(e as Error).message.slice(0, 300)}`]);
  } finally {
    if (base.dir) await dropWorktree(d.repoRoot, base.dir).catch(() => undefined);
  }
}

/**
 * Whether a check fails on the build's base too: run once in a detached worktree of the base (opened on the first
 * failure, linked like the build's, removed when the build ends).
 */
async function failsOnBase(repoRoot: string, dir: string, taban: string, c: readonly string[], base: { dir?: string }): Promise<boolean> {
  if (!base.dir) {
    await dropWorktree(repoRoot, dir);
    const add = await git(repoRoot, ["worktree", "add", "--detach", dir, taban]);
    if (add.code !== 0) return false;
    await linkShared(repoRoot, dir);
    base.dir = dir;
  }
  const r = await runProcess(c[0]!, c.slice(1), { cwd: base.dir, env: ayasCheckEnv(process.env) as NodeJS.ProcessEnv, timeoutMs: CHECK_TIMEOUT_MS });
  return r.code !== 0;
}

/** Whether a process is still there (signal 0 only asks). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it is there, only not ours to signal.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Jobs a developer process left "yapiliyor" when it vanished mid-build (a reboot, a watcher restart at go-live): back
 * in the queue, the cut-off try not counted, its worktree cleared by the next try (develop). Until 14 Nov 2026 nothing
 * read such a job again — nextJob takes only "onaylandi" and "yapilamadi" — so it stayed "geliştiriliyor" for ever.
 * Only a job that names its process (`is.pid`, set by develop) and whose process is gone; a job claimed by hand has no
 * pid and stays claimed. Called with the developer lock held (developerLock), so no live developer is building.
 */
export async function recoverInterruptedJobs(workRoot: string, isAlive: (pid: number) => boolean = alive): Promise<DevProposal[]> {
  const out: DevProposal[] = [];
  for (const { proposal: p } of await listProposals(workRoot)) {
    const pid = p.is?.pid;
    if (p.durum !== "yapiliyor" || !pid || pid === process.pid || isAlive(pid)) continue;
    out.push(
      await updateProposal(workRoot, p.id, (q) => ({
        ...q,
        durum: "onaylandi",
        is: { ...q.is!, deneme: Math.max(0, (q.is?.deneme ?? 1) - 1), bitis: new Date().toISOString(), sorunlar: [`geliştirici yarıda kaldı (süreç ${pid} kapandı); deneme sayılmadı`, ...attemptProblems(q.is?.sorunlar)] },
      })),
    );
  }
  return out;
}

/**
 * One developer at a time: a second one finds the lock of a live process and stops. Taking the lock also returns jobs a
 * vanished developer left "yapiliyor" to the queue (recoverInterruptedJobs), so every caller sees them before nextJob.
 */
export async function developerLock(workRoot: string, log?: (s: string) => void): Promise<(() => Promise<void>) | undefined> {
  const lock = path.join(improvementDir(workRoot), ".gelistirici.pid");
  if (existsSync(lock)) {
    const pid = Number((await fs.readFile(lock, "utf8")).trim());
    if (pid && alive(pid)) return undefined;
    // Else a lock left by a process that is gone.
  }
  await fs.mkdir(path.dirname(lock), { recursive: true });
  await fs.writeFile(lock, String(process.pid));
  for (const p of await recoverInterruptedJobs(workRoot).catch((e: Error) => (log?.(`  geliştirici: yarıda kalan işler okunamadı (${e.message.slice(0, 120)})`), []))) log?.(`  geliştirici: "${p.baslik}" yarıda kalmıştı — kuyruğa geri döndü (deneme sayılmadı)`);
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
