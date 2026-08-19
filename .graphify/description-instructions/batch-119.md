# Node Description Batch 120 of 166

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

- "types_productionexecutiondurablerecovery_productionexecutionrecoveryfinding": "ProductionExecutionRecoveryFinding" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L17 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionrecoveryreasoncode": "ProductionExecutionRecoveryReasonCode" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L6 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionrecoveryscanresult": "ProductionExecutionRecoveryScanResult" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L27 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurableoperationresult": "ProductionExecutionDurableOperationResult" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L10 | neighbors=[ProductionExecutionDurableStorage.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablestorage": "ProductionExecutionDurableStorage" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L11 | neighbors=[ProductionExecutionDurableStorage.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablestoragereasoncode": "ProductionExecutionDurableStorageReasonCode" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L7 | neighbors=[ProductionExecutionDurableStorage.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablestorageschemaversion": "productionExecutionDurableStorageSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L5 | neighbors=[ProductionExecutionDurableStorage.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablestorageversion": "productionExecutionDurableStorageVersion" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L6 | neighbors=[ProductionExecutionDurableStorage.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyidentitybuildcontext": "ProductionExecutionIdempotencyIdentityBuildContext" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L27 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyidentitybuildinput": "ProductionExecutionIdempotencyIdentityBuildInput" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L24 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyidentitybuildresult": "ProductionExecutionIdempotencyIdentityBuildResult" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L28 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyreasoncode": "ProductionExecutionIdempotencyReasonCode" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L8 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyreservationvalidationresult": "ProductionExecutionIdempotencyReservationValidationResult" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L48 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencytransitionresult": "ProductionExecutionIdempotencyTransitionResult" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L55 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionrecoveryeligibilityresult": "ProductionExecutionRecoveryEligibilityResult" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L67 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionrecoverymode": "ProductionExecutionRecoveryMode" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L7 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecyclepolicy": "ProductionExecutionLifecyclePolicy" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L7 | neighbors=[ProductionExecutionLifecycle.ts, productionExecutionLifecycle.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecyclereasoncode": "ProductionExecutionLifecycleReasonCode" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L5 | neighbors=[ProductionExecutionLifecycle.ts, productionExecutionLifecycle.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecycleresult": "ProductionExecutionLifecycleResult" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L8 | neighbors=[ProductionExecutionLifecycle.ts, productionExecutionLifecycle.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapplannerplan": "ProductionExecutionRecoveryBootstrapPlannerPlan" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L43 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstraprequest": "ProductionExecutionRecoveryBootstrapRequest" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L20 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutionsafety_productionactionriskprofile": "ProductionActionRiskProfile" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L36 | neighbors=[ProductionExecutionSafetyPlan.ts, productionExecutionSafety.ts]
- "types_productionexecutionsafety_productioncapability": "ProductionCapability" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L11 | neighbors=[ProductionExecutionSafetyPlan.ts, productionExecutionSafety.ts]
- "types_productionexecutionsafety_productionexecutioninvariant": "ProductionExecutionInvariant" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L34 | neighbors=[ProductionExecutionSafetyPlan.ts, productionExecutionSafety.ts]
- "types_productionexecutionsafety_productionexecutionroadmapitem": "ProductionExecutionRoadmapItem" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L50 | neighbors=[ProductionExecutionSafetyPlan.ts, productionExecutionSafety.ts]
- "types_productionexecutionsafety_productionexecutionthreat": "ProductionExecutionThreat" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L22 | neighbors=[ProductionExecutionSafetyPlan.ts, productionExecutionSafety.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionbuildresult": "ProductionExecutionTransactionBuildResult" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L11 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactioninput": "ProductionExecutionTransactionInput" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L10 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionpolicy": "ProductionExecutionTransactionPolicy" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L9 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionreasoncode": "ProductionExecutionTransactionReasonCode" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L12 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionstep": "ProductionExecutionTransactionStep" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L7 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionvalidationresult": "ProductionExecutionTransactionValidationResult" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L13 | neighbors=[ProductionExecutionTransaction.ts, productionExecutionTransaction.ts]
- "types_productionexecutionworker_productionexecutioncancellationsignal": "ProductionExecutionCancellationSignal" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L20 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerclaiminput": "ProductionExecutionWorkerClaimInput" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L6 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerclaimresult": "ProductionExecutionWorkerClaimResult" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L8 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerexecutionreasoncode": "ProductionExecutionWorkerExecutionReasonCode" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L16 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerexecutionstatus": "ProductionExecutionWorkerExecutionStatus" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L15 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerhandler": "ProductionExecutionWorkerHandler" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L19 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerhandlerresult": "ProductionExecutionWorkerHandlerResult" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L18 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerplan": "ProductionExecutionWorkerPlan" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L9 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-119.json

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
