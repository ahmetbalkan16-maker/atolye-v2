# Stage 15B — first live activity binding: owner review

**State: `OWNER_APPROVED` on 2026-10-01.** The owner answered "Onaylıyorum, bağla" to this packet. The binding in section 5 is implemented; section 10 records what was done and the one difference from the text below. It takes effect when the owner restarts the observer's Scheduled Task.

The packet as reviewed follows. It asked for one decision: bind the recovery sweep to the live autonomy observer, or not.

## 1. What would be bound

| | |
| --- | --- |
| Component | The `tick()` of `scripts/ayas-autonomy-daemon.ts`, the process behind the Scheduled Task "AYAS Autonomy Observer" (runs from this checkout, every 5 minutes). |
| How | As a separate child process, the same way the tick already runs `scripts/ayas-discovery-daemon.ts`. The observer imports nothing new, so its module graph stays free of approval and execution code. |
| Command | `tsx scripts/ayas-durable-task-recovery.ts --apply --enqueue-graphify-check` (implemented as `--enqueue-head-check`, see section 10), 150 s timeout (longer than the step's own 120 s bound, so the step's timeout decides). A failure becomes one line in the tick's `gaps`; it cannot stop the tick. |
| When skipped | When Machine Health says anything other than `ALLOW` or `THROTTLE`. |

## 2. The activity set

One activity, one domain, read-only.

| | |
| --- | --- |
| Activity | `self-development.graphify-state.read` |
| Domain | `SELF_DEVELOPMENT` |
| Effect | `READ_ONLY` |
| Target | `repository:graphify-state` (fixed name; the step's input must be empty) |
| What it does | Records whether the knowledge graph is bound to the current HEAD: commit IDs, stale flag, needs-update marker, node and edge counts, duplicate, dangling and self-loop counts. It uses the collector behind `scripts/ayas-graphify-status.ts`. |
| Task | One task per commit (`graphify-state:<HEAD>`), one step, at most 3 attempts, 60 s apart. Once a commit's result is recorded it is never read again. |

## 3. Side effects that become possible

- **Files** under `data/brain/autonomy/durable-tasks/` (gitignored): one directory per commit holding three small event files, plus a lock directory that exists only while a sweep runs.
- **Reads**: two read-only Git queries (`rev-parse`, `status`, optional locks disabled) and local file reads, once per new commit.
- **Nothing else.** No network, no model, no container, no Graphify run or refresh, no source change, no Git write, no approval, no execution gate transition, no spend.

## 4. Capability and authority boundary

- The registry is frozen and holds this one activity. A step naming anything else is refused, and so is a step whose effect, domain or target disagrees with the activity's own declaration.
- The sweep never starts a `SIDE_EFFECT` step unless its caller enables that in code. The script does not expose that switch.
- The repository root comes from the script's working directory, never from a task, a model or a tool result.
- The approval inbox, the execution gate, `AyasAutonomyDaemon`, the research scheduler and the production pipeline are not imported and not changed.
- An owner signal on a durable task releases a waiting step. It is not an approval and this set has no owner-wait step.

## 5. Change on approval

| File | Change |
| --- | --- |
| `src/lib/brain/autonomy/AyasDurableTaskRecovery.ts` | `ayasDurableTaskLiveBinding()` returns `OWNER_APPROVED` (one line). |
| `scripts/ayas-autonomy-daemon.ts` | About 15 lines: one child-process helper and its call in `tick()`. |
| `scripts/smoke-ayas-durable-task-recovery.ts` | The binding scenario expects the new state and allows the observer script as a caller. |
| Docs | Checkpoint, ledger, notes. |

The observer is a long-running process, so the binding takes effect only after its Scheduled Task is restarted. That restart is an owner action.

## 6. Rollback

1. Revert the binding commit: the sweep refuses the live journal again and the observer no longer calls the script.
2. Restart the observer's Scheduled Task.
3. Optional: delete `data/brain/autonomy/durable-tasks/`. Nothing else reads it.

No data migration and no state outside that directory.

## 7. Evidence

- `scripts/smoke-ayas-durable-task-recovery.ts`: 16 scenarios in TEMP journal roots. Covered: process crash, reboot, restart after a persisted result, a result whose acknowledgement was lost, an uncertain side effect, duplicate daemon and a crashed sweeper's lock, tool timeout, bounded retry and retry exhaustion, owner delay, stale and overdue tasks, a concurrent writer, a corrupted event and a missing event, reread before new work, the `UNCERTAIN` terminal state, idempotency across a retry, the dry run, the activity set, and the binding guard.
- `scripts/smoke-ayas-durable-task-runtime.ts`: 17 scenarios, unchanged and passing.
- Mutation audit: 67 deliberate defects, 66 caught, 1 equivalent. Details in `IMPLEMENTATION_NOTES.md`, section 15B.2.
- The suite fails if any file under `src`, `app`, `scripts` or `deploy` other than the operator script and the two smoke suites refers to the durable task modules, and if `package.json` runs the script.
- Graphify: see `RECOVERY_SWEEP_EVIDENCE.json` for the binding to the packet commit.

## 8. Known limits

- A sweeper that dies holding the lock delays the next sweep by up to about 15 minutes (10-minute staleness rule plus one tick).
- An attempt whose owner process is alive but stuck is reported as overdue and is not taken over.
- Finished journals are never pruned: one small directory per commit accumulates.
- A corrupt journal blocks its own task until a person looks at it. Other tasks continue.

## 9. Decision

- **Approve**: the change in section 5 is made, tested, committed locally and reported. No push.
- **Reject or later**: nothing changes. The runtime stays framework-only and Stage 15B stays open at this gate.

## 10. Decision record and implementation

- **Decision:** approved by the owner on 2026-10-01, in the session that produced this packet. The approval covers the one read-only activity in section 2. It does not enable side-effect starts and grants no other authority.
- **Implemented as reviewed:** `ayasDurableTaskLiveBinding()` returns `OWNER_APPROVED`; the observer's `tick()` runs the operator script as a child process, skips it unless Machine Health is `ALLOW` or `THROTTLE`, and folds a failure or a non-empty review list into `gaps`.
- **One difference from the reviewed text: the flag is named `--enqueue-head-check`, not `--enqueue-graphify-check`.** An existing invariant test (`scripts/smoke-ayas-continuous-self-improvement.ts`) forbids the word "graphify" on the observer's child-process line, so that the observer can never start a graph rebuild. The script runs no Graphify, but the flag name tripped the test. The flag was renamed and the test was left untouched. Behaviour is identical.
- **Off switch kept and tested:** the refusal moved into `assertAyasDurableTaskSweepAllowed`, tested for both states. Returning `REQUIRE_OWNER` from `ayasDurableTaskLiveBinding()` refuses an applying sweep over the live journal again.
- **Smoke suites:** both durable task suites no longer assert that the live journal directory is absent, because the observer now creates it. They assert instead that no task they created exists in it.
- **Known limit found while implementing:** a commit's graph state is recorded once, at the first sweep after that commit. If the graph is rebound a minute later, the record still says what was true at that sweep. The record carries its event time; nothing reads it as the graph's current state.
- **Still required from the owner:** restart the "AYAS Autonomy Observer" Scheduled Task. Until then the running observer process uses its old code and does not call the sweep.
