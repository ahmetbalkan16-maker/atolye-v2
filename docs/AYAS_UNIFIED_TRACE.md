# AYAS Unified Trace

Unified Trace is a causal observability layer for AYAS. For one operation, such as a chat turn or an
owner approval, it records which steps ran, in what parent/child order, how long each took, whether
it was retried, and how it ended. It is an **observer only**. Nothing in it approves, gates, executes,
publishes or commits anything, and no domain code reads it to make a decision.

Code: `src/lib/ayas/trace/AyasUnifiedTrace.ts`. Read API: `app/api/ayas/trace/[traceId]/route.ts`.
Tests: `scripts/smoke-ayas-unified-trace.ts`, plus trace assertions in
`scripts/smoke-ayas-reasoning.ts` and `scripts/smoke-ayas-proposal-approval-service.ts`.

## Contract (schema version 1)

**Trace** (`AyasTraceSnapshot`): `schemaVersion`, `traceId`, `rootKind` (`chat-turn` |
`owner-approval`), `createdAt`, `endedAt?`, `status`, `spans[]`, `events[]`.

**Span** (`AyasTraceSpan`): `spanId`, `parentSpanId` (`null` for a root span), `kind`, `component`,
`operation`, `attempt` (1 for a first try, 2 for the bounded correction retry), `startedAt`,
`endedAt?`, `durationMs?` (monotonic clock), `status`, `errorCode?`, `metadata?`.

**Event** (`AyasTraceEvent`): `traceId`, `spanId` (`null` for trace-level events), `at`, `type`,
`status`, `errorCode?`, `metadata?`.

| Field | Allowed values |
|---|---|
| status | `running`, `ok`, `error`, `fallback`, `cancelled`, `denied` |
| span kind | `conversation`, `context`, `memory`, `retrieval`, `model`, `tool`, `approval`, `execution`, `persistence`, `outcome` |
| event type | `started`, `completed`, `failed`, `fallback`, `retry`, `cancelled`, `gate-result`, `memory-query`, `retrieval-query` |
| component / operation | closed allowlists; anything else is stored as `unknown` |
| metadata keys | `historyCount`, `resolvedCount`, `droppedCount`, `candidateCount`, `selectedCount`, `identityCount`, `storedCount`, `attempted`, `executed`, `attempt`; Memory Temporal v2 adds `failedCount`, `temporalAsOf`, `temporalHistory`, `currentCount`, `historicalCount`, `supersededCount`, `conflictCount`, `uncertainCount`. Values must be finite numbers, booleans or `null`. |
| errorCode | `UPPER_SNAKE`, 2–64 characters, dropped if it contains `SECRET`, `PASSWORD`, `PRIVATE`, `TOKEN` or `API_KEY` |

IDs are `crypto.randomUUID()` values. A trace ID is only a lookup key and never an authority token;
clients cannot supply one to any write path.

`status` semantics: `denied` means a policy or authority refusal (a proposal refused, a tool refused
by policy or safety). `error` means an unexpected fault (I/O, provider failure, executor failure,
timeout, router crash). `fallback` means the domain answered with its safe degraded path.
`cancelled` means a client abort or disconnect.

## Causality and propagation

Handles are passed explicitly, not through AsyncLocalStorage, so concurrent turns cannot share a
context. Span `end()` and trace `finish()` are idempotent: the first terminal status wins. A span
whose parent ID is unknown to its trace is refused (it becomes a no-op).

```
chat-turn                                   owner-approval
└─ route-turn           (ayas-route)        ├─ decide | resume  (ayas-approval)
   ├─ guided-repair     (ayas-repair)       └─ guarded-publish  (ayas-publication, gate-result event)
   ├─ load-context      (ayas-route)
   └─ stream-turn       (ayas-chat)
      ├─ assemble       (context)
      ├─ recall         (memory; memory-query / retrieval-query events)
      ├─ route          (model)
      ├─ reason | stream (model)
      ├─ dispatch       (tool)
      ├─ correction     (model, attempt 2, retry event)
      └─ persist        (persistence)
```

- **Chat.** `POST /api/ayas/chat/stream` starts the trace and the `route-turn` span, and returns the
  ID in the `X-Ayas-Trace-Id` response header. Every branch ends the turn through one `finishTurn`
  helper. A throw during setup is recorded as `error`, and a client disconnect (the stream's
  `cancel()`) as `cancelled`. `streamAyasChat` owns the `stream-turn` span. The bounded correction
  retry is a new span with `attempt: 2` under the same trace.
- **Owner approval.** `approveAndExecuteAyasProposal` and the resume/replay entry point
  `publishAlreadyOwnerApprovedAyasProposal` both use the same observer:
  - The approval span is `denied` for an `AyasProposalApprovalError`, and `error` for anything else.
  - The execution span is `denied` for an `APPROVAL`/`STABILITY_GUARD`-stage outcome, and `error`
    for any other failure stage.
  - The domain error code is preserved verbatim.
