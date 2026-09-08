# data/brain/

Durable state for the **Atölye Brain** (PHASE 6). Committed and synced between
machines like `data/projects/`, because it is *project knowledge*: prior
decisions, test results, known bugs, user preferences, security policies,
success/failure history, the overnight task queue.

## Hard rule: no secrets

Nothing here may contain an API key, token, password, private key, connection
string or absolute host path. This is enforced in code:

- Every record is built with `buildBrainMemoryRecord` / `buildBrainTask`, which
  run `redactBrainText` (`src/lib/brain/BrainRedaction.ts`) first.
- `validateBrainMemoryRecord` rejects a record that still matches a secret
  pattern after redaction (`BRAIN_MEMORY_SECRET_LEAK`) — it is never stored.
- `scripts/smoke-brain-security.ts` asserts the redactor catches every class.

If you ever see a credential in a file here, it is a bug — scrub it and open a
finding.

## Layout

```
data/brain/
  experience/<yyyy-mm>.json    { schemaVersion, month, records: BrainExperienceRecord[] }        ← LANDED (Sprint 181)
  queue/tasks.json             { schemaVersion, updatedAt, tasks: BrainTask[] }                  ← LANDED (Sprint 182)
  queue/results/<cycle>.json   { schemaVersion, cycleId, savedAt, report, results }             ← LANDED (Sprint 182)
  memory/<yyyy-mm>.json        BrainMemoryRecord[]                                               ← not implemented yet
  proposals/<id>.json          BrainImprovementProposal                                         ← not implemented yet
```

### `experience/` — `src/lib/brain/store/BrainExperienceStore.ts` (Sprint 181)

- `createBrainExperienceStore({ rootDir })` — `rootDir` defaults to `data/brain`;
  tests always pass a temp dir.
- `append()` validates + redacts (`validateBrainExperienceRecordForStorage`),
  rejects a record that still matches a secret pattern, writes atomically
  (temp → `fsync` → `rename`), and is idempotent on `recordId`.
- A shard that is not valid JSON throws `BRAIN_EXPERIENCE_STORE_CORRUPT_SHARD` —
  it is never silently treated as empty.
- `list()` / `recent()` are deterministic (`completedAt` desc, then `recordId`)
  and hide `mode: "dry-run"` records unless `includeDryRun: true`.

### `queue/` — `src/lib/brain/worker/BrainTaskStore.ts` (Sprint 182)

- `createBrainTaskStore({ rootDir })` — `rootDir` defaults to `data/brain`;
  tests always pass a temp dir.
- Persistence layer under `BrainTaskQueue` — the queue logic (`buildBrainTask`,
  `validateBrainTaskQueue`, `nextRunnableBrainTask`, …) is unchanged; the store
  only round-trips the same `BrainTask[]` / `BrainTaskResult[]` through JSON so
  the queue survives a restart.
- `tasks.json` envelope: `{ schemaVersion, updatedAt, tasks }`, tasks sorted by
  `taskId`. `enqueue()` is idempotent on `taskId`; every save re-runs
  `validateBrainTaskQueue` (duplicate id / unknown dependency / cycle /
  timestamp) and refuses a structurally invalid queue.
- `queue/results/<cycleId>.json` envelope: `{ schemaVersion, cycleId, savedAt,
  report, results }`. `saveCycleResults()` is idempotent per `cycleId` +
  `resultId` (`brainTaskResultId` derives one when the field is absent). Written
  by `worker/BrainWorkerCycle.ts` (`runBrainWorkerCycle`) — which runs a
  **deterministic safe stub** per task and executes nothing (Sprint 183).
- **Reject on leak** (not mask-and-keep): a task / result whose text matches a
  secret pattern → `BRAIN_TASK_STORE_SECRET_LEAK`, nothing written. Oversized
  `payload` → `BRAIN_TASK_STORE_PAYLOAD_TOO_LARGE`.
- Corrupt / wrong-shape / wrong-schema file → `BRAIN_TASK_STORE_CORRUPT` /
  `BRAIN_TASK_STORE_SCHEMA_MISMATCH`. Never silently an empty queue, never
  overwritten. Atomic write (temp → `fsync` → `rename`).
- **The store persists the queue. It does not run anything** — no task, no
  model, no pipeline, no GPU.

**Today this directory only holds this README.** Each store creates its own
subtree on first write; nothing has populated `queue/` yet (the Brain Worker
runner is a later, approved phase). `brain-plan.ts` only writes under
`experience/` if you pass `--record-experience --experience-dir`.
