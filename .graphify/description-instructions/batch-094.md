# Node Description Batch 95 of 166

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

- "production_productionexecutionconfirmation_levelrank": "levelRank()" | kind=code-symbol | source=src/lib/production/ProductionExecutionConfirmation.ts:L102 | neighbors=[ProductionExecutionConfirmation.ts, validate()]
- "production_productionexecutioncontract_productionexecutioncontract_build": ".build()" | kind=code-symbol | source=src/lib/production/ProductionExecutionContract.ts:L8 | neighbors=[ProductionExecutionContract, .validate()]
- "production_productionexecutioncontract_productionexecutioncontract_validate": ".validate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionContract.ts:L12 | neighbors=[ProductionExecutionContract, .build()]
- "production_productionexecutioncoordinator_denied": "denied()" | kind=code-symbol | source=src/lib/production/ProductionExecutionCoordinator.ts:L37 | neighbors=[ProductionExecutionCoordinator.ts, .coordinate()]
- "production_productionexecutioncoordinator_productionexecutioncoordinator_coordinate": ".coordinate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionCoordinator.ts:L18 | neighbors=[ProductionExecutionCoordinator, denied()]
- "production_productionexecutiondescriptorboundreadadapter_assertcontained": "assertContained()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L276 | neighbors=[ProductionExecutionDescriptorBoundReadA…, createProductionExecutionReadDescriptor…]
- "production_productionexecutiondescriptorboundreadadapter_fingerprintidentity": "fingerprintIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L270 | neighbors=[ProductionExecutionDescriptorBoundReadA…, createProductionExecutionReadDescriptor…]
- "production_productionexecutiondescriptorboundreadadapter_samefileidentity": "sameFileIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L266 | neighbors=[ProductionExecutionDescriptorBoundReadA…, .assertAuthority()]
- "production_productionexecutiondispatch_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L5 | neighbors=[ProductionExecutionDispatch.ts, evaluateProductionExecutionDispatchElig…]
- "production_productionexecutiondispatch_result": "result()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L5 | neighbors=[ProductionExecutionDispatch.ts, evaluateProductionExecutionDispatchElig…]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_activeforclaim": ".activeForClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L16 | neighbors=[AdapterBackedProductionExecutionAttempt…, .preflight()]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_latestclaim": ".latestClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L14 | neighbors=[AdapterBackedProductionExecutionAttempt…, .links()]
- "production_productionexecutiondurableattempt_canonicalaudioevidence": "canonicalAudioEvidence()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, safeText()]
- "production_productionexecutiondurableattempt_entryequal": "entryEqual()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .appendAttemptJournal()]
- "production_productionexecutiondurableattempt_openreplay": "openReplay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .preflight()]
- "production_productionexecutiondurableattempt_recovery": "recovery()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery()]
- "production_productionexecutiondurableattempt_statefor": "stateFor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .finalizeExecutionOutcome()]
- "production_productionexecutiondurableattempt_statereason": "stateReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery()]
- "production_productionexecutiondurableattempt_validpolicy": "validPolicy()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .preflight()]
- "production_productionexecutiondurableattemptintegrity_buildproductionexecutionoutcomeproposalfingerprint": "buildProductionExecutionOutcomeProposalFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttemptIntegrity.ts:L30 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_activeclaimforrecord": ".activeClaimForRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L41 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .preflight()]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_releaseexecutionclaim": ".releaseExecutionClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L33 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .closeClaim()]
- "production_productionexecutiondurableclaim_assessment": "assessment()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L54 | neighbors=[ProductionExecutionDurableClaim.ts, .evaluateExecutionClaimRecovery()]
- "production_productionexecutiondurableclaim_claimreplay": "claimReplay()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L51 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurableclaim_conflict": "conflict()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L55 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurableclaim_escape": "escape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L58 | neighbors=[ProductionExecutionDurableClaim.ts, .latestClaim()]
- "production_productionexecutiondurableclaim_plan": "plan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L52 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurableclaim_validaterecordbindings": "validateRecordBindings()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L50 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurableclaim_validatereservation": "validateReservation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L49 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurableclaim_versionconflict": "versionConflict()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L55 | neighbors=[ProductionExecutionDurableClaim.ts, .preflight()]
- "production_productionexecutiondurablelease_acquisitionconflict": "acquisitionConflict()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L100 | neighbors=[ProductionExecutionDurableLease.ts, .acquire()]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_evaluatetakeover": ".evaluateTakeover()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L67 | neighbors=[AdapterBackedProductionExecutionDurable…, .evaluate()]
- "production_productionexecutiondurablelease_evaluation": "evaluation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L103 | neighbors=[ProductionExecutionDurableLease.ts, .evaluate()]
- "production_productionexecutiondurablelease_mapwrite": "mapWrite()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L105 | neighbors=[ProductionExecutionDurableLease.ts, .commit()]
- "production_productionexecutiondurablelease_reservationexpired": "reservationExpired()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L87 | neighbors=[ProductionExecutionDurableLease.ts, .acquire()]
- "production_productionexecutiondurablelease_safescope": "safeScope()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L106 | neighbors=[ProductionExecutionDurableLease.ts, validPolicy()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_findbyidempotencykey": ".findByIdempotencyKey()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L18 | neighbors=[AdapterBackedProductionExecutionDurable…, .find()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_findbyrequestid": ".findByRequestId()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L18 | neighbors=[AdapterBackedProductionExecutionDurable…, .find()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_releasereservation": ".releaseReservation()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L20 | neighbors=[AdapterBackedProductionExecutionDurable…, .transition()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_verifyintegrity": ".verifyIntegrity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L23 | neighbors=[AdapterBackedProductionExecutionDurable…, out()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-094.json

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
