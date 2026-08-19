# Node Description Batch 29 of 166

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

- "providers_openaithumbnailprovider_openaithumbnailprovider": "OpenAIThumbnailProvider" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L18 | neighbors=[OpenAIThumbnailProvider.ts, ConfiguredThumbnailProvider, .constructor(), .createImmutableThumbnailDispatchAdapte…, .generateThumbnailAsset(), .generateThumbnailPlan()]
- "providers_openrouterprovider": "OpenRouterProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/OpenRouterProvider.ts:L1 | neighbors=[6c1ae5a Sprint 15 - Multi AI Provider A…, 99834f4 feat: complete Sprint 129.28 du…, index.ts, AIProvider.ts, ConfiguredAIProvider, OpenRouterProvider]
- "providers_realphotoimageprovider_realphotoimageprovider": "RealPhotoImageProvider" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L40 | neighbors=[ImageProviderRouter.ts, RealPhotoImageProvider.ts, ConfiguredImageProvider, .constructor(), .createImmutableImageDispatchAdapter(), .generateImage()]
- "providers_thumbnailprovider_thumbnailprovider": "ThumbnailProvider" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L78 | neighbors=[PipelineStageExecutor.ts, ThumbnailProvider.ts, smoke-production-end-to-end.ts, smoke-production-readiness-acceptance.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailAssetPipeline.ts]
- "providers_videoproviderconfig_getffmpegscenevideoconfig": "getFFmpegSceneVideoConfig()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L34 | neighbors=[ProductionReadinessService.ts, FFmpegSceneVideoProvider.ts, VideoProviderConfig.ts, comparablePath(), integerValue(), requireExecutablePath()]
- "providers_videoproviderrouter_videoproviderrouter": "VideoProviderRouter" | kind=code-symbol | source=src/lib/video/providers/VideoProviderRouter.ts:L6 | neighbors=[PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, VideoProviderRouter.ts, .getProvider(), smoke-sprint-129-28-production-acceptan…]
- "providers_youtubedataapipublishprovider_youtubedataapipublishprovider_publish": ".publish()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L44 | neighbors=[YouTubeDataApiPublishProvider, descriptionWithMarker(), detectThumbnailMime(), failure(), isTrustedUploadUrl(), readBoundedJson()]
- "publish_youtubepublishpipeline_youtubepublishpipeline": "YouTubePublishPipeline" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L42 | neighbors=[PipelineStageExecutor.ts, YouTubePublishPipeline.ts, .publishStoredPackage(), smoke-production-end-to-end-stabilizati…, smoke-production-publish-reconciliation…, smoke-production-readiness-acceptance.ts]
- "runtime_runtimestoragepaths_containedpath": "containedPath()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L650 | neighbors=[RuntimeStoragePaths.ts, assertNoDualRootDivergence(), assertProjectWriteAuthorityWithContext(), assertPathContained(), createRuntimeStorageContext(), getMachineRuntimeRoot()]
- "runtime_runtimestoragepaths_requireprojectslug": "requireProjectSlug()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L657 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), assertProjectWriteAuthority(), assertProjectWriteAuthorityLease(), getLogicalProjectIdentity(), getProjectRoot()]
- "scripts_run_canonical_smoke_evidence": "run-canonical-smoke-evidence.ts" | kind=code-symbol | source=scripts/run-canonical-smoke-evidence.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, CanonicalSmokeEvidence.ts, CanonicalEvidenceError, CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), defaultEvidenceRoot()]
- "scripts_smoke_production_controlled_execution_gateway": "smoke-production-controlled-execution-gateway.ts" | kind=code-symbol | source=scripts/smoke-production-controlled-execution-gateway.ts:L1 | neighbors=[e70e173 feat(production): add controlle…, ProductionControlledExecutionGateway.ts, defaultProductionControlledExecutionGat…, evaluateProductionControlledExecutionGa…, input, main()]
- "scripts_smoke_production_end_to_end_stabilization_recoveryplannerconsistency": "recoveryPlannerConsistency()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L169 | neighbors=[smoke-production-end-to-end-stabilizati…, CountingPublishProvider, markAllCompleted(), pass(), publishedRecord(), publishingIntent()]
- "scripts_smoke_production_health_service_writecompletefixture": "writeCompleteFixture()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L309 | neighbors=[smoke-production-health-service.ts, run(), history(), jobs(), manifest(), project()]
- "scripts_smoke_production_planner": "smoke-production-planner.ts" | kind=code-symbol | source=scripts/smoke-production-planner.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionIntelligenceService.ts, ProductionIntelligenceService, production-intelligence-fixture.ts, intelligenceFixture(), result]
- "scripts_smoke_production_publish_reconciliation_hardening_bindingandstatevalidation": "bindingAndStateValidation()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L306 | neighbors=[smoke-production-publish-reconciliation…, FixedReconcileProvider, marker(), matchedResult(), pass(), publishingIntent()]
- "scripts_smoke_production_publish_reconciliation_hardening_main": "main()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L56 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), canonicalAndReceiptPaths(), dataApiReadOnlyReconciliation(), failClosedOutcomes(), matchedReconciliation()]
- "scripts_smoke_production_publish_reconciliation_hardening_persistenceapiandrecovery": "persistenceApiAndRecovery()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L389 | neighbors=[smoke-production-publish-reconciliation…, main(), markAllCompleted(), matchedRecord(), matchedResult(), pass()]
- "scripts_smoke_production_snapshot_builder_bundle": "bundle()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L164 | neighbors=[smoke-production-snapshot-builder.ts, history(), jobs(), manifest(), project(), usage()]
- "scripts_smoke_production_visual_asset_wiring_run": "run()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L527 | neighbors=[smoke-production-visual-asset-wiring.ts, createMockProvider(), createProvider(), createSuccessProvider(), expectSafeFailure(), generate()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L38 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, configurationEnvironment(), createBinaries(), createSchema2Fixture(), inventory(), isDisposableFixture()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L72 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, createFixture(), initializeGitFixture(), runConcurrentCreateChild(), runSourceDriftChild(), runtimeDiff()]
- "security_guardedruntimefilesystem": "GuardedRuntimeFilesystem.ts" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeFilesystem.ts:L1 | neighbors=[RuntimeBackupService.ts, aecde83 feat(runtime): add guarded file…, RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-1-runtime-backup.ts, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_beginprivateruntimebackupcreateoperation": "beginPrivateRuntimeBackupCreateOperation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L791 | neighbors=[GuardedRuntimeMutationSession.ts, beginRuntimeBackupMutationKey, .close(), .createOwnedDirectory(), .ensureDirectory(), invalidPath()]
- "security_guardedruntimemutationsession_beginprivateruntimebackuprestoreoperationwithsession": "beginPrivateRuntimeBackupRestoreOperationWithSession()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L845 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateLegacyRuntimeBackupRestoreO…, beginPrivateRuntimeBackupRestoreOperati…, .close(), .createOwnedDirectory(), .ensureDirectory()]
- "security_guardedruntimemutationsession_guardedexclusivemutation": "guardedExclusiveMutation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1345 | neighbors=[GuardedRuntimeMutationSession.ts, assertIdentity(), captureCreatedObject(), identityMatches(), invalidPath(), isHardLinkUnavailable()]
- "security_guardedruntimemutationsession_guardedruntimefilesystem": "GuardedRuntimeFilesystem" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L123 | neighbors=[GuardedRuntimeFilesystem.ts, GuardedRuntimeMutationSession.ts, .beginMutation(), .beginMutationWithValidator(), .[beginRuntimeBackupMutationKey](), .constructor()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_publicboundary": ".publicBoundary()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L756 | neighbors=[GuardedRuntimeMutationSession, .acquireExclusiveReservation(), .copyOwnedFileExclusive(), .createOwnedDirectory(), .ensureDirectory(), .ensureOwnedDirectory()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_sessiontokenmatches": ".sessionTokenMatches()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L781 | neighbors=[GuardedRuntimeMutationSession, .assertActive(), .assertOwned(), .cleanupOwnedDirectory(), .close(), .closeRetainingOwnedDirectory()]
- "storage_audiostorage_acquireaudioprojectwriteauthority": "acquireAudioProjectWriteAuthority()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1582 | neighbors=[AudioStorage.ts, .commitPreparedAudio(), .compensatePublishedAudioResult(), .handoffPublishedAudio(), .isPublishedAudioRegistryOwned(), .prepareAudio()]
- "storage_audiostorage_audiostorage_getaudiodir": ".getAudioDir()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L850 | neighbors=[AudioStorage, requireSafePathSegment(), .getAudioPath(), .readStoredWav(), cleanupTerminalCompensation(), compensateProtectedPublication()]
- "storage_audiostorage_audiostorage_getaudiopath": ".getAudioPath()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L854 | neighbors=[AudioStorage, .getAudioDir(), requireSafeWavFileName(), .inspectStoredWav(), .isPreparedAudio(), .prepareAudio()]
- "storage_storagepathsecurity_requirecontainedstoragefile": "requireContainedStorageFile()" | kind=code-symbol | source=src/lib/assets/storage/StoragePathSecurity.ts:L14 | neighbors=[AnimationStorage.ts, AudioDescriptorBoundVerification.ts, ProductionReadinessService.ts, AudioStorage.ts, ImageStorage.ts, StoragePathSecurity.ts]
- "studio_projectstatuscards": "ProjectStatusCards.tsx" | kind=code-symbol | source=src/components/studio/ProjectStatusCards.tsx:L1 | neighbors=[9f6b3a2 feat(audio): integrate audio en…, a6de923 feat(studio): add production da…, e3b7e47 feat(studio): add full producti…, index.ts, projectProgress.ts, ProductionStepState]
- "thumbnail_thumbnailassetpipeline_thumbnailassetgenerationerror": "ThumbnailAssetGenerationError" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L22 | neighbors=[PipelineStageExecutor.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailAssetPipeline.ts, .constructor(), .generateThumbnail(), validateAssemblyDependency()]
- "thumbnail_thumbnailengine_thumbnailengine": "ThumbnailEngine" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L18 | neighbors=[PipelineStageExecutor.ts, smoke-production-readiness-acceptance.ts, ThumbnailEngine.ts, generateThumbnailPlan(), .constructor(), .createFallback()]
- "thumbnail_thumbnailstorage_requiresafesegment": "requireSafeSegment()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L380 | neighbors=[ThumbnailStorage.ts, .getThumbnailPath(), .getThumbnailsDir(), .getThumbnailUrl(), .inspectStoredThumbnail(), .readThumbnail()]
- "thumbnail_thumbnailstorage_thumbnailstorage_getthumbnailpath": ".getThumbnailPath()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L129 | neighbors=[ThumbnailStorage, requireSafeFileName(), requireSafeSegment(), .getThumbnailsDir(), .inspectStoredThumbnail(), .readThumbnail()]
- "thumbnail_thumbnailstorage_thumbnailstorage_readthumbnail": ".readThumbnail()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L178 | neighbors=[ThumbnailStorage, inspectImageBuffer(), mimeTypeForExtension(), requireSafeFileName(), requireSafeSegment(), .getThumbnailPath()]
- "types_asset_imagegenerationresult": "ImageGenerationResult" | kind=code-symbol | source=src/types/asset.ts:L166 | neighbors=[VisualAssetPipeline.ts, ImageProvider.ts, MockImageProvider.ts, OpenAIImageProvider.ts, RealPhotoImageProvider.ts, smoke-production-real-photo-source.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-028.json

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
