# Node Description Batch 39 of 166

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

- "runtime_runtimestoragepaths_runtimestorageauthoritylease": "RuntimeStorageAuthorityLease" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L81 | neighbors=[AudioCompensationStore.ts, AudioPublicationIntentStore.ts, ProductionAcceptanceLegacyReauthorizati…, RuntimeStoragePaths.ts, smoke-sprint-129-27-audio-remediation.ts, AudioStorage.ts]
- "runtime_runtimestoragepaths_validateexistingdirectory": "validateExistingDirectory()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L631 | neighbors=[RuntimeStoragePaths.ts, assertProjectWriteAuthorityLease(), requireExactRealDirectory(), RuntimeStorageError, samePath(), validateSafeAncestorChain()]
- "script_page": "page.tsx" | kind=code-symbol | source=app/script/page.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, Sidebar.tsx, ScriptCard(), ScriptPage(), script.ts, ScriptData]
- "scripts_run_canonical_smoke_child": "run-canonical-smoke-child.ts" | kind=code-symbol | source=scripts/run-canonical-smoke-child.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), main(), waitForNestedFoundationFinalization(), withTimeout()]
- "scripts_smoke_pipeline_orchestration_testcancellationdoesnotenqueue": "testCancellationDoesNotEnqueue()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L125 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testcompletedenqueuesnextstage": "testCompletedEnqueuesNextStage()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L75 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testconcurrentcompletionisidempotent": "testConcurrentCompletionIsIdempotent()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L279 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testduplicatecompletiondoesnotduplicate": "testDuplicateCompletionDoesNotDuplicate()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L91 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testexistingactivedownstreamdoesnotduplicate": "testExistingActiveDownstreamDoesNotDuplicate()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L172 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testfailuredoesnotenqueue": "testFailureDoesNotEnqueue()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L107 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testhistorywritefailurekeepsorchestrationpersistence": "testHistoryWriteFailureKeepsOrchestrationPersistence()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L218 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testincompletestagedoesnotenqueue": "testIncompleteStageDoesNotEnqueue()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L141 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_orchestration_testretrycompletiondoesnotmultiplydownstream": "testRetryCompletionDoesNotMultiplyDownstream()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L196 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), jobsForStage(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_state_corruption_writeraw": "writeRaw()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L57 | neighbors=[smoke-pipeline-state-corruption.ts, testMalformedHistory(), testMalformedJobs(), testStructurallyInvalidHistory(), testStructurallyInvalidJobs(), testValidPayloads()]
- "scripts_smoke_pipeline_state_error_contract_testvalidresponses": "testValidResponses()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L325 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), history(), jobs(), readResponse(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_writeraw": "writeRaw()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L94 | neighbors=[smoke-pipeline-state-error-contract.ts, testInvalidHistory(), testInvalidJobs(), testMalformedHistory(), testMalformedJobs(), testValidResponses()]
- "scripts_smoke_production_end_to_end_stabilization_pass": "pass()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L277 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), happyPathAndReplay(), mutateAssets(), reconciliationAndRestart(), recoveryPlannerConsistency()]
- "scripts_smoke_production_end_to_end_stabilization_run": "run()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L38 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), happyPathAndReplay(), reconciliationAndRestart(), recoveryPlannerConsistency(), setup()]
- "scripts_smoke_production_end_to_end_storedaudioprovider": "StoredAudioProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L242 | neighbors=[smoke-production-end-to-end.ts, run(), AudioProvider, .createImmutableAudioDispatchAdapter(), .generateAudio(), .validateInput()]
- "scripts_smoke_production_end_to_end_storedthumbnailprovider": "StoredThumbnailProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L271 | neighbors=[smoke-production-end-to-end.ts, run(), .createImmutableThumbnailDispatchAdapte…, .generateThumbnailAsset(), .generateThumbnailPlan(), ThumbnailProvider]
- "scripts_smoke_production_publish_reconciliation_hardening_canonicalandreceiptpaths": "canonicalAndReceiptPaths()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L224 | neighbors=[smoke-production-publish-reconciliation…, matchedRecord(), pass(), publishingIntent(), resetPublish(), main()]
- "scripts_smoke_production_publish_reconciliation_hardening_failclosedoutcomes": "failClosedOutcomes()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L268 | neighbors=[smoke-production-publish-reconciliation…, FixedReconcileProvider, pass(), publishingIntent(), resetPublish(), main()]
- "scripts_smoke_production_publish_reconciliation_hardening_matchedreconciliation": "matchedReconciliation()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L247 | neighbors=[smoke-production-publish-reconciliation…, main(), matchedResult(), pass(), publishingIntent(), resetPublish()]
- "scripts_smoke_production_publish_reconciliation_hardening_resetpublish": "resetPublish()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L656 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), canonicalAndReceiptPaths(), failClosedOutcomes(), matchedReconciliation(), persistenceApiAndRecovery()]
- "scripts_smoke_production_readiness_acceptance_find": "find()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L624 | neighbors=[smoke-production-readiness-acceptance.ts, run(), verifyAudioOperationScope(), verifyMockAnimationIsBlocked(), verifyProbeCleanupFailsClosed(), verifyRuntimeReevaluation()]
- "scripts_smoke_production_readiness_acceptance_verifyprobecleanupfailsclosed": "verifyProbeCleanupFailsClosed()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L479 | neighbors=[smoke-production-readiness-acceptance.ts, run(), find(), readinessService(), removeProbeRoot(), restoreAndRemoveProbeRoot()]
- "scripts_smoke_production_youtube_package_pipeline_draftprovider": "DraftProvider" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L444 | neighbors=[smoke-production-youtube-package-pipeli…, assetFailureTests(), .generatePublishingPackage(), YouTubeProvider, persistenceTests(), successAndReplayTests()]
- "scripts_smoke_production_youtube_publish_pipeline_countingprovider": "CountingProvider" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L268 | neighbors=[smoke-production-youtube-publish-pipeli…, .publish(), YouTubePublishProvider, persistenceApiRunnerAndRecovery(), storedStateAndAssetFailures(), successReplayAndConfig()]
- "scripts_smoke_production_youtube_publish_pipeline_pass": "pass()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L286 | neighbors=[smoke-production-youtube-publish-pipeli…, mutateAssets(), persistenceApiRunnerAndRecovery(), realProviderFailures(), storedStateAndAssetFailures(), successReplayAndConfig()]
- "scripts_smoke_production_youtube_publish_pipeline_storedstateandassetfailures": "storedStateAndAssetFailures()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L148 | neighbors=[smoke-production-youtube-publish-pipeli…, CountingProvider, mutateAssets(), pass(), withFile(), withMissingFile()]
- "scripts_smoke_sprint_129_15_script_timestamp_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L26 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, digest(), provider(), result(), script(), test()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L58 | neighbors=[smoke-sprint-129-19-visuals-structured-…, digest(), physicalProvider(), plan(), scenes(), test()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_runcanonicalprovidergatefailure": "runCanonicalProviderGateFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L964 | neighbors=[smoke-sprint-129-28-production-acceptan…, fixture(), publishCapabilityFixture(), researchProvider(), runCanonicalRunnerResearchStage(), verifyRecordLevelParity()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_withdirectcapabilityevidence": "withDirectCapabilityEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L642 | neighbors=[smoke-sprint-129-28-production-acceptan…, createFixtureRuntimeStorageContext(), explicitTestAuthority(), fixture(), readyWorker(), researchProvider()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_assertnodownstreamdurable": "assertNoDownstreamDurable()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L575 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass(), projectFolder(), boundedFailure(), boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_assertquiescent": "assertQuiescent()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L561 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass(), projectFolder(), boundedFailure(), boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_seedfailedassembly": "seedFailedAssembly()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L407 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedFailure(), boundedSuccess(), invalidBoundary(), laterBoundary(), legacyUnbounded()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixture": "Fixture" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L331 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, assertOwnedTempMutationTarget(), mp4(), publishCanonicalAudioFixture(), wav(), write()]
- "security_guardedruntimemutationsession_capturecreatedobject": "captureCreatedObject()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1428 | neighbors=[GuardedRuntimeMutationSession.ts, invalidPath(), createExclusiveTokenFile(), guardedExclusiveMutation(), .createVerifiedRuntimeBackup(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_ensuredirectory": ".ensureDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L405 | neighbors=[beginPrivateRuntimeBackupCreateOperatio…, beginPrivateRuntimeBackupRestoreOperati…, GuardedRuntimeMutationSession, .publicBoundary(), prepareOwnedPayloadFile(), .publishVerified()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-038.json

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
