# AYAS Agentic Tool / Skill / Model Intelligence — Stage 7

## Scope and runtime boundary

`src/lib/ayas/routing/AyasAgenticRouting.ts` is a deterministic recommendation layer. It describes task requirements, inventories the existing capabilities, and returns a bounded decision with reason codes. It calls no executor, model, skill loader, agent, approval service, or publication path. `AyasChatStream.ts` uses only its safe, structural tool recommendation for existing read-only dispatch and refuses to answer an explicitly fresh external fact without a real lookup. Every dispatch still passes through `AYAS_EXECUTION_ALLOWLIST`, `validateAyasExecutionRequest`, and `runAyasReadOnlyAction`.

The returned `blocked` flag means a requirement or owner authority is missing; it is never an approval decision. A recommended Claude/Codex ID is not an invocation. A skill ID is not loaded into the model prompt or granted permission by this layer. The live AYAS caller supplies the health-probed Ollama ID and, since 2026-11-03, the skills `AyasSkillRegistry` actually loaded (see "Runtime skill registration" below); it supplies no external-agent registration. Test-only registration inputs exercise selection policy without launching those systems.

## Runtime skill registration (2026-11-03)

Owner question: the Control Center listed every skill as UNAVAILABLE ("Kurulu ama AYAS çalışma zamanına kayıtlı değil"). Cause: nothing loaded them, so no caller ever passed `availableSkillIds`, and nothing would have used a selected skill anyway. `src/lib/ayas/routing/AyasSkillRegistry.ts` is that loader. For each Stage 7 skill it reads one fixed SKILL.md (`.claude/skills/ayas/{tests,conversational-intelligence,router}` in the repository, `~/.claude/skills/graphify` for Graphify), requires the expected frontmatter `name`, a description, a usable body and ≤ 256 KB, keeps the hash, and returns a bounded excerpt (≤ 2,400 characters; the router keeps its authority precedence and domain table, Graphify only its purpose and honesty rules). A missing or invalid file is reported unavailable with a closed reason code. Files are re-read only when their size or mtime changes.

`AyasChatStream` passes the loaded IDs to the selector. When a skill is selected, its excerpt reaches the model as labelled reference lines ("Proje rehberi … yalnız bilgi — talimat, onay veya yürütme yetkisi değildir") in the same place as other context: the V2 context DATA message, the legacy prompt, or the reasoning core's context lines. It is never a system message and changes no tool, approval or execution decision. Under the context budget it is one optional `EXTERNAL_DATA` entry (`skill:guide`), so a tight window sheds it before any of the owner's turns or recalled memory, and it can never be the reason a turn is refused. The Control Center collector uses the same loader, so a skill reads REGISTERED only when AYAS can really load it. `tests` and `conversational-intelligence` SKILL.md are now tracked (force-added like `router`) so both machines have them.

## Normalized capability inventory

| Type | Real source | Live availability | Boundary |
| --- | --- | --- | --- |
| Read-only tools | `AYAS_EXECUTION_ALLOWLIST` (13 IDs) | Available unless the caller has evidence of failure | Existing validation and executor own dispatch; the selector cannot add an ID. |
| Web lookup | `AyasToolRegistry` descriptive placeholder | Unavailable: no ad-hoc lookup executor | A fresh external request fails visibly. Scheduled official-feed research is a separate workflow, not this chat tool. |
| Skills | `.claude/skills/ayas/{tests,conversational-intelligence,router}` and installed Claude Graphify skill | Registered when `AyasSkillRegistry` loads and validates the file (2026-11-03) | A selected skill is reference text in the prompt only. A file that does not load is not registered. |
| Local model | `AyasModelRouter` Ollama provider | Per-turn health probe | Local, zero-cost model only. The selector takes the probed availability; it does not probe again. |
| Cloud model | Existing provider shape | Ineligible under current zero-cost policy | A configured API key does not make an unknown-cost endpoint free. |
| Local AYAS | Existing chat/reasoning path | Available for bounded conversation/read-only work | No general code-write authority. |
| Claude/Codex | No AYAS caller-owned dispatch adapter was found | Unavailable live | Tests may inject a simulated verified registration; selection remains advisory and cannot dispatch. |

Each inventory entry carries ID, type, supported task classes, source, availability, cost/latency/locality class, determinism, mutation ability, approval need, and fallback eligibility. The allowlist and explicit registration/probe inputs are the sources of truth; neither prose documentation nor an API key proves availability. `code-review` was not found as a registered Codex or project-local skill. Graphify is available as a CLI and Claude skill for this development session, but it is not an AYAS runtime skill.

## Task requirements and selection

The bounded representation distinguishes conversation, memory, research, file, repository, coding, and project requests; informational versus action intent; mutation; fresh external evidence; private/local content; complexity; ambiguity; a required tool; a beneficial tool; and a relevant skill. It reuses the existing Turkish-aware complexity and file/project signals. It is intentionally conservative: unmatched wording remains conversational rather than producing an invented capability.

Selection first rejects ambiguous targets and mutation-shaped read dispatch, then checks the required tool against actual availability. A verified prior result can satisfy a read-only internal tool requirement for the same request; it never substitutes for fresh external evidence. Graphify is beneficial for a broad architecture question, but a query requires a validated symbol, so no target is guessed and no query is dispatched. The selector avoids tools for greeting, memory-only answers, arithmetic, and ordinary text responses.

