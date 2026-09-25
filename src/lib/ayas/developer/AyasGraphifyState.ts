/**
 * Stage 10A — one deterministic interpretation of the local Graphify state.
 *
 * Graphify exposes several independent signals that were previously read in
 * different places as one "Graphify up to date" flag: `.graphify/branch.json`
 * (lastSeenHead / lastAnalyzedHead / stale), the `built_from_commit`
 * provenance inside `graph.json`, `.graphify/needs_update`, the assistant-mode
 * `.graphify_describe_pending` marker, `manifest.json` content hashes, and
 * per-file extraction gaps (a file Graphify indexed but produced no node for).
 * This module keeps them apart: STRUCTURAL freshness (does the local graph
 * describe the current source?) is never mixed with SEMANTIC enrichment
 * (descriptions/labels), with consumer configuration, or with MCP reachability.
 *
 * Pure: every input is a collected fact (see `AyasGraphifyStateCollector`), so
 * the same facts always produce the same status. Nothing here reads the disk,
 * runs Graphify, or talks to a network.
 */

/** The only graph local decisions may use. `graphify-out/` is legacy Graphify state and never authoritative. */
export const AYAS_GRAPHIFY_STATE_DIR = ".graphify";
export const AYAS_GRAPHIFY_CANONICAL_GRAPH = ".graphify/graph.json";
export const AYAS_GRAPHIFY_LEGACY_STATE_DIR = "graphify-out";
/**
 * Structural refresh: AST-only, local, no API key. `--no-description --no-label` keeps it from writing
 * assistant-mode description batches (a plain `graphify update .` does, which leaves the semantic pending marker).
 */
export const AYAS_GRAPHIFY_REFRESH_COMMAND = "graphify update --scope all --no-description --no-label .";

export type AyasGraphifyStructuralStatus = "CURRENT" | "STALE" | "PARTIAL" | "INVALID" | "MISSING";
export type AyasGraphifySemanticStatus = "CURRENT" | "PENDING";
export type AyasGraphifyClassification =
  | "GRAPH_CURRENT" | "GRAPH_STALE" | "GRAPH_PARTIAL" | "GRAPH_CONFIG_INVALID" | "GRAPH_EXTRACTION_FAILED"
  | "GRAPH_SEMANTIC_PENDING_ONLY" | "GRAPH_MCP_UNAVAILABLE" | "GRAPH_MISSING";
/** Why an indexed file contributed no node. Only the first two leave the structural graph incomplete for code. */
export type AyasGraphifyExtractionGapKind = "LANGUAGE_NOT_EXTRACTED" | "CODE_FILE_UNATTRIBUTED" | "HOST_SCHEMA_NOT_INGESTED" | "DOCUMENT_WITHOUT_NODES" | "NON_CODE_ASSET";
export type AyasGraphifyConsumerHost = "claude" | "codex" | "cursor" | "vscode" | "antigravity";
export type AyasGraphifyConsumerMode = "skill" | "cli-rules" | "hook" | "local-mcp" | "remote-mcp";

export interface AyasGraphifyExtractionGap { readonly path: string; readonly kind: AyasGraphifyExtractionGapKind }

export interface AyasGraphifyConsumerFact {
  readonly id: string;
  readonly host: AyasGraphifyConsumerHost;
  /** Repo-relative, or `~/…` for a user-level file. Never an absolute machine path. */
  readonly location: string;
  readonly mode: AyasGraphifyConsumerMode;
  /** Stable finding codes, e.g. LEGACY_GRAPH_PATH, UNKNOWN_COMMAND:affected, HOOK_BINARY_MISSING. */
  readonly findings: readonly string[];
}

export interface AyasGraphifyBranchFact { readonly lastSeenHead: string | null; readonly lastAnalyzedHead: string | null; readonly stale: boolean; readonly staleReason: string | null }
export interface AyasGraphifyGraphFact { readonly builtFromHead: string | null; readonly nodes: number; readonly links: number; readonly duplicateIds: number; readonly duplicateEdges: number; readonly dangling: number; readonly selfLoops: number }

