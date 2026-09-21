# AYAS Phase 1 — Self-Improvement Completion: Gap Matrix

_Baseline HEAD `4e3c2f4` · branch `wip/ayas-graphify-final-execution` · 2026-09-21 · checkpoint entry: `ATOLYE_CHECKPOINT.md` → "AYAS M26"._

This document is the evidence behind the Phase 1 verdicts. Every "current AYAS" claim below was checked against
source, live state or a real reproduction in this session; nothing is asserted from memory. Classification
vocabulary: **EXISTS** (works as needed) · **PARTIAL** · **MISSING** · **SUPERIOR-IN-AYAS** (AYAS's own design is
stronger than the pattern a comparable framework offers, for this project's threat model).

**Roadmap-phase caveat.** The owner's execution order after Phase 1 is not recorded anywhere in the repository (the
only in-repo roadmap is `ATOLYE_MASTER_ROADMAP.md`, PHASE 1–7). Deferred items are therefore mapped by
*capability area* to that document (PHASE 6 = Intelligence: AI Director / Knowledge Engine / Production Memory;
PHASE 7 = Platform: security, mobile, self-hosting) and labelled "later phase". The numbering of those later phases
needs the owner's confirmation; nothing here reorders the roadmap.

## 1. Graphify

| | before | after |
|---|---|---|
| `lastAnalyzedHead` | `331f57a` (stale — one commit behind, unnoticed) | `4e3c2f4` = HEAD, `stale: false` |
| graph | 13 391 nodes · 39 489 edges · 285 communities | 13 392 · 39 494 · 285 |
| delta | — | +1 git commit node, +5 history edges; **0 structural edges, 0 `src/`/`app/` nodes** |
| integrity | — | 0 duplicate ids, 0 dangling edges, 0 self-loops |

Graphify runs in `committed` scope and no git hooks are installed, so the graph only advances when
`graphify update .` is run by hand and never reflects uncommitted changes. That is how it fell one commit behind.

## 2. Phase 1 gap matrix (21 checklist items)

