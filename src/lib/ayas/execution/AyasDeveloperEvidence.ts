/** Closed, read-only developer evidence executors. No caller supplies an executable or raw argument list. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AyasExecutionActionId, AyasExecutionRequest } from "./AyasExecutionPolicy";
import { AyasActionValidationError, type AyasExecutor, type AyasExecutorResult } from "./AyasActionContracts";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const MAX_OUTPUT_CHARS = 48_000;
const MAX_SOURCE_LINES = 240;
const SAFE_ROOTS = ["src/", "scripts/", "app/"] as const;
const SAFE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"]);
const DENIED_SEGMENT = /(^|\/)(?:\.git|node_modules|data|secrets|\.env(?:\.|\/|$)|\.next|\.graphify)(\/|$)/iu;
const SAFE_REF = /^(?!-)(?!.*\.\.)(?!.*[~^:?*\[\\])(?:[A-Za-z0-9][A-Za-z0-9._\/-]{0,99})$/u;
const SAFE_SYMBOL = /^[A-Za-z_$][A-Za-z0-9_.$:/-]{0,119}$/u;

function field(request: AyasExecutionRequest, key: string): unknown { return request.plan[key]; }
function bounded(value: string) {
  const truncated = value.length > MAX_OUTPUT_CHARS;
  return { text: truncated ? value.slice(0, MAX_OUTPUT_CHARS) : value, totalChars: value.length, truncated };
}
function safePath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) throw new AyasActionValidationError("invalid-path", "repository path is missing or too long");
  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (normalized.includes("..") || normalized.includes("\0") || path.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized) || DENIED_SEGMENT.test(normalized)) throw new AyasActionValidationError("path-traversal", "repository path is outside the permitted boundary");
  if (!SAFE_ROOTS.some((root) => normalized.startsWith(root)) && !(normalized.endsWith(".md") && !normalized.includes("/"))) throw new AyasActionValidationError("path-not-allowed", "path must be under src/, scripts/, app/, or a top-level markdown file");
  if (!SAFE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) throw new AyasActionValidationError("extension-not-allowed", "source extension is not allowed");
  const absolute = path.resolve(ROOT, normalized);
  const relative = path.relative(ROOT, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new AyasActionValidationError("path-traversal", "resolved path escaped the repository");
  return normalized;
}
function assertExistingPathContained(absolute: string): void {
  let real: string;
  try { real = fs.realpathSync(absolute); } catch { throw new AyasActionValidationError("source-unavailable", "source file is unavailable"); }
  const relative = path.relative(fs.realpathSync(ROOT), real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new AyasActionValidationError("repository-escape", "resolved source escapes the repository");
}
function controlledEnv(): NodeJS.ProcessEnv {
  const names = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "COMSPEC"];
  return {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]])),
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: ROOT,
  };
}
async function run(executable: string, args: readonly string[], timeout: number) {
  const started = Date.now();
  try {
    const result = await execFileAsync(executable, [...args], { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 1_000_000, env: controlledEnv() });
    const stdout = bounded(result.stdout ?? ""); const stderr = bounded(result.stderr ?? "");
    return { ok: true as const, exitCode: 0, stdout, stderr, timedOut: false, durationMs: Date.now() - started };
  } catch (error) {
    const value = error as Error & { code?: string | number; stdout?: string; stderr?: string; killed?: boolean };
    const stdout = bounded(value.stdout ?? ""); const stderr = bounded(value.stderr ?? value.message);
    return { ok: false as const, exitCode: typeof value.code === "number" ? value.code : null, stdout, stderr, timedOut: value.killed === true || /timed?\s*out/iu.test(value.message), durationMs: Date.now() - started };
  }
}
function result(action: AyasExecutionActionId, summary: string, data: Record<string, unknown>): AyasExecutorResult { return { action, write: false, summary, data }; }
function graphifyCliPath(): string | null {
  const candidates = [path.join(ROOT, "node_modules", "@sentropic", "graphify", "dist", "cli.js")];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@sentropic", "graphify", "dist", "cli.js"));
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}
function graphManifestMatchesWorkingTree(statusText: string): boolean {
  const manifestPath = path.join(ROOT, ".graphify", "manifest.json");
  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size > 5_000_000) return false;
  let manifest: Record<string, { hash?: unknown }>;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as typeof manifest; } catch { return false; }
  for (const line of statusText.split(/\r?\n/u).filter(Boolean)) {
    const relative = line.slice(3).split(" -> ").at(-1)?.replace(/\//gu, path.sep);
    if (!relative || !/^(?:src|scripts|app)[\\/]|^[^\\/]+\.md$/iu.test(relative)) continue;
    const absolute = path.resolve(ROOT, relative);
    const within = path.relative(ROOT, absolute);
    if (!within || within.startsWith("..") || path.isAbsolute(within)) return false;
    const entry = Object.entries(manifest).find(([key]) => path.normalize(key).toLowerCase() === absolute.toLowerCase())?.[1];
    if (!entry || !fs.existsSync(absolute) || typeof entry.hash !== "string" || fs.statSync(absolute).size > 1_000_000) return false;
    const real = fs.realpathSync(absolute); const realRelative = path.relative(fs.realpathSync(ROOT), real);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) return false;
    const hash = crypto.createHash("md5").update(fs.readFileSync(absolute)).digest("hex");
    if (hash !== entry.hash) return false;
  }
  return true;
}

const inspectRepositoryStatus: AyasExecutor = async () => {
  const execution = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], 10_000);
  if (!execution.ok) throw new Error(`git status failed: ${execution.stderr.text}`);
  const entries = execution.stdout.text.split(/\r?\n/u).filter(Boolean).map((line) => {
    const index = line[0] ?? " "; const worktree = line[1] ?? " "; const rawPath = line.slice(3);
    const pair = rawPath.split(" -> ");
    return { path: pair.at(-1) ?? rawPath, originalPath: pair.length > 1 ? pair[0] : null, index, worktree, staged: index !== " " && index !== "?", modified: index === "M" || worktree === "M", deleted: index === "D" || worktree === "D", renamed: index === "R" || worktree === "R", untracked: index === "?" && worktree === "?" };
  });
  return result("inspect-repository-status", entries.length ? `${entries.length} repository change(s) found.` : "Repository is clean.", { clean: entries.length === 0, entries, truncated: execution.stdout.truncated, durationMs: execution.durationMs });
};

const inspectRepositoryDiff: AyasExecutor = async (request) => {
  const mode = field(request, "mode");
  if (mode !== "working" && mode !== "staged" && mode !== "file") throw new AyasActionValidationError("invalid-diff-mode", "mode must be working, staged, or file");
  const args = ["diff", "--no-ext-diff", "--no-color", "--unified=3"];
  let filePath: string | null = null;
  if (mode === "staged") args.push("--staged");
  if (mode === "file") { filePath = safePath(field(request, "filePath")); args.push("--", filePath); }
  const execution = await run("git", args, 15_000);
  if (!execution.ok) throw new Error(`git diff failed: ${execution.stderr.text}`);
  return result("inspect-repository-diff", `${mode} diff inspected${execution.stdout.truncated ? " (truncated)" : ""}.`, { mode, filePath, diff: execution.stdout.text, totalChars: execution.stdout.totalChars, truncated: execution.stdout.truncated, durationMs: execution.durationMs });
};

const inspectGitHistory: AyasExecutor = async (request) => {
  const operation = field(request, "operation");
  if (operation !== "log" && operation !== "show") throw new AyasActionValidationError("invalid-history-operation", "operation must be log or show");
  let args: string[];
  if (operation === "log") {
    const count = field(request, "count") ?? 10;
    if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 30) throw new AyasActionValidationError("invalid-log-count", "count must be an integer from 1 to 30");
    args = ["log", "--oneline", "--no-decorate", `-${count}`];
  } else {
    const ref = field(request, "ref");
    if (typeof ref !== "string" || !SAFE_REF.test(ref)) throw new AyasActionValidationError("invalid-git-ref", "ref has an unsafe shape");
    args = ["show", "--no-ext-diff", "--no-color", "--format=fuller", ref, "--"];
  }
  const execution = await run("git", args, 15_000);
  if (!execution.ok) throw new Error(`git ${operation} failed: ${execution.stderr.text}`);
  return result("inspect-git-history", `Bounded git ${operation} inspected${execution.stdout.truncated ? " (truncated)" : ""}.`, { operation, output: execution.stdout.text, totalChars: execution.stdout.totalChars, truncated: execution.stdout.truncated, durationMs: execution.durationMs });
};

const inspectSourceRange: AyasExecutor = async (request) => {
  const filePath = safePath(field(request, "filePath"));
  const startLine = field(request, "startLine") ?? 1; const endLine = field(request, "endLine") ?? (startLine as number) + 79;
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || (startLine as number) < 1 || (endLine as number) < (startLine as number) || (endLine as number) - (startLine as number) + 1 > MAX_SOURCE_LINES) throw new AyasActionValidationError("invalid-line-range", `line range must contain 1-${MAX_SOURCE_LINES} lines`);
  const absolute = path.resolve(ROOT, filePath);
  assertExistingPathContained(absolute);
  const stat = fs.statSync(absolute); if (!stat.isFile() || stat.size > 1_000_000) throw new AyasActionValidationError("source-size-limit", "source file is unavailable or exceeds 1 MB");
  const lines = fs.readFileSync(absolute, "utf8").split(/\r?\n/u); const selected = lines.slice((startLine as number) - 1, endLine as number);
  return result("inspect-source-range", `${filePath}:${startLine}-${Math.min(endLine as number, lines.length)} read.`, { filePath, startLine, endLine: Math.min(endLine as number, lines.length), totalLines: lines.length, content: selected.join("\n"), truncated: (endLine as number) < lines.length });
};

const queryGraphify: AyasExecutor = async (request) => {
  const symbol = field(request, "symbol");
  if (typeof symbol !== "string" || !SAFE_SYMBOL.test(symbol)) throw new AyasActionValidationError("invalid-graphify-symbol", "Graphify symbol has an unsafe shape");
  const operation = field(request, "operation") ?? "explain";
  if (operation !== "explain" && operation !== "tree") throw new AyasActionValidationError("invalid-graphify-operation", "Graphify operation must be explain or tree");
  const depth = field(request, "depth") ?? 2; const maxChildren = field(request, "maxChildren") ?? 12;
  if (!Number.isInteger(depth) || (depth as number) < 1 || (depth as number) > 3 || !Number.isInteger(maxChildren) || (maxChildren as number) < 1 || (maxChildren as number) > 20) throw new AyasActionValidationError("invalid-graphify-bounds", "Graphify depth/maxChildren exceed 3/20");
  const graphFile = path.join(ROOT, ".graphify", "graph.json");
  if (!fs.existsSync(graphFile)) return result("query-graphify", "Graphify is unavailable; use safe source inspection.", { status: "unavailable", symbol, evidence: [], truncated: false });
  if (fs.statSync(graphFile).size > 32_000_000) return result("query-graphify", "Graphify graph exceeds the input limit; use safe source inspection.", { status: "failure", symbol, evidence: [], truncated: true });
  let graph: { graph?: { built_from_commit?: unknown } };
  try { graph = JSON.parse(fs.readFileSync(graphFile, "utf8")) as typeof graph; } catch { return result("query-graphify", "Graphify graph is malformed; use safe source inspection.", { status: "failure", symbol, evidence: [], truncated: false }); }
  const head = await run("git", ["rev-parse", "HEAD"], 5_000);
  const status = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], 5_000);
  const builtFrom = graph.graph?.built_from_commit;
  if (!head.ok || !status.ok || typeof builtFrom !== "string" || builtFrom !== head.stdout.text.trim() || !graphManifestMatchesWorkingTree(status.stdout.text)) return result("query-graphify", "Graphify graph is stale; use safe source inspection.", { status: "stale", symbol, builtFrom: typeof builtFrom === "string" ? builtFrom : null, head: head.ok ? head.stdout.text.trim() : null, evidence: [], truncated: false });
  const cli = graphifyCliPath();
  if (!cli) return result("query-graphify", "Graphify executable is unavailable; use safe source inspection.", { status: "unavailable", symbol, evidence: [], truncated: false });
  const args = operation === "tree" ? ["tree", symbol, "--depth", String(depth), "--max-children", String(maxChildren)] : ["explain", symbol];
  const execution = await run(process.execPath, [cli, ...args], 15_000);
  if (!execution.ok) return result("query-graphify", "Graphify query failed; use safe source inspection.", { status: execution.timedOut ? "timeout" : "failure", symbol, evidence: [], detail: execution.stderr.text.slice(0, 1_000), truncated: execution.stderr.truncated });
  const candidatePaths = [...execution.stdout.text.matchAll(/(?:Source:\s+|\[src=)((?:src|scripts|app)\/[A-Za-z0-9_.\-/]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md))/gu)].map((match) => match[1]!).slice(0, 24);
  const relatedSymbols = [...execution.stdout.text.matchAll(/^\s*-->\s+([^\[]+)/gmu)].map((match) => match[1]!.trim()).slice(0, 32);
  return result("query-graphify", `Fresh bounded Graphify ${operation} evidence collected for ${symbol}.`, { status: "fresh", operation, symbol, depth: operation === "tree" ? depth : 1, maxChildren: operation === "tree" ? maxChildren : 20, evidence: execution.stdout.text, candidatePaths, relatedSymbols, totalChars: execution.stdout.totalChars, truncated: execution.stdout.truncated, builtFrom, durationMs: execution.durationMs });
};

const VALIDATIONS: Readonly<Record<string, readonly [string, readonly string[], number]>> = Object.freeze({
  typecheck: ["node_modules/typescript/bin/tsc", ["--noEmit", "--incremental", "false"], 120_000], lint: ["node_modules/eslint/bin/eslint.js", ["."], 120_000],
  "smoke-action-runtime": ["node_modules/tsx/dist/cli.mjs", ["scripts/smoke-ayas-action-runtime.ts"], 60_000],
  "smoke-guided-repair": ["node_modules/tsx/dist/cli.mjs", ["scripts/smoke-ayas-guided-repair.ts"], 90_000],
  "smoke-fault-localization": ["node_modules/tsx/dist/cli.mjs", ["scripts/smoke-ayas-fault-localization.ts"], 60_000],
  "smoke-write-action": ["node_modules/tsx/dist/cli.mjs", ["scripts/smoke-ayas-write-action.ts"], 60_000],
});
const runDeveloperValidation: AyasExecutor = async (request) => {
  const validationId = field(request, "validationId");
  if (typeof validationId !== "string" || !(validationId in VALIDATIONS)) throw new AyasActionValidationError("unknown-validation", "validationId is not registered");
  const [entry, args, timeout] = VALIDATIONS[validationId]!;
  const cli = path.join(ROOT, entry);
  if (!fs.existsSync(cli)) return result("run-developer-validation", `Registered validation ${validationId} is unavailable.`, { validationId, status: "unavailable", exitCode: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 0 });
  const execution = await run(process.execPath, [cli, ...args], timeout);
  return result("run-developer-validation", `${validationId}: ${execution.ok ? "PASS" : "FAIL"}.`, { validationId, status: execution.ok ? "passed" : "failed", exitCode: execution.exitCode, stdout: execution.stdout.text, stderr: execution.stderr.text, timedOut: execution.timedOut, truncated: execution.stdout.truncated || execution.stderr.truncated, durationMs: execution.durationMs });
};

type AyasDeveloperActionId = Extract<AyasExecutionActionId, "inspect-repository-status" | "inspect-repository-diff" | "inspect-git-history" | "inspect-source-range" | "query-graphify" | "run-developer-validation">;
export const AYAS_DEVELOPER_EXECUTORS: Readonly<Record<AyasDeveloperActionId, AyasExecutor>> = Object.freeze({
  "inspect-repository-status": inspectRepositoryStatus, "inspect-repository-diff": inspectRepositoryDiff,
  "inspect-git-history": inspectGitHistory, "inspect-source-range": inspectSourceRange,
  "query-graphify": queryGraphify, "run-developer-validation": runDeveloperValidation,
});
