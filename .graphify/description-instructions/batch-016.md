# Node Description Batch 17 of 166

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

- "health_productionhealthcorerules": "ProductionHealthCoreRules.ts" | kind=code-symbol | source=src/lib/production/health/ProductionHealthCoreRules.ts:L1 | neighbors=[ae73d56 feat(production): add determini…, productionHealthCoreRules, topLevelSources(), ProductionHealthRules.ts, createHealthFinding(), createRule()]
- "history_route": "route.ts" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/history/route.ts:L1 | neighbors=[4dfddf0 feat(pipeline): add history api…, e705042 feat: harden pipeline state err…, GET(), isSafeSlug(), RouteContext, PipelineJobManager.ts]
- "jobs_route": "route.ts" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/route.ts:L1 | neighbors=[94269fa feat: complete sprint 64 pipeli…, e705042 feat: harden pipeline state err…, GET(), isSafeSlug(), RouteContext, PipelineJobManager.ts]
- "lib_canonicalsmokeevidencev2_initialize": "initialize()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L575 | neighbors=[CanonicalSmokeEvidenceV2.ts, dataProjectsState(), environmentEvidence(), expectedContract(), ownershipRemainders(), publishIntegratedJson()]
- "lib_canonicalsmokeevidencev2_validatechildevidence": "validateChildEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L487 | neighbors=[CanonicalSmokeEvidenceV2.ts, array(), cleanData(), equal(), fail(), loadInventory()]
- "lib_canonicalsmokeevidencev2_validateprovenance": "validateProvenance()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L629 | neighbors=[CanonicalSmokeEvidenceV2.ts, deriveAggregateResult(), equal(), fail(), orchestratorFiles(), orchestrators()]
- "pipeline_pipelinequeuescheduler_pipelinequeuescheduler": "PipelineQueueScheduler" | kind=code-symbol | source=src/lib/pipeline/PipelineQueueScheduler.ts:L11 | neighbors=[PipelineQueueScheduler.ts, .getNextRunnableStage(), PipelineRunner.ts, smoke-animation-motion-plan-contract.ts, smoke-pipeline-auto-continuation.ts, smoke-pipeline-retry-continuation-harde…]
- "production_productionacceptancelegacyreauthorizationpreflight_failure": "failure()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L518 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), identityOfDirectory(), inventoryFingerprint(), normalizeRecovery(), normalizeRecoveryDependency()]
- "production_productionacceptancemediavalidation": "ProductionAcceptanceMediaValidation.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMediaValidation.ts:L1 | neighbors=[c70a533 Sprint 126: Add production read…, ProductionAcceptanceMediaResult, ProductionAcceptanceMediaValidationError, validateProductionAcceptanceMedia(), FFmpegVideoAssemblyProvider.ts, SpawnRunner]
- "production_productioncompletedstageregenerationplanner_createcompletedstageregenerationplan": "createCompletedStageRegenerationPlan()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L54 | neighbors=[ProductionCompletedStageRegenerationPla…, fingerprintTree(), latestGeneration(), optionalFileHash(), ProductionRegenerationPlanError, requiredFileHash()]
- "production_productioncompletedstageregenerationservice_productionregenerationpreparationerror": "ProductionRegenerationPreparationError" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L53 | neighbors=[ProductionCompletedStageRegenerationSer…, applyMutation(), assertMutation(), assertPreparedReplay(), buildMutations(), prepareCompletedStageRegeneration()]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_preflight": ".preflight()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L6 | neighbors=[AdapterBackedProductionExecutionAttempt…, .openExecutionAttempt(), .activeForClaim(), .latest(), .links(), bindingReason()]
- "production_productionexecutiondurableclaim_defaultproductionexecutionclaimpolicy": "defaultProductionExecutionClaimPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L10 | neighbors=[ProductionExecutionDurableClaim.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryReconciliation.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-coordinator.…, smoke-production-execution-durable-atte…]
- "production_productionexecutiondurablestorage_out": "out()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L32 | neighbors=[ProductionExecutionDurableStorage.ts, .createRecord(), .createReservation(), .evaluateReplay(), .find(), .read()]
- "production_productionexecutiongateway": "ProductionExecutionGateway.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionGateway.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionExecutionGateway, registry, productionIntelligence.ts, ProductionActionType, ProductionExecutionDryRunResult]
- "production_productionexecutionworker_productionexecutionworkerexecutionservice": "ProductionExecutionWorkerExecutionService" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L16 | neighbors=[ProductionExecutionWorker.ts, .constructor(), .execute(), ProductionPipelineExecutionAdapter.ts, smoke-production-execution-worker.ts, smoke-sprint-129-29-failed-terminal-set…]
- "production_productionhealthapiclient_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L385 | neighbors=[ProductionHealthApiClient.ts, isApiErrorPayload(), isCounts(), isFinding(), isHealthResult(), isSnapshot()]
- "production_productionlegacypipelineexecutionidentity": "ProductionLegacyPipelineExecutionIdentity.ts" | kind=code-symbol | source=src/lib/production/ProductionLegacyPipelineExecutionIdentity.ts:L1 | neighbors=[cfb4887 feat(sprint-129.35): legacy ter…, ProductionGlobalTerminalQuiescence.ts, ProductionDeterminism.ts, stableProductionId(), buildVersionedProductionPipelineExecuti…, ProductionPipelineIdentityVersion]
- "production_productionpipelineexecutionfactory_readverifiedcompletedproductionpipelinepreparationfingerprint": "readVerifiedCompletedProductionPipelinePreparationFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L159 | neighbors=[ProductionAcceptancePolicy.ts, ProductionPipelineExecutionFactory.ts, assertCompletedBindings(), assertCompletedCanonicalIdentityBinding…, assertExecutionScopeMatchesIdentity(), canonicalStoreRoot()]
- "scripts_run_production_acceptance": "run-production-acceptance.ts" | kind=code-symbol | source=scripts/run-production-acceptance.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, a029553 fix(production): close sprint 1…, f21fc24 Sprint 128: Harden production a…, ProductionAcceptanceCommand.ts, ProductionAcceptanceCommandDependencies, runProductionAcceptanceCommand()]
- "scripts_smoke_pipeline_orchestration_run": "run()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L312 | neighbors=[smoke-pipeline-orchestration.ts, testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent(), testDuplicateCompletionDoesNotDuplicate…, testExistingActiveDownstreamDoesNotDupl…]
- "scripts_smoke_pipeline_orchestration_writejobs": "writeJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L51 | neighbors=[smoke-pipeline-orchestration.ts, testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent(), testDuplicateCompletionDoesNotDuplicate…, testExistingActiveDownstreamDoesNotDupl…]
- "scripts_smoke_pipeline_state_error_contract_readresponse": "readResponse()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L99 | neighbors=[smoke-pipeline-state-error-contract.ts, testHistoryReadFailure(), testInvalidHistory(), testInvalidJobs(), testMainPipelineSingleTypedLog(), testMalformedHistory()]
- "security_guardedruntimemutationsession_identitymatches": "identityMatches()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1466 | neighbors=[GuardedRuntimeMutationSession.ts, assertIdentity(), cleanupAtomicEmptyDirectory(), createExclusiveTokenFile(), guardedExclusiveMutation(), .assertActive()]
- "security_ownedruntimedirectory_ownedruntimedirectory": "OwnedRuntimeDirectory" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L54 | neighbors=[RuntimeMigrationCandidateService.ts, GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts, .absolutePath(), .cleanup(), .closeSessionRetainingOwnership()]
- "security_runtimepathcapabilityprobe": "RuntimePathCapabilityProbe.ts" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L1 | neighbors=[aecde83 feat(runtime): add guarded file…, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts, RuntimeMutationError.ts, RuntimeMutationError, capabilityUnavailable()]
- "seo_route": "route.ts" | kind=code-symbol | source=app/api/seo/route.ts:L1 | neighbors=[a4839b8 feat(seo): add youtube seo engi…, ProjectManager.ts, ProjectManager, POST(), SEOManager.ts, SEOManager]
- "storage_audiostorage_audiostorage_prepareaudio": ".prepareAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L134 | neighbors=[AudioStorage, acquireAudioProjectWriteAuthority(), attachPublicationOwnership(), .getAudioPath(), .getAudioUrl(), .inspectWav()]
- "storage_audiostorage_compensateprotectedpublication": "compensateProtectedPublication()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1178 | neighbors=[AudioStorage.ts, .compensatePublishedAudioResult(), .recoverPublishedAudio(), .getAudioDir(), cleanupTerminalCompensation(), failCompensation()]
- "types_airesponse": "aiResponse.ts" | kind=code-symbol | source=src/types/aiResponse.ts:L1 | neighbors=[AIResponseError.ts, ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, VisualStructuredOutput.ts, 65d376b Sprint 129.19: Harden visual st…]
- "types_animation_animationscene": "AnimationScene" | kind=code-symbol | source=src/types/animation.ts:L43 | neighbors=[AnimationAssetPipeline.ts, animationMerge.ts, AnimationMotionPlanValidation.ts, AnimationService.ts, route.ts, AnimationPromptGenerator.ts]
- "types_audioerror": "audioError.ts" | kind=code-symbol | source=src/types/audioError.ts:L1 | neighbors=[AudioAssetError.ts, AudioPipeline.ts, 6286a7c feat(audio): complete truncatio…, ProductionExecutionDurableAttempt.ts, smoke-sprint-129-27-audio-remediation.ts, audio.ts]
- "types_productionexecutiondispatch": "productionExecutionDispatch.ts" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L1 | neighbors=[8017502 feat(production): add queue dis…, ProductionExecutionDispatch.ts, smoke-production-execution-phase-review…, ProductionExecutionDispatchEligibilityR…, ProductionExecutionDispatchEnvelope, ProductionExecutionDispatchInput]
- "types_productionexecutionpersistence_productionexecutionpersistencerecordkind": "ProductionExecutionPersistenceRecordKind" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L7 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionExecutionDescriptorBoundReadA…, ProductionExecutionPersistence.ts, ProductionExecutionRecoveryBootstrap.ts, ProductionGlobalTerminalQuiescence.ts]
- "types_productionhealth_productionhealthfinding": "ProductionHealthFinding" | kind=code-symbol | source=src/types/productionHealth.ts:L55 | neighbors=[ProductionHealthRules.ts, ProductionActionEngine.ts, ProductionHealthEngine.ts, production-intelligence-fixture.ts, smoke-production-health-evidence.ts, smoke-production-health-findings.ts]
- "types_productionruntimehealth": "productionRuntimeHealth.ts" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L1 | neighbors=[c812810 Sprint 112: Add production runt…, route.ts, smoke-production-runtime-health-api.ts, ProductionRuntimeHealthResponse, ProductionRuntimeHealthResponseBase, productionRuntimeHealthSchemaVersion]
- "visuals_route": "route.ts" | kind=code-symbol | source=app/api/visuals/route.ts:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, 732ceca feat(visuals): add visual manag…, ProjectManager.ts, ProjectManager, scene.ts, SceneData]
- "animation_animationmerge": "animationMerge.ts" | kind=code-symbol | source=src/lib/animation/animationMerge.ts:L1 | neighbors=[mergeAnimationData(), sortAnimationScenes(), AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene(), animation.ts, AnimationData]
- "animation_animationmotionplanvalidation_iscompatibleanimationdata": "isCompatibleAnimationData()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L73 | neighbors=[AnimationMotionPlanValidation.ts, isAnimationMotionPlanData(), hasMotionPlanFields(), isAnimationMotionPlanScene(), isLegacyAnimationScene(), isNonEmptyString()]
- "audio_audiocompensationstore_activerecordcount": "activeRecordCount()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L933 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, cleanupRootIfPresent(), isLogicallyRetired(), isSafeAudioCompensationRef(), parseRetirementFileName()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-016.json

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
