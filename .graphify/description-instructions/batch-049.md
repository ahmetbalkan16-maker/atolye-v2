# Node Description Batch 50 of 166

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

- "types_productionexecutionpersistence_productionexecutionpersistencewriteresult": "ProductionExecutionPersistenceWriteResult" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L31 | neighbors=[ProductionExecutionDescriptorBoundReadA…, ProductionExecutionPersistence.ts, smoke-sprint-129-13-script-settlement.ts, smoke-sprint-129-30-persistence-boundar…, productionExecutionPersistence.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapclassification": "ProductionExecutionRecoveryBootstrapClassification" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L5 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, ProductionRuntimeInitializer.ts, smoke-production-runtime-startup.ts, productionExecutionRecoveryBootstrap.ts, productionRuntimeInitialization.ts]
- "types_productionhealth_productionhealthrule": "ProductionHealthRule" | kind=code-symbol | source=src/types/productionHealth.ts:L107 | neighbors=[ProductionHealthCoreRules.ts, ProductionHealthMetricRules.ts, ProductionHealthRules.ts, ProductionHealthEngine.ts, productionHealth.ts]
- "types_productionhealth_productionhealthstatus": "ProductionHealthStatus" | kind=code-symbol | source=src/types/productionHealth.ts:L14 | neighbors=[ProductionHealthEngine.ts, ProductionHealthFindingEvidence.tsx, ProductionHealthFindingsPanel.tsx, ProductionHealthPanel.tsx, productionHealth.ts]
- "types_productionintelligence_productionexecutionrequest": "ProductionExecutionRequest" | kind=code-symbol | source=src/types/productionIntelligence.ts:L63 | neighbors=[ProductionExecutionContract.ts, ProductionExecutionJobContract.ts, smoke-production-execution-confirmation…, productionExecutionConfirmation.ts, productionIntelligence.ts]
- "types_productionintelligence_productionintelligenceschemaversion": "productionIntelligenceSchemaVersion" | kind=code-symbol | source=src/types/productionIntelligence.ts:L4 | neighbors=[ProductionIntelligenceConsumer.ts, ProductionIntelligenceService.ts, smoke-production-intelligence-consumer-…, smoke-production-phase-closure.ts, productionIntelligence.ts]
- "types_productionintelligence_productionplan": "ProductionPlan" | kind=code-symbol | source=src/types/productionIntelligence.ts:L55 | neighbors=[ProductionExecutionContract.ts, ProductionIntelligenceConsumer.ts, ProductionPlanner.ts, smoke-production-intelligence-phase-rev…, productionIntelligence.ts]
- "types_productionintelligence_productionrecommendedaction": "ProductionRecommendedAction" | kind=code-symbol | source=src/types/productionIntelligence.ts:L14 | neighbors=[ProductionActionEngine.ts, ProductionDependencyGraph.ts, ProductionIntelligenceConsumer.ts, ProductionPlanner.ts, productionIntelligence.ts]
- "types_productionoperationjournal_productionoperationjournalevent": "ProductionOperationJournalEvent" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L4 | neighbors=[ProductionExecutionPersistence.ts, ProductionOperationJournal.ts, smoke-production-execution-persistence.…, productionExecutionPersistence.ts, productionOperationJournal.ts]
- "types_productionsnapshot_productionsnapshotsourcestate": "ProductionSnapshotSourceState" | kind=code-symbol | source=src/types/productionSnapshot.ts:L42 | neighbors=[ProductionHealthCoreRules.ts, ProductionHealthEngine.ts, ProductionSnapshotContract.ts, ProductionSnapshotSourceReader.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotstage": "ProductionSnapshotStage" | kind=code-symbol | source=src/types/productionSnapshot.ts:L89 | neighbors=[ProductionSnapshotParts.ts, production-intelligence-fixture.ts, smoke-production-health-rules.ts, smoke-production-snapshot-contract.ts, productionSnapshot.ts]
- "types_project_projectpackageusage": "ProjectPackageUsage" | kind=code-symbol | source=src/types/project.ts:L76 | neighbors=[AIUsageManager.ts, ProjectManager.ts, projectProgress.ts, productionSnapshot.ts, project.ts]
- "types_thumbnail_thumbnailprovidername": "ThumbnailProviderName" | kind=code-symbol | source=src/types/thumbnail.ts:L7 | neighbors=[ThumbnailProvider.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailProviderConfig.ts, ThumbnailProviderRouter.ts, thumbnail.ts]
- "types_videoassembly_videoassemblyinput": "VideoAssemblyInput" | kind=code-symbol | source=src/types/videoAssembly.ts:L36 | neighbors=[VideoAssemblyManager.ts, FFmpegVideoAssemblyProvider.ts, VideoAssemblyProvider.ts, smoke-sprint-129-41-completed-stage-reg…, videoAssembly.ts]
- "types_videoassembly_videoassemblyresult": "VideoAssemblyResult" | kind=code-symbol | source=src/types/videoAssembly.ts:L80 | neighbors=[VideoAssemblyManager.ts, FFmpegVideoAssemblyProvider.ts, VideoAssemblyProvider.ts, smoke-production-video-assembly-wiring.…, videoAssembly.ts]
- "types_youtube_youtubeprovidername": "YouTubeProviderName" | kind=code-symbol | source=src/types/youtube.ts:L1 | neighbors=[YouTubeProvider.ts, youtube.ts, YouTubePackageValidation.ts, YouTubeProviderConfig.ts, YouTubeProviderRouter.ts]
- "types_youtubepublish_youtubepublishprovidername": "YouTubePublishProviderName" | kind=code-symbol | source=src/types/youtubePublish.ts:L3 | neighbors=[YouTubePublishProvider.ts, YouTubePublishProviderConfig.ts, YouTubePublishProviderRouter.ts, YouTubePublishValidation.ts, youtubePublish.ts]
- "types_youtubepublish_youtubepublishreconciliationrequest": "YouTubePublishReconciliationRequest" | kind=code-symbol | source=src/types/youtubePublish.ts:L25 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, smoke-production-publish-reconciliation…, youtubePublish.ts]
- "utils_json": "json.ts" | kind=code-symbol | source=src/lib/ai/utils/json.ts:L1 | neighbors=[5b68c56 refactor(ai): add shared json a…, index.ts, extractJson(), parseAIJsonResponse(), safeJsonParse()]
- "video_videopipeline_videopipeline_generatevideo": ".generateVideo()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L48 | neighbors=[VideoPipeline, prepareInputs(), requireProviderName(), requireValidBatch(), SceneVideoGenerationError]
- "visuals_visualengine": "VisualEngine.ts" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, SceneInput, VisualEngine, VisualPrompt, VisualStyle]
- "visuals_visualmanager_visualmanager_generatevisualdata": ".generateVisualData()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L37 | neighbors=[VisualManager, .createFallbackVisualData(), .mapThumbnail(), .mapVisualScenes(), .toLegacyPrompts()]
- "youtube_youtubeproviderconfig_resolveyoutubeprovidername": "resolveYouTubeProviderName()" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderConfig.ts:L36 | neighbors=[ProductionReadinessService.ts, smoke-production-youtube-package-pipeli…, YouTubeProviderConfig.ts, YouTubeProviderConfigurationError, YouTubeProviderRouter.ts]
- "ai_aiusagemanager_aiusagemanager_readusagelog": ".readUsageLog()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L30 | neighbors=[AIUsageManager, .appendRecord(), .getUsageLog(), .isUsageLog()]
- "ai_aiusagemanager_aiusagemanager_updatemanifestusage": ".updateManifestUsage()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L65 | neighbors=[AIUsageManager, .appendRecord(), .isProductionStep(), .mapRecordToPackageUsage()]
- "ai_researchaiconfig_researchaiconfigerror": "ResearchAIConfigError" | kind=code-symbol | source=src/lib/ai/ResearchAIConfig.ts:L8 | neighbors=[AIManager.ts, ResearchAIConfig.ts, getResearchMaxTokens(), .constructor()]
- "ai_researchstructuredoutput_createresearchprompt": "createResearchPrompt()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L48 | neighbors=[AIManager.ts, ResearchStructuredOutput.ts, smoke-sprint-129-11-research-schema-com…, smoke-sprint-129-7-research-structured-…]
- "ai_researchstructuredoutput_observedtype": "observedType()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L199 | neighbors=[ResearchStructuredOutput.ts, validateArray(), validateProviderResearch(), validateString()]
- "ai_schema": "schema.ts" | kind=code-symbol | source=src/lib/ai/schema.ts:L1 | neighbors=[ScriptDocument, ScriptSection, validator.ts, 91ba270 Atölye V2 checkpoint - pipeline…]
- "ai_types": "types.ts" | kind=code-symbol | source=src/lib/ai/types.ts:L1 | neighbors=[AIProvider.ts, AIProvider, 6c1ae5a Sprint 15 - Multi AI Provider A…, 91ba270 Atölye V2 checkpoint - pipeline…]
- "ai_validator": "validator.ts" | kind=code-symbol | source=src/lib/ai/validator.ts:L1 | neighbors=[schema.ts, ScriptDocument, validateScript(), 91ba270 Atölye V2 checkpoint - pipeline…]
- "ai_visualstructuredoutput_parsestrictvisualplanresponse": "parseStrictVisualPlanResponse()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L96 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), smoke-sprint-129-19-visuals-structured-…, VisualManager.ts]
- "animation_animationmerge_mergeanimationdata": "mergeAnimationData()" | kind=code-symbol | source=src/lib/animation/animationMerge.ts:L4 | neighbors=[animationMerge.ts, sortAnimationScenes(), route.ts, smoke-animation-motion-plan-contract.ts]
- "animation_animationmotionplanerror_getanimationmotionplanerrorevidence": "getAnimationMotionPlanErrorEvidence()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L41 | neighbors=[AnimationMotionPlanError.ts, PipelineErrorEvidence.ts, ProductionExecutionWorker.ts, smoke-sprint-129-21-animation-failure-d…]
- "animation_animationmotionplanerror_serializeanimationmotionplanevidence": "serializeAnimationMotionPlanEvidence()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L73 | neighbors=[AnimationMotionPlanError.ts, durablePhase(), isAnimationMotionPlanErrorEvidence(), ProductionExecutionWorker.ts]
- "animation_animationmotionplanvalidation_isanimationmotionplandata": "isAnimationMotionPlanData()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L119 | neighbors=[AnimationMotionPlanValidation.ts, isCompatibleAnimationData(), VideoAssemblyManager.ts, VideoPipeline.ts]
- "animation_animationstorage_animationstorage_removemotionplanifexists": ".removeMotionPlanIfExists()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L156 | neighbors=[AnimationStorage, .getAnimationDir(), requireStorageSentinel(), resolve()]
- "animation_animationstorage_requirestoredproductionmotionplan": "requireStoredProductionMotionPlan()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L247 | neighbors=[AnimationStorage.ts, .inspectStoredMotionPlan(), VideoAssemblyManager.ts, VideoPipeline.ts]
- "animation_animationstructuredoutput_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L247 | neighbors=[AnimationStructuredOutput.ts, validateAnimationProviderPlan(), validateFrame(), validateNumericObject()]
- "animation_animationstructuredoutput_validateenum": "validateEnum()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L179 | neighbors=[AnimationStructuredOutput.ts, validateAnimationProviderPlan(), category(), issue()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-049.json

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
