# AYAS PC-off safe research

This document covers the restart-safe LIGHT/DEEP research cadence and owner-scheduled, one-shot Goal Research against up to three registered official feeds. General web search is not part of this scope; the repository's `web-research-lookup` tool is still an unimplemented placeholder.

## Deployment reality

**PC-OFF DOES NOT MEAN LOCAL EXECUTION WHILE HARDWARE IS POWERED OFF.**

The observer (`scripts/ayas-autonomy-daemon.ts`) runs on the Windows workstation. It is started at log-on by the `AYAS Autonomy Observer` Scheduled Task, with a Startup shortcut as the fallback. Every five minutes it runs one `scripts/ayas-discovery-daemon.ts` child (four-minute timeout), and each child makes one research-scheduler tick. There is no cloud worker, no always-on service and no wake-on-schedule. While the machine is off or asleep, nothing runs.

"PC-off safe" therefore means: a durable schedule survives the downtime, the first heartbeat after restart detects what was missed, reconciles it idempotently and applies a bounded catch-up policy. A result is never labelled as produced at its planned time.

| Component | Role | Durable state | Authority |
| --- | --- | --- | --- |
| `ayas-autonomy-daemon.ts` / `ayas-discovery-daemon.ts` | Heartbeat; one scheduler tick per child, before discovery and inbox work | Discovery ledger | Observer only |
| `AyasResearchScheduler.ts` | 6-hour LIGHT / 24-hour DEEP cadence; runs at most one due Goal job per heartbeat first | `research/scheduler-state.json`, `research/scheduler-heartbeat.json`, lock directory | Timing only |
| `AyasResearchSchedulerStateStore.ts` | Validated, fsynced, atomically renamed checkpoint and liveness record; shared Goal limits | Same files | None |
| `AyasGoalResearchSchedule.ts` | One-shot Goal jobs in the same checkpoint and lock; the owner-facing schedule rules | Job records | Timing only |
| `AyasExecutionAuthorityLock.ts` | Cross-process exclusion (PID + start time, stale reclaim after 10 minutes) | Lock directory under `research/` | Mutual exclusion, not approval |
| LIGHT / DEEP engines | Official-feed reads (`AyasSafePublicFetch`) and local Ollama analysis | Source state, novelty memory, findings | No mutation authority |
| Approval service / Package C execution gate | Governed source mutation | Separate inbox, journal and gate root | Owner and gate authority |

The research lock root (`data/brain/self-improvement/research/`) is separate from Package C's gate. A research finding may become an inbox candidate, but the bridge's mutation kind is unregistered, so research never approves or executes a mutation.

## Recurring cadence (LIGHT / DEEP)

Every tick reads the checkpoint, fails closed on an unreadable, malformed, unknown-schema or invalid one, and takes the research lock. Under the lock it reads the checkpoint again and checks the due cadence. It then writes an fsynced reservation (run ID and a SHA-256 occurrence ID from mode and due time) before any feed or model call, runs one cycle and writes the final checkpoint, all while holding the lock. DEEP subsumes LIGHT when both are due.

- **Missed windows** coalesce. The next due time is computed from actual completion, so a three-day outage produces one cycle, not one per elapsed window. `lastMissedCount` and `totalMissedOccurrences` record what was skipped.
- **Uncertain run.** A reservation that survives a crash means the old process may have reached a feed or the model. The next tick records `lastUncertainRunId` and `lastReconciledAt`, advances the affected cadence and returns `RECOVERED_UNCERTAIN` without any external call. A second reconciliation is inert. An unexpected error during a run also leaves the reservation for this path; nothing is retried in a loop.
- **Failure counting.** A completed cycle is a successful cycle. Per-source failures keep their own durable state and exponential backoff. `consecutiveFailures`, which the runtime stability guard and the self-improvement health check read, counts only uncertain or thrown cycles.
- **Opt-out.** `AYAS_RESEARCH_SCHEDULER_ENABLED=0` skips the tick entirely.

## One-shot Goal Research

The authenticated Brain owner creates a request in the Goal panel: research text, one registered official feed (the service accepts up to three), a UTC-backed time and a missed-window policy. The server action only checks the session and calls `createAndScheduleAyasGoalResearch`. Under the research lock, and after every check, that service creates a Goal and its job together. A busy lock or a rejected request creates nothing. If the job write fails, the new Goal is cancelled.

