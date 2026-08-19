# Node Description Batch 74 of 166

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

- "projects_projectreader_projectreader_getprojectfolder": ".getProjectFolder()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L16 | neighbors=[ProjectReader, .readJSON(), .readJSONState()]
- "projects_projectreader_projectreader_readjson": ".readJSON()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L21 | neighbors=[ProjectReader, .getProjectFolder(), requireSafeJsonFileName()]
- "projects_projectreader_requiresafejsonfilename": "requireSafeJsonFileName()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L103 | neighbors=[ProjectReader.ts, .readJSON(), .readJSONState()]
- "projects_projectwriter_projectwriter_removejson": ".removeJSON()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L97 | neighbors=[ProjectWriter, .ensureSafeProjectFolder(), requireSafeJsonFileName()]
- "projects_projectwriter_projectwriter_writejsononce": ".writeJSONOnce()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L33 | neighbors=[ProjectWriter, .ensureSafeProjectFolder(), requireSafeJsonFileName()]
- "projects_visualmanager_visualmanager_deletevisualdata": ".deleteVisualData()" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L42 | neighbors=[VisualManager, .ensureDataDir(), .getFilePath()]
- "projects_visualmanager_visualmanager_getvisualdata": ".getVisualData()" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L28 | neighbors=[VisualManager, .ensureDataDir(), .getFilePath()]
- "projects_visualmanager_visualmanager_savevisualdata": ".saveVisualData()" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L18 | neighbors=[VisualManager, .ensureDataDir(), .getFilePath()]
- "providers_aiprovider_aiprovidergenerateoptions": "AIProviderGenerateOptions" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L1 | neighbors=[AIProvider.ts, index.ts, OpenAIProvider.ts]
- "providers_aiprovider_aiproviderresult": "AIProviderResult" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L11 | neighbors=[AIProvider.ts, index.ts, OpenAIProvider.ts]
- "providers_animationprovider_animationgenerationsuccess": "AnimationGenerationSuccess" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L30 | neighbors=[AnimationAssetPipeline.ts, AnimationStorage.ts, AnimationProvider.ts]
- "providers_animationprovider_animationrequestidentity": "AnimationRequestIdentity" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L51 | neighbors=[AnimationAssetPipeline.ts, AnimationProvider.ts, OpenAIAnimationProvider.ts]
- "providers_animationprovider_configuredanimationprovider": "ConfiguredAnimationProvider" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L68 | neighbors=[AnimationProvider.ts, MockAnimationProvider.ts, OpenAIAnimationProvider.ts]
- "providers_animationproviderconfig_integer": "integer()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L69 | neighbors=[AnimationProviderConfig.ts, getOpenAIAnimationProviderConfig(), AnimationProviderConfigurationError]
- "providers_audioproviderconfig_resolveintegerconfigvalue": "resolveIntegerConfigValue()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L89 | neighbors=[AudioProviderConfig.ts, getOpenAIAudioProviderConfig(), AudioProviderConfigurationError]
- "providers_audioproviderconfig_resolvesafeconfigvalue": "resolveSafeConfigValue()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L118 | neighbors=[AudioProviderConfig.ts, getOpenAIAudioProviderConfig(), AudioProviderConfigurationError]
- "providers_exportprovider_exportgenerationinput": "ExportGenerationInput" | kind=code-symbol | source=src/lib/export/providers/ExportProvider.ts:L15 | neighbors=[ExportEngine.ts, ExportProvider.ts, MockExportProvider.ts]
- "providers_ffmpegscenevideoprovider_clamp": "clamp()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L290 | neighbors=[FFmpegSceneVideoProvider.ts, focusX(), focusY()]
- "providers_ffmpegscenevideoprovider_focusx": "focusX()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L282 | neighbors=[FFmpegSceneVideoProvider.ts, buildMotionFilter(), clamp()]
- "providers_ffmpegscenevideoprovider_focusy": "focusY()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L286 | neighbors=[FFmpegSceneVideoProvider.ts, buildMotionFilter(), clamp()]
- "providers_ffmpegscenevideoprovider_isrenderablezoom": "isRenderableZoom()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L277 | neighbors=[FFmpegSceneVideoProvider.ts, zoomFor(), validateBatch()]
- "providers_ffmpegscenevideoprovider_validatebatch": "validateBatch()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L143 | neighbors=[FFmpegSceneVideoProvider.ts, .generateVideo(), isRenderableZoom()]
- "providers_ffmpegscenevideoprovider_zoomfor": "zoomFor()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L273 | neighbors=[FFmpegSceneVideoProvider.ts, buildMotionFilter(), isRenderableZoom()]
- "providers_ffmpegvideoassemblyprovider_ispositiverational": "isPositiveRational()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L782 | neighbors=[FFmpegVideoAssemblyProvider.ts, parseRational(), validateSceneInputProbe()]
- "providers_ffmpegvideoassemblyprovider_parserational": "parseRational()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L787 | neighbors=[FFmpegVideoAssemblyProvider.ts, isFrameRate(), isPositiveRational()]
- "providers_ffmpegvideoassemblyprovider_validateprobe": "validateProbe()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L677 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble(), isFrameRate()]
- "providers_ffmpegvideoassemblyprovider_videoassemblychildprocess": "VideoAssemblyChildProcess" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L57 | neighbors=[FFmpegVideoAssemblyProvider.ts, smoke-production-scene-video-rendering.…, smoke-production-video-assembly-wiring.…]
- "providers_ffmpegvideoassemblyprovider_videoassemblyspawn": "VideoAssemblySpawn" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L75 | neighbors=[FFmpegVideoAssemblyProvider.ts, smoke-production-scene-video-rendering.…, smoke-production-video-assembly-wiring.…]
- "providers_imageproviderconfig_getrealimageproviderconfig": "getRealImageProviderConfig()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L105 | neighbors=[ImageProviderConfig.ts, integerValue(), RealPhotoImageProvider.ts]
- "providers_mockexportprovider_createexportitems": "createExportItems()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L65 | neighbors=[MockExportProvider.ts, createItem(), createMockExportPackage()]
- "providers_mockthumbnailprovider_createdeterministicthumbnailpng": "createDeterministicThumbnailPng()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L252 | neighbors=[MockThumbnailProvider.ts, pngChunk(), .generateThumbnailAsset()]
- "providers_mockthumbnailprovider_pngchunk": "pngChunk()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L281 | neighbors=[MockThumbnailProvider.ts, createDeterministicThumbnailPng(), crc32()]
- "providers_mockyoutubeprovider_createchapters": "createChapters()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L62 | neighbors=[MockYouTubeProvider.ts, parseDuration(), createMockYouTubeDraft()]
- "providers_openaianimationprovider_cancelbody": "cancelBody()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L531 | neighbors=[OpenAIAnimationProvider.ts, .request(), readBoundedJson()]
- "providers_openaianimationprovider_invalid": "invalid()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L372 | neighbors=[OpenAIAnimationProvider.ts, diagnostic(), .request()]
- "providers_openaianimationprovider_openaianimationprovider_getrequestidentity": ".getRequestIdentity()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L50 | neighbors=[OpenAIAnimationProvider, requestIdentity(), validateInput()]
- "providers_openaianimationprovider_requestidentity": "requestIdentity()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L304 | neighbors=[OpenAIAnimationProvider.ts, .generateAnimation(), .getRequestIdentity()]
- "providers_openaianimationprovider_responsevalidationerror": "ResponseValidationError" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L539 | neighbors=[OpenAIAnimationProvider.ts, readBoundedJson(), .constructor()]
- "providers_openaianimationprovider_timeoutfailure": "timeoutFailure()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L392 | neighbors=[OpenAIAnimationProvider.ts, .request(), diagnostic()]
- "providers_openaianimationprovider_usage": "usage()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L414 | neighbors=[OpenAIAnimationProvider.ts, .request(), safeCount()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-073.json

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