| # | Item | Before | After Phase 1 | Evidence | Phase 1 action |
|---|---|---|---|---|---|
| 1 | heartbeat / scheduler reliability | PARTIAL | **EXISTS** | Heartbeat counter + atomic state; scheduler cadence durable, catch-up runs one cycle, never replays. Health rejects malformed scheduler/daemon facts, unreadable Git HEAD/status, unreadable research locks and omitted/unreadable Graphify metadata instead of normalizing them into HEALTHY. | `AyasSelfImprovementHealth` detects a stalled/absent heartbeat; explicit absent/unreadable/ok facts fail closed |
| 2 | restart durability | EXISTS | EXISTS | Atomic temp+rename stores; execution journal; M25 bounded restart loop (10 × 30 s). Residual: after the budget the wrapper gives up in a hidden window, silently. | Health reports the resulting `DOWN` |
| 3 | discovery continuity | **PARTIAL** | PARTIAL | Live head-of-line blocking: 2 permanently over-limit candidates spend the whole per-tick budget every tick — 79 identical rejections on disk; a read-only replay of the loop shows **225 of 234 candidates never reached**. | Fix designed and verified in isolation, **withheld** by the regression rule (§5) — `docs/brain/proposals/M26-discovery-policy-suppression.patch` |
| 4 | proposal persistence | SUPERIOR | SUPERIOR | Hash-bound proposals, atomic inbox with revision, duplicate collapse by hash, 10 lifecycle states. | — |
| 5 | owner notification | PARTIAL | PARTIAL | Only passive read-only views. Repo-wide search for notif/push/webhook/email finds no delivery channel. | Deterministic `ownerActionRecommended` signal exists now; **delivery deferred** |
| 6 | approval → execution continuity | SUPERIOR | SUPERIOR | Durable APPROVE recorded regardless of the execution flag; `AyasOwnerApprovalResume` reconciler; both lanes funnel through `runGuardedAyasPublication`. Autonomous execution is off by default (`AYAS_AUTONOMOUS_EXECUTION_ENABLED`) — deliberate. | — |
| 7 | stale proposal handling | EXISTS | EXISTS | PENDING/APPROVED/DEFERRED → STALE when `baseHead` moves; micro-batch staleness. 17 of 25 live proposals are STALE — expected, every commit stales open ones. | — |
| 8 | execution-authority lock behavior | EXISTS | EXISTS | Exclusive `mkdir`, atomic owner publish, PID + start-time identity, double observation, quarantine-rename. No error-code contract suite (minor). | — |
| 9 | crash / dead-owner lock reclaim | **PARTIAL** | PARTIAL (detected) | Reproduced (`R1`–`R7`, below). | Analysis + read-only detection; **change deferred** |
| 10 | mutation reservation | SUPERIOR | SUPERIOR | Two-phase reserve/finalize, one-shot authorization bound to hash/head/files, recovery windows A/B/C, `autoReplayAllowed: false`. | — |
| 11 | scorer / gate availability | PARTIAL | PARTIAL | Gates fail closed. Availability is only discovered at execution time, and the daemon's `graphifyFresh` gate checks that `graph.json` *exists*, not that it matches HEAD (it passed while the graph was a commit stale). | Health reports `GRAPH_STALE_VS_HEAD`; gate **not changed** |
| 12 | regression-by-cluster | MISSING | MISSING | No per-cluster regression evaluation in AYAS's mutation lane (Guard checks scope dimensions and health). Low urgency: publishable classes are TEST_ONLY / SOURCE_ONLY micro items. | Deferred until AYAS publishes non-test source at scale |
| 13 | rollback | SUPERIOR | SUPERIOR | Guard `ROLLING_BACK → ROLLED_BACK`; micro-batch atomic write transaction; deliberately no git-history rewrite. | — |
| 14 | stagnation stopping | **MISSING** | MISSING | The word does not occur anywhere in `src/lib/brain`, `src/lib/ayas`, `app/brain`, `scripts`. Live stagnation found (#3). | Discovery-lane fix withheld (§5); a cross-lane detector needs a run ledger |
| 15 | failure stopping | PARTIAL | PARTIAL | `consecutiveFailures` is recorded but gates nothing; the schedule always advances (rate-limited by design). | Health flags ≥3 WARN / ≥6 CRITICAL |
| 16 | budget stopping | PARTIAL | PARTIAL | Per-tick attempts (2), batch caps (8 items / 8 files / 2 000 lines / 24 h), fetch size + retry caps. No cumulative duration/cost budget; cost is the constant `"zero-cost"`. | — |
| 17 | run history | PARTIAL | PARTIAL | Durable per-artifact records exist, no per-cycle ledger; scheduler state keeps only the latest timestamps. M25's forensics had to reconstruct from three files. | Proposed follow-up (needs owner approval: new persisted schema) |
| 18 | cost / attempt tracking | PARTIAL | PARTIAL | `attemptCount` in the suppression store, per-source counters; nothing per run. | as #17 |
| 19 | next-run persistence | EXISTS | EXISTS | `nextLightAt` / `nextDeepAt`, `nextEligibleAt`, per-source rate floor; verified live. | — |
| 20 | shadow evaluation | PARTIAL | PARTIAL | Every patch is drafted and validated in an isolated git-worktree sandbox before it can become a proposal. Nothing shadow-evaluates a *policy / scorer / prompt* change against the incumbent. | Deferred |
| 21 | promotion rules | SUPERIOR | SUPERIOR | Publishable classes frozen to `TEST_ONLY`/`SOURCE_ONLY`; owner APPROVE mandatory and hash-bound; no auto-approve anywhere; no score-based promotion by design. | — |

### Lock reclaim reproduction (#9) — real runs against `AyasExecutionAuthorityLock`, isolated temp roots

| case | result before any change |
|---|---|
| R1 provably-dead owner, lock 1 min old | `AYAS_LOCK_BUSY` — waits the full 10-min stale window |
| R2 dead owner, 11 min old | reclaimed |
| R3 lock directory with **no** `owner.json`, 1 h old | `AYAS_LOCK_BUSY` forever |
| R4 `owner.json` with the wrong shape, 1 h old | `AYAS_LOCK_BUSY` forever |
| R5 empty `owner.json`, 1 h old | `AYAS_LOCK_BUSY` forever |
| R6 live owner (this process), 1 h old | `AYAS_LOCK_BUSY` — correct, must never change |
| R7 PID reuse (alive PID, wrong start time), 1 min old | `AYAS_LOCK_BUSY` — waits the window |

R3–R5 are swallowed by `tryReclaimStaleLock`'s catch (returns `false`), so no age ever makes them reclaimable; they
need manual removal. The lock has two production callers (research scheduler, daemon dev-execution lane); Graphify
blast radius is **high (133)**.

**Why the lock was not changed.** R1/R7 cost at most ~10 minutes against a 6 h / 24 h cadence; R3–R5 need a crash
inside a millisecond window or external corruption. A safe design exists (opt-in three-state reclaim mirroring the
M12 observer lock — `dead` skips the age gate, `unknown` keeps it, `alive` never reclaims — enabled only for the
research scheduler, which holds no mutation authority) but the gain does not justify touching a high-blast-radius
module. Instead the situation is now *detected*: `RESEARCH_LOCK_OWNER_DEAD` (WARN) and `RESEARCH_LOCK_UNRECOVERABLE`
(CRITICAL). Owner may approve the change as a separate bounded item.

## 3. Findings this phase

| id | finding | severity | status |
|---|---|---|---|
| F1 | Discovery head-of-line blocking: policy-rejected candidates spend the per-tick attempt budget forever and are never remembered (only sandbox failures were, M21.4 "Gap 4"). Root: the generator pre-filters by *lines* (400) but not by *characters* (20 000), so long-lined files are generated and rejected every tick. | **High** — the individual-proposal lane cannot progress | Fix withheld (§5) |
| F7 | Success-path re-validation: once a candidate passes and becomes a PENDING proposal, every later tick at the same HEAD re-runs its full sandbox (worktree + `tsc` + smoke) and re-freezes an identical artifact; dedup only happens afterwards, in `createProposal`. Observed: six consecutive ticks returned the same candidate while the inbox stayed at one proposal. Masked today only because F1 stops the pipeline before it reaches a passing candidate. | Medium (steady sandbox load; can re-block the budget with two open proposals) | Reported; must be decided together with F1 |
| F8 | Tests share a live resource: `smoke-ayas-discovery-registry` (its fixture-repo integration) and the `micro-batch-*` suites use the FIXED path `os.tmpdir()/ayas-micro-batch-worktree` — the live observer's persistent micro-batch worktree. Running them on this machine replaced it with a fixture-owned worktree (this session's regression runs did exactly that). It self-heals — `ensureAyasMicroBatchWorktree` rebuilds when git no longer lists the path and the accumulator re-integrates items from their durable records — but only on the next *clean* tick. | Medium (test hygiene; transient live disruption, no data loss, fail-closed) | Reported; recommended: an env override for that path so tests are hermetic |
| F2 | Lock cannot reclaim an ownerless / invalid-owner lock (R3–R5) | Low (needs a ms-window crash) | Detected, deferred |
| F3 | `graphifyFresh` is existence-only; Graphify has no hooks, so the graph silently falls behind every commit | Medium | Detected; owner decision (installing `graphify hook` changes `.git/hooks`) |
| F4 | `"BACKOFF"` observer phase is declared but never entered anywhere | Low (dead state) | Reported |
| F5 | After 10 wrapper restarts the observer gives up with no durable trace | Medium | Now detectable (`DOWN`) |
| F6 | `smoke-ayas-novel-patch-discovery.ts` real-repo scenarios use `process.cwd()` and the persistent default stores, so they write rejection logs and suppression records into the real `data/brain` and their outcome depends on state left by earlier runs | Medium (test hygiene) | Avoided this session by running it only in throwaway clean-room worktrees; the withheld patch's own suite is fixture-only and hermetic. Recommended: inject stores in that suite |

