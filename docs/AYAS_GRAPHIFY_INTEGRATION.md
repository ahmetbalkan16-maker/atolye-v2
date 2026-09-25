# AYAS Graphify Integration (Stage 10A)

How Atölye/AYAS produces, validates and consumes its Graphify knowledge graph, and what every
consumer may and may not conclude from it. Verified against `@sentropic/graphify` 0.17.1 on the
owner workstation; re-verify after a Graphify upgrade.

Status tooling: `npx tsx scripts/ayas-graphify-status.ts [--json] [--user] [--mcp]` (read-only).
Evaluator: `npx tsx scripts/smoke-ayas-graphify-integration.ts [--gate]`.
Code: `src/lib/ayas/developer/AyasGraphifyState.ts` (pure model) and
`src/lib/ayas/developer/AyasGraphifyStateCollector.ts` (read-only collector).

## 1. Operating model

```
REPO HEAD + WORKTREE
  → local extraction (graphify update, AST-only)   writes .graphify/graph.json, manifest.json, branch.json
  → validation (AyasGraphifyState)                 structural / semantic / coverage / consumers
  → graph available                                local CLI (query/explain/path/review-analysis)
  → consumers                                      agents via CLI; IDE MCP is secondary
  → AYAS development / recovery                    fail closed only where the graph is required
```

**Local source truth:** local source → local extraction → local structural truth. Remote MCP and IDE
views are query/view services and never vouch for local freshness.

## 2. Canonical graph source

| Path | Producer | Consumer | Status |
|---|---|---|---|
| `.graphify/graph.json` | `graphify update` (CLI, AYAS closure, guided repair) | every AYAS code path, CLI, local MCP | **canonical** |
| `.graphify/branch.json`, `worktree.json` | Graphify lifecycle | daemons, health, Stage 10 recovery, status | canonical metadata (never commit) |
| `.graphify/manifest.json` | `graphify update` | Stage 10 coverage, status | canonical (per-file md5 of the extracted content) |
| `.graphify/YYYY-MM-DD/graph.json` | Graphify daily snapshot | nobody in AYAS | history only |
| `.graphify/studio/graph.json` | `graphify studio export` (2026-08-20) | the static studio | stale view, not a source |
| `.graphify/m18-scoped-graph.json` | one-off M18 sprint artifact | nobody | legacy artifact |
| `scripts/.graphify/`, `src/lib/brain/autonomy/.graphify/` | per-file cache written by the pre-10A batch check | nobody | legacy cache; Stage 10A checks extract in TEMP and no longer write here |
| `graphify-out/` | older Graphify versions | none (directory absent) | **legacy** — referenced only by old docs/rules, now removed |

`.graphify/` is git-ignored and is never staged. `graphify-out/` stays in `.gitignore` and in the
security deny lists (`BrainSecurityPolicy`) as compatibility only. Nothing was deleted.

## 3. HEAD, freshness and "last updated"

Graphify reads files **from the working tree**, not from Git blobs. The scope used by AYAS
(`--scope all`) is every non-ignored file, tracked or untracked.

| Field | Source | Meaning |
|---|---|---|
| `SOURCE_HEAD` | `git rev-parse HEAD` | the commit the working tree sits on |
| `LAST_SEEN_HEAD` | `branch.json` | HEAD at the last Graphify lifecycle event (any command) |
| `LAST_ANALYZED_HEAD` | `branch.json` | HEAD at the last successful extraction |
| `GRAPH_BUILT_FROM` | `graph.json → graph.built_from_commit` | the commit recorded inside the graph itself |
| `stale` / `needs_update` | `branch.json`, `.graphify/needs_update` | lifecycle events (branch switch, merge, watch-mode change) write and clear both; Graphify's git hook (when it cannot find the CLI) and `ontology` patch apply write `needs_update` **alone** |
| worktree coverage | `manifest.json` md5 vs current file bytes | whether dirty files are what the graph describes |

`lastAnalyzedHead == HEAD` alone is **not** sufficient when files are dirty: the graph may describe
content that is not in HEAD, or miss content that is. AYAS therefore compares dirty paths against
the manifest. A dirty file that existed at HEAD but was never indexed (e.g. `.css`) is outside
Graphify's scope and never counts as uncovered; a **new** file counts only when its extension is one
Graphify produced nodes for. This is what stops the Stage 10 `GRAPHIFY_REFRESH` loop.

