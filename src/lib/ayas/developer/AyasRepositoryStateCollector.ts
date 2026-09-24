/**
 * Read-only collector for Stage 10 developer intelligence. It runs a closed
 * set of read-only Git commands (no shell, fixed arguments), reads Graphify's
 * branch/manifest metadata, and lists skill directories and smoke-test
 * sources. It never writes, fetches, stages or changes a ref. The real remote
 * is queried only when the caller opts in (`checkRealRemote`).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { parseAyasGitStatusPorcelainV2, type AyasCommitSummary, type AyasRepositorySnapshot } from "./AyasRepositoryRecovery";
import { classifyAyasTestSafety, extractAyasTestSourceFacts, type AyasTestIndexEntry } from "./AyasDeveloperTestIntelligence";
import type { AyasSkillEvidence, AyasSkillHost } from "./AyasDeveloperSkillIntelligence";

const execFileAsync = promisify(execFile);
const SAFE_REV = /^[0-9A-Za-z][0-9A-Za-z._\/-]{0,99}$/;
const MAX_COMMITS = 200;
const MAX_TEST_FILES = 800;
const MAX_TEST_BYTES = 400_000;
const MAX_FINGERPRINT_BYTES = 2_000_000;

/** Local reads never take optional locks (no index refresh write) and never run an fsmonitor hook. */
async function git(cwd: string, args: readonly string[], timeout = 15_000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", ...args], {
      cwd, timeout, windowsHide: true, maxBuffer: 8_000_000, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch { return null; }
}

export interface AyasCollectedRepositoryState {
  readonly snapshot: AyasRepositorySnapshot;
  /** sha256 of HEAD + dirty paths + their contents; evidence must match it to be reused. */
  readonly stateFingerprint: string;
  readonly graphify: { readonly lastAnalyzedHead: string | null; readonly stale: boolean; readonly coversWorktree: boolean } | null;
  readonly errors: readonly string[];
  /** Status or baseline history could not be established; callers must not derive a recovery from it. */
  readonly fatal: boolean;
}
const FATAL_ERRORS: ReadonlySet<string> = new Set(["GIT_STATUS_FAILED", "BASELINE_NOT_ANCESTOR_OR_UNKNOWN", "BASELINE_LOG_FAILED"]);

export async function collectAyasRepositoryState(options: { readonly cwd: string; readonly trustedBaseline: string; readonly checkRealRemote?: boolean; readonly includeIgnored?: boolean }): Promise<AyasCollectedRepositoryState> {
  const errors: string[] = [];
  const cwd = options.cwd;
  if (!SAFE_REV.test(options.trustedBaseline)) throw new Error("trusted baseline has an unsafe shape");
  const statusArgs = ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", ...(options.includeIgnored ? ["--ignored=matching"] : [])];
  const status = await git(cwd, statusArgs);
  if (status === null) errors.push("GIT_STATUS_FAILED");
  const parsed = parseAyasGitStatusPorcelainV2(status ?? "");
  const upstreamHead = parsed.upstream ? (await git(cwd, ["rev-parse", "--verify", "--quiet", "@{upstream}"]))?.trim() || null : null;
  let remoteHead: string | null = null;
  if (options.checkRealRemote && parsed.upstream && parsed.branch) {
    const remote = parsed.upstream.split("/")[0]!;
    if (SAFE_REV.test(remote) && SAFE_REV.test(parsed.branch)) {
      const out = await git(cwd, ["ls-remote", remote, `refs/heads/${parsed.branch}`], 30_000);
      if (out === null) errors.push("REAL_REMOTE_CHECK_FAILED");
      else remoteHead = out.split(/\s+/)[0] || null;
    }
  }
  // A wrong or unknown baseline would silently read as "nothing committed"; fail closed instead.
  if (await git(cwd, ["merge-base", "--is-ancestor", options.trustedBaseline, "HEAD"]) === null) errors.push("BASELINE_NOT_ANCESTOR_OR_UNKNOWN");
  const log = await git(cwd, ["log", `-n${MAX_COMMITS}`, "--format=%x1e%H%x1f%s", "--name-only", `${options.trustedBaseline}..HEAD`]);
  if (log === null) errors.push("BASELINE_LOG_FAILED");
  const commitsSinceBaseline: AyasCommitSummary[] = (log ?? "").split("\u001e").filter((chunk) => chunk.trim()).map((chunk) => {
    const [headLine, ...rest] = chunk.split("\n");
    const [hash, subject] = headLine!.split("\u001f");
    return { hash: hash!.trim(), subject: (subject ?? "").trim().slice(0, 200), files: rest.map((line) => line.trim()).filter(Boolean) };
  });
  const snapshot: AyasRepositorySnapshot = { ...parsed, upstreamHead, remoteHead, commitsSinceBaseline };

  const hash = crypto.createHash("sha256").update(parsed.head ?? "no-head");
  for (const entry of [...parsed.entries].filter((e) => e.kind !== "ignored").sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`\0${entry.index}${entry.worktree}\0${entry.path}\0`);
    const absolute = path.join(cwd, entry.path);
    try { const stat = fs.statSync(absolute); if (stat.isFile() && stat.size <= MAX_FINGERPRINT_BYTES) hash.update(fs.readFileSync(absolute)); else hash.update(`size:${stat.size}`); } catch { hash.update("missing"); }
  }
  return Object.freeze({ snapshot, stateFingerprint: hash.digest("hex"), graphify: readGraphifyState(cwd, parsed.head, parsed.entries), errors, fatal: errors.some((error) => FATAL_ERRORS.has(error)) });
}

