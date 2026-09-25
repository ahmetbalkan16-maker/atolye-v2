/**
 * Stage 10A — read-only collector for `AyasGraphifyState`. It runs two fixed,
 * read-only Git commands (no shell, no optional locks), reads `.graphify/`
 * metadata and host configuration files, and inspects the installed Graphify
 * package's own files. It never runs Graphify, never writes, never contacts a
 * network endpoint, and never returns file contents, tokens or absolute
 * machine paths — consumer locations are repo-relative or `~/…`. Like the
 * other developer modules it imports only one another and Node built-ins; the
 * one piece of non-built-in code it loads is Graphify's own `yaml` dependency,
 * and only when a Graphify project config exists and must be parsed.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import {
  AYAS_GRAPHIFY_STATE_DIR, assessAyasGraphifyInstructions, assessAyasGraphifyMcpServer, interpretAyasMcpConfig,
  type AyasGraphifyConsumerFact, type AyasGraphifyExtractionGap, type AyasGraphifyFacts, type AyasGraphifyGraphFact, type AyasMcpConfigHost,
} from "./AyasGraphifyState";

const execFileAsync = promisify(execFile);
const MAX_HASH_BYTES = 2_000_000;
const DOCUMENT_EXT = new Set([".md", ".mdx", ".txt", ".rst"]);
const ASSET_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp3", ".mp4", ".wav", ".m4a", ".mov", ".webm", ".pdf", ".ttf", ".woff", ".woff2"]);
const MCP_CONFIG_NAMES = new Set([".mcp.json", "mcp.json", "claude_desktop_config.json", "mcp_servers.json"]);

async function git(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", ...args], {
      cwd, timeout: 15_000, windowsHide: true, maxBuffer: 8_000_000, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout;
  } catch { return null; }
}

function readJson(file: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly absent: boolean } {
  try { return { ok: true, value: JSON.parse(fs.readFileSync(file, "utf8")) as unknown }; }
  catch (error) { return { ok: false, absent: (error as NodeJS.ErrnoException).code === "ENOENT" }; }
}

/**
 * The global npm `node_modules` holding `@sentropic/graphify` — same resolution as the per-file execution check
 * (`AyasBatchGraphifyCheck.resolveAyasGraphifyGlobalModules`), kept local so the developer modules keep their Stage 10
 * boundary (they import only one another and Node built-ins). The evaluator asserts the two agree.
 */
export function resolveAyasGraphifyModulesForStatus(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AYAS_GRAPHIFY_GLOBAL_MODULES) return env.AYAS_GRAPHIFY_GLOBAL_MODULES;
  if (process.platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "npm", "node_modules");
  return path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
}

const posix = (p: string): string => p.replace(/\\/g, "/");
const extOf = (p: string): string => path.posix.extname(p).toLowerCase();
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `git status --porcelain=v1 -z` → dirty paths, split into ones that existed at HEAD and ones that are new (untracked/added/renamed-to). Deletions are dropped. */
export function parseAyasDirtyPaths(porcelainZ: string): { readonly all: readonly string[]; readonly newPaths: ReadonlySet<string> } {
  const records = porcelainZ.split("\0");
  const all: string[] = [];
  const newPaths = new Set<string>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 4) continue;
    const xy = record.slice(0, 2);
    const file = posix(record.slice(3));
    if (xy[0] === "R" || xy[0] === "C") i += 1; // the source path of a rename/copy follows as its own record
    if (xy.includes("D")) continue;
    all.push(file);
    if (xy === "??" || xy[0] === "A" || xy[0] === "R" || xy[0] === "C") newPaths.add(file);
  }
  return { all: all.sort(), newPaths };
}

/**
 * Which dirty paths the graph does not describe. The last extraction's `manifest.json` (md5 of each indexed
 * file) is the truth about Graphify's scope: a file that existed at HEAD but is absent from the manifest was
 * never indexed (e.g. `.css`), so no refresh can "cover" it — counting it would make recovery loop forever.
 * A NEW file counts only when `isIndexableNewFile` says Graphify would index it (its extension produced nodes).
 */