A job stores its ID, a deterministic occurrence ID (job ID + planned time), a SHA-256 fingerprint of the Goal's intent and domains, the source IDs, the policy, the lateness bound, `attempt` (0 or 1), the run ID and separate times. Editing the Goal before it runs makes the job stale.

### Liveness and "missed"

Every tick records a heartbeat in `research/scheduler-heartbeat.json` before taking the lock, so a long run holding the lock never looks like downtime. The record keeps `liveSince`, the start of the current continuous live streak. A new streak starts when:

- the gap between heartbeats is longer than 20 minutes (a heartbeat every five minutes, a child that may take four more);
- the clock went backwards;
- the record is unreadable (fail closed: unknown liveness counts as downtime).

A job is **missed** exactly when `liveSince` is later than its planned time, meaning AYAS was not running when it was due. Waiting behind other due jobs, or behind a run holding the lock while AYAS is up, is not downtime. Downtime after an on-time pacing deferral is. A job the owner has confirmed was re-planned by the owner and is not "missed".

### Policies

| Policy | On time | Missed |
| --- | --- | --- |
| `CATCH_UP_ONCE` (default window 24 h, at most 7 days) | Runs | Runs once if still within the window, otherwise `SKIPPED_STALE` / `MISSED_STALE` |
| `SKIP_AS_STALE` | Runs | `SKIPPED_STALE` / `MISSED_STALE` |
| `REQUIRE_OWNER_CONFIRMATION` (panel default) | Runs | `AWAITING_OWNER` / `MISSED_REQUIRES_OWNER` until the owner confirms |

- **No burst.** At most one Goal job is processed per heartbeat, earliest due first. When several automatic catch-ups of the same Goal were missed, only the latest runnable one may still run by itself; the older ones wait for the owner (`MULTIPLE_MISSED_REQUIRES_OWNER`). Other Goals are not parked behind it.
- **Owner actions.** Confirm, skip and cancel go through `controlAyasGoalResearchJob` under the same lock. They never touch a running or finished job. A confirmation re-checks the Goal fingerprint, clears the old parking reason and is valid for 24 hours, after which the job parks again (`OWNER_CONFIRMATION_EXPIRED`). Restart never approves anything.
- **Source pacing.** Per-source check times and earlier Goal runs enforce each feed's minimum interval. A job may be deferred only inside the window its policy allows. Beyond it, the policy decides: `PACING_REQUIRES_OWNER` or `PACING_WINDOW_EXCEEDED`. A far-future or unreadable check time can therefore never park a job for days.
- **Faults.** A fault while deciding (before the reservation) ends that job as `SKIPPED_STALE` / `GOAL_TICK_FAILED`, with no feed or model call. A fault that escapes the Goal path never stalls the cadence: the scheduler records `lastError` and `lastGoalFaultAt`, which a later completed cycle does not clear, and continues.

### Result and sources

A run reads at most three registered official feeds and analyzes at most one entry per feed with the existing DEEP engine and local Ollama. The Goal intent reaches the prompt only as neutralized, 300-character "data context". There is no fallback to an unselected or unregistered source; a registered source removed after scheduling skips the job (`SOURCE_REGISTRY_CHANGED`). Completion codes:

| Code | Status | Meaning |
| --- | --- | --- |
| (none) | `SUCCEEDED` | At least one new finding was recorded |
| `INSUFFICIENT_SOURCE_EVIDENCE` | `SUCCEEDED` | Feeds were read; nothing new and relevant — no finding is fabricated |
| `EVIDENCE_ALREADY_RECORDED` | `SUCCEEDED` | The entries were already recorded by an earlier run (no model call) |
| `RESEARCH_SOURCE_FAILURE` | `FAILED` | At least one selected feed could not be read (others are still read) |
| `RESEARCH_ANALYSIS_FAILED` | `FAILED` | The local model or recording failed for an entry that was read |

A job has one attempt and is never retried automatically.

### Capacity

The checkpoint holds at most 100 Goal jobs. At capacity, history is dropped oldest first in this order:

1. finished jobs without findings;
2. finished jobs with findings (the findings stay in the research list; only their per-Goal link in the view is lost);
3. uncertain outcomes older than 30 days.

Open jobs, and jobs started within the last 24 hours (source-pacing evidence), are never dropped.

## Time semantics

