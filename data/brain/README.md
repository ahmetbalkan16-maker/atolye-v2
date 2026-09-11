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
  selfheal/incidents/<id>.json { BrainIncident }                                                 ← LANDED (Self-Healing v1)
  selfheal/learned/<id>.json   { BrainLearnedPattern }                                           ← LANDED (Self-Healing v1)
  selfheal/signatures.json     { schemaVersion, entries: [{ signature, openedAt }] }             ← LANDED (Self-Healing v1)
  selfheal/optimizations/<id>.json { BrainOptimizationRun }                                      ← LANDED (Autonomous v2)
  selfheal/events.json         { schemaVersion, events: BrainRuntimeEvent[] } (bounded ring)     ← LANDED (Autonomous v2)
  selfheal/auto-applies.json   { schemaVersion, timestamps: number[] } (per-hour rate limit)     ← LANDED (Autonomous v2)
  selfheal/decisions/<id>.json { BrainSelfHealDecision } (operator ONAYLA/REDDET/DAHA SONRA)      ← LANDED (Report Center)
  selfheal/latency.json        { schemaVersion, samples: BrainVoiceLatencySample[] } (bounded ring) ← LANDED (Optimization Loop)
  memory/records.json          { schemaVersion, records: BrainMemoryRecord[] } (bounded ≤ 500)   ← LANDED (Phase 2 · Phase C)
  proposals/<id>.json          BrainImprovementProposal                                         ← not implemented yet
```

### `memory/` — `src/lib/ayas/memory/AyasMemoryStore.ts` (Phase 2 · Phase C)

- AYAS long-term memory — the thin fs adapter the pure `BrainMemoryModel` always
  expected. One file `records.json` (`{ schemaVersion, records }`), atomic write
  (temp → `rename`), bounded to 500 records (oldest non-pinned dropped first).
- **This subtree is gitignored** (`/data/brain/memory/`) — per-machine, not
  shared. (Cross-machine memory sync is a later phase.)
- Written **fire-and-forget** by the chat path (`streamAyasChat` → `persistAyasMemoryFromTurn`)
  AFTER a reply: `extractAyasMemoryCandidates` (deterministic pattern match — an
  explicit preference / decision / env-fact / bug; small talk yields nothing) →
  `scoreAyasMemoryCandidate` (importance + confidence gate; `transient` / secret
  / `security-policy` → rejected) → `buildBrainMemoryRecord` (redaction) →
  `validateBrainMemoryRecord` → `store.append` (re-asserts no-secret; dedupes on
  `contentFingerprint`). It never blocks the response and never throws into it.
- Read by `recallAyasMemoryLines` before a reply: `rankAyasMemory` scores each
  record on importance + query/active-project token overlap, takes the top 4,
  caps the block at ~700 chars, and injects them as
  `"Kalıcı hafızadan hatırlananlar"` prompt lines — the whole store is never
  dumped. `[]` on an empty store or any error.
- Nothing here opens the execution gate, runs a task, or touches git.

### `selfheal/` — `src/lib/brain/selfheal/BrainSelfHealStore.ts` (Self-Healing v1)

- The durable side of the Self-Healing Brain: one JSON file per incident /
  learned pattern; atomic write; `containsBrainSecret` REJECTS a leak (never
  masks-and-keeps); corrupt / wrong-schema → loud throw, never a silent fresh
  start; deterministic listing (newest first).
- **This subtree is gitignored** (`/data/brain/selfheal/`) — it is per-machine
  operational state, not shared project knowledge. The learned patterns are the
  Brain's local memory of "this fix worked here".
- Written by the operator CLI (`npm run selfheal:*` / `scripts/selfheal.ts`), the
  E2E smokes (which use a temp dir), and — for `decisions/` only — the
  auth-gated `recordSelfHealDecision` Server Action behind the AYAS Report Center
  buttons. A decision record carries the operator's ONAYLA / REDDET / DAHA SONRA
  choice + a deterministic `operatorApprovalId` + a redacted note; it does NOT
  run git, stage a patch, or touch the execution gate. `npm run selfheal -- apply
  <id>` reads it and requires an APPROVE before it stages anything. The browser /
  autonomous loop never writes an incident, patch, or learned pattern here.
  Nothing here can open the execution gate, push, merge or deploy.
- `latency.json` is the optimization loop's Voice Lab latency feed. Marks are fed
  by `npm run selfheal -- latency <voice-lab-report.json>` (the operator copies
  the Voice Lab report), validated (number, non-negative, sane range, known
  metric, sane timestamp; an instruction-shaped `source`/`sessionId` is
  rejected), normalized, and appended (bounded ring). `observeVoiceLatency` reads
  them to a REGRESSION / STABLE / IMPROVED / UNKNOWN finding — a confident
  regression opens a `performance` **observation** incident (no patch, no
  hypothesis, no auto-progression). It never runs a sandbox / apply.

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
