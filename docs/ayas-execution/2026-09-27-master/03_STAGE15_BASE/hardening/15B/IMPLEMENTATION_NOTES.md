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

### Next

15B.2: a recovery sweep that a daemon tick can call (advance each active task by one step), and the first owner-reviewed activity set, starting with one read-only activity in one domain. Nothing is wired until then.
