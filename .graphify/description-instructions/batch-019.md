# Node Description Batch 20 of 166

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

- "thumbnail_thumbnailproviderconfig": "ThumbnailProviderConfig.ts" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderConfig.ts:L1 | neighbors=[4cde4cd feat(thumbnail): add thumbnail …, 5883c6d Sprint 120: Activate production…, ProductionReadinessService.ts, OpenAIThumbnailProvider.ts, smoke-production-thumbnail-pipeline.ts, resolveThumbnailProviderName()]
- "thumbnail_thumbnailproviderrouter_thumbnailproviderrouter": "ThumbnailProviderRouter" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderRouter.ts:L9 | neighbors=[PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, smoke-production-thumbnail-pipeline.ts, smoke-sprint-129-28-production-acceptan…, smoke-sprint-129-39-stage-bounded-resum…]
- "types_productionpipelineretrybudgetextension": "productionPipelineRetryBudgetExtension.ts" | kind=code-symbol | source=src/types/productionPipelineRetryBudgetExtension.ts:L1 | neighbors=[eacb090 fix(production): close sprint 1…, HistoricalAudioOrdinalFourPreflight.ts, ProductionPipelineRetryBudgetExtensionG…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineTerminalSettlement.ts, smoke-sprint-129-36-retry-budget-extens…]
- "types_productionworkerlifecycle": "productionWorkerLifecycle.ts" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L1 | neighbors=[e3b5c6c Sprint 110: Add production work…, ProductionWorkerLifecycle.ts, productionRuntimeInitialization.ts, productionRuntimeStatus.ts, ProductionRuntimeInitializationSuccess, ProductionWorkerLifecycleReasonCode]
- "utils_index": "index.ts" | kind=code-symbol | source=src/lib/ai/utils/index.ts:L1 | neighbors=[AIManager.ts, AssemblyManager.ts, AudioManager.ts, 5b68c56 refactor(ai): add shared json a…, AnimationPromptGenerator.ts, SEOManager.ts]
- "video_route": "route.ts" | kind=code-symbol | source=app/api/video/route.ts:L1 | neighbors=[8c15471 feat(video): add mock video eng…, ffe4b50 Sprint 116: Add animation motio…, AnimationMotionPlanValidation.ts, isCompatibleAnimationData(), ProjectManager.ts, ProjectManager]
- "youtube_youtubeengine": "YouTubeEngine.ts" | kind=code-symbol | source=src/lib/youtube/YouTubeEngine.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ca97d40 Sprint 121: Add production YouT…, YouTubeProvider.ts, YouTubeGenerationInput, YouTubeGenerationResult, YouTubeProvider]
- "youtube_youtubepackagevalidation_validateyoutubepublishingpackage": "validateYouTubePublishingPackage()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L80 | neighbors=[ProjectManager.ts, YouTubePublishValidation.ts, YouTubePackagePipeline.ts, YouTubePackageValidation.ts, isYouTubePublishingPackage(), isProviderName()]
- "youtube_youtubeproviderconfig": "YouTubeProviderConfig.ts" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderConfig.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ca97d40 Sprint 121: Add production YouT…, ProductionReadinessService.ts, OpenAIYouTubeProvider.ts, smoke-production-youtube-package-pipeli…, youtube.ts]
- "ai_client": "client.ts" | kind=code-symbol | source=src/lib/ai/client.ts:L1 | neighbors=[ChatCompletionCreateParams, ChatCompletionMessage, ChatCompletionResponse, createChatCompletion(), openai, 0108d60 feat(ai): add mock-first provid…]
- "ai_scriptstructuredoutput_validateproviderscript": "validateProviderScript()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L54 | neighbors=[ScriptStructuredOutput.ts, parseStrictScriptResponse(), exactFields(), isRecord(), observedType(), validateChapters()]
- "animation_animationstorage_animationstorage": "AnimationStorage" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L55 | neighbors=[AnimationAssetPipeline.ts, AnimationStorage.ts, .getAnimationDir(), .getMotionPlanPath(), .inspectStoredMotionPlan(), .motionPlanTargetExists()]
- "audio_audiocompensationstore_cleanuprootifpresent": "cleanupRootIfPresent()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1700 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), assertProtectedAudioCanonicalResolution…, cleanupRoot(), inspectDeferredBacklog(), pruneCompletedAudioCompensationRecords()]
- "audio_audiocompensationstore_finalizerecordplacement": "finalizeRecordPlacement()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2131 | neighbors=[AudioCompensationStore.ts, deferRecordDirectory(), AudioCompensationStoreError, digest(), readAudioCompensationReceiptFromDirecto…, readJsonFile()]
- "audio_audiocompensationstore_identityinteger": "identityInteger()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2511 | neighbors=[AudioCompensationStore.ts, bindProtectedAudioCompensationPublicati…, mergeCanonicalReadIdentity(), readRetirementPlan(), requireReceiptInput(), reserveProtectedAudioCompensationPublic…]
- "audio_audiocompensationstore_readjsonfile": "readJsonFile()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1851 | neighbors=[AudioCompensationStore.ts, finalizeRecordPlacement(), readAudioCompensationReceiptFromDirecto…, AudioCompensationStoreError, readOptionalPublication(), readOptionalPublicationReservation()]
- "audio_audiocompensationstore_readworkspacemarker": "readWorkspaceMarker()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2245 | neighbors=[AudioCompensationStore.ts, inspectDeferredBacklog(), AudioCompensationStoreError, digest(), readJsonFile(), record()]
- "audio_audiocompensationstore_requirerecorddirectory": "requireRecordDirectory()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1601 | neighbors=[AudioCompensationStore.ts, bindProtectedAudioCompensationPublicati…, readAudioCompensationReceiptForRetentio…, readProtectedAudioCompensationReceipt(), AudioCompensationStoreError, cleanupRootIfPresent()]
- "audio_audiocompensationstore_reserveprotectedaudiocompensationpublication": "reserveProtectedAudioCompensationPublication()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L564 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, digest(), identityInteger(), readJsonFile(), readProtectedAudioCompensationReceipt()]
- "audio_audiocompensationstore_resumedetachedcompletedrecords": "resumeDetachedCompletedRecords()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1352 | neighbors=[AudioCompensationStore.ts, pruneCompletedAudioCompensationRecords(), AudioCompensationStoreError, cleanupRootIfPresent(), inspectDeferredBacklog(), isLogicallyRetired()]
- "audio_audiopipeline_audioassetgenerationerror": "AudioAssetGenerationError" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L31 | neighbors=[AudioPipeline.ts, addAssetOrFail(), .constructor(), audioFailure(), generateAndNormalize(), normalizeGenerationResult()]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0313b59827f851b7af04070798ddb4eea75aa7d1": "0313b59 fix: complete sprint 69 jsx entities cleanup" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0c83b5b716b1794a4cb01c269cc880cd94eb0d92": "0c83b5b feat: add retry scheduler compensation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0e1f2810baa47d9cd897825668f6b240676f8ff6": "0e1f281 fix: complete sprint 71 react hook cleanup" | kind=Commit | source=git | neighbors=[AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@292b07898f9fbffbee06625c7e019ba582f036f7": "292b078 feat: complete sprint 65 pipeline execution wiring" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2d9074ccd947c41bfda24a308f6aa8a93d64af93": "2d9074c fix(visuals): real photo source quality, reliability & latency (Sprint …" | kind=Commit | source=git | neighbors=[018d91e feat(visuals): add Wikimedia Co…, VisualAssetPipeline.ts, agents/api-graphify-mcp-integration, main, 56b2221 docs(agents): add multi-compute…, ImageProviderConfig.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2f1269916d36877c91a341404e6a62a3141e3de8": "2f12699 feat: harden retry state-load preflight" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@31fc08b26b337064b8770d0cb4b9123a36c76591": "31fc08b feat(pipeline): add retry execution foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4bcbdf63aa591f9a9930f66207ba3e65a5a3f6d7": "4bcbdf6 chore(production): review production intelligence foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4dfddf074106cc62fca9d5db939eba83a87cc4f4": "4dfddf0 feat(pipeline): add history api foundation (Sprint 78)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4f8ac6b6ea53486e1dd99435a87d3d46f1a726e8": "4f8ac6b feat(animation): connect animation prompt generator to api" | kind=Commit | source=git | neighbors=[route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5141d0d4e3d939c86b90cbc97c21f9d176fb2370": "5141d0d Sprint 32 Phase 7 - Add Visual Asset Gallery UI" | kind=Commit | source=git | neighbors=[343e0a8 Sprint 32 Phase 6 - Add Asset R…, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@528dcf8a4e0a8e80bf41b7ce25f139c4b380269c": "528dcf8 feat(audio): add audio narration engine core" | kind=Commit | source=git | neighbors=[AudioManager.ts, route.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 9f6b3a2 feat(audio): integrate audio en…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@56fd9c7b0b4c3a3ac79e31a5483d88c58521b8ab": "56fd9c7 feat(thumbnail): add thumbnail engine core" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, a4839b8 feat(seo): add youtube seo engi…, ProjectManager.ts, thumbnailPrompt.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@57721eb7629359cafb55925d22de402458d3e76a": "57721eb Sprint 32 Phase 8 - Add Asset Generation Trigger" | kind=Commit | source=git | neighbors=[5141d0d Sprint 32 Phase 7 - Add Visual …, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5fd1307727d76708ec801f81d626ea342a4d299b": "5fd1307 feat(assembly): add video assembly plan core" | kind=Commit | source=git | neighbors=[AssemblyManager.ts, route.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, b5a618e feat(studio): add assembly prod…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@732ceca8912e495639b93cbbab3191548974801f": "732ceca feat(visuals): add visual manager core with AI-backed visual data" | kind=Commit | source=git | neighbors=[5d7b62d Connect scene generation pipeli…, visualEngine.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, b1c33f4 feat(studio): add project studi…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@85c678f13085b58f0265e94792bcf5abb7683110": "85c678f feat(pipeline): add retry studio action (Sprint 60)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@890ae6dd8d8adc4f79e0d408fb9e74809e01296a": "890ae6d Sprint 32 Phase 2 - Add Asset Manager" | kind=Commit | source=git | neighbors=[AssetManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@9bafa589276d06bbede4b8f7b59beadd6d3a4451": "9bafa58 feat(pipeline): add execution history foundation (Sprint 77)" | kind=Commit | source=git | neighbors=[1de9af4 feat(pipeline): add observabili…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-019.json

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
