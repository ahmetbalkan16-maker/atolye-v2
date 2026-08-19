# Node Description Batch 38 of 166

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

- "production_productionpipelineexecutionfactory_readcompletedproductionpipelinepreparation": "readCompletedProductionPipelinePreparation()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionFactory.ts:L146 | neighbors=[ProductionAcceptancePolicy.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionFactory.ts, smoke-sprint-129-28-production-acceptan…, smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-41-completed-stage-reg…]
- "production_productionpipelineexecutioninstrumentation_emitproductionpipelineexecutionevent": "emitProductionPipelineExecutionEvent()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L64 | neighbors=[PipelineRunner.ts, PipelineStageExecutor.ts, ProductionAcceptancePolicy.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionInstrumentat…]
- "production_productionpipelineretrybudgetextensionstore_assertcanonicalprojectcontainment": "assertCanonicalProjectContainment()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionStore.ts:L32 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, ensureExtensionDirectory(), readRetryBudgetExtensionAuthority(), readRetryBudgetExtensionReceipt(), writeRetryBudgetExtensionAuthority(), writeRetryBudgetExtensionReceipt()]
- "production_productionqueuedexhausteddriftrecovery_recoverqueuedexhaustedpipelinejobdrift": "recoverQueuedExhaustedPipelineJobDrift()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L68 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…, classify(), committedUnverified(), createAdapter(), rejected(), smoke-sprint-129-33-exhausted-retry-adm…]
- "production_productionreadinessservice_probestorage": "probeStorage()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L436 | neighbors=[ProductionReadinessService.ts, check(), isInside(), probeStorageAdapters(), replaceCheck(), .evaluate()]
- "production_productionreadinessservice_readvalue": "readValue()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L703 | neighbors=[ProductionReadinessService.ts, animationProviderCheck(), .apiKeyCheck(), .modelConfigurationCheck(), .probeMedia(), resolveFFmpegConfig()]
- "production_productionregenerationphysicalguard_reassertproductionregenerationphysicalproject": "reassertProductionRegenerationPhysicalProject()" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L40 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionRegenerationPhysicalGuard.ts, assertPhysicalTarget(), exactDirectory(), isContained(), samePath()]
- "production_productionregenerationphysicalguard_samepath": "samePath()" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L104 | neighbors=[ProductionRegenerationPhysicalGuard.ts, assertPhysicalTarget(), assertProductionRegenerationPhysicalPro…, exactDirectory(), reassertProductionRegenerationPhysicalP…, comparable()]
- "production_productionruntimeinitializer_productionruntimeinitializer_initializeonce": ".initializeOnce()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L25 | neighbors=[ProductionRuntimeInitializer, .initialize(), emptyCounts(), success(), validBootstrap(), validDate()]
- "production_productionsnapshotparts_collectfindings": "collectFindings()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L320 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, finding(), sortAndDedupeFindings(), sourceEntries(), sourceFinding()]
- "production_productionsnapshotparts_unavailableforsource": "unavailableForSource()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L494 | neighbors=[ProductionSnapshotParts.ts, buildHistory(), buildQueue(), buildUsage(), dependencyReadiness(), outputReadiness()]
- "production_productionworkerlifecycle_productionworkerlifecycle_snapshot": ".snapshot()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L59 | neighbors=[ProductionWorkerLifecycle, .drain(), .drainOnce(), .fail(), .startOnce(), .stopOnce()]
- "production_productionworkerlifecycle_productionworkerlifecycle_stoponce": ".stopOnce()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L229 | neighbors=[ProductionWorkerLifecycle, .stop(), .drain(), .snapshot(), .transitionTo(), result()]
- "production_productionworkerlifecycle_result": "result()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L328 | neighbors=[ProductionWorkerLifecycle.ts, .drain(), .drainOnce(), .fail(), .startOnce(), .stopOnce()]
- "projects_projectmanager_projectmanager_isrecord": ".isRecord()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L885 | neighbors=[ProjectManager, .getProjectFromManifest(), .normalizeAttemptMetadata(), .normalizeManifest(), .normalizePackages(), .normalizePackageUsage()]
- "projects_projectprogress_calculatecompletionpercentage": "calculateCompletionPercentage()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L429 | neighbors=[projectProgress.ts, calculateProductionProgress(), createManifestProjectProgress(), createProgressSummary(), getCompletionPercentage(), getProjectProgressBySlug()]
- "projects_visualmanager_visualmanager": "VisualManager" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L7 | neighbors=[VisualManager.ts, .deleteVisualData(), .ensureDataDir(), .getFilePath(), .getVisualData(), .saveVisualData()]
- "providers_aiprovider_aiprovider": "AIProvider" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L22 | neighbors=[types.ts, AIProvider.ts, ClaudeProvider.ts, GeminiProvider.ts, index.ts, smoke-production-real-photo-source.ts]
- "providers_animationprovider_animationgenerationresult": "AnimationGenerationResult" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L47 | neighbors=[AnimationAssetPipeline.ts, AnimationProvider.ts, MockAnimationProvider.ts, OpenAIAnimationProvider.ts, smoke-animation-motion-plan-contract.ts, smoke-sprint-129-21-animation-failure-d…]
- "providers_audioprovider_audiogenerationinput": "AudioGenerationInput" | kind=code-symbol | source=src/lib/audio/providers/AudioProvider.ts:L8 | neighbors=[AudioPipeline.ts, AudioProvider.ts, MockAudioProvider.ts, OpenAIAudioProvider.ts, smoke-production-audio-asset-wiring.ts, smoke-sprint-129-27-audio-remediation.ts]
- "providers_ffmpegscenevideoprovider_buildmotionfilter": "buildMotionFilter()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L232 | neighbors=[FFmpegSceneVideoProvider.ts, focusX(), focusY(), interpolate(), zoomFor(), buildSceneFFmpegArgs()]
- "providers_ffmpegscenevideoprovider_buildsceneffmpegargs": "buildSceneFFmpegArgs()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L182 | neighbors=[FFmpegSceneVideoProvider.ts, absoluteInput(), buildMotionFilter(), .generateVideo(), smoke-production-scene-video-rendering.…, smoke-sprint-129-25b-1-runtime-hardenin…]
- "providers_imageprovider_configuredimageprovider": "ConfiguredImageProvider" | kind=code-symbol | source=src/lib/assets/providers/ImageProvider.ts:L30 | neighbors=[ImageProvider.ts, MockImageProvider.ts, OpenAIImageProvider.ts, RealPhotoImageProvider.ts, smoke-production-real-photo-source.ts, smoke-production-visual-asset-wiring.ts]
- "providers_imageprovider_imagegenerationinput": "ImageGenerationInput" | kind=code-symbol | source=src/lib/assets/providers/ImageProvider.ts:L7 | neighbors=[ImageProvider.ts, MockImageProvider.ts, OpenAIImageProvider.ts, RealPhotoImageProvider.ts, smoke-production-real-photo-source.ts, smoke-production-visual-asset-wiring.ts]
- "providers_openaiaudioprovider_openaiaudioprovider_generateaudio": ".generateAudio()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L47 | neighbors=[OpenAIAudioProvider, cancelBody(), createFailure(), hasSafeContentType(), .validateInput(), readBoundedBody()]
- "providers_openaiprovider_openaiprovider": "OpenAIProvider" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L10 | neighbors=[index.ts, openai.ts, OpenAIProvider.ts, ConfiguredAIProvider, .createImmutableAiDispatchAdapter(), .generate()]
- "providers_realphotoimageprovider_realphotoimageprovider_generateimage": ".generateImage()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L82 | neighbors=[RealPhotoImageProvider, buildSearchQuery(), notFoundResult(), rankEligibleCandidates(), .paceRequest(), trySaveCandidate()]
- "providers_videoassemblyprovider_configuredvideoassemblyprovider": "ConfiguredVideoAssemblyProvider" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProvider.ts:L13 | neighbors=[FFmpegVideoAssemblyProvider.ts, MockVideoAssemblyProvider.ts, VideoAssemblyProvider.ts, smoke-production-video-assembly-wiring.…, smoke-sprint-129-39-stage-bounded-resum…, smoke-sprint-129-41-completed-stage-reg…]
- "providers_videoproviderconfig_videoproviderconfigurationerror": "VideoProviderConfigurationError" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L7 | neighbors=[VideoProviderConfig.ts, getFFmpegSceneVideoConfig(), integerValue(), requireExecutablePath(), resolveVideoProviderName(), .constructor()]
- "providers_youtubedataapipublishprovider_youtubedataapipublishprovider_reconcilepublish": ".reconcilePublish()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L157 | neighbors=[YouTubeDataApiPublishProvider, cancelResponseBody(), readBoundedJson(), readReconciliationCandidates(), reconciliationFailure(), safeProviderRequestId()]
- "providers_youtubeprovider_youtubegenerationinput": "YouTubeGenerationInput" | kind=code-symbol | source=src/lib/youtube/providers/YouTubeProvider.ts:L13 | neighbors=[youtubePackagePrompt.ts, MockYouTubeProvider.ts, OpenAIYouTubeProvider.ts, YouTubeProvider.ts, smoke-production-youtube-package-pipeli…, YouTubeEngine.ts]
- "publish_youtubepublishvalidation_youtubepublishvalidationerror": "YouTubePublishValidationError" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L17 | neighbors=[YouTubePublishValidation.ts, createYouTubePublishMetadata(), createYouTubeReconciliationMarker(), validateYouTubePublishReconciliationRes…, validateYouTubePublishRecord(), .constructor()]
- "roadmap_sprint_48": "Sprint 48 - Final Pipeline Integration" | kind=entity | source=ROADMAP.md:988 | neighbors=[Sprint 41 - Animation Scene-Level Regen…, Sprint 42 - Video Engine Foundation, Sprint 43 - Audio Engine Foundation, Sprint 44 - Assembly Engine Foundation, Sprint 49 - Real AI Provider Integratio…, Sprint 54 - Pipeline Retry & Resume Pla…]
- "runtime_runtimestoragepaths_assertauthorityclaimcompatible": "assertAuthorityClaimCompatible()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L563 | neighbors=[RuntimeStoragePaths.ts, authorityClaim(), authorityIdentity(), requireMatchingAuthorityClaim(), assertProjectWriteAuthorityWithContext(), getProjectRoot()]
- "runtime_runtimestoragepaths_assertnodualrootdivergence": "assertNoDualRootDivergence()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L526 | neighbors=[RuntimeStoragePaths.ts, containedPath(), RuntimeStorageError, samePath(), validateSafeAncestorChain(), getProjectRoot()]
- "runtime_runtimestoragepaths_authorityclaim": "authorityClaim()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L572 | neighbors=[RuntimeStoragePaths.ts, assertAuthorityClaimCompatible(), digest(), getLogicalProjectIdentity(), normalizedForIdentity(), establishAuthorityClaim()]
- "runtime_runtimestoragepaths_authorityidentity": "authorityIdentity()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L604 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), assertAuthorityClaimCompatible(), digest(), getLogicalProjectIdentity(), normalizedForIdentity()]
- "runtime_runtimestoragepaths_establishauthorityclaim": "establishAuthorityClaim()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L538 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), authorityClaim(), isNodeError(), requireMatchingAuthorityClaim(), RuntimeStorageError]
- "runtime_runtimestoragepaths_getlogicalprojectidentity": "getLogicalProjectIdentity()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L389 | neighbors=[RuntimeBackupInventory.ts, RuntimeStoragePaths.ts, authorityClaim(), authorityIdentity(), requireProjectSlug(), smoke-sprint-129-25b-runtime-root.ts]
- "runtime_runtimestoragepaths_getmachineruntimeroot": "getMachineRuntimeRoot()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L380 | neighbors=[RuntimeStoragePaths.ts, containedPath(), requireMachineSegment(), resolveRuntimeStorageContext(), smoke-sprint-129-25b-1-runtime-hardenin…, smoke-sprint-129-25b-runtime-root.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-037.json

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
