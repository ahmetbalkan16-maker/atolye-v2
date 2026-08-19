# Node Description Batch 5 of 166

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
Write every description in Portuguese (pt). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "audio_audiomanager": "AudioManager.ts" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L1 | neighbors=[AIResponseError.ts, AIResponseError, AudioAIConfig.ts, AudioAIConfigError, getAudioMaxTokens(), GenerationExecutionPolicy.ts]
- "migration_runtimemigrationcandidatepreflight": "RuntimeMigrationCandidatePreflight.ts" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L1 | neighbors=[02c450e Sprint 129.25 C.2B.1: Migration…, RuntimeBackupInventory.ts, collectRuntimeBackupInventory(), RuntimeBackupManifest.ts, aggregateRuntimeFileRecords(), RuntimeBackupFileRecord]
- "production_productionacceptanceexecutionscope": "ProductionAcceptanceExecutionScope.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, 99834f4 feat: complete Sprint 129.28 du…, bc53393 wip: preserve sprint 129.28 fin…, PipelineRunner.ts, PipelineStageExecutor.ts, adapterFactoryNames]
- "providers_index": "index.ts" | kind=code-symbol | source=src/lib/ai/providers/index.ts:L1 | neighbors=[AIManager.ts, pipeline.ts, runObservedAIRequest.ts, AssemblyManager.ts, AudioManager.ts, 0108d60 feat(ai): add mock-first provid…]
- "scripts_smoke_production_execution_durable_storage": "smoke-production-execution-durable-storage.ts" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L1 | neighbors=[02bf9b6 feat(production): add durable e…, ProductionControlledExecutionGateway.ts, defaultProductionControlledExecutionGat…, ProductionExecutionDurableStorage.ts, AdapterBackedProductionExecutionDurable…, defaultProductionExecutionDurableStorag…]
- "studio_pipelinestatus": "PipelineStatus.tsx" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L1 | neighbors=[21df73e feat: complete sprint 62 pipeli…, 7afa3c8 feat(pipeline): integrate retry…, 7bd8eee feat: complete sprint 61 pipeli…, 85c678f feat(pipeline): add retry studi…, 9b0257e feat: complete sprint 63 pipeli…, df50289 feat(studio): improve animation…]
- "types_visual": "visual.ts" | kind=code-symbol | source=src/types/visual.ts:L1 | neighbors=[visualEngine.ts, VisualStructuredOutput.ts, AnimationService.ts, route.ts, AssemblyManager.ts, route.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a029553bcb0ef10dca7654b19cacad490a9c4e84": "a029553 fix(production): close sprint 129.33 retry admission safety" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 2863b3a fix(production): bind queued ex…, sprint-129-33-path-race-child.ts, sprint-129-33-pipeline-job-lock-child.ts]
- "production_productionacceptancelegacyreauthorizationservice": "ProductionAcceptanceLegacyReauthorizationService.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L1 | neighbors=[61f1dbe wip: sprint 129.28 legacy reaut…, cc0f176 feat: complete Sprint 129.28 du…, ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyAuthorityStor…, legacyArchiveLocator(), publishLegacyArchive()]
- "production_productionendtoendvalidation": "ProductionEndToEndValidation.ts" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L1 | neighbors=[0e0ff02 Sprint 125: Add production end-…, AssetManager.ts, AssetManager, PipelineJobManager.ts, PipelineJobManager, PipelineRecoveryPlanner.ts]
- "production_productionexecutionconfirmation": "ProductionExecutionConfirmation.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L1 | neighbors=[b4ec40e feat(production): add persisten…, e528878 feat(production): add execution…, ProductionDeterminism.ts, stableProductionId(), bindingFromGrant(), bindingMismatch()]
- "production_productionworkerlifecycle_productionworkerlifecycle": "ProductionWorkerLifecycle" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L38 | neighbors=[CanonicalSmokeRuntime.ts, PipelineRunnerCanonicalRuntime.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionConfiguratio…, ProductionPipelineExecutionFactory.ts, ProductionRuntimeInitializer.ts]
- "providers_mockthumbnailprovider": "MockThumbnailProvider.ts" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L1 | neighbors=[4cde4cd feat(thumbnail): add thumbnail …, 5883c6d Sprint 120: Activate production…, 99834f4 feat: complete Sprint 129.28 du…, buildSourceLine(), buildVariants(), crc32()]
- "scripts_smoke_production_execution_phase_review": "smoke-production-execution-phase-review.ts" | kind=code-symbol | source=scripts/smoke-production-execution-phase-review.ts:L1 | neighbors=[35b40d0 test(production): complete exec…, ProductionControlledExecutionGateway.ts, defaultProductionControlledExecutionGat…, ProductionExecutionAuthorization.ts, defaultProductionExecutionAuthorization…, ProductionExecutionConfirmation.ts]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate": "smoke-sprint-129-25c-2b-1-migration-candidate.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L1 | neighbors=[02c450e Sprint 129.25 C.2B.1: Migration…, RuntimeBackupInventory.ts, collectRuntimeBackupInventory(), RuntimeBackupManifest.ts, aggregateRuntimeFileRecords(), runtimeBackupManifestSha256()]
- "scripts_smoke_sprint_129_25c_2b_4_runtime_context": "smoke-sprint-129-25c-2b-4-runtime-context.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-4-runtime-context.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, fb444fd wip: preserve C.2B.3 audit and …, PipelineRunner.ts, PipelineRunner, PipelineRunnerCanonicalRuntime.ts, ProductionExecutionPersistence.ts]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry": "smoke-sprint-129-30-persistence-boundary-retry.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L1 | neighbors=[0d87231 wip: checkpoint Sprint 129.32 s…, b63ce67 test(production): close sprint …, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), SmokeResult.ts, emitSmokeResult()]
- "storage_audiostorage_audiostorage": "AudioStorage" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L133 | neighbors=[VideoAssemblyManager.ts, AudioPipeline.ts, route.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts, FFmpegVideoAssemblyProvider.ts]
- "types_animation": "animation.ts" | kind=code-symbol | source=src/types/animation.ts:L1 | neighbors=[AnimationAssetPipeline.ts, animationMerge.ts, AnimationMotionPlanValidation.ts, AnimationService.ts, AnimationStorage.ts, AnimationStructuredOutput.ts]
- "ai_visualstructuredoutput": "VisualStructuredOutput.ts" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L1 | neighbors=[AIResponseError.ts, AIResponseError, CanonicalTimestamp.ts, createCanonicalApplicationTimestamp(), CanonicalVisualPlan, canonicalVisualProviderSchema]
- "animation_animationstructuredoutput": "AnimationStructuredOutput.ts" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L1 | neighbors=[AnimationMotionPlanError.ts, AnimationStructuredOutputValidation, CanonicalAnimationProviderPlan, canonicalAnimationProviderSchema, category(), createAnimationMotionPlanSystemPrompt()]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@cc0f176acbef41bc910940f38edc52d58a4c3002": "cc0f176 feat: complete Sprint 129.28 durable authority hardening" | kind=Commit | source=git | neighbors=[61f1dbe wip: sprint 129.28 legacy reaut…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "lib_canonicalsmokeevidencev2_fail": "fail()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L59 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), aggregateEvidence(), array(), assertMatrixRunId(), assertRootPlacement()]
- "lib_canonicalsmokeruntime_withcanonicalsmokeruntime": "withCanonicalSmokeRuntime()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L182 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime(), run-canonical-smoke-child.ts, smoke-animation-motion-plan-contract.ts, smoke-assembly-scene-video-consumption.…, smoke-canonical-smoke-runtime-foundatio…]
- "production_productionexecutiondescriptorboundreadadapter": "ProductionExecutionDescriptorBoundReadAdapter.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, cc0f176 feat: complete Sprint 129.28 du…, ProductionAcceptanceLegacyDurableRecove…, assertContained(), codeUnitCompare(), createProductionExecutionReadDescriptor…]
- "storage_videostorage_videostorage": "VideoStorage" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L26 | neighbors=[VideoAssemblyManager.ts, route.ts, ProductionAcceptanceMediaValidation.ts, ProductionAcceptanceOrchestrator.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts]
- "types_productionexecutiondurablelease": "productionExecutionDurableLease.ts" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L1 | neighbors=[80adfc8 feat(production): add durable e…, eacb090 fix(production): close sprint 1…, ProductionCanonicalDurableLineage.ts, ProductionExecutionDurableLease.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineTerminalSettlement.ts]
- "types_thumbnail": "thumbnail.ts" | kind=code-symbol | source=src/types/thumbnail.ts:L1 | neighbors=[4cde4cd feat(thumbnail): add thumbnail …, 56fd9c7 feat(thumbnail): add thumbnail …, 5883c6d Sprint 120: Activate production…, route.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts]
- "assets_assetmanager_assetmanager": "AssetManager" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L18 | neighbors=[AnimationAssetPipeline.ts, VideoAssemblyManager.ts, AssetManager.ts, .addAsset(), .addAssetAtomically(), .createAsset()]
- "migration_runtimemigrationcandidateverifier": "RuntimeMigrationCandidateVerifier.ts" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L1 | neighbors=[02c450e Sprint 129.25 C.2B.1: Migration…, 7eef83a feat: add runtime backup v3 aut…, RuntimeMigrationCandidateService.ts, RuntimeBackupManifest.ts, runtimeBackupAggregateVersion, runtimeBackupFormatVersionV2]
- "production_productiondeterminism_stableproductionid": "stableProductionId()" | kind=code-symbol | source=src/lib/production/ProductionDeterminism.ts:L12 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, PipelineRetryAdmission.ts, ProductionActionEngine.ts, ProductionControlledExecutionGateway.ts, ProductionDeterminism.ts, stableProductionValue()]
- "production_productionpipelineretrybudgetextensiontransaction": "ProductionPipelineRetryBudgetExtensionTransaction.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionTransaction.ts:L1 | neighbors=[9d652d5 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, PipelineFailedStageRetry.ts, PipelineJobManager.ts, PipelineJobManager, PipelineRetryAdmission.ts]
- "scripts_smoke_production_execution_durable_attempt": "smoke-production-execution-durable-attempt.ts" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, c5e9d33 feat(production): add durable c…, ProductionExecutionDurableAttempt.ts, AdapterBackedProductionExecutionAttempt…, classifyProductionExecutionAttemptArtif…, defaultProductionExecutionAttemptPolicy]
- "scripts_smoke_production_execution_durable_lease": "smoke-production-execution-durable-lease.ts" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L1 | neighbors=[80adfc8 feat(production): add durable e…, ProductionExecutionDurableLease.ts, AdapterBackedProductionExecutionDurable…, defaultProductionExecutionDurableLeaseP…, ProductionExecutionDurableStorage.ts, AdapterBackedProductionExecutionDurable…]
- "scripts_smoke_sprint_129_22_animation_structured_output": "smoke-sprint-129-22-animation-structured-output.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L1 | neighbors=[5a31d1f Sprint 129.22: Harden animation…, AIUsageManager.ts, AIUsageManager, AnimationAssetPipeline.ts, AnimationAssetPipeline, AnimationStructuredOutput.ts]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem": "smoke-sprint-129-25c-2a-guarded-filesystem.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L1 | neighbors=[7eef83a feat: add runtime backup v3 aut…, aecde83 feat(runtime): add guarded file…, RuntimeBackupAuthority.ts, bootstrapTestRuntimeBackupStorageAuthor…, RuntimeBackupService.ts, createVerifiedRuntimeBackup()]
- "types_assembly": "assembly.ts" | kind=code-symbol | source=src/types/assembly.ts:L1 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, 3480988 Sprint 115: Activate production…, 5fd1307 feat(assembly): add video assem…, c4d459a feat(assembly): add final produ…, f21fc24 Sprint 128: Harden production a…]
- "types_productionexecutiondurableclaim": "productionExecutionDurableClaim.ts" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L1 | neighbors=[c5e9d33 feat(production): add durable c…, cc0f176 feat: complete Sprint 129.28 du…, eacb090 fix(production): close sprint 1…, ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…]
- "pipeline_pipelineretryadmission": "PipelineRetryAdmission.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, 9d652d5 fix(production): close sprint 1…, a029553 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, PipelineFailedStageRetry.ts, PipelineJobManager.ts]
- "production_productionexecutionauthorization": "ProductionExecutionAuthorization.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L1 | neighbors=[d9ebd32 feat(production): add execution…, e528878 feat(production): add execution…, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, ProductionDeterminism.ts, stableProductionId()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-004.json

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
