# Node Description Batch 70 of 166

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

- "production_productioncontrolledexecutiongateway_evaluateproductioncontrolledexecutiongateway": "evaluateProductionControlledExecutionGateway()" | kind=code-symbol | source=src/lib/production/ProductionControlledExecutionGateway.ts:L3 | neighbors=[ProductionControlledExecutionGateway.ts, orchestration(), smoke-production-controlled-execution-g…]
- "production_productiondependencygraph_detectproductiondependencycycles": "detectProductionDependencyCycles()" | kind=code-symbol | source=src/lib/production/ProductionDependencyGraph.ts:L24 | neighbors=[ProductionDependencyGraph.ts, .build(), smoke-production-intelligence-phase-rev…]
- "production_productiondurableattemptlineageboundary_productiondurableattemptlineagebindinginvalidcode": "productionDurableAttemptLineageBindingInvalidCode" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L5 | neighbors=[ProductionAcceptanceCommand.ts, ProductionDurableAttemptLineageBoundary…, ProductionPipelineExecutionFactory.ts]
- "production_productiondurableattemptlineageclassifier_attemptbindingboundary": "attemptBindingBoundary()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L297 | neighbors=[ProductionDurableAttemptLineageClassifi…, durableAttemptOperationBindingBoundary(), classifyProductionDurableAttemptLineage…]
- "production_productiondurableattemptlineageclassifier_readapplicableattempts": "readApplicableAttempts()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L222 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…, parseVersionedLineageKey()]
- "production_productiondurableattemptlineageclassifier_readapplicableclaims": "readApplicableClaims()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L197 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…, parseVersionedLineageKey()]
- "production_productiondurableattemptlineageclassifier_readapplicablerecords": "readApplicableRecords()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L162 | neighbors=[ProductionDurableAttemptLineageClassifi…, classifyProductionDurableAttemptLineage…, parseVersionedLineageKey()]
- "production_productionendtoendvalidation_inspectstructuralstreams": "inspectStructuralStreams()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L255 | neighbors=[ProductionEndToEndValidation.ts, hasHandler(), inspectVideo()]
- "production_productionendtoendvalidation_requireasset": "requireAsset()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L211 | neighbors=[ProductionEndToEndValidation.ts, requireValid(), validateSnapshot()]
- "production_productionexecutionauthorization_defaultproductionexecutionauthorizationpolicy": "defaultProductionExecutionAuthorizationPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L31 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-execution-authorizatio…, smoke-production-execution-phase-review…]
- "production_productionexecutionauthorization_resolvedependencies": "resolveDependencies()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L111 | neighbors=[ProductionExecutionAuthorization.ts, evaluate(), canonical()]
- "production_productionexecutionconfirmation_defaultproductionexecutionconfirmationpolicy": "defaultProductionExecutionConfirmationPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L13 | neighbors=[ProductionExecutionConfirmation.ts, smoke-production-execution-confirmation…, smoke-production-execution-phase-review…]
- "production_productionexecutiondescriptorboundreadadapter_sameidentity": "sameIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L283 | neighbors=[ProductionExecutionDescriptorBoundReadA…, .listKeys(), readExactJson()]
- "production_productionexecutiondispatch_buildproductionexecutiondispatchenvelope": "buildProductionExecutionDispatchEnvelope()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L3 | neighbors=[ProductionExecutionDispatch.ts, smoke-production-execution-dispatch.ts, smoke-production-execution-worker.ts]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_openexecutionattempt": ".openExecutionAttempt()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L7 | neighbors=[AdapterBackedProductionExecutionAttempt…, .preflight(), .write()]
- "production_productionexecutiondurableattempt_bindingreason": "bindingReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L18 | neighbors=[ProductionExecutionDurableAttempt.ts, .preflight(), .transitionExecutionLifecycle()]
- "production_productionexecutiondurableattempt_classifyproductionexecutionattemptartifact": "classifyProductionExecutionAttemptArtifact()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L20 | neighbors=[ProductionExecutionDurableAttempt.ts, validAttempt(), smoke-production-execution-durable-atte…]
- "production_productionexecutiondurableattempt_journalsequencevalid": "journalSequenceValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L21 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery(), validAttempt()]
- "production_productionexecutiondurableattempt_mappersistence": "mapPersistence()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .latest(), mapWrite()]
- "production_productionexecutiondurableattempt_mapwrite": "mapWrite()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .write(), mapPersistence()]
- "production_productionexecutiondurableattempt_pathreason": "pathReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery(), .preflight()]
- "production_productionexecutiondurableattempt_safeevidence": "safeEvidence()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, safeEntry(), safeOutcome()]
- "production_productionexecutiondurableattempt_validopen": "validOpen()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .preflight(), date()]
- "production_productionexecutiondurableclaim_buildclaim": "buildClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L44 | neighbors=[ProductionExecutionDurableClaim.ts, .acquireExecutionClaim(), withIntegrity()]
- "production_productionexecutiondurableclaim_classifyproductionexecutionclaimartifact": "classifyProductionExecutionClaimArtifact()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L47 | neighbors=[ProductionExecutionDurableClaim.ts, validClaim(), smoke-production-execution-durable-clai…]
- "production_productionexecutiondurableclaim_mapstorage": "mapStorage()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L57 | neighbors=[ProductionExecutionDurableClaim.ts, .evaluateExecutionClaimRecovery(), .preflight()]
- "production_productionexecutiondurableclaim_mapwrite": "mapWrite()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L57 | neighbors=[ProductionExecutionDurableClaim.ts, .writeClaim(), mapPersistence()]
- "production_productionexecutiondurableclaim_releaseplan": "releasePlan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L52 | neighbors=[ProductionExecutionDurableClaim.ts, .abandonExecutionClaim(), .closeClaim()]
- "production_productionexecutiondurableclaim_validpolicy": "validPolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L56 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight(), nonempty()]
- "production_productionexecutiondurablelease_acquisitionreplay": "acquisitionReplay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L97 | neighbors=[ProductionExecutionDurableLease.ts, .acquire(), .takeover()]
- "production_productionexecutiondurablelease_heartbeatreplay": "heartbeatReplay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L98 | neighbors=[ProductionExecutionDurableLease.ts, .heartbeat(), ownershipReason()]
- "production_productionexecutiondurablelease_mapread": "mapRead()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L104 | neighbors=[ProductionExecutionDurableLease.ts, .evaluate(), .load()]
- "production_productionexecutiondurablelease_validateinterval": "validateInterval()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L83 | neighbors=[ProductionExecutionDurableLease.ts, .acquire(), .takeover()]
- "production_productionexecutiondurablelease_validpolicy": "validPolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L86 | neighbors=[ProductionExecutionDurableLease.ts, validateMutation(), safeScope()]
- "production_productionexecutiondurablelease_validworker": "validWorker()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L84 | neighbors=[ProductionExecutionDurableLease.ts, validateMutation(), safe()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_evaluatereplay": ".evaluateReplay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L21 | neighbors=[AdapterBackedProductionExecutionDurable…, .read(), out()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_findreservation": ".findReservation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L26 | neighbors=[AdapterBackedProductionExecutionDurable…, .createReservation(), .read()]
- "production_productionexecutiondurablestorage_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L30 | neighbors=[ProductionExecutionDurableStorage.ts, .createReservation(), validateProductionExecutionDurableRecor…]
- "production_productionexecutiondurablestorage_safe": "safe()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L30 | neighbors=[ProductionExecutionDurableStorage.ts, .read(), validateProductionExecutionDurableRecor…]
- "production_productionexecutionidempotency_evaluateproductionexecutionreservationlifecycle": "evaluateProductionExecutionReservationLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L23 | neighbors=[ProductionExecutionIdempotency.ts, canonicalDate(), ProductionExecutionRecoveryBootstrap.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-069.json

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