export interface AyasGraphifyFacts {
  readonly sourceHead: string | null;
  /** Uncommitted paths (tracked or untracked), repo-relative. */
  readonly dirtyPaths: readonly string[];
  /** Dirty paths Graphify indexes whose current content is not what the graph was built from. */
  readonly dirtyUncoveredPaths: readonly string[];
  /** Fingerprint of `dirtyUncoveredPaths` and their current content; null when none. Same HEAD + new edits = new fingerprint. */
  readonly worktreeFingerprint?: string | null;
  readonly branch: AyasGraphifyBranchFact | "ABSENT" | "UNREADABLE";
  readonly graph: AyasGraphifyGraphFact | "ABSENT" | "UNREADABLE";
  readonly needsUpdateFlag: boolean;
  readonly semanticPendingMarker: boolean;
  readonly extractionGaps: readonly AyasGraphifyExtractionGap[];
  /** graphify.yaml / .graphify/config.yaml — they change what Graphify extracts. */
  readonly projectConfig: "ABSENT" | "VALID" | "INVALID";
  readonly cli: { readonly available: boolean; readonly version: string | null };
  readonly localMcpServerAvailable: boolean;
  readonly consumers: readonly AyasGraphifyConsumerFact[];
}

export interface AyasGraphifyStatus {
  readonly graphSource: typeof AYAS_GRAPHIFY_CANONICAL_GRAPH;
  readonly sourceHead: string | null;
  readonly lastSeenHead: string | null;
  readonly lastAnalyzedHead: string | null;
  readonly graphBuiltFromHead: string | null;
  readonly worktreeState: "CLEAN" | "DIRTY";
  readonly worktreeFingerprint: string | null;
  readonly structuralStatus: AyasGraphifyStructuralStatus;
  readonly structuralReasons: readonly string[];
  readonly semanticStatus: AyasGraphifySemanticStatus;
  readonly classification: AyasGraphifyClassification;
  readonly localCli: "AVAILABLE" | "UNAVAILABLE";
  readonly localMcp: "AVAILABLE" | "UNAVAILABLE";
  /** Remote MCP is never contacted: configured means "a host points at it", not "it is current". */
  readonly remoteMcp: "NOT_CONFIGURED" | "CONFIGURED_UNVERIFIED";
  readonly incompleteCodeFiles: readonly string[];
  /** Incomplete files that establish OS persistence, remote access, approval or execution authority. */
  readonly criticalIncompleteFiles: readonly string[];
  readonly coverageNotes: readonly AyasGraphifyExtractionGap[];
  readonly consumers: readonly (AyasGraphifyConsumerFact & { readonly status: "OK" | "LIMITED" | "BROKEN" })[];
  /** Command that can move this classification to current, or null when refreshing cannot help. */
  readonly recoveryCommand: string | null;
  readonly nextAction: string;
}

const SHA = /^[0-9a-f]{40}$/;
/** Graph-invisible files that still carry authority: OS autostart, remote access, daemons, approval/execution/security code. */
const CRITICAL_PATH = /(?:^|\/)(?:un)?register-[^/]*$|(?:^|\/)[^/]*(?:daemon|access|authority|approval|execution|security)[^/]*$/i;
/** Findings that make a consumer unusable, versus ones that only limit it. */
const BROKEN_FINDINGS = /^(?:HOOK_BINARY_MISSING|UNKNOWN_COMMAND|LEGACY_GRAPH_PATH|SCHEMA_INVALID|UNREADABLE)/;

export function isAyasGraphifyCriticalPath(repoRelativePath: string): boolean { return CRITICAL_PATH.test(repoRelativePath.replace(/\\/g, "/")); }

