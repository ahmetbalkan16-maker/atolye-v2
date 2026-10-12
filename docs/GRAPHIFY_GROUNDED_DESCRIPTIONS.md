# Local source-grounded Graphify descriptions

`scripts/graphify-grounded-descriptions.mjs` prepares concise descriptions from verified local
source and ingests them through the installed Graphify 0.17.1 `describe --description-mode assistant`
command. It never calls a paid backend, installs a model, executes project source, or edits graph
JSON directly. Node memory can be bounded to 768 MB; work is sequential.

```powershell
# Read sources and write reviewable evidence only; graph remains unchanged.
node --max-old-space-size=768 scripts/graphify-grounded-descriptions.mjs

# Regenerate official assistant prompts, answer them and ingest with Graphify.
node --max-old-space-size=768 scripts/graphify-grounded-descriptions.mjs --apply

# Keep a distinct audit after a later structural refresh.
node --max-old-space-size=768 scripts/graphify-grounded-descriptions.mjs --apply --out .graphify/grounded-descriptions-final

npx tsx scripts/smoke-graphify-grounded-descriptions.ts
```

Native `update` rebuilds existing AST nodes without carrying their prior descriptions.
To finalize its pending lifecycle, stage source-grounded answers for the prompts it
actually emitted, then let that same native update ingest them (API calls remain zero):

```powershell
graphify update --scope all --fill-missing --no-label --description-mode assistant .
node --max-old-space-size=768 scripts/graphify-grounded-descriptions.mjs --stage-update --out .graphify/native-description-staging
graphify update --scope all --fill-missing --no-label --description-mode assistant .
npx tsx scripts/smoke-graphify-native-answer-staging.ts
```

`--stage-update` never archives/consumes the current prompts, edits the graph, or removes
the pending marker. It checks graph/source hashes and unresolved evidence, validates
every requested ID before writing any batch, and refuses conflicting existing answers.
It is idempotent for identical answers. Do not combine it with `--apply`. Native update
clears the marker only when its real described coverage is complete. Recheck structural
complement hashes after the update; no manual marker deletion is part of this workflow.

Only run `--apply` while no other process writes the canonical graph. Before ingest, the helper
checks that neither the graph nor described source files changed during the audit. A stale
SHA-attested complement or unresolved node stops application. After ingest it verifies node IDs
and all non-description/non-community node attributes, relationships, hyperedges, built-from HEAD
and complement count. Graphify itself may recalculate communities. The helper leaves the pending
marker to Graphify's lifecycle; the marker is not evidence of missing descriptions by itself.

Evidence is local under `.graphify/grounded-descriptions/` (or `--out`, constrained to `.graphify`):
`answers.json`, per-node `evidence.json`, `unresolved.json`, `receipt.json`, `graph-before.json`,
official emit/ingest logs and a copy of answered instructions. Previous instruction batches are
archived intact before regenerated prompts replace them. Nothing under `.graphify` is committed.

TypeScript's parser supplies declaration identity, signature, actual directly contained calls,
explicit return counts, members and source comments. Nested function calls are excluded from the
containing function's behavior. PowerShell uses the project's existing parser-only helper; command
names do not assert runtime bindings. YAML is parsed by Graphify's existing dependency. Python
descriptions use verified declarations and docstrings, without loading the training environment.
Git commits and branches are checked against local Git objects and refs. References with missing
graph source attribution are explicitly called references matched to a verified source declaration
or import; their graph metadata is not rewritten. A retained symbol absent from its current source
is described as absent, not as a current implementation. A source occurrence without a resolved
declaration is explicitly marked as a reference with unresolved declaration; it is not a behavioral
claim. No capability, feature readiness or runtime success is inferred from these descriptions.

On 12 October 2026, source HEAD `2e6ba55` had 19,785 nodes and 55,267 relationships. The old 354
unanswered September batches were archived and replaced with 495 current official batches;
Graphify ingested all 19,785 answers (19,043/19,043 in its code-node coverage metric), leaving no
unanswered instruction batch. Before/after hashes proved all structural and source metadata
invariants unchanged, including 202 complement nodes. Evidence identified 27 source-only references
and one absent retained symbol explicitly. Later source changes require a structural refresh,
reapplication of the complement when needed, and a new grounded description pass; the initial
receipt is evidence of that source state only.
