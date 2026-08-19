# Node Description Batch 55 of 166

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

- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_versions": ".versions()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L24 | neighbors=[AdapterBackedProductionExecutionDurable…, .read(), escape(), out()]
- "production_productionexecutiondurablestorage_key": "key()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L30 | neighbors=[ProductionExecutionDurableStorage.ts, .createRecord(), .read(), .transition()]
- "production_productionexecutionidempotency_evaluateproductionexecutionrecoveryeligibility": "evaluateProductionExecutionRecoveryEligibility()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L96 | neighbors=[ProductionExecutionIdempotency.ts, evaluateProductionExecutionIdempotencyR…, transitionEvaluation(), smoke-production-execution-idempotency.…]
- "production_productionexecutionjobcontract_productionexecutionjobcontract": "ProductionExecutionJobContract" | kind=code-symbol | source=src/lib/production/ProductionExecutionJobContract.ts:L4 | neighbors=[ProductionExecutionJobContract.ts, .preview(), smoke-production-execution-job.ts, smoke-production-intelligence-phase-rev…]
- "production_productionexecutionpersistence_confirmationshape": "confirmationShape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L385 | neighbors=[ProductionExecutionPersistence.ts, isRecord(), strings(), reservationValid()]
- "production_productionexecutionpersistence_indexfile": "indexFile()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L408 | neighbors=[ProductionExecutionPersistence.ts, .inspectIndex(), .lookup(), .rebuildIndex()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_directory": ".directory()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L144 | neighbors=[ProductionExecutionFilePersistenceAdapt…, .listKeys(), .target(), .write()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_ensuredirectory": ".ensureDirectory()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L125 | neighbors=[ProductionExecutionFilePersistenceAdapt…, diagnostic(), errorCode(), .write()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_listkeys": ".listKeys()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L115 | neighbors=[ProductionExecutionFilePersistenceAdapt…, diagnostic(), errorCode(), .directory()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_read": ".read()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L107 | neighbors=[ProductionExecutionFilePersistenceAdapt…, .readCanonical(), .target(), validKey()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_target": ".target()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L145 | neighbors=[ProductionExecutionFilePersistenceAdapt…, .read(), .directory(), .write()]
- "production_productionexecutionrecoverybootstrap_classify": "classify()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L304 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, orphaned(), classifyStores(), readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_loadreservationauthority": "loadReservationAuthority()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L374 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, safeIdentifier(), terminalExecutionState(), readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_safeidentifier": "safeIdentifier()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L533 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, loadAttemptChains(), loadReservationAuthority(), orphaned()]
- "production_productionexecutiontransaction_msg": "msg()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L3 | neighbors=[ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…, fail(), out()]
- "production_productionexecutionworker_fromterminal": "fromTerminal()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L36 | neighbors=[ProductionExecutionWorker.ts, mapLifecycle(), output(), .execute()]
- "production_productionexecutionworker_validateproductionexecutionworkerresult": "validateProductionExecutionWorkerResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L8 | neighbors=[ProductionExecutionWorker.ts, unsafe(), smoke-production-execution-worker.ts, smoke-sprint-129-27-audio-remediation.ts]
- "production_productionhealthapiclient_isapierrorpayload": "isApiErrorPayload()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L193 | neighbors=[ProductionHealthApiClient.ts, getProductionHealth(), isProductionHealthErrorCode(), isRecord()]
- "production_productionhealthapiclient_iscounts": "isCounts()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L306 | neighbors=[ProductionHealthApiClient.ts, isFiniteNumber(), isRecord(), isHealthResult()]
- "production_productionhealthapiclient_isfinitenumber": "isFiniteNumber()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L381 | neighbors=[ProductionHealthApiClient.ts, isCounts(), isSourceConfidence(), isSummary()]
- "production_productionhealthapiclient_isproductionhealthapiconsumererror": "isProductionHealthApiConsumerError()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L158 | neighbors=[ProductionHealthApiClient.ts, smoke-production-health-api-consumer.ts, smoke-production-intelligence-review.ts, ProductionHealthPanel.tsx]
- "production_productionhealthapiclient_issnapshot": "isSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L206 | neighbors=[ProductionHealthApiClient.ts, isRecord(), isSourceState(), isSuccessPayload()]
- "production_productionhealthapiclient_issourceconfidence": "isSourceConfidence()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L316 | neighbors=[ProductionHealthApiClient.ts, isHealthResult(), isFiniteNumber(), isRecord()]
- "production_productionhealthapiclient_issourcestate": "isSourceState()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L269 | neighbors=[ProductionHealthApiClient.ts, isSnapshot(), isRecord(), isSourceStatus()]
- "production_productionhealthapiclient_issummary": "isSummary()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L294 | neighbors=[ProductionHealthApiClient.ts, isHealthResult(), isFiniteNumber(), isRecord()]
- "production_productionhealthengine_dedupefindings": "dedupeFindings()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L136 | neighbors=[ProductionHealthEngine.ts, findingIdentity(), severityRank(), .evaluate()]
- "production_productionhealtherror_toproductionhealtherror": "toProductionHealthError()" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L46 | neighbors=[ProductionHealthApiError.ts, ProductionHealthError.ts, isProductionHealthError(), ProductionHealthError]
- "production_productionintelligenceconsumer_parsegraph": "parseGraph()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L74 | neighbors=[ProductionIntelligenceConsumer.ts, isRecord(), parseArray(), parseProductionIntelligence()]
- "production_productionoperationjournal_projectproductionoperationjournalstate": "projectProductionOperationJournalState()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L6 | neighbors=[ProductionOperationJournal.ts, stateFor(), validateProductionOperationJournalSeque…, smoke-production-operation-journal.ts]
- "production_productionpipelineexecutionadapter_isauthenticproductionpipelinedurableexecutionerror": "isAuthenticProductionPipelineDurableExecutionError()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L75 | neighbors=[PipelineRunner.ts, ProductionAcceptanceCommand.ts, ProductionDurableAttemptLineageBoundary…, ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutioncanonicalruntime_assertprocesscanonicallockownership": "assertProcessCanonicalLockOwnership()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L224 | neighbors=[ProductionPipelineExecutionCanonicalRun…, executeCanonicalProductionPipelineStage…, installCanonicalProductionPipelineExecu…, restoreCanonicalProductionPipelineExecu…]
- "production_productionpipelineexecutionfactory_completedpreparationprovenancefingerprint": "completedPreparationProvenanceFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L776 | neighbors=[ProductionPipelineExecutionFactory.ts, digestStable(), expectedRunningEntry(), prepareProductionPipelineExecution()]
- "production_productionpipelineexecutionfactory_createtrustedpersistencereader": "createTrustedPersistenceReader()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L952 | neighbors=[ProductionPipelineExecutionFactory.ts, descriptorBoundFileOperations(), prepareProductionPipelineExecution(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_readcompleteddurablerecords": "readCompletedDurableRecords()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L643 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution(), readLatestVersioned(), readVerifiedCompletedProductionPipeline…]
- "production_productionpipelineexecutionfactory_resolvedurableattemptordinal": "resolveDurableAttemptOrdinal()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L704 | neighbors=[ProductionPipelineExecutionFactory.ts, prepareProductionPipelineExecution(), durableAttemptLineageBindingError(), smoke-production-durable-attempt-lineag…]
- "production_productionpipelineexecutionsemantics_productionpipelineexecutionauthorizationaction": "productionPipelineExecutionAuthorizationAction()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionSemantics.ts:L4 | neighbors=[ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionSemantics.ts, ProductionPipelineRetryAdmissionBinding…, smoke-sprint-129-41-completed-stage-reg…]
- "production_productionpipelineretryadmissionbinding_buildproductionpipelineretryadmissionbinding": "buildProductionPipelineRetryAdmissionBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryAdmissionBinding.ts:L38 | neighbors=[PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, ProductionPipelineRetryAdmissionBinding…, ProductionPipelineRetryBudgetExtensionT…]
- "production_productionpipelineretrybudgetextensionschema_buildproductionpipelineretrybudgetextensionbody": "buildProductionPipelineRetryBudgetExtensionBody()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L127 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, computeRetryBudgetExtensionAuthorityId(), ProductionPipelineRetryBudgetExtensionS…, smoke-sprint-129-36-retry-budget-extens…]
- "production_productionpipelineretrybudgetextensionschema_buildretrybudgetextensiondurablebinding": "buildRetryBudgetExtensionDurableBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L89 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionT…]
- "production_productionpipelineretrybudgetextensionschema_computeretrybudgetextensionauthorityid": "computeRetryBudgetExtensionAuthorityId()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L121 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, buildProductionPipelineRetryBudgetExten…, validateExtensionBodyIntegrity(), ProductionPipelineRetryBudgetExtensionS…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-054.json

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
