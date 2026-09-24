import { execFile, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { applyAyasBoundedFileReplacements } from "./AyasBoundedFileWrite";
import { parseAyasBenchmarkReport, type AyasBenchmarkRunOutcome, type AyasRegressionSuiteResult } from "./AyasResearchExperimentEvaluation";
import { isAyasExperimentProtectedPath, type AyasImprovementBenchmark, type AyasImprovementStrategy } from "./AyasResearchExperimentRegistry";

const execFileAsync = promisify(execFile);

/**
 * Stage 8 — the disposable experiment surface. A sandbox is a `--shared`
 * clone of the repository at an exact commit, created under OS TEMP. The
 * clone only READS the real object database; its `origin` remote is removed
 * so nothing run inside it has a path back to the real repository, and no
 * worktree is registered in the real `.git`. Benchmarks run as single child
 * processes with provider credentials stripped, a mock AI provider, TEMP
 * runtime/authority/workspace roots, TEMP as their OS temp directory, and
 * proxy-aware HTTP routed to a closed local port. Every run is bounded by a
 * timeout that kills the whole process tree. The sandbox is always destroyed.
 */
export class AyasResearchSandboxError extends Error {
  constructor(readonly code: "AYAS_RESEARCH_SANDBOX_INVALID_HEAD" | "AYAS_RESEARCH_SANDBOX_CREATE_FAILED", message: string) {
    super(message);
    this.name = "AyasResearchSandboxError";
    this.stack = undefined;
  }
}

export interface AyasResearchExperimentSandbox {
  readonly runRoot: string;
  readonly repoDir: string;
  readonly baseHead: string;
  readonly nodeModulesLink: string | null;
}

const SANDBOX_PREFIX = "ayas-research-experiment-";
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_REPORT_BYTES = 2_000_000;
const PASS_THROUGH_ENV = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "WINDIR", "ComSpec", "COMSPEC", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "TZ"] as const;

/** Allowlist-only child environment: nothing credential-like from the parent survives. */
export function buildAyasExperimentChildEnv(runRoot: string): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH_ENV) { const value = process.env[key]; if (value !== undefined) env[key] = value; }
  const tmp = path.join(runRoot, "tmp");
  const home = path.join(runRoot, "workspace");
  const homeDrive = path.parse(home).root.replace(/[\\/]$/, "");
  return {
    ...env,
    TEMP: tmp, TMP: tmp, TMPDIR: tmp,
    HOME: home, USERPROFILE: home, HOMEDRIVE: homeDrive, HOMEPATH: home.slice(homeDrive.length),
    APPDATA: path.join(home, "AppData", "Roaming"), LOCALAPPDATA: path.join(home, "AppData", "Local"), XDG_CONFIG_HOME: path.join(home, ".config"),
    NODE_ENV: "test",
    AI_PROVIDER: "mock", IMAGE_PROVIDER: "mock", AUDIO_PROVIDER: "mock", VIDEO_PROVIDER: "mock",
    AYAS_RESEARCH_SCHEDULER_ENABLED: "0",
    AYAS_AUTONOMOUS_EXECUTION_ENABLED: "0",
    ATOLYE_RUNTIME_ROOT: path.join(runRoot, "runtime"),
    ATOLYE_RUNTIME_AUTHORITY_ROOT: path.join(runRoot, "authority"),
    ATOLYE_WORKSPACE_ROOT: path.join(runRoot, "workspace"),
    NODE_USE_ENV_PROXY: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "",
    GIT_TERMINAL_PROMPT: "0",
  } as NodeJS.ProcessEnv;
}

async function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv, timeout = 60_000): Promise<string> {
  // Budgets are derived from performance.now(); child_process only accepts whole milliseconds.
  const { stdout } = await execFileAsync("git", [...args], { cwd, env, encoding: "utf8", windowsHide: true, timeout: Math.max(1, Math.floor(timeout)), maxBuffer: 8_000_000 });
  return stdout;
}

function isOwnedSandboxRoot(runRoot: string): boolean {
  const tmp = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(runRoot);
  return path.dirname(resolved).toLowerCase() === tmp.toLowerCase() && path.basename(resolved).startsWith(SANDBOX_PREFIX);
}