The status also carries a **worktree fingerprint**: a SHA-256 over the uncovered dirty paths and their
current content (md5; size + mtime above 2 MB), null when nothing is uncovered. It is bounded to the
uncovered set and exists for one reason: telling "same HEAD, nothing changed since the last refresh"
from "same HEAD, new edits".

## 4. Status semantics (never one "up to date" flag)

| Term | Values |
|---|---|
| `STRUCTURAL_STATUS` | `CURRENT` / `STALE` / `PARTIAL` / `INVALID` / `MISSING` |
| `SEMANTIC_STATUS` | `CURRENT` / `PENDING` (assistant-mode descriptions/labels) |
| `LOCAL_CLI`, `LOCAL_MCP` | `AVAILABLE` / `UNAVAILABLE` |
| `REMOTE_MCP` | `NOT_CONFIGURED` / `CONFIGURED_UNVERIFIED` (never contacted) |
| `CLASSIFICATION` | `GRAPH_CURRENT`, `GRAPH_STALE`, `GRAPH_PARTIAL`, `GRAPH_CONFIG_INVALID`, `GRAPH_EXTRACTION_FAILED`, `GRAPH_SEMANTIC_PENDING_ONLY`, `GRAPH_MCP_UNAVAILABLE`, `GRAPH_MISSING` |

- **STALE**: any of: HEAD ≠ lastAnalyzedHead, `built_from_commit` ≠ HEAD, `stale=true`,
  `needs_update`, dirty indexed files not covered. Fixed by a refresh.
- **INVALID**: graph or branch metadata unreadable, empty graph, or duplicate IDs / duplicate edges
  / dangling edges / self-loops. Fixed by a refresh (classification `GRAPH_EXTRACTION_FAILED`).
- **PARTIAL**: current, but some code files produced no node. A refresh **cannot** fix it.
- **SEMANTIC PENDING**: `.graphify_describe_pending` exists. The structural graph is still valid;
  nothing blocks.
- `graphify check-update` reports `current:false` for semantic-only reasons too and always exits 0,
  so AYAS never uses its boolean — it splits the signals itself.

Precedence: MISSING → EXTRACTION_FAILED → CONFIG_INVALID → STALE → PARTIAL → SEMANTIC_PENDING_ONLY →
CURRENT. `GRAPH_MCP_UNAVAILABLE` is only the headline for an MCP consumer (`--mcp`) whose local graph
is otherwise usable.

## 5. Startup ordering and PC-off behaviour

| Actor | Started by | Uses Graphify? |
|---|---|---|
| AYAS Access Online (`ayas-access-daemon.ps1`: origin + cloudflared tunnel) | logon (Scheduled Task or Startup shortcut) | no |
| AYAS Autonomy Observer (`ayas-autonomy-daemon.ps1` → `ayas-autonomy-daemon.ts`, 5-min tick) | logon (Scheduled Task) | reads `branch.json` for `graphifyFresh` |
| Discovery child (`ayas-discovery-daemon.ts`, spawned each tick) | observer | gates below |
| Next server (UI / health panel) | access daemon | reads `branch.json` for the health finding |
| Graph refresh | AYAS post-publication closure, guided-repair action, developer CLI | writes `.graphify/` |

No Git hook, watcher, IDE or MCP server refreshes the graph (`graphify hook status`: none installed).
VS Code does not need to be open for anything.

Per discovery tick, in order:

1. Research scheduler catch-up (PC-off missed cycles) — **graph-independent, always runs**.
2. Stale-proposal reconciliation, owner review of pending proposals — graph-independent.
3. Novel patch discovery — paused unless `repoClean && graphifyFresh` (Stage 10A added the graph
   gate; before, it drafted, sandboxed and froze artifacts that `discover()` then dropped).
4. Research improvement cycle — paused unless `repoClean && graphifyFresh`.
5. `daemon.discover()` — creates proposals only when `repoClean && graphifyFresh`.
6. Micro-batch accumulation — paused unless `graphifyFresh`.

`graphifyFresh` = `graph.json` exists **and** `lastAnalyzedHead == HEAD` **and** `stale == false` in
both daemons. `scripts/ayas-propose.ts` (which before Stage 10A only checked existence), the Stage 10
collector and the status model also treat `.graphify/needs_update` as stale. The daemons do not read
`needs_update`; that is inert here because its only independent writers are the Graphify git hook (none
installed, no `core.hooksPath`) and `ontology` patch apply (unused), and a hook-triggering commit also
moves HEAD, which the daemons do catch. Stage 10A left the observer and discovery daemon sources
untouched; aligning them is recorded as a deferred owner decision.

