# Node Description Batch 72 of 166

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

- "production_productionhealthapiclient_issnapshotstage": "isSnapshotStage()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L243 | neighbors=[ProductionHealthApiClient.ts, isProductionStage(), isRecord()]
- "production_productionhealthapiclient_issourcestatus": "isSourceStatus()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L282 | neighbors=[ProductionHealthApiClient.ts, isSourceState(), isRecord()]
- "production_productionhealthengine_calculatesourceconfidence": "calculateSourceConfidence()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L75 | neighbors=[ProductionHealthEngine.ts, aggregateStageOutputs(), .evaluate()]
- "production_productionhealthengine_findingidentity": "findingIdentity()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L148 | neighbors=[ProductionHealthEngine.ts, dedupeFindings(), stableEvidence()]
- "production_productionintelligenceconsumer_isoptionalstring": "isOptionalString()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L146 | neighbors=[ProductionIntelligenceConsumer.ts, parseExecutionPreview(), parseJobPreview()]
- "production_productionintelligenceconsumer_parseedge": "parseEdge()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L92 | neighbors=[ProductionIntelligenceConsumer.ts, isRecord(), isStage()]
- "production_productionintelligenceconsumer_parseinputdescriptor": "parseInputDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L139 | neighbors=[ProductionIntelligenceConsumer.ts, isRecord(), isString()]
- "production_productionintelligenceconsumer_parseoutputdescriptor": "parseOutputDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L140 | neighbors=[ProductionIntelligenceConsumer.ts, isRecord(), isString()]
- "production_productionlegacypipelineexecutionidentity_buildversionedproductionpipelineexecutionidentity": "buildVersionedProductionPipelineExecutionIdentity()" | kind=code-symbol | source=src/lib/production/ProductionLegacyPipelineExecutionIdentity.ts:L28 | neighbors=[ProductionGlobalTerminalQuiescence.ts, ProductionLegacyPipelineExecutionIdenti…, smoke-sprint-129-35-legacy-global-quies…]
- "production_productionoperationjournal_productionoperationjournaleventtypes": "productionOperationJournalEventTypes" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L2 | neighbors=[ProductionOperationJournal.ts, smoke-production-execution-phase-review…, smoke-production-operation-journal.ts]
- "production_productionpipelineexecutioncanonicalruntime_executecanonicalproductionpipelinestage": "executeCanonicalProductionPipelineStage()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L103 | neighbors=[ProductionPipelineExecutionCanonicalRun…, assertProcessCanonicalLockOwnership(), ProductionPipelineExecutionFactory.ts]
- "production_productionpipelineexecutioncanonicalruntime_restorecanonicalproductionpipelineexecutionruntime": "restoreCanonicalProductionPipelineExecutionRuntime()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L54 | neighbors=[ProductionPipelineExecutionCanonicalRun…, assertProcessCanonicalLockOwnership(), ProductionPipelineExecutionConfiguratio…]
- "production_productionpipelineexecutionconfiguration_restoreproductionpipelineexecutionconfiguration": "restoreProductionPipelineExecutionConfiguration()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L89 | neighbors=[ProductionPipelineExecutionConfiguratio…, configureScopedProductionPipelineExecut…, snapshotProductionPipelineExecutionConf…]
- "production_productionpipelineexecutionfactory_assertcompletedbindings": "assertCompletedBindings()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L680 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_assertcompletedcanonicalidentitybindings": "assertCompletedCanonicalIdentityBindings()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L723 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_assertexpecteddescriptor": "assertExpectedDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1097 | neighbors=[ProductionPipelineExecutionFactory.ts, canonicalStoreRoot(), physicalDescriptorIdentity()]
- "production_productionpipelineexecutionfactory_assertreconciledretrylineagebinding": "assertReconciledRetryLineageBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L601 | neighbors=[ProductionPipelineExecutionFactory.ts, readLatestVersionedBinding(), prepareProductionPipelineExecution()]
- "production_productionpipelineexecutionfactory_completedpreparationissuancefingerprint": "completedPreparationIssuanceFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L849 | neighbors=[ProductionPipelineExecutionFactory.ts, digestStable(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_completedpreparationtransition": "completedPreparationTransition()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L804 | neighbors=[ProductionPipelineExecutionFactory.ts, expectedRunningEntry(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_expectedrunningentry": "expectedRunningEntry()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L836 | neighbors=[ProductionPipelineExecutionFactory.ts, completedPreparationProvenanceFingerpri…, completedPreparationTransition()]
- "production_productionpipelineexecutionfactory_installcanonicalproductionpipelineexecution": "installCanonicalProductionPipelineExecution()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L132 | neighbors=[ProductionPipelineExecutionConfiguratio…, ProductionPipelineExecutionFactory.ts, smoke-production-worker-lifecycle.ts]
- "production_productionpipelineexecutionfactory_physicaldescriptoridentity": "physicalDescriptorIdentity()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L942 | neighbors=[ProductionPipelineExecutionFactory.ts, assertExpectedDescriptor(), digestStable()]
- "production_productionpipelineretryadmissionbinding_productionpipelineretryadmissionbinding": "ProductionPipelineRetryAdmissionBinding" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryAdmissionBinding.ts:L19 | neighbors=[PipelineRetryAdmission.ts, ProductionPipelineRetryAdmissionBinding…, smoke-sprint-129-36-retry-budget-extens…]
- "production_productionpipelineretrybudgetextensionschema_productionpipelineretrybudgetextensionchallengepayload": "ProductionPipelineRetryBudgetExtensionChallengePayload" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L14 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionB…, ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionschema_productionpipelineretrybudgetextensionreceipt": "ProductionPipelineRetryBudgetExtensionReceipt" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L76 | neighbors=[ProductionPipelineRetryBudgetExtensionG…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineterminalsettlement_allowed": "allowed()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L545 | neighbors=[ProductionPipelineTerminalSettlement.ts, settlePendingSuccessfulProductionPipeli…, settleSuccessfulProductionPipelineExecu…]
- "production_productionpipelineterminalsettlement_authorityinventoryfailure": "authorityInventoryFailure()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L949 | neighbors=[ProductionPipelineTerminalSettlement.ts, readFailedSettlementAuthorityInventory(), readLatestVersionedAuthorities()]
- "production_productionpipelineterminalsettlement_denied": "denied()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L549 | neighbors=[ProductionPipelineTerminalSettlement.ts, settlePendingSuccessfulProductionPipeli…, settleSuccessfulProductionPipelineExecu…]
- "production_productionpipelineterminalsettlement_finalizeproductionpipelineretrybudgetextensionsettlement": "finalizeProductionPipelineRetryBudgetExtensionSettlement()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L821 | neighbors=[ProductionPipelineTerminalSettlement.ts, receiptBindingFailure(), settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_readlatestversionedauthorities": "readLatestVersionedAuthorities()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L914 | neighbors=[ProductionPipelineTerminalSettlement.ts, readFailedSettlementAuthorityInventory(), authorityInventoryFailure()]
- "production_productionplanner_productionplanner": "ProductionPlanner" | kind=code-symbol | source=src/lib/production/ProductionPlanner.ts:L6 | neighbors=[ProductionIntelligenceService.ts, ProductionPlanner.ts, .create()]
- "production_productionreadinessservice_comparablepath": "comparablePath()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L708 | neighbors=[ProductionReadinessService.ts, createProbeWorkspace(), requireSafeProbeRoot()]
- "production_productionreadinessservice_isinside": "isInside()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L707 | neighbors=[ProductionReadinessService.ts, probeStorage(), requireSafeProbeRoot()]
- "production_productionreadinessservice_normalizechecks": "normalizeChecks()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L660 | neighbors=[ProductionReadinessService.ts, check(), .evaluate()]
- "production_productionreadinessservice_probestorageadapters": "probeStorageAdapters()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L473 | neighbors=[ProductionReadinessService.ts, probeStorage(), readinessPng()]
- "production_productionreadinessservice_productionreadinessservice_environmentcheck": ".environmentCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L171 | neighbors=[ProductionReadinessService, check(), .evaluate()]
- "production_productionreadinessservice_productionreadinessservice_providerendpointcheck": ".providerEndpointCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L283 | neighbors=[ProductionReadinessService, .evaluate(), check()]
- "production_productionreadinessservice_productionreadinessservice_runtimechecks": ".runtimeChecks()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L298 | neighbors=[ProductionReadinessService, .evaluate(), check()]
- "production_productionreadinessservice_removeprobeworkspace": "removeProbeWorkspace()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L550 | neighbors=[ProductionReadinessService.ts, .evaluate(), removeSafeProbeRoot()]
- "production_productionreadinessservice_replacecheck": "replaceCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L655 | neighbors=[ProductionReadinessService.ts, probeStorage(), .evaluate()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-071.json

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