/** Creates the clone at `baseHead`. Fails closed and cleans up after itself on any error. */
export async function createAyasResearchExperimentSandbox(input: { readonly repoRoot: string; readonly baseHead: string; readonly nodeModulesDir?: string; readonly timeoutMs?: number }): Promise<AyasResearchExperimentSandbox> {
  if (!COMMIT.test(input.baseHead)) throw new AyasResearchSandboxError("AYAS_RESEARCH_SANDBOX_INVALID_HEAD", "baseHead must be a full commit id");
  const runRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), SANDBOX_PREFIX));
  const repoDir = path.join(runRoot, "repo");
  const hooks = path.join(runRoot, "no-hooks");
  let nodeModulesLink: string | null = null;
  const sandbox = (): AyasResearchExperimentSandbox => ({ runRoot, repoDir, baseHead: input.baseHead, nodeModulesLink });
  try {
    for (const dir of ["tmp", "runtime", "authority", "workspace", "no-hooks"]) fs.mkdirSync(path.join(runRoot, dir), { recursive: true });
    const env = buildAyasExperimentChildEnv(runRoot);
    // Creation shares the caller's time budget; the clone only reads the real object database.
    const deadline = Date.now() + Math.max(1_000, Math.min(input.timeoutMs ?? 120_000, 240_000));
    const left = () => Math.max(1_000, deadline - Date.now());
    await git(runRoot, ["clone", "--quiet", "--no-checkout", "--shared", "--no-tags", "--", path.resolve(input.repoRoot), repoDir], env, left());
    await git(repoDir, ["remote", "remove", "origin"], env, left());
    await git(repoDir, ["-c", `core.hooksPath=${hooks}`, "checkout", "--quiet", "--detach", input.baseHead], env, left());
    const head = (await git(repoDir, ["rev-parse", "HEAD"], env)).trim();
    if (head !== input.baseHead) throw new Error("sandbox HEAD does not match baseHead");
    const nodeModules = input.nodeModulesDir ?? path.join(input.repoRoot, "node_modules");
    if (fs.existsSync(nodeModules)) {
      const link = path.join(repoDir, "node_modules");
      fs.symlinkSync(nodeModules, link, process.platform === "win32" ? "junction" : "dir");
      nodeModulesLink = link;
    }
    return sandbox();
  } catch (error) {
    await destroyAyasResearchExperimentSandbox(sandbox()).catch(() => false);
    throw new AyasResearchSandboxError("AYAS_RESEARCH_SANDBOX_CREATE_FAILED", error instanceof Error ? error.message.slice(0, 300) : "sandbox creation failed");
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
    else process.kill(-pid, "SIGKILL");
  } catch { /* already gone */ }
}

interface ChildResult { readonly exitCode: number | null; readonly timedOut: boolean; readonly durationMs: number }

function runChild(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ChildResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(process.execPath, [...args], { cwd, env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"], detached: process.platform !== "win32" });
    let exitGrace: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
      // taskkill can fail in a restricted Windows session. Kill the direct
      // benchmark process too, then bound the wait for an exit event.
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      exitGrace = setTimeout(() => finish(null), 2_000);
    }, Math.max(1, Math.floor(timeoutMs)));
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitGrace) clearTimeout(exitGrace);
      resolve({ exitCode, timedOut, durationMs: Math.round(performance.now() - started) });
    };
    child.once("error", () => finish(null));
    child.once("exit", (code) => finish(code));
  });
}

function tsxLoaderArgs(sandbox: AyasResearchExperimentSandbox): readonly string[] | null {
  const loader = path.join(sandbox.repoDir, "node_modules", "tsx", "dist", "loader.mjs");
  return fs.existsSync(loader) ? ["--import", pathToFileURL(loader).href] : null;
}

