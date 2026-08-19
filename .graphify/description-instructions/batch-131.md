# Node Description Batch 132 of 166

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

- "production_productionacceptancepolicy_effectiveproductionacceptanceauthority": "EffectiveProductionAcceptanceAuthority" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L834 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_legacystagecapabilities": "legacyStageCapabilities" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L468 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancemarker": "ProductionAcceptanceMarker" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L150 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancemarkersnapshot": "ProductionAcceptanceMarkerSnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L154 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancemarkerv2": "ProductionAcceptanceMarkerV2" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L99 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancemarkerv3": "ProductionAcceptanceMarkerV3" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L115 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancemarkerv3profile2": "ProductionAcceptanceMarkerV3Profile2" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L132 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancepolicyerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L180 | neighbors=[ProductionAcceptancePolicyError]
- "production_productionacceptancepolicy_productionacceptancerepreparepreparation": "ProductionAcceptanceRepreparePreparation" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L172 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_productionacceptancestagecapabilitybrand": "productionAcceptanceStageCapabilityBrand" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L427 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_registeredlegacystagecapability": "RegisteredLegacyStageCapability" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L452 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_secretfingerprint": "secretFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1153 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepreflight_productionacceptanceduration": "productionAcceptanceDuration" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L6 | neighbors=[ProductionAcceptancePreflight.ts]
- "production_productionacceptancepreflight_productionchapterscenegroup": "ProductionChapterSceneGroup" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L33 | neighbors=[ProductionAcceptancePreflight.ts]
- "production_productionacceptancepreflight_productiondurationpreflighterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L26 | neighbors=[ProductionDurationPreflightError]
- "production_productionacceptancepreflight_productionsceneaudiosegment": "ProductionSceneAudioSegment" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L39 | neighbors=[ProductionAcceptancePreflight.ts]
- "production_productionacceptancepreflight_productionscenemappingerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L16 | neighbors=[ProductionSceneMappingError]
- "production_productionacceptancereprepareservice_authenticproductionacceptancereprepareerrors": "authenticProductionAcceptanceReprepareErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L56 | neighbors=[ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancereprepareservice_defaultfileoperations": "defaultFileOperations" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L213 | neighbors=[ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancereprepareservice_productionacceptancerepreparedependencies": "ProductionAcceptanceReprepareDependencies" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L31 | neighbors=[ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancereprepareservice_productionacceptancereprepareerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L46 | neighbors=[ProductionAcceptanceReprepareError]
- "production_productionacceptancereprepareservice_writablefilehandle": "WritableFileHandle" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L16 | neighbors=[ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancetopic_authenticproductionacceptancetopicerrors": "authenticProductionAcceptanceTopicErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L26 | neighbors=[ProductionAcceptanceTopic.ts]
- "production_productionacceptancetopic_productionacceptancetopicerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L16 | neighbors=[ProductionAcceptanceTopicError]
- "production_productionacceptancetopic_productionacceptancetopicerrorcode": "ProductionAcceptanceTopicErrorCode" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L9 | neighbors=[ProductionAcceptanceTopic.ts]
- "production_productionactionengine_priorityrank": "priorityRank()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L40 | neighbors=[ProductionActionEngine.ts]
- "production_productionactionengine_stagerank": "stageRank()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L41 | neighbors=[ProductionActionEngine.ts]
- "production_productioncanonicaldurablelineage_productioncanonicaldurablelineage": "ProductionCanonicalDurableLineage" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L30 | neighbors=[ProductionCanonicalDurableLineage.ts]
- "production_productioncanonicaldurablelineage_productioncanonicaldurablelineageexpectedversions": "ProductionCanonicalDurableLineageExpectedVersions" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L38 | neighbors=[ProductionCanonicalDurableLineage.ts]
- "production_productioncanonicaldurablelineage_recordimmutableidentity": "recordImmutableIdentity()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L160 | neighbors=[ProductionCanonicalDurableLineage.ts]
- "production_productioncanonicaldurablelineage_validateproductioncanonicalterminalauthority": "validateProductionCanonicalTerminalAuthority()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L108 | neighbors=[ProductionCanonicalDurableLineage.ts]
- "production_productioncompletedstageregenerationpaths_regenerationrootname": "regenerationRootName" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPaths.ts:L5 | neighbors=[ProductionCompletedStageRegenerationPat…]
- "production_productioncompletedstageregenerationplanner_productionregenerationplanerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L47 | neighbors=[ProductionRegenerationPlanError]
- "production_productioncompletedstageregenerationplanner_productionregenerationplanerrorcode": "ProductionRegenerationPlanErrorCode" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L35 | neighbors=[ProductionCompletedStageRegenerationPla…]
- "production_productioncompletedstageregenerationservice_mutation": "Mutation" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L224 | neighbors=[ProductionCompletedStageRegenerationSer…]
- "production_productioncompletedstageregenerationservice_mutationsfromintent": "mutationsFromIntent()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L232 | neighbors=[ProductionCompletedStageRegenerationSer…]
- "production_productioncompletedstageregenerationservice_productionregenerationpreparationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L54 | neighbors=[ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationservice_productionregenerationpreparationerrorcode": "ProductionRegenerationPreparationErrorCode" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L45 | neighbors=[ProductionCompletedStageRegenerationSer…]
- "production_productioncompletedstageregenerationservice_productionregenerationpreparationhooks": "ProductionRegenerationPreparationHooks" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L61 | neighbors=[ProductionCompletedStageRegenerationSer…]
- "production_productioncompletedstageregenerationstore_regenerationpredecessorassetevidence": "RegenerationPredecessorAssetEvidence" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L270 | neighbors=[ProductionCompletedStageRegenerationSto…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-131.json

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
