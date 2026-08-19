# Node Description Batch 49 of 166

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

- "security_runtimeprotectedroots_canonicalroot": "canonicalRoot()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L124 | neighbors=[RuntimeProtectedRoots.ts, invalidPath(), samePath(), canonicalRuntimePath(), .assertWritableRoot()]
- "security_runtimeprotectedroots_canonicalruntimepath": "canonicalRuntimePath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L108 | neighbors=[RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidatePreflight.ts, RuntimePathCapabilityProbe.ts, RuntimeProtectedRoots.ts, canonicalRoot()]
- "security_runtimeprotectedroots_runtimepathinside": "runtimePathInside()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L116 | neighbors=[RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidatePreflight.ts, GuardedRuntimeMutationSession.ts, RuntimeProtectedRoots.ts, overlaps()]
- "security_runtimeprotectedroots_runtimeprotectedrootsfromcontext": "runtimeProtectedRootsFromContext()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L71 | neighbors=[RuntimeBackupService.ts, smoke-sprint-129-25c-1-runtime-backup.ts, smoke-sprint-129-25c-2a-guarded-filesys…, RuntimeProtectedRoots.ts, RuntimeProtectedRoots]
- "security_runtimeprotectedroots_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L155 | neighbors=[RuntimeProtectedRoots.ts, canonicalRoot(), overlaps(), .assertWritableRoot(), sameRuntimePath()]
- "security_runtimeprotectedroots_sameruntimepath": "sameRuntimePath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L112 | neighbors=[RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidatePreflight.ts, GuardedRuntimeMutationSession.ts, RuntimeProtectedRoots.ts, samePath()]
- "security_strictruntimedto": "StrictRuntimeDto.ts" | kind=code-symbol | source=src/lib/runtime/security/StrictRuntimeDto.ts:L1 | neighbors=[RuntimeBackupService.ts, RuntimeBackupVerifier.ts, 7eef83a feat: add runtime backup v3 aut…, GuardedRuntimeMutationSession.ts, decodeStrictRuntimeDto()]
- "seo_seomanager_seomanager_generateseodata": ".generateSEOData()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L17 | neighbors=[SEOManager, isStrictSEOResponse(), .createFallbackSEOData(), .getHashtags(), .getStringArray()]
- "slug_page_formatlistitem": "formatListItem()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L435 | neighbors=[page.tsx, formatCharacterItem(), getStringValue(), isRecord(), formatTimelineItem()]
- "sources_wikimediacommonsclient_parsesearchresponse": "parseSearchResponse()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L260 | neighbors=[WikimediaCommonsClient.ts, isRecord(), selectDownloadTarget(), stripHtml(), .search()]
- "storage_audiostorage_audiostorage_getaudiourl": ".getAudioUrl()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L858 | neighbors=[AudioStorage, requireSafePathSegment(), requireSafeWavFileName(), .prepareAudio(), .saveAudio()]
- "storage_audiostorage_audiostorage_recoverpublishedaudio": ".recoverPublishedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L812 | neighbors=[AudioStorage, acquireAudioProjectWriteAuthority(), compensateProtectedPublication(), recoverPreparedPublicationIfPresent(), recoveryResult()]
- "storage_audiostorage_recovermissingpublicationbinding": "recoverMissingPublicationBinding()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1345 | neighbors=[AudioStorage.ts, compensateProtectedPublication(), .getAudioDir(), readCanonicalFileDescriptorBound(), resolvePath()]
- "storage_audiostorage_recoveryresult": "recoveryResult()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1556 | neighbors=[AudioStorage.ts, .compensatePublishedAudioResult(), .recoverPublishedAudio(), compensateProtectedPublication(), failCompensation()]
- "storage_audiostorage_requiresafewavfilename": "requireSafeWavFileName()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1630 | neighbors=[AudioStorage.ts, .getAudioPath(), .getAudioUrl(), .prepareAudio(), .saveAudio()]
- "storage_imagestorage_imagestorage_getimagepath": ".getImagePath()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L81 | neighbors=[ImageStorage, .getImagesDir(), sanitizeFileName(), .inspectStoredImage(), .saveImage()]
- "storage_videostorage_videostorage_getvideodir": ".getVideoDir()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L27 | neighbors=[VideoStorage, .createPaths(), safeSegment(), .getVideoPath(), .inspectStoredMp4()]
- "storage_videostorage_videostorage_getvideopath": ".getVideoPath()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L31 | neighbors=[VideoStorage, .createPaths(), safeMp4FileName(), .getVideoDir(), .inspectStoredMp4()]
- "storage_videostorage_videostorage_inspectstoredmp4": ".inspectStoredMp4()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L200 | neighbors=[VideoStorage, resolveRelative(), .getVideoDir(), .getVideoPath(), .inspectMp4()]
- "studio_pipelinejobspanel_formatnumber": "formatNumber()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L977 | neighbors=[PipelineJobsPanel.tsx, createPipelineHealthInsights(), getQueueHealthLabel(), JobRow(), PipelineIntelligence()]
- "studio_pipelinejobspanel_getunsupportedreason": "getUnsupportedReason()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L869 | neighbors=[PipelineJobsPanel.tsx, canCancel(), canRetry(), getStatusLabel(), JobRow()]
- "studio_pipelinejobspanel_historyrow": "HistoryRow()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L557 | neighbors=[PipelineJobsPanel.tsx, formatDate(), getHistoryDurationLabel(), getHistoryEventTimeLabel(), getHistoryStatusClassName()]
- "studio_pipelinejobspanel_pipelinejobspanel": "PipelineJobsPanel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L72 | neighbors=[PipelineJobsPanel.tsx, createHistoryInsights(), createJobSummary(), createPipelineHealthInsights(), sortHistoryEvents()]
- "studio_projectactions": "ProjectActions.tsx" | kind=code-symbol | source=src/components/studio/ProjectActions.tsx:L1 | neighbors=[0313b59 fix: complete sprint 69 jsx ent…, a6de923 feat(studio): add production da…, index.ts, ProjectActions(), ProjectActionsProps]
- "studio_studioheader": "StudioHeader.tsx" | kind=code-symbol | source=src/components/studio/StudioHeader.tsx:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, index.ts, StudioHeader(), StudioHeaderProps, StudioLayout.tsx]
- "studio_studiosidebar": "StudioSidebar.tsx" | kind=code-symbol | source=src/components/studio/StudioSidebar.tsx:L1 | neighbors=[56ff577 Sprint 14 - Project documentati…, index.ts, StudioLayout.tsx, menuItems, StudioSidebar()]
- "thumbnail_thumbnailassetpipeline_thumbnailassetpipeline": "ThumbnailAssetPipeline" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L42 | neighbors=[PipelineStageExecutor.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailAssetPipeline.ts, .compensatePersistenceFailure(), .generateThumbnail()]
- "thumbnail_thumbnailproviderconfig_resolvethumbnailprovidername": "resolveThumbnailProviderName()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderConfig.ts:L38 | neighbors=[ProductionReadinessService.ts, smoke-production-thumbnail-pipeline.ts, ThumbnailProviderConfig.ts, ThumbnailProviderConfigurationError, ThumbnailProviderRouter.ts]
- "thumbnail_thumbnailstorage_thumbnailstorage_removestoredthumbnail": ".removeStoredThumbnail()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L202 | neighbors=[ThumbnailStorage, requireSafeFileName(), requireSafeSegment(), .getThumbnailPath(), .getThumbnailsDir()]
- "thumbnails_route_post": "POST()" | kind=code-symbol | source=app/api/thumbnails/route.ts:L9 | neighbors=[route.ts, isAssemblyPlanData(), isAudioData(), loadProjectThumbnailSources(), normalizeSlug()]
- "types_airesponse_airesponseschemaissue": "AIResponseSchemaIssue" | kind=code-symbol | source=src/types/aiResponse.ts:L30 | neighbors=[ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts, VisualStructuredOutput.ts, aiResponse.ts]
- "types_animation_animationmotionframe": "AnimationMotionFrame" | kind=code-symbol | source=src/types/animation.ts:L34 | neighbors=[AnimationMotionPlanValidation.ts, AnimationStructuredOutput.ts, AnimationProvider.ts, FFmpegSceneVideoProvider.ts, animation.ts]
- "types_animationerror_animationmotionplanerrorcode": "AnimationMotionPlanErrorCode" | kind=code-symbol | source=src/types/animationError.ts:L15 | neighbors=[AnimationMotionPlanError.ts, AnimationProvider.ts, OpenAIAnimationProvider.ts, smoke-sprint-129-21-animation-failure-d…, animationError.ts]
- "types_animationerror_animationproviderdiagnosticmetadata": "AnimationProviderDiagnosticMetadata" | kind=code-symbol | source=src/types/animationError.ts:L69 | neighbors=[AnimationMotionPlanError.ts, AnimationProvider.ts, OpenAIAnimationProvider.ts, animationError.ts, AnimationMotionPlanErrorEvidence]
- "types_pipelinejob_pipelinejobstatus": "PipelineJobStatus" | kind=code-symbol | source=src/types/pipelineJob.ts:L4 | neighbors=[PipelineJobManager.ts, ProductionSnapshotContract.ts, PipelineJobsPanel.tsx, pipelineJob.ts, productionSnapshot.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationrisk": "ProductionExecutionAuthorizationRisk" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L8 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionAuthorization.ts, productionExecutionConfirmation.ts, productionExecutionIdempotency.ts, productionExecutionTransaction.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptopenrequest": "ProductionExecutionAttemptOpenRequest" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L10 | neighbors=[ProductionExecutionDurableAttempt.ts, smoke-production-execution-durable-atte…, productionExecutionCoordinator.ts, productionExecutionDurableAttempt.ts, ProductionExecutionAttemptIdentity]
- "types_productionexecutiondurablelease_leasemutationbase": "LeaseMutationBase" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L26 | neighbors=[productionExecutionDurableLease.ts, ProductionExecutionLeaseAcquisitionRequ…, ProductionExecutionLeaseHeartbeatRequest, ProductionExecutionLeaseReleaseRequest, ProductionExecutionLeaseTakeoverRequest]
- "types_productionexecutiondurablelease_productionexecutiondurablelease": "ProductionExecutionDurableLease" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L19 | neighbors=[ProductionCanonicalDurableLineage.ts, ProductionExecutionDurableLease.ts, ProductionPipelineExecutionFactory.ts, productionExecutionDurableLease.ts, productionExecutionDurableStorage.ts]
- "types_productionexecutionpersistence_productionexecutionpersistencepayloadbykind": "ProductionExecutionPersistencePayloadByKind" | kind=code-symbol | source=src/types/productionExecutionPersistence.ts:L9 | neighbors=[ProductionExecutionDescriptorBoundReadA…, ProductionExecutionPersistence.ts, smoke-sprint-129-13-script-settlement.ts, smoke-sprint-129-30-persistence-boundar…, productionExecutionPersistence.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-048.json

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
