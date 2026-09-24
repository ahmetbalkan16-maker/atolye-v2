# AYAS cognitive self-improvement and answer quality — 2026-09-24

## Scope and architecture

This stage measures the observable AYAS chat path: pre-reasoning intent, recent-turn and bounded older-turn context, referent resolution, memory candidate governance, temporal retrieval, model routing, reasoning parsing, streamed reply checks and final fallback. The route remains local Ollama or the existing honest no-provider fallback. The evaluator supplies a fake local provider and OS-TEMP memory roots; it never calls a paid provider or writes live memory. Quality-gap records are **advisory evidence**, with no approval, execution, publication or code-mutation authority.

Conversation context keeps the last 12 turns and a bounded older summary. The summary now orders older user requests and assistant questions newest first, so a later correction survives the character limit. Explicitly temporary user preferences are rejected at durable-memory admission; they remain available in conversation context. The final reply guard now recognizes a short-clause past-tense claim of writing files/code/repository state, including claims that omit pipeline terminology.

## Evaluator and provenance

Run `npx tsx scripts/smoke-ayas-cognitive-quality.ts` for the regression gate. `--baseline` reports nonpassing cases without changing the exit code; `--report <new OS-TEMP .json path>` writes a new report. The evaluator has fixture version 1 and SHA-256 `6957b64c99b49457655880ef7d0f73815a0e8d203e18c976e8c9eca546558385`. The same evaluator and retrieval fixtures were overlaid on a clean `git archive f1c8e8a` extraction in OS TEMP for the genuine pre-remediation baseline. The main checkout was never reset or cleaned.

| Measure | Clean `f1c8e8a` baseline | Final worktree |
| --- | ---: | ---: |
| Cases passing | 46/55 | 53/55 |
| Unexpected failures | 7 | 0 |
| Reviewed known-limit failures | 2 | 2 |
| Held-out passing | 4/5 | 4/5 |

The seven corrected failures were one old-turn correction lost to summary truncation, three temporary-memory persistence checks, and three false file-write claim checks across reasoning, instruction adherence and contradiction. The 17 dimensions are intent accuracy, context continuity, reference resolution, memory relevance, temporal correctness, retrieval usefulness, stale-context leakage, clarification quality, reasoning consistency, answer relevance, answer completeness, instruction following, Turkish naturalness, contradiction avoidance, uncertainty calibration, tool-decision correctness and verbosity calibration. Each failure carries a category, case ID, layer, affected component and a bounded-improvement suggestion. The two remaining `STALE_MEMORY_USED` reports are advisory, not silently converted into passes.

Five held-out probes cover a Turkish pronoun, historical phrasing, an ambiguous choice, a free-text correction and a format instruction. They were not used to choose the production fixes. The dataset also covers colloquial Turkish, suffix/reference handling, negated write claims, current versus historical queries, direct answer versus clarification, irrelevant/off-topic replies, no-provider fallback, tool needed/not needed and requested short/detail forms.

## Measurement boundary

Decision probes execute real deterministic routing, context and memory logic. Context probes inspect assembled context. Prompt probes prove an instruction reaches the model prompt; they do **not** prove a model will obey it. Guard probes use synthetic provider output to verify rejection, retry, fallback or final text handling; they do **not** independently score naturalness or factual usefulness of a live Ollama answer. No hidden reasoning text is evaluated. This is an engineering regression benchmark, not a human-rated conversation-quality claim.

## Free-text supersession debt

The existing retrieval dataset's `seed:project-decision-free-text` and independent `heldout-pc-switch` cases still let a superseded free-text record reach selection/chat context. Inspection of the retrieval explanation showed both old and new records marked `temporalState=current`: arbitrary prose has no exclusive `factKey` with which to establish safe supersession. Retrieval and context propagate the representation ambiguity. A broad same-topic exclusion would erase unrelated facts, so this stage retains the measured limitation and its held-out regression. A future fix should introduce an explicitly typed, evidence-backed decision slot before suppressing an old record. The broader 74-case retrieval evaluator still reports 44 all-layer passes, with 30 reviewed limitations, and free-text stale selection at 100% in its measured subset.

## Validation and safety

TypeScript (`npx tsc --noEmit --incremental false`), changed-file ESLint (`--max-warnings 0`), `git diff --check`, and the cognitive gate pass. Relevant smoke suites pass: context 32, conversation quality 37, chat quality 35, chat stream 30, reasoning 45, memory temporal 51, memory 29 and retrieval evaluation 74 (plus its determinism, error, privacy and chat-chain checks). No live provider call or paid route was made by the cognitive evaluator. The autostart smoke was not run because its known unregister fixture can affect the real Windows Scheduled Task.

Read-only SHA-256 inventories before and after the tests show unchanged runtime (2,374 files), authority (4 files), legacy projects (2,399 files), and both restored ledger copies (SHA-256 `5f896a8ca44a59f673a14174e6658b0c24fb50bd267d41068536f4d69456a122`, 4 records). Four `data/brain` files changed on the live daemon/Next cadence: autonomy daemon state, phone-access status, discovery ledger and research scheduler heartbeat. No test writes these paths. Runtime/Test Mutation: NONE.

## Deferred work

Stage 7 owns agentic tool and model intelligence. Stage 8 owns the full research-to-improvement loop. Stage 15 owns controlled self-evolution. This stage adds no autonomous mutation or approval path. The free-text debt and human-rated live-answer naturalness remain open quality work; the deterministic benchmark makes their boundary visible.