**PC off → HEAD changes (e.g. `git pull` at session start) → PC on:** the observer starts, the graph
is stale, research catch-up runs, every proposal-producing lane pauses, and the health panel shows
`GRAPH_STALE_VS_HEAD` with the refresh command. Nothing is created against the old graph. The lanes
resume on the first tick after a refresh. This is deliberate: the daemons never refresh the graph
themselves, so a developer session and the daemon cannot race two writers into `.graphify/`.

## 6. Dependency validation (10A.2)

The per-file check (`AyasBatchGraphifyCheck`) runs inside the approval lanes after Package C writes
the approved file. It extracts that file with Graphify's own AST extractor and compares its
`imports_from` count with the artifact's declared count.

**Bug (reproduced on 4cc7503):** the declaration came from `countDeclaredImportStatements`, a
single-line regex. It disagreed with Graphify's AST count on 569 of 1,251 `.ts`/`.tsx` files under
`app/`, `src/` and `scripts/` at `4cc7503` (multi-line imports, `export … from`, `import` text inside
template strings). The
`diagnostic-quality-gap` generator edits existing smoke files, so a byte-exact, sandbox-validated,
human-approved mutation could fail `AYAS_GRAPHIFY_UNEXPECTED_DEPENDENCY`, be reverted as
`RECOVERY_REQUIRED`, and be regenerated identically on the next tick.

**Source-truth rule:**

| Verdict | Condition | Outcome |
|---|---|---|
| `EXPECTED_CHANGE` | AST count == declaration | pass |
| `STALE_EXPECTATION` | differ, landed bytes == approved artifact bytes | pass, recorded as reconciled |
| `REAL_STRUCTURAL_REGRESSION` | differ, landed bytes ≠ approved bytes | fail closed |
| `UNEXPECTED_CHANGE` | differ, no approved content to prove provenance | fail closed |
| `EXTRACTION_FAILURE` | Graphify produced no nodes / errored | fail closed |

`GRAPH_STALE` never applies here: the check extracts the file itself and never reads `graph.json`.
New artifacts carry an AST-**measured** count (same extractor, on the exact bytes being frozen);
a disagreement with the generator's text count is kept as visible `graphifyEvidence`. Extraction
runs on a TEMP copy, so no cache is written into the repository, and an empty extraction is never
read as "zero imports". The TEMP copy gives the same count as in-tree extraction: 589 of 589 files
in `scripts/`, `src/lib/brain/autonomy/` and `src/lib/ayas/developer/` at `4cc7503`. That matters
because the micro-batch lane's per-generator constants were calibrated in-tree. Evidence records
gain an additive `verdict` field (schema version unchanged).

Reconciliation applies only where the declared count was **derived from that same content**. All
three generators build it with `countDeclaredImportStatements(content)`, and new artifacts are
measured. The micro-batch accumulator freezes artifacts without `graphifyImportCounts`, so that lane
keeps the strict legacy per-generator constant (an independent shape contract) and never reconciles.

**Recovery cannot loop:** reconciled stale expectations no longer fail; a Graphify outage fails
discovery measurement too (no candidate is frozen, and it is not fingerprint-suppressed because it is
environmental); graph recovery allows one refresh per source state — HEAD, classification and worktree
fingerprint — and then stops with an actionable reason (`planAyasGraphifyRecovery`). A new edit at the
same HEAD is a new source state, so a normal dirty development session is never falsely stopped.

## 7. Fail-closed rules

`decideAyasGraphifyRequirement(status, { kind, files })`:

| Work | Graph required? | Stale/missing/invalid | Partial |
|---|---|---|---|
| docs-only, runtime operation, read-only non-graph | no | PROCEED | PROCEED |
| dependency validation (per-file) | extractor only | PROCEED (graph not read) | BLOCKED if the file has no extractor |
| graph query, architecture change, graph recovery | yes | REFRESH_REQUIRED (BLOCKED without CLI) | BLOCKED for files the graph cannot see |
| authority change, blast-radius approval | yes | REFRESH_REQUIRED | + PROCEED_WITH_LIMITATIONS listing critical graph-invisible files to review directly |
| any | — | config invalid → BLOCKED | — |

