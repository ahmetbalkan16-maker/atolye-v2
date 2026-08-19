# Node Description Batch 8 of 166

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
LANGUAGE: each entry has a `lang=` marker giving the language of its source.
Write that entry's description in EXACTLY that language. Do not translate to
a single common language — match each node's source language individually.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "types_assembly_assemblyplandata": "AssemblyPlanData" | kind=code-symbol | source=src/types/assembly.ts:L56 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, route.ts, PipelineStageExecutor.ts, ProductionAcceptancePreflight.ts, ExportProvider.ts] | lang=en
- "types_script_scriptdata": "ScriptData" | kind=code-symbol | source=src/types/script.ts:L17 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, AssemblyManager.ts, route.ts, AudioManager.ts] | lang=en
- "animations_route": "route.ts" | kind=code-symbol | source=app/api/animations/route.ts:L1 | neighbors=[AnimationAssetPipeline.ts, AnimationAssetPipeline, animationMerge.ts, mergeAnimationData(), AnimationMotionPlanValidation.ts, isCompatibleAnimationData()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2a03d891d2edcd20353b3fc4203098e54b617214": "2a03d89 Sprint 117: Activate production scene video rendering" | kind=Commit | source=git | neighbors=[AnimationMotionPlanValidation.ts, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ca97d40cc4ac2d110395dc4b9562b96f37d0ce7e": "ca97d40 Sprint 121: Add production YouTube package pipeline" | kind=Commit | source=git | neighbors=[5883c6d Sprint 120: Activate production…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "lib_canonicalsmokeevidence": "CanonicalSmokeEvidence.ts" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, addIntegrity(), CanonicalEvidenceError, CanonicalEvidenceErrorCode, canonicalSmokeChildren, CanonicalSmokeChildSpec] | lang=en
- "pipeline_pipelinerunnercanonicalruntime": "PipelineRunnerCanonicalRuntime.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, a029553 fix(production): close sprint 1…, fb444fd wip: preserve C.2B.3 audit and …, PipelineRunner.ts, assertPipelineRunnerProductionRuntimeOp…, assertProcessCanonicalLockOwnership()] | lang=en
- "production_productionoperationjournal": "ProductionOperationJournal.ts" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L1 | neighbors=[3652d01 feat(production): add operation…, ProductionExecutionPersistence.ts, ProductionDeterminism.ts, stableProductionId(), buildProductionOperationJournalEvent(), date()] | lang=en
- "production_productionqueuedexhausteddriftrecovery": "ProductionQueuedExhaustedDriftRecovery.ts" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L1 | neighbors=[a029553 fix(production): close sprint 1…, PipelineJobManager.ts, PipelineJobManager, ProductionExecutionPersistence.ts, ProductionExecutionFilePersistenceAdapt…, ProductionQueuedExhaustedDriftClassifie…] | lang=en
- "production_productionsnapshotbuilder": "ProductionSnapshotBuilder.ts" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L1 | neighbors=[a51cddd feat(production): add read-only…, ProductionHealthService.ts, buildProductionSnapshot(), buildProject(), known(), ProductionSnapshotBuilder] | lang=en
- "projects_projectwriter_projectwriter": "ProjectWriter" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L13 | neighbors=[AIUsageManager.ts, PipelineJobManager.ts, ProductionAcceptancePolicy.ts, ProjectManager.ts, ProjectWriter.ts, .ensureProjectFolder()] | lang=en
- "providers_videoprovider": "VideoProvider.ts" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, 8c15471 feat(video): add mock video eng…, 99834f4 feat: complete Sprint 129.28 du…, PipelineStageExecutor.ts, FFmpegSceneVideoProvider.ts, MockVideoProvider.ts] | lang=en
- "scripts_smoke_production_execution_durable_recovery": "smoke-production-execution-durable-recovery.ts" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L1 | neighbors=[7561f3d feat(production): harden durabl…, 99834f4 feat: complete Sprint 129.28 du…, ProductionExecutionDurableStorage.ts, AdapterBackedProductionExecutionDurable…, defaultProductionExecutionDurableStorag…, ProductionExecutionIdempotency.ts] | lang=en
- "scripts_smoke_production_intelligence_phase_review": "smoke-production-intelligence-phase-review.ts" | kind=code-symbol | source=scripts/smoke-production-intelligence-phase-review.ts:L1 | neighbors=[a1909f3 fix(production): version intell…, fa9d06c fix(production): harden intelli…, ProductionActionEngine.ts, ProductionActionEngine, ProductionDependencyGraph.ts, detectProductionDependencyCycles()] | lang=en
- "scripts_smoke_production_pipeline_durable_wiring": "smoke-production-pipeline-durable-wiring.ts" | kind=code-symbol | source=scripts/smoke-production-pipeline-durable-wiring.ts:L1 | neighbors=[4c104fa feat(production): wire durable …, 99834f4 feat: complete Sprint 129.28 du…, e3b5c6c Sprint 110: Add production work…, fb444fd wip: preserve C.2B.3 audit and …, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime()] | lang=en
- "security_guardedruntimemutationsession_invalidpath": "invalidPath()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1518 | neighbors=[GuardedRuntimeMutationSession.ts, assertAtomicAbsoluteMaterializedPath(), assertAtomicCreateRoots(), assertAtomicRestoreRoots(), atomicContainedFilePath(), beginPrivateLegacyRuntimeBackupRestoreO…] | lang=en
- "types_youtubepublish": "youtubePublish.ts" | kind=code-symbol | source=src/types/youtubePublish.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, ae42dc4 Sprint 123: Stabilize productio…, MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts] | lang=en
- "youtube_youtubepackagevalidation": "YouTubePackageValidation.ts" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L1 | neighbors=[ca97d40 Sprint 121: Add production YouT…, route.ts, PipelineRecoveryPlanner.ts, PipelineStageExecutor.ts, ProjectManager.ts, YouTubePublishValidation.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@507becc1d06de31a99873af82c929f8beee3aa7f": "507becc Sprint 129.25B: Runtime root abstraction and storage hardening" | kind=Commit | source=git | neighbors=[3b885dc Sprint 129.24: Add controlled a…, AnimationStorage.ts, AssetManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6094cd8305ba957679dbb5211eb06e69af2ad63a": "6094cd8 Sprint 129.21: Harden production animation failure persistence and reco…" | kind=Commit | source=git | neighbors=[5166a51 Sprint 129.20: Harden visuals t…, AnimationAssetPipeline.ts, AnimationMotionPlanError.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=en
- "production_productionacceptancecommand_runproductionacceptancecommand": "runProductionAcceptanceCommand()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L99 | neighbors=[ProductionAcceptanceCommand.ts, commandFailure(), parseDiagnoseArguments(), parseExecuteArguments(), parseExtendRetryBudgetArguments(), parseLegacyReauthorizationArguments()] | lang=en
- "production_productionexecutionsafetyplan": "ProductionExecutionSafetyPlan.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L1 | neighbors=[0d7b72c feat(production): add execution…, 35b40d0 test(production): complete exec…, b4ec40e feat(production): add persisten…, d9ebd32 feat(production): add execution…, e528878 feat(production): add execution…, ProductionExecutionAuthorization.ts] | lang=en
- "production_productionpipelineretryadmissionbinding": "ProductionPipelineRetryAdmissionBinding.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryAdmissionBinding.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, 9d652d5 fix(production): close sprint 1…, a029553 fix(production): close sprint 1…, PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, ProductionDeterminism.ts] | lang=en
- "providers_exportprovider": "ExportProvider.ts" | kind=code-symbol | source=src/lib/export/providers/ExportProvider.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ExportEngine.ts, ExportProviderRouter.ts, ExportGenerationInput, ExportGenerationResult, ExportProvider] | lang=en
- "providers_mockyoutubepublishprovider": "MockYouTubePublishProvider.ts" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, 99834f4 feat: complete Sprint 129.28 du…, ae42dc4 Sprint 123: Stabilize productio…, MatchedResult, MockYouTubePublishProvider] | lang=en
- "providers_openaiimageprovider": "OpenAIImageProvider.ts" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L1 | neighbors=[609785a Sprint 33 Phase 4 - Add Image P…, 72fc633 feat(asset): integrate openai i…, 99834f4 feat: complete Sprint 129.28 du…, bec4962 Sprint 113: Activate production…, f21fc24 Sprint 128: Harden production a…, ImageProviderRouter.ts] | lang=en
- "runtime_productionruntimeoperationcontext_createproductionruntimeoperationcontext": "createProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L58 | neighbors=[CanonicalSmokeRuntime.ts, ProductionReadinessService.ts, ProductionRuntimeCompositionRoot.ts, ProductionRuntimeOperationContext.ts, createAuthorityIdentity(), digest()] | lang=en
- "types_productionexecutioncoordinator": "productionExecutionCoordinator.ts" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L1 | neighbors=[4077613 feat(production): add execution…, ProductionExecutionCoordinator.ts, smoke-production-execution-coordinator.…, smoke-production-execution-lifecycle.ts, smoke-production-execution-worker.ts, smoke-production-pipeline-durable-execu…] | lang=en
- "types_productionexecutionpersistence_productionexecutionpersistenceadapter": "ProductionExecutionPersistenceAdapter" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L44 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionCoordinator.ts, ProductionExecutionDescriptorBoundReadA…, ProductionExecutionDurableAttempt.ts] | lang=en
- "types_youtube": "youtube.ts" | kind=code-symbol | source=src/types/youtube.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ca97d40 Sprint 121: Add production YouT…, route.ts, PipelineStageExecutor.ts, ExportProvider.ts, MockYouTubeProvider.ts] | lang=en
- "ai_aiusagemanager": "AIUsageManager.ts" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L1 | neighbors=[AIUsageManager, ProjectManager.ts, ProjectManager, ProjectReader.ts, ProjectReader, ProjectWriter.ts] | lang=en
- "backup_runtimebackuppathpolicy": "RuntimeBackupPathPolicy.ts" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L1 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, assertRuntimeBackupMaterializedPath(), invalidPath(), runtimeBackupPathLimits, runtimeBackupPathPolicyVersion] | lang=en
- "production_productionactionengine": "ProductionActionEngine.ts" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, fa9d06c fix(production): harden intelli…, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, actionTypeFor(), priorityRank()] | lang=en
- "providers_imageproviderrouter": "ImageProviderRouter.ts" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderRouter.ts:L1 | neighbors=[route.ts, VisualAssetPipeline.ts, 018d91e feat(visuals): add Wikimedia Co…, 609785a Sprint 33 Phase 4 - Add Image P…, bec4962 Sprint 113: Activate production…, PipelineStageExecutor.ts] | lang=en
- "runtime_runtimestoragepaths_runtimestorageerror": "RuntimeStorageError" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L73 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), assertNoDualRootDivergence(), assertPathContained(), assertProjectWriteAuthorityLease(), assertProjectWriteAuthorityWithContext()] | lang=en
- "scripts_smoke_production_health_rules": "smoke-production-health-rules.ts" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L1 | neighbors=[ae73d56 feat(production): add determini…, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, ProductionHealthEngine.ts, ProductionHealthEngine, productionHealthRules] | lang=en
- "scripts_smoke_sprint_129_23_production_acceptance_portability": "smoke-sprint-129-23-production-acceptance-portability.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L1 | neighbors=[a76335f Sprint 129.23: Harden productio…, cc0f176 feat: complete Sprint 129.28 du…, ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand(), ProductionAcceptanceConfigurationFinger…, createProductionAcceptancePortableConfi…] | lang=en
- "types_asset_asset": "Asset" | kind=code-symbol | source=src/types/asset.ts:L14 | neighbors=[AnimationAssetPipeline.ts, AnimationService.ts, AnimationStorage.ts, VideoAssemblyManager.ts, AssetGallery.tsx, AssetManager.ts] | lang=en
- "types_audio_audiodata": "AudioData" | kind=code-symbol | source=src/types/audio.ts:L134 | neighbors=[AssemblyManager.ts, route.ts, VideoAssemblyManager.ts, AudioManager.ts, AudioPipeline.ts, AudioService.ts] | lang=en
- "types_productionexecutionidempotency_productionexecutionidempotencyreservationrequest": "ProductionExecutionIdempotencyReservationRequest" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L41 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableClaim.ts, ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-007.json

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
