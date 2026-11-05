# AYAS Controlled Self-Evolution (Stage 15)

## Switched on (owner, 2026-11-05: "kontrollü evrimi yap")

The cycle no longer waits for a hand-written register. Every discovery tick (clean tree, current Graphify, machine
ALLOW, under the existing `discovery.controlled-evolution-cycle` lease) `prepareAyasControlledEvolutionRegister`
(`src/lib/ayas/evolution/AyasControlledEvolutionLocalGaps.ts`) builds it from the repository's own measurement:

1. The registered benchmark (`cognitive-quality`) is measured at the current HEAD in the research sandbox — the same
   Stage 8 gap snapshot and store, once per HEAD, at most two attempts, only when the evaluator is in the checkout and
   the time budget allows. A snapshot the research loop already took for this HEAD is reused.
2. Each capability × dimension with failing, non-held-out cases becomes one `LOCAL_EVALUATOR` opportunity whose only
   evidence is that measurement (HEAD and evaluator digest bound, so it can never be stale). Its declared scope is the
   registered strategy's exact files when one targets the gap.
3. The unchanged cycle re-qualifies and plans; an operator file named by `AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE` is
   still read and kept beside the measured opportunities.

Modes: on by default; `AYAS_CONTROLLED_EVOLUTION=0` turns it off; an explicitly empty
`AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE` keeps its old "no register" meaning (off). Each tick writes
`data/brain/self-improvement/evolution/last-cycle.json` (git-ignored): the measurement, the opportunities with their
Stage 13/Stage 8 outcome, and the plan's reason.

**State at 3d0fdab5 (measured, 3.2 s):** `cognitive-quality` 55/55 — no failing case, nothing to evolve. The one
registered strategy (`exp-memory-render-tool-supersession`) is already applied: its source hash no longer matches, so
it would be refused before any sandbox run. The loop acts when a benchmark case fails at some HEAD (a regression or a
new owner-reviewed case) **and** a registered strategy covers that gap; a gap without a strategy is reported as
NEEDS_EXPERIMENT_DESIGN, never turned into a guessed change. Adding a strategy stays an owner-reviewed commit in
`AyasResearchExperimentRegistry.ts` (exact files, line budget, regression suites, optional reviewed exact patch).
Everything after the plan is as before: sandbox experiment, frozen artifact, an Approval Inbox proposal, and the
owner's "ONAYLA VE UYGULA" as the only way it is applied.

The discovery daemon can read an explicitly supplied Stage 13 register JSON through `AYAS_CONTROLLED_EVOLUTION_REGISTER_FILE`. Its shape is `{ "schemaVersion": "1", "opportunities": [...] }`; the existing `parseAyasEvolutionRegister` remains the validation boundary. The file is read-only and limited to 2 MiB. No register is invented when this setting is absent.

The daemon uses its observed Git HEAD, repo cleanliness, Graphify freshness and machine health. It never treats environment facts embedded in a register file as current authority. Missing or stale measurements, absent or mismatched registered strategies, unsafe scope, and insufficient time budget yield no Stage 15 candidate. The production Stage 8 strategy registry is currently empty, so configuring a register alone cannot start an experiment.

For one eligible opportunity, Stage 15 shares the Stage 8 experiment budget, durable records, isolated sandbox and evidence store. It requalifies the opportunity, admits at most one attempt, freezes only verified IMPROVED evidence as a SAFE content-bound patch artifact, and rechecks both before yielding an ordinary `patch-artifact:v1` candidate. A frozen artifact can be recovered after a crash before proposal discovery; a completed experiment without a frozen artifact is not promoted. Existing proposals for the same opportunity and HEAD, including owner-rejected proposals, are not replayed.

The candidate enters the existing `AyasAutonomyDaemon.discover` and Approval Inbox. Stage 15 does not decide, reserve approval, execute, install, publish, commit, push, or grant owner authority. The current proposal bridge sets structured impact explicitly to unresolved because the experiment has not established licensing and external-service facts; internal review therefore defers it instead of using the legacy text heuristic. A production strategy requires its own owner-reviewed commit, dedicated benchmark evidence and reviewable impact facts before an owner-facing approval request can be recommended.

Errors in this optional cycle produce a bounded discovery gap; research, stale proposal reconciliation, static discovery and owner review continue. Current known Graphify parser and semantic-description limitations remain separate from code-graph freshness and integrity.
