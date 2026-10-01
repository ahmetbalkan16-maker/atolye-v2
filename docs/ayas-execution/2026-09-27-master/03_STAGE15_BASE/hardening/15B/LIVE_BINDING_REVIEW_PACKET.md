# Stage 15B — first live activity binding: owner review

**State: `REQUIRE_OWNER`.** Nothing is bound. The durable task runtime, the recovery sweep and the first activity set exist and are tested, but no daemon, route or scheduled task calls them, and an applying sweep refuses the live journal directory. This packet asks for one decision: bind the recovery sweep to the live autonomy observer, or not.

## 1. What would be bound

| | |
| --- | --- |
| Component | The `tick()` of `scripts/ayas-autonomy-daemon.ts`, the process behind the Scheduled Task "AYAS Autonomy Observer" (runs from this checkout, every 5 minutes). |
| How | As a separate child process, the same way the tick already runs `scripts/ayas-discovery-daemon.ts`. The observer imports nothing new, so its module graph stays free of approval and execution code. |
| Command | `tsx scripts/ayas-durable-task-recovery.ts --apply --enqueue-graphify-check`, 150 s timeout (longer than the step's own 120 s bound, so the step's timeout decides). A failure becomes one line in the tick's `gaps`; it cannot stop the tick. |
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
