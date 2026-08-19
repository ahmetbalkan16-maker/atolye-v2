# Node Description Batch 124 of 166

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

- "ai_visualstructuredoutput_canonicalvisualproviderschema": "canonicalVisualProviderSchema" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L30 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_searchkeywordsspec": "searchKeywordsSpec" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L18 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_thumbnailfields": "thumbnailFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L12 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_thumbnailstringfields": "thumbnailStringFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L23 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_toplevelfields": "topLevelFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L9 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_visualfields": "visualFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L10 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_visualoptionalfields": "visualOptionalFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L11 | neighbors=[VisualStructuredOutput.ts]
- "ai_visualstructuredoutput_visualstringfields": "visualStringFields" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L13 | neighbors=[VisualStructuredOutput.ts]
- "aimemory_doc": "AI_MEMORY.md" | kind=entity | source=AI_MEMORY.md | neighbors=[ATOLYE_AI_RULES.md]
- "animation_animationassetpipeline_animationassetpipelineresult": "AnimationAssetPipelineResult" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L47 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_generateanimationassets": "generateAnimationAssets()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L338 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_generateanimationassetsinput": "GenerateAnimationAssetsInput" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L40 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_image_mime_types": "IMAGE_MIME_TYPES" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L32 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_preparedscene": "PreparedScene" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L52 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_updatedscene": "updatedScene()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L246 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationassetpipeline_validatesourceimage": "validateSourceImage()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L435 | neighbors=[AnimationAssetPipeline.ts]
- "animation_animationmotionplanerror_issafeschemaissue": "isSafeSchemaIssue()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L167 | neighbors=[AnimationMotionPlanError.ts]
- "animation_animationmotionplanvalidation_animationstatuses": "animationStatuses" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L17 | neighbors=[AnimationMotionPlanValidation.ts]
- "animation_animationmotionplanvalidation_motiontypes": "motionTypes" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L18 | neighbors=[AnimationMotionPlanValidation.ts]
- "animation_animationmotionplanvalidation_transitiontypes": "transitionTypes" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L19 | neighbors=[AnimationMotionPlanValidation.ts]
- "animation_animationservice_animationapipayload": "AnimationApiPayload" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L54 | neighbors=[AnimationService.ts]
- "animation_animationservice_animationapiresponse": "AnimationApiResponse" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L47 | neighbors=[AnimationService.ts]
- "animation_animationservice_animationservicebaseinput": "AnimationServiceBaseInput" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L12 | neighbors=[AnimationService.ts]
- "animation_animationservice_animationserviceoptions": "AnimationServiceOptions" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L7 | neighbors=[AnimationService.ts]
- "animation_animationservice_animationserviceresult": "AnimationServiceResult" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L42 | neighbors=[AnimationService.ts]
- "animation_animationservice_generateanimationsfromanimationdatainput": "GenerateAnimationsFromAnimationDataInput" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L24 | neighbors=[AnimationService.ts]
- "animation_animationservice_generateanimationsfromscenesinput": "GenerateAnimationsFromScenesInput" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L29 | neighbors=[AnimationService.ts]
- "animation_animationservice_generateanimationsfromscenevisualinput": "GenerateAnimationsFromSceneVisualInput" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L17 | neighbors=[AnimationService.ts]
- "animation_animationservice_regeneratesceneanimation": "regenerateSceneAnimation()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L225 | neighbors=[AnimationService.ts]
- "animation_animationservice_regeneratesceneanimationinput": "RegenerateSceneAnimationInput" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L35 | neighbors=[AnimationService.ts]
- "animation_animationstorage_animationmotionplanartifact": "AnimationMotionPlanArtifact" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L37 | neighbors=[AnimationStorage.ts]
- "animation_animationstorage_storedanimationmotionplan": "StoredAnimationMotionPlan" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L31 | neighbors=[AnimationStorage.ts]
- "animation_animationstructuredoutput_animationstructuredoutputvalidation": "AnimationStructuredOutputValidation" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L77 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_cropfields": "cropFields" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L30 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_cropnumberspecs": "cropNumberSpecs" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L19 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_framefields": "frameFields" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L18 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_planfields": "planFields" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L17 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_transformfields": "transformFields" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L31 | neighbors=[AnimationStructuredOutput.ts]
- "animation_animationstructuredoutput_transformnumberspecs": "transformNumberSpecs" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L25 | neighbors=[AnimationStructuredOutput.ts]
- "app_layout_metadata": "metadata" | kind=code-symbol | source=app/layout.tsx:L4 | neighbors=[layout.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-123.json

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
