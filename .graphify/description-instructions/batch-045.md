# Node Description Batch 46 of 166

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

- "projects_visualmanager": "VisualManager.ts" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, DATA_DIR, VisualManager, visual.ts, VisualData]
- "prompts_audioprompt": "audioPrompt.ts" | kind=code-symbol | source=src/lib/audio/prompts/audioPrompt.ts:L1 | neighbors=[AudioManager.ts, 528dcf8 feat(audio): add audio narratio…, createAudioPrompt(), script.ts, ScriptData]
- "prompts_youtubepackageprompt": "youtubePackagePrompt.ts" | kind=code-symbol | source=src/lib/youtube/prompts/youtubePackagePrompt.ts:L1 | neighbors=[ca97d40 Sprint 121: Add production YouT…, createYouTubePackagePrompt(), YouTubeProvider.ts, YouTubeGenerationInput, OpenAIYouTubeProvider.ts]
- "providers_aiprovider_configuredaiprovider": "ConfiguredAIProvider" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L26 | neighbors=[AIProvider.ts, MockAIProvider.ts, OpenAIProvider.ts, OpenRouterProvider.ts, smoke-sprint-129-39-stage-bounded-resum…]
- "providers_animationproviderconfig_animationproviderconfigurationerror": "AnimationProviderConfigurationError" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L4 | neighbors=[AnimationProviderConfig.ts, .constructor(), getOpenAIAnimationProviderConfig(), integer(), resolveAnimationProviderName()]
- "providers_animationproviderconfig_openaianimationproviderconfig": "OpenAIAnimationProviderConfig" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L14 | neighbors=[AnimationProviderConfig.ts, OpenAIAnimationProvider.ts, smoke-production-animation-provider.ts, smoke-sprint-129-21-animation-failure-d…, smoke-sprint-129-22-animation-structure…]
- "providers_animationproviderconfig_resolveanimationprovidername": "resolveAnimationProviderName()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L25 | neighbors=[ProductionReadinessService.ts, AnimationProviderConfig.ts, AnimationProviderConfigurationError, AnimationProviderRouter.ts, smoke-animation-motion-plan-contract.ts]
- "providers_audioproviderconfig_resolveaudioprovidername": "resolveAudioProviderName()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L38 | neighbors=[ProductionReadinessService.ts, AudioProviderConfig.ts, AudioProviderConfigurationError, AudioProviderRouter.ts, smoke-production-audio-asset-wiring.ts]
- "providers_claudeprovider": "ClaudeProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/ClaudeProvider.ts:L1 | neighbors=[6c1ae5a Sprint 15 - Multi AI Provider A…, AIProvider.ts, AIProvider, ClaudeProvider, index.ts]
- "providers_ffmpegvideoassemblyprovider_processrunresult": "ProcessRunResult" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L41 | neighbors=[FFmpegSceneVideoProvider.ts, FFmpegVideoAssemblyProvider.ts, smoke-assembly-scene-video-consumption.…, smoke-production-video-assembly-wiring.…, smoke-sprint-128-1-production-acceptanc…]
- "providers_ffmpegvideoassemblyprovider_validatesceneinputprobe": "validateSceneInputProbe()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L719 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble(), durationTolerance(), isFrameRate(), isPositiveRational()]
- "providers_geminiprovider": "GeminiProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/GeminiProvider.ts:L1 | neighbors=[6c1ae5a Sprint 15 - Multi AI Provider A…, AIProvider.ts, AIProvider, GeminiProvider, index.ts]
- "providers_imageproviderconfig_imageproviderconfigurationerror": "ImageProviderConfigurationError" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L8 | neighbors=[ImageProviderConfig.ts, .constructor(), integerValue(), resolveImageProviderName(), smoke-production-visual-asset-wiring.ts]
- "providers_imageproviderconfig_resolveimageprovidername": "resolveImageProviderName()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L66 | neighbors=[ProductionReadinessService.ts, ImageProviderConfig.ts, ImageProviderConfigurationError, ImageProviderRouter.ts, smoke-production-visual-asset-wiring.ts]
- "providers_mockexportprovider_mockexportprovider": "MockExportProvider" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L13 | neighbors=[ExportEngine.ts, ExportProviderRouter.ts, MockExportProvider.ts, ExportProvider, .generateExportPackage()]
- "providers_mockthumbnailprovider_buildvariants": "buildVariants()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L123 | neighbors=[MockThumbnailProvider.ts, buildSourceLine(), createOverlayText(), findStrongestScene(), createMockThumbnailData()]
- "providers_openai": "openai.ts" | kind=code-symbol | source=src/lib/ai/providers/openai.ts:L1 | neighbors=[6c1ae5a Sprint 15 - Multi AI Provider A…, 91ba270 Atölye V2 checkpoint - pipeline…, a319525 Setup ProjectManager V2 archite…, OpenAIProvider.ts, OpenAIProvider]
- "providers_openaianimationprovider_diagnostic": "diagnostic()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L401 | neighbors=[OpenAIAnimationProvider.ts, validSceneId(), invalid(), .request(), timeoutFailure()]
- "providers_openaianimationprovider_readboundedjson": "readBoundedJson()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L443 | neighbors=[OpenAIAnimationProvider.ts, .request(), cancelBody(), readWithAbort(), ResponseValidationError]
- "providers_openaiaudioprovider_readboundedbody": "readBoundedBody()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L217 | neighbors=[OpenAIAudioProvider.ts, .generateAudio(), cancelBody(), parseContentLength(), readWithAbort()]
- "providers_openaiimageprovider_openaiimageprovider_generateimage": ".generateImage()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L37 | neighbors=[OpenAIImageProvider, createErrorResult(), createPrompt(), decodeStrictBase64(), readBoundedJson()]
- "providers_openrouterprovider_openrouterprovider": "OpenRouterProvider" | kind=code-symbol | source=src/lib/ai/providers/OpenRouterProvider.ts:L4 | neighbors=[index.ts, OpenRouterProvider.ts, ConfiguredAIProvider, .createImmutableAiDispatchAdapter(), .generate()]
- "providers_thumbnailprovider_thumbnailassetgenerationresult": "ThumbnailAssetGenerationResult" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L74 | neighbors=[MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts, ThumbnailProvider.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailAssetPipeline.ts]
- "providers_thumbnailprovider_thumbnailgenerationinput": "ThumbnailGenerationInput" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L13 | neighbors=[MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts, ThumbnailProvider.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailEngine.ts]
- "providers_videoassemblyproviderconfig_resolvevideoassemblyprovidername": "resolveVideoAssemblyProviderName()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L29 | neighbors=[ProductionReadinessService.ts, VideoAssemblyProviderConfig.ts, VideoAssemblyConfigurationError, VideoAssemblyProviderRouter.ts, smoke-production-video-assembly-wiring.…]
- "providers_videoprovider_videogenerationinput": "VideoGenerationInput" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L18 | neighbors=[FFmpegSceneVideoProvider.ts, MockVideoProvider.ts, VideoProvider.ts, smoke-production-scene-video-rendering.…, smoke-sprint-129-41-completed-stage-reg…]
- "providers_videoproviderconfig_resolvevideoprovidername": "resolveVideoProviderName()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L25 | neighbors=[ProductionReadinessService.ts, VideoProviderConfig.ts, VideoProviderConfigurationError, VideoProviderRouter.ts, smoke-production-scene-video-rendering.…]
- "providers_youtubeprovider_youtubegenerationresult": "YouTubeGenerationResult" | kind=code-symbol | source=src/lib/youtube/providers/YouTubeProvider.ts:L23 | neighbors=[MockYouTubeProvider.ts, OpenAIYouTubeProvider.ts, YouTubeProvider.ts, smoke-production-youtube-package-pipeli…, YouTubeEngine.ts]
- "providers_youtubepublishprovider_youtube_publish_error": "YOUTUBE_PUBLISH_ERROR" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubePublishProvider.ts:L10 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, smoke-production-end-to-end-stabilizati…, smoke-production-youtube-publish-pipeli…]
- "publish_youtubepublishproviderconfig_youtubepublishproviderconfigurationerror": "YouTubePublishProviderConfigurationError" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderConfig.ts:L3 | neighbors=[YouTubePublishProviderConfig.ts, resolveYouTubePublishProviderName(), .constructor(), YouTubePublishProviderRouter.ts, smoke-production-youtube-publish-pipeli…]
- "publish_youtubepublishvalidation_saferemoteid": "safeRemoteId()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L231 | neighbors=[YouTubePublishValidation.ts, createYouTubeReconciliationMarker(), safeText(), validateYouTubePublishReconciliationRes…, validateYouTubePublishRecord()]
- "publish_youtubepublishvalidation_safetext": "safeText()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L226 | neighbors=[YouTubePublishValidation.ts, createYouTubeReconciliationMarker(), safeRemoteId(), validateYouTubePublishReconciliationRes…, validateYouTubePublishRecord()]
- "retry_route_post": "POST()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L32 | neighbors=[route.ts, isPipelineStage(), isSafeSlug(), readRetryBody(), smoke-pipeline-state-error-contract.ts]
- "runtime_productionruntimecompositionroot_getproductionruntimestatus": "getProductionRuntimeStatus()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L52 | neighbors=[route.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, ProductionRuntimeCompositionRoot.ts, smoke-production-runtime-status.ts]
- "runtime_productionruntimeoperationcontext_createauthorityidentity": "createAuthorityIdentity()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L145 | neighbors=[ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationContext…, digest(), normalizedPath(), createProductionRuntimeOperationContext…]
- "runtime_runtimeoperationscope_getactiveproductionruntimeoperationcontext": "getActiveProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L59 | neighbors=[ProductionRuntimeOperationContext.ts, RuntimeOperationScope.ts, activeStore(), requireActiveProductionRuntimeOperation…, requireExactActiveProductionRuntimeOper…]
- "runtime_runtimestoragepaths_asserttrustedruntimestoragecontext": "assertTrustedRuntimeStorageContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L186 | neighbors=[ProductionRuntimeOperationContext.ts, RuntimeStoragePaths.ts, RuntimeStorageError, createRuntimeStorageContext(), resolveRuntimeStorageContext()]
- "runtime_runtimestoragepaths_ispathinsideorequal": "isPathInsideOrEqual()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L729 | neighbors=[RuntimeStoragePaths.ts, createRuntimeStorageContext(), ensureSafeDirectory(), isOutsideRelative(), samePath()]
- "runtime_runtimestoragepaths_requiremachinesegment": "requireMachineSegment()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L691 | neighbors=[RuntimeStoragePaths.ts, getMachineRuntimeRoot(), isPortableRuntimePathSegment(), requireSafeSegment(), RuntimeStorageError]
- "runtime_runtimestoragepaths_requirematchingauthorityclaim": "requireMatchingAuthorityClaim()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L580 | neighbors=[RuntimeStoragePaths.ts, assertAuthorityClaimCompatible(), establishAuthorityClaim(), isRecord(), RuntimeStorageError]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-045.json

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
