# Node Description Batch 15 of 166

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
Write every description in Portuguese (pt). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "types_errorevidence": "errorEvidence.ts" | kind=code-symbol | source=src/types/errorEvidence.ts:L1 | neighbors=[6094cd8 Sprint 129.21: Harden productio…, 6286a7c feat(audio): complete truncatio…, PipelineErrorEvidence.ts, PipelineJobManager.ts, ProjectManager.ts, aiResponse.ts]
- "types_productionexecutiondurablestorage_productionexecutiondurablerecord": "ProductionExecutionDurableRecord" | kind=code-symbol | source=src/types/productionExecutionDurableStorage.ts:L9 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableClaim.ts, ProductionExecutionDurableLease.ts]
- "types_productionexecutionsafety": "productionExecutionSafety.ts" | kind=code-symbol | source=src/types/productionExecutionSafety.ts:L1 | neighbors=[0d7b72c feat(production): add execution…, ProductionExecutionAuthorization.ts, ProductionExecutionSafetyPlan.ts, smoke-production-phase-closure.ts, productionExecutionAuthorization.ts, ProductionActionRiskProfile]
- "types_productionoperationjournal": "productionOperationJournal.ts" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L1 | neighbors=[3652d01 feat(production): add operation…, ProductionExecutionPersistence.ts, ProductionOperationJournal.ts, smoke-production-execution-persistence.…, smoke-production-execution-phase-review…, productionExecutionPersistence.ts]
- "ai_aimanager_aimanager": "AIManager" | kind=code-symbol | source=src/lib/ai/AIManager.ts:L29 | neighbors=[AIManager.ts, .runResearch(), .runScenes(), .runScript(), PipelineStageExecutor.ts, route.ts]
- "ai_canonicaltimestamp": "CanonicalTimestamp.ts" | kind=code-symbol | source=src/lib/ai/CanonicalTimestamp.ts:L1 | neighbors=[AIManager.ts, ApplicationTimestampError, createCanonicalApplicationTimestamp(), isCanonicalTimestamp(), ResearchStructuredOutput.ts, SceneStructuredOutput.ts]
- "ai_generationexecutionpolicy_strictgenerationexecutionpolicy": "strictGenerationExecutionPolicy" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L5 | neighbors=[GenerationExecutionPolicy.ts, PipelineStageExecutor.ts, smoke-production-readiness-acceptance.ts, smoke-sprint-128-1-production-acceptanc…, smoke-sprint-129-11-research-schema-com…, smoke-sprint-129-13-script-settlement.ts]
- "assembly_videoassemblymanager_videoassemblymanager_renderexistingassets": ".renderExistingAssets()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L61 | neighbors=[VideoAssemblyManager, buildAudioSegments(), getProviderName(), isExactMockResult(), isValidRealResult(), persistFailedAssetSafely()]
- "audio_audiocompensationstore_issafeaudiocompensationref": "isSafeAudioCompensationRef()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L202 | neighbors=[AudioAssetError.ts, AudioCompensationStore.ts, activeRecordCount(), assertProtectedAudioCanonicalResolution…, inspectDeferredBacklog(), parseRetirementFileName()]
- "audio_audiocompensationstore_prepareaudiocompensationworkspace": "prepareAudioCompensationWorkspace()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L208 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), admissionReservationBytes(), AudioCompensationBacklogSaturatedError, AudioCompensationStoreError, digest()]
- "audio_audiocompensationstore_readaudiocompensationreceiptfromdirectory": "readAudioCompensationReceiptFromDirectory()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1448 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), finalizeRecordPlacement(), inspectDeferredBacklog(), readAudioCompensationReceiptForRetentio…, AudioCompensationStoreError]
- "audio_audiocompensationstore_requiredeferredworkspace": "requireDeferredWorkspace()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2231 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), createRecordDirectory(), finalizeRecordPlacement(), getProtectedAudioCompensationPublicatio…, getProtectedAudioCompensationQuarantine…]
- "audio_audiocompensationstore_retireterminalworkspace": "retireTerminalWorkspace()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1008 | neighbors=[AudioCompensationStore.ts, pruneCompletedAudioCompensationRecords(), removeCompletedRecord(), AudioCompensationStoreError, buildRetirementPlan(), cleanupRoot()]
- "audio_audiodescriptorboundverification": "AudioDescriptorBoundVerification.ts" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L1 | neighbors=[AudioDescriptorFileIdentity, AudioDescriptorVerificationError, digestBytes(), readAudioFileDescriptorBound(), readContainedAudioFileDescriptorBound(), reliableIdentity()]
- "audio_audioidentifierpolicy": "AudioIdentifierPolicy.ts" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L1 | neighbors=[AudioAssetError.ts, AudioIdentifierPolicyError, containsReservedSafeEvidenceTerm(), isSafeAudioIdentifier(), requireSafeAudioIdentifier(), RESERVED_SAFE_EVIDENCE_TERMS]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0c8dfb2a73ecbb6a4df58b6248cae2eb96af3c65": "0c8dfb2 feat(production): add durable worker execution foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0e0ff02aacc88eae1bdef607bebe18aba2399676": "0e0ff02 Sprint 125: Add production end-to-end validation" | kind=Commit | source=git | neighbors=[AIManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0e442b3c07841ff69dbe4d4f4398ebfddfdb3ceb": "0e442b3 Sprint 111: Add production runtime status diagnostics" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@26fb978d2a09c66a424702795faae4fcdb68e58b": "26fb978 feat(studio): add AI diagnostics usage viewer" | kind=Commit | source=git | neighbors=[AIUsageManager.ts, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5166a51c3ce187879ff8c17f64c3003d686a6f74": "5166a51 Sprint 129.20: Harden visuals truncation and token budget" | kind=Commit | source=git | neighbors=[VisualsAIConfig.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@68f61dcf153041e257298f92a5605fd3a5c47976": "68f61dc feat(animation): add animation engine foundation" | kind=Commit | source=git | neighbors=[AnimationAssetPipeline.ts, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6ef184086816fd8eca9f961047bdfdeb2f8c42d6": "6ef1840 feat(production): add read-only health service api" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@80adfc8ce8e9c8ee0f5a7760c2f1fa4fe49f7470": "80adfc8 feat(production): add durable execution lease foundation" | kind=Commit | source=git | neighbors=[7561f3d feat(production): harden durabl…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a76335fb7788e07a20aa017d76f596ea93e8c128": "a76335f Sprint 129.23: Harden production acceptance portability" | kind=Commit | source=git | neighbors=[5a31d1f Sprint 129.22: Harden animation…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@af745ac7dbf0f06134853ea65098711ba954674f": "af745ac Sprint 109: Process Startup Bootstrap Integration" | kind=Commit | source=git | neighbors=[3be3669 feat(production): complete dura…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@cfb4887e75d971ac71762724865000f03dfd8e7a": "cfb4887 feat(sprint-129.35): legacy terminal lineage global-quiescence compatib…" | kind=Commit | source=git | neighbors=[2863b3a fix(production): bind queued ex…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 9ea85cf fix(production): remove residua…, ProductionAcceptanceCommand.ts]
- "dashboard_projectlist": "ProjectList.tsx" | kind=code-symbol | source=src/components/dashboard/ProjectList.tsx:L1 | neighbors=[40fa937 Fix project dashboard data load…, 91ba270 Atölye V2 checkpoint - pipeline…, b1c33f4 feat(studio): add project studi…, c17c96f feat(projects): show manifest p…, ed3020b Sprint 30 Phase 3 - Enhanced pr…, Dashboard.tsx]
- "lib_canonicalsmokeevidencev2_runchild": "runChild()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L448 | neighbors=[CanonicalSmokeEvidenceV2.ts, cleanData(), dataProjectsState(), fail(), normalizePath(), ownershipRemainders()]
- "lib_canonicalsmokeruntime_setupcanonicalsmokeruntime": "setupCanonicalSmokeRuntime()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L202 | neighbors=[CanonicalSmokeRuntime.ts, applyEnvironment(), assertRunOwnedContext(), canonicalPath(), createManifest(), frozenRecord()]
- "migration_runtimemigrationcandidateerror": "RuntimeMigrationCandidateError.ts" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L1 | neighbors=[02c450e Sprint 129.25 C.2B.1: Migration…, 6387e3d Sprint 129.25 C.2B.2: Add verif…, messages, migrationCandidateError(), RuntimeMigrationCandidateError, RuntimeMigrationCandidateErrorCode]
- "production_productioncanonicaldurablelineage_readproductioncanonicalterminaldurablelineage": "readProductionCanonicalTerminalDurableLineage()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L57 | neighbors=[ProductionCanonicalDurableLineage.ts, assertExpected(), assertIdentity(), assertTerminalConsistency(), readLatestVersioned(), ProductionGlobalTerminalQuiescence.ts]
- "production_productionexecutiondescriptorboundreadadapter_productionexecutiondescriptorboundreadadapter": "ProductionExecutionDescriptorBoundReadAdapter" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L86 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionExecutionDescriptorBoundReadA…, .assertAuthority(), .constructor(), .listKeys(), .read()]
- "production_productionexecutiondurableattempt_validateproductionexecutiondurableattempt": "validateProductionExecutionDurableAttempt()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L20 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts, validAttempt(), ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutiondurablelease_defaultproductionexecutiondurableleasepolicy": "defaultProductionExecutionDurableLeasePolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L8 | neighbors=[ProductionExecutionDurableLease.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryReconciliation.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-coordinator.…, smoke-production-execution-durable-atte…]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_read": ".read()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L17 | neighbors=[AdapterBackedProductionExecutionDurable…, .createRecord(), .createReservation(), .evaluateReplay(), .find(), .findReservation()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice": "ProductionExecutionDurableRecoveryService" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L149 | neighbors=[ProductionExecutionPersistence.ts, .apply(), .collectCanonicalRecords(), .constructor(), .inspectIndex(), .locateArtifact()]
- "production_productionexecutionpersistence_validatepayload": "validatePayload()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L350 | neighbors=[ProductionExecutionPersistence.ts, .readRecoveryArtifact(), .readCanonical(), .write(), durableAttemptValid(), durableClaimValid()]
- "production_productionexecutionworker_productionexecutionworkerexecutionservice_execute": ".execute()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L19 | neighbors=[ProductionExecutionWorkerExecutionServi…, cancelled(), finish(), fromTerminal(), lifecycleRequest(), mapCoordination()]
- "production_productionintelligenceconsumer_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L144 | neighbors=[ProductionIntelligenceConsumer.ts, parseAction(), parseEdge(), parseExecutionPreview(), parseGraph(), parseInputDescriptor()]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider": "MockYouTubePublishProvider" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L19 | neighbors=[MockYouTubePublishProvider.ts, ConfiguredYouTubePublishProvider, .constructor(), .createImmutablePublishDispatchAdapter(), .publish(), .reconcilePublish()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-014.json

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
