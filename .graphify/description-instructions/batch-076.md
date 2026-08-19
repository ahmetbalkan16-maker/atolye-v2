# Node Description Batch 77 of 166

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

- "scripts_smoke_production_end_to_end_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L297 | neighbors=[smoke-production-end-to-end.ts, png(), crc32()]
- "scripts_smoke_production_end_to_end_removeownedfixture": "removeOwnedFixture()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L202 | neighbors=[smoke-production-end-to-end.ts, fixtureGuardScenarios(), requireFixtureRoot()]
- "scripts_smoke_production_end_to_end_stabilization_markallcompleted": "markAllCompleted()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L205 | neighbors=[smoke-production-end-to-end-stabilizati…, stageFile(), recoveryPlannerConsistency()]
- "scripts_smoke_production_end_to_end_stabilization_minimalmp4": "minimalMp4()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L272 | neighbors=[smoke-production-end-to-end-stabilizati…, box(), setup()]
- "scripts_smoke_production_end_to_end_stabilization_png": "png()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L274 | neighbors=[smoke-production-end-to-end-stabilizati…, pngChunk(), setup()]
- "scripts_smoke_production_end_to_end_stabilization_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L275 | neighbors=[smoke-production-end-to-end-stabilizati…, png(), crc32()]
- "scripts_smoke_production_end_to_end_stabilization_publishingintent": "publishingIntent()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L233 | neighbors=[smoke-production-end-to-end-stabilizati…, reconciliationAndRestart(), recoveryPlannerConsistency()]
- "scripts_smoke_production_end_to_end_stabilization_youtubepublishprovider": "YouTubePublishProvider" | kind=code-symbol | neighbors=[CountingPublishProvider, ExplicitFailureProvider, IndeterminateProvider]
- "scripts_smoke_production_end_to_end_track": "track()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L294 | neighbors=[smoke-production-end-to-end.ts, mp4(), box()]
- "scripts_smoke_production_execution_confirmation_validate": "validate()" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L35 | neighbors=[smoke-production-execution-confirmation…, main(), makeGrant()]
- "scripts_smoke_production_execution_coordinator_request": "request()" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L24 | neighbors=[smoke-production-execution-coordinator.…, main(), setup()]
- "scripts_smoke_production_execution_coordinator_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L28 | neighbors=[smoke-production-execution-coordinator.…, main(), request()]
- "scripts_smoke_production_execution_durable_claim_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L8 | neighbors=[smoke-production-execution-durable-clai…, claim(), s()]
- "scripts_smoke_production_execution_durable_recovery_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L23 | neighbors=[smoke-production-execution-durable-reco…, record(), scenario()]
- "scripts_smoke_production_execution_transaction_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L11 | neighbors=[smoke-production-execution-transaction.…, build(), valid()]
- "scripts_smoke_production_execution_worker_dcoordinator": "dCoordinator()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L17 | neighbors=[smoke-production-execution-worker.ts, dRequest(), dSetup()]
- "scripts_smoke_production_execution_worker_drequest": "dRequest()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L18 | neighbors=[smoke-production-execution-worker.ts, dCoordinator(), mainDurable()]
- "scripts_smoke_production_execution_worker_dsetup": "dSetup()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L19 | neighbors=[smoke-production-execution-worker.ts, dCoordinator(), mainDurable()]
- "scripts_smoke_production_health_api_consumer_responsefetch": "responseFetch()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L174 | neighbors=[smoke-production-health-api-consumer.ts, createJsonFetch(), main()]
- "scripts_smoke_production_health_rules_coverage": "coverage()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L138 | neighbors=[smoke-production-health-rules.ts, known(), snapshot()]
- "scripts_smoke_production_health_rules_notrecorded": "notRecorded()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L22 | neighbors=[smoke-production-health-rules.ts, snapshot(), stage()]
- "scripts_smoke_production_health_rules_stage": "stage()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L26 | neighbors=[smoke-production-health-rules.ts, known(), notRecorded()]
- "scripts_smoke_production_health_service_file": "file()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L326 | neighbors=[smoke-production-health-service.ts, run(), writeJson()]
- "scripts_smoke_production_health_service_history": "history()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L97 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture()]
- "scripts_smoke_production_health_service_jobs": "jobs()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L86 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture()]
- "scripts_smoke_production_health_service_manifest": "manifest()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L41 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture()]
- "scripts_smoke_production_health_service_project": "project()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L30 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture()]
- "scripts_smoke_production_health_service_usage": "usage()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L106 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture()]
- "scripts_smoke_production_health_ui_criticalreport": "criticalReport()" | kind=code-symbol | source=scripts/smoke-production-health-ui.ts:L135 | neighbors=[smoke-production-health-ui.ts, withHealth(), main()]
- "scripts_smoke_production_health_ui_withhealth": "withHealth()" | kind=code-symbol | source=scripts/smoke-production-health-ui.ts:L124 | neighbors=[smoke-production-health-ui.ts, criticalReport(), main()]
- "scripts_smoke_production_intelligence_consumer_versioning_main": "main()" | kind=code-symbol | source=scripts/smoke-production-intelligence-consumer-versioning.ts:L13 | neighbors=[smoke-production-intelligence-consumer-…, consume(), render()]
- "scripts_smoke_production_phase_closure_main": "main()" | kind=code-symbol | source=scripts/smoke-production-phase-closure.ts:L25 | neighbors=[smoke-production-phase-closure.ts, capability(), hasDependencyCycle()]
- "scripts_smoke_production_pipeline_durable_execution_coordinator": "coordinator()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L6 | neighbors=[smoke-production-pipeline-durable-execu…, request(), setup()]
- "scripts_smoke_production_pipeline_durable_execution_main": "main()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L9 | neighbors=[smoke-production-pipeline-durable-execu…, setup(), tree()]
- "scripts_smoke_production_pipeline_durable_execution_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L7 | neighbors=[smoke-production-pipeline-durable-execu…, main(), coordinator()]
- "scripts_smoke_production_publish_reconciliation_hardening_markallcompleted": "markAllCompleted()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L661 | neighbors=[smoke-production-publish-reconciliation…, stageFile(), persistenceApiAndRecovery()]
- "scripts_smoke_production_publish_reconciliation_hardening_matchedrecord": "matchedRecord()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L562 | neighbors=[smoke-production-publish-reconciliation…, canonicalAndReceiptPaths(), persistenceApiAndRecovery()]
- "scripts_smoke_production_publish_reconciliation_hardening_minimalmp4": "minimalMp4()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L694 | neighbors=[smoke-production-publish-reconciliation…, box(), setup()]
- "scripts_smoke_production_publish_reconciliation_hardening_png": "png()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L713 | neighbors=[smoke-production-publish-reconciliation…, pngChunk(), setup()]
- "scripts_smoke_production_publish_reconciliation_hardening_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L730 | neighbors=[smoke-production-publish-reconciliation…, png(), crc32()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-076.json

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