export function computeAyasGraphifyWorktreeCoverage(input: {
  readonly root: string;
  readonly dirty: { readonly all: readonly string[]; readonly newPaths: ReadonlySet<string> };
  readonly manifestHashes: ReadonlyMap<string, string>;
  readonly isIndexableNewFile: (file: string) => boolean;
  readonly readFile?: (absolute: string) => Buffer;
}): readonly string[] {
  const read = input.readFile ?? ((absolute: string) => fs.readFileSync(absolute));
  const uncovered: string[] = [];
  for (const file of input.dirty.all) {
    const key = file.toLowerCase();
    const recorded = input.manifestHashes.get(key);
    if (recorded === undefined) {
      if (input.dirty.newPaths.has(file) && input.isIndexableNewFile(file)) uncovered.push(file);
      continue;
    }
    try {
      const bytes = read(path.join(input.root, file));
      if (bytes.length > MAX_HASH_BYTES || crypto.createHash("md5").update(bytes).digest("hex") !== recorded) uncovered.push(file);
    } catch { uncovered.push(file); }
  }
  return uncovered;
}

/**
 * Fingerprint of the uncovered dirty paths and their current bytes (size + mtime above the hash limit), so bounded
 * recovery can tell "same HEAD, nothing changed since the last refresh" from "same HEAD, new edits". Null when none.
 */
export function fingerprintAyasUncoveredWorktree(root: string, uncovered: readonly string[]): string | null {
  if (!uncovered.length) return null;
  const hash = crypto.createHash("sha256");
  for (const file of [...uncovered].sort()) {
    const absolute = path.join(root, file);
    let token: string;
    try {
      const stat = fs.statSync(absolute);
      token = stat.size > MAX_HASH_BYTES ? `size:${stat.size}:mtime:${stat.mtimeMs}` : crypto.createHash("md5").update(fs.readFileSync(absolute)).digest("hex");
    } catch { token = "unreadable"; }
    hash.update(`${file}\0${token}\0`);
  }
  return hash.digest("hex");
}

/** Extensions Graphify produced at least one node for — the data-derived meaning of "Graphify indexes this kind of file". */
export function ayasGraphifyNodeProducingExtensions(filesWithNodes: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...filesWithNodes].map(extOf));
}

/** Classifies manifest files that contributed zero nodes. Data-derived: a code extension with no node anywhere is a language Graphify did not extract here. */
export function classifyAyasGraphifyExtractionGaps(indexedFiles: readonly string[], filesWithNodes: ReadonlySet<string>): readonly AyasGraphifyExtractionGap[] {
  const nodeExt = ayasGraphifyNodeProducingExtensions(filesWithNodes);
  const gaps: AyasGraphifyExtractionGap[] = [];
  for (const file of indexedFiles) {
    if (filesWithNodes.has(file.toLowerCase())) continue;
    const ext = extOf(file);
    const kind = MCP_CONFIG_NAMES.has(path.posix.basename(file).toLowerCase()) ? "HOST_SCHEMA_NOT_INGESTED"
      : DOCUMENT_EXT.has(ext) ? "DOCUMENT_WITHOUT_NODES"
        : ASSET_EXT.has(ext) ? "NON_CODE_ASSET"
          : nodeExt.has(ext) ? "CODE_FILE_UNATTRIBUTED" : "LANGUAGE_NOT_EXTRACTED";
    gaps.push({ path: file, kind });
  }
  return gaps.sort((a, b) => a.path.localeCompare(b.path));
}