/** Runs one registered benchmark inside the sandbox and parses its report. Timeout is never a pass. */
export async function runAyasBenchmarkInSandbox(sandbox: AyasResearchExperimentSandbox, benchmark: AyasImprovementBenchmark, timeoutMs: number): Promise<AyasBenchmarkRunOutcome> {
  const loader = tsxLoaderArgs(sandbox);
  if (!loader || !fs.existsSync(path.join(sandbox.repoDir, benchmark.script))) return { ok: false, code: "BENCHMARK_MISSING", durationMs: 0 };
  const reportPath = path.join(sandbox.runRoot, "tmp", `report-${crypto.randomUUID()}.json`);
  const result = await runChild([...loader, benchmark.script, ...benchmark.args, benchmark.reportFlag, reportPath], sandbox.repoDir, buildAyasExperimentChildEnv(sandbox.runRoot), Math.min(timeoutMs, benchmark.timeoutMs));
  if (result.timedOut) return { ok: false, code: "BENCHMARK_TIMEOUT", durationMs: result.durationMs };
  if (result.exitCode !== 0) return { ok: false, code: "BENCHMARK_CRASHED", durationMs: result.durationMs };
  try {
    if (fs.statSync(reportPath).size > MAX_REPORT_BYTES) return { ok: false, code: "REPORT_INVALID", durationMs: result.durationMs };
    const measurement = parseAyasBenchmarkReport(benchmark.benchmarkId, JSON.parse(fs.readFileSync(reportPath, "utf8")), result.durationMs);
    return measurement ? { ok: true, measurement } : { ok: false, code: "REPORT_INVALID", durationMs: result.durationMs };
  } catch {
    return { ok: false, code: "REPORT_INVALID", durationMs: result.durationMs };
  }
}

/** A protected regression suite passes only by exiting 0 within its time budget. */
export async function runAyasRegressionSuiteInSandbox(sandbox: AyasResearchExperimentSandbox, script: string, timeoutMs: number): Promise<AyasRegressionSuiteResult> {
  const loader = tsxLoaderArgs(sandbox);
  if (!loader || !/^scripts\/smoke-[a-z0-9-]+\.ts$/.test(script) || !fs.existsSync(path.join(sandbox.repoDir, script))) return { script, pass: false, timedOut: false, durationMs: 0 };
  const result = await runChild([...loader, script], sandbox.repoDir, buildAyasExperimentChildEnv(sandbox.runRoot), timeoutMs);
  return { script, pass: !result.timedOut && result.exitCode === 0, timedOut: result.timedOut, durationMs: result.durationMs };
}

const sha256 = (value: string): string => crypto.createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Applies a registered strategy's generated change inside the sandbox only.
 * The strategy sees file contents through a read function confined to the
 * sandbox copy; every written path must be one of its declared exact files,
 * already exist, and not be protected. Writes go through the same bounded
 * primitive Package C uses, rooted at the sandbox.
 */
export async function applyAyasStrategyInSandbox(sandbox: AyasResearchExperimentSandbox, strategy: AyasImprovementStrategy): Promise<{ readonly applied: boolean; readonly violations: readonly string[] }> {
  const readFile = (relativePath: string): string | null => {
    const normalized = String(relativePath ?? "").replace(/\\/g, "/");
    if (!strategy.exactFiles.includes(normalized)) return null;
    try { return fs.readFileSync(path.join(sandbox.repoDir, normalized), "utf8"); } catch { return null; }
  };
  let changes: ReturnType<AyasImprovementStrategy["generate"]>;
  try { changes = strategy.generate({ readFile }); } catch { return { applied: false, violations: ["STRATEGY_GENERATE_FAILED"] }; }
  if (!Array.isArray(changes) || changes.length === 0) return { applied: false, violations: [] };
  const violations: string[] = [];
  const replacements = [];
  for (const change of changes) {
    const filePath = String(change?.filePath ?? "").replace(/\\/g, "/");
    if (!strategy.exactFiles.includes(filePath)) { violations.push("FILE_OUTSIDE_STRATEGY_SCOPE"); continue; }
    if (isAyasExperimentProtectedPath(filePath)) { violations.push("PROTECTED_FILE"); continue; }
    if (typeof change.content !== "string" || change.content.length > 400_000) { violations.push("CONTENT_INVALID"); continue; }
    const current = readFile(filePath);
    if (current === null) { violations.push("FILE_CREATION_NOT_ALLOWED"); continue; }
    replacements.push({ filePath, expectedHash: sha256(current), content: change.content });
  }
  if (violations.length > 0) return { applied: false, violations: [...new Set(violations)] };
  try {
    await applyAyasBoundedFileReplacements(sandbox.repoDir, ["src/"], replacements, async () => undefined);
  } catch {
    return { applied: false, violations: ["BOUNDED_WRITE_REFUSED"] };
  }
  return { applied: true, violations: [] };
}

export interface AyasSandboxChange {
  readonly changedPaths: readonly string[];
  readonly files: readonly { readonly filePath: string; readonly addedLines: number; readonly removedLines: number }[];
  readonly diff: string;
}

