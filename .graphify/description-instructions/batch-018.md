# Node Description Batch 19 of 166

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "production_productionacceptancelegacyreauthorization_canonicaljson": "canonicalJson()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L183 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyDurableRecove…, ProductionAcceptanceLegacyReauthorizati…, deriveLegacyReauthorizationChallengeId(), deriveLegacyReauthorizationId(), integrityFor()]
- "production_productionacceptancelegacyreauthorization_sha256bytes": "sha256Bytes()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L194 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyDurableRecove…, ProductionAcceptanceLegacyReauthorizati…, deriveLegacyReauthorizationChallengeId(), deriveLegacyReauthorizationId(), integrityFor()]
- "production_productionacceptanceorchestrator_productionacceptanceexecutionerror": "ProductionAcceptanceExecutionError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L115 | neighbors=[ProductionAcceptanceOrchestrator.ts, .constructor(), .finalize(), .resumeAndFinalize(), .run(), requiresProductionAcceptanceResume()]
- "production_productionacceptancepolicy_diagnoseproductionacceptanceconfiguration": "diagnoseProductionAcceptanceConfiguration()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L775 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptancePolicy.ts, isMarkerV3Profile2(), productionAcceptanceConfigurationFinger…, ProductionAcceptancePolicyError, resolveEffectiveProductionAcceptanceAut…]
- "production_productionacceptancepolicy_readproductionacceptancemarker": "readProductionAcceptanceMarker()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L749 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePolicy.ts, markerMatchesCurrentConfiguration(), ProductionAcceptancePolicyError, resolveEffectiveProductionAcceptanceAut…, safeSlug()]
- "production_productionacceptancepolicy_safeslug": "safeSlug()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1398 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarker(), createProductionAcceptanceMarkerV3(), createProductionAcceptanceMarkerV3Profi…, diagnoseProductionAcceptanceConfigurati…, markProductionAcceptanceValidated()]
- "production_productionacceptancepreflight_validateproductionacceptancepreflight": "validateProductionAcceptancePreflight()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L46 | neighbors=[PipelineRunner.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePreflight.ts, positiveInteger(), ProductionSceneMappingError]
- "production_productioncompletedstageregenerationpaths": "ProductionCompletedStageRegenerationPaths.ts" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPaths.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, regenerationDirectory(), regenerationProjectFolder(), regenerationRoot(), regenerationRootName, ProjectReader.ts]
- "production_productioncompletedstageregenerationstore_recordregeneratedpackagecompletion": "recordRegeneratedPackageCompletion()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L208 | neighbors=[ProductionCompletedStageRegenerationSto…, canonicalRegenerationJson(), collectAssetIds(), collectRegenerationStageOutputAssetIds(), readActiveRegenerationBinding(), readRegenerationIntent()]
- "production_productionexecutiondurableattempt_defaultproductionexecutionattemptpolicy": "defaultProductionExecutionAttemptPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L4 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryReconciliation.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-coordinator.…, smoke-production-execution-durable-atte…]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_acquire": ".acquire()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L14 | neighbors=[AdapterBackedProductionExecutionDurable…, acquisitionConflict(), acquisitionReplay(), .commit(), .load(), buildLease()]
- "production_productionexecutiondurablelease_validatemutation": "validateMutation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L82 | neighbors=[ProductionExecutionDurableLease.ts, .acquire(), .heartbeat(), .release(), .takeover(), date()]
- "production_productionexecutionjobcontract": "ProductionExecutionJobContract.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionJobContract.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionDeterminism.ts, stableProductionId(), ProductionExecutionJobContract, productionIntelligence.ts, ProductionExecutionDryRunResult]
- "production_productionexecutionpersistence_diagnostic": "diagnostic()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L399 | neighbors=[ProductionExecutionPersistence.ts, cleanup(), errorCode(), .apply(), .collectCanonicalRecords(), .rebuildIndex()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_rebuildindex": ".rebuildIndex()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L200 | neighbors=[ProductionExecutionDurableRecoveryServi…, cleanup(), diagnostic(), diagnostics(), errorCode(), indexFile()]
- "production_productionhealthapiclient_getproductionhealth": "getProductionHealth()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L54 | neighbors=[ProductionHealthApiClient.ts, buildUrl(), isApiErrorPayload(), isSuccessPayload(), normalizeTimeout(), ProductionHealthApiConsumerError]
- "production_productionhealtherror": "ProductionHealthError.ts" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L1 | neighbors=[6ef1840 feat(production): add read-only…, ProductionHealthApiClient.ts, ProductionHealthApiError.ts, httpStatuses, isProductionHealthError(), ProductionHealthError]
- "production_productionhealthservice_productionhealthservice": "ProductionHealthService" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L25 | neighbors=[ProductionHealthService.ts, .getProductionHealth(), smoke-production-health-api-consumer.ts, smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-service.ts]
- "production_productionreadinessservice_productionreadinessservice_probemedia": ".probeMedia()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L318 | neighbors=[ProductionReadinessService, .evaluate(), check(), isExecutableFile(), normalize(), readValue()]
- "projects_projectprogress_getprojectprogressbyslug": "getProjectProgressBySlug()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L157 | neighbors=[projectProgress.ts, getCompletedStagesBySlug(), getCompletionPercentageBySlug(), getCurrentStageBySlug(), getNextStage(), getProjectProgress()]
- "projects_projectprogresscard": "ProjectProgressCard.tsx" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L1 | neighbors=[c17c96f feat(projects): show manifest p…, ed3020b Sprint 30 Phase 3 - Enhanced pr…, ProjectList.tsx, ProgressBadge(), ProgressBar(), ProgressStageSummary]
- "providers_imageproviderrouter_imageproviderrouter": "ImageProviderRouter" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderRouter.ts:L7 | neighbors=[route.ts, VisualAssetPipeline.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, ImageProviderRouter.ts]
- "providers_openaianimationprovider_openaianimationprovider": "OpenAIAnimationProvider" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L34 | neighbors=[AnimationProviderRouter.ts, OpenAIAnimationProvider.ts, ConfiguredAnimationProvider, .constructor(), .createImmutableAnimationDispatchAdapte…, .generateAnimation()]
- "providers_openaianimationprovider_openaianimationprovider_request": ".request()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L122 | neighbors=[OpenAIAnimationProvider, .generateAnimation(), cancelBody(), diagnostic(), fetchWithAbort(), invalid()]
- "roadmap_production_acceptance_gate": "Production Acceptance Execution Gate" | kind=entity | source=ROADMAP.md:494 | neighbors=[Sprint 126 - Real Production Acceptance…, Sprint 128.1 - Production Acceptance P0…, Sprint 129.29 - Failed-Terminal Settlem…, Sprint 129.33 - Exhausted Retry Admissi…, Sprint 129.35 - Legacy Terminal Lineage…, Sprint 129.36 - Explicit One-Time Retry…]
- "router_airouter_airouter": "AIRouter" | kind=code-symbol | source=src/lib/ai/router/AIRouter.ts:L12 | neighbors=[pipeline.ts, runObservedAIRequest.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, AIRouter.ts]
- "scripts_production_intelligence_fixture_intelligencefixture": "intelligenceFixture()" | kind=code-symbol | source=scripts/production-intelligence-fixture.ts:L7 | neighbors=[production-intelligence-fixture.ts, known(), missing(), smoke-production-actions.ts, smoke-production-dependency-graph.ts, smoke-production-execution-contract.ts]
- "scripts_reconcile_fatih_129_45_backfill": "reconcile-fatih-129-45-backfill.ts" | kind=code-symbol | source=scripts/reconcile-fatih-129-45-backfill.ts:L1 | neighbors=[05bea2f docs(checkpoint): close sprints…, PipelineJobManager.ts, PipelineJobManager, ProjectManager.ts, ProjectManager, backfillStage()]
- "scripts_smoke_pipeline_orchestration_job": "job()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L18 | neighbors=[smoke-pipeline-orchestration.ts, testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent(), testDuplicateCompletionDoesNotDuplicate…, testExistingActiveDownstreamDoesNotDupl…]
- "scripts_smoke_pipeline_orchestration_readjobs": "readJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L61 | neighbors=[smoke-pipeline-orchestration.ts, testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent(), testDuplicateCompletionDoesNotDuplicate…, testExistingActiveDownstreamDoesNotDupl…]
- "scripts_smoke_production_runtime_health_api": "smoke-production-runtime-health-api.ts" | kind=code-symbol | source=scripts/smoke-production-runtime-health-api.ts:L1 | neighbors=[c812810 Sprint 112: Add production runt…, route.ts, createProductionRuntimeHealthResponse(), GET(), main(), readResponse()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_pass": "pass()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L133 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, assertNoDownstreamDurable(), assertProductionSeam(), assertQuiescent(), boundedFailure(), boundedSuccess()]
- "security_ownedruntimedirectory": "OwnedRuntimeDirectory.ts" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L1 | neighbors=[7eef83a feat: add runtime backup v3 aut…, aecde83 feat(runtime): add guarded file…, RuntimeMigrationCandidateService.ts, GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory, OwnedRuntimeDirectoryAdapter]
- "security_runtimemutationerror_runtimemutationerror": "RuntimeMutationError" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L18 | neighbors=[RuntimeBackupPathPolicy.ts, RuntimeBackupService.ts, RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts, RuntimeMutationError.ts]
- "steps_scenestep": "sceneStep.ts" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L1 | neighbors=[0a03cad refactor(types): cleanup domain…, 91ba270 Atölye V2 checkpoint - pipeline…, estimateDuration(), includesAny(), LegacySceneData, LegacyScenesFile]
- "steps_scriptstep": "scriptStep.ts" | kind=code-symbol | source=src/lib/ai/steps/scriptStep.ts:L1 | neighbors=[0108d60 feat(ai): add mock-first provid…, 6c1ae5a Sprint 15 - Multi AI Provider A…, 91ba270 Atölye V2 checkpoint - pipeline…, c23a64b feat(ai): add usage observabili…, runObservedAIRequest.ts, runObservedAIRequest()]
- "storage_audiostorage_resolvepath": "resolvePath()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1607 | neighbors=[AudioStorage.ts, .commitPreparedAudio(), .isPreparedAudio(), .prepareAudio(), .readStoredWav(), .saveAudio()]
- "studio_assemblypanel": "AssemblyPanel.tsx" | kind=code-symbol | source=src/components/studio/AssemblyPanel.tsx:L1 | neighbors=[0313b59 fix: complete sprint 69 jsx ent…, b5a618e feat(studio): add assembly prod…, c4d459a feat(assembly): add final produ…, AssemblyPanel(), AssemblyPanelProps, AssemblyResponse]
- "studio_audiopanel": "AudioPanel.tsx" | kind=code-symbol | source=src/components/studio/AudioPanel.tsx:L1 | neighbors=[573e9e6 feat(audio): add mock audio eng…, 9f6b3a2 feat(audio): integrate audio en…, AudioService.ts, AudioService, AudioPanel(), AudioPanelProps]
- "studio_seopanel": "SEOPanel.tsx" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L1 | neighbors=[e3b7e47 feat(studio): add full producti…, index.ts, Info(), ListBlock(), SEOPanel(), SEOPanelProps]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-018.json

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
