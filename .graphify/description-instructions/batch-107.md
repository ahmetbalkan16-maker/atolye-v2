# Node Description Batch 108 of 166

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

- "scripts_smoke_production_execution_durable_lease_release": "release()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L26 | neighbors=[smoke-production-execution-durable-leas…, main()]
- "scripts_smoke_production_execution_durable_lease_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L27 | neighbors=[smoke-production-execution-durable-leas…, main()]
- "scripts_smoke_production_execution_durable_recovery_record": "record()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L18 | neighbors=[smoke-production-execution-durable-reco…, main()]
- "scripts_smoke_production_execution_durable_recovery_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L19 | neighbors=[smoke-production-execution-durable-reco…, main()]
- "scripts_smoke_production_execution_durable_storage_auth": "auth()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L5 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_conf": "conf()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L5 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_create": "create()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L9 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_identity": "identity()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L6 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_ops": "ops()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L26 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_record": "record()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L7 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_reservation": "reservation()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L6 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_s": "s()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L9 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_durable_storage_transition": "transition()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L8 | neighbors=[smoke-production-execution-durable-stor…, main()]
- "scripts_smoke_production_execution_idempotency_record": "record()" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L14 | neighbors=[smoke-production-execution-idempotency.…, main()]
- "scripts_smoke_production_execution_idempotency_reservation": "reservation()" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L20 | neighbors=[smoke-production-execution-idempotency.…, main()]
- "scripts_smoke_production_execution_idempotency_transition": "transition()" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L18 | neighbors=[smoke-production-execution-idempotency.…, main()]
- "scripts_smoke_production_execution_lifecycle_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L39 | neighbors=[smoke-production-execution-lifecycle.ts, tree()]
- "scripts_smoke_production_execution_lifecycle_request": "request()" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L25 | neighbors=[smoke-production-execution-lifecycle.ts, setup()]
- "scripts_smoke_production_execution_lifecycle_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L29 | neighbors=[smoke-production-execution-lifecycle.ts, request()]
- "scripts_smoke_production_execution_lifecycle_tree": "tree()" | kind=code-symbol | source=scripts/smoke-production-execution-lifecycle.ts:L38 | neighbors=[smoke-production-execution-lifecycle.ts, main()]
- "scripts_smoke_production_execution_persistence_run": "run()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L34 | neighbors=[smoke-production-execution-persistence.…, scenario()]
- "scripts_smoke_production_execution_persistence_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-execution-persistence.ts:L33 | neighbors=[smoke-production-execution-persistence.…, run()]
- "scripts_smoke_production_execution_transaction_build": "build()" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L9 | neighbors=[smoke-production-execution-transaction.…, main()]
- "scripts_smoke_production_execution_transaction_valid": "valid()" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L10 | neighbors=[smoke-production-execution-transaction.…, main()]
- "scripts_smoke_production_execution_worker_dtree": "dTree()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L20 | neighbors=[smoke-production-execution-worker.ts, mainDurable()]
- "scripts_smoke_production_execution_worker_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts, run()]
- "scripts_smoke_production_execution_worker_run": "run()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts, main()]
- "scripts_smoke_production_health_api_consumer_abortablependingfetch": "abortablePendingFetch()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L184 | neighbors=[smoke-production-health-api-consumer.ts, main()]
- "scripts_smoke_production_health_api_consumer_assertconsumererror": "assertConsumerError()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L155 | neighbors=[smoke-production-health-api-consumer.ts, main()]
- "scripts_smoke_production_health_api_consumer_clonereport": "cloneReport()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L207 | neighbors=[smoke-production-health-api-consumer.ts, main()]
- "scripts_smoke_production_health_api_consumer_jsonresponse": "jsonResponse()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L200 | neighbors=[smoke-production-health-api-consumer.ts, createJsonFetch()]
- "scripts_smoke_production_health_api_consumer_rejectingfetch": "rejectingFetch()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L178 | neighbors=[smoke-production-health-api-consumer.ts, main()]
- "scripts_smoke_production_health_evidence_finding": "finding()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L100 | neighbors=[smoke-production-health-evidence.ts, main()]
- "scripts_smoke_production_health_evidence_renderevidence": "renderEvidence()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L116 | neighbors=[smoke-production-health-evidence.ts, main()]
- "scripts_smoke_production_health_evidence_renderfindings": "renderFindings()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L130 | neighbors=[smoke-production-health-evidence.ts, main()]
- "scripts_smoke_production_health_evidence_renderpanel": "renderPanel()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L144 | neighbors=[smoke-production-health-evidence.ts, main()]
- "scripts_smoke_production_health_findings_finding": "finding()" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L121 | neighbors=[smoke-production-health-findings.ts, main()]
- "scripts_smoke_production_health_findings_renderfindings": "renderFindings()" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L140 | neighbors=[smoke-production-health-findings.ts, main()]
- "scripts_smoke_production_health_findings_renderpanel": "renderPanel()" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L154 | neighbors=[smoke-production-health-findings.ts, main()]
- "scripts_smoke_production_health_findings_reportwithfindings": "reportWithFindings()" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L163 | neighbors=[smoke-production-health-findings.ts, main()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-107.json

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
