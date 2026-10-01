# Stage 15B — Durable Long-Horizon Task Runtime

Canonical source: `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`, section "STAGE 15B". Opened on 2026-10-01 at `f7e19c1`, after Stage 15A.3 closed as `LOCAL_INDEPENDENCE_DEGRADED`.

## 15B.1 Task contract, event journal and one-step runtime

**State: framework only.** Three new modules and one smoke suite. No existing module, daemon, gate, approval path or store was changed, nothing imports the new modules yet, and no production activity is registered. The runtime cannot do anything on its own: it runs only activities a caller passes in code.

| File | Role |
| --- | --- |
| `src/lib/brain/autonomy/AyasDurableTask.ts` | Pure contract: task definition, events, reducer (`replayAyasDurableTask`), next-step decision (`decideAyasDurableTaskNext`). No I/O. |
| `src/lib/brain/autonomy/AyasDurableTaskJournal.ts` | Append-only event journal on disk. |
| `src/lib/brain/autonomy/AyasDurableTaskRuntime.ts` | `advanceAyasDurableTask`: at most one bounded action per call. Also task creation, owner signal and cancel. |
| `scripts/smoke-ayas-durable-task-runtime.ts` | 17 scenarios, TEMP journal roots only. |

### Model

A task belongs to one of four domains (`SELF_DEVELOPMENT`, `RESEARCH`, `REVENUE`, `ATOLYE_SUPERVISION`) and is an ordered list of at most 32 steps. A step is either an activity (a model, tool or network call, declared `READ_ONLY` or `SIDE_EFFECT`) or an owner wait. Task state is never stored. It is replayed from the events every time, so a new process after a crash or a reboot sees exactly what was recorded.

The task ID is derived from the domain and a caller-supplied task key, so creating the same task twice yields one task. A different definition under an existing key is refused.

Events: `TASK_CREATED`, `ATTEMPT_STARTED`, `ATTEMPT_SUCCEEDED`, `ATTEMPT_FAILED`, `ATTEMPT_UNCONFIRMED` (timeout, owner gone, or activity error), `STATE_REREAD` (applied, not applied, unknown), `OWNER_SIGNAL_RECORDED`, `TASK_CANCELLED`. Terminal task states: `COMPLETED`, `FAILED`, `UNCERTAIN`, `REJECTED`, `CANCELLED`.

Journal layout: `<root>/durable-tasks/<taskId>/events/<8-digit sequence>.json`, default root `data/brain/autonomy` (already gitignored). Each event carries the digest of the previous one.

### Canonical requirements and how each is met

| Requirement | Mechanism | Smoke scenario |
| --- | --- | --- |
| Survive process crash and Windows reboot | State is replayed from disk. An attempt whose owner process is gone (PID plus start time, `AyasProcessLiveness`) is closed as unconfirmed. | process crash during a read; real process liveness; restart |
| Survive local model restart | A definite failure with no effect is retried after the step's delay, up to `maxAttempts` (1–5). | model restart |
| Survive network loss | A reread that cannot observe the target records nothing; the task stays where it is until the target is reachable. | network loss during a reread |
| Survive owner delay of hours or days | An owner-wait step holds no timer and no lease. It waits until a signal is recorded. | owner delay of days |
| Survive tool timeout | Each attempt and each reread is bounded by the step's `timeoutMs`; the activity receives an abort signal. | tool timeout; hanging reread |
| Survive a duplicate daemon | An event is published with an exclusive hard link at its sequence number, so one of two writers loses. Attempt IDs are deterministic. A live owner's attempt is never started again. | duplicate daemon; live owner |
| Append-only event journal | One file per event, never rewritten. A gap, an edit, a reordered or unlinked event fails replay. | journal integrity |
| Deterministic orchestration apart from non-deterministic activities | The contract module is pure; activities run only in the runtime module. | contract; illegal histories |
| A recorded result is not called again | A succeeded step cannot start another attempt; the reducer refuses the event. | restart; happy path |
| Idempotency key | Derived from task, step, activity, effect, target and input. The same key on every attempt of a step. | contract; crash before a side effect landed |
| Exact target | Required on every activity step, one line, stored in the task definition. | contract |
| Attempt identity | Derived from the idempotency key and the attempt number; a forged ID is refused. | illegal histories |
| Bounded retry | `maxAttempts` holds on the failure, timeout and reread paths. | model restart; illegal histories |
| Current-state reread | An unconfirmed side effect is reread before anything else. A side-effect activity without a reread never starts. | both side-effect crash scenarios; registry guards |
| Uncertain terminal state | A reread that answers "unknown" ends the task as `UNCERTAIN`. It is never retried or cancelled away. | side effect with no proof either way |