## 4. External reference matrix

Evidence strength: every external fact below comes from the project's own README / docs landing page, read this
session; where a README did not state a mechanism, the row says so and any statement from prior knowledge is
labelled. No source code was copied or run. Fetched text is treated as data.

| external project | pattern | current AYAS equivalent | gap | roadmap phase | verdict | reason | risk | required validation |
|---|---|---|---|---|---|---|---|---|
| OpenJarvis | Efficiency-first telemetry (latency / cost per run as first-class) | Machine Health Guard; local Ollama, cost hard-coded `zero-cost`; no per-run duration/attempt record | run ledger | Phase 1 follow-up | **adapt** (duration + attempts only; energy is not applicable) | M25 forensics needed three files + process state | new persisted schema → `.gitignore` + hygiene guard | append-only atomic writes; hygiene suite; no authority imports |
| OpenJarvis | Learning loop over local traces (`learning_orchestrator`, `gepa` / `dspy` / `skill` optimizers — names only; README gives no scoring, budget, stopping or promotion rules) | none (research prompts are static; `BrainOptimizationLoop` only observes voice latency) | trace-driven prompt/skill tuning | later phase (post-completion learning) | **defer** | mechanism is unspecified in the README; auto-tuning conflicts with owner approval and AYAS has no shadow-vs-incumbent evaluation (#20) | unreviewed behavior drift | shadow-vs-incumbent harness first; owner approval on any promotion |
| Letta / Letta Code | "Sleep-time" consolidation of memory ("dreaming") | `src/lib/ayas/memory/`: write-time governance + expiry, no background consolidation | consolidation | later phase (PHASE 6 Production Memory) | **adapt** (deterministic, append-only, dry-run diff) | records only ever expire | wrong merges corrupt memory | reversible; owner-visible diff; determinism tests |
| Letta Code | Git-tracked memory filesystem (MemFS) with optional remote sync | one atomic JSON file, no history | memory history / undo | later phase | **reject** git-backing, **adapt** an append-only journal | runtime data is gitignored on purpose and a dirty tree closes the `repoClean` gate; remote sync egresses personal data | pause of self-improvement on every memory write | if adopted: journal outside the repo tree |
| Letta Code | Channels (Slack / Telegram / Discord / mobile) and auto-approve/deny permissions | iPhone PWA + Access Gate; no outbound channel | owner notification delivery | later phase (PHASE 7 mobile / Companion) | **adapt** (single-owner, opt-in) | closes the "silent outage" loop (#5) | outbound egress of status; a new secret | codes-only payloads; threat model in the Platform phase |
| Mem0 | Multi-signal retrieval: semantic + BM25 + entity linking, temporal reasoning | `AyasMemoryRecall`: deterministic keyword/tag overlap + importance + project + identity bonus, **no embeddings** | hybrid retrieval | later phase (Conversational Memory) | **adapt** (local embeddings + BM25 behind the deterministic fallback) | recall quality on Turkish paraphrase | nondeterminism, GPU load (the RTX A2000 60 °C stop), memory poisoning | recall eval set in Turkish; resource guard; fallback parity |
| Mem0 | Memory levels: user / session / agent | kinds + importance; no session level | session-scoped TTL memory | later phase | **adapt** | conversation continuity | scope leakage between levels | level-isolation tests |
| Mem0 | Single-pass ADD-only extraction (README, April 2026 algorithm) | append + expiry — already aligned with the append-only asset rule | none (alignment) | — | **adopt principle only** | consistent with append-only design | — | — |
| Mem0 | Benchmark claims (LoCoMo 92.5, LongMemEval 94.4) | — | — | — | **do not use** as acceptance criteria | vendor-reported, unverified here | — | — |
| LangGraph | Time-travel / replay from checkpoints (README does not state it; from prior knowledge) | execution journal + recovery classification; replay forbidden (`autoReplayAllowed: false`) | inspectable run timeline | Phase 1 follow-up | **adapt read-only timeline; reject replay** | replay contradicts the no-auto-replay invariant | — | timeline built from the run ledger, never re-invokes a mutation |
| LangGraph | Edit agent state at an interrupt, then continue (README: "inspecting and modifying agent state") | owner APPROVE / REJECT / LATER only | owner amends a proposal | — | **reject** | proposals are hash-bound; an edit is a new proposal | breaks the hash binding | — |
| Microsoft Agent Framework | OpenTelemetry tracing and middleware | ad hoc JSON output; no trace export | structured local tracing | later phase (PHASE 7 platform) | **adapt** (local file exporter, no cloud) | standard observability | dependency; leakage | no network egress; redaction tests |
| Microsoft Agent Framework / CrewAI / LangGraph | Graph or crew multi-agent orchestration | fixed pipeline order; project rule forbids a second orchestrator | none needed now | later phase (PHASE 6 AI Director) | **reject for Phase 1** | would create a second orchestrator | authority creep | out of scope |
| OpenHands | Stuck-loop detection and iteration limits (README does not state them; from prior knowledge) | per-tick attempts (2); suppression store; no cross-tick detector | cross-tick stuck detection | Phase 1 follow-up | **adapt** on top of the run ledger | generalises F1 | false positives | deterministic thresholds; pinned by test |
| OpenHands | Docker sandbox runtime | git-worktree sandbox in `os.tmpdir()`, offline toolchain, scripts/ only | OS-level isolation | later phase (PHASE 7 security) | **reject for now** | a container runtime on a personal Windows machine is a large new surface | new dependency | threat model first |
| Khoj | Scheduled automations that *deliver* results (newsletters, notifications) | findings are stored and shown passively | proactive digest | later phase (Companion) | **adapt** (owner-only, local first) | same loop as #5 | egress | as Letta channels |
| Khoj | Semantic search over personal documents | Graphify covers code only | personal-doc retrieval | later phase (PHASE 6 Knowledge Engine) | **defer** | not a self-improvement need | — | — |
| AutoGPT | One dashboard for "every agent, run, cost and action that needs your attention" | per-domain read-only views; no unified attention feed | single "needs attention" view over the health verdict | later phase (frontend) | **adapt** (read-only, consumes `AyasSelfImprovementHealth`) | closes #5 for the UI | frontend scope | none for Phase 1 |
| AutoGPT | Agent marketplace, external triggers | none | — | — | **reject** | single-owner studio; supply-chain and attack-surface cost | — | — |

## 5. Phase 1 — what was applied, and what was withheld

**Applied — M26-A `AyasSelfImprovementHealth`.** Pure evaluator, read-only collector and CLI
(`scripts/ayas-self-improvement-health.ts`, exit 0 HEALTHY / 1 DEGRADED / 2 STALLED or DOWN / 3 UNKNOWN). Detects every
silent-outage class seen in M23–M25, including the unrecoverable lock cases above. No production module imports these
leaf modules (only the dedicated CLI and smoke suite do), so they cannot change live behavior. Run against the live system it reports `DEGRADED` for exactly two true reasons
(dirty working tree → discovery paused by design).

**Independent-review remediation and clean closure.** The collector no longer drops invalid scheduler fields, failed Git
reads, non-`ENOENT` research-lock stat failures, missing `graph.json` or Graphify metadata read failures. Scheduler and daemon state require schema `1`,
non-negative safe-integer counters, valid timestamps and a valid optional run id; the evaluator independently enforces the
same health-facing shape. Git HEAD/status are explicit `ok | unreadable`; research lock and Graphify metadata are explicit
`absent | unreadable | ok`, with only a real `ENOENT` interpreted as absent. Unreadable/malformed/omitted required input yields
closed codes (`RESEARCH_STATE_UNREADABLE`, `RESEARCH_LOCK_UNREADABLE`, `REPO_HEAD_UNREADABLE`, `REPO_STATUS_UNREADABLE`,
`GRAPH_METADATA_UNREADABLE`) and never HEALTHY. The original 47 scenarios remain green; 14 clean-closure regressions bring
the suite to 61. Hostile probes cover `{}`, malformed dates/types/schemas/counters/owner identities, future heartbeat/lock mtime, HEAD
and status failures, `EACCES` / `EPERM` / `EIO`, and omitted/unreadable Graphify facts. The F6/M26-B historical and withheld
status below is unchanged.

**Withheld — M26-B discovery head-of-line fix (rolled back by the regression rule).** The change was one statement in
`AyasNovelPatchDiscovery.ts`: remember a policy rejection by content fingerprint in the existing suppression store, the
same mechanism M21.4 "Gap 4" already uses for sandbox failures, so it lifts automatically when the source changes. The gate,
its rejection reason, the audit log and the per-tick attempt bound stayed unchanged (7 of 7 mutation checks caught, incl.
"gate weakened" and "audit log dropped"). A new fixture-only suite (5 scenarios) failed on the original code and passed on
the fixed code. **Why it was rolled back:** the existing `smoke-ayas-novel-patch-discovery` scenario *"duplicate discovery
across simulated restarts"* fails with the fix once the suppression store has carried state over (reproduced
deterministically: unfixed run → PASS, then fixed run on the same state → `1 !== 0`). Diagnosis:

- The fix removes the head-of-line block, so ticks progress to candidates that were never reached; the scenario compares
  proposal counts across two ticks and so assumes both ticks judge the same candidate. That only holds while discovery is
  blocked — the block was hiding a test premise that is order-dependent (its real-repo scenarios also share a persistent
  store and write into the real `data/brain`, see F6).
- The real invariant still holds: with the fix, six consecutive ticks at one HEAD kept the inbox at one proposal for one
  gap (`proposalHash` dedup).
- The fix also changes production behavior — proposals start flowing again, and F7 becomes a visible, continuous sandbox
  load — and resolving the red test means changing an existing test's contract. Both are owner decisions, so the change was
  reverted byte-exactly (sha256 identical to the `HEAD` blob) rather than adapted around the test.

The verified change is preserved, inert, as `docs/brain/proposals/M26-discovery-policy-suppression.patch` (source diff +
the new suite; `git apply --check` passes on a clean tree). **Recommended follow-up, as one owner-approved item:** apply the
patch; rewrite that scenario with injected stores and assert the true invariant (distinct proposals per gap, same-gap
dedup across N ticks); and decide F7 (skip a candidate whose `proposalHash` already has an open proposal *before* spending a
sandbox attempt).

## 6. Deferred / rejected (not implemented in Phase 1)

M26-B (above) · lock reclaim change (analysed, safe design recorded above) · run ledger · owner-notification delivery ·
`graphifyFresh` strengthening and git-hook install · regression-by-cluster · shadow evaluation of policy changes ·
hybrid conversational retrieval · Mem0-style levels · multi-agent orchestration · OS-level sandbox · frontend work.
