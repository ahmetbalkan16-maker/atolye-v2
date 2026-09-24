# AYAS Retrieval Evaluation — 2026-09-24

## Scope and recovery

This sprint evaluates AYAS memory retrieval without a model judge, provider call, live memory write, migration, or new authority path. Claude left three new, untracked evaluator files and two modified production files. The worktree was preserved. The production changes were Turkish token stemming shared with the chat relevance gate, an identity freshness exception for the current name, and a content-evidence admission filter that removes category-only distractors when the question matches a memory body. The evaluator and fixtures were already substantial, but had not been committed or documented. The repository contained no pre-remediation baseline artifact.

The trusted production source was `bebb9baa574187db30aec361dd43deb05d15ba15` (`feat(ayas): add temporal memory semantics`). A clean `git archive` of that commit was expanded under the OS TEMP directory. Only the three evaluator/fixture files were overlaid from this sprint; production sources in the archive were left at `bebb9ba`. A junction to the repository's existing `node_modules` supplied dependencies. The same final evaluator contract and fixture digest were used for both arms. **BASELINE_SOURCE = bebb9ba clean TEMP archive.** The archive has no `.git`, so its generated JSON report says `commit: "unknown"`; this is an archive metadata limitation, not a claim that the production source was unknown. The main worktree was never reset or replaced. The baseline gate exits nonzero by design; metrics and failures were written before that gate. No prior baseline measurement was found in the repository.

Fixture version `2`, SHA-256 digest `5c5189437dad47736774bcbbc7509231318a0d0b67d5e3eac72fe8ce59c7d456`, was identical in both arms. The baseline had 43 gate failures and 44 failing cases; the final code has 0 gate failures and 30 failing cases, all in the reviewed known-limitation map. The auxiliary category-admission probe adds two expected baseline gate failures and passes on the final code.

## Architecture and ground truth

`scripts/fixtures/ayas-retrieval-evaluation-cases.ts` defines synthetic records with semantic keys, a query, frozen `nowIso`, optional explicit temporal mode, relevant keys, a primary key, forbidden keys with reasons, contradiction groups, as-of certainty, forgotten keys, and strict abstention. Labels are authored independently of retrieval output. The 13 temporal seed fixtures are imported without changing their resolver-level meaning; 61 new cases bring the total to 74, including 8 held-out paraphrases. The cases cover exact recall, paraphrase, Turkish suffixes, possessives and word order, colloquial and synonym variants, current and replaced preferences, historical/as-of, future intent, conflict, distractors, different attributes of one topic, identity, abstention, multiple relevant memories, and legacy v1.

The evaluator uses the real path:

`query → temporal detection → pre-admission candidate signal → temporal/conflict quarantine → ranking/top 4 → recall block → chat relevance gate → model prompt or deterministic identity answer`.

Layer A counts lexical/concept signal before admission by reading each record as a singleton through the production retriever. This keeps category-label candidates visible even when the later admission filter removes them. A separate control proves a category-only coffee record is a candidate but is not selected for a voice question. Layer B scores first relevant rank, Recall@1/@4, HitRate@1/@4, MRR and precision where a relevant target exists. Layer C maps actual recall lines and captured chat prompts back to synthetic semantic keys; it checks required delivery, stale/forbidden keys, contradictions, duplicates, unmapped lines and abstention. The real chat turn uses a captured fake provider and frozen clock. No memory body or question is emitted in the machine-readable report or Unified Trace.

Current/historical/as-of queries are graded separately. Unknown legacy v1 time precision is never invented. Forget removes a record through the store API before retrieval. Exact negatives must produce no selection and no context. Scope isolation is checked across separate TEMP stores in current, history, as-of and chat paths. The existing Unified Trace records counts and safe flags only; this sprint adds no new telemetry.

## Baseline → final

Percentages use the evaluator's eligible-case denominators; `n/a` cases are excluded rather than counted as failures. The report JSON includes exact denominators, category and Turkish-tag groups, per-layer pass rates and semantic-key failure rows.