### Reused primitives

- `AyasProcessLiveness`: PID plus start-time identity, so a reused PID is not mistaken for the original owner.
- The append-once idiom of `AyasExecutionGateStore` (`gate-log/<seq>.json`, exclusive create) and the temp-file, sync, publish idiom of `AyasExecutionJournal`.
- `BrainRedaction`: content that looks like a secret or an absolute user path is refused by the journal; error text is masked before it is stored.
- The rule of `AyasExecutionRecoveryPolicy` and the Stability Guard transaction: an interrupted mutation is never replayed automatically.

No new dependency was added, and no external workflow engine.

### Authority

- `OWNER_SIGNAL_RECORDED` only releases a waiting step and carries a reference to a decision made elsewhere. It is not an approval. An activity that needs owner approval must verify it in the approval store itself.
- A step names an activity from a registry the caller passes in code. Unknown names, `Object.prototype` members and unknown definition fields are refused. Nothing derives an activity, command or target from model or tool text.
- The execution gate, approval inbox, daemon and production pipeline are untouched.

### Verification

- Smoke: 17 scenarios pass. Each uses its own TEMP journal root; the suite asserts that the default root under the repository was not created.
- Mutation audit (run from a scratch script, not committed): 28 deliberate defects in the three modules, 28 caught. The first run caught 20 of 24; the four survivors were real gaps in the suite (the event digest, the sequence number, the file-name sequence and the timeout were each covered only by a neighbouring check). The suite was extended to isolate each of them, and four more mutations were tried.
- TypeScript passes. Changed-file lint has zero warnings. Full lint: 0 errors, 13 pre-existing warnings.
- Graphify after the change: zero duplicate nodes or edges, zero dangling edges, zero self-loops. The new modules import only `BrainRedaction`, `AyasProcessLiveness` and Node built-ins, and no existing file imports them.

### Known limits

- An attempt whose owner process is alive but stuck is not taken over. The decision reports `AWAIT_RUNNING_ATTEMPT` with `overdueMs`, and a human or a later packet has to act on it.
- A side-effect retry after "not applied" is only as safe as the activity's reread and the target's handling of the idempotency key.
- A journal that fails replay blocks its task until a person looks at it. There is no repair tool.
- The journal's secret check also refuses absolute user paths and e-mail addresses, so activities must return repository-relative or logical identifiers.
- Completed journals are never pruned.

### Browser-session idle watchdog

The earlier idea of a browser-session idle watchdog with safe recovery was checked against this design. The repository has no browser-session executor and the runtime has no session concept. What the idea needs is already how any activity behaves here: a late attempt is reported with `overdueMs`, a dead owner's attempt becomes unconfirmed, and a side effect is reread instead of replayed. A browser session can be registered as an activity once such an executor exists. No separate watchdog and no parallel stage were added.

## 15B.2 Recovery sweep and the first activity set

**State: bound. The owner approved the live binding on 2026-10-01** (`LIVE_BINDING_REVIEW_PACKET.md`, section 10). The sections below describe the packet as built before the approval; "15B.2 live binding" at the end describes the binding.

| File | Role |
| --- | --- |
| `src/lib/brain/autonomy/AyasDurableTaskRecovery.ts` | `sweepAyasDurableTasks`: one daemon tick over the journal. Also the live-binding state. |
| `src/lib/brain/autonomy/AyasDurableTaskActivities.ts` | The first activity set: one read-only activity, and the task definition that uses it. |
| `src/lib/brain/autonomy/AyasDurableTaskRuntime.ts` | Three additions: `inspectAyasDurableTask` (reads only), an optional in-code declaration on an activity, and an `admitStart` hook. |
| `scripts/ayas-durable-task-recovery.ts` | Operator script: dry run by default, `--apply` against a non-live root. |
| `scripts/smoke-ayas-durable-task-recovery.ts` | 16 scenarios, TEMP journal roots only. |

### What the sweep adds, and what it does not

The sweep adds no second recovery mechanism. Whether an attempt may start, must be reread or is finished is still decided by the 15B.1 contract. The sweep decides only order and budget:

1. It inspects every journal and classifies each task: advanced, waiting for a retry, waiting for the owner, running, overdue, reread unavailable, refused, terminal, unreadable.
2. It acts in a fixed order: close dead owners' attempts, then reread unconfirmed side effects, then start new attempts, oldest task first. Each task moves at most one step per sweep.
3. Activity calls run one after another and stop at `maxActivityCalls` (default 4) or `budgetMs` (default two minutes). The rest waits for the next tick.
4. A task that cannot be read or advanced is reported and skipped. The sweep repairs, takes over and cancels nothing.

