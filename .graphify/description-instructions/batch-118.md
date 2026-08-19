# Node Description Batch 119 of 166

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

- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewaypolicy": "ProductionControlledExecutionGatewayPolicy" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L2 | neighbors=[ProductionControlledExecutionGateway.ts, productionControlledExecutionGateway.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewayreasoncode": "ProductionControlledExecutionGatewayReasonCode" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L4 | neighbors=[ProductionControlledExecutionGateway.ts, productionControlledExecutionGateway.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewayresult": "ProductionControlledExecutionGatewayResult" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L6 | neighbors=[ProductionControlledExecutionGateway.ts, productionControlledExecutionGateway.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewayschemaversion": "productionControlledExecutionGatewaySchemaVersion" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L1 | neighbors=[smoke-production-execution-phase-review…, productionControlledExecutionGateway.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewaystep": "ProductionControlledExecutionGatewayStep" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L5 | neighbors=[ProductionControlledExecutionGateway.ts, productionControlledExecutionGateway.ts]
- "types_productionexecutionauthorization_productionexecutionactortype": "ProductionExecutionActorType" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L6 | neighbors=[productionExecutionAuthorization.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationreasoncode": "ProductionExecutionAuthorizationReasonCode" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L10 | neighbors=[ProductionExecutionAuthorization.ts, productionExecutionAuthorization.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationbuildcontext": "ProductionExecutionConfirmationBuildContext" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L43 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationbuilderinput": "ProductionExecutionConfirmationBuilderInput" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L60 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationbuildresult": "ProductionExecutionConfirmationBuildResult" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L44 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationlevel": "ProductionExecutionConfirmationLevel" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L5 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationreasoncode": "ProductionExecutionConfirmationReasonCode" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L7 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationvalidationcontext": "ProductionExecutionConfirmationValidationContext" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L50 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationvalidationinput": "ProductionExecutionConfirmationValidationInput" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L47 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorreasoncode": "ProductionExecutionCoordinatorReasonCode" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L8 | neighbors=[ProductionExecutionCoordinator.ts, productionExecutionCoordinator.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorresult": "ProductionExecutionCoordinatorResult" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L20 | neighbors=[ProductionExecutionCoordinator.ts, productionExecutionCoordinator.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorstage": "ProductionExecutionCoordinatorStage" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L7 | neighbors=[ProductionExecutionCoordinator.ts, productionExecutionCoordinator.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchinput": "ProductionExecutionDispatchInput" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L4 | neighbors=[ProductionExecutionDispatch.ts, productionExecutionDispatch.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchpolicy": "ProductionExecutionDispatchPolicy" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L3 | neighbors=[ProductionExecutionDispatch.ts, productionExecutionDispatch.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchreasoncode": "ProductionExecutionDispatchReasonCode" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L5 | neighbors=[ProductionExecutionDispatch.ts, productionExecutionDispatch.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptcoordination": "ProductionExecutionAttemptCoordination" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L12 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptrecoveryresult": "ProductionExecutionAttemptRecoveryResult" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L14 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionjournalappendrequest": "ProductionExecutionJournalAppendRequest" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L10 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimconflict": "ProductionExecutionClaimConflict" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L22 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimcoordinationplan": "ProductionExecutionClaimCoordinationPlan" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L23 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimoperationresult": "ProductionExecutionClaimOperationResult" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L25 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimpreflightresult": "ProductionExecutionClaimPreflightResult" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L24 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimrecoveryassessment": "ProductionExecutionClaimRecoveryAssessment" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L27 | neighbors=[ProductionExecutionDurableClaim.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurablelease_productionexecutiondurableleaseschemaversion": "productionExecutionDurableLeaseSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L5 | neighbors=[ProductionExecutionDurableLease.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseevaluationrequest": "ProductionExecutionLeaseEvaluationRequest" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L31 | neighbors=[ProductionExecutionDurableLease.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseevaluationresult": "ProductionExecutionLeaseEvaluationResult" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L39 | neighbors=[ProductionExecutionDurableLease.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseoperationresult": "ProductionExecutionLeaseOperationResult" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L34 | neighbors=[ProductionExecutionDurableLease.ts, productionExecutionDurableLease.ts]
- "types_productionexecutiondurablerecovery_productionexecutionderivedindexversion": "productionExecutionDerivedIndexVersion" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L4 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionderivedlookupentry": "ProductionExecutionDerivedLookupEntry" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L37 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionderivedlookupindex": "ProductionExecutionDerivedLookupIndex" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L43 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutiondirectorydurabilityresult": "ProductionExecutionDirectoryDurabilityResult" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L74 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutiondurablerecoveryschemaversion": "productionExecutionDurableRecoverySchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L3 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionindexresult": "ProductionExecutionIndexResult" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L52 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionrecoveryapplyrequest": "ProductionExecutionRecoveryApplyRequest" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L61 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]
- "types_productionexecutiondurablerecovery_productionexecutionrecoveryapplyresult": "ProductionExecutionRecoveryApplyResult" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L66 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableRecovery.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-118.json

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
