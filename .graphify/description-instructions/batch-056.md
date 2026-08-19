# Node Description Batch 57 of 166

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

- "projects_projectprogress_getcompletionpercentage": "getCompletionPercentage()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L241 | neighbors=[projectProgress.ts, calculateCompletionPercentage(), getCompletedStagesFromManifest(), getCompletionPercentageBySlug()]
- "projects_projectreader_projectreader_listprojects": ".listProjects()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L70 | neighbors=[ProjectReader, isNodeError(), .getProjectsRoot(), .readJSONState()]
- "projects_projectwriter_projectwriter_writejsonatomically": ".writeJSONAtomically()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L57 | neighbors=[ProjectWriter, .writeJSON(), .ensureSafeProjectFolder(), requireSafeJsonFileName()]
- "projects_projectwriter_requiresafejsonfilename": "requireSafeJsonFileName()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L128 | neighbors=[ProjectWriter.ts, .removeJSON(), .writeJSONAtomically(), .writeJSONOnce()]
- "projects_visualmanager_visualmanager_ensuredatadir": ".ensureDataDir()" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L8 | neighbors=[VisualManager, .deleteVisualData(), .getVisualData(), .saveVisualData()]
- "projects_visualmanager_visualmanager_getfilepath": ".getFilePath()" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L14 | neighbors=[VisualManager, .deleteVisualData(), .getVisualData(), .saveVisualData()]
- "prompts_animationpromptgenerator_animationpromptgenerator_generateanimationscene": ".generateAnimationScene()" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L94 | neighbors=[AnimationPromptGenerator, .generateAnimationData(), .createFallbackAnimationScene(), .generateAnimationSceneData()]
- "prompts_script": "script.ts" | kind=code-symbol | source=src/lib/ai/prompts/script.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, 91ba270 Atölye V2 checkpoint - pipeline…, createScriptPrompt(), scriptStep.ts]
- "prompts_visualprompt": "visualPrompt.ts" | kind=code-symbol | source=src/lib/visuals/prompts/visualPrompt.ts:L1 | neighbors=[732ceca feat(visuals): add visual manag…, createVisualPrompt(), scene.ts, SceneData]
- "providers_audioprovider_configuredaudioprovider": "ConfiguredAudioProvider" | kind=code-symbol | source=src/lib/audio/providers/AudioProvider.ts:L24 | neighbors=[AudioProvider.ts, MockAudioProvider.ts, OpenAIAudioProvider.ts, smoke-production-audio-asset-wiring.ts]
- "providers_claudeprovider_claudeprovider": "ClaudeProvider" | kind=code-symbol | source=src/lib/ai/providers/ClaudeProvider.ts:L3 | neighbors=[ClaudeProvider.ts, AIProvider, .generate(), index.ts]
- "providers_exportprovider_exportprovider": "ExportProvider" | kind=code-symbol | source=src/lib/export/providers/ExportProvider.ts:L37 | neighbors=[ExportEngine.ts, ExportProviderRouter.ts, ExportProvider.ts, MockExportProvider.ts]
- "providers_ffmpegvideoassemblyprovider_buildffmpegargs": "buildFFmpegArgs()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L434 | neighbors=[FFmpegVideoAssemblyProvider.ts, buildCopyConcatArgs(), buildRetimedConcatArgs(), .assemble()]
- "providers_ffmpegvideoassemblyprovider_isframerate": "isFrameRate()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L777 | neighbors=[FFmpegVideoAssemblyProvider.ts, parseRational(), validateProbe(), validateSceneInputProbe()]
- "providers_ffmpegvideoassemblyprovider_validateinput": "validateInput()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L341 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble(), isSafeInputPath(), nonEmpty()]
- "providers_geminiprovider_geminiprovider": "GeminiProvider" | kind=code-symbol | source=src/lib/ai/providers/GeminiProvider.ts:L3 | neighbors=[GeminiProvider.ts, AIProvider, .generate(), index.ts]
- "providers_imageproviderconfig_getopenaiimageproviderconfig": "getOpenAIImageProviderConfig()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L85 | neighbors=[ProductionReadinessService.ts, ImageProviderConfig.ts, integerValue(), OpenAIImageProvider.ts]
- "providers_imageproviderconfig_integervalue": "integerValue()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L167 | neighbors=[ImageProviderConfig.ts, getOpenAIImageProviderConfig(), getRealImageProviderConfig(), ImageProviderConfigurationError]
- "providers_mockyoutubeprovider_createmockyoutubedraft": "createMockYouTubeDraft()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L33 | neighbors=[MockYouTubeProvider.ts, createChapters(), unique(), .generatePublishingPackage()]
- "providers_openaithumbnailprovider_openaithumbnailprovider_generatethumbnailasset": ".generateThumbnailAsset()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L57 | neighbors=[OpenAIThumbnailProvider, decodeStrictBase64(), failure(), readBoundedJson()]
- "providers_thumbnailprovider_configuredthumbnailprovider": "ConfiguredThumbnailProvider" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L90 | neighbors=[MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts, ThumbnailProvider.ts, smoke-production-thumbnail-pipeline.ts]
- "providers_videoprovider_configuredvideoprovider": "ConfiguredVideoProvider" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L62 | neighbors=[FFmpegSceneVideoProvider.ts, MockVideoProvider.ts, VideoProvider.ts, smoke-sprint-129-41-completed-stage-reg…]
- "providers_videoprovider_videogenerationresult": "VideoGenerationResult" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L44 | neighbors=[FFmpegSceneVideoProvider.ts, MockVideoProvider.ts, VideoProvider.ts, smoke-production-scene-video-rendering.…]
- "providers_videoprovider_videoscenegenerationsuccess": "VideoSceneGenerationSuccess" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L24 | neighbors=[FFmpegSceneVideoProvider.ts, VideoProvider.ts, smoke-production-scene-video-rendering.…, VideoPipeline.ts]
- "providers_youtubepublishprovider_youtube_reconciliation_error": "YOUTUBE_RECONCILIATION_ERROR" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubePublishProvider.ts:L11 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, smoke-production-publish-reconciliation…]
- "publish_youtubepublishpipeline_normalizeid": "normalizeId()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L439 | neighbors=[YouTubePublishPipeline.ts, normalizeRemoteId(), reconcilePublishingIntent(), .publishStoredPackage()]
- "publish_youtubepublishpipeline_normalizeremoteid": "normalizeRemoteId()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L447 | neighbors=[YouTubePublishPipeline.ts, normalizeId(), reconcilePublishingIntent(), .publishStoredPackage()]
- "publish_youtubepublishpipeline_reconcilepublishingintent": "reconcilePublishingIntent()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L308 | neighbors=[YouTubePublishPipeline.ts, normalizeId(), normalizeRemoteId(), .publishStoredPackage()]
- "publish_youtubepublishpipeline_youtubepublisherror": "YouTubePublishError" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L32 | neighbors=[PipelineStageExecutor.ts, YouTubePublishPipeline.ts, .constructor(), .publishStoredPackage()]
- "publish_youtubepublishproviderconfig_resolveyoutubepublishprovidername": "resolveYouTubePublishProviderName()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderConfig.ts:L23 | neighbors=[YouTubePublishProviderConfig.ts, YouTubePublishProviderConfigurationError, YouTubePublishProviderRouter.ts, smoke-production-youtube-publish-pipeli…]
- "publish_youtubepublishvalidation_isprovider": "isProvider()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L239 | neighbors=[YouTubePublishValidation.ts, createYouTubeReconciliationMarker(), validateYouTubePublishReconciliationRes…, validateYouTubePublishRecord()]
- "roadmap_sprint_115": "Sprint 115 - Production Video Assembly Activation" | kind=entity | source=ROADMAP.md:2163 | neighbors=[Sprint 114 - Production Narration Audio…, Sprint 42 - Video Engine Foundation, Sprint 44 - Assembly Engine Foundation, Sprint 116 - Animation Motion Plan Prod…]
- "roadmap_sprint_127": "Sprint 127 - Production Animation Provider Activation" | kind=entity | source=ROADMAP.md:2440 | neighbors=[Sprint 126 - Real Production Acceptance…, Sprint 41 - Animation Scene-Level Regen…, Sprint 128.1 - Production Acceptance P0…, Sprint 130 - Wikimedia Commons Real Pho…]
- "roadmap_sprint_128_2": "Sprint 128.2 - Production Acceptance P1 Hardening" | kind=entity | source=ROADMAP.md:2490 | neighbors=[Sprint 128.1 - Production Acceptance P0…, Sprint 129 - Production Environment Bin…, Sprint 129.19 - Visuals Structured Outp…, Sprint 129.24 - Existing Acceptance Mar…]
- "roadmap_sprint_129_19": "Sprint 129.19 - Visuals Structured Output and Application-Owned Timestamp Harde…" | kind=entity | source=ROADMAP.md:862 | neighbors=[Sprint 128.2 - Production Acceptance P1…, Sprint 129.9 - Failed-Stage Resume Reco…, Sprint 129.20 - Visuals Truncation Prop…, Sprint 129.22 - Animation Structured Ou…]
- "roadmap_sprint_129_36": "Sprint 129.36 - Explicit One-Time Retry Budget Extension Authority" | kind=entity | source=ROADMAP.md:369 | neighbors=[Production Acceptance Execution Gate, Sprint 129.35 - Legacy Terminal Lineage…, Sprint 129.37 - Assembly AI Token Budge…, Sprint 129.38 - Retry-Budget Settled-Re…]
- "roadmap_sprint_129_37": "Sprint 129.37 - Assembly AI Token Budget and Truncation Remediation" | kind=entity | source=ROADMAP.md:334 | neighbors=[Production Acceptance Execution Gate, Sprint 129.20 - Visuals Truncation Prop…, Sprint 129.36 - Explicit One-Time Retry…, Sprint 129.38 - Retry-Budget Settled-Re…]
- "roadmap_sprint_129_38": "Sprint 129.38 - Retry-Budget Settled-Receipt Cross-Stage Replay Remediation" | kind=entity | source=ROADMAP.md:286 | neighbors=[Production Acceptance Execution Gate, Sprint 129.36 - Explicit One-Time Retry…, Sprint 129.37 - Assembly AI Token Budge…, Sprint 129.39 - Canonical Stage-Bounded…]
- "roadmap_sprint_130": "Sprint 130 - Wikimedia Commons Real Photo Source for Visuals" | kind=entity | source=ROADMAP.md:52 | neighbors=[ADR-019: Single 'real' Image Provider w…, Sprint 127 - Production Animation Provi…, Sprint 130.1 - Real Photo Source Qualit…, Sprint 131+ - Additional Real Photo Sou…]
- "router_airouter_providername": "ProviderName" | kind=code-symbol | source=src/lib/ai/router/AIRouter.ts:L7 | neighbors=[AIProviderConfig.ts, ProductionReadinessService.ts, AIRouter.ts, aiUsage.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-056.json

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