Tasks that will not resolve on their own are listed in `needsReview`: an `UNCERTAIN` task, an unreadable journal, an overdue attempt, a refused step, a storage fault, and an active task with no event for a day. A task waiting for the owner is never stale, however long it waits.

### Reused primitives

- `AyasExecutionAuthorityLock` on the journal directory makes the sweep single: a second daemon gets `ANOTHER_SWEEP_ACTIVE`, and a dead sweeper's lock is reclaimed by that module's own rule (older than 10 minutes and owner not alive). The research scheduler uses the same lock the same way. The journal's exclusive link from 15B.1 remains the guarantee underneath.
- `collectAyasGraphifyFacts` and `evaluateAyasGraphifyState`, the read-only pair behind `scripts/ayas-graphify-status.ts`, are the whole implementation of the first activity.
- The arm's-length child-process pattern of the observer's discovery step is the proposed binding shape. It is not used yet.

### Authority

- **Side effects are off by default.** A sweep starts a `SIDE_EFFECT` attempt only when its caller passes `allowSideEffectStarts`. The check runs before the call and again inside it (`admitStart`), because a task can move between inspection and action. Rereads always run: they start nothing new.
- **A step cannot misdescribe its activity.** An activity may declare its effect, domains and exact targets in code. A step that disagrees is refused before anything is recorded. Without this, a side effect described as a read would be retried without a reread.
- **`admitStart`** is the one place a later capability lease (15D) or resource governor (15Q) can refuse a new attempt. It cannot refuse recovery.
- **Live journal.** `ayasDurableTaskLiveBinding()` returns `REQUIRE_OWNER`. While it does, an applying sweep throws on the default journal directory before any disk access, and the script exits with status 2. A dry run is allowed anywhere: it takes no lock, records nothing and calls no activity.

### First activity set

`self-development.graphify-state.read`, domain `SELF_DEVELOPMENT`, `READ_ONLY`, target `repository:graphify-state`, empty input. The result is commit IDs, enums and counts: `boundToHead`, `stale`, `needsUpdate`, node and edge counts, duplicate, dangling and self-loop counts, structural and semantic status. A graph that is behind is a recorded result, not a failure. A repository with no readable HEAD is a definite failure with no effect and is retried within the bound.

One task per commit (`graphify-state:<HEAD>`), so a commit's graph state is recorded once.

### Required recovery cases

| Case | Scenario |
| --- | --- |
| Process crash | process crash |
| Windows reboot | reboot |
| Restart after a persisted result | restart |
| Result persisted, acknowledgement missing | restart (both halves: result in the journal; effect at the target only) |
| Action started, result uncertain | uncertain side effect |
| Duplicate daemon | duplicate daemon; concurrent writer |
| Timeout | timeout and retry bound |
| Bounded retry, retry exhaustion | timeout and retry bound |
| Model restart, network loss | timeout and retry bound; owner delay and stale tasks (reread unavailable) |
| Owner delay | owner delay and stale tasks |
| Stale task | owner delay and stale tasks |
| Concurrent writer | concurrent writer; side effects (task moves between inspection and action) |
| Corrupted event or hash | corrupt journal |
| Current-state reread | uncertain side effect; side effects |
| `UNCERTAIN` terminal | uncertain side effect |
| Idempotency preservation | side effects |

### Verification

- Smoke: 16 scenarios pass, each in its own TEMP journal root. The operator script is run as a child process from TEMP working directories, including a TEMP Git repository where the real collector records a real (graph-less) state. The suite asserts that the repository's default journal directory was never created.
- 15B.1 smoke: 17 scenarios, unchanged, pass after the runtime additions.
- Mutation audit (scratch script, not committed; every source restored byte for byte): 67 deliberate defects in the sweep, the runtime additions, the activity set and the operator script. First run 64 caught, 3 survived:
  - `maxTasks` bounded the report but not what was advanced. A real gap in the suite: an applying sweep with `maxTasks` is now asserted to touch only the inspected journals.
  - `--enqueue-graphify-check` without `--apply` was only tested where Git could not answer, so the refusal and a Git failure looked the same. It is now run in a TEMP Git repository and must create nothing.
  - "Repository root taken from the step input" is an equivalent mutant: the empty-input check returns before the collector is called, and removing that check is a separate mutation that is caught. The suite now also asserts the collector only ever receives the root given in code.
  Final: 66 of 67 caught, 1 equivalent. Per-mutation results: `RECOVERY_SWEEP_EVIDENCE.json`.