/** Reads graph.json once and returns only structural counts; the file content itself never leaves this function. */
export function summarizeAyasGraphifyGraph(doc: unknown): { readonly fact: AyasGraphifyGraphFact; readonly filesWithNodes: ReadonlySet<string> } | null {
  if (!isRecord(doc) || !Array.isArray(doc.nodes)) return null;
  const links = Array.isArray(doc.links) ? doc.links : Array.isArray(doc.edges) ? doc.edges : [];
  const ids = new Set<string>();
  const filesWithNodes = new Set<string>();
  let duplicateIds = 0;
  for (const node of doc.nodes) {
    if (!isRecord(node)) continue;
    const id = String(node.id);
    if (ids.has(id)) duplicateIds += 1; else ids.add(id);
    if (typeof node.source_file === "string" && node.source_file) filesWithNodes.add(posix(node.source_file).toLowerCase());
  }
  const seen = new Set<string>();
  let duplicateEdges = 0, dangling = 0, selfLoops = 0;
  for (const link of links) {
    if (!isRecord(link)) continue;
    const source = String(link.source), target = String(link.target);
    if (!ids.has(source) || !ids.has(target)) dangling += 1;
    if (source === target) selfLoops += 1;
    const key = `${source}\0${target}\0${String(link.relation)}`;
    if (seen.has(key)) duplicateEdges += 1; else seen.add(key);
  }
  const meta = isRecord(doc.graph) ? doc.graph : {};
  const provenance = isRecord(meta.provenance) ? meta.provenance : {};
  // `provenance.source_hash` is the commit only for Graphify's git adapter; other adapters put a content hash there.
  const builtFromHead = typeof meta.built_from_commit === "string" ? meta.built_from_commit : typeof provenance.source_hash === "string" && /^[0-9a-f]{40}$/.test(provenance.source_hash) ? provenance.source_hash : null;
  return { fact: { builtFromHead, nodes: ids.size, links: links.length, duplicateIds, duplicateEdges, dangling, selfLoops }, filesWithNodes };
}

