# Stage 15F — Durable Observability + Eval Governance + Reliability SLO

IN PROGRESS. Opened 2026-10-01 at b05283a.

## 15F.0 inspection

- Unified Trace (`src/lib/ayas/trace/AyasUnifiedTrace.ts`): three root kinds (chat turn, owner approval, research improvement), sanitized, process-local, bounded to 128 records and one hour. Labels come from closed allowlists, so operation names are already low-cardinality.
- Durable records that exist: the authorization store (tool, durable and discovery leases), two execution journals (guided repair under the audit root, self-development under the gate root), the discovery ledger, the durable task journal.
- Finding F7: the authorization store persisted a tool request's intent and plan verbatim.
- Evaluators: three are pinned as lifecycle entries (Stage 15E). There is no manifest that says which suite is a capability suite, a regression suite or a frozen held-out suite, and no runner that would show a red suite.

## 15F.1 authorization audit privacy bound

`boundAyasAuditPlan` and `boundAyasAuditIntent` in `AyasExecutionAuthorization.ts`, applied where a tool request becomes a grant descriptor. Free text becomes `{ redacted: "FREE_TEXT", sha256, length }`; an intent that is not a short code-style label becomes `sha256:<hex>;len=<n>`. The request digest is unaffected.

## 15F.2 durable operation evidence

- `AyasUnifiedTrace`: `annotate` (model lifecycle trace, tool and lease id, approval binding; closed patterns; model and binding set once; tools bounded) and an optional evidence sink called once at `finish`. The module still imports nothing but crypto and perf_hooks.
- `observability/AyasOperationEvidence.ts` (pure): the record shape, derivation from a trace and from a lease, and the read-side validator.
- `observability/AyasOperationEvidenceStore.ts`: append-and-flush daily JSONL under `<audit root>/observability/evidence`, validating reads, first record per id stands, retention by day file.
- Wiring: chat route (module-level sink), owner approval service (sink under `ayasApprovalEvidenceRoot`), chat stream annotates the routed model and each dispatched tool, the Action Runtime outcome reports its `authorizationId`.

## Open

F11: three security smokes red at HEAD (pre-existing). Next packet.

## 15F.R repair of red security smokes (finding F11) — FIXED in feb1817

- `smoke-ayas-exact-patch-safety` (23) and `smoke-ayas-exact-proposal-safety` (28) now take the reviewed baseline from commit 71f554e instead of the live or HEAD source.
- `smoke-ayas-guarded-publication` (33): the SOURCE_ONLY scope is checked at `runGuardedAyasPublication`; an unproven source proposal is asserted to be refused at approval; the rollback scenario targets `scripts/smoke-existing-editable.ts`.
- Observation recorded, not changed: the one-click lane can publish only proposals whose every file is on a SAFE patch path (in practice smoke and test files). A reviewed exact patch is local-execution only. This is the Stage 15.7 design and is now pinned by a scenario.

## 15F.3 telemetry, live operational state and authorization compaction — GREEN

Source e0d10f2d1e6e55b3171c0e757482233e96075ff3. Claude left three drafted observability modules and the authorization enumeration/removal additions uncommitted; they were retained, inspected and completed. Two defects were corrected: evidence IO failures could masquerade as an empty store, and a long-expired consumed lease could still settle after removal.

- Telemetry counts each bound tool dispatch once, prefers durable lease outcomes, keeps denied/unsettled results separate from failures, reports nearest-rank p50/p95/max and bounded retry buckets, model pin mismatch and rejected evidence.
- The operator read-only view reads each source independently, returns safe unavailable reasons on IO errors, and reports outstanding/running/lost leases, observer runs and gate state. Missing stores retain existing empty-state contracts; the default absent gate is synthetic CLOSED.
- Compaction defaults to dry-run, is never wired to a daemon, and was never applied against the live root. Default age is seven days past expiry, with a 24-hour hard floor. Consumed/unsettled records are always kept. Under the existing mutation lock the exact record is reread, its evidence is appended/flushed/read back, and only then is it unlinked. Stale evidence or record drift refuses deletion.
- Tests: 23 focused scenarios; 8/8 mutation negative controls in a 15-file TEMP overlay; full affected regression set, TypeScript and changed lint PASS; full lint 0 errors/13 unchanged warnings. Graphify 16400 nodes/47433 links, anomalies0, known PARTIAL9 and semantic pending. Result: 15F3_RESULT.json.
- Limits: stores are scanned in full although output rows/lists are bounded; read-only sections are independent snapshots, not a transaction across stores; evidence hashes are not cryptographic root authenticity; indefinitely unsettled leases require operator review. No model, container, live compaction, authority expansion or push.

