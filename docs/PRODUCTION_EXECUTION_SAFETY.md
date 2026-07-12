# Production Execution Safety Plan

Status: Sprint 97.0 planning baseline. Real Production Intelligence execution is disabled.

## Phase closure

Sprint 96.x delivers a read-only chain from Production Snapshot through health, evidence, recommendations, dependency graph, planning, dry-run request validation, gateway metadata, job preview, schema-versioned consumer parsing, the existing health API, and a passive UI summary. It does not provide an execution endpoint, queue dispatch, authorization, durable idempotency, execution audit persistence, transactional multi-file writes, rollback, or controlled rollout.

The machine-readable capability matrix, threat model, invariants, action risk profiles, and roadmap are in `ProductionExecutionSafetyPlan.ts`. They are static policy data and have no runtime effects.

## Architecture freeze

The following Sprint 96.x contracts are stable: Production Intelligence schema version 1, recommended action, dependency graph, production plan, execution request, dry-run result, job preview, and consumer parser result.

- Optional additive fields may be added within schema version 1.
- Changing field meaning or type requires a new schema version.
- Removing a field or adding a required field is breaking.
- Narrowing an enum is breaking.
- Unknown versions use the health-only fallback.
- Consumers use only centrally validated payloads.

## Authorization plan

Local single-user mode is not an authorization bypass. Until a trusted actor decision exists, execution remains unavailable. Hosted mode additionally requires authenticated owner/admin identity and service/worker identity.

The decision contract must bind actor, project slug, operation key, action, stage, environment policy, and authorization scope. Request creation requires project read access; confirmation and enqueue require explicit execution scope; workers receive only an allowlisted service identity. Every resource lookup and write must be derived from the job-bound project slug. API keys and provider secrets remain worker-only and never enter request, queue, audit-public, or response contracts.

## Confirmation plan

A future confirmation record must bind request ID, idempotency key, project slug, action type, stage, snapshot fingerprint, actor and confirmation scope. It must carry issued/expiry information, an audit reference, and a single-use policy. A stale fingerprint, changed action/stage/project, expiry, actor mismatch, or prior use invalidates it. Sprint 97.2 defines the contract only; it does not issue tokens or add UI.

## Persistent idempotency plan

The deterministic key becomes operational only after an atomic reservation exists. Planned states are `reserved`, `prepared`, `queued`, `running`, `succeeded`, `failed`, `cancelled`, and `partially-succeeded`.

| Existing state | Duplicate request policy |
| --- | --- |
| reserved/prepared | Return the existing preparation; do not reserve again. |
| queued | Return the existing job reference; do not enqueue again. |
| running | Return the active execution reference. |
| succeeded | Return the completed reference; never re-execute. |
| failed retryable | Require retry policy and a linked new attempt. |
| failed non-retryable | Reject. |
| cancelled | Require an explicit new-attempt policy. |
| partially-succeeded | Never retry automatically; require recovery review. |

## Queue and worker boundary

The existing pipeline queue must be adapted rather than duplicated. A future adapter accepts only a validated prepared job and a successful idempotency reservation. Queue payload fields—execution/request IDs, idempotency key, project slug, action, stage, fingerprint, operation key, actor reference, confirmation reference and input descriptors—are immutable.

Immediately before enqueue, the server repeats stale, authorization, confirmation and prerequisite checks. The worker revalidates project isolation and the operation allowlist. Progress transitions create audit events. Cancellation is checked before provider work and before each commit boundary. Retry is based on explicit failure classification. Terminal non-retryable or exhausted work uses the existing terminal-state approach; a dead-letter mechanism is not selected until the queue adapter review verifies repository needs.

## Transaction and partial-failure plan

`ProjectWriter.writeJSONAtomically` already writes a temporary file and renames it, but this is atomic only for one JSON file. `FileStorage.saveJson` writes directly. Neither provides a transaction across output, asset index, manifest and audit state.

The future execution boundary therefore requires: scoped temp output; format validation; atomic rename; output verification; manifest last; consistency verification; and an operation journal/recovery marker. Provider success must be journaled by a safe external reference before local commit so a save failure does not repeat the provider side effect. Partially committed work is reported as `partially-succeeded`, not success or a generic retryable failure. This sprint changes no write behavior.

## Audit trail plan

Every execution requires execution/request IDs, idempotency key, project slug, action, stage, actor, input fingerprint, output references, status transitions, created/confirmed/queued/started/completed timestamps, failure code, and retry/cancellation/rollback relations. Audit data excludes API keys, secrets, binary assets, unnecessary full prompts, absolute paths and public stack traces. Persistence is deferred until Sprint 97.5.

## Action risk and first candidate

Current risk profiles are intentionally conservative. Inspect-source and review-metric have no executable registry operation. Reconcile-state is unresolved. Retry-stage and resume-stage expose dry-run metadata for potentially broad manifest, output, job and history writes; stage-specific provider side effects are unresolved. No real execution candidate is selected.

## Controlled rollout

1. Internal dry-run only (current).
2. Local single-user protected execution policy.
3. One verified low-risk action, if one is found.
4. Audit and persistent idempotency enabled.
5. Cancellation-aware execution.
6. Retry-safe operations.
7. Higher-risk provider operations.
8. Multi-stage execution.
9. Hosted production readiness.

Real execution remains default-off. A central server policy—not a client flag—must enable each action and environment. UI controls appear only from server-confirmed capability.

## Sprint 97.x roadmap

The canonical roadmap is exported from `ProductionExecutionSafetyPlan.ts`: authorization contract (97.1), confirmation contract (97.2), persistent idempotency contract (97.3), queue adapter (97.4), audit contract (97.5), transactional write/recovery (97.6), controlled single-action execution (97.7), cancellation/retry safety (97.8), and phase review (97.9). Each sprint must keep execution closed until its dependencies and test gates pass.