export function evaluateAyasGraphifyState(facts: AyasGraphifyFacts, options: { readonly consumer?: "local" | "mcp" } = {}): AyasGraphifyStatus {
  const branch = typeof facts.branch === "object" ? facts.branch : null;
  const graph = typeof facts.graph === "object" ? facts.graph : null;
  const reasons: string[] = [];
  let structural: AyasGraphifyStructuralStatus;
  const incomplete = facts.extractionGaps.filter((g) => g.kind === "LANGUAGE_NOT_EXTRACTED" || g.kind === "CODE_FILE_UNATTRIBUTED").map((g) => g.path).sort();

  if (facts.graph === "ABSENT" || facts.branch === "ABSENT") {
    structural = "MISSING";
    reasons.push(facts.graph === "ABSENT" ? "GRAPH_FILE_ABSENT" : "BRANCH_METADATA_ABSENT");
  } else if (!graph || !branch || graph.nodes === 0) {
    structural = "INVALID";
    reasons.push(!graph ? "GRAPH_FILE_UNREADABLE" : !branch ? "BRANCH_METADATA_UNREADABLE" : "GRAPH_EMPTY");
  } else if (graph.duplicateIds + graph.duplicateEdges + graph.dangling + graph.selfLoops > 0) {
    structural = "INVALID";
    reasons.push(`STRUCTURAL_ANOMALY:ids=${graph.duplicateIds},edges=${graph.duplicateEdges},dangling=${graph.dangling},selfLoops=${graph.selfLoops}`);
  } else {
    // Every signal that says the graph describes something other than the current source counts; any one is enough.
    if (!facts.sourceHead || !SHA.test(facts.sourceHead)) reasons.push("SOURCE_HEAD_UNKNOWN");
    else {
      if (branch.lastAnalyzedHead !== facts.sourceHead) reasons.push("LAST_ANALYZED_HEAD_BEHIND_SOURCE");
      if (graph.builtFromHead !== null && graph.builtFromHead !== facts.sourceHead) reasons.push("GRAPH_BUILT_FROM_OTHER_COMMIT");
    }
    if (branch.stale) reasons.push(branch.staleReason ? `BRANCH_MARKED_STALE:${branch.staleReason}` : "BRANCH_MARKED_STALE");
    if (facts.needsUpdateFlag) reasons.push("NEEDS_UPDATE_FLAG");
    if (facts.dirtyUncoveredPaths.length) reasons.push(`WORKTREE_NOT_COVERED:${facts.dirtyUncoveredPaths.length}`);
    structural = reasons.length ? "STALE" : incomplete.length ? "PARTIAL" : "CURRENT";
    if (structural === "PARTIAL") reasons.push(`INCOMPLETE_CODE_FILES:${incomplete.length}`);
  }

  const semantic: AyasGraphifySemanticStatus = facts.semanticPendingMarker ? "PENDING" : "CURRENT";
  const remoteMcp = facts.consumers.some((c) => c.mode === "remote-mcp") ? "CONFIGURED_UNVERIFIED" : "NOT_CONFIGURED";
  const refreshable = facts.cli.available && facts.projectConfig !== "INVALID";

  let classification: AyasGraphifyClassification;
  if (structural === "MISSING") classification = "GRAPH_MISSING";
  else if (structural === "INVALID") classification = "GRAPH_EXTRACTION_FAILED";
  else if (facts.projectConfig === "INVALID") classification = "GRAPH_CONFIG_INVALID";
  else if (structural === "STALE") classification = "GRAPH_STALE";
  else if (structural === "PARTIAL") classification = "GRAPH_PARTIAL";
  else if (semantic === "PENDING") classification = "GRAPH_SEMANTIC_PENDING_ONLY";
  else classification = "GRAPH_CURRENT";
  // MCP is a separate consumer channel: it only becomes the headline when an MCP consumer asks and the local graph is otherwise usable.
  if (options.consumer === "mcp" && !facts.localMcpServerAvailable && (classification === "GRAPH_CURRENT" || classification === "GRAPH_SEMANTIC_PENDING_ONLY")) classification = "GRAPH_MCP_UNAVAILABLE";

  const recoveryCommand = (classification === "GRAPH_MISSING" || classification === "GRAPH_EXTRACTION_FAILED" || classification === "GRAPH_STALE") && refreshable ? AYAS_GRAPHIFY_REFRESH_COMMAND : null;
  return Object.freeze({
    graphSource: AYAS_GRAPHIFY_CANONICAL_GRAPH,
    sourceHead: facts.sourceHead,
    lastSeenHead: branch?.lastSeenHead ?? null,
    lastAnalyzedHead: branch?.lastAnalyzedHead ?? null,
    graphBuiltFromHead: graph?.builtFromHead ?? null,
    worktreeState: facts.dirtyPaths.length ? "DIRTY" : "CLEAN",
    worktreeFingerprint: facts.worktreeFingerprint ?? null,
    structuralStatus: structural,
    structuralReasons: reasons,
    semanticStatus: semantic,
    classification,
    localCli: facts.cli.available ? "AVAILABLE" : "UNAVAILABLE",
    localMcp: facts.localMcpServerAvailable ? "AVAILABLE" : "UNAVAILABLE",
    remoteMcp,
    incompleteCodeFiles: incomplete,
    criticalIncompleteFiles: incomplete.filter(isAyasGraphifyCriticalPath),
    coverageNotes: facts.extractionGaps.filter((g) => !incomplete.includes(g.path)),
    consumers: facts.consumers.map((c) => ({ ...c, status: c.findings.some((f) => BROKEN_FINDINGS.test(f)) ? "BROKEN" as const : c.findings.length ? "LIMITED" as const : "OK" as const })),
    recoveryCommand,
    nextAction: nextActionFor(classification, facts, recoveryCommand),
  });
}

