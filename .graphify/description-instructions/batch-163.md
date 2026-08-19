# Node Description Batch 164 of 166

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

- "types_productionexecutiondurableclaim_productionexecutionclaimidentity": "ProductionExecutionClaimIdentity" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L14 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimlifecyclestate": "ProductionExecutionClaimLifecycleState" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L6 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimownershipevidence": "ProductionExecutionClaimOwnershipEvidence" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L16 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimrecoveryclassification": "ProductionExecutionClaimRecoveryClassification" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L26 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutiondurableclaimschemaversion": "productionExecutionDurableClaimSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L4 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutiondurableclaimstorageversion": "productionExecutionDurableClaimStorageVersion" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L5 | neighbors=[productionExecutionDurableClaim.ts]
- "types_productionexecutiondurablelease_productionexecutiondurableleaseidentity": "ProductionExecutionDurableLeaseIdentity" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L17 | neighbors=[productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseconflictdiagnostic": "ProductionExecutionLeaseConflictDiagnostic" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L33 | neighbors=[productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseevaluationstate": "ProductionExecutionLeaseEvaluationState" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L32 | neighbors=[productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseownershipevidence": "ProductionExecutionLeaseOwnershipEvidence" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L18 | neighbors=[productionExecutionDurableLease.ts]
- "types_productionexecutiondurablerecovery_productionexecutiondirectorydurabilitystatus": "ProductionExecutionDirectoryDurabilityStatus" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L73 | neighbors=[productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionrecoveryartifactkind": "ProductionExecutionRecoveryArtifactKind" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L16 | neighbors=[productionExecutionDurableRecovery.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyfailuremetadata": "ProductionExecutionIdempotencyFailureMetadata" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L32 | neighbors=[productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyrecoverymetadata": "ProductionExecutionIdempotencyRecoveryMetadata" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L33 | neighbors=[productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyresultmetadata": "ProductionExecutionIdempotencyResultMetadata" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L31 | neighbors=[productionExecutionIdempotency.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecycleschemaversion": "productionExecutionLifecycleSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L3 | neighbors=[productionExecutionLifecycle.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecycletransition": "ProductionExecutionLifecycleTransition" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L4 | neighbors=[productionExecutionLifecycle.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapaction": "ProductionExecutionRecoveryBootstrapAction" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L13 | neighbors=[productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapschemaversion": "productionExecutionRecoveryBootstrapSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L3 | neighbors=[productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutionsafety_productioncapabilitystatus": "ProductionCapabilityStatus" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L3 | neighbors=[productionExecutionSafety.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionsteptype": "ProductionExecutionTransactionStepType" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L5 | neighbors=[productionExecutionTransaction.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionstrategy": "ProductionExecutionTransactionStrategy" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L4 | neighbors=[productionExecutionTransaction.ts]
- "types_productionexecutionworker_productionexecutionworkerclaim": "ProductionExecutionWorkerClaim" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L4 | neighbors=[productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkeridentity": "ProductionExecutionWorkerIdentity" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L3 | neighbors=[productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkertype": "ProductionExecutionWorkerType" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L2 | neighbors=[productionExecutionWorker.ts]
- "types_productionhealth_productionhealthevidence": "ProductionHealthEvidence" | kind=code-symbol | source=src/types/productionHealth.ts:L117 | neighbors=[productionHealth.ts]
- "types_productionhealth_productionhealthfindingcode": "ProductionHealthFindingCode" | kind=code-symbol | source=src/types/productionHealth.ts:L33 | neighbors=[productionHealth.ts]
- "types_productionhealth_productionhealthrulecontext": "ProductionHealthRuleContext" | kind=code-symbol | source=src/types/productionHealth.ts:L103 | neighbors=[productionHealth.ts]
- "types_productionhealth_productionhealthsummary": "ProductionHealthSummary" | kind=code-symbol | source=src/types/productionHealth.ts:L82 | neighbors=[productionHealth.ts]
- "types_productionintelligence_productionexecutionvalidationcode": "ProductionExecutionValidationCode" | kind=code-symbol | source=src/types/productionIntelligence.ts:L76 | neighbors=[productionIntelligence.ts]
- "types_productionintelligence_productionplanstatus": "ProductionPlanStatus" | kind=code-symbol | source=src/types/productionIntelligence.ts:L42 | neighbors=[productionIntelligence.ts]
- "types_productionoperationjournal_productionoperationjournalcorrelation": "ProductionOperationJournalCorrelation" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L3 | neighbors=[productionOperationJournal.ts]
- "types_productionruntimehealth_productionruntimehealthschemaversion": "productionRuntimeHealthSchemaVersion" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L3 | neighbors=[productionRuntimeHealth.ts]
- "types_productionruntimeinitialization_productionruntimeinitializationreasoncode": "ProductionRuntimeInitializationReasonCode" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L6 | neighbors=[productionRuntimeInitialization.ts]
- "types_productionruntimeinitialization_productionruntimeinitializationschemaversion": "productionRuntimeInitializationSchemaVersion" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L4 | neighbors=[productionRuntimeInitialization.ts]
- "types_productionruntimestatus_productionruntimestatusschemaversion": "productionRuntimeStatusSchemaVersion" | kind=code-symbol | source=src/types/productionRuntimeStatus.ts:L3 | neighbors=[productionRuntimeStatus.ts]
- "types_productionsnapshot_productionsnapshotdistribution": "ProductionSnapshotDistribution" | kind=code-symbol | source=src/types/productionSnapshot.ts:L143 | neighbors=[productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotsourcestates": "ProductionSnapshotSourceStates" | kind=code-symbol | source=src/types/productionSnapshot.ts:L217 | neighbors=[productionSnapshot.ts]
- "types_productionworkerlifecycle_productionworkerlifecyclereasoncode": "ProductionWorkerLifecycleReasonCode" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L6 | neighbors=[productionWorkerLifecycle.ts]
- "types_productionworkerlifecycle_productionworkerlifecycleschemaversion": "productionWorkerLifecycleSchemaVersion" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L3 | neighbors=[productionWorkerLifecycle.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-163.json

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