Semantic pending and MCP state never block local work. Graphify is not a universal startup blocker.

## 8. Consumers and host configs (10A.3 / 10A.4)

| Consumer | Graph source | Mode | Config | State after 10A |
|---|---|---|---|---|
| Claude Code (this workspace) | `.graphify/graph.json` | registered `graphify` skill + npm CLI | `~/.claude/skills/graphify`, `CLAUDE.md` | OK — CLAUDE.md fixed (legacy path, nonexistent `affected`, refresh flags). No MCP server configured for this workspace path |
| Claude Code (other paths) | remote | remote MCP | `~/.claude.json` for `C:/Users/<you>/atolye-v2` and the home dir | secondary; not local truth |
| Claude local hooks | — | PreToolUse hooks | `.claude/settings.local.json` (untracked) | **BROKEN** — call a Python `graphify.EXE hook-guard` that no longer exists; they fail non-blocking on every tool call. Owner action |
| Codex | `.graphify/graph.json` | npm CLI only (handoff packets) | `.codex/hooks.json` → `graphify hook-check` (hidden no-op, valid) | OK. No Graphify skill or MCP registered; `AGENTS.md` has no Graphify section by design |
| Cursor | `.graphify/graph.json` | rule + CLI | `.cursor/rules/graphify.mdc` | OK — rule rewritten from the old `graphify-out/` template |
| VS Code | remote | remote HTTP MCP `https://api.graphify.com/mcp` | `.vscode/mcp.json`, user `mcp.json` (`servers`) | valid VS Code schema; remote only |
| Antigravity | unknown (no path argument) | local stdio MCP via `uv run --with anytechie-graphify … graphify.serve` | `~/.gemini/antigravity/mcp_config.json` (`mcpServers`) | **LIMITED** — a different, unpinned PyPI package fetched at launch, serving no explicit graph. Owner action |
| Local MCP | `.graphify/graph.json` | `graphify serve .graphify/graph.json` | none configured | available (SDK installed), unused |
| Status/health UI | `branch.json` | health finding | — | reports `GRAPH_STALE_VS_HEAD` with the refresh command |

**Config schema families are different on purpose.** VS Code's `.vscode/mcp.json` uses `servers`
(correct for VS Code — not renamed). Claude, Cursor and Antigravity use `mcpServers`. Graphify's
MCP-config *ingest* only reads `mcpServers` / `mcp.servers`, so it logs `mcp_ingest: no mcpServers
map` for the VS Code file and adds no node for it. That is a Graphify reader limitation, recorded as
`GRAPHIFY_INGEST_UNSUPPORTED_HOST_SCHEMA`; the config is correct and was left unchanged.

**Module boundary:** `AyasGraphifyState` and `AyasGraphifyStateCollector` live in
`src/lib/ayas/developer/` and keep that folder's Stage 10 boundary: they import only one another and
Node built-ins, and only the CLIs and evaluators import them. The collector resolves the Graphify
install with its own copy of the execution check's resolver (the evaluator asserts the two agree).
The one non-built-in code it loads is Graphify's own `yaml` dependency, and only when a Graphify
project config exists.

**Remote MCP:** the local toolchain contains no reference to `api.graphify.com` and nothing uploads
the local graph. The remote endpoint therefore cannot see unpushed files or the local graph; its
"last updated" is whatever that service indexed, not local extraction time. It was not contacted
during Stage 10A. For local development decisions the local CLI graph is authoritative.

## 9. Extraction health (10A.5)

- **Runtime:** Node 24 + `@sentropic/graphify` 0.17.1 (web-tree-sitter). Python 3.14 is installed
  but Graphify does not use it.
- **PowerShell (the "7 warnings"):** `tree-sitter-powershell` is an optional peer dependency of
  Graphify and is not installed, so each `.ps1` yields `tree-sitter-powershell not available` and no
  node: `ayas-access-daemon.ps1`, `ayas-autonomy-daemon.ps1`, `register-ayas-autostart.ps1`,
  `register-ayas-autonomy-autostart.ps1`, `unregister-ayas-autostart.ps1`,
  `unregister-ayas-autonomy-autostart.ps1`, `smoke-ayas-access-daemon.ps1`. They launch the observer,
  the access tunnel and the Scheduled Tasks, so they are reported as **critical graph-invisible
  files** and must be reviewed directly. Their links to TypeScript are `npx tsx <script>` strings,
  which a PowerShell grammar would not turn into import edges either. Installing the grammar
  globally is a supply-chain decision left to the owner.