function nextActionFor(classification: AyasGraphifyClassification, facts: AyasGraphifyFacts, command: string | null): string {
  switch (classification) {
    case "GRAPH_MISSING": case "GRAPH_EXTRACTION_FAILED": case "GRAPH_STALE":
      return command ? `Run \`${command}\`, then re-check.` : facts.cli.available ? "Fix the Graphify project config, then refresh." : "Graphify CLI is unavailable; graph-dependent work must stop until it is restored.";
    case "GRAPH_CONFIG_INVALID": return "Fix graphify.yaml / .graphify/config.yaml; a refresh cannot help until it parses.";
    case "GRAPH_PARTIAL": return "Graph is current but has no nodes for some code files; review those files directly — refreshing cannot add them.";
    case "GRAPH_SEMANTIC_PENDING_ONLY": return "Structural graph is current. Descriptions/labels are optional assistant-mode work; nothing blocks.";
    case "GRAPH_MCP_UNAVAILABLE": return "Use the local CLI, or start `graphify serve .graphify/graph.json`; remote MCP is never local source truth.";
    default: return "None.";
  }
}

// ---------------------------------------------------------------------------
// Fail-closed policy: where Graphify must stop work, and where it must not.
// ---------------------------------------------------------------------------

export type AyasGraphifyWorkKind =
  | "graph-query" | "architecture-change" | "authority-change" | "blast-radius-approval" | "graph-recovery"
  | "dependency-validation" | "docs-only" | "runtime-operation" | "read-only-non-graph";
export type AyasGraphifyRequirementDecision = "PROCEED" | "PROCEED_WITH_LIMITATIONS" | "REFRESH_REQUIRED" | "BLOCKED";
export interface AyasGraphifyRequirement { readonly decision: AyasGraphifyRequirementDecision; readonly reasons: readonly string[]; readonly command: string | null }

/** Work that never reads the graph; Graphify failure must not become a universal blocker for it. */
const GRAPH_INDEPENDENT: ReadonlySet<AyasGraphifyWorkKind> = new Set(["docs-only", "runtime-operation", "read-only-non-graph"]);