- One incident during the audit: the first run was stopped by hand part-way and left one deliberate defect (`staleAfterMs * 1000`) in `AyasDurableTaskRecovery.ts`. It was found by inspection and reverted before anything else ran; the audit script was then changed to keep backups, mark the mutation in progress and verify a passing baseline first. The second run's baseline passed on the restored sources.
- TypeScript passes. Changed-file lint has zero warnings. Full lint: 0 errors, 13 pre-existing warnings. `git diff --check` is clean.
- Graphify review analysis of the five changed source files: blast radius "high" (score 160, 14 impacted files, 4 communities). The bridge nodes are helpers these files call (`BrainRedaction`, `AyasExecutionAuthorityLock`, `AyasProcessLiveness`, the Graphify collector), not callers of the new code. Nothing but the operator script and the two smoke suites refers to the durable task modules; the suite fails if that changes.

### Known limits

- Every sweep replays every journal, finished ones included, and finished journals are never pruned. `maxTasks` (default 5000) caps one sweep; beyond it the report says `truncated` and the remainder is not inspected. Archiving finished journals is a later packet.
- A sweeper that dies holding the lock delays the next sweep until the lock is 10 minutes old.
- An attempt owned by a live but stuck process is reported as overdue and not taken over (unchanged from 15B.1).
- The first activity's call is bounded by the step timeout, but the collector it calls takes no abort signal: a timed-out read finishes in the background and its result is discarded.

### Browser-session idle watchdog

`NOT_CURRENTLY_APPLICABLE — NO BROWSER SESSION EXECUTOR`. Checked again for 15B.2: the repository has no Puppeteer, Playwright or WebDriver dependency and no browser-session executor. The two text matches are a trace read scope and a research source entry. The sweep already reports a late attempt (`OVERDUE`), an idle active task (`stale`) and an unproven side effect (`UNCERTAIN`) without replaying anything. If a browser-session executor is added, it registers as an activity and this requirement is evaluated again.

## 15B.2 live binding (owner-approved 2026-10-01)

| File | Change |
| --- | --- |
| `src/lib/brain/autonomy/AyasDurableTaskRecovery.ts` | `ayasDurableTaskLiveBinding()` returns `OWNER_APPROVED`. The refusal is now `assertAyasDurableTaskSweepAllowed(binding, journalDir, dryRun)`, so the off switch can be tested for both states. |
| `scripts/ayas-autonomy-daemon.ts` | `runDurableTaskRecovery()` runs `scripts/ayas-durable-task-recovery.ts --apply --enqueue-head-check` as a child process (150 s timeout). `tick()` calls it when Machine Health is `ALLOW` or `THROTTLE`; a failure and a non-empty review list each add one line to `gaps`. |
| `scripts/ayas-durable-task-recovery.ts` | Flag renamed to `--enqueue-head-check`. |
| Both smoke suites | The live journal may now exist; they assert that none of their own tasks is in it. |

- **Why the flag was renamed.** `scripts/smoke-ayas-continuous-self-improvement.ts` forbids the word "graphify" on any `execFileSync(` line of the observer script, so the observer can never start a graph rebuild. `--enqueue-graphify-check` tripped that test although the script runs no Graphify. The flag was renamed; the test was not changed.
- **The observer still imports nothing new.** Its source contains no reference to the durable task modules. The smoke suite asserts that, the exact child-process arguments, the machine-health condition, and that the script is referenced once. Every existing source invariant on the observer script was evaluated against the changed file and holds.
- **The approval does not enable side effects.** A sweep with the approved binding still refuses a `SIDE_EFFECT` start; the binding scenario asserts it.
- **Verification.** Recovery smoke 16 scenarios and runtime smoke 17, plus the three observer suites that are safe to run: `smoke-ayas-autonomy-observer` 22, `smoke-ayas-micro-batch-authority-firewall` 10, `smoke-ayas-continuous-self-improvement` 10. `smoke-ayas-observer-autostart` was not run (it is classified unsafe on this machine); its assertions on the observer source were evaluated directly and hold. A second mutation audit over the binding change caught 10 of 10. TypeScript passes; changed-file lint has zero warnings.
- **What the binding scenario runs.** The exact observer command in a TEMP Git checkout whose `.gitignore` ignores `/data/`, like this repository. The task for that HEAD is created in the default journal under the checkout, the real collector records the state, a second run makes no activity call, the checkout stays clean and the lock is released.
- **Takes effect** when the owner restarts the "AYAS Autonomy Observer" Scheduled Task. The running observer process keeps its old code until then.

### Known limits added by the binding

- A commit's graph state is recorded once, at the first sweep after the commit. A graph rebound later is not recorded again for that commit.
- Each commit adds one journal directory with three small files; they are never pruned.

### Next

Stage 15B closes with this binding. Next: Stage 15C, Memory Integrity / Context-Poisoning Firewall.
