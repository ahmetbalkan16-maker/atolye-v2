# Node Description Batch 109 of 166

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

- "scripts_smoke_production_health_rules_clone": "clone()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L147 | neighbors=[smoke-production-health-rules.ts, main()]
- "scripts_smoke_production_health_rules_hascode": "hasCode()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L168 | neighbors=[smoke-production-health-rules.ts, main()]
- "scripts_smoke_production_health_rules_setusage": "setUsage()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L361 | neighbors=[smoke-production-health-rules.ts, main()]
- "scripts_smoke_production_health_rules_snapshotfinding": "snapshotFinding()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L151 | neighbors=[smoke-production-health-rules.ts, main()]
- "scripts_smoke_production_health_service_capturefiles": "captureFiles()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L330 | neighbors=[smoke-production-health-service.ts, run()]
- "scripts_smoke_production_health_service_gethealth": "getHealth()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L295 | neighbors=[smoke-production-health-service.ts, run()]
- "scripts_smoke_production_health_service_hascode": "hasCode()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L302 | neighbors=[smoke-production-health-service.ts, run()]
- "scripts_smoke_production_health_service_job": "job()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L65 | neighbors=[smoke-production-health-service.ts, run()]
- "scripts_smoke_production_health_service_withmutedconsole": "withMutedConsole()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L341 | neighbors=[smoke-production-health-service.ts, run()]
- "scripts_smoke_production_health_ui_render": "render()" | kind=code-symbol | source=scripts/smoke-production-health-ui.ts:L115 | neighbors=[smoke-production-health-ui.ts, main()]
- "scripts_smoke_production_intelligence_consumer_versioning_consume": "consume()" | kind=code-symbol | source=scripts/smoke-production-intelligence-consumer-versioning.ts:L69 | neighbors=[smoke-production-intelligence-consumer-…, main()]
- "scripts_smoke_production_intelligence_consumer_versioning_render": "render()" | kind=code-symbol | source=scripts/smoke-production-intelligence-consumer-versioning.ts:L73 | neighbors=[smoke-production-intelligence-consumer-…, main()]
- "scripts_smoke_production_intelligence_phase_review_main": "main()" | kind=code-symbol | source=scripts/smoke-production-intelligence-phase-review.ts:L16 | neighbors=[smoke-production-intelligence-phase-rev…, sourceFinding()]
- "scripts_smoke_production_intelligence_phase_review_sourcefinding": "sourceFinding()" | kind=code-symbol | source=scripts/smoke-production-intelligence-phase-review.ts:L148 | neighbors=[smoke-production-intelligence-phase-rev…, main()]
- "scripts_smoke_production_intelligence_review_exists": "exists()" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L162 | neighbors=[smoke-production-intelligence-review.ts, main()]
- "scripts_smoke_production_intelligence_review_verifysourceboundaries": "verifySourceBoundaries()" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L133 | neighbors=[smoke-production-intelligence-review.ts, main()]
- "scripts_smoke_production_intelligence_review_withmutedconsole": "withMutedConsole()" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L171 | neighbors=[smoke-production-intelligence-review.ts, main()]
- "scripts_smoke_production_operation_journal_main": "main()" | kind=code-symbol | source=scripts/smoke-production-operation-journal.ts:L3 | neighbors=[smoke-production-operation-journal.ts, make()]
- "scripts_smoke_production_operation_journal_make": "make()" | kind=code-symbol | source=scripts/smoke-production-operation-journal.ts:L2 | neighbors=[smoke-production-operation-journal.ts, main()]
- "scripts_smoke_production_phase_closure_capability": "capability()" | kind=code-symbol | source=scripts/smoke-production-phase-closure.ts:L64 | neighbors=[smoke-production-phase-closure.ts, main()]
- "scripts_smoke_production_phase_closure_hasdependencycycle": "hasDependencyCycle()" | kind=code-symbol | source=scripts/smoke-production-phase-closure.ts:L70 | neighbors=[smoke-production-phase-closure.ts, main()]
- "scripts_smoke_production_pipeline_durable_execution_request": "request()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L6 | neighbors=[smoke-production-pipeline-durable-execu…, coordinator()]
- "scripts_smoke_production_pipeline_durable_execution_tree": "tree()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-execution.ts:L8 | neighbors=[smoke-production-pipeline-durable-execu…, main()]
- "scripts_smoke_production_pipeline_durable_wiring_jobs": "jobs()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L6 | neighbors=[smoke-production-pipeline-durable-wirin…, run()]
- "scripts_smoke_production_pipeline_durable_wiring_run": "run()" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L7 | neighbors=[smoke-production-pipeline-durable-wirin…, jobs()]
- "scripts_smoke_production_publish_reconciliation_hardening_box": "box()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L705 | neighbors=[smoke-production-publish-reconciliation…, minimalMp4()]
- "scripts_smoke_production_publish_reconciliation_hardening_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L740 | neighbors=[smoke-production-publish-reconciliation…, pngChunk()]
- "scripts_smoke_production_publish_reconciliation_hardening_fixedreconcileprovider_reconcilepublish": ".reconcilePublish()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L593 | neighbors=[dataApiReadOnlyReconciliation(), FixedReconcileProvider]
- "scripts_smoke_production_publish_reconciliation_hardening_stagefile": "stageFile()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L690 | neighbors=[smoke-production-publish-reconciliation…, markAllCompleted()]
- "scripts_smoke_production_readiness_acceptance_removemarkedsmokeproject": "removeMarkedSmokeProject()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L592 | neighbors=[smoke-production-readiness-acceptance.ts, verifyPackageOnlyPublish()]
- "scripts_smoke_production_readiness_acceptance_strictplanfixtures": "strictPlanFixtures()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L251 | neighbors=[smoke-production-readiness-acceptance.ts, verifyStrictAIProviderFailure()]
- "scripts_smoke_production_readiness_acceptance_trace": "trace()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L58 | neighbors=[smoke-production-readiness-acceptance.ts, run()]
- "scripts_smoke_production_readiness_acceptance_verifyacceptancegatestopspipeline": "verifyAcceptanceGateStopsPipeline()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L535 | neighbors=[smoke-production-readiness-acceptance.ts, run()]
- "scripts_smoke_production_readiness_acceptance_verifyreadinesschecksetvalidation": "verifyReadinessCheckSetValidation()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L284 | neighbors=[smoke-production-readiness-acceptance.ts, run()]
- "scripts_smoke_production_readiness_acceptance_verifyspawnrunnertimeoutcleanup": "verifySpawnRunnerTimeoutCleanup()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L513 | neighbors=[smoke-production-readiness-acceptance.ts, run()]
- "scripts_smoke_production_readiness_acceptance_verifystrictthumbnailfailure": "verifyStrictThumbnailFailure()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L297 | neighbors=[smoke-production-readiness-acceptance.ts, run()]
- "scripts_smoke_production_real_photo_source_createtrackedprovider": "createTrackedProvider()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L982 | neighbors=[smoke-production-real-photo-source.ts, fakeOpenAIProvider()]
- "scripts_smoke_production_real_photo_source_fakeopenaiprovider": "fakeOpenAIProvider()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L1002 | neighbors=[smoke-production-real-photo-source.ts, createTrackedProvider()]
- "scripts_smoke_production_real_photo_source_run": "run()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L123 | neighbors=[smoke-production-real-photo-source.ts, scenario()]
- "scripts_smoke_production_real_photo_source_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L39 | neighbors=[smoke-production-real-photo-source.ts, run()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-108.json

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
