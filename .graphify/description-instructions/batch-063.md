# Node Description Batch 64 of 166

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

- "animation_animationmotionplanerror_optionalinteger": "optionalInteger()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L190 | neighbors=[AnimationMotionPlanError.ts, isAnimationMotionPlanErrorEvidence(), integer()]
- "animation_animationmotionplanerror_optionalsafe": "optionalSafe()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L181 | neighbors=[AnimationMotionPlanError.ts, isAnimationMotionPlanErrorEvidence(), safe()]
- "animation_animationmotionplanerror_safe": "safe()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L177 | neighbors=[AnimationMotionPlanError.ts, optionalSafe(), sanitizeAnimationProviderDiagnosticMeta…]
- "animation_animationmotionplanvalidation_finitebetween": "finiteBetween()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L170 | neighbors=[AnimationMotionPlanValidation.ts, isValidAnimationDuration(), isValidAnimationMotionFrame()]
- "animation_animationmotionplanvalidation_islegacyanimationscene": "isLegacyAnimationScene()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L131 | neighbors=[AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene(), isCompatibleAnimationData()]
- "animation_animationmotionplanvalidation_isnonemptystring": "isNonEmptyString()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L166 | neighbors=[AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene(), isCompatibleAnimationData()]
- "animation_animationservice_animationservice_generatefromanimationdata": ".generateFromAnimationData()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L105 | neighbors=[AnimationService, .requestAnimations(), generateAnimationsFromAnimationData()]
- "animation_animationservice_animationservice_generatefromanimationscenes": ".generateFromAnimationScenes()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L126 | neighbors=[AnimationService, .requestAnimations(), generateAnimationsFromAnimationScenes()]
- "animation_animationservice_animationservice_generatefromscenevisualdata": ".generateFromSceneVisualData()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L80 | neighbors=[AnimationService, .requestAnimations(), generateAnimationsFromSceneVisualData()]
- "animation_animationstorage_exactframe": "exactFrame()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L232 | neighbors=[AnimationStorage.ts, exactKeys(), validateArtifact()]
- "animation_animationstorage_safesegment": "safeSegment()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L287 | neighbors=[AnimationStorage.ts, .getAnimationDir(), .getMotionPlanPath()]
- "animation_animationstructuredoutput_canonicalanimationproviderschema": "canonicalAnimationProviderSchema" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L40 | neighbors=[AnimationStructuredOutput.ts, OpenAIAnimationProvider.ts, smoke-sprint-129-22-animation-structure…]
- "animation_animationstructuredoutput_createanimationmotionplansystemprompt": "createAnimationMotionPlanSystemPrompt()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L64 | neighbors=[AnimationStructuredOutput.ts, OpenAIAnimationProvider.ts, smoke-sprint-129-22-animation-structure…]
- "animation_animationstructuredoutput_validatenumericranges": "validateNumericRanges()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L164 | neighbors=[AnimationStructuredOutput.ts, validateFrame(), validateRange()]
- "animation_animationstructuredoutput_validaterange": "validateRange()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L151 | neighbors=[AnimationStructuredOutput.ts, validateNumericRanges(), issue()]
- "app_layout": "layout.tsx" | kind=code-symbol | source=app/layout.tsx:L1 | neighbors=[metadata, RootLayout(), 6c1ae5a Sprint 15 - Multi AI Provider A…]
- "app_page": "page.tsx" | kind=code-symbol | source=app/page.tsx:L1 | neighbors=[Page(), HomeClient.tsx, 91ba270 Atölye V2 checkpoint - pipeline…]
- "assembly_assemblymanager_assemblymanager_createfallbackassemblyplan": ".createFallbackAssemblyPlan()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L108 | neighbors=[AssemblyManager, .formatDuration(), .generateAssemblyPlan()]
- "assembly_assemblymanager_assemblymanager_formatduration": ".formatDuration()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L325 | neighbors=[AssemblyManager, .createFallbackAssemblyPlan(), .createFallbackScene()]
- "assembly_videoassemblymanager_getprovidername": "getProviderName()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L723 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_isexactmockresult": "isExactMockResult()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L734 | neighbors=[VideoAssemblyManager.ts, validDate(), .renderExistingAssets()]
- "assembly_videoassemblymanager_isvalidrealresult": "isValidRealResult()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L753 | neighbors=[VideoAssemblyManager.ts, validDate(), .renderExistingAssets()]
- "assembly_videoassemblymanager_requireids": "requireIds()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L376 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, validateIdentitySets()]
- "assembly_videoassemblymanager_requiremixasset": "requireMixAsset()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L714 | neighbors=[VideoAssemblyManager.ts, requireAudioAsset(), .renderExistingAssets()]
- "assembly_videoassemblymanager_requireorderedids": "requireOrderedIds()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L432 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_requireuniquescenevideolocators": "requireUniqueSceneVideoLocators()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L446 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_resolvescenevideodata": "resolveSceneVideoData()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L410 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_safeassemble": "safeAssemble()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L289 | neighbors=[VideoAssemblyManager.ts, VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_validdate": "validDate()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L789 | neighbors=[VideoAssemblyManager.ts, isExactMockResult(), isValidRealResult()]
- "assets_assetgallery_assetcard": "AssetCard()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L507 | neighbors=[AssetGallery.tsx, formatDate(), getAssetName()]
- "assets_assetgallery_assetpreview": "AssetPreview()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L485 | neighbors=[AssetGallery.tsx, getAssetImageSource(), getAssetName()]
- "assets_assetgallery_getassetname": "getAssetName()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L702 | neighbors=[AssetGallery.tsx, AssetCard(), AssetPreview()]
- "assets_assetmanager_assetmanager_addasset": ".addAsset()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L90 | neighbors=[AssetManager, .getProjectAssets(), .saveProjectAssets()]
- "assets_assetmanager_assetmanager_addassetatomically": ".addAssetAtomically()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L110 | neighbors=[AssetManager, .getProjectAssets(), .saveProjectAssetsAtomically()]
- "assets_assetmanager_assetmanager_saveprojectassetsatomically": ".saveProjectAssetsAtomically()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L69 | neighbors=[AssetManager, .addAssetAtomically(), .getAssetsPath()]
- "assets_assetmanager_assetmanager_updateasset": ".updateAsset()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L128 | neighbors=[AssetManager, .getProjectAssets(), .saveProjectAssets()]
- "assets_route_post": "POST()" | kind=code-symbol | source=app/api/assets/route.ts:L45 | neighbors=[route.ts, filterVisualDataBySceneId(), isVisualData()]
- "assets_visualassetpipeline_normalizesafeimageurl": "normalizeSafeImageUrl()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L439 | neighbors=[VisualAssetPipeline.ts, normalizeGenerationResult(), normalizeSafeLocalImageUrl()]
- "assets_visualassetpipeline_validatenoexistinggeneratedimages": "validateNoExistingGeneratedImages()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L199 | neighbors=[VisualAssetPipeline.ts, VisualAssetGenerationError, .generateAssets()]
- "assets_visualassetpipeline_validatescenebatch": "validateSceneBatch()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L407 | neighbors=[VisualAssetPipeline.ts, VisualAssetGenerationError, .generateAssets()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-063.json

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
