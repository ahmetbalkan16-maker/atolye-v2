# Node Description Batch 54 of 166

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

- "production_productionacceptancepreflight_requireclose": "requireClose()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L215 | neighbors=[ProductionAcceptancePreflight.ts, ProductionDurationPreflightError, validateProductionAcceptancePreflight(), validateProductionAcceptanceScriptDurat…]
- "production_productionacceptancetopic_productionacceptancetopicerror": "ProductionAcceptanceTopicError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L15 | neighbors=[ProductionAcceptanceTopic.ts, createProductionAcceptanceProjectSlug(), normalizeProductionAcceptanceTopic(), .constructor()]
- "production_productionactionengine_toaction": "toAction()" | kind=code-symbol | source=src/lib/production/ProductionActionEngine.ts:L21 | neighbors=[ProductionActionEngine.ts, .recommend(), actionTypeFor(), titleFor()]
- "production_productioncompletedstageregenerationpaths_regenerationdirectory": "regenerationDirectory()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPaths.ts:L18 | neighbors=[ProductionCompletedStageRegenerationPat…, regenerationRoot(), ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…]
- "production_productioncompletedstageregenerationpaths_regenerationroot": "regenerationRoot()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPaths.ts:L14 | neighbors=[ProductionCompletedStageRegenerationPat…, regenerationDirectory(), regenerationProjectFolder(), ProductionCompletedStageRegenerationSto…]
- "production_productioncompletedstageregenerationservice_assertmutation": "assertMutation()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L362 | neighbors=[ProductionCompletedStageRegenerationSer…, fileHash(), ProductionRegenerationPreparationError, safeProjectPath()]
- "production_productioncompletedstageregenerationservice_buildmutations": "buildMutations()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L242 | neighbors=[ProductionCompletedStageRegenerationSer…, createMutation(), ProductionRegenerationPreparationError, replaceMutation()]
- "production_productioncompletedstageregenerationservice_safeprojectpath": "safeProjectPath()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L428 | neighbors=[ProductionCompletedStageRegenerationSer…, applyMutation(), assertMutation(), ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationstore_collectregenerationstageoutputassetids": "collectRegenerationStageOutputAssetIds()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L398 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, recordRegeneratedPackageCompletion(), validateSupersessionIntent()]
- "production_productioncompletedstageregenerationstore_listregenerationexecutionbindings": "listRegenerationExecutionBindings()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L102 | neighbors=[ProductionCompletedStageRegenerationSto…, listRegenerationIds(), regenerationBindingForExecution(), ProductionDurableAttemptLineageClassifi…]
- "production_productioncompletedstageregenerationstore_validatepreservedaudio": "validatePreservedAudio()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L463 | neighbors=[ProductionCompletedStageRegenerationSto…, requireRegenerationExecutionAdmission(), buildAudioPreservationFingerprint(), readRegenerationIntent()]
- "production_productioncompletedstageregenerationstore_validateregeneratedpackagecompletionprecommit": "validateRegeneratedPackageCompletionPrecommit()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L292 | neighbors=[ProductionCompletedStageRegenerationSto…, readActiveRegenerationBinding(), validateSupersessionIntent(), ProjectManager.ts]
- "production_productiondependencygraph_productiondependencygraphbuilder": "ProductionDependencyGraphBuilder" | kind=code-symbol | source=src/lib/production/ProductionDependencyGraph.ts:L7 | neighbors=[ProductionDependencyGraph.ts, .build(), ProductionIntelligenceService.ts, smoke-production-dependency-graph.ts]
- "production_productiondeterminism_stableproductionvalue": "stableProductionValue()" | kind=code-symbol | source=src/lib/production/ProductionDeterminism.ts:L3 | neighbors=[ProductionActionEngine.ts, ProductionDeterminism.ts, stableProductionId(), ProductionPipelineExecutionFactory.ts]
- "production_productiondurableattemptlineageboundary_productiondurableattemptlineageboundary": "ProductionDurableAttemptLineageBoundary" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L9 | neighbors=[ProductionDurableAttemptLineageBoundary…, ProductionDurableAttemptLineageClassifi…, ProductionPipelineExecutionFactory.ts, smoke-production-durable-attempt-lineag…]
- "production_productiondurableattemptlineageclassifier_parseversionedlineagekey": "parseVersionedLineageKey()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L341 | neighbors=[ProductionDurableAttemptLineageClassifi…, readApplicableAttempts(), readApplicableClaims(), readApplicableRecords()]
- "production_productionendtoendvalidation_inspectaudio": "inspectAudio()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L224 | neighbors=[ProductionEndToEndValidation.ts, ProductionEndToEndValidationError, requireValid(), validateSnapshot()]
- "production_productionendtoendvalidation_inspectimage": "inspectImage()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L217 | neighbors=[ProductionEndToEndValidation.ts, ProductionEndToEndValidationError, requireValid(), validateSnapshot()]
- "production_productionendtoendvalidation_inspectthumbnail": "inspectThumbnail()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L232 | neighbors=[ProductionEndToEndValidation.ts, ProductionEndToEndValidationError, requireValid(), validateSnapshot()]
- "production_productionendtoendvalidation_validateproductionendtoend": "validateProductionEndToEnd()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L51 | neighbors=[ProductionEndToEndValidation.ts, ProductionEndToEndValidationError, requireValid(), smoke-production-end-to-end.ts]
- "production_productionexecutionauthorization_canonical": "canonical()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L107 | neighbors=[ProductionExecutionAuthorization.ts, evaluate(), resolveDependencies(), result()]
- "production_productionexecutionconfirmation_canonicaldate": "canonicalDate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L101 | neighbors=[ProductionExecutionConfirmation.ts, buildProductionExecutionConfirmationReq…, validate(), validationResult()]
- "production_productionexecutionconfirmation_productionexecutionconfirmationbindingfingerprint": "productionExecutionConfirmationBindingFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L21 | neighbors=[ProductionExecutionConfirmation.ts, buildProductionExecutionConfirmationReq…, validate(), smoke-production-execution-confirmation…]
- "production_productionexecutionconfirmation_validateproductionexecutionconfirmation": "validateProductionExecutionConfirmation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L47 | neighbors=[ProductionExecutionConfirmation.ts, validate(), validationResult(), smoke-production-execution-confirmation…]
- "production_productionexecutionconfirmation_validationresult": "validationResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L99 | neighbors=[ProductionExecutionConfirmation.ts, validate(), validateProductionExecutionConfirmation…, canonicalDate()]
- "production_productionexecutiondescriptorboundreadadapter_nodecode": "nodeCode()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L289 | neighbors=[ProductionExecutionDescriptorBoundReadA…, .listKeys(), .read(), readExactJson()]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutiondescriptorboundreadadapter_read": ".read()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L117 | neighbors=[ProductionExecutionDescriptorBoundReadA…, nodeCode(), .assertAuthority(), readExactJson()]
- "production_productionexecutiondescriptorboundreadadapter_reliable": "reliable()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L246 | neighbors=[ProductionExecutionDescriptorBoundReadA…, .listKeys(), readDirectoryIdentity(), readExactJson()]
- "production_productionexecutiondispatch_defaultproductionexecutiondispatchpolicy": "defaultProductionExecutionDispatchPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L2 | neighbors=[ProductionExecutionDispatch.ts, smoke-production-execution-dispatch.ts, smoke-production-execution-phase-review…, smoke-production-execution-worker.ts]
- "production_productionexecutiondispatch_evaluateproductionexecutiondispatcheligibility": "evaluateProductionExecutionDispatchEligibility()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L4 | neighbors=[ProductionExecutionDispatch.ts, date(), result(), smoke-production-execution-dispatch.ts]
- "production_productionexecutiondurableattempt_safe": "safe()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery(), safeEntry(), validAttempt()]
- "production_productionexecutiondurableattempt_safetext": "safeText()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, safeEntry(), safeOutcome(), canonicalAudioEvidence()]
- "production_productionexecutiondurableattemptintegrity_buildproductionexecutionattemptjournalentryintegrity": "buildProductionExecutionAttemptJournalEntryIntegrity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttemptIntegrity.ts:L17 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…, smoke-production-durable-attempt-lineag…]
- "production_productionexecutiondurableclaim_mappersistence": "mapPersistence()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L57 | neighbors=[ProductionExecutionDurableClaim.ts, .latestClaim(), .preflight(), mapWrite()]
- "production_productionexecutiondurableclaim_nonempty": "nonempty()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L58 | neighbors=[ProductionExecutionDurableClaim.ts, validClaim(), validPolicy(), validRequest()]
- "production_productionexecutiondurableclaim_withintegrity": "withIntegrity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L45 | neighbors=[ProductionExecutionDurableClaim.ts, .closeClaim(), buildClaim(), validClaim()]
- "production_productionexecutiondurablelease_buildlease": "buildLease()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L88 | neighbors=[ProductionExecutionDurableLease.ts, .acquire(), .takeover(), withIntegrity()]
- "production_productionexecutiondurablelease_ownershipreason": "ownershipReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L99 | neighbors=[ProductionExecutionDurableLease.ts, .heartbeat(), .release(), heartbeatReplay()]
- "production_productionexecutiondurablelease_validsession": "validSession()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L85 | neighbors=[ProductionExecutionDurableLease.ts, validateMutation(), date(), safe()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_validaterecord": ".validateRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L22 | neighbors=[AdapterBackedProductionExecutionDurable…, .createRecord(), .read(), validateProductionExecutionDurableRecor…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-053.json

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