export function decideAyasGraphifyRequirement(status: AyasGraphifyStatus, work: { readonly kind: AyasGraphifyWorkKind; readonly files?: readonly string[] }): AyasGraphifyRequirement {
  const files = (work.files ?? []).map((f) => f.replace(/\\/g, "/"));
  if (GRAPH_INDEPENDENT.has(work.kind)) return { decision: "PROCEED", reasons: ["GRAPH_NOT_REQUIRED"], command: null };
  const untouchable = files.filter((f) => status.incompleteCodeFiles.includes(f));

  // Per-file dependency validation extracts the file itself from disk; it never reads graph.json, so graph staleness is irrelevant to it.
  if (work.kind === "dependency-validation") {
    if (status.localCli === "UNAVAILABLE") return { decision: "BLOCKED", reasons: ["GRAPHIFY_CLI_UNAVAILABLE"], command: null };
    if (untouchable.length) return { decision: "BLOCKED", reasons: untouchable.map((f) => `NO_EXTRACTOR_FOR:${f}`), command: null };
    return { decision: "PROCEED", reasons: ["PER_FILE_EXTRACTION_FROM_DISK"], command: null };
  }

  switch (status.classification) {
    case "GRAPH_MISSING": case "GRAPH_EXTRACTION_FAILED": case "GRAPH_STALE":
      return status.recoveryCommand
        ? { decision: "REFRESH_REQUIRED", reasons: [status.classification, ...status.structuralReasons], command: status.recoveryCommand }
        : { decision: "BLOCKED", reasons: [status.classification, ...status.structuralReasons, "REFRESH_NOT_POSSIBLE"], command: null };
    case "GRAPH_CONFIG_INVALID":
      return { decision: "BLOCKED", reasons: ["GRAPH_CONFIG_INVALID"], command: null };
    default: break;
  }
  if (untouchable.length) return { decision: "BLOCKED", reasons: untouchable.map((f) => `GRAPH_HAS_NO_NODES_FOR:${f}`), command: null };
  const limitations: string[] = [];
  if ((work.kind === "authority-change" || work.kind === "blast-radius-approval") && status.criticalIncompleteFiles.length) {
    limitations.push(...status.criticalIncompleteFiles.map((f) => `REVIEW_DIRECTLY:${f}`));
  }
  if (status.semanticStatus === "PENDING") limitations.push("SEMANTIC_PENDING_NOT_BLOCKING");
  const decision = limitations.some((l) => l.startsWith("REVIEW_DIRECTLY")) ? "PROCEED_WITH_LIMITATIONS" : "PROCEED";
  return { decision, reasons: limitations.length ? limitations : ["GRAPH_CURRENT_FOR_SCOPE"], command: null };
}

/**
 * Bounded recovery: one refresh per source state. If the same classification survives a refresh for the same
 * HEAD and the same uncovered worktree content, retrying cannot help — stop with an actionable failure instead of
 * looping RECOVERY → refresh → RECOVERY. A new edit at the same HEAD is a new source state and may refresh again.
 */
export function planAyasGraphifyRecovery(status: AyasGraphifyStatus, history: readonly { readonly sourceHead: string | null; readonly classification: AyasGraphifyClassification; readonly worktreeFingerprint?: string | null }[]): { readonly step: "NONE" | "REFRESH" | "STOP"; readonly reason: string; readonly command: string | null } {
  if (!status.recoveryCommand) {
    return status.classification === "GRAPH_CURRENT" || status.classification === "GRAPH_SEMANTIC_PENDING_ONLY" || status.classification === "GRAPH_PARTIAL"
      ? { step: "NONE", reason: status.nextAction, command: null }
      : { step: "STOP", reason: status.nextAction, command: null };
  }
  const tried = history.filter((h) => h.sourceHead === status.sourceHead && h.classification === status.classification && (h.worktreeFingerprint ?? null) === status.worktreeFingerprint).length;
  return tried >= 1
    ? { step: "STOP", reason: `${status.classification} persisted after a refresh at the same HEAD and worktree content (${status.structuralReasons.join(", ")}); a repeat cannot converge.`, command: null }
    : { step: "REFRESH", reason: status.nextAction, command: status.recoveryCommand };
}

// ---------------------------------------------------------------------------
// Host MCP config schemas: consistent semantics, not identical JSON shape.
// ---------------------------------------------------------------------------

export type AyasMcpConfigHost = "vscode" | "claude" | "cursor" | "antigravity";
export interface AyasMcpConfigInterpretation {
  /** Valid under the host's OWN schema: VS Code `.vscode/mcp.json` uses `servers`; Claude/Cursor/Antigravity use `mcpServers`. */
  readonly validForHost: boolean;
  /** Whether Graphify's own MCP-config ingest (which reads `mcpServers` or `mcp.servers`) can index it. */
  readonly graphifyIngestReadable: boolean;
  readonly servers: readonly { readonly name: string; readonly transport: "http" | "stdio" | "unknown"; readonly url: string | null; readonly command: string | null; readonly args: readonly string[] }[];
  readonly unexpectedKeys: readonly string[];
}

