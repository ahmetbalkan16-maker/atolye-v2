# Node Description Batch 33 of 166

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

- "providers_ffmpegscenevideoprovider_ffmpegscenevideoprovider": "FFmpegSceneVideoProvider" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L36 | neighbors=[FFmpegSceneVideoProvider.ts, ConfiguredVideoProvider, .constructor(), .createImmutableVideoDispatchAdapter(), .generateVideo(), VideoProviderRouter.ts]
- "providers_ffmpegscenevideoprovider_ffmpegscenevideoprovider_generatevideo": ".generateVideo()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L52 | neighbors=[FFmpegSceneVideoProvider, buildSceneFFmpegArgs(), buildSceneFFprobeArgs(), requireSuccessfulProcess(), validateBatch(), validateExecutable()]
- "providers_imageprovider_imageprovider": "ImageProvider" | kind=code-symbol | source=src/lib/assets/providers/ImageProvider.ts:L22 | neighbors=[VisualAssetPipeline.ts, PipelineStageExecutor.ts, ImageProvider.ts, ImageProviderRouter.ts, smoke-production-end-to-end.ts, smoke-production-visual-asset-wiring.ts]
- "providers_mockaiprovider_mockaiprovider": "MockAIProvider" | kind=code-symbol | source=src/lib/ai/providers/MockAIProvider.ts:L4 | neighbors=[index.ts, MockAIProvider.ts, ConfiguredAIProvider, .createImmutableAiDispatchAdapter(), .generate(), smoke-sprint-129-27-audio-remediation.ts]
- "providers_mockexportprovider_createmockexportpackage": "createMockExportPackage()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L28 | neighbors=[ExportEngine.ts, MockExportProvider.ts, createExportItems(), createNotes(), normalizeFormat(), .generateExportPackage()]
- "providers_mockimageprovider_mockimageprovider": "MockImageProvider" | kind=code-symbol | source=src/lib/assets/providers/MockImageProvider.ts:L8 | neighbors=[ImageProviderRouter.ts, MockImageProvider.ts, ConfiguredImageProvider, .createImmutableImageDispatchAdapter(), .generateImage(), smoke-production-visual-asset-wiring.ts]
- "providers_mockthumbnailprovider_createmockthumbnaildata": "createMockThumbnailData()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L77 | neighbors=[MockThumbnailProvider.ts, buildVariants(), inferMainSubject(), .generateThumbnailPlan(), OpenAIThumbnailProvider.ts, smoke-production-end-to-end.ts]
- "providers_mockvideoassemblyprovider_mockvideoassemblyprovider": "MockVideoAssemblyProvider" | kind=code-symbol | source=src/lib/assembly/providers/MockVideoAssemblyProvider.ts:L4 | neighbors=[MockVideoAssemblyProvider.ts, ConfiguredVideoAssemblyProvider, .assemble(), .createImmutableAssemblyDispatchAdapter…, VideoAssemblyProviderRouter.ts, smoke-production-video-assembly-wiring.…]
- "providers_mockvideoprovider_mockvideoprovider": "MockVideoProvider" | kind=code-symbol | source=src/lib/video/providers/MockVideoProvider.ts:L8 | neighbors=[MockVideoProvider.ts, ConfiguredVideoProvider, .createImmutableVideoDispatchAdapter(), .generateVideo(), VideoProviderRouter.ts, smoke-production-scene-video-rendering.…]
- "providers_mockyoutubeprovider_mockyoutubeprovider": "MockYouTubeProvider" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L10 | neighbors=[MockYouTubeProvider.ts, ConfiguredYouTubeProvider, .createImmutableYoutubeDispatchAdapter(), .generatePublishingPackage(), smoke-production-youtube-package-pipeli…, smoke-sprint-129-28-production-acceptan…]
- "providers_openaiyoutubeprovider_openaiyoutubeprovider": "OpenAIYouTubeProvider" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L16 | neighbors=[OpenAIYouTubeProvider.ts, ConfiguredYouTubeProvider, .constructor(), .createImmutableYoutubeDispatchAdapter(), .generatePublishingPackage(), smoke-production-youtube-package-pipeli…]
- "providers_videoassemblyproviderconfig_videoassemblyconfigurationerror": "VideoAssemblyConfigurationError" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L7 | neighbors=[VideoAssemblyProviderConfig.ts, getFFmpegVideoAssemblyConfig(), integerValue(), requireExecutablePath(), resolveVideoAssemblyProviderName(), .constructor()]
- "providers_videoprovider_videoprovider": "VideoProvider" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L57 | neighbors=[PipelineStageExecutor.ts, VideoProvider.ts, VideoProviderRouter.ts, smoke-production-animation-provider.ts, smoke-production-end-to-end.ts, smoke-production-scene-video-rendering.…]
- "providers_youtubepublishprovider_youtubepublishprovider": "YouTubePublishProvider" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubePublishProvider.ts:L14 | neighbors=[PipelineStageExecutor.ts, YouTubePublishProvider.ts, YouTubePublishPipeline.ts, YouTubePublishProviderRouter.ts, smoke-production-end-to-end-stabilizati…, smoke-production-publish-reconciliation…]
- "publish_youtubepublishproviderrouter_youtubepublishproviderrouter": "YouTubePublishProviderRouter" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderRouter.ts:L8 | neighbors=[PipelineStageExecutor.ts, YouTubePublishPipeline.ts, YouTubePublishProviderRouter.ts, .constructor(), .getProvider(), smoke-production-youtube-publish-pipeli…]
- "publish_youtubepublishvalidation_createyoutubepackageidentity": "createYouTubePackageIdentity()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L27 | neighbors=[PipelineRecoveryPlanner.ts, YouTubePublishPipeline.ts, YouTubePublishValidation.ts, smoke-production-end-to-end-stabilizati…, smoke-production-publish-reconciliation…, smoke-production-youtube-package-pipeli…]
- "publish_youtubepublishvalidation_validateyoutubepublishreconciliationresult": "validateYouTubePublishReconciliationResult()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L90 | neighbors=[YouTubePublishPipeline.ts, YouTubePublishValidation.ts, isProvider(), requireRecord(), safeRemoteId(), safeText()]
- "research_page": "page.tsx" | kind=code-symbol | source=app/research/page.tsx:L1 | neighbors=[0a03cad refactor(types): cleanup domain…, DashboardLayout.tsx, ResearchCard(), ResearchList(), ResearchPage(), research.ts]
- "runtime_productionruntimeoperationcontext_deriveproductionruntimeoperationcontext": "deriveProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L85 | neighbors=[PipelineRunnerCanonicalRuntime.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionConfiguratio…, ProductionRuntimeOperationContext.ts, createProductionRuntimeOperationContext…, requireProductionRuntimeStorageContext()]
- "runtime_runtimestoragepaths_canonicalabsolutepath": "canonicalAbsolutePath()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L714 | neighbors=[RuntimeStoragePaths.ts, assertPathContained(), RuntimeStorageError, createRuntimeStorageContext(), ensureSafeContainedDirectory(), ensureSafeDirectory()]
- "scripts_inventory_canonical_smoke_harnesses": "inventory-canonical-smoke-harnesses.ts" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, classify(), codeUnitCompare(), files, root, rows]
- "scripts_run_canonical_smoke_validation_runharness": "runHarness()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L66 | neighbors=[run-canonical-smoke-validation.ts, main(), assertTerminalResult(), dataProjectsGitState(), discoverRemainders(), hostileEnvironment()]
- "scripts_smoke_pipeline_history_persistence_testrenamefailurepreservesdestination": "testRenameFailurePreservesDestination()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L121 | neighbors=[smoke-pipeline-history-persistence.ts, run(), history(), historyEvent(), record(), terminalJob()]
- "scripts_smoke_pipeline_history_persistence_testreplacementorderingandretention": "testReplacementOrderingAndRetention()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L92 | neighbors=[smoke-pipeline-history-persistence.ts, run(), history(), historyEvent(), record(), terminalJob()]
- "scripts_smoke_pipeline_history_persistence_testtempwritefailurepreservesdestination": "testTempWriteFailurePreservesDestination()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L164 | neighbors=[smoke-pipeline-history-persistence.ts, run(), history(), historyEvent(), record(), terminalJob()]
- "scripts_smoke_pipeline_state_corruption_main": "main()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L179 | neighbors=[smoke-pipeline-state-corruption.ts, testMalformedHistory(), testMalformedJobs(), testMissingFiles(), testStructurallyInvalidHistory(), testStructurallyInvalidJobs()]
- "scripts_smoke_production_end_to_end_stabilization_countingpublishprovider": "CountingPublishProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L251 | neighbors=[smoke-production-end-to-end-stabilizati…, .publish(), YouTubePublishProvider, failureCancellationAndValidation(), happyPathAndReplay(), reconciliationAndRestart()]
- "scripts_smoke_production_end_to_end_stabilization_reconciliationandrestart": "reconciliationAndRestart()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L100 | neighbors=[smoke-production-end-to-end-stabilizati…, CountingPublishProvider, pass(), publishedRecord(), publishingIntent(), resetPublish()]
- "scripts_smoke_production_health_api_consumer_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L12 | neighbors=[smoke-production-health-api-consumer.ts, abortablePendingFetch(), assertConsumerError(), cloneReport(), createJsonFetch(), rejectingFetch()]
- "scripts_smoke_production_health_rules_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L172 | neighbors=[smoke-production-health-rules.ts, clone(), hasCode(), known(), setUsage(), snapshot()]
- "scripts_smoke_production_publish_reconciliation_hardening_fixedreconcileprovider": "FixedReconcileProvider" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L573 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), failClosedOutcomes(), .constructor(), .publish(), .reconcilePublish()]
- "scripts_smoke_production_publish_reconciliation_hardening_pass": "pass()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L751 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), canonicalAndReceiptPaths(), dataApiReadOnlyReconciliation(), failClosedOutcomes(), matchedReconciliation()]
- "scripts_smoke_production_publish_reconciliation_hardening_publishingintent": "publishingIntent()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L505 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), canonicalAndReceiptPaths(), failClosedOutcomes(), matchedReconciliation(), persistenceApiAndRecovery()]
- "scripts_smoke_production_snapshot_builder_verifyfilesystemreadonly": "verifyFilesystemReadOnly()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L303 | neighbors=[smoke-production-snapshot-builder.ts, run(), bundle(), captureFiles(), usage(), usageRecord()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L30 | neighbors=[smoke-sprint-129-23-production-acceptan…, configurationEnvironment(), createSchema2Marker(), exists(), inventory(), isDisposableFixture()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_explicittestauthority": "explicitTestAuthority()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L446 | neighbors=[smoke-sprint-129-28-production-acceptan…, createFailedProductionAudioRetryFixture…, createFailedPublicAudioResumeFixture(), createFailedPublicResearchFixture(), fixtureProviderOptions(), researchProvider()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_publishcapabilityfixture": "publishCapabilityFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L262 | neighbors=[smoke-sprint-129-28-production-acceptan…, createFailedProductionAudioRetryFixture…, createFailedPublicAudioResumeFixture(), createFailedPublicResearchFixture(), createPublicResumeFixture(), runCanonicalProviderGateFailure()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_verifyrecordlevelparity": "verifyRecordLevelParity()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1118 | neighbors=[smoke-sprint-129-28-production-acceptan…, descriptorBoundAdapter(), exactStorePolicyEntry(), fixture(), installRecordOpenRace(), runCanonicalProviderGateFailure()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter": "OneShotPersistenceFaultAdapter" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L42 | neighbors=[smoke-sprint-129-30-persistence-boundar…, .constructor(), .listKeys(), .matches(), .read(), .write()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L2084 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertZero(), cliEvidence(), hostileMatrix(), manifestSeedEvidence(), retryAndRecoveryEvidence()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-032.json

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
