# Node Description Batch 118 of 166

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

- "thumbnail_thumbnailassetpipeline_cleanupunregisteredresult": "cleanupUnregisteredResult()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L426 | neighbors=[ThumbnailAssetPipeline.ts, .generateThumbnail()]
- "thumbnail_thumbnailassetpipeline_validdate": "validDate()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L451 | neighbors=[ThumbnailAssetPipeline.ts, validateProviderResult()]
- "thumbnail_thumbnailengine_generatethumbnailplan": "generateThumbnailPlan()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L80 | neighbors=[ThumbnailEngine.ts, ThumbnailEngine]
- "thumbnail_thumbnailengine_thumbnailengine_createfallback": ".createFallback()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L49 | neighbors=[ThumbnailEngine, .generateThumbnailPlan()]
- "thumbnail_thumbnailengine_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L78 | neighbors=[ThumbnailEngine.ts, isStrictThumbnailPlan()]
- "thumbnail_thumbnailmanager_thumbnailmanager_createshorttext": ".createShortText()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L221 | neighbors=[ThumbnailManager, .createFallbackThumbnailData()]
- "thumbnail_thumbnailmanager_thumbnailmanager_mapgeneration": ".mapGeneration()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L144 | neighbors=[ThumbnailManager, .generateThumbnailData()]
- "thumbnail_thumbnailmanager_thumbnailmanager_mapvariants": ".mapVariants()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L168 | neighbors=[ThumbnailManager, .generateThumbnailData()]
- "thumbnail_thumbnailproviderconfig_thumbnailproviderconfig": "ThumbnailProviderConfig" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderConfig.ts:L3 | neighbors=[OpenAIThumbnailProvider.ts, ThumbnailProviderConfig.ts]
- "thumbnail_thumbnailstorage_crc32": "crc32()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L390 | neighbors=[ThumbnailStorage.ts, inspectPng()]
- "thumbnail_thumbnailstorage_extensionformimetype": "extensionForMimeType()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L362 | neighbors=[ThumbnailStorage.ts, .saveThumbnail()]
- "thumbnail_thumbnailstorage_inspectjpeg": "inspectJpeg()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L309 | neighbors=[ThumbnailStorage.ts, inspectImageBuffer()]
- "thumbnail_thumbnailstorage_inspectwebp": "inspectWebp()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L335 | neighbors=[ThumbnailStorage.ts, inspectImageBuffer()]
- "thumbnail_thumbnailstorage_isinside": "isInside()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L401 | neighbors=[ThumbnailStorage.ts, .saveThumbnail()]
- "thumbnail_thumbnailstorage_storedthumbnailinspection": "StoredThumbnailInspection" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L37 | neighbors=[ThumbnailStorage.ts, ThumbnailInspection]
- "thumbnail_thumbnailstorage_thumbnailinspection": "ThumbnailInspection" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L31 | neighbors=[ThumbnailStorage.ts, StoredThumbnailInspection]
- "thumbnails_route_isassemblyplandata": "isAssemblyPlanData()" | kind=code-symbol | source=app/api/thumbnails/route.ts:L99 | neighbors=[route.ts, POST()]
- "thumbnails_route_isaudiodata": "isAudioData()" | kind=code-symbol | source=app/api/thumbnails/route.ts:L109 | neighbors=[route.ts, POST()]
- "thumbnails_route_loadprojectthumbnailsources": "loadProjectThumbnailSources()" | kind=code-symbol | source=app/api/thumbnails/route.ts:L75 | neighbors=[route.ts, POST()]
- "thumbnails_route_normalizeslug": "normalizeSlug()" | kind=code-symbol | source=app/api/thumbnails/route.ts:L91 | neighbors=[route.ts, POST()]
- "types_airesponse_airesponseschemaissuereasons": "aiResponseSchemaIssueReasons" | kind=code-symbol | source=src/types/aiResponse.ts:L1 | neighbors=[AIResponseError.ts, aiResponse.ts]
- "types_aiusage_aiusageprovider": "AIUsageProvider" | kind=code-symbol | source=src/types/aiUsage.ts:L10 | neighbors=[runObservedAIRequest.ts, aiUsage.ts]
- "types_animation_animationgenerationmode": "AnimationGenerationMode" | kind=code-symbol | source=src/types/animation.ts:L19 | neighbors=[AnimationProvider.ts, animation.ts]
- "types_animationerror_animationfailurephases": "animationFailurePhases" | kind=code-symbol | source=src/types/animationError.ts:L18 | neighbors=[AnimationMotionPlanError.ts, animationError.ts]
- "types_animationerror_animationfinishreason": "AnimationFinishReason" | kind=code-symbol | source=src/types/animationError.ts:L39 | neighbors=[OpenAIAnimationProvider.ts, animationError.ts]
- "types_animationerror_animationfinishreasons": "animationFinishReasons" | kind=code-symbol | source=src/types/animationError.ts:L31 | neighbors=[AnimationMotionPlanError.ts, animationError.ts]
- "types_animationerror_animationmotionplanerrorcodes": "animationMotionPlanErrorCodes" | kind=code-symbol | source=src/types/animationError.ts:L1 | neighbors=[AnimationMotionPlanError.ts, animationError.ts]
- "types_animationerror_animationschemaissuecodes": "animationSchemaIssueCodes" | kind=code-symbol | source=src/types/animationError.ts:L41 | neighbors=[AnimationMotionPlanError.ts, animationError.ts]
- "types_animationerror_animationschemavaluecategories": "animationSchemaValueCategories" | kind=code-symbol | source=src/types/animationError.ts:L52 | neighbors=[AnimationMotionPlanError.ts, animationError.ts]
- "types_animationerror_animationschemavaluecategory": "AnimationSchemaValueCategory" | kind=code-symbol | source=src/types/animationError.ts:L59 | neighbors=[AnimationStructuredOutput.ts, animationError.ts]
- "types_assembly_assemblyrenderinfo": "AssemblyRenderInfo" | kind=code-symbol | source=src/types/assembly.ts:L32 | neighbors=[AssemblyManager.ts, assembly.ts]
- "types_audio_audiomimetype": "AudioMimeType" | kind=code-symbol | source=src/types/audio.ts:L9 | neighbors=[AudioPipeline.ts, audio.ts]
- "types_audio_audiomusicplan": "AudioMusicPlan" | kind=code-symbol | source=src/types/audio.ts:L110 | neighbors=[AudioManager.ts, audio.ts]
- "types_audio_audionarrator": "AudioNarrator" | kind=code-symbol | source=src/types/audio.ts:L66 | neighbors=[AudioManager.ts, audio.ts]
- "types_audio_audioproductioninfo": "AudioProductionInfo" | kind=code-symbol | source=src/types/audio.ts:L118 | neighbors=[AudioManager.ts, audio.ts]
- "types_export_exportitem": "ExportItem" | kind=code-symbol | source=src/types/export.ts:L25 | neighbors=[MockExportProvider.ts, export.ts]
- "types_export_exportitemtype": "ExportItemType" | kind=code-symbol | source=src/types/export.ts:L15 | neighbors=[MockExportProvider.ts, export.ts]
- "types_export_exportstatus": "ExportStatus" | kind=code-symbol | source=src/types/export.ts:L1 | neighbors=[ExportProvider.ts, export.ts]
- "types_pipelinerecovery_pipelinejobretryexecutionresult": "PipelineJobRetryExecutionResult" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L55 | neighbors=[PipelineRunner.ts, pipelineRecovery.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewayinput": "ProductionControlledExecutionGatewayInput" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L3 | neighbors=[ProductionControlledExecutionGateway.ts, productionControlledExecutionGateway.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-117.json

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
