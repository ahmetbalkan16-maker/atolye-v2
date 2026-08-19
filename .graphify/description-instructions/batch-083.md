# Node Description Batch 84 of 166

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

- "types_thumbnail_thumbnailvariant": "ThumbnailVariant" | kind=code-symbol | source=src/types/thumbnail.ts:L26 | neighbors=[MockThumbnailProvider.ts, ThumbnailManager.ts, thumbnail.ts]
- "types_video_videoprovidername": "VideoProviderName" | kind=code-symbol | source=src/types/video.ts:L7 | neighbors=[VideoProvider.ts, VideoProviderConfig.ts, video.ts]
- "types_videoassembly_videoassemblyprovidername": "VideoAssemblyProviderName" | kind=code-symbol | source=src/types/videoAssembly.ts:L1 | neighbors=[VideoAssemblyProvider.ts, VideoAssemblyProviderConfig.ts, videoAssembly.ts]
- "types_visual_visualprompt": "VisualPrompt" | kind=code-symbol | source=src/types/visual.ts:L9 | neighbors=[visualEngine.ts, visual.ts, VisualManager.ts]
- "types_youtube_youtubechapter": "YouTubeChapter" | kind=code-symbol | source=src/types/youtube.ts:L3 | neighbors=[MockYouTubeProvider.ts, youtube.ts, YouTubePackageValidation.ts]
- "types_youtubepublish_youtubepublishedrecord": "YouTubePublishedRecord" | kind=code-symbol | source=src/types/youtubePublish.ts:L97 | neighbors=[smoke-production-publish-reconciliation…, youtubePublish.ts, YouTubePublishRecordBase]
- "utils_json_parseaijsonresponse": "parseAIJsonResponse()" | kind=code-symbol | source=src/lib/ai/utils/json.ts:L27 | neighbors=[json.ts, extractJson(), safeJsonParse()]
- "video_videodatavalidation_islegacyscene": "isLegacyScene()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L108 | neighbors=[VideoDataValidation.ts, isCompatibleVideoData(), isSceneVideoScene()]
- "video_videodatavalidation_isscenevideodata": "isSceneVideoData()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L37 | neighbors=[VideoAssemblyManager.ts, VideoDataValidation.ts, isCompatibleVideoData()]
- "video_videodatavalidation_nonempty": "nonEmpty()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L140 | neighbors=[VideoDataValidation.ts, isCompatibleVideoData(), isSceneVideoScene()]
- "video_videopipeline_requireprovidername": "requireProviderName()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L277 | neighbors=[VideoPipeline.ts, SceneVideoGenerationError, .generateVideo()]
- "video_videoservice_videoservice": "VideoService" | kind=code-symbol | source=src/lib/video/VideoService.ts:L28 | neighbors=[VideoPanel.tsx, VideoService.ts, .generateVideo()]
- "vision_doc": "VISION.md" | kind=entity | source=VISION.md | neighbors=[ATOLYE_CONTEXT.md, ATOLYE_MASTER_ROADMAP.md, PROJECT_PHILOSOPHY.md]
- "visuals_page": "page.tsx" | kind=code-symbol | source=app/visuals/page.tsx:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, index.ts, VisualsPage()]
- "visuals_route_normalizescenedata": "normalizeSceneData()" | kind=code-symbol | source=app/api/visuals/route.ts:L50 | neighbors=[route.ts, isSceneData(), POST()]
- "visuals_visualengine_visualengine": "VisualEngine" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L27 | neighbors=[VisualEngine.ts, .generatePrompt(), .generatePrompts()]
- "visuals_visualmanager_visualmanager_createfallbackvisualdata": ".createFallbackVisualData()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L104 | neighbors=[VisualManager, .toLegacyPrompts(), .generateVisualData()]
- "visuals_visualmanager_visualmanager_tolegacyprompts": ".toLegacyPrompts()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L191 | neighbors=[VisualManager, .createFallbackVisualData(), .generateVisualData()]
- "visuals_visualpromptengine_visualpromptengine": "VisualPromptEngine" | kind=code-symbol | source=src/lib/visuals/VisualPromptEngine.ts:L3 | neighbors=[VisualManager.ts, VisualPromptEngine.ts, .createPrompt()]
- "youtube_route_failure": "failure()" | kind=code-symbol | source=app/api/youtube/route.ts:L81 | neighbors=[route.ts, response(), POST()]
- "youtube_route_response": "response()" | kind=code-symbol | source=app/api/youtube/route.ts:L88 | neighbors=[route.ts, failure(), POST()]
- "youtube_youtubepackagepipeline_youtubepackagegenerationerror": "YouTubePackageGenerationError" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L23 | neighbors=[YouTubePackagePipeline.ts, .constructor(), .generatePackage()]
- "youtube_youtubepackagevalidation_deduplicate": "deduplicate()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L215 | neighbors=[YouTubePackageValidation.ts, normalizeHashtags(), normalizeTags()]
- "youtube_youtubepackagevalidation_normalizehashtags": "normalizeHashtags()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L155 | neighbors=[YouTubePackageValidation.ts, deduplicate(), normalizeYouTubePackageDraft()]
- "youtube_youtubepackagevalidation_normalizetags": "normalizeTags()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L146 | neighbors=[YouTubePackageValidation.ts, deduplicate(), normalizeYouTubePackageDraft()]
- "youtube_youtubepackagevalidation_requirerecord": "requireRecord()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L225 | neighbors=[YouTubePackageValidation.ts, normalizeYouTubePackageDraft(), validateYouTubePublishingPackage()]
- "youtube_youtubeproviderconfig_youtubeproviderconfig": "YouTubeProviderConfig" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderConfig.ts:L16 | neighbors=[ProductionReadinessService.ts, OpenAIYouTubeProvider.ts, YouTubeProviderConfig.ts]
- "ai_airesponseerror_airesponseerrorcode": "AIResponseErrorCode" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L7 | neighbors=[AIResponseError.ts, runObservedAIRequest.ts]
- "ai_aiusagemanager_aiusagemanager_getusagelog": ".getUsageLog()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L10 | neighbors=[AIUsageManager, .readUsageLog()]
- "ai_aiusagemanager_aiusagemanager_isproductionstep": ".isProductionStep()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L93 | neighbors=[AIUsageManager, .updateManifestUsage()]
- "ai_aiusagemanager_aiusagemanager_isusagelog": ".isUsageLog()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L51 | neighbors=[AIUsageManager, .readUsageLog()]
- "ai_aiusagemanager_aiusagemanager_maprecordtopackageusage": ".mapRecordToPackageUsage()" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L75 | neighbors=[AIUsageManager, .updateManifestUsage()]
- "ai_audioaiconfig_audiotokenbudget": "audioTokenBudget" | kind=code-symbol | source=src/lib/ai/AudioAIConfig.ts:L1 | neighbors=[AudioAIConfig.ts, smoke-sprint-129-26-audio-truncation-bu…]
- "ai_client_openai": "openai" | kind=code-symbol | source=src/lib/ai/client.ts:L53 | neighbors=[client.ts, OpenAIProvider.ts]
- "ai_researchaiconfig_researchtokenbudget": "researchTokenBudget" | kind=code-symbol | source=src/lib/ai/ResearchAIConfig.ts:L1 | neighbors=[ResearchAIConfig.ts, smoke-sprint-129-7-research-structured-…]
- "ai_researchstructuredoutput_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L195 | neighbors=[ResearchStructuredOutput.ts, validateProviderResearch()]
- "ai_runobservedairequest_getmodelname": "getModelName()" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L114 | neighbors=[runObservedAIRequest.ts, runObservedAIRequest()]
- "ai_runobservedairequest_normalizeprovideroutput": "normalizeProviderOutput()" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L101 | neighbors=[runObservedAIRequest.ts, runObservedAIRequest()]
- "ai_scenestructuredoutput_exactfields": "exactFields()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L174 | neighbors=[SceneStructuredOutput.ts, validateProviderScenes()]
- "ai_scenestructuredoutput_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L198 | neighbors=[SceneStructuredOutput.ts, validateProviderScenes()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-083.json

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
