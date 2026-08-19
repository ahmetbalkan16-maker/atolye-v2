# Node Description Batch 86 of 166

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

- "animations_route_isscenedata": "isSceneData()" | kind=code-symbol | source=app/api/animations/route.ts:L218 | neighbors=[route.ts, POST()]
- "animations_route_isvisualdata": "isVisualData()" | kind=code-symbol | source=app/api/animations/route.ts:L235 | neighbors=[route.ts, POST()]
- "animations_route_normalizesceneid": "normalizeSceneId()" | kind=code-symbol | source=app/api/animations/route.ts:L175 | neighbors=[route.ts, POST()]
- "assembly_assemblymanager_assemblymanager_infercameramovement": ".inferCameraMovement()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L305 | neighbors=[AssemblyManager, .createFallbackScene()]
- "assembly_assemblymanager_assemblymanager_infereffects": ".inferEffects()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L313 | neighbors=[AssemblyManager, .createFallbackScene()]
- "assembly_assemblymanager_assemblymanager_maprender": ".mapRender()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L242 | neighbors=[AssemblyManager, .generateAssemblyPlan()]
- "assembly_assemblymanager_assemblymanager_mapscenes": ".mapScenes()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L186 | neighbors=[AssemblyManager, .generateAssemblyPlan()]
- "assembly_assemblymanager_assemblysourcedata": "AssemblySourceData" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L25 | neighbors=[AssemblyManager.ts, assemblyPrompt.ts]
- "assembly_assemblymanager_nonemptystring": "nonEmptyString()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L353 | neighbors=[AssemblyManager.ts, isStrictAssemblyResponse()]
- "assembly_assemblymanager_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L354 | neighbors=[AssemblyManager.ts, isStrictAssemblyResponse()]
- "assembly_videoassemblymanager_persistfailedassetsafely": "persistFailedAssetSafely()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L797 | neighbors=[VideoAssemblyManager.ts, .renderExistingAssets()]
- "assembly_videoassemblymanager_requireimageasset": "requireImageAsset()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L614 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError]
- "assembly_videoassemblymanager_requirescenevideoinput": "requireSceneVideoInput()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L464 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError]
- "assembly_videoassemblymanager_sameids": "sameIds()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L403 | neighbors=[VideoAssemblyManager.ts, validateIdentitySets()]
- "assets_assetgallery_assetgallery": "AssetGallery()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L46 | neighbors=[AssetGallery.tsx, groupAssetsByScene()]
- "assets_assetgallery_formatdate": "formatDate()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L730 | neighbors=[AssetGallery.tsx, AssetCard()]
- "assets_assetgallery_getactiveasset": "getActiveAsset()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L654 | neighbors=[AssetGallery.tsx, sortAssetsByNewest()]
- "assets_assetgallery_getassetimagesource": "getAssetImageSource()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L710 | neighbors=[AssetGallery.tsx, AssetPreview()]
- "assets_assetgallery_groupassetsbyscene": "groupAssetsByScene()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L602 | neighbors=[AssetGallery.tsx, AssetGallery()]
- "assets_assetgallery_sortassetsbynewest": "sortAssetsByNewest()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L677 | neighbors=[AssetGallery.tsx, getActiveAsset()]
- "assets_assetmanager_assetmanager_createdefaultassets": ".createDefaultAssets()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L23 | neighbors=[AssetManager, .getProjectAssets()]
- "assets_route_filtervisualdatabysceneid": "filterVisualDataBySceneId()" | kind=code-symbol | source=app/api/assets/route.ts:L109 | neighbors=[route.ts, POST()]
- "assets_route_isvisualdata": "isVisualData()" | kind=code-symbol | source=app/api/assets/route.ts:L125 | neighbors=[route.ts, POST()]
- "assets_visualassetpipeline_normalizeimagemimetype": "normalizeImageMimeType()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L430 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_normalizenonemptystring": "normalizeNonEmptyString()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L349 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_normalizepositiveinteger": "normalizePositiveInteger()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L373 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_normalizesafeimagepath": "normalizeSafeImagePath()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L505 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_normalizesafelocalimageurl": "normalizeSafeLocalImageUrl()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L467 | neighbors=[VisualAssetPipeline.ts, normalizeSafeImageUrl()]
- "assets_visualassetpipeline_normalizesourceurl": "normalizeSourceUrl()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L355 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_normalizeunitscore": "normalizeUnitScore()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L367 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult()]
- "assets_visualassetpipeline_persistfailedasset": "persistFailedAsset()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L379 | neighbors=[VisualAssetPipeline.ts, .generateAssets()]
- "audio_audioasseterror_audioassetrooterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L50 | neighbors=[AudioAssetRootError, createAudioAssetErrorEvidence()]
- "audio_audioasseterror_sanitizetarget": "sanitizeTarget()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L205 | neighbors=[AudioAssetError.ts, createAudioAssetErrorEvidence()]
- "audio_audiocompensationstore_audiocompensationworkspace": "AudioCompensationWorkspace" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L154 | neighbors=[AudioCompensationStore.ts, AudioStorage.ts]
- "audio_audiocompensationstore_getprotectedaudiocompensationquarantinedirectory": "getProtectedAudioCompensationQuarantineDirectory()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L279 | neighbors=[AudioCompensationStore.ts, requireDeferredWorkspace()]
- "audio_audiocompensationstore_measuredeferredworkspace": "measureDeferredWorkspace()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2384 | neighbors=[AudioCompensationStore.ts, inspectDeferredBacklog()]
- "audio_audiocompensationstore_protectedaudiocanonicalreadidentity": "ProtectedAudioCanonicalReadIdentity" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L98 | neighbors=[AudioCompensationStore.ts, AudioStorage.ts]
- "audio_audiocompensationstore_protectedaudiocompensationpublication": "ProtectedAudioCompensationPublication" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L79 | neighbors=[AudioCompensationStore.ts, AudioStorage.ts]
- "audio_audiocompensationstore_protectedaudiocompensationreceipt": "ProtectedAudioCompensationReceipt" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L63 | neighbors=[AudioCompensationStore.ts, AudioStorage.ts]
- "audio_audiocompensationstore_receiptlogicalroot": "receiptLogicalRoot()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1649 | neighbors=[AudioCompensationStore.ts, receiptRoot()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-085.json

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
