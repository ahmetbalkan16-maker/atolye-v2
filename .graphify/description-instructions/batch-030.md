# Node Description Batch 31 of 166

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2863b3ab95a0ec815c812b5615b88cfee5801e64": "2863b3a fix(production): bind queued exhausted drift to persisted run type" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, cfb4887 feat(sprint-129.35): legacy ter…, ProductionQueuedExhaustedDriftClassifie…, smoke-sprint-129-34-queued-exhausted-ru…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b1c33f4ce1b116eb93999c7832c65663d744b373": "b1c33f4 feat(studio): add project studio viewer" | kind=Commit | source=git | neighbors=[732ceca feat(visuals): add visual manag…, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 5a68409 feat(pipeline): add full docume…, ProjectList.tsx]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e3eba68f57e40e5641c4a57e90a9d10b6c682cbc": "e3eba68 Connect research API to AIManager real provider pipeline" | kind=Commit | source=git | neighbors=[AIManager.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 10c20ec Connect AI script generation pi…, route.ts]
- "export_exportengine_exportengine": "ExportEngine" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L16 | neighbors=[ExportEngine.ts, .constructor(), .createFallback(), .generateExportPackage(), generateExportPackage(), route.ts]
- "fixtures_sprint_129_33_path_race_child_main": "main()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L34 | neighbors=[sprint-129-33-path-race-child.ts, countRaceMutationAttempts(), foreignPreservationBytes(), replacementInventoryHash(), sha256(), sourcePath()]
- "health_route_createproductionruntimehealthresponse": "createProductionRuntimeHealthResponse()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L20 | neighbors=[route.ts, jsonResponse(), projectHealthStatus(), readObservedAt(), unavailableResponse(), GET()]
- "lib_canonicalsmokeevidencev2_acquirelease": "acquireLease()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L603 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), processIdentity(), publishIntegratedJson(), readJson(), aggregateEvidence()]
- "lib_canonicalsmokeevidencev2_preparenewevidenceroot": "prepareNewEvidenceRoot()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L151 | neighbors=[CanonicalSmokeEvidenceV2.ts, assertRootPlacement(), fail(), identityEqual(), requireStableDirectory(), tempParentChain()]
- "lib_canonicalsmokeevidencev2_validateenvironmentfingerprint": "validateEnvironmentFingerprint()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L362 | neighbors=[CanonicalSmokeEvidenceV2.ts, validateBaselineEvidence(), array(), equal(), fail(), object()]
- "lib_canonicalsmokeevidencev2_writeatomic": "writeAtomic()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L199 | neighbors=[CanonicalSmokeEvidenceV2.ts, publishIntegratedJson(), runChild(), fail(), identityEqual(), requireStableDirectory()]
- "lib_canonicalsmokeevidencev2_writecontentaddressedinventory": "writeContentAddressedInventory()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L273 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), runChild(), runPartition(), fail(), writeAtomic()]
- "lib_canonicalsmokeruntime_canonicalpath": "canonicalPath()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L582 | neighbors=[CanonicalSmokeRuntime.ts, assertCanonicalSmokeRuntimeStorageConte…, contains(), identitySafeRemoveLeaf(), recoverCanonicalSmokeWorkspace(), samePath()]
- "lib_historicalaudioordinalfourpreflight_createalternativehistoricalaudioordinalfourchain": "createAlternativeHistoricalAudioOrdinalFourChain()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L388 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, rewriteAttempt(), rewriteClaim(), rewriteLease(), writeJson(), smoke-sprint-129-36-retry-budget-extens…]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidateid": "runtimeMigrationCandidateId()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L91 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest(), sha256(), validateManifest(), RuntimeMigrationCandidatePreflight.ts, smoke-sprint-129-25c-2b-1-migration-can…]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidateidentitysha256": "runtimeMigrationCandidateIdentitySha256()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L191 | neighbors=[RuntimeMigrationCandidateManifest.ts, canonicalManifest(), hashCanonical(), runtimeMigrationCandidatePolicySha256(), validateRuntimeMigrationCandidateManife…, RuntimeMigrationCandidateService.ts]
- "migration_runtimemigrationcandidatepreflight_classifyreadonlycapability": "classifyReadOnlyCapability()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L173 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyWindowsDriveTypeEvidence(), filesystemKind(), insideOrEqual(), knownNetworkFilesystem(), readWindowsDriveTypeEvidence()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_transitionstagejobunlocked": ".transitionStageJobUnlocked()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L471 | neighbors=[PipelineJobManager, getJobId(), .canTransition(), .createJob(), .listJobs(), .recordHistoryEvent()]
- "pipeline_pipelinejobmutationlock_invokecanonicalmutationbarrier": "invokeCanonicalMutationBarrier()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L757 | neighbors=[PipelineJobMutationLock.ts, quarantineAndRemove(), recoverStaleGate(), recoverVerifiedStaleLock(), releaseOwnedGate(), releaseOwnedLock()]
- "pipeline_pipelinejobmutationlock_observefilesystemmutation": "observeFilesystemMutation()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L766 | neighbors=[PipelineJobMutationLock.ts, mutationMkdir(), mutationRename(), mutationRmdir(), mutationUnlink(), mutationWriteFile()]
- "pipeline_pipelinejobmutationlock_recoverstalegate": "recoverStaleGate()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L385 | neighbors=[PipelineJobMutationLock.ts, invokeCanonicalMutationBarrier(), isMissing(), parseOwner(), quarantineAndRemove(), sameLiveProcess()]
- "pipeline_pipelinejobmutationlock_recoververifiedstalelock": "recoverVerifiedStaleLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L303 | neighbors=[PipelineJobMutationLock.ts, inspectLock(), invokeCanonicalMutationBarrier(), isMissing(), quarantineAndRemove(), sameIdentity()]
- "pipeline_pipelinejobmutationlock_releaseownedlock": "releaseOwnedLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L326 | neighbors=[PipelineJobMutationLock.ts, assertOwnershipPath(), injectReleaseFailure(), inspectLock(), invokeCanonicalMutationBarrier(), quarantineAndRemove()]
- "pipeline_pipelinejobmutationlock_verifycanonicalownerpublicationfailurecleanup": "verifyCanonicalOwnerPublicationFailureCleanup()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L206 | neighbors=[sprint-129-33-path-race-child.ts, PipelineJobMutationLock.ts, canonicalProjectFolder(), isMissing(), withAcquisitionGate(), withCanonicalPipelineJobMutationLock()]
- "pipeline_pipelinerunner_pipelinerunner_resumeonce": ".resumeOnce()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L215 | neighbors=[PipelineRunner, parseConsumedRetryBudgetAuthorityId(), .isStageCompleted(), .requireRuntimeStorageContext(), .runScheduledStages(), validateStrictProductionResumeState()]
- "pipeline_pipelinerunner_pipelinerunner_withruntimeoperation": ".withRuntimeOperation()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L866 | neighbors=[PipelineRunner, .continueProject(), .dispatchProjectContinuation(), .executeJobRetry(), .resume(), .retryStage()]
- "pipeline_pipelinestateapierror_createpipelinestateerrorresponse": "createPipelineStateErrorResponse()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateApiError.ts:L7 | neighbors=[route.ts, route.ts, route.ts, PipelineStateApiError.ts, route.ts, route.ts]
- "production_productionacceptancelegacyreauthorizationpreflight_inventoryfingerprint": "inventoryFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L321 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), failure(), identityEvidence(), identityOfDirectory(), readExactFile()]
- "production_productionacceptanceorchestrator_productionacceptanceblockederror": "ProductionAcceptanceBlockedError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L101 | neighbors=[ProductionAcceptanceOrchestrator.ts, .constructor(), .resumeAndFinalize(), .run(), smoke-production-animation-provider.ts, smoke-production-readiness-acceptance.ts]
- "production_productionacceptancepolicy_createproductionacceptancemarkerv3": "createProductionAcceptanceMarkerV3()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L252 | neighbors=[ProductionAcceptancePolicy.ts, ProductionAcceptancePolicyError, productionAcceptanceRequestFingerprintV…, safeRunId(), safeSlug(), sameComponentFingerprints()]
- "production_productionacceptancepolicy_markermatchescurrentconfiguration": "markerMatchesCurrentConfiguration()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1361 | neighbors=[ProductionAcceptancePolicy.ts, isMarkerV3Profile2(), productionAcceptanceConfigurationFinger…, sameComponentFingerprints(), markProductionAcceptanceValidated(), readProductionAcceptanceAdmissionAuthor…]
- "production_productionacceptancepolicy_validmarkerv3profile2": "validMarkerV3Profile2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1247 | neighbors=[ProductionAcceptancePolicy.ts, resolveEffectiveProductionAcceptanceAut…, validateProductionAcceptanceReprepareRe…, validMarker(), productionAcceptanceRequestFingerprintV…, safeRunId()]
- "production_productionacceptancepreflight_productiondurationpreflighterror": "ProductionDurationPreflightError" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L23 | neighbors=[ProductionAcceptancePreflight.ts, .constructor(), requireAcceptanceRange(), requireClose(), requireDuration(), validateProductionAcceptanceScriptDurat…]
- "production_productionacceptancepreflight_validateproductionacceptancescriptduration": "validateProductionAcceptanceScriptDuration()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L106 | neighbors=[PipelineStageExecutor.ts, ProductionAcceptancePreflight.ts, validateProductionAcceptancePreflight(), ProductionDurationPreflightError, requireAcceptanceRange(), requireClose()]
- "production_productioncompletedstageregenerationstore_buildaudiopreservationfingerprint": "buildAudioPreservationFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L25 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSto…, collectAssetIds(), collectRegistryBindings(), readJson(), sha256()]
- "production_productioncompletedstageregenerationstore_readregenerationintent": "readRegenerationIntent()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L47 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, readJson(), recordRegeneratedPackageCompletion(), requireRegenerationExecutionAdmission()]
- "production_productioncompletedstageregenerationstore_regenerationbindingforexecution": "regenerationBindingForExecution()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L131 | neighbors=[PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, ProductionCompletedStageRegenerationSto…, listRegenerationExecutionBindings(), ProductionDurableAttemptLineageClassifi…, ProductionGlobalTerminalQuiescence.ts]
- "production_productionexecutionauthorization_evaluate": "evaluate()" | kind=code-symbol | source=src/lib/production/ProductionExecutionAuthorization.ts:L50 | neighbors=[ProductionExecutionAuthorization.ts, canonical(), hasCycle(), resolveDependencies(), result(), validPolicy()]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_links": ".links()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L13 | neighbors=[AdapterBackedProductionExecutionAttempt…, .evaluateExecutionAttemptRecovery(), .finalizeExecutionOutcome(), .latestClaim(), .preflight(), .proposeExecutionOutcome()]
- "production_productionexecutiondurableattempt_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .evaluateExecutionAttemptRecovery(), mutationReason(), safeEntry(), safeOutcome(), validAttempt()]
- "production_productionexecutiondurableattempt_mutationreason": "mutationReason()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L19 | neighbors=[ProductionExecutionDurableAttempt.ts, .abandonExecutionAttempt(), .appendAttemptJournal(), .finalizeExecutionOutcome(), .proposeExecutionOutcome(), .transitionExecutionLifecycle()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-030.json

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
