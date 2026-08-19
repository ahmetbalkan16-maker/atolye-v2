# Node Description Batch 22 of 166

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

- "production_productionexecutionpersistence_strings": "strings()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L398 | neighbors=[ProductionExecutionPersistence.ts, authorizationShape(), confirmationShape(), durableAttemptValid(), durableClaimValid(), durableLeaseValid()]
- "production_productionexecutionpersistence_validateproductionexecutionpersistencepayload": "validateProductionExecutionPersistencePayload()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L373 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionExecutionDescriptorBoundReadA…, ProductionExecutionDurableStorage.ts, ProductionExecutionPersistence.ts]
- "production_productionexecutiontransaction_buildproductionexecutiontransactionplan": "buildProductionExecutionTransactionPlan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionTransaction.ts:L5 | neighbors=[ProductionExecutionPersistence.ts, ProductionExecutionTransaction.ts, canonicalSteps(), date(), fail(), msg()]
- "production_productionglobalterminalquiescence_validateproductionglobalterminalquiescence": "validateProductionGlobalTerminalQuiescence()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L39 | neighbors=[ProductionCanonicalDurableLineage.ts, ProductionCompletedStageRegenerationPla…, ProductionGlobalTerminalQuiescence.ts, isProductionStepKey(), parseVersionedKey(), sameSet()]
- "production_productionhealthapierror": "ProductionHealthApiError.ts" | kind=code-symbol | source=src/lib/production/ProductionHealthApiError.ts:L1 | neighbors=[6ef1840 feat(production): add read-only…, createProductionHealthErrorResponse(), logProductionHealthError(), noStoreHeaders, ProductionHealthError.ts, ProductionHealthError]
- "production_productionintelligenceconsumer_isstring": "isString()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L145 | neighbors=[ProductionIntelligenceConsumer.ts, parseAction(), parseExecutionPreview(), parseInputDescriptor(), parseJobPreview(), parseOperation()]
- "production_productionruntimeinitializer_productionruntimeinitializer": "ProductionRuntimeInitializer" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L15 | neighbors=[ProductionRuntimeInitializer.ts, .constructor(), .failure(), .initialize(), .initializeOnce(), ProductionRuntimeCompositionRoot.ts]
- "projects_projectprogress_createprogresssummary": "createProgressSummary()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L115 | neighbors=[projectProgress.ts, calculateCompletionPercentage(), getCompletedStagesFromProgress(), getCurrentStageFromProgress(), getNextStageFromProgress(), getNextTaskSuggestion()]
- "prompts_animationpromptgenerator_animationpromptgenerator": "AnimationPromptGenerator" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L31 | neighbors=[route.ts, PipelineStageExecutor.ts, AnimationPromptGenerator.ts, .createFallbackAnimationScene(), .generateAnimationData(), .generateAnimationScene()]
- "providers_audioproviderrouter_audioproviderrouter": "AudioProviderRouter" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderRouter.ts:L6 | neighbors=[AudioPipeline.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, AudioProviderRouter.ts, .getProvider()]
- "providers_ffmpegvideoassemblyprovider_spawnrunner": "SpawnRunner" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L202 | neighbors=[ProductionAcceptanceMediaValidation.ts, ProductionReadinessService.ts, FFmpegSceneVideoProvider.ts, FFmpegVideoAssemblyProvider.ts, .constructor(), .run()]
- "providers_mockaiprovider": "MockAIProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/MockAIProvider.ts:L1 | neighbors=[0108d60 feat(ai): add mock-first provid…, 99834f4 feat: complete Sprint 129.28 du…, index.ts, AIProvider.ts, ConfiguredAIProvider, MockAIProvider]
- "providers_mockthumbnailprovider_mockthumbnailprovider": "MockThumbnailProvider" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L16 | neighbors=[MockThumbnailProvider.ts, ConfiguredThumbnailProvider, .createImmutableThumbnailDispatchAdapte…, .generateThumbnailAsset(), .generateThumbnailPlan(), smoke-production-thumbnail-pipeline.ts]
- "providers_mockvideoassemblyprovider": "MockVideoAssemblyProvider.ts" | kind=code-symbol | source=src/lib/assembly/providers/MockVideoAssemblyProvider.ts:L1 | neighbors=[3480988 Sprint 115: Activate production…, 99834f4 feat: complete Sprint 129.28 du…, MockVideoAssemblyProvider, ProviderDispatchAdapterAuthority.ts, createProviderDispatchAdapter(), VideoAssemblyProvider.ts]
- "providers_providerdispatchadapterauthority_providerdispatchadapterauthority": "ProviderDispatchAdapterAuthority" | kind=code-symbol | source=src/lib/providers/ProviderDispatchAdapterAuthority.ts:L5 | neighbors=[AIProvider.ts, AnimationProvider.ts, AudioProvider.ts, ImageProvider.ts, ProviderDispatchAdapterAuthority.ts, ThumbnailProvider.ts]
- "providers_videoassemblyproviderconfig_getffmpegvideoassemblyconfig": "getFFmpegVideoAssemblyConfig()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L45 | neighbors=[ProductionAcceptanceMediaValidation.ts, ProductionReadinessService.ts, FFmpegVideoAssemblyProvider.ts, VideoAssemblyProviderConfig.ts, comparablePath(), integerValue()]
- "providers_videoassemblyproviderrouter_videoassemblyproviderrouter": "VideoAssemblyProviderRouter" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderRouter.ts:L6 | neighbors=[VideoAssemblyManager.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, VideoAssemblyProviderRouter.ts, .getProvider()]
- "publish_youtubepublishvalidation_createyoutubereconciliationmarker": "createYouTubeReconciliationMarker()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L32 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishPipeline.ts, YouTubePublishValidation.ts, isProvider(), safeRemoteId()]
- "runtime_runtimestoragepaths_assertprojectwriteauthoritylease": "assertProjectWriteAuthorityLease()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L313 | neighbors=[AudioCompensationStore.ts, AudioPublicationIntentStore.ts, ProductionCompletedStageRegenerationSer…, RuntimeStoragePaths.ts, assertProjectWriteAuthorityWithContext(), readAuthorityOwner()]
- "runtime_runtimestoragepaths_assertprojectwriteauthoritywithcontext": "assertProjectWriteAuthorityWithContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L508 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), assertProjectWriteAuthority(), assertProjectWriteAuthorityLease(), assertAuthorityClaimCompatible(), containedPath()]
- "scripts_smoke_pipeline_orchestration_jobsforstage": "jobsForStage()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L65 | neighbors=[smoke-pipeline-orchestration.ts, testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent(), testDuplicateCompletionDoesNotDuplicate…, testExistingActiveDownstreamDoesNotDupl…]
- "scripts_smoke_production_dependency_graph": "smoke-production-dependency-graph.ts" | kind=code-symbol | source=scripts/smoke-production-dependency-graph.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionActionEngine.ts, ProductionActionEngine, ProductionDependencyGraph.ts, ProductionDependencyGraphBuilder, production-intelligence-fixture.ts]
- "scripts_smoke_production_execution_contract": "smoke-production-execution-contract.ts" | kind=code-symbol | source=scripts/smoke-production-execution-contract.ts:L1 | neighbors=[d3c574c feat(production): add intellige…, ProductionExecutionContract.ts, ProductionExecutionContract, ProductionIntelligenceService.ts, ProductionIntelligenceService, production-intelligence-fixture.ts]
- "scripts_smoke_production_execution_dispatch": "smoke-production-execution-dispatch.ts" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[8017502 feat(production): add queue dis…, ProductionExecutionDispatch.ts, buildProductionExecutionDispatchEnvelop…, defaultProductionExecutionDispatchPolicy, evaluateProductionExecutionDispatchElig…, base]
- "scripts_smoke_production_execution_durable_storage_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L10 | neighbors=[smoke-production-execution-durable-stor…, auth(), conf(), create(), identity(), ops()]
- "scripts_smoke_production_snapshot_builder_run": "run()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L185 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), cloneBundle(), job(), jobs(), manifest()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_boundedsuccess": "boundedSuccess()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L200 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, assertNoDownstreamDurable(), assertProductionSeam(), assertQuiescent(), job(), observeResume()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_laterboundary": "laterBoundary()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L252 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, assertNoDownstreamDurable(), assertProductionSeam(), assertQuiescent(), job(), observeResume()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl": "RuntimeBackupCreateGuardedOperationImpl" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L876 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateRuntimeBackupCreateOperatio…, .abort(), .commit(), .constructor(), .materializeInventoryFile()]
- "security_portablenoclobberfilepublisher_publishfileportablenoclobber": "publishFilePortableNoClobber()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L40 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, PortableNoClobberFilePublisher.ts, copyFileExclusiveDurable(), inspectExactFile(), isHardLinkUnavailable(), publishFileViaReservedStaging()]
- "slug_route": "route.ts" | kind=code-symbol | source=app/api/production/health/[slug]/route.ts:L1 | neighbors=[6ef1840 feat(production): add read-only…, smoke-production-health-service.ts, smoke-production-intelligence-review.ts, ProductionHealthApiError.ts, createProductionHealthErrorResponse(), noStoreHeaders]
- "storage_filestorage_filestorage": "FileStorage" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L39 | neighbors=[AssetManager.ts, ProductionReadinessService.ts, smoke-sprint-129-25b-1-runtime-hardenin…, FileStorage.ts, .exists(), .listDirs()]
- "studio_pipelineresumeaction": "PipelineResumeAction.tsx" | kind=code-symbol | source=src/components/studio/PipelineResumeAction.tsx:L1 | neighbors=[fd0ec38 feat(studio): add pipeline resu…, index.ts, projectProgress.ts, ProjectProgress, PipelineResumeAction(), PipelineResumeActionProps]
- "studio_videopanel": "VideoPanel.tsx" | kind=code-symbol | source=src/components/studio/VideoPanel.tsx:L1 | neighbors=[8c15471 feat(video): add mock video eng…, index.ts, StudioCard.tsx, Info(), VideoPanel(), VideoPanelProps]
- "thumbnail_route": "route.ts" | kind=code-symbol | source=app/api/thumbnail/route.ts:L1 | neighbors=[56fd9c7 feat(thumbnail): add thumbnail …, ProjectManager.ts, ProjectManager, POST(), ThumbnailManager.ts, ThumbnailManager]
- "types_aiusage_airequestcontext": "AIRequestContext" | kind=code-symbol | source=src/types/aiUsage.ts:L14 | neighbors=[AIManager.ts, pipeline.ts, runObservedAIRequest.ts, AssemblyManager.ts, AudioManager.ts, AnimationPromptGenerator.ts]
- "types_animation_animationmotionplanscene": "AnimationMotionPlanScene" | kind=code-symbol | source=src/types/animation.ts:L61 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanValidation.ts, AnimationStorage.ts, VideoAssemblyManager.ts, VideoProvider.ts, smoke-assembly-scene-video-consumption.…]
- "types_productioncontrolledexecutiongateway": "productionControlledExecutionGateway.ts" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L1 | neighbors=[e70e173 feat(production): add controlle…, ProductionControlledExecutionGateway.ts, smoke-production-execution-phase-review…, ProductionControlledExecutionGatewayInp…, ProductionControlledExecutionGatewayMode, ProductionControlledExecutionGatewayPol…]
- "types_productionpipelineretrybudgetextension_retrybudgetextensiondurablebinding": "RetryBudgetExtensionDurableBinding" | kind=code-symbol | source=src/types/productionPipelineRetryBudgetExtension.ts:L1 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionPipelineRetryBudgetExtensionG…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineTerminalSettlement.ts, smoke-sprint-129-36-retry-budget-extens…, productionExecutionDurableAttempt.ts]
- "types_productionruntimestatus_productionruntimestatus": "ProductionRuntimeStatus" | kind=code-symbol | source=src/types/productionRuntimeStatus.ts:L10 | neighbors=[route.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts, ProductionWorkerLifecycle.ts, ProductionRuntimeCompositionRoot.ts, smoke-production-end-to-end.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-021.json

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
