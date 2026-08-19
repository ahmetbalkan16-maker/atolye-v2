# Node Description Batch 133 of 166

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

- "production_productioncompletedstageregenerationstore_regenerationsupersessionintent": "RegenerationSupersessionIntent" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L278 | neighbors=[ProductionCompletedStageRegenerationSto…]
- "production_productioncontrolledexecutiongateway_names": "names" | kind=code-symbol | source=src/lib/production/ProductionControlledExecutionGateway.ts:L2 | neighbors=[ProductionControlledExecutionGateway.ts]
- "production_productiondependencygraph_reaches": "reaches()" | kind=code-symbol | source=src/lib/production/ProductionDependencyGraph.ts:L23 | neighbors=[ProductionDependencyGraph.ts]
- "production_productiondurableattemptlineageboundary_boundarycarrier": "BoundaryCarrier" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L60 | neighbors=[ProductionDurableAttemptLineageBoundary…]
- "production_productiondurableattemptlineageboundary_durableattemptlineageboundary": "durableAttemptLineageBoundary" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L58 | neighbors=[ProductionDurableAttemptLineageBoundary…]
- "production_productiondurableattemptlineageclassifier_productiondurableattemptlineageclassification": "ProductionDurableAttemptLineageClassification" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L27 | neighbors=[ProductionDurableAttemptLineageClassifi…]
- "production_productionendtoendvalidation_productionendtoendvalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L32 | neighbors=[ProductionEndToEndValidationError]
- "production_productionendtoendvalidation_productionendtoendvalidationresult": "ProductionEndToEndValidationResult" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L39 | neighbors=[ProductionEndToEndValidation.ts]
- "production_productionexecutionauthorization_actions": "actions" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L16 | neighbors=[ProductionExecutionAuthorization.ts]
- "production_productionexecutionauthorization_reasonmessages": "reasonMessages" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L17 | neighbors=[ProductionExecutionAuthorization.ts]
- "production_productionexecutionconfirmation_levels": "levels" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L6 | neighbors=[ProductionExecutionConfirmation.ts]
- "production_productionexecutionconfirmation_messages": "messages" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L9 | neighbors=[ProductionExecutionConfirmation.ts]
- "production_productionexecutionconfirmation_risks": "risks" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L7 | neighbors=[ProductionExecutionConfirmation.ts]
- "production_productionexecutionconfirmation_statuses": "statuses" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L8 | neighbors=[ProductionExecutionConfirmation.ts]
- "production_productionexecutioncontract_allowedactions": "allowedActions" | kind=code-symbol | source=src/lib/production/ProductionExecutionContract.ts:L6 | neighbors=[ProductionExecutionContract.ts]
- "production_productionexecutioncoordinator_productionexecutioncoordinator_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionCoordinator.ts:L12 | neighbors=[ProductionExecutionCoordinator]
- "production_productionexecutiondescriptorboundreadadapter_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L293 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_descriptorbindings": "descriptorBindings" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L48 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_directories": "directories" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L22 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_fileidentity": "FileIdentity" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L250 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutiondescriptorboundreadadapter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L91 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutiondescriptorboundreadadapter_write": ".write()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L108 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutionpersistenceadapter": "ProductionExecutionPersistenceAdapter" | kind=code-symbol | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutionreaddescriptor": "ProductionExecutionReadDescriptor" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L30 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutionreaddescriptorversion": "productionExecutionReadDescriptorVersion" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L27 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondescriptorboundreadadapter_registeredreaddescriptor": "RegisteredReadDescriptor" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L40 | neighbors=[ProductionExecutionDescriptorBoundReadA…]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L5 | neighbors=[AdapterBackedProductionExecutionAttempt…]
- "production_productionexecutiondurableattempt_escape": "escape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts]
- "production_productionexecutiondurableattempt_terminal": "terminal" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L4 | neighbors=[ProductionExecutionDurableAttempt.ts]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L14 | neighbors=[AdapterBackedProductionExecutionClaimSe…]
- "production_productionexecutiondurableclaim_terminal": "terminal" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L9 | neighbors=[ProductionExecutionDurableClaim.ts]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L12 | neighbors=[AdapterBackedProductionExecutionDurable…]
- "production_productionexecutiondurablelease_terminal": "terminal" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L7 | neighbors=[ProductionExecutionDurableLease.ts]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L14 | neighbors=[AdapterBackedProductionExecutionDurable…]
- "production_productionexecutiondurablestorage_productionexecutiondurablestorage": "ProductionExecutionDurableStorage" | kind=code-symbol | neighbors=[AdapterBackedProductionExecutionDurable…]
- "production_productionexecutiondurablestorage_terminal": "terminal" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L7 | neighbors=[ProductionExecutionDurableStorage.ts]
- "production_productionexecutiongateway_productionexecutiongateway_dryrun": ".dryRun()" | kind=code-symbol | source=src/lib/production/ProductionExecutionGateway.ts:L8 | neighbors=[ProductionExecutionGateway]
- "production_productionexecutiongateway_productionexecutiongateway_execute": ".execute()" | kind=code-symbol | source=src/lib/production/ProductionExecutionGateway.ts:L15 | neighbors=[ProductionExecutionGateway]
- "production_productionexecutiongateway_registry": "registry" | kind=code-symbol | source=src/lib/production/ProductionExecutionGateway.ts:L3 | neighbors=[ProductionExecutionGateway.ts]
- "production_productionexecutionidempotency_canonicaltransitions": "canonicalTransitions" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L7 | neighbors=[ProductionExecutionIdempotency.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-132.json

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
