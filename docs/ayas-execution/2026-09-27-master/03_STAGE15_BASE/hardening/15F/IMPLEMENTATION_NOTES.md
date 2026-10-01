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
