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
  experience/<yyyy-mm>.json    { schemaVersion, month, records: BrainExperienceRecord[] }   ← LANDED (Sprint 181)
  memory/<yyyy-mm>.json        BrainMemoryRecord[]                                            ← not implemented yet
  queue/tasks.json             BrainTask[]                                                    ← not implemented yet
  queue/results/<cycle>.json   BrainTaskResult[] + BrainWorkerCycleReport                     ← not implemented yet
  proposals/<id>.json          BrainImprovementProposal                                       ← not implemented yet
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

**Today this directory only holds this README.** The store creates
`experience/` on first write; running productions have not populated it yet, and
`brain-plan.ts` only writes here if you pass `--record-experience --experience-dir`.
