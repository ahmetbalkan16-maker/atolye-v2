# Node Description Batch 96 of 166

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

- "production_productionexecutiondurablestorage_apply": "apply()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L29 | neighbors=[ProductionExecutionDurableStorage.ts, .transition()]
- "production_productionexecutiondurablestorage_escape": "escape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L30 | neighbors=[ProductionExecutionDurableStorage.ts, .versions()]
- "production_productionexecutiondurablestorage_installdurablestorageconstructiontesthook": "installDurableStorageConstructionTestHook()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L11 | neighbors=[ProductionExecutionDurableStorage.ts, smoke-sprint-129-33-exhausted-retry-adm…]
- "production_productionexecutiondurablestorage_message": "message()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L7 | neighbors=[ProductionExecutionDurableStorage.ts, out()]
- "production_productionexecutiondurablestorage_wrap": "wrap()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L28 | neighbors=[ProductionExecutionDurableStorage.ts, .createRecord()]
- "production_productionexecutionidempotency_failure": "failure()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L114 | neighbors=[ProductionExecutionIdempotency.ts, buildProductionExecutionIdempotencyIden…]
- "production_productionexecutionidempotency_replay": "replay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L113 | neighbors=[ProductionExecutionIdempotency.ts, evaluateProductionExecutionIdempotencyR…]
- "production_productionexecutionlifecycle_mapreason": "mapReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionLifecycle.ts:L18 | neighbors=[ProductionExecutionLifecycle.ts, .mutate()]
- "production_productionexecutionlifecycle_productionexecutionlifecycle_mutate": ".mutate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionLifecycle.ts:L11 | neighbors=[ProductionExecutionLifecycle, mapReason()]
- "production_productionexecutionpersistence_applyresult": "applyResult()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L419 | neighbors=[ProductionExecutionPersistence.ts, .apply()]
- "production_productionexecutionpersistence_directorydurability": "directoryDurability()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L420 | neighbors=[ProductionExecutionPersistence.ts, evaluateProductionExecutionDirectoryDur…]
- "production_productionexecutionpersistence_identityfromrecord": "identityFromRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L390 | neighbors=[ProductionExecutionPersistence.ts, idempotencyRecordValid()]
- "production_productionexecutionpersistence_normalize": "normalize()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L394 | neighbors=[ProductionExecutionPersistence.ts, canonicalJson()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_safeattempt": ".safeAttempt()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L334 | neighbors=[ProductionExecutionDurableRecoveryServi…, .rebuildIndex()]
- "production_productionexecutionpersistence_rebuildidempotencyidentity": "rebuildIdempotencyIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L389 | neighbors=[ProductionExecutionPersistence.ts, idempotencyRecordValid()]
- "production_productionexecutionpersistence_recoveryscan": "recoveryScan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L411 | neighbors=[ProductionExecutionPersistence.ts, .scan()]
- "production_productionexecutionpersistence_reservationbindingsmatch": "reservationBindingsMatch()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L386 | neighbors=[ProductionExecutionPersistence.ts, reservationValid()]
- "production_productionexecutionpersistence_validlookup": "validLookup()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L409 | neighbors=[ProductionExecutionPersistence.ts, .lookup()]
- "production_productionexecutionpersistence_withdiagnostics": "withDiagnostics()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L404 | neighbors=[ProductionExecutionPersistence.ts, .write()]
- "production_productionexecutionrecoverybootstrap_applyrecordreadfailures": "applyRecordReadFailures()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L216 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_derivestorepolicy": "deriveStorePolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L435 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_emptystorecounts": "emptyStoreCounts()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L480 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_emptystorestates": "emptyStoreStates()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L416 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_loadlatestidempotencyrecords": "loadLatestIdempotencyRecords()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L277 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_observerecordreads": "observeRecordReads()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L189 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, readProductionExecutionRecoverySemantic…]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoveryplannerport": "ProductionExecutionRecoveryPlannerPort" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L25 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, smoke-production-recovery-bootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystorepolicyentry": "ProductionExecutionRecoveryStorePolicyEntry" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L55 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_safetext": "safeText()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L537 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, .bootstrapRecovery()]
- "production_productionexecutionrecoverybootstrap_terminalexecutionstate": "terminalExecutionState()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L411 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, loadReservationAuthority()]
- "production_productionexecutionsafetyplan_productionexecutionroadmap": "productionExecutionRoadmap" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L79 | neighbors=[ProductionExecutionSafetyPlan.ts, smoke-production-phase-closure.ts]
- "production_productionexecutionsafetyplan_productionexecutionthreats": "productionExecutionThreats" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L35 | neighbors=[ProductionExecutionSafetyPlan.ts, smoke-production-phase-closure.ts]
- "production_productionexecutiontransaction_canonicalsteps": "canonicalSteps()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L7 | neighbors=[ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…]
- "production_productionexecutiontransaction_cycle": "cycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, validateProductionExecutionTransactionP…]
- "production_productionexecutiontransaction_hasorder": "hasOrder()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, validateProductionExecutionTransactionP…]
- "production_productionexecutionworker_buildproductionexecutionworkerplan": "buildProductionExecutionWorkerPlan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L7 | neighbors=[ProductionExecutionWorker.ts, smoke-production-execution-worker.ts]
- "production_productionexecutionworker_cancelled": "cancelled()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L38 | neighbors=[ProductionExecutionWorker.ts, .execute()]
- "production_productionexecutionworker_evaluateproductionexecutionworkerclaim": "evaluateProductionExecutionWorkerClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L6 | neighbors=[ProductionExecutionWorker.ts, smoke-production-execution-worker.ts]
- "production_productionexecutionworker_mapcoordination": "mapCoordination()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L42 | neighbors=[ProductionExecutionWorker.ts, .execute()]
- "production_productionexecutionworker_safefailurecode": "safeFailureCode()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L39 | neighbors=[ProductionExecutionWorker.ts, .execute()]
- "production_productionexecutionworker_sameidentity": "sameIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L41 | neighbors=[ProductionExecutionWorker.ts, .execute()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-095.json

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