/** Subcommand names the installed CLI registers (including hidden ones such as `hook-check`), read from its own entry file. */
export function readAyasGraphifyCliCommands(cliSource: string): ReadonlySet<string> {
  return new Set([...cliSource.matchAll(/\.command\("([a-z][a-z-]*)/g)].map((m) => m[1]!));
}

/** Repo-level MCP configs are also INDEXED by Graphify (its MCP-config ingest), so a host-correct schema Graphify cannot read is noted there — never "fixed" by rewriting the host's schema. */
function mcpConsumer(id: string, host: AyasMcpConfigHost, location: string, doc: ReturnType<typeof readJson>): AyasGraphifyConsumerFact[] {
  if (!doc.ok) return doc.absent ? [] : [{ id, host, location, mode: "remote-mcp", findings: ["UNREADABLE"] }];
  const config = interpretAyasMcpConfig(host, doc.value);
  const base = [...(config.validForHost ? [] : ["SCHEMA_INVALID"]), ...config.unexpectedKeys.map((k) => `UNEXPECTED_KEY:${k}`)];
  return config.servers.filter((s) => /graphify/i.test(`${s.name} ${s.url ?? ""} ${s.command ?? ""} ${s.args.join(" ")}`)).map((server) => ({
    id: `${id}:${server.name}`, host, location,
    mode: server.transport === "http" ? "remote-mcp" as const : "local-mcp" as const,
    findings: [...base, ...assessAyasGraphifyMcpServer(server), ...(!location.startsWith("~") && config.validForHost && !config.graphifyIngestReadable ? ["GRAPHIFY_INGEST_UNSUPPORTED_HOST_SCHEMA"] : [])].sort(),
  }));
}

function instructionConsumer(id: string, host: AyasGraphifyConsumerFact["host"], location: string, file: string, commands: ReadonlySet<string>): AyasGraphifyConsumerFact[] {
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  if (!/graphify/i.test(text)) return [];
  return [{ id, host, location, mode: "cli-rules", findings: commands.size ? assessAyasGraphifyInstructions(text, commands) : ["CLI_COMMANDS_UNKNOWN"] }];
}

function hookConsumers(id: string, host: AyasGraphifyConsumerFact["host"], location: string, doc: ReturnType<typeof readJson>, commands: ReadonlySet<string>): AyasGraphifyConsumerFact[] {
  if (!doc.ok || !isRecord(doc.value) || !isRecord(doc.value.hooks)) return [];
  const out: AyasGraphifyConsumerFact[] = [];
  for (const groups of Object.values(doc.value.hooks)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of isRecord(group) && Array.isArray(group.hooks) ? group.hooks : []) {
        const command = isRecord(hook) && typeof hook.command === "string" ? hook.command : "";
        if (!/graphify/i.test(command)) continue;
        // A quoted binary path may contain spaces (e.g. "C:/Program Files/…/graphify.exe" hook-check).
        const parsed = /^\s*(?:"([^"]*)"|(\S+))\s*(\S*)/.exec(command);
        const binary = parsed?.[1] ?? parsed?.[2] ?? "";
        const sub = parsed?.[3] ?? "";
        const findings: string[] = [];
        if (/[\\/]/.test(binary) && !fs.existsSync(binary)) findings.push("HOOK_BINARY_MISSING");
        else if (/^graphify(\.cmd|\.exe)?$/i.test(path.basename(binary)) && commands.size && sub && !commands.has(sub)) findings.push(`UNKNOWN_COMMAND:${sub}`);
        out.push({ id: `${id}:${out.length}`, host, location, mode: "hook", findings });
      }
    }
  }
  return out;
}

export interface AyasGraphifyCollectOptions {
  readonly cwd: string;
  /** Also read user-level host configs (`~/.claude.json`, VS Code user `mcp.json`, Antigravity, Cursor, Codex). */
  readonly includeUserConsumers?: boolean;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export async function collectAyasGraphifyFacts(options: AyasGraphifyCollectOptions): Promise<AyasGraphifyFacts> {
  const root = path.resolve(options.cwd);
  const env = options.env ?? process.env;
  const stateDir = path.join(root, AYAS_GRAPHIFY_STATE_DIR);
  const head = (await git(root, ["rev-parse", "--verify", "HEAD"]))?.trim() || null;
  const dirty = parseAyasDirtyPaths((await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) ?? "");

  const branchDoc = readJson(path.join(stateDir, "branch.json"));
  const branch: AyasGraphifyFacts["branch"] = !branchDoc.ok ? (branchDoc.absent ? "ABSENT" : "UNREADABLE") : isRecord(branchDoc.value) ? {
    lastSeenHead: typeof branchDoc.value.lastSeenHead === "string" ? branchDoc.value.lastSeenHead : null,
    lastAnalyzedHead: typeof branchDoc.value.lastAnalyzedHead === "string" ? branchDoc.value.lastAnalyzedHead : null,
    stale: branchDoc.value.stale === true,
    staleReason: typeof branchDoc.value.staleReason === "string" ? branchDoc.value.staleReason : null,
  } : "UNREADABLE";

  const graphDoc = readJson(path.join(stateDir, "graph.json"));
  const summary = graphDoc.ok ? summarizeAyasGraphifyGraph(graphDoc.value) : null;
  const graph: AyasGraphifyFacts["graph"] = !graphDoc.ok ? (graphDoc.absent ? "ABSENT" : "UNREADABLE") : summary ? summary.fact : "UNREADABLE";

  const manifestDoc = readJson(path.join(stateDir, "manifest.json"));
  const manifestHashes = new Map<string, string>();
  const indexedFiles: string[] = [];
  if (manifestDoc.ok && isRecord(manifestDoc.value)) {
    for (const [key, value] of Object.entries(manifestDoc.value)) {
      const rel = posix(path.relative(root, key));
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
      indexedFiles.push(rel);
      if (isRecord(value) && typeof value.hash === "string") manifestHashes.set(rel.toLowerCase(), value.hash);
    }
  }
  const filesWithNodes = summary?.filesWithNodes ?? new Set<string>();
  const nodeProducingExtensions = ayasGraphifyNodeProducingExtensions(filesWithNodes);
  const extractionGaps = summary && indexedFiles.length ? classifyAyasGraphifyExtractionGaps(indexedFiles, filesWithNodes) : [];
  // Without a manifest nothing can prove coverage, so every dirty path counts.
  const dirtyUncoveredPaths = manifestDoc.ok ? computeAyasGraphifyWorktreeCoverage({ root, dirty, manifestHashes, isIndexableNewFile: (file) => nodeProducingExtensions.has(extOf(file)) }) : dirty.all;

  const configFiles = ["graphify.yaml", "graphify.yml", path.join(AYAS_GRAPHIFY_STATE_DIR, "config.yaml"), path.join(AYAS_GRAPHIFY_STATE_DIR, "config.yml")].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  const modules = resolveAyasGraphifyModulesForStatus(env);
  const pkgDir = path.join(modules, "@sentropic", "graphify");
  // Resolve Graphify's own optional dependencies relative to its installed package, never the repository's.
  const requireFromGraphify = createRequire(path.join(pkgDir, "package.json"));
  let projectConfig: AyasGraphifyFacts["projectConfig"] = "ABSENT";
  if (configFiles.length) {
    try {
      const yaml = requireFromGraphify("yaml") as { parse: (text: string) => unknown };
      for (const file of configFiles) yaml.parse(fs.readFileSync(file, "utf8"));
      projectConfig = "VALID";
    } catch { projectConfig = "INVALID"; }
  }

  const pkg = readJson(path.join(pkgDir, "package.json"));
  let cliSource = "";
  try { cliSource = fs.readFileSync(path.join(pkgDir, "dist", "cli.js"), "utf8"); } catch { /* unavailable */ }
  const available = pkg.ok && cliSource.length > 0;
  const commands = available ? readAyasGraphifyCliCommands(cliSource) : new Set<string>();
  let localMcpServerAvailable = false;
  if (available) { try { requireFromGraphify.resolve("@modelcontextprotocol/sdk/package.json"); localMcpServerAvailable = true; } catch { /* optional dependency missing */ } }

  const consumers: AyasGraphifyConsumerFact[] = [
    ...mcpConsumer("vscode-workspace-mcp", "vscode", ".vscode/mcp.json", readJson(path.join(root, ".vscode", "mcp.json"))),
    ...instructionConsumer("claude-project-instructions", "claude", "CLAUDE.md", path.join(root, "CLAUDE.md"), commands),
    ...instructionConsumer("codex-agents-instructions", "codex", "AGENTS.md", path.join(root, "AGENTS.md"), commands),
    ...instructionConsumer("cursor-rule", "cursor", ".cursor/rules/graphify.mdc", path.join(root, ".cursor", "rules", "graphify.mdc"), commands),
    ...hookConsumers("codex-project-hooks", "codex", ".codex/hooks.json", readJson(path.join(root, ".codex", "hooks.json")), commands),
    ...hookConsumers("claude-local-hooks", "claude", ".claude/settings.local.json", readJson(path.join(root, ".claude", "settings.local.json")), commands),
  ];
  if (options.includeUserConsumers) {
    const home = options.homeDir ?? os.homedir();
    if (fs.existsSync(path.join(home, ".claude", "skills", "graphify", "SKILL.md"))) consumers.push({ id: "claude-user-skill", host: "claude", location: "~/.claude/skills/graphify", mode: "skill", findings: [] });
    const claudeDoc = readJson(path.join(home, ".claude.json"));
    if (claudeDoc.ok && isRecord(claudeDoc.value) && isRecord(claudeDoc.value.projects)) {
      const want = posix(root).toLowerCase();
      for (const [projectPath, project] of Object.entries(claudeDoc.value.projects)) {
        if (posix(projectPath).toLowerCase() !== want || !isRecord(project)) continue;
        consumers.push(...mcpConsumer("claude-project-mcp", "claude", "~/.claude.json", { ok: true, value: { mcpServers: project.mcpServers ?? {} } }));
      }
    }
    if (env.APPDATA) consumers.push(...mcpConsumer("vscode-user-mcp", "vscode", "~/AppData/Roaming/Code/User/mcp.json", readJson(path.join(env.APPDATA, "Code", "User", "mcp.json"))));
    consumers.push(...mcpConsumer("antigravity-user-mcp", "antigravity", "~/.gemini/antigravity/mcp_config.json", readJson(path.join(home, ".gemini", "antigravity", "mcp_config.json"))));
    consumers.push(...mcpConsumer("cursor-user-mcp", "cursor", "~/.cursor/mcp.json", readJson(path.join(home, ".cursor", "mcp.json"))));
    try {
      if (/^\[mcp_servers\.[^\]]*graphify/im.test(fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"))) consumers.push({ id: "codex-user-mcp", host: "codex", location: "~/.codex/config.toml", mode: "local-mcp", findings: [] });
    } catch { /* no Codex config */ }
  }

  return Object.freeze({
    sourceHead: head,
    dirtyPaths: dirty.all,
    dirtyUncoveredPaths,
    worktreeFingerprint: fingerprintAyasUncoveredWorktree(root, dirtyUncoveredPaths),
    branch,
    graph,
    needsUpdateFlag: fs.existsSync(path.join(stateDir, "needs_update")),
    semanticPendingMarker: fs.existsSync(path.join(stateDir, ".graphify_describe_pending")),
    extractionGaps,
    projectConfig,
    cli: { available, version: available && pkg.ok && isRecord(pkg.value) && typeof pkg.value.version === "string" ? pkg.value.version : null },
    localMcpServerAvailable,
    consumers,
  });
}
