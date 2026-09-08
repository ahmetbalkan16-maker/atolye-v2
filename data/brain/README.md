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

## Layout (once the durable stores land — later, approved phase)

```
data/brain/
  memory/<yyyy-mm>.json        BrainMemoryRecord[]
  experience/<yyyy-mm>.json    BrainExperienceRecord[]
  queue/tasks.json             BrainTask[]
  queue/results/<cycle>.json   BrainTaskResult[] + BrainWorkerCycleReport
  proposals/<id>.json          BrainImprovementProposal
```

Today this directory only holds this README — the stores are not implemented yet.