| Measure | Baseline | Final |
| --- | ---: | ---: |
| Candidate Recall | 82.3% | 98.4% |
| Recall@1 / Recall@4 | 71.8% / 79.0% | 86.3% / 96.8% |
| HitRate@1 / HitRate@4 | 74.2% / 79.0% | 90.3% / 96.8% |
| MRR | 0.766 | 0.925 |
| Precision@1 / selection precision | 93.9% / 70.2% | 91.8% / 72.8% |
| Current correctness | 36.5% | 59.6% |
| History / as-of correctness | 0.0% / 66.7% | 100.0% / 66.7% |
| Explicit as-of correctness | 100.0% | 100.0% |
| Exclusive-slot superseded selection | 0.0% | 0.0% |
| Free-text stale selection | 87.5% | 100.0% |
| Future-as-current / deleted resurrection | 0.0% / 0.0% | 0.0% / 0.0% |
| Conflict correctness | 80.0% | 80.0% |
| Abstention / exact-negative correctness | 83.3% / 100.0% | 91.7% / 100.0% |
| False-positive / distractor selection | 16.7% / 29.1% | 8.3% / 9.1% |
| Recall required delivery | 79.0% | 96.8% |
| Recall stale / contradictory context | 33.3% / 36.8% | 37.8% / 42.1% |
| Chat required delivery | 55.0% | 81.7% |
| Chat stale / contradictory context | 34.1% / 31.6% | 38.6% / 36.8% |
| Held-out HitRate@4 / MRR | 71.4% / 0.643 | 100.0% / 0.833 |
| All-layer pass, held-out | 25.0% | 50.0% |
| All-layer pass, all cases | 30/74 | 44/74 |

The lower final Precision@1 and higher aggregate stale/contradictory rates are reported as regressions in those descriptive measures; they are dominated by labelled free-text cases and do not violate the strict exclusive-slot or explicit-as-of gates. They must not be described as solved. There is no arbitrary 95% target: aggregate floors/ceilings were set at the observed final values, with strict 100%/0% gates only for deterministic safety contracts.

The benchmark used synthetic corpora of 50, 200, 500 and 2,000 records, 15 warmed repetitions per size. In the final paired measurement, median retrieval was 1.3/5.5/12.9/54.6 ms on the baseline and 1.2/4.6/12.1/48.2 ms on the final code; these are local timing observations, not a service latency SLO. Retrieval grew approximately linearly. Median per-case retrieval was 0.39 → 0.39 ms; recall 0.70 → 0.71 ms, with normal timing variation.

## Baseline failure classification

Each of the 44 failed baseline cases was assigned a primary failure class from the actual layer/score evidence. Downstream layer failures from an earlier miss are not counted as separate root causes. These are baseline classifications, not claims that all cases are now solved.

| Primary class | Cases |
| --- | --- |
| `QUERY_NORMALIZATION` | `seed:identity-known-at-january`, `seed:historical-recorded-today` |
| `CANDIDATE_GENERATION` | `para-pc-thinking`, `para-length-how`, `morph-length-plural`, `syn-pc-colloquial`, `syn-edit-montaj`, `history-length-used-to`, `future-as-current-workstation`, `distractor-edit-vs-channel`, `multi-workflow-prefs`, `legacy-superseded-by-v2`, `heldout-name-call-me`, `heldout-ram-bellek` |
| `RANKING` | `order-length-inverted`, `syn-length-yanit`, `current-pref-voice`, `current-pref-edit`, `superseded-length-old-wording`, `attribute-pc-current-card`, `none-same-word-other-meaning`, `heldout-voice-length` |
| `CONTEXT_ASSEMBLY` | `seed:recency-response-length`, `morph-coffee-locative`, `superseded-length-direct`, `correction-voice-length`, `heldout-length-want` |
| `TEMPORAL_FILTER` / free-text expected limitation | `seed:project-decision-free-text`, `exact-pc-plan`, `para-pc-plan`, `morph-pc-last-decision`, `morph-pc-card-accusative`, `order-pc-inverted`, `asof-pc-july-detected`, `future-plan-question`, `contradiction-free-text-coffee`, `distractor-pc-heavy-current`, `multi-pc-card-and-ram`, `tr-pc-capitals`, `tr-pc-punctuation`, `tr-pc-typo`, `heldout-pc-card-want`, `heldout-pc-switch`, `identity-old-unchanged` |

