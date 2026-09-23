# AYAS external architecture integration — owner review (2026-09-23)

## Baseline and provenance

The owner superseded the sprint's earlier expected SHA with trusted baseline
`d750bd7552d4790b6116b8aa61f2748919a94fd6` on
`wip/ayas-graphify-final-execution`. No intervening approved commit was reverted.
At entry, local and origin HEAD matched, ahead/behind was 0/0, the worktree and
index were clean, Graphify was fresh/integral, AYAS HEALTHY, and the observer
OBSERVING. The intentionally dirty owner-review tree can make the observer
PAUSED_DIRTY_REPO and health DEGRADED; that is not evidence of an infrastructure
regression. No source code, library, dependency or asset was copied from the
external projects below; these are architectural inspirations only.

Upstream sources were inspected on 2026-09-23 from the projects' current
default-branch repos/docs. Exact upstream commit IDs could not be resolved by
the available GitHub browsing interface, so these findings are dated branch
observations, **not pinned-commit attestations**. Version-specific claims are
avoided for that reason.

| Upstream | Substantive mechanism / maturity boundary | License |
|---|---|---|
| [OpenJarvis](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/overview.md) | Five primitive layers; pluggable retrieval, hybrid rank fusion and traces/event bus. [Query flow](https://github.com/open-jarvis/OpenJarvis/blob/main/docs/architecture/query-flow.md) separates execution from telemetry. A [wheel packaging issue](https://github.com/open-jarvis/OpenJarvis/issues/372) is a maturity caution, not evidence about current source behavior. | [Apache-2.0](https://github.com/open-jarvis/OpenJarvis/blob/main/LICENSE) |
| [Letta Code](https://github.com/letta-ai/letta-code) / [Letta](https://docs.letta.com/tutorials/attaching-detaching-blocks/) | Durable, attachable memory/context blocks and stateful agent harness; current source moved from older Letta v1 to letta-code. Self-editing agent memory is not adopted. | [Apache-2.0](https://github.com/letta-ai/letta-code/blob/main/LICENSE) |
| [Mem0](https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/how-it-works.mdx) | Extract/deduplicate and retrieve memories with relevance and metadata; OSS vs managed platform features differ. AYAS already has its own lexical/concept RRF and provenance. | [Apache-2.0](https://github.com/mem0ai/mem0/blob/main/LICENSE) |
| [LangGraph](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx) | Thread checkpointer, per-step state and separate cross-thread store; durable resume is explicit and version-dependent. AYAS has its own workflow/journal, so no second checkpointer. | [MIT](https://github.com/langchain-ai/langgraph/blob/main/LICENSE) |
| [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) | Explicit workflow state/checkpoints and caller-scoped storage. The useful invariant is to reject unrecognized durable state. | [MIT](https://github.com/microsoft/agent-framework/blob/main/LICENSE) |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | Agent server/runtime boundary, isolated execution workspace and action/event stream; AYAS already isolates source mutations in Git worktrees. | [MIT](https://github.com/OpenHands/software-agent-sdk/blob/main/LICENSE) |
| [CrewAI](https://github.com/crewAIInc/crewAI/blob/main/README.md) | Separate Crews (autonomous collaboration) from Flows (event-driven state/branching). No proven AYAS task class warrants new multi-agent authority. | [MIT-style](https://github.com/crewAIInc/crewAI/blob/main/LICENSE) |
| [Khoj](https://github.com/khoj-ai/khoj) | Personal retrieval plus scheduled research. AYAS has LIGHT/DEEP research, source provenance and approval bridge. | [AGPL-3.0](https://github.com/khoj-ai/khoj/blob/master/LICENSE) |
| [AutoGPT](https://github.com/Significant-Gravitas/AutoGPT) | Platform block workflows/triggers versus older Classic. The Platform folder has a [different, Polyform Shield license](https://github.com/Significant-Gravitas/AutoGPT/blob/master/LICENSE); no code was reused. | Polyform Shield (Platform); MIT (elsewhere) |

## Graphify-first AYAS inventory

Classification: **A** strong/already present, **B** present but limited,
**C** absent, **D** intentionally not desired. Current owners and their
downstream callers were verified in Graphify and source, not inferred from
external-framework descriptions.

| Capabilities | Class | AYAS owner / boundary and observed limit |
|---|---|---|
| Agent context, conversation continuity, reference resolution, summarization | B | `AyasContextAssembly` composes state/resolver/compression for `AyasChatStream`; last 12 turns were unbounded by size. Current user text and resolved referents sit outside history compression. |
| Workflow state, durable checkpoints/resume, state-machine durability, execution recovery | A | `AyasDeveloperWorkflowStore`, `AyasWorkflowRecovery`, `AyasExecutionJournal`, `AyasExecutionGate` use schema/version/atomic records and classify crash windows without automatic mutation replay. |
| Planning, proposal generation, micro-batching, reflection/outcome learning | A | Novel patch discovery and Development Center feed governed proposals; approval inbox and daemon are separate authority. Learning never self-approves. |
| Tool execution, typed permissioning, skill/tool abstraction, policy | A | `AyasToolRegistry`, execution gate and proposal service enforce permissions/approval; sandboxed mutations use `AyasPatchSandbox`. |
| Memory, provenance, temporal memory, hybrid retrieval | A | `AyasMemoryStore` validates durable records; `AyasMemoryRetrieval` has BM25-style lexical/concept RRF, trust, freshness, conflict/injection quarantine and current-request precedence. No vector backend is justified. |
| Context budgeting | B | Fixed turn-count and summary existed; total retained verbatim characters and combined summary were not bounded. This sprint adds a soft budget. |
| Retry/recovery, runtime stability, background observer | A | `AyasRuntimeStabilityGuard`, transaction, observer and execution lock govern retries/recovery. Runtime persistence H7 was intentionally untouched. |
| External research and scheduler | B | LIGHT/DEEP cadence, source registry and isolated lock exist. `AyasResearchSchedulerStateStore.read()` previously treated corruption, unknown schema and I/O errors as missing state, potentially triggering a fresh run. |
| Event timeline / observability | B | Execution journal, runtime transaction and local discovery ledger exist; a unified read-only projection is absent. New event authority/store is not desired. |
| Model/provider abstraction, streaming | A | `AyasModelRouter` and `AyasChatStream` own the paths. |
| Agent handoff/sub-agents | D | No demonstrated quality/isolation gain sufficient to justify new authority/reconciliation complexity. |
| Filesystem sandboxing and isolation | A | `AyasPatchSandbox` uses isolated Git worktrees, scoped writes and tests; no OpenHands runtime import. |

## Gap and decision matrix

| External mechanism | AYAS equivalent / gap | Benefit | Complexity / security / runtime / migration | Decision |
|---|---|---|---|---|
| LangGraph/MAF checkpoint validation | Scheduler state v1 existed but read silently defaulted on invalid state | Prevent corrupt-state re-run | Low / lower retry risk / negligible / no migration | **ADAPT** |
| Letta/OpenJarvis selective context | Existing compression limited turns, not characters | Less irrelevant prompt material | Low / no authority change / linear scan / no migration | **ADAPT** |
| OpenJarvis/Mem0 hybrid retrieval | BM25-style lexical + concept RRF, trust/freshness/conflict already present | No demonstrated gain from vector store | High / new data surface / model and storage cost / substantial | **ALREADY PRESENT** for RRF; **DEFER** vector DB |
| LangGraph checkpointer / workflow state | AYAS workflow store, journal and gate | Duplicate owner would harm recovery clarity | High / high / extra writes / migration | **REJECT** |
| OpenJarvis/OpenHands event stream | Journal and transaction exist; no unified projection | Better sequence explanation | Medium / audit ambiguity if authoritative / extra events / none | **DEFER** read-only projection until concrete incident |
| Letta editable memory blocks | Governed memory store exists | Unproven | High / stale memory may overrule user / cost / migration | **REJECT** self-editing |
| CrewAI agents/Flows | Daemon, owner gate and microbatch orchestration exist | No proven task-class gain | High / authority reconciliation / extra model calls / migration | **REJECT** new engine |
| OpenHands sandbox runtime | Git-worktree sandbox exists | Little gain for current mutation class | High / larger attack surface / container cost / deployment | **ALREADY PRESENT** isolation; **DEFER** external runtime |
| Khoj scheduling | LIGHT/DEEP registry/cadence exist | Existing feature | Low / none / existing / none | **ALREADY PRESENT** |
| AutoGPT Platform blocks | Native typed tools/workflows exist | No necessary gain | High / license and supply-chain exposure / heavy / substantial | **REJECT** |

Two mechanisms, not the suggested 3–5, passed the strict selection rule. No
third mechanism had a demonstrated gap plus justified operational cost.

## Frozen implementation scope and contracts

Production files: `AyasResearchSchedulerStateStore.ts`,
`AyasContextCompression.ts`, `AyasContextAssembly.ts`. Test files:
`smoke-ayas-research-scheduler.ts`, `smoke-ayas-context.ts`. No other
production file, dependency, store or schema changed.

Scheduler: only ENOENT means first run. Malformed JSON, unsupported schema,
invalid counters/timestamps/fields and read failures throw a typed error before
due-time evaluation. Writes validate the same v1 shape and preserve the atomic
temp/fsync/rename protocol. Existing valid v1 state reloads; stale temp files
cannot replace the committed record. A stale `currentRunId` still uses the
existing lock-backed recovery path. This does not alter execution authority.

Context: assembly opts into a 6,000-character **soft** verbatim history
ceiling. Oldest turns move to the existing extractive summary until under
budget, but the newest two turns are never truncated even if they exceed it.
The current request, state constraints and resolved references are separate
and never cut by this budget. Combined summary is capped at 600 characters.
The trace reports retained history/summary characters; it is observational,
not an authority source. Direct compression calls without a budget retain
their old behavior. No persistent context migration.

## Evidence and review

- Long-history fixture: raw history 12,038 chars, retained history + summary
  5,412 chars (55% reduction); across 500 repetitions on this host, baseline
  compression averaged 0.001 ms, bounded compression 0.007 ms, and full
  assembly 0.158 ms. The roughly 0.006 ms compression overhead is measured,
  not extrapolated to provider latency.
  This is a character proxy, not a tokenizer/model-cost measurement. Critical
  latest turns and a resolved project referent are asserted separately.
- Scheduler: missing, malformed, unknown-version, negative counter, invalid
  timestamp, reload, invalid write, stale temp file, stale run marker, cadence,
  catch-up and lock independence are covered. Corrupt input does not start a
  research cycle or overwrite the historical state.
- Scheduler unreadable-state regression (owner review): an unreadable state
  path is not treated as missing state; the store fails closed with
  `READ_FAILED` before any research cycle starts. The test proves this with a
  real `EISDIR` read failure (state path created as a directory). This does
  not widen authority, approval or execution-gate scope.
- Focused tests: context 32/32, scheduler 13/13. Broad passing suites:
  conversation quality 37, chat 12, chat stream 30, stream client 10, memory
  29, reasoning 45, intent routing 32, tool registry 11, observer 22, daemon
  9, Development Center 59, Runtime Stability Guard 30, research intelligence
  28, source resilience 24, research status intent 12, research status view 5,
  Development Center status 27, autonomy approval 29, execution gate 16,
  proposal impact policy 27, micro item 10, micro classifier 8 and execution
  journal 24. The proposal-approval suite was interrupted
  because it performs fixture-local Git commits/pushes, despite not touching
  this repository; the owner's no-commit/no-push instruction was interpreted
  strictly. Other Git-mutating fixture suites were not run.
- `npx tsc --noEmit`, changed-file ESLint `--max-warnings 0` and
  `git diff --check` passed.
- Graphify `update --scope all --no-description --no-label .`: 13,619 nodes,
  40,092 edges, 303 communities; HEAD/source hash/last analyzed HEAD all
  `d750bd7552d4790b6116b8aa61f2748919a94fd6`; stale=false; 0 duplicate
  IDs, dangling edges, self-loops. Changed-production-file review reports
  high blast radius, 18 impacted files/7 communities. No new store, engine,
  package, cross-authority import or cycle was introduced. Graphify's test-gap
  hint is a linkage limitation: both directly related smoke suites ran.
- Independent second pass: no framework cargo-culting, second durable store,
  execution bypass, model-triggered autonomy, license-restricted code copy or
  new dependency found. BLOCKER 0; MAJOR 0; known correctness MINOR 0.

Known limits: the soft ceiling may be exceeded by the newest two very long
turns; relevance selection remains recency-first, and prompt size is measured
in characters rather than tokenizer tokens. A unified event projection and
vector retrieval were intentionally deferred. Upstream commit IDs and real
model answer-quality/cost deltas were not obtainable in this run. Live runtime
origin/tunnel was not destructively retested. Owner review is required before
any staging, commit or push.
