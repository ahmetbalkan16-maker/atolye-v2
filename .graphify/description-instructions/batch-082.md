# Node Description Batch 83 of 166

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

- "types_productionexecutiondurableattempt_productionexecutionattemptresult": "ProductionExecutionAttemptResult" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L13 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionCoordinator.ts, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionoutcomefinalizationrequest": "ProductionExecutionOutcomeFinalizationRequest" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L10 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionDurableAttempt.ts, ProductionExecutionOutcomeProposalReque…]
- "types_productionexecutiondurableattempt_productionexecutionoutcomeproposal": "ProductionExecutionOutcomeProposal" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L8 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimabandonrequest": "ProductionExecutionClaimAbandonRequest" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L21 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts, ProductionExecutionClaimReleaseRequest]
- "types_productionexecutiondurableclaim_productionexecutionclaimpolicy": "ProductionExecutionClaimPolicy" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L17 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionCoordinator.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimreasoncode": "ProductionExecutionClaimReasonCode" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L7 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionCoordinator.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimreleaserequest": "ProductionExecutionClaimReleaseRequest" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L20 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts, ProductionExecutionClaimAbandonRequest]
- "types_productionexecutiondurablelease_productionexecutiondurableleasepolicy": "ProductionExecutionDurableLeasePolicy" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L25 | neighbors=[ProductionExecutionDurableLease.ts, ProductionPipelineTerminalSettlement.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutiondurableleasereasoncode": "ProductionExecutionDurableLeaseReasonCode" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L6 | neighbors=[ProductionExecutionDurableLease.ts, productionExecutionCoordinator.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablestoragepolicy": "ProductionExecutionDurableStoragePolicy" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L8 | neighbors=[ProductionExecutionDurableStorage.ts, smoke-production-execution-durable-stor…, productionExecutionDurableStorage.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyreplayresult": "ProductionExecutionIdempotencyReplayResult" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L61 | neighbors=[ProductionExecutionIdempotency.ts, productionExecutionDurableStorage.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyschemaversion": "productionExecutionIdempotencySchemaVersion" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L5 | neighbors=[ProductionExecutionIdempotency.ts, smoke-production-execution-phase-review…, productionExecutionIdempotency.ts]
- "types_productionexecutionlifecycle_productionexecutionlifecyclemutationrequest": "ProductionExecutionLifecycleMutationRequest" | kind=code-symbol | source=src/types/productionExecutionLifecycle.ts:L6 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionExecutionLifecycle.ts, productionExecutionLifecycle.ts]
- "types_productionexecutionpersistence_productionexecutionpersistencelistresult": "ProductionExecutionPersistenceListResult" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L40 | neighbors=[ProductionExecutionPersistence.ts, smoke-sprint-129-30-persistence-boundar…, productionExecutionPersistence.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapattempt": "ProductionExecutionRecoveryBootstrapAttempt" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L24 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, smoke-production-runtime-startup.ts, productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionschemaversion": "productionExecutionTransactionSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L3 | neighbors=[ProductionExecutionTransaction.ts, smoke-production-execution-phase-review…, productionExecutionTransaction.ts]
- "types_productionhealth_productionhealthoverallseverity": "ProductionHealthOverallSeverity" | kind=code-symbol | source=src/types/productionHealth.ts:L20 | neighbors=[ProductionHealthEngine.ts, ProductionHealthPanel.tsx, productionHealth.ts]
- "types_productionhealth_productionhealthsourceconfidencelevel": "ProductionHealthSourceConfidenceLevel" | kind=code-symbol | source=src/types/productionHealth.ts:L68 | neighbors=[ProductionHealthFindingEvidence.tsx, ProductionHealthFindingsPanel.tsx, productionHealth.ts]
- "types_productionintelligence_productionactionpriority": "ProductionActionPriority" | kind=code-symbol | source=src/types/productionIntelligence.ts:L12 | neighbors=[ProductionActionEngine.ts, ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionintelligence_productionexecutionjobpreview": "ProductionExecutionJobPreview" | kind=code-symbol | source=src/types/productionIntelligence.ts:L100 | neighbors=[ProductionExecutionJobContract.ts, ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionintelligence_productionexecutionoperation": "ProductionExecutionOperation" | kind=code-symbol | source=src/types/productionIntelligence.ts:L85 | neighbors=[ProductionExecutionGateway.ts, ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionintelligence_productionexecutionvalidationresult": "ProductionExecutionValidationResult" | kind=code-symbol | source=src/types/productionIntelligence.ts:L79 | neighbors=[ProductionExecutionContract.ts, ProductionExecutionGateway.ts, productionIntelligence.ts]
- "types_productionintelligence_productionfindingref": "productionFindingRef()" | kind=code-symbol | source=src/types/productionIntelligence.ts:L122 | neighbors=[ProductionActionEngine.ts, ProductionDependencyGraph.ts, productionIntelligence.ts]
- "types_productionintelligence_productionintelligence": "ProductionIntelligence" | kind=code-symbol | source=src/types/productionIntelligence.ts:L113 | neighbors=[ProductionHealthService.ts, ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionoperationjournal_productionoperationjournalschemaversion": "productionOperationJournalSchemaVersion" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L1 | neighbors=[ProductionOperationJournal.ts, smoke-production-execution-phase-review…, productionOperationJournal.ts]
- "types_productionregeneration_productionregenerationfilefingerprint": "ProductionRegenerationFileFingerprint" | kind=code-symbol | source=src/types/productionRegeneration.ts:L13 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSto…, productionRegeneration.ts]
- "types_productionregeneration_productionregenerationplan": "ProductionRegenerationPlan" | kind=code-symbol | source=src/types/productionRegeneration.ts:L19 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, productionRegeneration.ts]
- "types_productionregeneration_productionregenerationpreparedreceipt": "ProductionRegenerationPreparedReceipt" | kind=code-symbol | source=src/types/productionRegeneration.ts:L69 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, productionRegeneration.ts]
- "types_productionregeneration_productionregenerationschemaversion": "productionRegenerationSchemaVersion" | kind=code-symbol | source=src/types/productionRegeneration.ts:L3 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, productionRegeneration.ts]
- "types_productionruntimehealth_productionruntimehealthresponse": "ProductionRuntimeHealthResponse" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L39 | neighbors=[route.ts, smoke-production-runtime-health-api.ts, productionRuntimeHealth.ts]
- "types_productionruntimeinitialization_productionruntimeinitializationbase": "ProductionRuntimeInitializationBase" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L21 | neighbors=[productionRuntimeInitialization.ts, ProductionRuntimeInitializationFailure, ProductionRuntimeInitializationSuccess]
- "types_productionruntimeinitialization_productionruntimeinitializationfailure": "ProductionRuntimeInitializationFailure" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L38 | neighbors=[ProductionRuntimeInitializer.ts, productionRuntimeInitialization.ts, ProductionRuntimeInitializationBase]
- "types_productionsnapshot_effectivestagestatus": "EffectiveStageStatus" | kind=code-symbol | source=src/types/productionSnapshot.ts:L55 | neighbors=[ProductionSnapshotContract.ts, ProductionSnapshotParts.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotfindingcode": "ProductionSnapshotFindingCode" | kind=code-symbol | source=src/types/productionSnapshot.ts:L187 | neighbors=[ProductionSnapshotParts.ts, productionHealth.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotfindingscope": "ProductionSnapshotFindingScope" | kind=code-symbol | source=src/types/productionSnapshot.ts:L178 | neighbors=[ProductionSnapshotParts.ts, productionHealth.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotfindingseverity": "ProductionSnapshotFindingSeverity" | kind=code-symbol | source=src/types/productionSnapshot.ts:L173 | neighbors=[ProductionSnapshotParts.ts, productionHealth.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotqueue": "ProductionSnapshotQueue" | kind=code-symbol | source=src/types/productionSnapshot.ts:L108 | neighbors=[ProductionSnapshotParts.ts, smoke-production-snapshot-contract.ts, productionSnapshot.ts]
- "types_productionworkerlifecycle_productionworkerlifecyclesnapshot": "ProductionWorkerLifecycleSnapshot" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L18 | neighbors=[ProductionWorkerLifecycle.ts, productionRuntimeInitialization.ts, productionWorkerLifecycle.ts]
- "types_productionworkerlifecycle_productionworkerlifecyclestate": "ProductionWorkerLifecycleState" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L5 | neighbors=[ProductionWorkerLifecycle.ts, productionRuntimeStatus.ts, productionWorkerLifecycle.ts]
- "types_project_projectpackageattemptmetadata": "ProjectPackageAttemptMetadata" | kind=code-symbol | source=src/types/project.ts:L69 | neighbors=[ProjectManager.ts, projectProgress.ts, project.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-082.json

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
