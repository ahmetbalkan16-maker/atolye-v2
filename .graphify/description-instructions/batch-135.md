# Node Description Batch 136 of 166

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

- "production_productionpipelineexecutionconfiguration_productionpipelineexecutionconfigurationsnapshot": "ProductionPipelineExecutionConfigurationSnapshot" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L36 | neighbors=[ProductionPipelineExecutionConfiguratio…]
- "production_productionpipelineexecutionconfiguration_scopedproductionpipelineexecutionregistration": "ScopedProductionPipelineExecutionRegistration" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L42 | neighbors=[ProductionPipelineExecutionConfiguratio…]
- "production_productionpipelineexecutionfactory_bigintfilestat": "BigIntFileStat" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1095 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_completeddurablereadback": "CompletedDurableReadback" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L768 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_completedpreparations": "completedPreparations" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L120 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_completedproductionpipelinepreparation": "CompletedProductionPipelinePreparation" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L108 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_escaperegularexpression": "escapeRegularExpression()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L639 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_physicalstoreauthority": "PhysicalStoreAuthority" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L913 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_trustedfileoperations": "trustedFileOperations" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L94 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionfactory_trustedpersistenceprototype": "trustedPersistencePrototype" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L100 | neighbors=[ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutionidentity_secureid": "secureId()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionIdentity.ts:L37 | neighbors=[ProductionPipelineExecutionIdentity.ts]
- "production_productionpipelineexecutioninstrumentation_instrumentationstorage": "instrumentationStorage" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L53 | neighbors=[ProductionPipelineExecutionInstrumentat…]
- "production_productionpipelineexecutioninstrumentation_productionpipelineexecutioninstrumentation": "ProductionPipelineExecutionInstrumentation" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L45 | neighbors=[ProductionPipelineExecutionInstrumentat…]
- "production_productionpipelineexecutioninstrumentation_productionpipelineexecutionplanidentity": "ProductionPipelineExecutionPlanIdentity" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L26 | neighbors=[ProductionPipelineExecutionInstrumentat…]
- "production_productionpipelineretrybudgetextensiongate_retrybudgetextensiongateinput": "RetryBudgetExtensionGateInput" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionGate.ts:L27 | neighbors=[ProductionPipelineRetryBudgetExtensionG…]
- "production_productionpipelineretrybudgetextensiongate_retrybudgetextensiongatephase": "RetryBudgetExtensionGatePhase" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionGate.ts:L22 | neighbors=[ProductionPipelineRetryBudgetExtensionG…]
- "production_productionpipelineretrybudgetextensiongate_retrybudgetextensiongateresult": "RetryBudgetExtensionGateResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionGate.ts:L38 | neighbors=[ProductionPipelineRetryBudgetExtensionG…]
- "production_productionpipelineretrybudgetextensionschema_retrybudgetextensionpolicyversion": "retryBudgetExtensionPolicyVersion" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L10 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionschema_retrybudgetextensionschemaversion": "retryBudgetExtensionSchemaVersion" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L9 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionservice_authoritychallengepayloadfrompublished": "authorityChallengePayloadFromPublished()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionService.ts:L34 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionservice_retrybudgetextensionapplyresult": "RetryBudgetExtensionApplyResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionService.ts:L74 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionservice_retrybudgetextensionplanresult": "RetryBudgetExtensionPlanResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionService.ts:L61 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionstore_retrybudgetextensionstoreresult": "RetryBudgetExtensionStoreResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionStore.ts:L15 | neighbors=[ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensiontransaction_extensiontransactionresult": "ExtensionTransactionResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionTransaction.ts:L20 | neighbors=[ProductionPipelineRetryBudgetExtensionT…]
- "production_productionpipelineretryreconciliation_productionpipelineretryreconciliationreasoncode": "ProductionPipelineRetryReconciliationReasonCode" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L32 | neighbors=[ProductionPipelineRetryReconciliation.ts]
- "production_productionpipelineretryreconciliation_productionpipelineretryreconciliationresult": "ProductionPipelineRetryReconciliationResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L44 | neighbors=[ProductionPipelineRetryReconciliation.ts]
- "production_productionpipelineterminalsettlement_faileddenied": "failedDenied()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L553 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_failedsettlementauthorityinventory": "FailedSettlementAuthorityInventory" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L877 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_failedsettlementlocks": "failedSettlementLocks" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L111 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_productionpipelinefailedsettlementstep": "ProductionPipelineFailedSettlementStep" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L61 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_productionpipelineterminalsettlementresult": "ProductionPipelineTerminalSettlementResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L47 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_sameretrybudgetextensionbinding": "sameRetryBudgetExtensionBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L804 | neighbors=[ProductionPipelineTerminalSettlement.ts]
- "production_productionplanner_stagerank": "stageRank()" | kind=code-symbol | source=src/lib/production/ProductionPlanner.ts:L20 | neighbors=[ProductionPlanner.ts]
- "production_productionqueuedexhausteddriftclassifier_queuedexhausteddriftclassification": "QueuedExhaustedDriftClassification" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L20 | neighbors=[ProductionQueuedExhaustedDriftClassifie…]
- "production_productionqueuedexhausteddriftrecovery_dependencies": "Dependencies" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L38 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…]
- "production_productionqueuedexhausteddriftrecovery_productionqueuedexhausteddriftrecoveryoptions": "ProductionQueuedExhaustedDriftRecoveryOptions" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L13 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…]
- "production_productionqueuedexhausteddriftrecovery_productionqueuedexhausteddriftrecoveryresult": "ProductionQueuedExhaustedDriftRecoveryResult" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L19 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…]
- "production_productionreadinessservice_probeworkspace": "ProbeWorkspace" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L400 | neighbors=[ProductionReadinessService.ts]
- "production_productionreadinessservice_productionreadinessdependencies": "ProductionReadinessDependencies" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L77 | neighbors=[ProductionReadinessService.ts]
- "production_productionreadinessservice_productionreadinessservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L96 | neighbors=[ProductionReadinessService]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-135.json

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
