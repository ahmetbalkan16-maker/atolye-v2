# Node Description Batch 149 of 166

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

- "scripts_smoke_production_execution_transaction_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L6 | neighbors=[smoke-production-execution-transaction.…]
- "scripts_smoke_production_execution_transaction_record": "record" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L7 | neighbors=[smoke-production-execution-transaction.…]
- "scripts_smoke_production_execution_transaction_resource": "resource" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L8 | neighbors=[smoke-production-execution-transaction.…]
- "scripts_smoke_production_execution_worker_base": "base" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dattemptpolicy": "dAttemptPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L13 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dauth": "dAuth" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L14 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dclaimpolicy": "dClaimPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L13 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dconfirmation": "dConfirmation" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L15 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_didpolicy": "dIdPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L13 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dispatch": "dispatch" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dleasepolicy": "dLeasePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L13 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dp": "dp" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dsession": "dSession" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L16 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dstoragepolicy": "dStoragePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L13 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_dworker": "dWorker" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L16 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_eligibility": "eligibility" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_lease": "lease" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_execution_worker_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L1 | neighbors=[smoke-production-execution-worker.ts]
- "scripts_smoke_production_health_evidence_reportwithfindings": "reportWithFindings()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L153 | neighbors=[smoke-production-health-evidence.ts]
- "scripts_smoke_production_health_service_comparetext": "compareText()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L351 | neighbors=[smoke-production-health-service.ts]
- "scripts_smoke_production_health_service_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L286 | neighbors=[smoke-production-health-service.ts]
- "scripts_smoke_production_intelligence_review_projectfolder": "projectFolder" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L17 | neighbors=[smoke-production-intelligence-review.ts]
- "scripts_smoke_production_operation_journal_full": "full" | kind=code-symbol | source=scripts/smoke-production-operation-journal.ts:L2 | neighbors=[smoke-production-operation-journal.ts]
- "scripts_smoke_production_operation_journal_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-operation-journal.ts:L1 | neighbors=[smoke-production-operation-journal.ts]
- "scripts_smoke_production_operation_journal_times": "times" | kind=code-symbol | source=scripts/smoke-production-operation-journal.ts:L1 | neighbors=[smoke-production-operation-journal.ts]
- "scripts_smoke_production_phase_closure_expectedorder": "expectedOrder" | kind=code-symbol | source=scripts/smoke-production-phase-closure.ts:L17 | neighbors=[smoke-production-phase-closure.ts]
- "scripts_smoke_production_pipeline_durable_execution_ap": "ap" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L4 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_auth": "auth" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L5 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L5 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_cp": "cp" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L4 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_idp": "idp" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L4 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_lp": "lp" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L4 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_session": "session" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L5 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_sp": "sp" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L4 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_execution_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L5 | neighbors=[smoke-production-pipeline-durable-execu…]
- "scripts_smoke_production_pipeline_durable_wiring_context": "context" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L5 | neighbors=[smoke-production-pipeline-durable-wirin…]
- "scripts_smoke_production_pipeline_durable_wiring_main": "main()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L8 | neighbors=[smoke-production-pipeline-durable-wirin…]
- "scripts_smoke_production_pipeline_durable_wiring_stage": "stage" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L5 | neighbors=[smoke-production-pipeline-durable-wirin…]
- "scripts_smoke_production_planner_result": "result" | kind=code-symbol | source=scripts/smoke-production-planner.ts:L2 | neighbors=[smoke-production-planner.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-148.json

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
