# Node Description Batch 12 of 166

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

- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e3b5c6cddc45949983b4bf11cd098a3c6450702b": "e3b5c6c Sprint 110: Add production worker lifecycle" | kind=Commit | source=git | neighbors=[af745ac Sprint 109: Process Startup Boo…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@fa9d06c26a77ce483ff2317d414e22f02acce198": "fa9d06c fix(production): harden intelligence phase contracts" | kind=Commit | source=git | neighbors=[d3c574c feat(production): add intellige…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "production_productioncontrolledexecutiongateway": "ProductionControlledExecutionGateway.ts" | kind=code-symbol | source=src/lib/production/ProductionControlledExecutionGateway.ts:L1 | neighbors=[e70e173 feat(production): add controlle…, defaultProductionControlledExecutionGat…, evaluateProductionControlledExecutionGa…, names, orchestration(), ProductionDeterminism.ts]
- "production_productionexecutiondurableattemptintegrity": "ProductionExecutionDurableAttemptIntegrity.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttemptIntegrity.ts:L1 | neighbors=[b1480fe fix(production): close durable …, HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionDurableAttempt.ts, ProductionDeterminism.ts, stableProductionId(), buildProductionExecutionAttemptBindingF…]
- "production_productionplanner": "ProductionPlanner.ts" | kind=code-symbol | source=src/lib/production/ProductionPlanner.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, fa9d06c fix(production): harden intelli…, ProductionIntelligenceService.ts, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, ProductionDeterminism.ts]
- "projects_projectmanager_projectmanager_updatepackagestatus": ".updatePackageStatus()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L182 | neighbors=[ProjectManager, .markYouTubePublished(), .saveAnimation(), .saveAssembly(), .saveAudio(), .saveExport()]
- "scripts_smoke_production_end_to_end_run": "run()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L48 | neighbors=[smoke-production-end-to-end.ts, corruptFile(), DeterministicAIProvider, DeterministicYouTubeProvider, expectFailure(), fixtureGuardScenarios()]
- "scripts_smoke_production_intelligence_review": "smoke-production-intelligence-review.ts" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L1 | neighbors=[4bcbdf6 chore(production): review produ…, ProductionHealthApiClient.ts, getProductionHealth(), isProductionHealthApiConsumerError(), ProductionHealthApiError.ts, createProductionHealthErrorResponse()]
- "scripts_smoke_production_snapshot_contract": "smoke-production-snapshot-contract.ts" | kind=code-symbol | source=scripts/smoke-production-snapshot-contract.ts:L1 | neighbors=[8ac37cd feat(production): add snapshot …, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, ProductionSnapshotContract.ts, calculateCoverage(), createCanonicalStageOrder()]
- "storage_storagepathsecurity": "StoragePathSecurity.ts" | kind=code-symbol | source=src/lib/assets/storage/StoragePathSecurity.ts:L1 | neighbors=[AnimationStorage.ts, AudioDescriptorBoundVerification.ts, 3480988 Sprint 115: Activate production…, 507becc Sprint 129.25B: Runtime root ab…, ProductionReadinessService.ts, AudioStorage.ts]
- "types_productionexecutiondurablerecovery": "productionExecutionDurableRecovery.ts" | kind=code-symbol | source=src/types/productionExecutionDurableRecovery.ts:L1 | neighbors=[7561f3d feat(production): harden durabl…, ProductionExecutionPersistence.ts, productionExecutionDerivedIndexVersion, ProductionExecutionDerivedLookupEntry, ProductionExecutionDerivedLookupIndex, ProductionExecutionDirectoryDurabilityR…]
- "types_productionexecutionrecoverybootstrap": "productionExecutionRecoveryBootstrap.ts" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L1 | neighbors=[3be3669 feat(production): complete dura…, ProductionExecutionRecoveryBootstrap.ts, ProductionRuntimeInitializer.ts, smoke-production-runtime-startup.ts, smoke-production-runtime-status.ts, smoke-production-worker-lifecycle.ts]
- "types_seo": "seo.ts" | kind=code-symbol | source=src/types/seo.ts:L1 | neighbors=[a4839b8 feat(seo): add youtube seo engi…, route.ts, PipelineStageExecutor.ts, ExportProvider.ts, YouTubeProvider.ts, YouTubePublishPipeline.ts]
- "assets_route": "route.ts" | kind=code-symbol | source=app/api/assets/route.ts:L1 | neighbors=[AssetManager.ts, AssetManager, filterVisualDataBySceneId(), GET(), isVisualData(), POST()]
- "audio_audiocompensationstore_readprotectedaudiocompensationreceipt": "readProtectedAudioCompensationReceipt()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L661 | neighbors=[AudioCompensationStore.ts, bindProtectedAudioCompensationPublicati…, AudioCompensationStoreError, isSafeAudioCompensationRef(), readJsonFile(), readOptionalPublication()]
- "backup_runtimebackupmanifest_validateruntimebackupmanifest": "validateRuntimeBackupManifest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L114 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, serializeRuntimeBackupManifest(), aggregateRuntimeFileRecords(), assertExactKeys(), compareText()]
- "backup_runtimebackupverifier_verifyruntimebackup": "verifyRuntimeBackup()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L36 | neighbors=[RuntimeBackupService.ts, RuntimeBackupVerifier.ts, assertBackupMaterializationBudget(), requireAbsoluteDirectory(), requireExactDirectoryEntries(), requireRegularFile()]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4cde4cdcba908fe1d0c99b28a4cdf81d635a1ccf": "4cde4cd feat(thumbnail): add thumbnail engine foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@56ff577ea0b865c3467dd86ac40f7791ac4ab348": "56ff577 Sprint 14 - Project documentation foundation" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 6c1ae5a Sprint 15 - Multi AI Provider A…, ProjectManager.ts, route.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@7696afbd508c943e318435e9066496117dbae189": "7696afb Sprint 124: Harden YouTube publish reconciliation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@7afa3c8ed2d4b40ad39127ceaa6a5560ad6da81e": "7afa3c8 feat(pipeline): integrate retry execution (Sprint 84)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ae42dc4bb5f45f32f00374379b2cc363ec26d698": "ae42dc4 Sprint 123: Stabilize production end-to-end pipeline" | kind=Commit | source=git | neighbors=[220ad1e Sprint 122: Add production YouT…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@df50289b3df1abe7b2c5ff5ab00f2e51fde2bf16": "df50289 feat(studio): improve animation pipeline and project tracking" | kind=Commit | source=git | neighbors=[9e31d20 feat(animation): add animation …, route.ts, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e31d35dfd9ea866e072c5146fe1c3aadeb4c4816": "e31d35d wip: checkpoint two-phase audio publication review findings" | kind=Commit | source=git | neighbors=[7eef83a feat: add runtime backup v3 aut…, AssetManager.ts, AudioAssetError.ts, AudioPipeline.ts, AudioPublicationIntentStore.ts, agents/api-graphify-mcp-integration]
- "export_exportengine": "ExportEngine.ts" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ExportEngine, generateExportPackage(), GenerateExportPackageInput, ExportProviderRouter.ts, ExportProviderRouter]
- "health_productionhealthrules": "ProductionHealthRules.ts" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L1 | neighbors=[ae73d56 feat(production): add determini…, ProductionHealthCoreRules.ts, ProductionHealthMetricRules.ts, categoryFromScope(), createHealthFinding(), createRule()]
- "migration_runtimemigrationcandidateservice_createverifiedmigrationcandidateinternal": "createVerifiedMigrationCandidateInternal()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L105 | neighbors=[RuntimeMigrationCandidateService.ts, assertFileMatches(), buildExpectedCandidateManifest(), completed(), containedBackupFile(), hasConflictingOperationEvidence()]
- "production_productionacceptancelegacyreauthorizationpreflight_createlegacyreauthorizationpreflight": "createLegacyReauthorizationPreflight()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L99 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, excludeAdmittedJob(), failure(), identityEvidence(), identityOfDirectory(), inside()]
- "production_productiondurableattemptlineageboundary": "ProductionDurableAttemptLineageBoundary.ts" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageBoundary.ts:L1 | neighbors=[0d87231 wip: checkpoint Sprint 129.32 s…, a029553 fix(production): close sprint 1…, b1480fe fix(production): close durable …, ProductionAcceptanceCommand.ts, BoundaryCarrier, createProductionDurableAttemptLineageBi…]
- "production_productionexecutionpersistence_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L397 | neighbors=[ProductionExecutionPersistence.ts, authorizationShape(), confirmationShape(), durableAttemptValid(), durableClaimValid(), durableLeaseValid()]
- "production_productionpipelineexecutionadapter_productionpipelinedurableexecutionerror": "ProductionPipelineDurableExecutionError" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L49 | neighbors=[ProductionDurableAttemptLineageBoundary…, ProductionPipelineExecutionAdapter.ts, .constructor(), .execute(), ProductionPipelineExecutionFactory.ts, smoke-animation-motion-plan-contract.ts]
- "providers_animationproviderrouter": "AnimationProviderRouter.ts" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderRouter.ts:L1 | neighbors=[AnimationAssetPipeline.ts, 7a10970 Sprint 127: Activate production…, ffe4b50 Sprint 116: Add animation motio…, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts]
- "providers_mockanimationprovider": "MockAnimationProvider.ts" | kind=code-symbol | source=src/lib/animation/providers/MockAnimationProvider.ts:L1 | neighbors=[68f61dc feat(animation): add animation …, 99834f4 feat: complete Sprint 129.28 du…, c6c7bef fix: complete sprint 70 unused …, ffe4b50 Sprint 116: Add animation motio…, AnimationProviderRouter.ts, AnimationProvider.ts]
- "providers_videoassemblyproviderconfig": "VideoAssemblyProviderConfig.ts" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L1 | neighbors=[3480988 Sprint 115: Activate production…, ProductionAcceptanceMediaValidation.ts, ProductionReadinessService.ts, FFmpegVideoAssemblyProvider.ts, comparablePath(), FFmpegVideoAssemblyConfig]
- "providers_videoproviderrouter": "VideoProviderRouter.ts" | kind=code-symbol | source=src/lib/video/providers/VideoProviderRouter.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, FFmpegSceneVideoProvider.ts, FFmpegSceneVideoProvider]
- "router_airouter": "AIRouter.ts" | kind=code-symbol | source=src/lib/ai/router/AIRouter.ts:L1 | neighbors=[AIProviderConfig.ts, pipeline.ts, runObservedAIRequest.ts, 0108d60 feat(ai): add mock-first provid…, e9e3d2e Sprint 16 AI Router integration, PipelineStageExecutor.ts]
- "runtime_productionruntimeoperationcontext_requireproductionruntimestoragecontext": "requireProductionRuntimeStorageContext()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L138 | neighbors=[PipelineRunner.ts, ProductionAcceptanceLegacyDurableRecove…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts, ProductionExecutionDescriptorBoundReadA…, ProductionPipelineExecutionCanonicalRun…]
- "runtime_runtimestoragepaths_ensuresafecontaineddirectory": "ensureSafeContainedDirectory()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L473 | neighbors=[AnimationStorage.ts, AudioCompensationStore.ts, AudioPublicationIntentStore.ts, ProjectWriter.ts, RuntimeStoragePaths.ts, assertPathContained()]
- "scripts_smoke_production_execution_job": "smoke-production-execution-job.ts" | kind=code-symbol | source=scripts/smoke-production-execution-job.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionExecutionContract.ts, ProductionExecutionContract, ProductionExecutionGateway.ts, ProductionExecutionGateway, ProductionExecutionJobContract.ts]
- "scripts_smoke_production_runtime_startup": "smoke-production-runtime-startup.ts" | kind=code-symbol | source=scripts/smoke-production-runtime-startup.ts:L1 | neighbors=[af745ac Sprint 109: Process Startup Boo…, e3b5c6c Sprint 110: Add production work…, ProductionRuntimeInitializer.ts, ProductionRuntimeInitializationError, ProductionRuntimeInitializer, ProductionRuntimeInitializerDependencies]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-011.json

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
