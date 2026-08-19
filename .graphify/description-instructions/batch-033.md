# Node Description Batch 34 of 166

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

- "scripts_smoke_sprint_129_33_exhausted_retry_admission_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L77 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertSafeCli(), cliEvidence(), hostileMatrix(), main(), manifestSeedEvidence()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_captureownedtemprootidentity": "captureOwnedTempRootIdentity()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L161 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assertContained(), runCanonicalRewindPoisonRegression(), runCleanupSafetyRegression(), runExactRewindOwnershipRegression(), runRealOrdinalFourProductionWriterTest()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_cleanupownedtemproot": "cleanupOwnedTempRoot()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L187 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assertNoCleanupLinks(), runCanonicalRewindPoisonRegression(), runCleanupSafetyRegression(), runExactRewindOwnershipRegression(), runRealOrdinalFourProductionWriterTest()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runcanonicalrewindpoisonregression": "runCanonicalRewindPoisonRegression()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L732 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, captureOwnedTempRootIdentity(), cleanupOwnedTempRoot(), computeFileInventory(), inventoryDigest(), rewindOwnedProjectToExhaustedAudioFixtu…]
- "scripts_validate_canonical_smoke_evidence_mutate": "mutate()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L390 | neighbors=[validate-canonical-smoke-evidence.ts, forgeInventory(), read(), writeRaw(), rebaseRoot(), rebindBaseline()]
- "scripts_validate_canonical_smoke_evidence_rebaseroot": "rebaseRoot()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L327 | neighbors=[validate-canonical-smoke-evidence.ts, copyFixture(), authorityFor(), mutate(), normalize(), orchestratorFiles()]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl": "RuntimeBackupRestoreGuardedOperationImpl" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L992 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateRuntimeBackupRestoreOperati…, .abort(), .commit(), .constructor(), .materializeVerifiedFile()]
- "security_portablenoclobberfilepublisher_copyfileexclusivedurable": "copyFileExclusiveDurable()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L227 | neighbors=[PortableNoClobberFilePublisher.ts, inspectExactFile(), matchesIdentity(), removePublishedFileIfOwned(), syncDirectory(), publishFilePortableNoClobber()]
- "security_portablenoclobberfilepublisher_inspectexactfile": "inspectExactFile()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L396 | neighbors=[PortableNoClobberFilePublisher.ts, copyFileExclusiveDurable(), copyFileExclusiveReservation(), finalizeReservedFilePortableNoClobber(), publishFilePortableNoClobber(), publishFileViaReservedStaging()]
- "security_portablenoclobberfilepublisher_reservefileportablenoclobber": "reserveFilePortableNoClobber()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L86 | neighbors=[PortableNoClobberFilePublisher.ts, copyFileExclusiveReservation(), inspectExactFile(), isHardLinkUnavailable(), requireExpectedFile(), syncDirectory()]
- "security_portablenoclobberfilepublisher_syncdirectory": "syncDirectory()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L434 | neighbors=[PortableNoClobberFilePublisher.ts, copyFileExclusiveDurable(), copyFileExclusiveReservation(), finalizeReservedFilePortableNoClobber(), publishFilePortableNoClobber(), publishFileViaReservedStaging()]
- "sources_wikimediacommonsclient_wikimediacommonsclienterror": "WikimediaCommonsClientError" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L43 | neighbors=[smoke-production-real-photo-source.ts, WikimediaCommonsClient.ts, readBoundedBody(), .downloadImage(), .downloadOnce(), .request()]
- "storage_imagestorage_imagestorage_saveimage": ".saveImage()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L46 | neighbors=[ImageStorage, createImageFileName(), ensureStorageDirectory(), .getImagePath(), .getImageUrl(), parseImageData()]
- "storage_videostorage_videostorage_createpaths": ".createPaths()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L60 | neighbors=[VideoStorage, resolveRelative(), .getVideoDir(), .getVideoPath(), .getVideoUrl(), .createRenderPaths()]
- "studio_productionpackagesummary": "ProductionPackageSummary.tsx" | kind=code-symbol | source=src/components/studio/ProductionPackageSummary.tsx:L1 | neighbors=[e3b7e47 feat(studio): add full producti…, index.ts, projectProgress.ts, ProductionStepState, ProductionPackageSummary(), ProductionPackageSummaryProps]
- "thumbnail_thumbnailassetpipeline_thumbnailassetpipeline_generatethumbnail": ".generateThumbnail()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L43 | neighbors=[ThumbnailAssetPipeline, cleanupUnregisteredResult(), prepareThumbnailAttempt(), ThumbnailAssetGenerationError, validateAssemblyDependency(), validateInputs()]
- "thumbnail_thumbnailmanager_thumbnailmanager": "ThumbnailManager" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L19 | neighbors=[route.ts, ThumbnailManager.ts, .createFallbackThumbnailData(), .createShortText(), .generateThumbnailData(), .mapGeneration()]
- "thumbnail_thumbnailstorage_inspectimagebuffer": "inspectImageBuffer()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L243 | neighbors=[ThumbnailStorage.ts, inspectJpeg(), inspectPng(), inspectWebp(), .inspectStoredThumbnail(), .readThumbnail()]
- "thumbnail_thumbnailstorage_thumbnailstorage_getthumbnailsdir": ".getThumbnailsDir()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L124 | neighbors=[ensureSafeStorageDirectory(), ThumbnailStorage, .getThumbnailPath(), requireSafeSegment(), .inspectStoredThumbnail(), .readThumbnail()]
- "types_airesponse_airesponseschemaevidence": "AIResponseSchemaEvidence" | kind=code-symbol | source=src/types/aiResponse.ts:L37 | neighbors=[AIResponseError.ts, ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, VisualStructuredOutput.ts, aiResponse.ts]
- "types_aiusage_aiusagelog": "AIUsageLog" | kind=code-symbol | source=src/types/aiUsage.ts:L53 | neighbors=[AIUsageManager.ts, ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts, smoke-production-health-service.ts, smoke-production-snapshot-builder.ts, AIUsagePanel.tsx]
- "types_aiusage_aiusagerecord": "AIUsageRecord" | kind=code-symbol | source=src/types/aiUsage.ts:L22 | neighbors=[AIUsageManager.ts, runObservedAIRequest.ts, ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts, smoke-production-snapshot-builder.ts, AIUsagePanel.tsx]
- "types_pipelinejob_pipelinejobhistoryevent": "PipelineJobHistoryEvent" | kind=code-symbol | source=src/types/pipelineJob.ts:L44 | neighbors=[PipelineJobManager.ts, ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts, smoke-pipeline-history-persistence.ts, smoke-production-snapshot-builder.ts, PipelineJobsPanel.tsx]
- "types_productionexecutionidempotency_productionexecutionidempotencyidentity": "ProductionExecutionIdempotencyIdentity" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L18 | neighbors=[ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts, ProductionExecutionPersistence.ts, smoke-production-execution-durable-stor…, smoke-production-execution-idempotency.…, productionExecutionDurableStorage.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencypolicy": "ProductionExecutionIdempotencyPolicy" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L68 | neighbors=[ProductionExecutionIdempotency.ts, ProductionExecutionPersistence.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-idempotency.…, smoke-production-execution-persistence.…, productionExecutionDurableStorage.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencytransitionrequest": "ProductionExecutionIdempotencyTransitionRequest" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L49 | neighbors=[ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-durable-stor…, smoke-production-execution-idempotency.…, productionExecutionDurableStorage.ts]
- "types_productionexecutionpersistence_productionexecutionpersistencediagnostic": "ProductionExecutionPersistenceDiagnostic" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L25 | neighbors=[ProductionExecutionPersistence.ts, productionExecutionDurableAttempt.ts, productionExecutionDurableClaim.ts, productionExecutionDurableLease.ts, productionExecutionDurableRecovery.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrapresult": "ProductionExecutionRecoveryBootstrapResult" | kind=code-symbol | source=src/types/productionExecutionRecoveryBootstrap.ts:L56 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, ProductionRuntimeInitializer.ts, smoke-production-runtime-startup.ts, smoke-production-runtime-status.ts, smoke-production-worker-lifecycle.ts, productionExecutionRecoveryBootstrap.ts]
- "types_productionexecutionworker_productionexecutionworkerexecutionrequest": "ProductionExecutionWorkerExecutionRequest" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L17 | neighbors=[ProductionExecutionWorker.ts, ProductionPipelineExecutionAdapter.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-worker.ts, smoke-production-pipeline-durable-execu…]
- "types_productionhealth_productionhealthresult": "ProductionHealthResult" | kind=code-symbol | source=src/types/productionHealth.ts:L91 | neighbors=[ProductionActionEngine.ts, ProductionDependencyGraph.ts, ProductionHealthEngine.ts, ProductionHealthService.ts, ProductionIntelligenceService.ts, production-intelligence-fixture.ts]
- "types_productionreadiness_productionreadinessreport": "ProductionReadinessReport" | kind=code-symbol | source=src/types/productionReadiness.ts:L56 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, smoke-sprint-128-1-production-acceptanc…, smoke-sprint-129-39-stage-bounded-resum…, smoke-sprint-129-5-production-acceptanc…]
- "types_productionruntimeinitialization_productionruntimeinitializationsuccess": "ProductionRuntimeInitializationSuccess" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L29 | neighbors=[ProductionRuntimeInitializer.ts, ProductionRuntimeCompositionRoot.ts, smoke-production-worker-lifecycle.ts, smoke-sprint-129-25c-2b-4-runtime-conte…, productionRuntimeInitialization.ts, ProductionRuntimeInitializationBase]
- "types_research_researchdata": "ResearchData" | kind=code-symbol | source=src/types/research.ts:L1 | neighbors=[AIManager.ts, ResearchStructuredOutput.ts, PipelineStageExecutor.ts, page.tsx, page.tsx, sceneStep.ts]
- "types_scene_sceneitem": "SceneItem" | kind=code-symbol | source=src/types/scene.ts:L1 | neighbors=[AIManager.ts, AssemblyManager.ts, ProductionAcceptancePreflight.ts, scene.ts, AnimationPromptEngine.ts, route.ts]
- "types_thumbnail_thumbnailmimetype": "ThumbnailMimeType" | kind=code-symbol | source=src/types/thumbnail.ts:L11 | neighbors=[ProductionAcceptanceOrchestrator.ts, ThumbnailProvider.ts, YouTubePublishPipeline.ts, ThumbnailAssetPipeline.ts, ThumbnailStorage.ts, thumbnail.ts]
- "types_youtube_youtubepackagedraft": "YouTubePackageDraft" | kind=code-symbol | source=src/types/youtube.ts:L8 | neighbors=[MockYouTubeProvider.ts, OpenAIYouTubeProvider.ts, YouTubeProvider.ts, smoke-production-youtube-package-pipeli…, youtube.ts, YouTubePublishingPackage]
- "types_youtubepublish_youtubepublishproviderresult": "YouTubePublishProviderResult" | kind=code-symbol | source=src/types/youtubePublish.ts:L57 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, smoke-production-end-to-end-stabilizati…, smoke-production-publish-reconciliation…, smoke-production-youtube-publish-pipeli…]
- "types_youtubepublish_youtubepublishrequest": "YouTubePublishRequest" | kind=code-symbol | source=src/types/youtubePublish.ts:L13 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, YouTubePublishPipeline.ts, smoke-production-end-to-end-stabilizati…, smoke-production-youtube-publish-pipeli…]
- "video_videodatavalidation_isscenevideoscene": "isSceneVideoScene()" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L48 | neighbors=[VideoAssemblyManager.ts, VideoDataValidation.ts, isCompatibleVideoData(), finitePositive(), isLegacyScene(), nonEmpty()]
- "visuals_thumbnailconceptengine": "ThumbnailConceptEngine.ts" | kind=code-symbol | source=src/lib/visuals/ThumbnailConceptEngine.ts:L1 | neighbors=[c6c7bef fix: complete sprint 70 unused …, e3ecaa9 Sprint 31 Phase 3 - Add Thumbna…, visual.ts, ThumbnailConcept, index.ts, ThumbnailConceptEngine]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-033.json

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
