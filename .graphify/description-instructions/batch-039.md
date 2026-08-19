# Node Description Batch 40 of 166

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

- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_publishverified": ".publishVerified()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L919 | neighbors=[.createVerifiedRuntimeBackup(), RuntimeBackupCreateGuardedOperationImpl, .acquireExclusiveReservation(), .createOwnedDirectory(), .ensureDirectory(), invalidPath()]
- "security_portablenoclobberfilepublisher_publishfileviareservedstaging": "publishFileViaReservedStaging()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L181 | neighbors=[PortableNoClobberFilePublisher.ts, publishFilePortableNoClobber(), copyFileExclusiveDurable(), inspectExactFile(), isHardLinkUnavailable(), syncDirectory()]
- "security_runtimepathcapabilityprobe_proberuntimepathcapabilities": "probeRuntimePathCapabilities()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L18 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts, RuntimePathCapabilityProbe.ts, capabilityUnavailable(), filesystemKind(), isNodeError()]
- "security_runtimepathpolicy_validatemutationrelativepath": "validateMutationRelativePath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L89 | neighbors=[RuntimeMigrationCandidatePaths.ts, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts, RuntimePathPolicy.ts, invalidPath(), utf8Length()]
- "security_runtimeprotectedroots_runtimeprotectedroots_assertwritableroot": ".assertWritableRoot()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L59 | neighbors=[RuntimeProtectedRoots, canonicalRoot(), overlap(), overlaps(), .root(), samePath()]
- "sources_wikimediacommonsclient_wikimediacommonsratelimitederror": "WikimediaCommonsRateLimitedError" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L58 | neighbors=[RealPhotoImageProvider.ts, smoke-production-real-photo-source.ts, WikimediaCommonsClient.ts, .downloadOnce(), .request(), .constructor()]
- "storage_audiostorage_audiostorage_commitpreparedaudio": ".commitPreparedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L285 | neighbors=[AudioStorage, acquireAudioProjectWriteAuthority(), .handoffPublishedAudio(), completeUnusedReceipt(), getTrustedReceipt(), resolvePath()]
- "storage_audiostorage_audiostorage_compensatepublishedaudioresult": ".compensatePublishedAudioResult()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L629 | neighbors=[AudioStorage, .compensatePublishedAudio(), acquireAudioProjectWriteAuthority(), compensateProtectedPublication(), getTrustedReceipt(), recoveryResult()]
- "storage_audiostorage_audiostorage_handoffpublishedaudio": ".handoffPublishedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L675 | neighbors=[AudioStorage, .commitPreparedAudio(), .completePublishedAudio(), acquireAudioProjectWriteAuthority(), getTrustedReceipt(), registryOwnership()]
- "storage_audiostorage_audiostorage_inspectwav": ".inspectWav()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L933 | neighbors=[AudioStorage, .inspectPreparedWav(), .inspectStoredWav(), invalidWav(), .prepareAudio(), .saveAudio()]
- "storage_audiostorage_audiostorage_readstoredwav": ".readStoredWav()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L898 | neighbors=[AudioStorage, .inspectStoredWav(), .getAudioDir(), .getAudioPath(), readCanonicalFileDescriptorBound(), resolvePath()]
- "storage_audiostorage_registryownership": "registryOwnership()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1431 | neighbors=[AudioStorage.ts, .handoffPublishedAudio(), .isPublishedAudioRegistryOwned(), compensateProtectedPublication(), .getAudioDir(), resolvePath()]
- "storage_storagepathsecurity_requirecontainedstoragedirectory": "requireContainedStorageDirectory()" | kind=code-symbol | source=src/lib/assets/storage/StoragePathSecurity.ts:L47 | neighbors=[AnimationStorage.ts, AudioStorage.ts, ImageStorage.ts, StoragePathSecurity.ts, VideoStorage.ts, ThumbnailStorage.ts]
- "studio_pipelinejobspanel_createpipelinehealthinsights": "createPipelineHealthInsights()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L780 | neighbors=[PipelineJobsPanel.tsx, createJobSummary(), formatNumber(), getLongRunningJobs(), getRecentHistoryAttention(), PipelineJobsPanel()]
- "studio_pipelinejobspanel_pipelineintelligence": "PipelineIntelligence()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L513 | neighbors=[PipelineJobsPanel.tsx, formatAttentionItems(), formatLastHistoryEvent(), formatNumber(), formatOptionalDuration(), formatOptionalPercent()]
- "studio_pipelinestatus_stagedetails": "StageDetails()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L206 | neighbors=[PipelineStatus.tsx, formatCost(), formatDateTime(), formatNumber(), getDurationLabel(), getRunTypeLabel()]
- "studio_productionhealthpanel_productionhealthpanelview": "ProductionHealthPanelView()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L98 | neighbors=[smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-ui.ts, smoke-production-intelligence-consumer-…, smoke-production-intelligence-review.ts, ProductionHealthPanel.tsx]
- "studio_studiolayout": "StudioLayout.tsx" | kind=code-symbol | source=src/components/studio/StudioLayout.tsx:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, index.ts, StudioHeader.tsx, StudioLayout(), StudioLayoutProps, StudioSidebar.tsx]
- "thumbnail_thumbnailstorage_requiresafefilename": "requireSafeFileName()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L384 | neighbors=[ThumbnailStorage.ts, .getThumbnailPath(), .getThumbnailUrl(), .inspectStoredThumbnail(), .readThumbnail(), .removeStoredThumbnail()]
- "types_airesponse_airesponseobservedtype": "AIResponseObservedType" | kind=code-symbol | source=src/types/aiResponse.ts:L21 | neighbors=[AIResponseError.ts, ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, VisualStructuredOutput.ts, aiResponse.ts]
- "types_animation_animationmotiontypes": "animationMotionTypes" | kind=code-symbol | source=src/types/animation.ts:L7 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanValidation.ts, AnimationStorage.ts, AnimationStructuredOutput.ts, OpenAIAnimationProvider.ts, animation.ts]
- "types_animation_animationtransitiontypes": "animationTransitionTypes" | kind=code-symbol | source=src/types/animation.ts:L15 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanValidation.ts, AnimationStorage.ts, AnimationStructuredOutput.ts, OpenAIAnimationProvider.ts, animation.ts]
- "types_audio_audiogenerationresult": "AudioGenerationResult" | kind=code-symbol | source=src/types/audio.ts:L61 | neighbors=[AudioPipeline.ts, AudioProvider.ts, MockAudioProvider.ts, OpenAIAudioProvider.ts, smoke-production-audio-asset-wiring.ts, audio.ts]
- "types_audio_audiosection": "AudioSection" | kind=code-symbol | source=src/types/audio.ts:L78 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, AudioManager.ts, AudioPipeline.ts, MockThumbnailProvider.ts, audio.ts]
- "types_errorevidence_pipelineerrorevidence": "PipelineErrorEvidence" | kind=code-symbol | source=src/types/errorEvidence.ts:L5 | neighbors=[PipelineErrorEvidence.ts, PipelineJobManager.ts, ProjectManager.ts, errorEvidence.ts, pipelineJob.ts, project.ts]
- "types_export_exportpackagedata": "ExportPackageData" | kind=code-symbol | source=src/types/export.ts:L63 | neighbors=[ExportEngine.ts, PipelineStageExecutor.ts, ExportProvider.ts, MockExportProvider.ts, page.tsx, export.ts]
- "types_pipeline": "pipeline.ts" | kind=code-symbol | source=src/types/pipeline.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, PipelineProject, PipelineRunResult, PipelineStep, PipelineStepState, PipelineStepStatus]
- "types_productionexecutionpersistence_productionexecutionpersistenceerrorcode": "ProductionExecutionPersistenceErrorCode" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L18 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableClaim.ts, ProductionExecutionDurableLease.ts, ProductionExecutionDurableStorage.ts, ProductionExecutionPersistence.ts, productionExecutionPersistence.ts]
- "types_productionexecutiontransaction_productionexecutiontransactionplan": "ProductionExecutionTransactionPlan" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L8 | neighbors=[ProductionExecutionPersistence.ts, ProductionExecutionTransaction.ts, ProductionExecutionWorker.ts, smoke-production-execution-persistence.…, productionExecutionPersistence.ts, productionExecutionTransaction.ts]
- "types_productionintelligence_productionplanstep": "ProductionPlanStep" | kind=code-symbol | source=src/types/productionIntelligence.ts:L43 | neighbors=[ProductionExecutionContract.ts, ProductionExecutionJobContract.ts, ProductionIntelligenceConsumer.ts, ProductionPlanner.ts, smoke-production-intelligence-phase-rev…, productionIntelligence.ts]
- "types_productionregeneration_productionregenerationbinding": "ProductionRegenerationBinding" | kind=code-symbol | source=src/types/productionRegeneration.ts:L5 | neighbors=[ProductionAcceptanceExecutionScope.ts, ProductionAcceptancePolicy.ts, ProductionCompletedStageRegenerationSto…, ProductionPipelineExecutionAdapter.ts, productionRegeneration.ts, ProductionRegenerationIntent]
- "types_productionsnapshot_productionsnapshotconsistencyfinding": "ProductionSnapshotConsistencyFinding" | kind=code-symbol | source=src/types/productionSnapshot.ts:L206 | neighbors=[ProductionHealthRules.ts, ProductionSnapshotParts.ts, smoke-production-health-rules.ts, smoke-production-snapshot-contract.ts, productionHealth.ts, productionSnapshot.ts]
- "types_productionsnapshot_snapshotvalue": "SnapshotValue" | kind=code-symbol | source=src/types/productionSnapshot.ts:L13 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, production-intelligence-fixture.ts, smoke-production-health-rules.ts, smoke-production-snapshot-contract.ts, productionSnapshot.ts]
- "types_video_videoscene": "VideoScene" | kind=code-symbol | source=src/types/video.ts:L13 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, MockThumbnailProvider.ts, video.ts, VideoDataValidation.ts, VideoPipeline.ts]
- "types_visual_visualscene": "VisualScene" | kind=code-symbol | source=src/types/visual.ts:L37 | neighbors=[VisualStructuredOutput.ts, AssemblyManager.ts, animationPrompt.ts, AnimationPromptGenerator.ts, visual.ts, VisualManager.ts]
- "types_youtubepublish_youtubepublishreconciliationresult": "YouTubePublishReconciliationResult" | kind=code-symbol | source=src/types/youtubePublish.ts:L39 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts, YouTubePublishValidation.ts, smoke-production-publish-reconciliation…, youtubePublish.ts]
- "video_videopipeline_videopipeline": "VideoPipeline" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L47 | neighbors=[PipelineStageExecutor.ts, smoke-production-animation-provider.ts, smoke-production-scene-video-rendering.…, route.ts, VideoPipeline.ts, .generateVideo()]
- "visuals_animationpromptengine": "AnimationPromptEngine.ts" | kind=code-symbol | source=src/lib/visuals/AnimationPromptEngine.ts:L1 | neighbors=[71ed39b Sprint 31 Phase 2 - Add Animati…, c6c7bef fix: complete sprint 70 unused …, scene.ts, SceneItem, AnimationPromptEngine, VisualManager.ts]
- "visuals_visualpromptengine": "VisualPromptEngine.ts" | kind=code-symbol | source=src/lib/visuals/VisualPromptEngine.ts:L1 | neighbors=[018d91e feat(visuals): add Wikimedia Co…, 2320bcb Sprint 31 Phase 1 - Add Visual …, VisualManager.ts, scene.ts, SceneData, VisualPromptEngine]
- "ai_audioaiconfig_audioaiconfigerror": "AudioAIConfigError" | kind=code-symbol | source=src/lib/ai/AudioAIConfig.ts:L8 | neighbors=[AudioAIConfig.ts, .constructor(), getAudioMaxTokens(), AudioManager.ts, smoke-sprint-129-26-audio-truncation-bu…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-039.json

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
