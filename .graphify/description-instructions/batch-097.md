# Node Description Batch 98 of 166

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

- "production_productionpipelineexecutioncanonicalruntime_snapshotcanonicalproductionpipelineexecutionruntime": "snapshotCanonicalProductionPipelineExecutionRuntime()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L49 | neighbors=[ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionConfiguratio…]
- "production_productionpipelineexecutionconfiguration_configurationfingerprint": "configurationFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L106 | neighbors=[ProductionPipelineExecutionConfiguratio…, configureScopedProductionPipelineExecut…]
- "production_productionpipelineexecutionconfiguration_createcanonicalcontinuationadmission": "createCanonicalContinuationAdmission()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L128 | neighbors=[ProductionPipelineExecutionConfiguratio…, configureProductionPipelineExecution()]
- "production_productionpipelineexecutionfactory_assertdirectorydescriptorparity": "assertDirectoryDescriptorParity()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1111 | neighbors=[ProductionPipelineExecutionFactory.ts, assertExactDirectoryDescriptor()]
- "production_productionpipelineexecutionfactory_assertexactdirectorydescriptor": "assertExactDirectoryDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1127 | neighbors=[ProductionPipelineExecutionFactory.ts, assertDirectoryDescriptorParity()]
- "production_productionpipelineexecutionfactory_assertexactfiledescriptor": "assertExactFileDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1137 | neighbors=[ProductionPipelineExecutionFactory.ts, assertFileDescriptorParity()]
- "production_productionpipelineexecutionfactory_assertexecutionscopematchesidentity": "assertExecutionScopeMatchesIdentity()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L876 | neighbors=[ProductionPipelineExecutionFactory.ts, readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_assertfiledescriptorparity": "assertFileDescriptorParity()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1119 | neighbors=[ProductionPipelineExecutionFactory.ts, assertExactFileDescriptor()]
- "production_productionpipelineexecutionfactory_authoritativedirectorynames": "authoritativeDirectoryNames()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1072 | neighbors=[ProductionPipelineExecutionFactory.ts, canonicalStoreRoot()]
- "production_productionpipelineexecutionfactory_deepfreeze": "deepFreeze()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1152 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution()]
- "production_productionpipelineexecutionfactory_descriptorboundfileoperations": "descriptorBoundFileOperations()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L964 | neighbors=[ProductionPipelineExecutionFactory.ts, createTrustedPersistenceReader()]
- "production_productionpipelineexecutionfactory_durableattemptlineagebindingerror": "durableAttemptLineageBindingError()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L717 | neighbors=[ProductionPipelineExecutionFactory.ts, resolveDurableAttemptOrdinal()]
- "production_productionpipelineexecutionfactory_readlatestversioned": "readLatestVersioned()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L665 | neighbors=[ProductionPipelineExecutionFactory.ts, readCompletedDurableRecords()]
- "production_productionpipelineexecutionfactory_readlatestversionedbinding": "readLatestVersionedBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L621 | neighbors=[ProductionPipelineExecutionFactory.ts, assertReconciledRetryLineageBinding()]
- "production_productionpipelineexecutionfactory_relativestorelocator": "relativeStoreLocator()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L1090 | neighbors=[ProductionPipelineExecutionFactory.ts, canonicalStoreRoot()]
- "production_productionpipelineexecutionfactory_runtypefromoperation": "runTypeFromOperation()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L891 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution()]
- "production_productionpipelineexecutioninstrumentation_poisonproductionpipelineexecutionplanafterdurableattempt": "poisonProductionPipelineExecutionPlanAfterDurableAttempt()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L71 | neighbors=[ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionInstrumentat…]
- "production_productionpipelineexecutioninstrumentation_productionpipelineexecutionevent": "ProductionPipelineExecutionEvent" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L3 | neighbors=[ProductionPipelineExecutionInstrumentat…, smoke-sprint-129-39-stage-bounded-resum…]
- "production_productionpipelineexecutioninstrumentation_productionpipelineexecutioneventdetail": "ProductionPipelineExecutionEventDetail" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L33 | neighbors=[ProductionPipelineExecutionInstrumentat…, smoke-sprint-129-39-stage-bounded-resum…]
- "production_productionpipelineretrybudgetextensiongate_verifydurablesiblingbindingforexecution": "verifyDurableSiblingBindingForExecution()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionGate.ts:L227 | neighbors=[ProductionPipelineRetryBudgetExtensionG…, verifyCanonicalPipelineRetryBudgetExten…]
- "production_productionpipelineretrybudgetextensionschema_computeretrybudgetextensionchallengepayload": "computeRetryBudgetExtensionChallengePayload()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L105 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensionschema_retrybudgetextensionreceiptstate": "RetryBudgetExtensionReceiptState" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L12 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…]
- "production_productionpipelineretrybudgetextensiontransaction_consumeretrybudgetextensionandprepareretry": "consumeRetryBudgetExtensionAndPrepareRetry()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionTransaction.ts:L38 | neighbors=[PipelineFailedStageRetry.ts, ProductionPipelineRetryBudgetExtensionT…]
- "production_productionpipelineretrybudgetextensiontransaction_recoverlingeringconsumingintent": "recoverLingeringConsumingIntent()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionTransaction.ts:L252 | neighbors=[ProductionPipelineRetryBudgetExtensionT…, smoke-sprint-129-36-retry-budget-extens…]
- "production_productionpipelineretryreconciliation_failure": "failure()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L289 | neighbors=[ProductionPipelineRetryReconciliation.ts, reconcileFailedPipelineExecution()]
- "production_productionpipelineretryreconciliation_mapsettlementfailure": "mapSettlementFailure()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L263 | neighbors=[ProductionPipelineRetryReconciliation.ts, reconcileFailedPipelineExecution()]
- "production_productionpipelineretryreconciliation_runtypefromoperation": "runTypeFromOperation()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L256 | neighbors=[ProductionPipelineRetryReconciliation.ts, reconcileFailedPipelineExecution()]
- "production_productionpipelineretryreconciliation_success": "success()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L278 | neighbors=[ProductionPipelineRetryReconciliation.ts, reconcileFailedPipelineExecution()]
- "production_productionpipelineterminalsettlement_boundedidentifier": "boundedIdentifier()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L601 | neighbors=[ProductionPipelineTerminalSettlement.ts, failedAttemptEvidence()]
- "production_productionpipelineterminalsettlement_boundedoperation": "boundedOperation()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L605 | neighbors=[ProductionPipelineTerminalSettlement.ts, failedAttemptEvidence()]
- "production_productionpipelineterminalsettlement_buildtransition": "buildTransition()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L493 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleSuccessfulProductionPipelineExecu…]
- "production_productionpipelineterminalsettlement_issettled": "isSettled()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L541 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleSuccessfulProductionPipelineExecu…]
- "production_productionpipelineterminalsettlement_latestartifact": "latestArtifact()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L965 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_latestartifacts": "latestArtifacts()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L1000 | neighbors=[ProductionPipelineTerminalSettlement.ts, settlePendingSuccessfulProductionPipeli…]
- "production_productionpipelineterminalsettlement_productionpipelinefailedsettlementattemptevidence": "ProductionPipelineFailedSettlementAttemptEvidence" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L86 | neighbors=[ProductionPipelineExecutionAdapter.ts, ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_productionpipelinefailedsettlementboundary": "ProductionPipelineFailedSettlementBoundary" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L69 | neighbors=[ProductionPipelineTerminalSettlement.ts, smoke-sprint-129-29-failed-terminal-set…]
- "production_productionpipelineterminalsettlement_productionpipelinefailedsettlementcontext": "ProductionPipelineFailedSettlementContext" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L102 | neighbors=[ProductionPipelineTerminalSettlement.ts, ProductionPipelineTerminalSettlementCon…]
- "production_productionpipelineterminalsettlement_productionpipelinefailedsettlementfailureboundary": "ProductionPipelineFailedSettlementFailureBoundary" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L78 | neighbors=[ProductionPipelineExecutionAdapter.ts, ProductionPipelineTerminalSettlement.ts]
- "production_productionpipelineterminalsettlement_productionpipelineterminalsettlementcontext": "ProductionPipelineTerminalSettlementContext" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L38 | neighbors=[ProductionPipelineTerminalSettlement.ts, ProductionPipelineFailedSettlementConte…]
- "production_productionpipelineterminalsettlement_readrecordwithreplay": "readRecordWithReplay()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L988 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleFailedProductionPipelineExecution…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-097.json

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
