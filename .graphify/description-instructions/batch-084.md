# Node Description Batch 85 of 166

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

- "ai_scenestructuredoutput_validateid": "validateId()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L179 | neighbors=[SceneStructuredOutput.ts, observedType()]
- "ai_scenestructuredoutput_validatestring": "validateString()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L184 | neighbors=[SceneStructuredOutput.ts, observedType()]
- "ai_schema_scriptdocument": "ScriptDocument" | kind=code-symbol | source=src/lib/ai/schema.ts:L7 | neighbors=[schema.ts, validator.ts]
- "ai_scriptaiconfig_scripttokenbudget": "scriptTokenBudget" | kind=code-symbol | source=src/lib/ai/ScriptAIConfig.ts:L1 | neighbors=[ScriptAIConfig.ts, smoke-sprint-129-13-script-settlement.ts]
- "ai_scriptstructuredoutput_exactfields": "exactFields()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L111 | neighbors=[ScriptStructuredOutput.ts, validateProviderScript()]
- "ai_scriptstructuredoutput_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L139 | neighbors=[ScriptStructuredOutput.ts, validateProviderScript()]
- "ai_usage_route_get": "GET()" | kind=code-symbol | source=app/api/projects/[slug]/ai-usage/route.ts:L11 | neighbors=[route.ts, isSafeSlug()]
- "ai_usage_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/ai-usage/route.ts:L61 | neighbors=[route.ts, GET()]
- "ai_visualsaiconfig_visualstokenbudget": "visualsTokenBudget" | kind=code-symbol | source=src/lib/ai/VisualsAIConfig.ts:L1 | neighbors=[VisualsAIConfig.ts, smoke-sprint-129-20-visuals-truncation-…]
- "ai_visualstructuredoutput_validatesearchkeywords": "validateSearchKeywords()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L177 | neighbors=[VisualStructuredOutput.ts, observedType()]
- "airules_doc": "ATOLYE_AI_RULES.md" | kind=entity | source=ATOLYE_AI_RULES.md | neighbors=[AI_MEMORY.md, ATOLYE_CONTEXT.md]
- "animation_animationassetpipeline_persistproviderusage": "persistProviderUsage()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L580 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationassetpipeline_preparescenes": "prepareScenes()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L386 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationassetpipeline_requireprovidername": "requireProviderName()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L493 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationassetpipeline_requirereplayplan": "requireReplayPlan()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L270 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationassetpipeline_requirevalidplan": "requireValidPlan()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L506 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationassetpipeline_validatescenebatch": "validateSceneBatch()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L344 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets()]
- "animation_animationmerge_sortanimationscenes": "sortAnimationScenes()" | kind=code-symbol | source=src/lib/animation/animationMerge.ts:L42 | neighbors=[animationMerge.ts, mergeAnimationData()]
- "animation_animationmotionplanerror_animationmotionplanerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L23 | neighbors=[AnimationMotionPlanError, sanitizeAnimationProviderDiagnosticMeta…]
- "animation_animationmotionplanerror_durablephase": "durablePhase()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L104 | neighbors=[AnimationMotionPlanError.ts, serializeAnimationMotionPlanEvidence()]
- "animation_animationmotionplanerror_optionalschemaissues": "optionalSchemaIssues()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L160 | neighbors=[AnimationMotionPlanError.ts, isAnimationMotionPlanErrorEvidence()]
- "animation_animationmotionplanerror_sanitizeschemaissues": "sanitizeSchemaIssues()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L145 | neighbors=[AnimationMotionPlanError.ts, sanitizeAnimationProviderDiagnosticMeta…]
- "animation_animationmotionplanvalidation_hasmotionplanfields": "hasMotionPlanFields()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L146 | neighbors=[AnimationMotionPlanValidation.ts, isCompatibleAnimationData()]
- "animation_animationmotionplanvalidation_issafeprovidername": "isSafeProviderName()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L162 | neighbors=[AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene()]
- "animation_animationservice_animationservice_regeneratesceneanimation": ".regenerateSceneAnimation()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L149 | neighbors=[AnimationService, .requestAnimations()]
- "animation_animationservice_generateanimationsfromanimationdata": "generateAnimationsFromAnimationData()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L211 | neighbors=[AnimationService.ts, .generateFromAnimationData()]
- "animation_animationservice_generateanimationsfromanimationscenes": "generateAnimationsFromAnimationScenes()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L218 | neighbors=[AnimationService.ts, .generateFromAnimationScenes()]
- "animation_animationservice_generateanimationsfromscenevisualdata": "generateAnimationsFromSceneVisualData()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L204 | neighbors=[AnimationService.ts, .generateFromSceneVisualData()]
- "animation_animationservice_isassets": "isAssets()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L231 | neighbors=[AnimationService.ts, .requestAnimations()]
- "animation_animationstorage_exactkeys": "exactKeys()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L239 | neighbors=[AnimationStorage.ts, exactFrame()]
- "animation_animationstorage_safevalue": "safeValue()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L283 | neighbors=[AnimationStorage.ts, validateArtifact()]
- "animation_animationstorage_sameartifact": "sameArtifact()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L279 | neighbors=[AnimationStorage.ts, .saveMotionPlan()]
- "animation_animationstructuredoutput_canonicalanimationproviderplan": "CanonicalAnimationProviderPlan" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L33 | neighbors=[AnimationStructuredOutput.ts, OpenAIAnimationProvider.ts]
- "animation_animationstructuredoutput_expectedfield": "expectedField()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L225 | neighbors=[AnimationStructuredOutput.ts, exactFields()]
- "animation_animationstructuredoutput_finite": "finite()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L243 | neighbors=[AnimationStructuredOutput.ts, validateFrame()]
- "animation_animationstructuredoutput_framejsonschema": "frameJsonSchema()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L252 | neighbors=[AnimationStructuredOutput.ts, numericJsonSchemaProperties()]
- "animation_animationstructuredoutput_numericjsonschemaproperties": "numericJsonSchemaProperties()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L274 | neighbors=[AnimationStructuredOutput.ts, frameJsonSchema()]
- "animation_animationstructuredoutput_safepathsegment": "safePathSegment()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L212 | neighbors=[AnimationStructuredOutput.ts, exactFields()]
- "animations_route_filteranimationscenesbysceneid": "filterAnimationScenesBySceneId()" | kind=code-symbol | source=app/api/animations/route.ts:L191 | neighbors=[route.ts, POST()]
- "animations_route_isanimationscenes": "isAnimationScenes()" | kind=code-symbol | source=app/api/animations/route.ts:L204 | neighbors=[route.ts, POST()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-084.json

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