The final 30 failing cases have an explicit known-limitation entry in the smoke: 23 `EXPECTED_LIMITATION`, 5 `CONTEXT_ASSEMBLY`, and 2 `QUERY_NORMALIZATION`. The gate rejects a new failing layer, an unlisted failure, or a case that unexpectedly starts passing without updating that map. The largest open issue is free-text correction: a changed PC plan has no closed exclusive fact slot, so the earlier plan may still be selected and delivered. This is an existing Memory Temporal v2 design limit. The current sprint did not infer a new general supersession authority from arbitrary prose. Other remaining limits include same-topic attribute confusion, unsupported synonyms, two natural-language time patterns, and the chat gate dropping some one-word/short-root matches. A 50% held-out all-layer pass rate makes those limits visible; held-out HitRate@4 and MRR pass their measured regression gates, but the failing cases are not claimed correct.

## Regression and safety gates

The smoke enforces zero stale exclusive-slot selection/context, zero future-as-current, historical-as-current and deleted resurrection, 100% explicit as-of correctness, 100% strict-negative correctness, no disputed/conflicting selection, no duplicated context lines, and no network attempt. Repeated evaluation, shuffled corpus write order, and two time zones produce the same timing-free result. TEMP root checks, cross-root isolation, unreadable store and error paths, end-to-end chat chains, trace privacy, and a scan of production source for fixture IDs, benchmark phrases and answer keys are also gates. No fixture-specific production branch or benchmark answer was found.

The evaluator writes stores only under run-owned `os.tmpdir()` directories and removes them afterward. `--report` accepts only a new file inside the real TEMP directory. No paid provider is called. Relevant regressions pass: memory temporal 51, memory 29, chat stream 30, chat quality 35, conversation quality 37, context 32, Unified Trace 17, intent routing 32, reasoning 45, brain security 11. TypeScript `--noEmit --incremental false`, changed-file ESLint `--max-warnings 0`, and `git diff --check` pass.

Read-only before/after hashes and mtimes were identical for 2,378 runtime/authority files and all 2,399 legacy `data/projects` files. The live memory store was unchanged. The restored AI-usage ledger remained SHA-256 `5f896a8ca44a59f673a14174e6658b0c24fb50bd267d41068536f4d69456a122`, four records. The first `data/brain` comparison found changes to `autonomy/daemon-state.json`, `self-improvement/discovery-runs/ledger.json`, and `phone-access/status.json`. A later post-push comparison also found writes to the approval and micro-batch inboxes, five micro-item files and three patch-artifact files. Process inspection found the pre-existing continuous autonomy and access daemons (started 06:48 local, before evaluation). The autonomy daemon launches `ayas-discovery-daemon.ts` every five minutes; that source opens the inboxes, discovers proposals and accumulates micro batches. Its tick observes the new Git HEAD, so some later background writes may be a response to the commit. The evaluated scripts use TEMP memory roots and do not import or run those writers. **Runtime/Test Mutation: NONE**; background daemon writes are reported separately, not attributed to tests.

## Run

From the repository root in PowerShell:

```powershell
npx.cmd tsc --noEmit --incremental false
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts --failures
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts --explain exact-pc-plan
npx.cmd tsx scripts/smoke-ayas-retrieval-evaluation.ts --report "$env:TEMP\ayas-retrieval-$(Get-Date -Format yyyyMMddHHmmss).json"
```

The JSON report is a transient diagnostic artifact and is not committed. A failed gate exits nonzero. The evaluator's `--explain` output shows semantic keys, scores, temporal state, rank and admission drops without printing bodies.
