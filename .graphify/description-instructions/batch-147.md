# Node Description Batch 148 of 166

Graphify is running in assistant/skill mode (no API key). You are the host
assistant (Claude Code / Codex / Gemini CLI). Read the prompt below and write
your JSON answer to the answer file.

## Prompt

You are documenting nodes in a knowledge graph.
For each entry below, write ONE concise factual plain-language sentence
describing what it is or does. Use only the provided context.
For a code symbol (kind=code-symbol — a function, class, or constant),
describe what the function/symbol does based on its name, source location
and neighbors — e.g. "Resolves the configured ontology profile from graphify.yaml.".
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "scripts_smoke_production_execution_gateway_snapshot_health": "{snapshot,health}" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L2 | neighbors=[smoke-production-execution-gateway.ts]
- "scripts_smoke_production_execution_gateway_validation": "validation" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L2 | neighbors=[smoke-production-execution-gateway.ts]
- "scripts_smoke_production_execution_idempotency_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L10 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_idempotency_built": "built" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L12 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_idempotency_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L11 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_idempotency_context": "context" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L19 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_idempotency_lease": "lease" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L17 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_idempotency_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L9 | neighbors=[smoke-production-execution-idempotency.…]
- "scripts_smoke_production_execution_job_dry": "dry" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L2 | neighbors=[smoke-production-execution-job.ts]
- "scripts_smoke_production_execution_job_job": "job" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L2 | neighbors=[smoke-production-execution-job.ts]
- "scripts_smoke_production_execution_job_plan": "{plan}" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L2 | neighbors=[smoke-production-execution-job.ts]
- "scripts_smoke_production_execution_job_request": "request" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L2 | neighbors=[smoke-production-execution-job.ts]
- "scripts_smoke_production_execution_job_snapshot_health": "{snapshot,health}" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L2 | neighbors=[smoke-production-execution-job.ts]
- "scripts_smoke_production_execution_lifecycle_attemptpolicy": "attemptPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L20 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L21 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_claimpolicy": "claimPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L20 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L22 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L20 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_leasepolicy": "leasePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L20 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_session": "session" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L24 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_storagepolicy": "storagePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L20 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_lifecycle_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L24 | neighbors=[smoke-production-execution-lifecycle.ts]
- "scripts_smoke_production_execution_persistence_assertfailure": "assertFailure()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L90 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_assertreadfailure": "assertReadFailure()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L91 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L20 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_builtidentity": "builtIdentity" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L22 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_codeerror": "codeError()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L92 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L21 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_idempotency": "idempotency" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L24 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_idempotencypolicy": "idempotencyPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L19 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_journal": "journal" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L31 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_journalpolicy": "journalPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L30 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L94 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_operations": "operations()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L93 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_othertransaction": "otherTransaction" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L29 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_reservation": "reservation" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L25 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_resource": "resource" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L26 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_transaction": "transaction" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L28 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_persistence_transactionfor": "transactionFor()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L27 | neighbors=[smoke-production-execution-persistence.…]
- "scripts_smoke_production_execution_phase_review_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-phase-review.ts:L2 | neighbors=[smoke-production-execution-phase-review…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-147.json

Keep each description factual and concise (one sentence). No markdown, no prose
outside the JSON object. It is acceptable to omit a node if context is
insufficient — but include every node you can ground confidently.

Example answer format:
```json
{
  "node_id_1": "Resolves the configured ontology profile from graphify.yaml.",
  "node_id_2": "Colonel James Barclay, an antagonist in The Crooked Man."
}
```
