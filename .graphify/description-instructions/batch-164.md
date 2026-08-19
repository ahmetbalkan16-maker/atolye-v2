# Node Description Batch 165 of 166

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

- "types_thumbnail_thumbnailstyle": "ThumbnailStyle" | kind=code-symbol | source=src/types/thumbnail.ts:L18 | neighbors=[thumbnail.ts]
- "types_video_videostatus": "VideoStatus" | kind=code-symbol | source=src/types/video.ts:L1 | neighbors=[video.ts]
- "types_videoassembly_videoassemblyfailure": "VideoAssemblyFailure" | kind=code-symbol | source=src/types/videoAssembly.ts:L75 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblylegacysceneinput": "VideoAssemblyLegacySceneInput" | kind=code-symbol | source=src/types/videoAssembly.ts:L3 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblymocksuccess": "VideoAssemblyMockSuccess" | kind=code-symbol | source=src/types/videoAssembly.ts:L46 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblyrealsuccess": "VideoAssemblyRealSuccess" | kind=code-symbol | source=src/types/videoAssembly.ts:L58 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblyresultbase": "VideoAssemblyResultBase" | kind=code-symbol | source=src/types/videoAssembly.ts:L41 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblysceneinput": "VideoAssemblySceneInput" | kind=code-symbol | source=src/types/videoAssembly.ts:L32 | neighbors=[videoAssembly.ts]
- "types_videoassembly_videoassemblyscenevideoinput": "VideoAssemblySceneVideoInput" | kind=code-symbol | source=src/types/videoAssembly.ts:L13 | neighbors=[videoAssembly.ts]
- "types_visual_visualstyle": "VisualStyle" | kind=code-symbol | source=src/types/visual.ts:L1 | neighbors=[visual.ts]
- "types_youtubepublish_youtubepublishstatus": "YouTubePublishStatus" | kind=code-symbol | source=src/types/youtubePublish.ts:L4 | neighbors=[youtubePublish.ts]
- "utils_mapping_getnumber": "getNumber()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L17 | neighbors=[mapping.ts]
- "utils_mapping_getoptionalstring": "getOptionalString()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L13 | neighbors=[mapping.ts]
- "utils_mapping_getstringallowempty": "getStringAllowEmpty()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L9 | neighbors=[mapping.ts]
- "utils_mapping_getstringarray": "getStringArray()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L21 | neighbors=[mapping.ts]
- "utils_mapping_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L1 | neighbors=[mapping.ts]
- "video_route_post": "POST()" | kind=code-symbol | source=app/api/video/route.ts:L7 | neighbors=[route.ts]
- "video_videodatavalidation_statuses": "statuses" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L3 | neighbors=[VideoDataValidation.ts]
- "video_videopipeline_generatevideo": "generateVideo()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L152 | neighbors=[VideoPipeline.ts]
- "video_videopipeline_generatevideoinput": "GenerateVideoInput" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L35 | neighbors=[VideoPipeline.ts]
- "video_videopipeline_image_mime_types": "IMAGE_MIME_TYPES" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L20 | neighbors=[VideoPipeline.ts]
- "video_videopipeline_scenevideogenerationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L28 | neighbors=[SceneVideoGenerationError]
- "video_videopipeline_videopipelineresult": "VideoPipelineResult" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L42 | neighbors=[VideoPipeline.ts]
- "video_videoservice_generatevideo": "generateVideo()" | kind=code-symbol | source=src/lib/video/VideoService.ts:L55 | neighbors=[VideoService.ts]
- "video_videoservice_generatevideoinput": "GenerateVideoInput" | kind=code-symbol | source=src/lib/video/VideoService.ts:L10 | neighbors=[VideoService.ts]
- "video_videoservice_videoapiresponse": "VideoApiResponse" | kind=code-symbol | source=src/lib/video/VideoService.ts:L19 | neighbors=[VideoService.ts]
- "video_videoservice_videoserviceoptions": "VideoServiceOptions" | kind=code-symbol | source=src/lib/video/VideoService.ts:L5 | neighbors=[VideoService.ts]
- "video_videoservice_videoserviceresult": "VideoServiceResult" | kind=code-symbol | source=src/lib/video/VideoService.ts:L14 | neighbors=[VideoService.ts]
- "visuals_animationpromptengine_animationpromptengine_createfallbackprompt": ".createFallbackPrompt()" | kind=code-symbol | source=src/lib/visuals/AnimationPromptEngine.ts:L10 | neighbors=[AnimationPromptEngine]
- "visuals_animationpromptengine_animationpromptengine_normalizeprompt": ".normalizePrompt()" | kind=code-symbol | source=src/lib/visuals/AnimationPromptEngine.ts:L20 | neighbors=[AnimationPromptEngine]
- "visuals_page_visualspage": "VisualsPage()" | kind=code-symbol | source=app/visuals/page.tsx:L6 | neighbors=[page.tsx]
- "visuals_thumbnailconceptengine_thumbnailconceptengine_createfallbackconcept": ".createFallbackConcept()" | kind=code-symbol | source=src/lib/visuals/ThumbnailConceptEngine.ts:L5 | neighbors=[ThumbnailConceptEngine]
- "visuals_thumbnailconceptengine_thumbnailconceptengine_normalizeconcept": ".normalizeConcept()" | kind=code-symbol | source=src/lib/visuals/ThumbnailConceptEngine.ts:L17 | neighbors=[ThumbnailConceptEngine]
- "visuals_visualengine_sceneinput": "SceneInput" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L9 | neighbors=[VisualEngine.ts]
- "visuals_visualengine_visualengine_generateprompt": ".generatePrompt()" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L28 | neighbors=[VisualEngine]
- "visuals_visualengine_visualengine_generateprompts": ".generatePrompts()" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L70 | neighbors=[VisualEngine]
- "visuals_visualengine_visualprompt": "VisualPrompt" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L19 | neighbors=[VisualEngine.ts]
- "visuals_visualengine_visualstyle": "VisualStyle" | kind=code-symbol | source=src/lib/visuals/VisualEngine.ts:L1 | neighbors=[VisualEngine.ts]
- "visuals_visualmanager_visualmanager_createfallbackvisualscene": ".createFallbackVisualScene()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L124 | neighbors=[VisualManager]
- "visuals_visualmanager_visualmanager_normalizesearchkeywords": ".normalizeSearchKeywords()" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L175 | neighbors=[VisualManager]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-164.json

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