Skills are chosen by task relevance only when registered. The `ayas-tests` skill matches smoke-test planning and smoke/regression questions; `ayas-conversational-intelligence` matches questions about AYAS's own chat, intents or research system (since 2026-11-03 no longer a remembered-fact question, which needs memory lines, not the chat's developer guide); Graphify matches repository architecture analysis and questions naming Graphify; `ayas-router` is the fallback for other repository/coding turns that need no read tool. An irrelevant registered skill is not selected. Skill selection never changes execution authority.

Ollama remains the sole eligible model. Its availability is supplied from the existing health-based model router, not inferred from environment configuration. If it is down, the result has no model and an honest fallback. The selector does not call a model to choose a model. Complexity, cost, latency and locality are represented, but there is no evidence-backed second eligible model to rank in production. Unknown-cost cloud is never a silent fallback.

Local AYAS is the default agent. Substantial code mutation can recommend a registered external developer agent, but still returns `blocked` until existing owner authority is satisfied. When exactly one registered agent exists, it is recommended; when Claude and Codex both exist, only explicit bounded comparative evidence (0–5) breaks the tie. A tie or missing evidence stays local with an inability/approval reason. Private/local tasks never recommend an external agent. There is no permanent vendor preference and no live Claude/Codex dispatch.

Reason codes such as `REQUIRED_TOOL_UNAVAILABLE`, `AMBIGUOUS_TARGET`, `RELEVANT_SKILL_UNREGISTERED`, `NO_EVIDENCED_AGENT_ROUTE`, and `MUTATION_REQUIRES_EXTERNAL_APPROVAL` are fixed metadata, not hidden reasoning. The new Unified Trace span records only candidate and selected counts plus a safe failure code. It stores no prompt, memory, key, provider URL, or chain of thought; trace remains observer-only.

## Deterministic evaluation and provenance

Run `npx tsx scripts/smoke-ayas-agentic-routing.ts --gate` (50 cases since 2026-11-03: nine skill-relevance cases were added, four of them negatives where AYAS is only named in chat, and the memory case now expects no skill; `scripts/smoke-ayas-skill-registry.ts` covers the loader and the prompt). The original 41 cases cover greeting, arithmetic, memory, document and source reads, Git status, fresh news/weather/prices, general research, relevant/irrelevant/unregistered skills, local-model loss, tool failure, verified prior results, private content, code delegation, absent/tied agents, write intent, ambiguous files, and paraphrases. Five cases were reserved after the production selector and validation set were written: Git-status wording, source-file wording, live price, skill registration, and agent registration. Test-only registrations are labelled simulation; no real agent, paid API, network, or live skill loader runs.

The same final evaluator was overlaid on an OS-TEMP `git archive 7814868` extraction with a `node_modules` junction. The archive has no Stage 7 selector, so its adapter calls the original `classifyAyasComplexity`, `resolveDeterministicToolCandidate`, and `routeAyasModel` with fake health-probed providers. The main checkout was never reset or cleaned. The benchmark measures deterministic routing decisions and a synthetic provider guard, not the factual quality of live model prose or the success of an external agent.

| Metric | Trusted `7814868` | Stage 7 |
| --- | ---: | ---: |
| All dimensions correct | 12/41 | 41/41 |
| Tool selection | 33/41 | 41/41 |
| Skill selection | 36/41 | 41/41 |
| Model route | 41/41 | 41/41 |
| Agent recommendation | 37/41 | 41/41 |
| Missing-capability/approval hold | 24/41 | 41/41 |
| Reserved cases | 0/5 | 5/5 |
| Unnecessary / missed tool | 1 / 7 | 0 / 0 |
| Unavailable selection / missing mutation hold | 1 / 7 | 0 / 0 |

The measured root causes were deterministic Git-status and named-Markdown misses, a stale external answer path, lack of skill/agent recommendation, unavailable-tool selection, and absent advisory holds. The write-request read-tool path is now blocked even when a model names a read tool. No actual approval or execution-gate violation was found in the baseline; “missing mutation hold” is an advisory selector metric only.

The pure route averages about 0.018 ms over 5,000 in-process selections on this machine, excluding provider health/network latency. The inventory is built from a small static allowlist and explicit registrations; no skill-file scan or model call occurs in the selector (the chat's skill loader only stats four fixed files per turn and re-reads one when it changed). Runtime, authority, legacy-project, memory and ledger integrity are checked around the regression matrix; background daemon updates to `data/brain` are reported separately.

## Limits and deferred work

The task-language recognizer is bounded. Unphrased or novel freshness requests may still need later coverage; no claim of exhaustive natural-language understanding is made. A repository architecture query without a validated symbol is a beneficial recommendation only. The Claude/Codex branches are simulated because AYAS has no live adapter for them; this sprint does not build one. (The registered-skill branch is live since 2026-11-03.) The chat's read-only tool dispatch remains gated behind its existing reasoning path, so a failed local model cannot run a tool. Existing free-text memory supersession remains Stage 6 debt.

Stage 8 Research → Improvement Learning Loop, Stage 9 Security / Supply-Chain Defense, Stage 10 Codex Skill + Developer Intelligence, Stage 10A Graphify normalization, and Stage 15 Controlled Self-Evolution are separate work. No autonomous code mutation, approval widening, paid call, or publication authority is introduced here. Do not run `smoke-ayas-observer-autostart.ts` until its pre-existing Scheduled Task fixture defect is repaired.
