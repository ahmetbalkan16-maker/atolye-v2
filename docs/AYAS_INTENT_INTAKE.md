# AYAS Queued-Intent Authorization Pipeline

Master Sprint §21–23. Server-side only — the phone client (PWA / native) is a
later, separately-approved piece.

## The chain

When the phone reconnects it `POST`s the batch of *intents* it recorded while
the PC was offline. Every intent runs the full chain before anything happens:

```
USER → AUTH → AUTHORIZATION → ACTION POLICY → EXECUTION GATE → (engine)
```

| Stage | Where | Denies when |
|---|---|---|
| AUTH | `middleware.ts` + the route re-verifies the `ayas_session` cookie | no valid session |
| AUTHORIZATION | `evaluateAyasIntent` shape/bounds check | malformed `clientIntentId`, empty/oversize text, bad `clientSeq`, oversize `payload` |
| ACTION POLICY | `classifyAyasIntent` fixed table | unknown intent kind |
| EXECUTION GATE | the constant `ayasExecutionGate = "CLOSED"` | classification is `execution` **or** `forbidden` |

`src/lib/ayas/intake/AyasIntentPipeline.ts` is pure and deterministic (no fs, no
crypto, no network — the digest fn is injected). `AyasIntentLedger.ts` is the
durable store, mirroring `BrainTaskStore`.

## Execution Gate CLOSED → mobile execution intent DENIED (§23)

`classifyAyasIntent` maps intent kinds the same way `BrainAutonomyPolicy` maps
task kinds:

- **reasoning** — `ask`, `brainstorm`, `note`, `analyze`, `plan`,
  `decision-support`, `challenge-me`, `project-question` → **accepted**, handed
  to the Brain to answer or to queue as an existing `auto-safe` `BrainTask`.
- **execution** — `run-pipeline`, `approve-improvement`, `render-video`,
  `publish`, `modify-code`, `git-push`, `gpu-inference`, `delete-data` →
  **`denied-execution-gate-closed`**. Recorded in the ledger, never enqueued,
  never run.
- **forbidden** — `change-bios`, `change-power-limit`, `pull-model`,
  `disable-security-control` → same deny, classification `forbidden`.

The DENY is the **gate**, not the action policy: the `action-policy` step still
reports `pass` for a well-formed execution intent — it is the `execution-gate`
step that returns `deny`. `smoke-ayas-intent-intake` scenario 2 is the proof.

## Reconnect / sync

- **Idempotent** — `admitAyasIntents` dedupes on `clientIntentId`. Replaying a
  whole batch is a no-op (`ledgerChanged: false`, every outcome `duplicate`).
  Safe under at-least-once delivery.
- **Order** — the ledger is kept sorted by `(clientSeq, clientIntentId)`.
- **Cursor** — `highWaterSeq` (max admitted `clientSeq`) is the phone's
  reconnect cursor; `GET /api/ayas/intake` returns it plus the entries so the
  client can reconcile which intents were processed and with what decision.
- **No raw utterances** — the ledger stores `textDigest` (sha256), never the
  intent text. Loud on corruption (`AYAS_INTENT_LEDGER_CORRUPT`), never treated
  as empty, never overwritten.
- Batch cap 100 / body cap 256 KB / ledger cap 5000 entries.

## What it deliberately does NOT do

- It never executes an intent. `smoke-ayas-intent-intake` scenario 13 statically
  asserts the intake layer references no `PipelineRunner` / `BrainWorkerCycle` /
  `ProductionExecution*` / `child_process` / `ffmpeg` / gate-opening.
- Accepted *reasoning* intents are not auto-run here — wiring them into the
  existing `BrainTaskStore` queue (as `auto-safe` tasks the PC worker drains) is
  a small follow-up, kept out of this change so the authorization boundary lands
  on its own.
- Coverage: `npm run smoke:ayas-intent-intake` (13 scenarios).
