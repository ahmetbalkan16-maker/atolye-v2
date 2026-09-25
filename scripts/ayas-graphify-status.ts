/**
 * Stage 10A — read-only Graphify status for AYAS / developer tooling.
 *
 *   npx tsx scripts/ayas-graphify-status.ts [--json] [--user] [--mcp]
 *
 * --user  also inspect user-level host configs (~/.claude.json, VS Code user
 *         mcp.json, Antigravity, Cursor, Codex) — names/URLs only, never values
 *         of env or auth fields.
 * --mcp   classify for an MCP consumer instead of local development.
 *
 * Never runs Graphify, never refreshes, never contacts a remote MCP endpoint.
 */
import { collectAyasGraphifyFacts } from "../src/lib/ayas/developer/AyasGraphifyStateCollector";
import { evaluateAyasGraphifyState } from "../src/lib/ayas/developer/AyasGraphifyState";

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const facts = await collectAyasGraphifyFacts({ cwd: process.cwd(), includeUserConsumers: args.has("--user") });
  const status = evaluateAyasGraphifyState(facts, { consumer: args.has("--mcp") ? "mcp" : "local" });
  if (args.has("--json")) { console.log(JSON.stringify(status, null, 2)); return; }
  const lines = [
    `GRAPH_SOURCE:        ${status.graphSource}`,
    `SOURCE_HEAD:         ${status.sourceHead ?? "unknown"}`,
    `LAST_SEEN_HEAD:      ${status.lastSeenHead ?? "unknown"}`,
    `LAST_ANALYZED_HEAD:  ${status.lastAnalyzedHead ?? "unknown"}`,
    `GRAPH_BUILT_FROM:    ${status.graphBuiltFromHead ?? "unknown"}`,
    `WORKTREE_STATE:      ${status.worktreeState}${status.worktreeFingerprint ? ` (uncovered fingerprint ${status.worktreeFingerprint.slice(0, 12)})` : ""}`,
    `STRUCTURAL_STATUS:   ${status.structuralStatus}${status.structuralReasons.length ? ` (${status.structuralReasons.join(", ")})` : ""}`,
    `SEMANTIC_STATUS:     ${status.semanticStatus}`,
    `CLASSIFICATION:      ${status.classification}`,
    `LOCAL_CLI:           ${status.localCli}${facts.cli.version ? ` (@sentropic/graphify ${facts.cli.version})` : ""}`,
    `LOCAL_MCP:           ${status.localMcp}`,
    `REMOTE_MCP:          ${status.remoteMcp}`,
    `INCOMPLETE_CODE:     ${status.incompleteCodeFiles.length ? status.incompleteCodeFiles.join(", ") : "none"}`,
    `CRITICAL_INCOMPLETE: ${status.criticalIncompleteFiles.length ? status.criticalIncompleteFiles.join(", ") : "none"}`,
    "IDE_CONSUMERS:",
    ...status.consumers.map((c) => `  ${c.status.padEnd(7)} ${c.host.padEnd(11)} ${c.mode.padEnd(10)} ${c.location}${c.findings.length ? `  [${c.findings.join(", ")}]` : ""}`),
    `NEXT_ACTION:         ${status.nextAction}`,
  ];
  console.log(lines.join("\n"));
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