const HOST_SERVER_KEY: Record<AyasMcpConfigHost, string> = { vscode: "servers", claude: "mcpServers", cursor: "mcpServers", antigravity: "mcpServers" };
const HOST_ALLOWED_KEYS: Record<AyasMcpConfigHost, ReadonlySet<string>> = {
  vscode: new Set(["servers", "inputs"]), claude: new Set(["mcpServers"]), cursor: new Set(["mcpServers"]), antigravity: new Set(["mcpServers"]),
};

export function interpretAyasMcpConfig(host: AyasMcpConfigHost, doc: unknown): AyasMcpConfigInterpretation {
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isMap(doc)) return { validForHost: false, graphifyIngestReadable: false, servers: [], unexpectedKeys: [] };
  const map = doc[HOST_SERVER_KEY[host]];
  const nested = isMap(doc.mcp) ? doc.mcp.servers : undefined;
  const servers = isMap(map) ? Object.entries(map).filter(([, spec]) => isMap(spec)).map(([name, spec]) => {
    const s = spec as Record<string, unknown>;
    const url = typeof s.url === "string" ? s.url : null;
    const command = typeof s.command === "string" ? s.command : null;
    return { name, transport: url ? "http" as const : command ? "stdio" as const : "unknown" as const, url, command, args: Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [] };
  }) : [];
  return {
    validForHost: isMap(map),
    graphifyIngestReadable: isMap(doc.mcpServers) || isMap(nested),
    servers,
    unexpectedKeys: Object.keys(doc).filter((k) => !HOST_ALLOWED_KEYS[host].has(k)).sort(),
  };
}

/** Findings for one Graphify MCP server entry. Remote endpoints and unpinned on-demand packages are flagged, never "fixed" here. */
export function assessAyasGraphifyMcpServer(server: AyasMcpConfigInterpretation["servers"][number]): readonly string[] {
  const findings: string[] = [];
  if (server.transport === "http") findings.push("REMOTE_ENDPOINT_NOT_LOCAL_SOURCE_TRUTH");
  if (server.transport === "stdio") {
    const argv = [server.command ?? "", ...server.args].join(" ");
    // `uv run --with <pkg>` / `npx <pkg>` without a version resolves a package from the network at every start.
    const withPkgs = server.args.flatMap((a, i) => (server.args[i - 1] === "--with" ? [a] : []));
    if (withPkgs.some((p) => !/[=@]=?\d/.test(p))) findings.push("UNPINNED_ON_DEMAND_PACKAGE");
    if (!/graph\.json/i.test(argv)) findings.push("NO_GRAPH_PATH_ARGUMENT");
    else if (new RegExp(`${AYAS_GRAPHIFY_LEGACY_STATE_DIR}[\\\\/]`).test(argv)) findings.push("LEGACY_GRAPH_PATH");
  }
  if (server.transport === "unknown") findings.push("SCHEMA_INVALID:server-without-url-or-command");
  return findings;
}

/** Findings for an instruction file (CLAUDE.md, a Cursor rule, AGENTS.md…) that tells agents how to use Graphify. */
export function assessAyasGraphifyInstructions(text: string, knownCommands: ReadonlySet<string>): readonly string[] {
  const findings = new Set<string>();
  if (new RegExp(`${AYAS_GRAPHIFY_LEGACY_STATE_DIR}/`).test(text)) findings.add("LEGACY_GRAPH_PATH");
  for (const match of text.matchAll(/`graphify ([a-z][a-z-]*)\b/g)) if (!knownCommands.has(match[1]!)) findings.add(`UNKNOWN_COMMAND:${match[1]}`);
  // A bare `graphify update .` runs assistant-mode descriptions and leaves the semantic pending marker behind.
  if (/`graphify update \.`/.test(text)) findings.add("REFRESH_WRITES_SEMANTIC_BATCHES");
  return [...findings].sort();
}