/**
 * Everything that differs from `baseHead` in the sandbox: tracked, untracked
 * and gitignored paths alike (a benchmark writing into ignored runtime folders
 * is a hermeticity breach too). Only the `node_modules` junction is excluded;
 * see `stampAyasNodeModules` for writes through it.
 */
export async function captureAyasSandboxChange(sandbox: AyasResearchExperimentSandbox): Promise<AyasSandboxChange> {
  const env = buildAyasExperimentChildEnv(sandbox.runRoot);
  const status = await git(sandbox.repoDir, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored=matching", "-z"], env);
  const changedPaths = status.split("\0").filter(Boolean).map((entry) => entry.slice(3).replace(/\\/g, "/").replace(/\/$/, "")).filter((entry) => entry && entry !== "node_modules" && !entry.startsWith("node_modules/")).sort();
  const numstat = await git(sandbox.repoDir, ["diff", "--no-color", "--numstat", "HEAD", "--"], env);
  const files = numstat.split("\n").filter(Boolean).map((line) => {
    const [added, removed, ...rest] = line.split("\t");
    return { filePath: rest.join("\t").replace(/\\/g, "/"), addedLines: Number(added) || 0, removedLines: Number(removed) || 0 };
  });
  const diff = await git(sandbox.repoDir, ["diff", "--no-color", "HEAD", "--"], env);
  return { changedPaths, files, diff };
}

export function readAyasSandboxToolVersions(sandbox: AyasResearchExperimentSandbox): { readonly tsx: string | null; readonly typescript: string | null } {
  const version = (name: string): string | null => {
    try { return String((JSON.parse(fs.readFileSync(path.join(sandbox.repoDir, "node_modules", name, "package.json"), "utf8")) as { version?: unknown }).version ?? "") || null; } catch { return null; }
  };
  return { tsx: version("tsx"), typescript: version("typescript") };
}

/**
 * A cheap fingerprint of the shared `node_modules` directory (its own mtime
 * and top-level entry count). The sandbox reads it through a junction, so a
 * run that adds or removes a top-level entry there would reach the live
 * workspace; a changed stamp is treated as the live workspace having moved.
 * Nested in-place edits are not detected — a documented limitation.
 */
export function stampAyasNodeModules(nodeModulesDir: string): string {
  try { const stat = fs.statSync(nodeModulesDir); return `${Math.round(stat.mtimeMs)}:${fs.readdirSync(nodeModulesDir).length}`; } catch { return "missing"; }
}

/**
 * Removes research sandboxes a killed process left behind: only directories
 * with this module's prefix directly under OS TEMP, older than `olderThanMs`,
 * and not in `keep`. Each goes through the same junction-first teardown.
 */
export async function sweepAyasStaleResearchSandboxes(olderThanMs: number, keep: ReadonlySet<string> = new Set()): Promise<readonly string[]> {
  const tmp = fs.realpathSync(os.tmpdir());
  const removed: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(tmp).filter((name) => name.startsWith(SANDBOX_PREFIX)); } catch { return removed; }
  for (const name of names) {
    const runRoot = path.join(tmp, name);
    if (keep.has(runRoot)) continue;
    try { if (Date.now() - fs.statSync(runRoot).mtimeMs < olderThanMs) continue; } catch { continue; }
    if (await destroyAyasResearchExperimentSandbox({ runRoot, repoDir: path.join(runRoot, "repo"), baseHead: "", nodeModulesLink: null })) removed.push(runRoot);
  }
  return removed;
}

/**
 * Removes the `node_modules` junction FIRST (never following it), then the
 * run root — only if it is a directory this module created under OS TEMP.
 * Returns whether the run root is gone.
 */
export async function destroyAyasResearchExperimentSandbox(sandbox: AyasResearchExperimentSandbox): Promise<boolean> {
  if (!isOwnedSandboxRoot(sandbox.runRoot)) return false;
  const link = sandbox.nodeModulesLink ?? path.join(sandbox.repoDir, "node_modules");
  try {
    if (fs.lstatSync(link).isSymbolicLink() || process.platform === "win32") {
      try { fs.rmdirSync(link); } catch { fs.unlinkSync(link); }
    }
  } catch { /* no link */ }
  if (fs.existsSync(link)) return false;
  try { fs.rmSync(sandbox.runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* reported below */ }
  return !fs.existsSync(sandbox.runRoot);
}
