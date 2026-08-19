# Node Description Batch 63 of 166

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

- "types_productionexecutionpersistence_productionexecutionpersistencereadresult": "ProductionExecutionPersistenceReadResult" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L35 | neighbors=[ProductionExecutionDescriptorBoundReadA…, ProductionExecutionPersistence.ts, smoke-sprint-129-30-persistence-boundar…, productionExecutionPersistence.ts]
- "types_productionexecutionsafety_productioncapabilityid": "ProductionCapabilityId" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L4 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-phase-closure.ts, productionExecutionAuthorization.ts, productionExecutionSafety.ts]
- "types_productionexecutiontransaction_productionexecutionmutationintent": "ProductionExecutionMutationIntent" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L6 | neighbors=[ProductionExecutionTransaction.ts, smoke-production-execution-persistence.…, smoke-production-execution-transaction.…, productionExecutionTransaction.ts]
- "types_productionexecutionworker_productionexecutionworkerexecutionresult": "ProductionExecutionWorkerExecutionResult" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L21 | neighbors=[ProductionExecutionWorker.ts, ProductionPipelineExecutionAdapter.ts, ProductionPipelineTerminalSettlement.ts, productionExecutionWorker.ts]
- "types_productionhealth_productionhealthschemaversion": "productionHealthSchemaVersion" | kind=code-symbol | source=src/types/productionHealth.ts:L12 | neighbors=[ProductionHealthApiClient.ts, ProductionHealthEngine.ts, ProductionHealthService.ts, productionHealth.ts]
- "types_productionintelligence_productiondependencygraph": "ProductionDependencyGraph" | kind=code-symbol | source=src/types/productionIntelligence.ts:L34 | neighbors=[ProductionDependencyGraph.ts, ProductionIntelligenceConsumer.ts, ProductionPlanner.ts, productionIntelligence.ts]
- "types_productionintelligence_productionexecutiondryrunresult": "ProductionExecutionDryRunResult" | kind=code-symbol | source=src/types/productionIntelligence.ts:L93 | neighbors=[ProductionExecutionGateway.ts, ProductionExecutionJobContract.ts, ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionregeneration_productionregenerationintent": "ProductionRegenerationIntent" | kind=code-symbol | source=src/types/productionRegeneration.ts:L46 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, productionRegeneration.ts, ProductionRegenerationBinding]
- "types_productionruntimehealth_productionruntimehealthresponsebase": "ProductionRuntimeHealthResponseBase" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L13 | neighbors=[productionRuntimeHealth.ts, ProductionRuntimeHealthyResponse, ProductionRuntimeNonHealthyResponse, ProductionRuntimeUnavailableResponse]
- "types_productionsnapshot_productionsnapshotfindingevidencevalue": "ProductionSnapshotFindingEvidenceValue" | kind=code-symbol | source=src/types/productionSnapshot.ts:L200 | neighbors=[ProductionHealthEngine.ts, ProductionHealthFindingEvidence.tsx, productionHealth.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotsourcename": "ProductionSnapshotSourceName" | kind=code-symbol | source=src/types/productionSnapshot.ts:L26 | neighbors=[ProductionHealthCoreRules.ts, ProductionSnapshotParts.ts, productionHealth.ts, productionSnapshot.ts]
- "types_script_scriptchapter": "ScriptChapter" | kind=code-symbol | source=src/types/script.ts:L1 | neighbors=[AIManager.ts, AssemblyManager.ts, AudioManager.ts, script.ts]
- "types_visual_thumbnailconcept": "ThumbnailConcept" | kind=code-symbol | source=src/types/visual.ts:L55 | neighbors=[VisualStructuredOutput.ts, visual.ts, ThumbnailConceptEngine.ts, VisualManager.ts]
- "types_youtubepublish_youtubepublishingrecord": "YouTubePublishingRecord" | kind=code-symbol | source=src/types/youtubePublish.ts:L93 | neighbors=[YouTubePublishPipeline.ts, smoke-production-publish-reconciliation…, youtubePublish.ts, YouTubePublishRecordBase]
- "types_youtubepublish_youtubepublishrecord": "YouTubePublishRecord" | kind=code-symbol | source=src/types/youtubePublish.ts:L111 | neighbors=[YouTubePublishPipeline.ts, YouTubePublishValidation.ts, smoke-production-end-to-end-stabilizati…, youtubePublish.ts]
- "types_youtubepublish_youtubepublishrecordbase": "YouTubePublishRecordBase" | kind=code-symbol | source=src/types/youtubePublish.ts:L78 | neighbors=[youtubePublish.ts, YouTubePublishedRecord, YouTubePublishFailedRecord, YouTubePublishingRecord]
- "video_videopipeline_requirevalidbatch": "requireValidBatch()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L284 | neighbors=[VideoPipeline.ts, SceneVideoGenerationError, validateResult(), .generateVideo()]
- "video_videopipeline_validateresult": "validateResult()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L335 | neighbors=[VideoPipeline.ts, requireValidBatch(), SceneVideoGenerationError, validDate()]
- "visuals_animationpromptengine_animationpromptengine": "AnimationPromptEngine" | kind=code-symbol | source=src/lib/visuals/AnimationPromptEngine.ts:L9 | neighbors=[AnimationPromptEngine.ts, .createFallbackPrompt(), .normalizePrompt(), VisualManager.ts]
- "visuals_thumbnailconceptengine_thumbnailconceptengine": "ThumbnailConceptEngine" | kind=code-symbol | source=src/lib/visuals/ThumbnailConceptEngine.ts:L4 | neighbors=[ThumbnailConceptEngine.ts, .createFallbackConcept(), .normalizeConcept(), VisualManager.ts]
- "youtube_youtubeengine_youtubeengine": "YouTubeEngine" | kind=code-symbol | source=src/lib/youtube/YouTubeEngine.ts:L12 | neighbors=[YouTubeEngine.ts, .constructor(), .generatePublishingPackage(), YouTubePackagePipeline.ts]
- "youtube_youtubepackagevalidation_youtubepackagevalidationerror": "YouTubePackageValidationError" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L22 | neighbors=[YouTubePackageValidation.ts, normalizeYouTubePackageDraft(), validateYouTubePublishingPackage(), .constructor()]
- "youtube_youtubeproviderconfig_youtubeproviderconfigurationerror": "YouTubeProviderConfigurationError" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderConfig.ts:L6 | neighbors=[smoke-production-youtube-package-pipeli…, YouTubeProviderConfig.ts, resolveYouTubeProviderName(), .constructor()]
- "ai_airesponseerror_isairesponseschemaevidence": "isAIResponseSchemaEvidence()" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L34 | neighbors=[AIResponseError.ts, serializeAIResponseSchemaIssues(), PipelineErrorEvidence.ts]
- "ai_aiusagemanager_aiusagemanager_appendrecord": ".appendRecord()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L14 | neighbors=[AIUsageManager, .readUsageLog(), .updateManifestUsage()]
- "ai_researchstructuredoutput_validatearray": "validateArray()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L158 | neighbors=[ResearchStructuredOutput.ts, observedType(), validateProviderResearch()]
- "ai_researchstructuredoutput_validatestring": "validateString()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L143 | neighbors=[ResearchStructuredOutput.ts, validateProviderResearch(), observedType()]
- "ai_scenestructuredoutput_createscenesprompt": "createScenesPrompt()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L34 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, smoke-sprint-129-17-scenes-structured-o…]
- "ai_scenestructuredoutput_validatescenes": "validateScenes()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L115 | neighbors=[SceneStructuredOutput.ts, validateProviderScenes(), observedType()]
- "ai_scriptstructuredoutput_validatechapters": "validateChapters()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L74 | neighbors=[ScriptStructuredOutput.ts, observedType(), validateProviderScript()]
- "ai_scriptstructuredoutput_validatekeywords": "validateKeywords()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L101 | neighbors=[ScriptStructuredOutput.ts, observedType(), validateProviderScript()]
- "ai_scriptstructuredoutput_validatepositiveinteger": "validatePositiveInteger()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L132 | neighbors=[ScriptStructuredOutput.ts, observedType(), validateProviderScript()]
- "ai_scriptstructuredoutput_validatestring": "validateString()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L122 | neighbors=[ScriptStructuredOutput.ts, validateProviderScript(), observedType()]
- "ai_visualstructuredoutput_createvisualplanprompt": "createVisualPlanPrompt()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L45 | neighbors=[VisualStructuredOutput.ts, smoke-sprint-129-19-visuals-structured-…, VisualManager.ts]
- "ai_visualstructuredoutput_exactfields": "exactFields()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L172 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), validateThumbnail()]
- "ai_visualstructuredoutput_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L204 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), validateThumbnail()]
- "ai_visualstructuredoutput_validatestring": "validateString()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L191 | neighbors=[VisualStructuredOutput.ts, observedType(), validateThumbnail()]
- "ai_visualstructuredoutput_validatevisualscenes": "validateVisualScenes()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L131 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), observedType()]
- "animation_animationmotionplanerror_animationmotionplanerror": "AnimationMotionPlanError" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L20 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanError.ts, .constructor()]
- "animation_animationmotionplanerror_integer": "integer()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L185 | neighbors=[AnimationMotionPlanError.ts, optionalInteger(), sanitizeAnimationProviderDiagnosticMeta…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-062.json

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
