# Node Description Batch 71 of 166

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

- "production_productionexecutionidempotency_transitionresult": "transitionResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L112 | neighbors=[ProductionExecutionIdempotency.ts, evaluateProductionExecutionIdempotencyT…, transitionEvaluation()]
- "production_productionexecutionidempotency_validatelease": "validateLease()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L107 | neighbors=[ProductionExecutionIdempotency.ts, transitionEvaluation(), canonicalDate()]
- "production_productionexecutionpersistence_arrays": "arrays()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L398 | neighbors=[ProductionExecutionPersistence.ts, authorizationShape(), transactionShape()]
- "production_productionexecutionpersistence_buildindex": "buildIndex()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L412 | neighbors=[ProductionExecutionPersistence.ts, digest(), .collectCanonicalRecords()]
- "production_productionexecutionpersistence_diagnostics": "diagnostics()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L400 | neighbors=[ProductionExecutionPersistence.ts, .rebuildIndex(), .write()]
- "production_productionexecutionpersistence_evaluateproductionexecutiondirectorydurability": "evaluateProductionExecutionDirectoryDurability()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L337 | neighbors=[ProductionExecutionPersistence.ts, directoryDurability(), smoke-production-execution-durable-reco…]
- "production_productionexecutionpersistence_failure": "failure()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L402 | neighbors=[ProductionExecutionPersistence.ts, .write(), writeFromExisting()]
- "production_productionexecutionpersistence_idempotencypolicy": "idempotencyPolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L391 | neighbors=[ProductionExecutionPersistence.ts, idempotencyRecordValid(), reservationValid()]
- "production_productionexecutionpersistence_indexresult": "indexResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L418 | neighbors=[ProductionExecutionPersistence.ts, .lookup(), .rebuildIndex()]
- "production_productionexecutionpersistence_indexshape": "indexShape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L417 | neighbors=[ProductionExecutionPersistence.ts, isRecord(), .readIndex()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_locateartifact": ".locateArtifact()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L326 | neighbors=[ProductionExecutionDurableRecoveryServi…, .apply(), artifactIdentity()]
- "production_productionexecutionpersistence_recoveryfinding": "recoveryFinding()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L410 | neighbors=[ProductionExecutionPersistence.ts, .inspectIndex(), .scan()]
- "production_productionexecutionpersistence_schemaof": "schemaOf()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L395 | neighbors=[ProductionExecutionPersistence.ts, isRecord(), validatePayload()]
- "production_productionexecutionpersistence_transactionintegrityvalid": "transactionIntegrityValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L388 | neighbors=[ProductionExecutionPersistence.ts, canonicalJson(), validatePayload()]
- "production_productionexecutionpersistence_trustedproductionexecutionpersistencefileoperations": "TrustedProductionExecutionPersistenceFileOperations" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L16 | neighbors=[ProductionExecutionPersistence.ts, smoke-production-execution-durable-stor…, smoke-production-execution-persistence.…]
- "production_productionexecutionpersistence_validkey": "validKey()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L396 | neighbors=[ProductionExecutionPersistence.ts, .read(), .write()]
- "production_productionexecutionpersistence_writefromexisting": "writeFromExisting()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L403 | neighbors=[ProductionExecutionPersistence.ts, .write(), failure()]
- "production_productionexecutionrecoverybootstrap_classifystores": "classifyStores()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L422 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, classify(), readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_counts": "counts()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L522 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, result(), semanticResult()]
- "production_productionexecutionrecoverybootstrap_loadattemptchains": "loadAttemptChains()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L246 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, safeIdentifier(), readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_normalizedate": "normalizeDate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L529 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, .bootstrapRecovery(), readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_orphaned": "orphaned()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L357 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, classify(), safeIdentifier()]
- "production_productionexecutionrecoverybootstrap_result": "result()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L513 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, .bootstrapRecovery(), counts()]
- "production_productionexecutionrecoverybootstrap_semanticresult": "semanticResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L484 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…, counts()]
- "production_productionexecutionsafetyplan_firstrealexecutioncandidate": "firstRealExecutionCandidate" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L77 | neighbors=[ProductionExecutionSafetyPlan.ts, smoke-production-execution-phase-review…, smoke-production-phase-closure.ts]
- "production_productionexecutionsafetyplan_productionactionriskprofiles": "productionActionRiskProfiles" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L69 | neighbors=[ProductionExecutionAuthorization.ts, ProductionExecutionSafetyPlan.ts, smoke-production-phase-closure.ts]
- "production_productionexecutionsafetyplan_productionexecutioninvariants": "productionExecutionInvariants" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L59 | neighbors=[ProductionExecutionSafetyPlan.ts, smoke-production-execution-phase-review…, smoke-production-phase-closure.ts]
- "production_productionexecutiontransaction_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…, validateProductionExecutionTransactionP…]
- "production_productionexecutiontransaction_fail": "fail()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…, msg()]
- "production_productionexecutiontransaction_out": "out()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, msg(), validateProductionExecutionTransactionP…]
- "production_productionexecutiontransaction_resourceerror": "resourceError()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L8 | neighbors=[ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…, validateProductionExecutionTransactionP…]
- "production_productionexecutionworker_defaultproductionexecutionworkerpolicy": "defaultProductionExecutionWorkerPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L5 | neighbors=[ProductionExecutionWorker.ts, smoke-production-execution-phase-review…, smoke-production-execution-worker.ts]
- "production_productionexecutionworker_finish": "finish()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L35 | neighbors=[ProductionExecutionWorker.ts, lifecycleRequest(), .execute()]
- "production_productionexecutionworker_lifecyclerequest": "lifecycleRequest()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L34 | neighbors=[ProductionExecutionWorker.ts, finish(), .execute()]
- "production_productionexecutionworker_maplifecycle": "mapLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L42 | neighbors=[ProductionExecutionWorker.ts, fromTerminal(), .execute()]
- "production_productionexecutionworker_output": "output()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L43 | neighbors=[ProductionExecutionWorker.ts, fromTerminal(), .execute()]
- "production_productionexecutionworker_saferesult": "safeResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L37 | neighbors=[ProductionExecutionWorker.ts, .execute(), unsafe()]
- "production_productionexecutionworker_unsafe": "unsafe()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L38 | neighbors=[ProductionExecutionWorker.ts, safeResult(), validateProductionExecutionWorkerResult…]
- "production_productionglobalterminalquiescence_readlatestversioned": "readLatestVersioned()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L365 | neighbors=[ProductionGlobalTerminalQuiescence.ts, escapeRegularExpression(), verifyTerminalLineageVersioned()]
- "production_productionglobalterminalquiescence_verifyterminallineageversioned": "verifyTerminalLineageVersioned()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L190 | neighbors=[ProductionGlobalTerminalQuiescence.ts, validateProductionGlobalTerminalQuiesce…, readLatestVersioned()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-070.json

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