function readGraphifyState(cwd: string, head: string | null, entries: AyasRepositorySnapshot["entries"]): AyasCollectedRepositoryState["graphify"] {
  const branchFile = path.join(cwd, ".graphify", "branch.json");
  let branch: { lastAnalyzedHead?: unknown; stale?: unknown };
  try { branch = JSON.parse(fs.readFileSync(branchFile, "utf8")) as typeof branch; } catch { return null; }
  const lastAnalyzedHead = typeof branch.lastAnalyzedHead === "string" ? branch.lastAnalyzedHead : null;
  let coversWorktree = lastAnalyzedHead !== null && lastAnalyzedHead === head;
  const dirtySource = entries.filter((e) => e.kind !== "ignored" && /^(src|scripts|app)\/|^[^/]+\.md$/.test(e.path) && e.worktree !== "D" && e.index !== "D");
  if (coversWorktree && dirtySource.length) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(cwd, ".graphify", "manifest.json"), "utf8")) as Record<string, { hash?: unknown }>;
      const root = path.resolve(cwd).replace(/\\/g, "/").toLowerCase();
      const byPath = new Map(Object.entries(manifest).map(([key, value]) => [key.replace(/\\/g, "/").toLowerCase(), value]));
      coversWorktree = dirtySource.every((entry) => {
        const recorded = byPath.get(`${root}/${entry.path}`.toLowerCase())?.hash;
        if (typeof recorded !== "string") return false;
        const absolute = path.join(cwd, entry.path);
        return fs.statSync(absolute).size <= MAX_FINGERPRINT_BYTES && crypto.createHash("md5").update(fs.readFileSync(absolute)).digest("hex") === recorded;
      });
    } catch { coversWorktree = false; }
  }
  return Object.freeze({ lastAnalyzedHead, stale: branch.stale === true, coversWorktree });
}

/** Lists skill directories only; SKILL.md bodies are not parsed. */
export function discoverAyasSkillEvidence(options: { readonly cwd: string; readonly host: AyasSkillHost | null; readonly homeDir?: string; readonly reportedRegistered?: readonly string[] }): AyasSkillEvidence {
  const localSkillIds: string[] = [];
  const localRoot = path.join(options.cwd, ".claude", "skills");
  for (const group of safeDirs(localRoot)) {
    if (fs.existsSync(path.join(localRoot, group, "SKILL.md"))) localSkillIds.push(group);
    for (const name of safeDirs(path.join(localRoot, group))) if (fs.existsSync(path.join(localRoot, group, name, "SKILL.md"))) localSkillIds.push(`${group}:${name}`);
  }
  const home = options.homeDir ?? os.homedir();
  const registered = new Set(options.reportedRegistered ?? []);
  // Each host's own skill home is its registration mechanism; project-local nested files are not.
  const hostRoot = options.host === "codex" ? path.join(home, ".codex", "skills") : options.host === "claude" ? path.join(home, ".claude", "skills") : null;
  if (hostRoot) for (const dir of safeDirs(hostRoot)) {
    if (fs.existsSync(path.join(hostRoot, dir, "SKILL.md"))) registered.add(dir);
    if (dir.startsWith(".")) for (const nested of safeDirs(path.join(hostRoot, dir))) if (fs.existsSync(path.join(hostRoot, dir, nested, "SKILL.md"))) registered.add(nested);
  }
  return Object.freeze({ host: options.host, registeredSkillIds: [...registered].sort(), localSkillIds: localSkillIds.sort() });
}

function safeDirs(dir: string): string[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.isSymbolicLink()).map((d) => d.name).slice(0, 200); } catch { return []; }
}

/** Bounded smoke-test index: imports and static safety per script. */
export function buildAyasTestIndex(cwd: string): readonly AyasTestIndexEntry[] {
  const scriptsDir = path.join(cwd, "scripts");
  let names: string[];
  try { names = fs.readdirSync(scriptsDir).filter((name) => /^smoke-[A-Za-z0-9._-]+\.ts$/.test(name)).sort().slice(0, MAX_TEST_FILES); } catch { return []; }
  const index: AyasTestIndexEntry[] = [];
  for (const name of names) {
    const scriptPath = `scripts/${name}`;
    const absolute = path.join(scriptsDir, name);
    let source = "";
    try { const stat = fs.lstatSync(absolute); if (!stat.isFile() || stat.size > MAX_TEST_BYTES) continue; source = fs.readFileSync(absolute, "utf8"); } catch { continue; }
    const importedModules = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!)
      .map((spec) => spec.startsWith("@/") ? `src/${spec.slice(2)}` : spec.startsWith(".") ? path.posix.normalize(path.posix.join("scripts", spec)) : null)
      .filter((value): value is string => value !== null && !value.startsWith(".."))
      .map((value) => value.replace(/\.(ts|tsx|js|mjs|cjs)$/, ""));
    index.push({ scriptPath, importedModules, safety: classifyAyasTestSafety(extractAyasTestSourceFacts(scriptPath, source)) });
  }
  return Object.freeze(index);
}
