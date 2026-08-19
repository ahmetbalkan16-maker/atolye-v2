# Node Description Batch 6 of 166

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

- "production_productionhealthservice": "ProductionHealthService.ts" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L1 | neighbors=[6ef1840 feat(production): add read-only…, d3c574c feat(production): add intellige…, de75921 feat(production): add health ap…, fa9d06c fix(production): harden intelli…, ProductionHealthApiClient.ts, ProductionHealthEngine.ts]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare": "smoke-sprint-129-24-acceptance-marker-reprepare.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L1 | neighbors=[3b885dc Sprint 129.24: Add controlled a…, cc0f176 feat: complete Sprint 129.28 du…, ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand(), ProductionAcceptanceConfigurationFinger…, ProductionAcceptanceComponentFingerprin…]
- "types_productionexecutionworker": "productionExecutionWorker.ts" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L1 | neighbors=[0c8dfb2 feat(production): add durable w…, 560e013 feat(production): add worker ex…, ProductionExecutionWorker.ts, ProductionPipelineExecutionAdapter.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineTerminalSettlement.ts]
- "audio_audioasseterror": "AudioAssetError.ts" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L1 | neighbors=[AudioAssetErrorMetadata, AudioAssetRootError, AudioCanonicalAdmissionConflictError, createAudioAssetErrorEvidence(), EVIDENCE_KEYS, getAudioAssetErrorEvidence()]
- "lib_smokeresult": "SmokeResult.ts" | kind=code-symbol | source=scripts/lib/SmokeResult.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, emitSmokeResult(), smoke-animation-motion-plan-contract.ts, smoke-assembly-scene-video-consumption.…, smoke-pipeline-history-persistence.ts, smoke-pipeline-orchestration.ts]
- "production_productionacceptanceconfigurationfingerprint": "ProductionAcceptanceConfigurationFingerprint.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L1 | neighbors=[3b885dc Sprint 129.24: Add controlled a…, 6286a7c feat(audio): complete truncatio…, a2830bc fix(production): close sprint 1…, a76335f Sprint 129.23: Harden productio…, componentFingerprint(), CONFIGURATION_COMPONENT_NAMES]
- "production_productionacceptancelegacyreauthorization": "ProductionAcceptanceLegacyReauthorization.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L1 | neighbors=[61f1dbe wip: sprint 129.28 legacy reaut…, a029553 fix(production): close sprint 1…, cc0f176 feat: complete Sprint 129.28 du…, ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyDurableRecove…]
- "providers_thumbnailprovider": "ThumbnailProvider.ts" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L1 | neighbors=[4cde4cd feat(thumbnail): add thumbnail …, 5883c6d Sprint 120: Activate production…, 99834f4 feat: complete Sprint 129.28 du…, PipelineStageExecutor.ts, MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts]
- "scripts_smoke_pipeline_orchestration": "smoke-pipeline-orchestration.ts" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, b8e8aaa feat(pipeline): add stage compl…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), SmokeResult.ts, emitSmokeResult()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget": "smoke-sprint-129-37-assembly-truncation-budget.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L1 | neighbors=[a2830bc fix(production): close sprint 1…, AIResponseError.ts, AIResponseError, AIUsageManager.ts, AIUsageManager, GenerationExecutionPolicy.ts]
- "scripts_smoke_sprint_129_7_research_structured_output": "smoke-sprint-129-7-research-structured-output.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, AIManager.ts, AIManager, AIResponseError.ts, AIResponseError, AIUsageManager.ts]
- "studio_productionhealthpanel": "ProductionHealthPanel.tsx" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L1 | neighbors=[53955f6 feat(production): add health ui…, aba67da feat(production): add health fi…, d3c574c feat(production): add intellige…, smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-ui.ts]
- "thumbnail_thumbnailassetpipeline": "ThumbnailAssetPipeline.ts" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L1 | neighbors=[5883c6d Sprint 120: Activate production…, PipelineStageExecutor.ts, smoke-production-thumbnail-pipeline.ts, AssetManager.ts, AssetManager, ProjectWriter.ts]
- "types_pipelinejob_pipelinejoblist": "PipelineJobList" | kind=code-symbol | source=src/types/pipelineJob.ts:L37 | neighbors=[PipelineFailedStageRetry.ts, PipelineJobManager.ts, ProductionCompletedStageRegenerationSer…, ProductionPipelineRetryBudgetExtensionT…, ProductionQueuedExhaustedDriftClassifie…, ProductionQueuedExhaustedDriftRecovery.…]
- "types_productionexecutiondurablestorage": "productionExecutionDurableStorage.ts" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L1 | neighbors=[02bf9b6 feat(production): add durable e…, 80adfc8 feat(production): add durable e…, ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts]
- "types_scene": "scene.ts" | kind=code-symbol | source=src/types/scene.ts:L1 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, VisualStructuredOutput.ts, AnimationService.ts, route.ts, AssemblyManager.ts]
- "animation_animationmotionplanvalidation": "AnimationMotionPlanValidation.ts" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L1 | neighbors=[AnimationAssetPipeline.ts, animationMerge.ts, animationStatuses, finiteBetween(), hasMotionPlanFields(), isAnimationMotionPlanData()]
- "lib_smokeresult_emitsmokeresult": "emitSmokeResult()" | kind=code-symbol | source=scripts/lib/SmokeResult.ts:L1 | neighbors=[SmokeResult.ts, smoke-animation-motion-plan-contract.ts, smoke-assembly-scene-video-consumption.…, smoke-pipeline-history-persistence.ts, smoke-pipeline-orchestration.ts, smoke-pipeline-retry-continuation-harde…]
- "projects_projectwriter": "ProjectWriter.ts" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L1 | neighbors=[AIUsageManager.ts, 507becc Sprint 129.25B: Runtime root ab…, 65d376b Sprint 129.19: Harden visual st…, 91ba270 Atölye V2 checkpoint - pipeline…, c7956b7 feat: harden retry persistence …, ca97d40 Sprint 121: Add production YouT…]
- "prompts_animationpromptgenerator": "AnimationPromptGenerator.ts" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L1 | neighbors=[route.ts, 0108d60 feat(ai): add mock-first provid…, 4f8ac6b feat(animation): connect animat…, 5a74949 feat(animation): add scene-leve…, c23a64b feat(ai): add usage observabili…, c70a533 Sprint 126: Add production read…]
- "providers_providerdispatchadapterauthority_createproviderdispatchadapter": "createProviderDispatchAdapter()" | kind=code-symbol | source=src/lib/providers/ProviderDispatchAdapterAuthority.ts:L9 | neighbors=[FFmpegSceneVideoProvider.ts, FFmpegVideoAssemblyProvider.ts, MockAIProvider.ts, MockAnimationProvider.ts, MockAudioProvider.ts, MockImageProvider.ts]
- "providers_youtubedataapipublishprovider": "YouTubeDataApiPublishProvider.ts" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, 99834f4 feat: complete Sprint 129.28 du…, ae42dc4 Sprint 123: Stabilize productio…, ProviderDispatchAdapterAuthority.ts, createProviderDispatchAdapter()]
- "scripts_smoke_retry_persistence": "smoke-retry-persistence.ts" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, a029553 fix(production): close sprint 1…, c7956b7 feat: harden retry persistence …, d3c574c feat(production): add intellige…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime()]
- "scripts_smoke_sprint_129_15_script_timestamp": "smoke-sprint-129-15-script-timestamp.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, AIManager.ts, AIManager, CanonicalTimestamp.ts, ApplicationTimestampError, createCanonicalApplicationTimestamp()]
- "scripts_smoke_sprint_129_25b_runtime_root": "smoke-sprint-129-25b-runtime-root.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L1 | neighbors=[507becc Sprint 129.25B: Runtime root ab…, 6387e3d Sprint 129.25 C.2B.2: Add verif…, AssetManager.ts, AssetManager, runtime-tracking-inventory.ts, assertRuntimeTrackingAdmission()]
- "types_aiusage": "aiUsage.ts" | kind=code-symbol | source=src/types/aiUsage.ts:L1 | neighbors=[AIManager.ts, AIUsageManager.ts, pipeline.ts, runObservedAIRequest.ts, AssemblyManager.ts, AudioManager.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6286a7c53166d38d09cd09ad97b2188138ab5df1": "6286a7c feat(audio): complete truncation budget and durable storage hardening" | kind=Commit | source=git | neighbors=[AudioAIConfig.ts, AudioAssetError.ts, AudioCompensationStore.ts, AudioIdentifierPolicy.ts, AudioManager.ts, AudioPipeline.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8f7a37b040e01f46131eb433eed56feaec7ba4e3": "8f7a37b fix(production): close sprint 129.41 remediation" | kind=Commit | source=git | neighbors=[37dc655 fix(video): preserve full-frame…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 06fc5b7 fix(test): close sprint 129.42 …, PipelineFailedStageRetry.ts]
- "export_route": "route.ts" | kind=code-symbol | source=app/api/export/route.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, 8bc6e5f feat(youtube-export): add youtu…, ca97d40 Sprint 121: Add production YouT…, ExportEngine.ts, ExportEngine, isAssemblyPlanData()]
- "providers_animationprovider": "AnimationProvider.ts" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L1 | neighbors=[AnimationAssetPipeline.ts, AnimationStorage.ts, 6094cd8 Sprint 129.21: Harden productio…, 68f61dc feat(animation): add animation …, 7a10970 Sprint 127: Activate production…, 99834f4 feat: complete Sprint 129.28 du…]
- "publish_youtubepublishvalidation": "YouTubePublishValidation.ts" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, PipelineRecoveryPlanner.ts, ProductionCompletedStageRegenerationPla…, ProjectManager.ts, MockYouTubePublishProvider.ts]
- "runtime_runtimestoragepaths_resolveruntimestoragecontext": "resolveRuntimeStorageContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L173 | neighbors=[AnimationStorage.ts, AssetManager.ts, AudioCompensationStore.ts, AudioPublicationIntentStore.ts, RuntimeBackupInventory.ts, PipelineFailedStageRetry.ts]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget": "smoke-sprint-129-20-visuals-truncation-budget.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L1 | neighbors=[5166a51 Sprint 129.20: Harden visuals t…, AIResponseError.ts, AIResponseError, GenerationExecutionPolicy.ts, strictGenerationExecutionPolicy, ResearchAIConfig.ts]
- "types_pipelinerecovery": "pipelineRecovery.ts" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L1 | neighbors=[0ff6112 feat(production): add stage-bou…, 24d0cba feat(pipeline): harden retry fa…, 31fc08b feat(pipeline): add retry execu…, 65d376b Sprint 129.19: Harden visual st…, 7afa3c8 feat(pipeline): integrate retry…, c19748c feat(pipeline): add resume exec…]
- "ai_researchstructuredoutput": "ResearchStructuredOutput.ts" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L1 | neighbors=[AIManager.ts, AIResponseError.ts, AIResponseError, CanonicalTimestamp.ts, createCanonicalApplicationTimestamp(), isCanonicalTimestamp()]
- "ai_runobservedairequest": "runObservedAIRequest.ts" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L1 | neighbors=[AIManager.ts, pipeline.ts, AIProviderConfig.ts, AIProviderConfig, AIResponseError.ts, AIResponseErrorCode]
- "production_productionpipelineretrybudgetextensiongate": "ProductionPipelineRetryBudgetExtensionGate.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionGate.ts:L1 | neighbors=[9d652d5 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, PipelineRunner.ts, ProductionCanonicalDurableLineage.ts, readProductionCanonicalTerminalDurableL…, ProductionExecutionDurableStorage.ts]
- "production_productionqueuedexhausteddriftclassifier": "ProductionQueuedExhaustedDriftClassifier.ts" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L1 | neighbors=[2863b3a fix(production): bind queued ex…, a029553 fix(production): close sprint 1…, cfb4887 feat(sprint-129.35): legacy ter…, PipelineRunner.ts, ProductionCanonicalDurableLineage.ts, readProductionCanonicalTerminalDurableL…]
- "providers_openaiaudioprovider": "OpenAIAudioProvider.ts" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L1 | neighbors=[4f09cf6 Sprint 114: Activate production…, 6286a7c feat(audio): complete truncatio…, 99834f4 feat: complete Sprint 129.28 du…, e31d35d wip: checkpoint two-phase audio…, AudioProviderRouter.ts, AudioAssetError.ts]
- "scripts_smoke_sprint_129_9_failed_stage_resume": "smoke-sprint-129-9-failed-stage-resume.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L1 | neighbors=[6094cd8 Sprint 129.21: Harden productio…, 65d376b Sprint 129.19: Harden visual st…, PipelineFailedStageRetry.ts, prepareFailedStageRetry(), PipelineJobManager.ts, PipelineJobManager]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-005.json

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
