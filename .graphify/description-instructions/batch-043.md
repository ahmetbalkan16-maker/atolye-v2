# Node Description Batch 44 of 166

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

- "production_productionacceptancepreflight_validateproductionsceneaudiomapping": "validateProductionSceneAudioMapping()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L121 | neighbors=[VideoAssemblyManager.ts, ProductionAcceptancePreflight.ts, positiveInteger(), ProductionSceneMappingError, smoke-sprint-128-1-production-acceptanc…]
- "production_productionacceptancereprepareservice_productionacceptancereprepareerror": "ProductionAcceptanceReprepareError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L43 | neighbors=[ProductionAcceptanceReprepareService.ts, .constructor(), reprepareProductionAcceptanceMarker(), smoke-sprint-129-24-acceptance-marker-r…, smoke-sprint-129-33-exhausted-retry-adm…]
- "production_productioncompletedstageregenerationplanner_productionregenerationplanerror": "ProductionRegenerationPlanError" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L46 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan(), .constructor(), requiredFileHash(), validateNoExternalPublication()]
- "production_productioncompletedstageregenerationservice_applymutation": "applyMutation()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L343 | neighbors=[ProductionCompletedStageRegenerationSer…, atomicReplace(), fileHash(), ProductionRegenerationPreparationError, safeProjectPath()]
- "production_productioncompletedstageregenerationservice_preparecompletedstageregeneration": "prepareCompletedStageRegeneration()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L67 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionRegenerationPreparationError, validateRequest(), run-production-regeneration.ts, smoke-sprint-129-41-completed-stage-reg…]
- "production_productioncompletedstageregenerationstore_isregenerationpackagecanonical": "isRegenerationPackageCanonical()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L194 | neighbors=[ProductionCompletedStageRegenerationSto…, readActiveRegenerationBinding(), readCanonicalPackageBinding(), sha256(), ProjectManager.ts]
- "production_productioncompletedstageregenerationstore_readcanonicalpackagebinding": "readCanonicalPackageBinding()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L174 | neighbors=[ProductionCompletedStageRegenerationSto…, isRegenerationPackageCanonical(), readActiveRegenerationBinding(), readJson(), smoke-sprint-129-41-completed-stage-reg…]
- "production_productioncompletedstageregenerationstore_readregenerationpreparedreceipt": "readRegenerationPreparedReceipt()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L55 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, readJson(), requireRegenerationExecutionAdmission()]
- "production_productioncompletedstageregenerationstore_writejsononce": "writeJsonOnce()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L436 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, recordRegeneratedPackageCompletion(), canonicalRegenerationJson(), writeOnce()]
- "production_productioncontrolledexecutiongateway_defaultproductioncontrolledexecutiongatewaypolicy": "defaultProductionControlledExecutionGatewayPolicy" | kind=code-symbol | source=src/lib/production/ProductionControlledExecutionGateway.ts:L2 | neighbors=[ProductionControlledExecutionGateway.ts, smoke-production-controlled-execution-g…, smoke-production-execution-durable-stor…, smoke-production-execution-persistence.…, smoke-production-execution-phase-review…]
- "production_productiondeterminism_canonicalproductionsecurityvalue": "canonicalProductionSecurityValue()" | kind=code-symbol | source=src/lib/production/ProductionDeterminism.ts:L23 | neighbors=[ProductionCompletedStageRegenerationSto…, ProductionDeterminism.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionIdentity.ts, smoke-sprint-129-28-production-acceptan…]
- "production_productionendtoendvalidation_inspectvideo": "inspectVideo()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L240 | neighbors=[ProductionEndToEndValidation.ts, inspectStructuralStreams(), ProductionEndToEndValidationError, requireValid(), validateSnapshot()]
- "production_productionexecutionauthorization_evaluateproductionexecutionauthorization": "evaluateProductionExecutionAuthorization()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L38 | neighbors=[ProductionExecutionAuthorization.ts, evaluate(), result(), smoke-production-execution-authorizatio…, smoke-production-execution-confirmation…]
- "production_productionexecutionauthorization_result": "result()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L86 | neighbors=[ProductionExecutionAuthorization.ts, evaluate(), evaluateProductionExecutionAuthorizatio…, canonical(), publicIdentifier()]
- "production_productionexecutionconfirmation_buildproductionexecutionconfirmationrequest": "buildProductionExecutionConfirmationRequest()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L25 | neighbors=[ProductionExecutionConfirmation.ts, buildFailure(), canonicalDate(), productionExecutionConfirmationBindingF…, smoke-production-execution-confirmation…]
- "production_productionexecutiondescriptorboundreadadapter_durableidentitychangederror": "DurableIdentityChangedError" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L205 | neighbors=[ProductionExecutionDescriptorBoundReadA…, .assertAuthority(), .listKeys(), readDirectoryIdentity(), readExactJson()]
- "production_productionexecutiondescriptorboundreadadapter_readdirectoryidentity": "readDirectoryIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L257 | neighbors=[ProductionExecutionDescriptorBoundReadA…, createProductionExecutionReadDescriptor…, .assertAuthority(), DurableIdentityChangedError, reliable()]
- "production_productionexecutiondurableattempt_isproductionexecutionterminalattemptstate": "isProductionExecutionTerminalAttemptState()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L4 | neighbors=[ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts, ProductionGlobalTerminalQuiescence.ts, smoke-production-durable-attempt-lineag…]
- "production_productionexecutiondurableattempt_safeoutcome": "safeOutcome()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .proposeExecutionOutcome(), date(), safeEvidence(), safeText()]
- "production_productionexecutiondurableattemptintegrity_buildproductionexecutionattemptbindingfingerprint": "buildProductionExecutionAttemptBindingFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttemptIntegrity.ts:L10 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…, smoke-production-durable-attempt-lineag…, smoke-sprint-129-34-queued-exhausted-ru…]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_abandonexecutionclaim": ".abandonExecutionClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L34 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .closeClaim(), .latestClaim(), operation(), releasePlan()]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_acquireexecutionclaim": ".acquireExecutionClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L31 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .preflight(), .writeClaim(), buildClaim(), operation()]
- "production_productionexecutiondurableclaim_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L58 | neighbors=[ProductionExecutionDurableClaim.ts, .closeClaim(), .evaluateExecutionClaimRecovery(), validClaim(), validRequest()]
- "production_productionexecutiondurableclaim_operation": "operation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L53 | neighbors=[ProductionExecutionDurableClaim.ts, .abandonExecutionClaim(), .acquireExecutionClaim(), .closeClaim(), .writeClaim()]
- "production_productionexecutiondurableclaim_safe": "safe()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L58 | neighbors=[ProductionExecutionDurableClaim.ts, .closeClaim(), .evaluateExecutionClaimRecovery(), validClaim(), validRequest()]
- "production_productionexecutiondurableclaim_validrequest": "validRequest()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L56 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight(), date(), nonempty(), safe()]
- "production_productionexecutiondurablelease_evaluateproductionexecutiondurableleaselifecycle": "evaluateProductionExecutionDurableLeaseLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L91 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionExecutionDurableLease.ts, .evaluate(), date(), validLease()]
- "production_productionexecutiondurablelease_withintegrity": "withIntegrity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L89 | neighbors=[ProductionExecutionDurableLease.ts, .heartbeat(), .release(), buildLease(), validLease()]
- "production_productionexecutiondurablestorage_isproductionexecutionterminaldurablerecordstate": "isProductionExecutionTerminalDurableRecordState()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L7 | neighbors=[ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableStorage.ts, ProductionGlobalTerminalQuiescence.ts, smoke-production-durable-attempt-lineag…]
- "production_productionexecutionidempotency_canonicaldate": "canonicalDate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L115 | neighbors=[ProductionExecutionIdempotency.ts, buildProductionExecutionIdempotencyIden…, evaluateProductionExecutionReservationL…, transitionEvaluation(), validateLease()]
- "production_productionexecutionidempotency_evaluateproductionexecutionidempotencytransition": "evaluateProductionExecutionIdempotencyTransition()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L63 | neighbors=[ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts, transitionEvaluation(), transitionResult(), smoke-production-execution-idempotency.…]
- "production_productionexecutionpersistence_artifactidentity": "artifactIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L407 | neighbors=[ProductionExecutionPersistence.ts, digest(), .inspectIndex(), .locateArtifact(), .scan()]
- "production_productionexecutionpersistence_authorizationshape": "authorizationShape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L384 | neighbors=[ProductionExecutionPersistence.ts, arrays(), isRecord(), strings(), reservationValid()]
- "production_productionexecutionpersistence_cleanup": "cleanup()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L401 | neighbors=[ProductionExecutionPersistence.ts, diagnostic(), errorCode(), .rebuildIndex(), .write()]
- "production_productionexecutionpersistence_digest": "digest()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L406 | neighbors=[ProductionExecutionPersistence.ts, artifactIdentity(), buildIndex(), canonicalJson(), .readIndex()]
- "production_productionexecutionpersistence_durableattemptvalid": "durableAttemptValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L382 | neighbors=[ProductionExecutionPersistence.ts, integer(), isRecord(), strings(), validatePayload()]
- "production_productionexecutionpersistence_durableclaimvalid": "durableClaimValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L381 | neighbors=[ProductionExecutionPersistence.ts, integer(), isRecord(), strings(), validatePayload()]
- "production_productionexecutionpersistence_durableleasevalid": "durableLeaseValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L380 | neighbors=[ProductionExecutionPersistence.ts, integer(), isRecord(), strings(), idempotencyRecordValid()]
- "production_productionexecutionpersistence_integrity": "integrity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L398 | neighbors=[ProductionExecutionPersistence.ts, idempotencyRecordValid(), isRecord(), journalShape(), transactionShape()]
- "production_productionexecutionpersistence_journalshape": "journalShape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L378 | neighbors=[ProductionExecutionPersistence.ts, integer(), integrity(), isRecord(), strings()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-043.json

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
