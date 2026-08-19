# Node Description Batch 122 of 166

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

- "types_thumbnail_thumbnailgenerationmode": "ThumbnailGenerationMode" | kind=code-symbol | source=src/types/thumbnail.ts:L16 | neighbors=[ThumbnailProvider.ts, thumbnail.ts]
- "types_thumbnail_thumbnailstatus": "ThumbnailStatus" | kind=code-symbol | source=src/types/thumbnail.ts:L1 | neighbors=[ThumbnailProvider.ts, thumbnail.ts]
- "types_video_videogenerationmode": "VideoGenerationMode" | kind=code-symbol | source=src/types/video.ts:L11 | neighbors=[VideoProvider.ts, video.ts]
- "types_youtubepublish_youtubepublishfailedrecord": "YouTubePublishFailedRecord" | kind=code-symbol | source=src/types/youtubePublish.ts:L106 | neighbors=[youtubePublish.ts, YouTubePublishRecordBase]
- "types_youtubepublish_youtubepublishmetadata": "YouTubePublishMetadata" | kind=code-symbol | source=src/types/youtubePublish.ts:L6 | neighbors=[YouTubePublishValidation.ts, youtubePublish.ts]
- "utils_json_extractjson": "extractJson()" | kind=code-symbol | source=src/lib/ai/utils/json.ts:L1 | neighbors=[json.ts, parseAIJsonResponse()]
- "utils_json_safejsonparse": "safeJsonParse()" | kind=code-symbol | source=src/lib/ai/utils/json.ts:L19 | neighbors=[json.ts, parseAIJsonResponse()]
- "utils_mapping_getcreatedat": "getCreatedAt()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L30 | neighbors=[mapping.ts, getString()]
- "utils_mapping_getstring": "getString()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L5 | neighbors=[mapping.ts, getCreatedAt()]
- "video_videodatavalidation_finitepositive": "finitePositive()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L136 | neighbors=[VideoDataValidation.ts, isSceneVideoScene()]
- "video_videodatavalidation_hasscenevideofields": "hasSceneVideoFields()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L119 | neighbors=[VideoDataValidation.ts, isCompatibleVideoData()]
- "video_videodatavalidation_safeprovider": "safeProvider()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L144 | neighbors=[VideoDataValidation.ts, isSceneVideoScene()]
- "video_videopipeline_prepareinputs": "prepareInputs()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L156 | neighbors=[VideoPipeline.ts, .generateVideo()]
- "video_videopipeline_validateimage": "validateImage()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L203 | neighbors=[VideoPipeline.ts, SceneVideoGenerationError]
- "video_videopipeline_validatemotionasset": "validateMotionAsset()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L241 | neighbors=[VideoPipeline.ts, SceneVideoGenerationError]
- "video_videopipeline_validdate": "validDate()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L394 | neighbors=[VideoPipeline.ts, validateResult()]
- "video_videoservice_isassets": "isAssets()" | kind=code-symbol | source=src/lib/video/VideoService.ts:L61 | neighbors=[VideoService.ts, .generateVideo()]
- "video_videoservice_videoservice_generatevideo": ".generateVideo()" | kind=code-symbol | source=src/lib/video/VideoService.ts:L29 | neighbors=[VideoService, isAssets()]
- "visuals_route_isscenedata": "isSceneData()" | kind=code-symbol | source=app/api/visuals/route.ts:L95 | neighbors=[route.ts, normalizeSceneData()]
- "visuals_route_post": "POST()" | kind=code-symbol | source=app/api/visuals/route.ts:L6 | neighbors=[route.ts, normalizeSceneData()]
- "visuals_visualmanager_visualmanager_mapthumbnail": ".mapThumbnail()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L184 | neighbors=[VisualManager, .generateVisualData()]
- "visuals_visualmanager_visualmanager_mapvisualscenes": ".mapVisualScenes()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L143 | neighbors=[VisualManager, .generateVisualData()]
- "youtube_route_safeslug": "safeSlug()" | kind=code-symbol | source=app/api/youtube/route.ts:L75 | neighbors=[route.ts, POST()]
- "youtube_youtubepackagepipeline_normalizemodel": "normalizeModel()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L289 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagepipeline_requirefinalvideoasset": "requireFinalVideoAsset()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L135 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagepipeline_requirethumbnailasset": "requireThumbnailAsset()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L192 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagepipeline_requiretimestamp": "requireTimestamp()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L298 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagepipeline_requirevideoduration": "requireVideoDuration()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L264 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagepipeline_validateproject": "validateProject()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L279 | neighbors=[YouTubePackagePipeline.ts, .generatePackage()]
- "youtube_youtubepackagevalidation_isprovidername": "isProviderName()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L232 | neighbors=[YouTubePackageValidation.ts, validateYouTubePublishingPackage()]
- "youtube_youtubepackagevalidation_normalizechapters": "normalizeChapters()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L174 | neighbors=[YouTubePackageValidation.ts, normalizeYouTubePackageDraft()]
- "youtube_youtubepackagevalidation_normalizetext": "normalizeText()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L207 | neighbors=[YouTubePackageValidation.ts, normalizeYouTubePackageDraft()]
- "youtube_youtubepackagevalidation_samechapters": "sameChapters()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L244 | neighbors=[YouTubePackageValidation.ts, validateYouTubePublishingPackage()]
- "youtube_youtubepackagevalidation_samestrings": "sameStrings()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L236 | neighbors=[YouTubePackageValidation.ts, validateYouTubePublishingPackage()]
- "ai_aimanager_aimanager_runresearch": ".runResearch()" | kind=code-symbol | source=src/lib/ai/AIManager.ts:L30 | neighbors=[AIManager]
- "ai_aimanager_aimanager_runscenes": ".runScenes()" | kind=code-symbol | source=src/lib/ai/AIManager.ts:L285 | neighbors=[AIManager]
- "ai_aimanager_aimanager_runscript": ".runScript()" | kind=code-symbol | source=src/lib/ai/AIManager.ts:L123 | neighbors=[AIManager]
- "ai_aiproviderconfig_getconfiguredprovider": "getConfiguredProvider()" | kind=code-symbol | source=src/lib/ai/AIProviderConfig.ts:L12 | neighbors=[AIProviderConfig.ts]
- "ai_airesponseerror_airesponseerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L17 | neighbors=[AIResponseError]
- "ai_airesponseerror_isobservedtype": "isObservedType()" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L61 | neighbors=[AIResponseError.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-121.json

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