- **Node-ID collision (new finding):** the four routes
  `app/api/assets/{audio,images,thumbnails,videos}/[slug]/[fileName]/route.ts` produce identical
  Graphify node IDs (`filename_route…`). Graphology merges them silently, so `graph.json` shows zero
  duplicate IDs while the thumbnails route has no node of its own (0 nodes; audio and images keep
  only their uniquely named helpers, the shared file node is attributed to videos). Reported as
  `CODE_FILE_UNATTRIBUTED` for thumbnails; "0 duplicate IDs" alone does not prove 1:1 file coverage.
  Review these four routes directly; the collision is in Graphify's ID derivation, not AYAS code.
- **Incremental update is additive (new finding):** `graphify update` builds a fresh AST graph and
  then merges back every previous node the new AST lacks and every previous edge whose endpoints still
  exist (previous attributes win). Removed imports, calls and symbols therefore survive as phantom
  edges and nodes, and `source_location` can be stale. Measured at this sprint's tree against a fresh
  AST-only rebuild in TEMP: 197 phantom edges between current nodes (28 `imports_from`, 86
  `imports`, 82 `calls`, 1 `inherits`), 56 nodes of removed symbols, and 702 retained non-code nodes.
  No current code relation was missing. The graph is a **superset** of the current code relations:
  an edge's absence is sound, its presence is not proof. AYAS uses the graph only in fail-safe
  directions (blast radius, "no path to authority" claims), where phantoms can only over-report, and
  it checks import boundaries from source (evaluator P28/P33). A clean rebuild drops the phantoms but
  also the retained non-code nodes, so it is an owner decision. Structural `CURRENT` means "every
  current code relation is present", not "every edge is current".
- **Coverage evidence:** manifest files with no graph node are classified
  `LANGUAGE_NOT_EXTRACTED`, `CODE_FILE_UNATTRIBUTED`, `HOST_SCHEMA_NOT_INGESTED`,
  `DOCUMENT_WITHOUT_NODES` (AST-only mode has no Markdown extractor) or `NON_CODE_ASSET`. Only the
  first two make the graph PARTIAL.
- **Semantic pending marker:** `.graphify/.graphify_describe_pending` is written by a plain
  `graphify update .` in assistant mode (no API key; it writes description/label instruction batches
  for an assistant to answer; the current marker is this kind) and by Graphify's fast git-hook
  rebuild (not installed here). `--no-description --no-label` neither writes nor clears it, so an old
  marker persists across structural refreshes. It never needs paid work, never affects `stale`, and
  never blocks development. `graphify update --fill-missing` is the optional gap-fill.
- **Semantic labels are unreliable:** community labels come from an older semantic pass and no
  longer match their communities (e.g. "PostCSS Configuration" for AYAS modules). Use structure,
  not labels, for decisions.

## 10. Commands

| Purpose | Command |
|---|---|
| Status | `npx tsx scripts/ayas-graphify-status.ts` (`--user` adds user-level host configs) |
| Structural refresh | `graphify update --scope all --no-description --no-label .` |
| Dependents of a symbol | `graphify explain "<symbol>"` (0.17 has no `affected` command) |
| Change impact | `graphify review-analysis --files <a,b> --graph .graphify/graph.json` |
| Scope check | `graphify scope inspect . --scope all` |
| Local MCP | `graphify serve .graphify/graph.json` |

Docs-only commits: a structural refresh is still required for `lastAnalyzedHead == HEAD`. It is
incremental (unchanged files hit the content-hash AST cache); AYAS never edits `branch.json` itself
to fake a metadata-only bump.

## 11. Owner actions (not changed by Stage 10A)

1. Remove or repoint the two dead Claude PreToolUse hooks in `.claude/settings.local.json`.
2. Antigravity: pin the Graphify package and pass an explicit graph path, or switch to
   `graphify serve .graphify/graph.json`.
3. Decide whether to install the optional `tree-sitter-powershell` grammar for Graphify.
4. Decide whether the remote VS Code/Claude MCP endpoint is still wanted.
5. Optionally align the two daemons' `graphifyFresh` with `needs_update` (see §5). This touches the
   observer and discovery daemon sources, so Stage 10A did not do it.
6. Decide whether to clean-rebuild `.graphify/graph.json` to drop phantom edges (see §9); it also drops
   retained non-code nodes.
