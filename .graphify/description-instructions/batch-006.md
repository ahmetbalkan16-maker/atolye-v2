# Node Description Batch 7 of 166

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

- "youtube_route": "route.ts" | kind=code-symbol | source=app/api/youtube/route.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 2a03d89 Sprint 117: Activate production…, 8bc6e5f feat(youtube-export): add youtu…, ae42dc4 Sprint 123: Stabilize productio…, ca97d40 Sprint 121: Add production YouT…, smoke-production-publish-reconciliation…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@eacb090e2209db7a364b553763b6a5c5c73969f4": "eacb090 fix(production): close sprint 129.36 retry budget extension" | kind=Commit | source=git | neighbors=[9d652d5 fix(production): close sprint 1…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, a2830bc fix(production): close sprint 1…, PipelineFailedStageRetry.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@fb444fd0743f48716df5d7c7bc03a93c69ce873c": "fb444fd wip: preserve C.2B.3 audit and C.2B.4 final review checkpoint" | kind=Commit | source=git | neighbors=[6387e3d Sprint 129.25 C.2B.2: Add verif…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner": "PipelineRecoveryPlanner" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L64 | neighbors=[PipelineRecoveryPlanner.ts, .createJobRetryPlan(), .createResumePlan(), .createRetryPlan(), .getFailedStages(), .getNextIncompleteStage()]
- "production_productionexecutiontransaction": "ProductionExecutionTransaction.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L1 | neighbors=[d655db9 feat(production): add execution…, ProductionExecutionPersistence.ts, ProductionDeterminism.ts, stableProductionId(), buildProductionExecutionTransactionPlan…, canonicalSteps()]
- "production_productionpipelineexecutionidentity": "ProductionPipelineExecutionIdentity.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionIdentity.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, 8f7a37b fix(production): close sprint 1…, HistoricalAudioOrdinalFourPreflight.ts, PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, ProductionCanonicalDurableLineage.ts]
- "production_productionpipelineretrybudgetextensionschema": "ProductionPipelineRetryBudgetExtensionSchema.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L1 | neighbors=[9d652d5 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, HistoricalAudioOrdinalFourPreflight.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryBudgetExtensionG…, ProductionDeterminism.ts]
- "providers_realphotoimageprovider": "RealPhotoImageProvider.ts" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L1 | neighbors=[018d91e feat(visuals): add Wikimedia Co…, 2d9074c fix(visuals): real photo source…, ImageProviderRouter.ts, ImageProvider.ts, ConfiguredImageProvider, ImageGenerationInput]
- "scripts_smoke_sprint_129_26_audio_truncation_budget": "smoke-sprint-129-26-audio-truncation-budget.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L1 | neighbors=[6286a7c feat(audio): complete truncatio…, AudioAIConfig.ts, AudioAIConfigError, audioTokenBudget, getAudioMaxTokens(), GenerationExecutionPolicy.ts]
- "scripts_smoke_sprint_129_5_production_acceptance_topic": "smoke-sprint-129-5-production-acceptance-topic.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, a029553 fix(production): close sprint 1…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "studio_index": "index.ts" | kind=code-symbol | source=src/components/studio/index.ts:L1 | neighbors=[26fb978 feat(studio): add AI diagnostic…, 53955f6 feat(production): add health ui…, 56ff577 Sprint 14 - Project documentati…, 8c15471 feat(video): add mock video eng…, 94269fa feat: complete sprint 64 pipeli…, 9f6b3a2 feat(audio): integrate audio en…]
- "types_scene_scenedata": "SceneData" | kind=code-symbol | source=src/types/scene.ts:L10 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, VisualStructuredOutput.ts, AnimationService.ts, route.ts, AssemblyManager.ts]
- "types_visual_visualdata": "VisualData" | kind=code-symbol | source=src/types/visual.ts:L65 | neighbors=[visualEngine.ts, VisualStructuredOutput.ts, AnimationService.ts, route.ts, AssemblyManager.ts, route.ts]
- "ai_airesponseerror": "AIResponseError.ts" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L1 | neighbors=[AIManager.ts, AIResponseError, AIResponseErrorCode, getAIResponseSchemaEvidence(), isAIResponseSchemaEvidence(), isObservedType()]
- "ai_scenestructuredoutput": "SceneStructuredOutput.ts" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L1 | neighbors=[AIManager.ts, AIResponseError.ts, AIResponseError, CanonicalTimestamp.ts, createCanonicalApplicationTimestamp(), canonicalSceneProviderSchema]
- "ai_scriptstructuredoutput": "ScriptStructuredOutput.ts" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L1 | neighbors=[AIManager.ts, AIResponseError.ts, AIResponseError, CanonicalTimestamp.ts, createCanonicalApplicationTimestamp(), canonicalScriptProviderSchema]
- "animation_animationmotionplanerror": "AnimationMotionPlanError.ts" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L1 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanError, durablePhase(), getAnimationMotionPlanErrorEvidence(), integer(), isAnimationMotionPlanErrorEvidence()]
- "animation_animationservice": "AnimationService.ts" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L1 | neighbors=[AnimationMotionPlanValidation.ts, isCompatibleAnimationData(), AnimationApiPayload, AnimationApiResponse, AnimationService, AnimationServiceBaseInput]
- "backup_runtimebackupauthority": "RuntimeBackupAuthority.ts" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L1 | neighbors=[assertTrustedRuntimeBackupStorageAuthor…, authorityInvalid(), bootstrap(), bootstrapRuntimeBackupStorageAuthority(), bootstrapTestRuntimeBackupStorageAuthor…, canonicalBackupRoot()]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@d3c574c94ab341008738e64eda0a0e9c9ed5dc72": "d3c574c feat(production): add intelligence planning and execution foundations" | kind=Commit | source=git | neighbors=[4bcbdf6 chore(production): review produ…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "pipeline_pipelinerecoveryplanner_pipelinerecoverystageorder": "pipelineRecoveryStageOrder" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L16 | neighbors=[PipelineQueueScheduler.ts, PipelineRecoveryPlanner.ts, PipelineRunner.ts, ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceOrchestrator.ts]
- "production_productionpipelineexecutionfactory_prepareproductionpipelineexecution": "prepareProductionPipelineExecution()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L241 | neighbors=[ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionFactory.ts, assertCompletedBindings(), assertCompletedCanonicalIdentityBinding…, assertReconciledRetryLineageBinding(), canonicalStoreRoot()]
- "providers_youtubeprovider": "YouTubeProvider.ts" | kind=code-symbol | source=src/lib/youtube/providers/YouTubeProvider.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, 99834f4 feat: complete Sprint 129.28 du…, ca97d40 Sprint 121: Add production YouT…, PipelineStageExecutor.ts, youtubePackagePrompt.ts, MockYouTubeProvider.ts]
- "scripts_smoke_production_execution_confirmation": "smoke-production-execution-confirmation.ts" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L1 | neighbors=[e528878 feat(production): add execution…, ProductionExecutionAuthorization.ts, evaluateProductionExecutionAuthorizatio…, ProductionExecutionConfirmation.ts, buildProductionExecutionConfirmationReq…, defaultProductionExecutionConfirmationP…]
- "security_runtimeprotectedroots": "RuntimeProtectedRoots.ts" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L1 | neighbors=[RuntimeBackupService.ts, 02c450e Sprint 129.25 C.2B.1: Migration…, aecde83 feat(runtime): add guarded file…, RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidatePreflight.ts, RuntimeMigrationCandidateService.ts]
- "types_pipelinejob_pipelinejob": "PipelineJob" | kind=code-symbol | source=src/types/pipelineJob.ts:L17 | neighbors=[PipelineFailedStageRetry.ts, PipelineJobManager.ts, PipelineRetryAdmission.ts, PipelineRunner.ts, ProductionAcceptanceLegacyAdmissionCont…, ProductionPipelineRetryAdmissionBinding…]
- "types_script": "script.ts" | kind=code-symbol | source=src/types/script.ts:L1 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, AssemblyManager.ts, route.ts, AudioManager.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@f21fc249dd901a9e0e3d4b5e30df5fe8127f6d6d": "f21fc24 Sprint 128: Harden production acceptance workflow" | kind=Commit | source=git | neighbors=[7a10970 Sprint 127: Activate production…, AIManager.ts, AssemblyManager.ts, VideoAssemblyManager.ts, VisualAssetPipeline.ts, agents/api-graphify-mcp-integration]
- "production_productionruntimeinitializer": "ProductionRuntimeInitializer.ts" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L1 | neighbors=[0e442b3 Sprint 111: Add production runt…, af745ac Sprint 109: Process Startup Boo…, e3b5c6c Sprint 110: Add production work…, ProductionExecutionRecoveryBootstrap.ts, ProductionExecutionRecoveryBootstrap, classifications]
- "scripts_smoke_production_execution_idempotency": "smoke-production-execution-idempotency.ts" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L1 | neighbors=[b4ec40e feat(production): add persisten…, ProductionExecutionIdempotency.ts, buildProductionExecutionIdempotencyIden…, defaultProductionExecutionIdempotencyPo…, evaluateProductionExecutionIdempotencyR…, evaluateProductionExecutionIdempotencyT…]
- "scripts_smoke_sprint_129_11_research_schema_compatibility": "smoke-sprint-129-11-research-schema-compatibility.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, AIManager.ts, AIManager, AIResponseError.ts, AIResponseError, getAIResponseSchemaEvidence()]
- "scripts_smoke_sprint_129_32_retry_durable_attempt_ordinal": "smoke-sprint-129-32-retry-durable-attempt-ordinal.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-32-retry-durable-attempt-ordinal.ts:L1 | neighbors=[0d87231 wip: checkpoint Sprint 129.32 s…, a029553 fix(production): close sprint 1…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), SmokeResult.ts, emitSmokeResult()]
- "types_project_project": "Project" | kind=code-symbol | source=src/types/project.ts:L20 | neighbors=[AssemblyManager.ts, route.ts, route.ts, route.ts, PipelineStageExecutor.ts, ProductionCompletedStageRegenerationPla…]
- "production_productionacceptancelegacyadmissioncontext": "ProductionAcceptanceLegacyAdmissionContext.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, a029553 fix(production): close sprint 1…, bc53393 wip: preserve sprint 129.28 fin…, cc0f176 feat: complete Sprint 129.28 du…, PipelineRunner.ts, PipelineRetryAdmission.ts]
- "production_productionacceptancepreflight": "ProductionAcceptancePreflight.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L1 | neighbors=[VideoAssemblyManager.ts, f21fc24 Sprint 128: Harden production a…, PipelineRunner.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, allocateProductionSceneAudioSegments()]
- "production_productionacceptancereprepareservice": "ProductionAcceptanceReprepareService.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L1 | neighbors=[3b885dc Sprint 129.24: Add controlled a…, 507becc Sprint 129.25B: Runtime root ab…, a029553 fix(production): close sprint 1…, ProductionAcceptanceCommand.ts, ProductionAcceptancePolicy.ts, prepareProductionAcceptanceMarkerReprep…]
- "production_productionpipelineretrybudgetextensionstore": "ProductionPipelineRetryBudgetExtensionStore.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionStore.ts:L1 | neighbors=[9d652d5 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, PipelineFailedStageRetry.ts, PipelineRunner.ts, ProductionPipelineRetryBudgetExtensionG…, ProductionPipelineRetryBudgetExtensionS…]
- "scripts_smoke_pipeline_state_corruption": "smoke-pipeline-state-corruption.ts" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L1 | neighbors=[dd74765 feat: detect corrupted pipeline…, fa9d06c fix(production): harden intelli…, PipelineJobManager.ts, PipelineJobManager, PipelineStateError.ts, PipelineStateError]
- "seo_seomanager": "SEOManager.ts" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L1 | neighbors=[0108d60 feat(ai): add mock-first provid…, 5b68c56 refactor(ai): add shared json a…, a4839b8 feat(seo): add youtube seo engi…, c23a64b feat(ai): add usage observabili…, c70a533 Sprint 126: Add production read…, PipelineStageExecutor.ts]
- "storage_imagestorage_imagestorage": "ImageStorage" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L45 | neighbors=[AnimationAssetPipeline.ts, VideoAssemblyManager.ts, VisualAssetPipeline.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts, FFmpegSceneVideoProvider.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-006.json

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