`scheduledFor` is the planned time. `missedAt` is when a heartbeat found the job missed. `reconciledAt` is the last scheduler decision. `startedAt` is the reservation. `executedAt` and `completedAt` are the real completion time. The cadence keeps `lastScheduledFor`, `lastAttemptAt` and `lastExecutedAt` separately. Findings from scheduled runs carry `scheduledFor`, `executedAt`, `researchRunId`, `occurrenceId` and, for Goal runs, `goalId`. Example: planned 23:00, machine off overnight, restarted 08:05 → `scheduledFor` 23:00, `missedAt` 08:05, `executedAt` 08:0x.

## Crash windows

| Window | Recovery |
| --- | --- |
| Before the reservation | The due job or cycle is admitted on a later heartbeat. |
| After the reservation, before or during a feed/model call | Uncertain; never replayed (`UNCERTAIN` / `RECOVERED_UNCERTAIN`). |
| Model answered, before the finding was saved | Uncertain; no second model call. The finding may be absent. |
| Finding saved, before the final checkpoint | Uncertain; the saved finding stays, novelty and duplicate checks also hold. |
| Final checkpoint write fails | The job stays `RUNNING`; the scheduler records the fault and continues; the next heartbeat marks it `UNCERTAIN`. |
| Two daemons at once | One takes the lock and reserves; the other reports `ANOTHER_RUN_ACTIVE` or sees the finished state. Proven with two real processes: one reservation, one model call, one finding. |

State and heartbeat writes fsync a unique temporary file and rename it. On Windows the directory entry itself is not separately fsynced, so durability across a sudden power loss is not proven.

## Authority, accounting and trace

Research fetching needs no owner approval under the existing design. Scheduling and confirming need the owner's Brain session. The scheduler owns *when*, never *whether a mutation happens*: any source mutation still goes through the separate approval service, stale-HEAD checks and the Package C execution gate. DEEP uses local Ollama; this path makes no paid-provider call and does not touch the production AI-usage ledger, so no paid-provider exactly-once guarantee is claimed. Unified Trace is unchanged and observer-only. Scheduler outcomes appear in the discovery ledger (`researchOutcome`) and the research status view (IDs, counts, times and fixed codes only). Goal text stays in the Goal store; no prompt, source body or secret is written to scheduler state.

## Validation

TEMP-only smokes use run-owned roots, a `127.0.0.1` feed server and fake providers, with no internet or paid calls:

- `smoke-ayas-goal-research-schedule` — 33 scenarios: restart, on-time vs. missed, liveness, backlog coalescing, pacing windows, owner confirmation across a real restart, scope drift, cancellation, a two-process race, crash windows, source insufficiency, capacity and the bounded no-op;
- `smoke-ayas-research-scheduler` — 17 scenarios: fail-closed state, coalesced multi-day catch-up, uncertain recovery in a separate process, final-write failure, lock independence from Package C, and source failures that do not count as cycle failures.

The discovery-registry smoke fails 1 of 15 scenarios with an identical `0 !== 1` on an untouched `aef7013` archive. Its fixture repository has no `.graphify/branch.json`, which the discovery freshness gate (since `4fc5b64`) requires, so it is pre-existing and unrelated.

`smoke-ayas-observer-autostart` was deliberately not run. Its unregister scenarios omit `-TaskName`, and on a machine where the real `AYAS Autonomy Observer` task is installed they would remove it. The owner decides how to fix that isolation before it is run again.

## Known limitations

- Nothing runs while the machine is off; there is no cloud worker, and power-loss durability of the directory rename is not proven.
- Goal creation and job creation are two durable writes. A process killed between them leaves a new Goal without a job, visible in the Goal list. A research-only Goal stays `NEW` after its job ends.
- A double-submitted request (for example from two tabs) creates two jobs; the panel disables its button while a request is in flight.
- The discovery child runs the research tick before discovery and inbox work. A research run killed at the four-minute child timeout delays that heartbeat's governance work to the next heartbeat. The execution gate still re-checks stale HEAD before any mutation.
- Goal feed reads do not update the LIGHT engine's per-source state, so the regular cadence may read a feed shortly after a Goal job did (bounded by one Goal job per heartbeat).
- A persistent failure to write the scheduler state surfaces as a thrown tick (a discovery-ledger gap), not as a per-job code.
- The research source store treats an unreadable record as "never checked" (existing contract, unchanged).
