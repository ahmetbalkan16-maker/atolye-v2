# Node Description Batch 94 of 166

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

- "production_productionactionengine_actiontypefor": "actionTypeFor()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L32 | neighbors=[ProductionActionEngine.ts, toAction()]
- "production_productionactionengine_productionactionengine_recommend": ".recommend()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L7 | neighbors=[ProductionActionEngine, toAction()]
- "production_productionactionengine_titlefor": "titleFor()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L39 | neighbors=[ProductionActionEngine.ts, toAction()]
- "production_productioncanonicaldurablelineage_assertexpected": "assertExpected()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L254 | neighbors=[ProductionCanonicalDurableLineage.ts, readProductionCanonicalTerminalDurableL…]
- "production_productioncanonicaldurablelineage_assertidentity": "assertIdentity()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L176 | neighbors=[ProductionCanonicalDurableLineage.ts, readProductionCanonicalTerminalDurableL…]
- "production_productioncanonicaldurablelineage_assertterminalconsistency": "assertTerminalConsistency()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L234 | neighbors=[ProductionCanonicalDurableLineage.ts, readProductionCanonicalTerminalDurableL…]
- "production_productioncanonicaldurablelineage_escaperegularexpression": "escapeRegularExpression()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L280 | neighbors=[ProductionCanonicalDurableLineage.ts, readLatestVersioned()]
- "production_productioncompletedstageregenerationplanner_fingerprinttree": "fingerprintTree()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L189 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan()]
- "production_productioncompletedstageregenerationplanner_latestgeneration": "latestGeneration()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L241 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan()]
- "production_productioncompletedstageregenerationplanner_optionalfilehash": "optionalFileHash()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L227 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan()]
- "production_productioncompletedstageregenerationplanner_stagepackageready": "stagePackageReady()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L231 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan()]
- "production_productioncompletedstageregenerationplanner_treeaggregate": "treeAggregate()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L214 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan()]
- "production_productioncompletedstageregenerationservice_assertpreparedreplay": "assertPreparedReplay()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L189 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationservice_atomicreplace": "atomicReplace()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L368 | neighbors=[ProductionCompletedStageRegenerationSer…, applyMutation()]
- "production_productioncompletedstageregenerationservice_createmutation": "createMutation()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L338 | neighbors=[ProductionCompletedStageRegenerationSer…, buildMutations()]
- "production_productioncompletedstageregenerationservice_rejectconflictingregeneration": "rejectConflictingRegeneration()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L414 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationservice_replacemutation": "replaceMutation()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L333 | neighbors=[ProductionCompletedStageRegenerationSer…, buildMutations()]
- "production_productioncompletedstageregenerationservice_verifyboundbackup": "verifyBoundBackup()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L380 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationstore_collectregistrybindings": "collectRegistryBindings()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L484 | neighbors=[ProductionCompletedStageRegenerationSto…, buildAudioPreservationFingerprint()]
- "production_productioncontrolledexecutiongateway_orchestration": "orchestration()" | kind=code-symbol | source=src/lib/production/ProductionControlledExecutionGateway.ts:L4 | neighbors=[ProductionControlledExecutionGateway.ts, evaluateProductionControlledExecutionGa…]
- "production_productiondependencygraph_productiondependencygraphbuilder_build": ".build()" | kind=code-symbol | source=src/lib/production/ProductionDependencyGraph.ts:L8 | neighbors=[ProductionDependencyGraphBuilder, detectProductionDependencyCycles()]
- "production_productiondurableattemptlineageboundary_createproductiondurableattemptlineagebindingerror": "createProductionDurableAttemptLineageBindingError()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L65 | neighbors=[ProductionDurableAttemptLineageBoundary…, ProductionPipelineExecutionFactory.ts]
- "production_productiondurableattemptlineageboundary_readproductiondurableattemptlineageboundary": "readProductionDurableAttemptLineageBoundary()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L82 | neighbors=[ProductionDurableAttemptLineageBoundary…, smoke-production-durable-attempt-lineag…]
- "production_productiondurableattemptlineageclassifier_buildlineageplans": "buildLineagePlans()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L247 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_claimbindingboundary": "claimBindingBoundary()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L277 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_durableattemptoperationbindingboundary": "durableAttemptOperationBindingBoundary()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L319 | neighbors=[ProductionDurableAttemptLineageClassifi…, attemptBindingBoundary()]
- "production_productiondurableattemptlineageclassifier_durablelineageruntype": "durableLineageRunType()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L334 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_exactlatestlineageversion": "exactLatestLineageVersion()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L348 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_invalid": "invalid()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L156 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_recordbindingboundary": "recordBindingBoundary()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L264 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…]
- "production_productionendtoendvalidation_hashandler": "hasHandler()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L263 | neighbors=[ProductionEndToEndValidation.ts, inspectStructuralStreams()]
- "production_productionendtoendvalidation_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L207 | neighbors=[ProductionEndToEndValidation.ts, validateSnapshot()]
- "production_productionendtoendvalidation_productionendtoendvalidationcode": "ProductionEndToEndValidationCode" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L14 | neighbors=[ProductionEndToEndValidation.ts, smoke-production-end-to-end.ts]
- "production_productionendtoendvalidation_samestate": "sameState()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L203 | neighbors=[ProductionEndToEndValidation.ts, validateSnapshot()]
- "production_productionexecutionauthorization_hascycle": "hasCycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L116 | neighbors=[ProductionExecutionAuthorization.ts, evaluate()]
- "production_productionexecutionauthorization_publicidentifier": "publicIdentifier()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L124 | neighbors=[ProductionExecutionAuthorization.ts, result()]
- "production_productionexecutionauthorization_validpolicy": "validPolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L121 | neighbors=[ProductionExecutionAuthorization.ts, evaluate()]
- "production_productionexecutionconfirmation_bindingfromgrant": "bindingFromGrant()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L98 | neighbors=[ProductionExecutionConfirmation.ts, validate()]
- "production_productionexecutionconfirmation_bindingmismatch": "bindingMismatch()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L88 | neighbors=[ProductionExecutionConfirmation.ts, validate()]
- "production_productionexecutionconfirmation_buildfailure": "buildFailure()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L100 | neighbors=[ProductionExecutionConfirmation.ts, buildProductionExecutionConfirmationReq…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-093.json

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