Next 15F.4: versioned eval manifest, frozen grader identities and serial TEMP-safe baseline; then SLOs and closure.

## 15F.4 eval governance and frozen grader provenance — GREEN WITH DECLARED LIMITATIONS

Source 1d42c4e8f3a182f12604508749dc7f1015800df2. A strict manifest declares 62 regression, 6 deterministic capability and 1 frozen held-out suites, pinning 77 scripts/fixture dependencies by raw SHA-256. A serial TEMP local-clone runner removes the fixture remote, isolates credential/model environment, refuses RAM pressure, verifies grader bytes before/after and leaves the actual source HEAD/worktree unchanged. Three trials are supported; pass@1 and pass^k are empirical indicators, with incomplete/raw-quality states distinct. No model grading, qualification or execution authority. Owner calibration remains pending.

The complete v3 baseline ran all 69 suites: no unexpected failure; cognitive quality remains 54/55 and held-out 4/5. Three representative suites ran three times. Failed initial/v1/v2 baselines are retained, not overwritten. Two real stale-fixture/provenance failures were repaired: research improvement now uses only the immutable reviewed temporal source in its TEMP fixture, keeping every original assertion; the changed evaluator gets a new lifecycle version and the previous PINNED/admission NONE identity is read at exact historical Git revision. Historical identities can never grant admission. The common verifier starts no process; the existing operator supplies a historical-reader callback.

Current manifest v4 changes only the raw pin of one pre-existing CRLF grader to repository LF. The emitted TypeScript JavaScript is byte-identical and the relevant suite passes; the raw full v4 matrix was NOT_RUN. EVAL_MANIFEST_V1/V2/V3 and every failed/successful report remain available. 15F4_RESULT.json and 15F4_EOL_PROVENANCE.json describe this distinction.

Validation: governance 10, mutants 8/8, lifecycle 14/16 entries, historical mutants 5/5, router 22, unchanged adapter closure 12 (8 surfaces/41 modules), full baseline 69, TypeScript and lint PASS (13 old full-lint warnings). Peak baseline RAM 47.28%; no model/container/activation/push. Graphify precommit source worktree: 16439 nodes/47498 links, all four anomaly counts 0, known PARTIAL9/semantic pending. Exact HEAD refresh follows the documentation commit.

Next 15F.5: instrument the five SLO signals using the existing evidence/journals, report partial/absent observation as UNKNOWN, and preserve all existing authority gates.

## 15F.5 scoped reliability SLO counters — SOURCE CLOSED GREEN

Source 25a08cba5a509c4ed494a1d1775ffd4b2248560e. Reused the existing execution journal, owner lease, mutation boundary, authorization scan and durable task journal. No new authority engine, daemon, task acceptance or recovery binding. Optional closed metadata records the observed boundary HEAD, possible mutation dispatch, verified file scope, typed scope/HEAD violations and a bounded callback regression status/count. Legacy journals remain valid and UNKNOWN; no retrospective backfill.

The operator view now includes all five targets: unauthorized writes, duplicate external writes, stale-HEAD mutation, unexplained task loss and regression gate bypass. Every counter distinguishes a positive scoped BREACH, measured SCOPED_ZERO, and missing/incomplete UNKNOWN. It never compares an old journal's base HEAD to today's HEAD, never treats an expired unsettled lease as loss, and never certifies a global zero. Accepted durable Graphify admissions are independently correlated with replayed journals. The future external receipt contract deduplicates receipt IDs and counts multiple confirmed effects with one exact effect key; its live adapter is unbound.

The daemon formerly accepted a callback's explicit FAIL report as completion; it now refuses FAIL/malformed reports under the existing recovery ceremony. Validated report arrays are frozen before awaited checks/phase hooks. Empty legacy reports stay compatible and unmeasured. Existing production execution services already enforce their own validators; this is an additional common boundary check. No callback is automatically replayed or newly authorized.

Validation: 22 TEMP scenarios and 9/9 mutation controls, governance 10 and 8/8 controls, telemetry 23; complete current 69 suite baseline PASS_WITH_KNOWN_LIMITATIONS with no unexpected failures. Cognitive 54/55 and held-out 4/5 remain unchanged. TypeScript and lint PASS (13 existing full-lint warnings). Baseline RAM peak 51.18%. The read-only live snapshot has 44 legacy executions with UNKNOWN coverage, zero correlated durable admissions (UNKNOWN), and no live external receipt adapter (UNKNOWN). These are not failed synthetic tests and not a global SLO certificate.

15F source implementation is closed with declared live/calibration limits. Final per-machine exact HEAD Graphify refresh follows the documentation commit. User requested stop after 15F and a report: do not start 15G until a new user instruction. NO PUSH.