- **Memory / retrieval hooks.** The recall span records query start/end events, `candidateCount`
  (records considered), `selectedCount`, `identityCount`, duration and `MEMORY_UNREADABLE` on a
  failed read. No memory body or query text is recorded. These are the hooks later retrieval
  evaluation can build on; the scoring itself is out of scope. Memory Temporal v2 adds the query
  mode flags (`temporalAsOf`, `temporalHistory`, always present) and, when the store was readable,
  `conflictCount`, `currentCount`, `historicalCount`, `supersededCount` and `uncertainCount` — counts
  only, never a body, name, fact value or date (see `docs/AYAS_MEMORY_TEMPORAL.md`). The `persist`
  span is `error` with `failedCount` and the store's stable error code when a write fails.

## Privacy and redaction

The trace records only IDs, closed-set labels, statuses, counts, durations and sanitized error codes.
It never records prompts, user or assistant messages, provider request or response bodies, tool
inputs or results, memory bodies, retrieved documents, env values, tokens, API keys, session cookies
or proposal identifiers and bodies. Sanitization runs on every write (only allowlisted metadata keys
are ever read), and again on every read, so even a malformed stored record cannot widen what the API
returns.

## Storage and retention

`BoundedAyasTraceStore` is in-memory and process-local:

- At most 128 traces (oldest first out) and 1 hour of age, pruned on every access.
- At most 64 spans and 128 events per trace; writes beyond a cap are dropped.
- One store per process, claimed on `globalThis` under `Symbol.for("atolye.ayas.unified-trace.store.v1")`
  with the same claim pattern as the canonical pipeline runtimes. Separately loaded route bundles and
  dev reloads therefore share it.
- Traces do not survive a restart, and there is no disk I/O on the hot path.

Ephemeral storage is enough because traces answer "what just happened in this turn?". The durable
records of authority (approval inbox, execution journal, gate log) stay canonical and are untouched.

The reader (`readAyasTraceSnapshot`) returns `undefined` for an unsupported `schemaVersion` or
`rootKind`. Unknown span kinds, statuses and event types are coerced to safe values instead of
throwing.

## Failure semantics

Every trace write is best-effort and wrapped in `try/catch`. A disabled trace
(`enabled: false`, or `traceEnabled: false` on the approval deps) and a broken store (`put` throws)
both produce no record and an identical domain result. In the approval service only the domain call
sits inside each `try`, so a trace call can never replace a domain result or error.
`ayasTraceErrorCode` never throws.

## Read API

`GET /api/ayas/trace/{traceId}`:

- Protected by the access-gate middleware and by a route-level check. Unauthenticated, tampered,
  expired or garbage sessions, a misconfigured gate, and production without a key all get 401.
- Traces are scoped to `sha256(session cookie)`. Another session's trace, and malformed, forged or
  unknown IDs, all return the same 404.
- Every response carries `Cache-Control: no-store`.
- Owner-approval traces use the private `operator` scope and are never readable over HTTP.

## Authority non-goals

Trace data is never an approval, a gate input, an execution trigger, a publish or commit condition, or
a replacement for the approval inbox, execution journal or gate log. `AyasUnifiedTrace.ts` imports
only `node:crypto` and `node:perf_hooks`. The only production reader of trace state is the read route
above. Graphify review shows no new code-level path from the trace store to approval, gate,
execution or publish modules.

## Performance

Measured by `smoke-ayas-unified-trace` on a TEMP chat fixture with a mocked provider (in-process,
no model latency), 200 interleaved and warmed-up iterations per arm:

- Median turn: 0.258 ms with tracing off, 0.302 ms with tracing on, so about +0.044 ms (~17% of a
  mocked turn; negligible against a real model call).
- A real span start/end: about 2.2 µs.

No per-event disk I/O, cloning or body serialization. The numbers are reported, not asserted.

## Known coverage gaps

- ~~`persistAyasMemoryFromTurn` swallows write failures by contract, so a failed memory write shows
  as `persist` `ok` with `storedCount: 0`.~~ Closed by Memory Temporal v2: the outcome carries
  `failed` + a stable `errorCode`, and the span ends `error`.
- Owner-approval traces have no read surface (intentional; no session identity is threaded into
  authority deps).
- The chat route's `cancel()` / setup-throw lifecycle and the router-crash (`MODEL_ROUTE_FAILURE`)
  classification are covered by review only. The route module builds default-root guided-repair
  stores, so tests do not import it. Tool timeout and executor-failure classification is also
  review-only; tool success and policy denial are exercised end to end.
- The `stream-turn` span ends when the answer is computed. A disconnect during delivery is recorded
  on the parent `route-turn` span.
- Not instrumented yet: voice, research scheduler, micro-batch approval, autonomy daemon, production
  pipeline.
- Process-local only. Separate processes have separate stores.
