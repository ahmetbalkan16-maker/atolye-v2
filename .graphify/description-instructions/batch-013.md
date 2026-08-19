# Node Description Batch 14 of 166

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

- "types_productionregeneration": "productionRegeneration.ts" | kind=code-symbol | source=src/types/productionRegeneration.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, ProductionAcceptanceExecutionScope.ts, ProductionAcceptancePolicy.ts, ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…]
- "types_productionruntimestatus": "productionRuntimeStatus.ts" | kind=code-symbol | source=src/types/productionRuntimeStatus.ts:L1 | neighbors=[0e442b3 Sprint 111: Add production runt…, route.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts, ProductionWorkerLifecycle.ts, ProductionRuntimeCompositionRoot.ts]
- "types_project_projectmanifest": "ProjectManifest" | kind=code-symbol | source=src/types/project.ts:L91 | neighbors=[PipelineRecoveryPlanner.ts, ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionQueuedExhaustedDriftClassifie…, ProductionSnapshotSourceReader.ts, ProjectManager.ts]
- "types_video_videodata": "VideoData" | kind=code-symbol | source=src/types/video.ts:L57 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, PipelineStageExecutor.ts, ExportProvider.ts, ThumbnailProvider.ts, smoke-assembly-scene-video-consumption.…]
- "video_videodatavalidation_iscompatiblevideodata": "isCompatibleVideoData()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L5 | neighbors=[route.ts, VideoAssemblyManager.ts, route.ts, PipelineRecoveryPlanner.ts, PipelineStageExecutor.ts, ProductionCompletedStageRegenerationPla…]
- "visuals_visualmanager_visualmanager": "VisualManager" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L36 | neighbors=[PipelineStageExecutor.ts, smoke-production-readiness-acceptance.ts, smoke-production-real-photo-source.ts, smoke-production-visual-asset-wiring.ts, smoke-sprint-129-19-visuals-structured-…, smoke-sprint-129-20-visuals-truncation-…]
- "audio_audioservice": "AudioService.ts" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L1 | neighbors=[AudioApiResponse, AudioService, AudioServiceOptions, AudioServiceResult, generateAudio(), GenerateAudioInput]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@02bf9b6ee0583547ab98fd24ff235258d85c63cb": "02bf9b6 feat(production): add durable execution storage foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3b885dc9025622a69f79d281ad39474385246303": "3b885dc Sprint 129.24: Add controlled acceptance marker reprepare" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4c104fab623f120ee455c407503ace5c47ca0327": "4c104fa feat(production): wire durable pipeline execution" | kind=Commit | source=git | neighbors=[2d33047 feat(production): integrate dur…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6387e3d81c22350672ed9c562cf7f79c7a06fc23": "6387e3d Sprint 129.25 C.2B.2: Add verified migration candidate creation" | kind=Commit | source=git | neighbors=[02c450e Sprint 129.25 C.2B.1: Migration…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@7cf95359d18c0e09f2eaa8f3bb4ea1a0201d04ec": "7cf9535 feat(pipeline): implement job state consistency (Sprint 83)" | kind=Commit | source=git | neighbors=[11fe46b feat(pipeline): add execution t…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a1909f304e8f8ea78161bc4205f4ff347215e3d0": "a1909f3 fix(production): version intelligence consumer contract" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ae73d568f918be99cb5a3bbfc3ad2754b63c954c": "ae73d56 feat(production): add deterministic health rules engine" | kind=Commit | source=git | neighbors=[a51cddd feat(production): add read-only…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e52887832bee2e01663aa6e375d48e731f0e3fc4": "e528878 feat(production): add execution confirmation contract" | kind=Commit | source=git | neighbors=[d9ebd32 feat(production): add execution…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "lib_canonicalsmokeevidencev2_equal": "equal()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L60 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), loadInventory(), publishIntegratedJson(), validateAggregateEvidence(), validateChildEvidence()]
- "lib_canonicalsmokeevidencev2_loadinventory": "loadInventory()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L284 | neighbors=[CanonicalSmokeEvidenceV2.ts, array(), equal(), fail(), inventoryFromEntries(), object()]
- "lib_canonicalsmokeevidencev2_readjson": "readJson()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L82 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), aggregateEvidence(), loadInventory(), publishIntegratedJson(), fail()]
- "lib_runtime_tracking_inventory": "runtime-tracking-inventory.ts" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L1 | neighbors=[507becc Sprint 129.25B: Runtime root ab…, 6387e3d Sprint 129.25 C.2B.2: Add verif…, assertRuntimeTrackingAdmission(), collectFiles(), collectRuntimeTrackingInventory(), isAllowedIgnoredDurablePath()]
- "production_productionacceptancepolicy_productionacceptancerequestfingerprint": "productionAcceptanceRequestFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1131 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarker(), createProductionAcceptanceMarkerV3Profi…, ProductionAcceptancePolicyError, safeRunId(), validMarkerV2()]
- "production_productionacceptancepolicy_resolveeffectiveproductionacceptanceauthority": "resolveEffectiveProductionAcceptanceAuthority()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L844 | neighbors=[ProductionAcceptancePolicy.ts, diagnoseProductionAcceptanceConfigurati…, markProductionAcceptanceValidated(), readProductionAcceptanceAdmissionAuthor…, readProductionAcceptanceMarker(), admissionFailure()]
- "production_productionacceptancetopic_createproductionacceptanceprojectslug": "createProductionAcceptanceProjectSlug()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L60 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePolicy.ts, ProductionAcceptanceTopic.ts, normalizeProductionAcceptanceTopic(), ProductionAcceptanceTopicError]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_preflight": ".preflight()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L16 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .acquireExecutionClaim(), .activeClaimForRecord(), .latestClaim(), claimReplay(), conflict()]
- "production_productionexecutiondurablestorage_defaultproductionexecutiondurablestoragepolicy": "defaultProductionExecutionDurableStoragePolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L8 | neighbors=[ProductionExecutionDurableStorage.ts, ProductionPipelineExecutionFactory.ts, smoke-production-execution-coordinator.…, smoke-production-execution-durable-atte…, smoke-production-execution-durable-clai…, smoke-production-execution-durable-leas…]
- "production_productionexecutionpersistence_errorcode": "errorCode()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L399 | neighbors=[ProductionExecutionPersistence.ts, cleanup(), diagnostic(), isRecord(), .collectCanonicalRecords(), .inspectIndex()]
- "prompts_assemblyprompt": "assemblyPrompt.ts" | kind=code-symbol | source=src/lib/assembly/prompts/assemblyPrompt.ts:L1 | neighbors=[AssemblyManager.ts, 5fd1307 feat(assembly): add video assem…, c4d459a feat(assembly): add final produ…, f21fc24 Sprint 128: Harden production a…, AssemblySourceData, createAssemblyPrompt()]
- "providers_ffmpegvideoassemblyprovider_ffmpegvideoassemblyprovider_assemble": ".assemble()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L99 | neighbors=[FFmpegVideoAssemblyProvider, absoluteInput(), buildConcatManifest(), buildFFmpegArgs(), buildFFprobeArgs(), buildSceneInputProbeArgs()]
- "providers_mockvideoprovider": "MockVideoProvider.ts" | kind=code-symbol | source=src/lib/video/providers/MockVideoProvider.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, 8c15471 feat(video): add mock video eng…, 99834f4 feat: complete Sprint 129.28 du…, c6c7bef fix: complete sprint 70 unused …, MockVideoProvider, ProviderDispatchAdapterAuthority.ts]
- "providers_videoproviderconfig": "VideoProviderConfig.ts" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, ProductionReadinessService.ts, FFmpegSceneVideoProvider.ts, comparablePath(), FFmpegSceneVideoConfig, getFFmpegSceneVideoConfig()]
- "runtime_runtimestoragepaths_ensuresafedirectory": "ensureSafeDirectory()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L435 | neighbors=[RuntimeBackupAuthority.ts, RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), ensureSafeContainedDirectory(), assertPathContained(), canonicalAbsolutePath()]
- "scripts_smoke_production_execution_gateway": "smoke-production-execution-gateway.ts" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionExecutionContract.ts, ProductionExecutionContract, ProductionExecutionGateway.ts, ProductionExecutionGateway, ProductionIntelligenceService.ts]
- "scripts_smoke_production_health_service_run": "run()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L115 | neighbors=[smoke-production-health-service.ts, captureFiles(), file(), getHealth(), hasCode(), history()]
- "scripts_smoke_production_health_ui": "smoke-production-health-ui.ts" | kind=code-symbol | source=scripts/smoke-production-health-ui.ts:L1 | neighbors=[53955f6 feat(production): add health ui…, ProductionHealthApiClient.ts, ProductionHealthApiConsumerError, ProductionHealthService.ts, ProductionHealthReport, ProductionHealthService]
- "scripts_smoke_production_intelligence_consumer_versioning": "smoke-production-intelligence-consumer-versioning.ts" | kind=code-symbol | source=scripts/smoke-production-intelligence-consumer-versioning.ts:L1 | neighbors=[a1909f3 fix(production): version intell…, ProductionHealthApiClient.ts, getProductionHealth(), ProductionHealthService.ts, ProductionHealthService, ProductionIntelligenceConsumer.ts]
- "scripts_smoke_production_runtime_status": "smoke-production-runtime-status.ts" | kind=code-symbol | source=scripts/smoke-production-runtime-status.ts:L1 | neighbors=[0e442b3 Sprint 111: Add production runt…, fb444fd wip: preserve C.2B.3 audit and …, ProductionRuntimeInitializer.ts, ProductionRuntimeInitializer, ProductionWorkerLifecycle.ts, ProductionWorkerLifecycle]
- "scripts_smoke_sprint_129_36_race_worker": "smoke-sprint-129-36-race-worker.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L1 | neighbors=[9d652d5 fix(production): close sprint 1…, eacb090 fix(production): close sprint 1…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…, RuntimeStoragePaths.ts, args]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runsmokesuite": "runSmokeSuite()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L1110 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assert(), assertContained(), captureOwnedTempRootIdentity(), cleanupOwnedTempRoot(), computeFileInventory()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L574 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, assertSupersessionPrecommitRejection(), check(), FixtureAssemblyProvider, FixtureVideoProvider, observeBoundedResume()]
- "security_guardedruntimemutationsession_guardedruntimefilesystem_createverifiedruntimebackup": ".createVerifiedRuntimeBackup()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L132 | neighbors=[GuardedRuntimeFilesystem, assertAtomicCreateRoots(), assertExactInventory(), atomicContainedFilePath(), beginPrivateRuntimeBackupCreateOperatio…, captureCreatedObject()]
- "types_asset_projectassets": "ProjectAssets" | kind=code-symbol | source=src/types/asset.ts:L88 | neighbors=[AnimationAssetPipeline.ts, AssetManager.ts, VisualAssetPipeline.ts, AudioPipeline.ts, smoke-production-audio-asset-wiring.ts, smoke-production-end-to-end.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-013.json

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
