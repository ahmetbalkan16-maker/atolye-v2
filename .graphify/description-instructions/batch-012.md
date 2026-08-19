# Node Description Batch 13 of 166

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
LANGUAGE: each entry has a `lang=` marker giving the language of its source.
Write that entry's description in EXACTLY that language. Do not translate to
a single common language — match each node's source language individually.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "security_runtimemutationerror": "RuntimeMutationError.ts" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L1 | neighbors=[RuntimeBackupPathPolicy.ts, RuntimeBackupService.ts, aecde83 feat(runtime): add guarded file…, RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts] | lang=en
- "sources_wikimediacommonsclient": "WikimediaCommonsClient.ts" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L1 | neighbors=[018d91e feat(visuals): add Wikimedia Co…, 2d9074c fix(visuals): real photo source…, RealPhotoImageProvider.ts, smoke-production-real-photo-source.ts, isRecord(), parseSearchResponse()] | lang=en
- "types_animation_animationdata": "AnimationData" | kind=code-symbol | source=src/types/animation.ts:L76 | neighbors=[animationMerge.ts, AnimationMotionPlanValidation.ts, AnimationService.ts, AssemblyManager.ts, route.ts, VideoAssemblyManager.ts] | lang=en
- "types_export": "export.ts" | kind=code-symbol | source=src/types/export.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, ExportEngine.ts, ExportProviderConfig.ts, ExportProviderRouter.ts, route.ts, PipelineStageExecutor.ts] | lang=en
- "types_seo_seodata": "SEOData" | kind=code-symbol | source=src/types/seo.ts:L1 | neighbors=[route.ts, PipelineStageExecutor.ts, ExportProvider.ts, YouTubeProvider.ts, YouTubePublishPipeline.ts, smoke-production-end-to-end-stabilizati…] | lang=en
- "types_youtube_youtubepublishingpackage": "YouTubePublishingPackage" | kind=code-symbol | source=src/types/youtube.ts:L18 | neighbors=[route.ts, PipelineStageExecutor.ts, ExportProvider.ts, YouTubePublishPipeline.ts, YouTubePublishValidation.ts, smoke-production-end-to-end-stabilizati…] | lang=en
- "video_videoservice": "VideoService.ts" | kind=code-symbol | source=src/lib/video/VideoService.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, 8c15471 feat(video): add mock video eng…, VideoPanel.tsx, asset.ts, Asset, video.ts] | lang=en
- "ai_pipeline": "pipeline.ts" | kind=code-symbol | source=src/lib/ai/pipeline.ts:L1 | neighbors=[defaultProvider, router, runPipeline(), runObservedAIRequest.ts, runObservedAIRequest(), index.ts] | lang=en
- "ai_runobservedairequest_runobservedairequest": "runObservedAIRequest()" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L31 | neighbors=[AIManager.ts, pipeline.ts, runObservedAIRequest.ts, getModelName(), normalizeProviderOutput(), AssemblyManager.ts] | lang=en
- "audio_audiocompensationstore_digest": "digest()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2524 | neighbors=[AudioCompensationStore.ts, bindProtectedAudioCompensationPublicati…, buildRetirementPlan(), createProtectedAudioCompensationReceipt…, finalizeRecordPlacement(), prepareAudioCompensationWorkspace()] | lang=en
- "audio_audiomanager_audiomanager": "AudioManager" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L26 | neighbors=[AudioManager.ts, .createFallbackAudioData(), .createFallbackSection(), .extractEmphasis(), .formatDuration(), .generateAudioData()] | lang=en
- "audio_route": "route.ts" | kind=code-symbol | source=app/api/audio/route.ts:L1 | neighbors=[AudioManager.ts, AudioManager, AudioPipeline.ts, AudioPipeline, isScriptData(), POST()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@02c450e8aacb769045e58bb15645e418dde53878": "02c450e Sprint 129.25 C.2B.1: Migration Candidate Schema, Preflight & Verifier" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5a74949cd5c183f757060d941aadd94e04709d44": "5a74949 feat(animation): add scene-level animation regeneration" | kind=Commit | source=git | neighbors=[AnimationAssetPipeline.ts, animationMerge.ts, AnimationService.ts, route.ts, AssetGallery.tsx, agents/api-graphify-mcp-integration] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@61f1dbe4f0e6ab7e42a847406a65b963635cc100": "61f1dbe wip: sprint 129.28 legacy reauthorization foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6e53895dd0f81de47301111969122928f920b69a": "6e53895 Sprint 118: Consume scene videos in final assembly" | kind=Commit | source=git | neighbors=[2a03d89 Sprint 117: Activate production…, VideoAssemblyManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@72fc63379f20955abb71fab69b784765fb6f4415": "72fc633 feat(asset): integrate openai image generation with storage" | kind=Commit | source=git | neighbors=[route.ts, VisualAssetPipeline.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@94269fa7eff3cbd7640db9bd556ab97794fd8eca": "94269fa feat: complete sprint 64 pipeline job management foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@9b0257eb352606eecbd93be3fab752902e8f96b7": "9b0257e feat: complete sprint 63 pipeline diagnostics data wiring" | kind=Commit | source=git | neighbors=[4e1c917 docs: align long-term vision an…, AIUsageManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b4ec40e67a223cae9d38e107eff4309e706116a7": "b4ec40e feat(production): add persistent idempotency contract" | kind=Commit | source=git | neighbors=[150d8cb docs(production): record sprint…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b813acc635fdec129e64cbbf57005284268e2462": "b813acc feat(runtime): add verified runtime backup foundation" | kind=Commit | source=git | neighbors=[507becc Sprint 129.25B: Runtime root ab…, RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupService.ts, RuntimeBackupVerifier.ts, agents/api-graphify-mcp-integration] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c6c7bef9701f858842a71d706f7e75ac366894da": "c6c7bef fix: complete sprint 70 unused vars cleanup" | kind=Commit | source=git | neighbors=[0313b59 fix: complete sprint 69 jsx ent…, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "lib_canonicalsmokeevidencev2_aggregateevidence": "aggregateEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L861 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), deriveAggregateResult(), fail(), identityEqual(), orchestrators()] | lang=en
- "lib_canonicalsmokeevidencev2_publishintegratedjson": "publishIntegratedJson()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L264 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), aggregateEvidence(), initialize(), equal(), fail()] | lang=en
- "production_productionacceptancelegacyauthoritystore_conflict": "conflict()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L472 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ensureDirectory(), legacyArchiveLocator(), markLegacyReauthorizationValidated(), publishExactNoClobber(), publishLegacyArchive()] | lang=en
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_write": ".write()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L61 | neighbors=[ProductionExecutionFilePersistenceAdapt…, canonicalJson(), cleanup(), diagnostic(), diagnostics(), errorCode()] | lang=en
- "production_productionpipelineexecutionadapter_productionpipelineexecutionadapter": "ProductionPipelineExecutionAdapter" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L17 | neighbors=[PipelineRunner.ts, ProductionPipelineExecutionAdapter.ts, .constructor(), .execute(), ProductionPipelineExecutionCanonicalRun…, smoke-production-audio-asset-wiring.ts] | lang=en
- "production_productionreadinessservice_check": "check()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L651 | neighbors=[ProductionReadinessService.ts, animationProviderCheck(), mediaChecksWithoutWorkspace(), normalizeChecks(), probeStorage(), .apiKeyCheck()] | lang=en
- "production_productionregenerationphysicalguard": "ProductionRegenerationPhysicalGuard.ts" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, assertPhysicalTarget(), assertProductionRegenerationPhysicalPro…] | lang=en
- "providers_animationproviderconfig": "AnimationProviderConfig.ts" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L1 | neighbors=[7a10970 Sprint 127: Activate production…, ffe4b50 Sprint 116: Add animation motio…, ProductionReadinessService.ts, AnimationProviderConfigurationError, getOpenAIAnimationProviderConfig(), integer()] | lang=en
- "providers_mockaudioprovider": "MockAudioProvider.ts" | kind=code-symbol | source=src/lib/audio/providers/MockAudioProvider.ts:L1 | neighbors=[4f09cf6 Sprint 114: Activate production…, 573e9e6 feat(audio): add mock audio eng…, 99834f4 feat: complete Sprint 129.28 du…, AudioProviderRouter.ts, AudioProvider.ts, AudioGenerationInput] | lang=en
- "providers_mockimageprovider": "MockImageProvider.ts" | kind=code-symbol | source=src/lib/assets/providers/MockImageProvider.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, bec4962 Sprint 113: Activate production…, c6c7bef fix: complete sprint 70 unused …, f986047 Sprint 32 Phase 4 - Add Visual …, ImageProviderRouter.ts, ImageProvider.ts] | lang=en
- "runtime_productionruntimeoperationcontext_assertproductionruntimeoperationcontext": "assertProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L97 | neighbors=[PipelineRunnerCanonicalRuntime.ts, ProductionExecutionDescriptorBoundReadA…, ProductionPipelineExecutionCanonicalRun…, ProductionWorkerLifecycle.ts, ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationAuthori…] | lang=en
- "runtime_runtimestoragepaths_getprojectroot": "getProjectRoot()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L212 | neighbors=[ProductionPipelineRetryBudgetExtensionG…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryReconciliation.ts, ProjectReader.ts, ProjectWriter.ts] | lang=en
- "runtime_runtimestoragepaths_resolveruntimelogicalpath": "resolveRuntimeLogicalPath()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L394 | neighbors=[AnimationStorage.ts, AudioCompensationStore.ts, AudioPublicationIntentStore.ts, FFmpegSceneVideoProvider.ts, FFmpegVideoAssemblyProvider.ts, RuntimeStoragePaths.ts] | lang=en
- "scripts_smoke_production_execution_transaction": "smoke-production-execution-transaction.ts" | kind=code-symbol | source=scripts/smoke-production-execution-transaction.ts:L1 | neighbors=[d655db9 feat(production): add execution…, ProductionExecutionTransaction.ts, buildProductionExecutionTransactionPlan…, defaultProductionExecutionTransactionPo…, validateProductionExecutionTransactionP…, build()] | lang=en
- "scripts_smoke_production_health_api_consumer": "smoke-production-health-api-consumer.ts" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L1 | neighbors=[de75921 feat(production): add health ap…, ProductionHealthApiClient.ts, getProductionHealth(), isProductionHealthApiConsumerError(), ProductionHealthService.ts, ProductionHealthReport] | lang=en
- "scripts_smoke_production_readiness_acceptance_run": "run()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L60 | neighbors=[smoke-production-readiness-acceptance.ts, find(), probeDirectories(), readinessService(), trace(), verifyAcceptanceGateStopsPipeline()] | lang=en
- "studio_productionhealthfindingspanel": "ProductionHealthFindingsPanel.tsx" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L1 | neighbors=[65a14b4 feat(production): add health ev…, aba67da feat(production): add health fi…, smoke-production-health-evidence.ts, smoke-production-health-findings.ts, ProductionHealthFindingEvidence.tsx, Detail()] | lang=en
- "studio_studiocard": "StudioCard.tsx" | kind=code-symbol | source=src/components/studio/StudioCard.tsx:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, AIUsagePanel.tsx, AssemblyPanel.tsx, AudioPanel.tsx, index.ts, PipelineJobsPanel.tsx] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-012.json

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
