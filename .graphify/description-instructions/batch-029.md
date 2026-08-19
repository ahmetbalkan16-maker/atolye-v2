# Node Description Batch 30 of 166

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

- "types_asset_imagemimetype": "ImageMimeType" | kind=code-symbol | source=src/types/asset.ts:L102 | neighbors=[AnimationAssetPipeline.ts, VideoAssemblyManager.ts, VisualAssetPipeline.ts, ImageProviderConfig.ts, RealPhotoImageProvider.ts, VideoProvider.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorrequest": "ProductionExecutionCoordinatorRequest" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L10 | neighbors=[ProductionExecutionCoordinator.ts, smoke-production-execution-coordinator.…, smoke-production-execution-lifecycle.ts, smoke-production-execution-worker.ts, smoke-production-pipeline-durable-execu…, smoke-production-recovery-bootstrap.ts]
- "types_productionintelligence_productionactiontype": "ProductionActionType" | kind=code-symbol | source=src/types/productionIntelligence.ts:L6 | neighbors=[ProductionActionEngine.ts, ProductionExecutionAuthorization.ts, ProductionExecutionContract.ts, ProductionExecutionGateway.ts, ProductionIntelligenceConsumer.ts, productionExecutionAuthorization.ts]
- "types_project_packagestatus": "PackageStatus" | kind=code-symbol | source=src/types/project.ts:L44 | neighbors=[PipelineJobManager.ts, ProductionSnapshotContract.ts, ProjectManager.ts, projectProgress.ts, PipelineStatus.tsx, pipelineRecovery.ts]
- "types_project_projectstatus": "ProjectStatus" | kind=code-symbol | source=src/types/project.ts:L3 | neighbors=[PipelineRunner.ts, ProductionSnapshotBuilder.ts, ProductionSnapshotContract.ts, ProjectManager.ts, reconcile-fatih-129-45-backfill.ts, smoke-pipeline-auto-continuation.ts]
- "types_research": "research.ts" | kind=code-symbol | source=src/types/research.ts:L1 | neighbors=[AIManager.ts, ResearchStructuredOutput.ts, 91ba270 Atölye V2 checkpoint - pipeline…, PipelineStageExecutor.ts, page.tsx, page.tsx]
- "video_videopipeline_scenevideogenerationerror": "SceneVideoGenerationError" | kind=code-symbol | source=src/lib/video/VideoPipeline.ts:L26 | neighbors=[VideoPipeline.ts, requireProviderName(), requireValidBatch(), .constructor(), validateImage(), validateMotionAsset()]
- "youtube_youtubepackagepipeline_youtubepackagepipeline": "YouTubePackagePipeline" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L42 | neighbors=[PipelineStageExecutor.ts, YouTubePublishPipeline.ts, smoke-production-end-to-end-stabilizati…, smoke-production-readiness-acceptance.ts, smoke-production-youtube-package-pipeli…, route.ts]
- "youtube_youtubepackagepipeline_youtubepackagepipeline_generatepackage": ".generatePackage()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L43 | neighbors=[YouTubePackagePipeline, normalizeModel(), requireFinalVideoAsset(), requireThumbnailAsset(), requireTimestamp(), requireVideoDuration()]
- "ai_audioaiconfig": "AudioAIConfig.ts" | kind=code-symbol | source=src/lib/ai/AudioAIConfig.ts:L1 | neighbors=[AudioAIConfigError, audioTokenBudget, getAudioMaxTokens(), AudioManager.ts, 6286a7c feat(audio): complete truncatio…, ProductionReadinessService.ts]
- "ai_generationexecutionpolicy_generationfallbackblockederror": "GenerationFallbackBlockedError" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L8 | neighbors=[GenerationExecutionPolicy.ts, failClosedOrReturn(), .constructor(), smoke-production-readiness-acceptance.ts, smoke-sprint-129-26-audio-truncation-bu…, smoke-sprint-129-37-assembly-truncation…]
- "ai_researchaiconfig_getresearchmaxtokens": "getResearchMaxTokens()" | kind=code-symbol | source=src/lib/ai/ResearchAIConfig.ts:L18 | neighbors=[AIManager.ts, ResearchAIConfig.ts, ResearchAIConfigError, ProductionReadinessService.ts, smoke-sprint-129-13-script-settlement.ts, smoke-sprint-129-20-visuals-truncation-…]
- "ai_scenestructuredoutput_validateproviderscenes": "validateProviderScenes()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L98 | neighbors=[SceneStructuredOutput.ts, parseStrictScenesResponse(), exactFields(), isRecord(), observedType(), validateScenes()]
- "ai_scriptstructuredoutput_parsestrictscriptresponse": "parseStrictScriptResponse()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L38 | neighbors=[AIManager.ts, ScriptStructuredOutput.ts, validateProviderScript(), smoke-sprint-129-13-script-settlement.ts, smoke-sprint-129-15-script-timestamp.ts, smoke-sprint-129-17-scenes-structured-o…]
- "animation_animationassetpipeline_animationassetpipeline_generateanimationassets": ".generateAnimationAssets()" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L59 | neighbors=[AnimationAssetPipeline, persistProviderUsage(), prepareScenes(), requireProviderName(), requireReplayPlan(), requireValidPlan()]
- "animation_animationservice_animationservice": "AnimationService" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L78 | neighbors=[AnimationService.ts, .generateFromAnimationData(), .generateFromAnimationScenes(), .generateFromSceneVisualData(), .regenerateSceneAnimation(), .requestAnimations()]
- "animation_animationstorage_animationstorage_getanimationdir": ".getAnimationDir()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L56 | neighbors=[AnimationStorage, safeSegment(), .getMotionPlanPath(), .inspectStoredMotionPlan(), .motionPlanTargetExists(), .removeMotionPlanIfExists()]
- "animation_animationstorage_animationstorage_inspectstoredmotionplan": ".inspectStoredMotionPlan()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L118 | neighbors=[AnimationStorage, .getAnimationDir(), requireStorageSentinel(), resolve(), validateArtifact(), .saveMotionPlan()]
- "animation_animationstructuredoutput_issue": "issue()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L216 | neighbors=[AnimationStructuredOutput.ts, exactFields(), validateAnimationProviderPlan(), validateEnum(), validateFrame(), validateNumericObject()]
- "assembly_videoassemblymanager_videoassemblymanager": "VideoAssemblyManager" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L60 | neighbors=[VideoAssemblyManager.ts, .renderExistingAssets(), PipelineStageExecutor.ts, smoke-assembly-scene-video-consumption.…, smoke-production-animation-provider.ts, smoke-production-video-assembly-wiring.…]
- "assets_visualassetpipeline_visualassetpipeline": "VisualAssetPipeline" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L66 | neighbors=[route.ts, VisualAssetPipeline.ts, .generateAssets(), PipelineStageExecutor.ts, smoke-production-real-photo-source.ts, smoke-production-visual-asset-wiring.ts]
- "audio_audioasseterror_createaudioasseterrorevidence": "createAudioAssetErrorEvidence()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L68 | neighbors=[AudioAssetError.ts, .constructor(), integer(), sanitizeTarget(), AudioPipeline.ts, OpenAIAudioProvider.ts]
- "audio_audioasseterror_getaudioasseterrorevidence": "getAudioAssetErrorEvidence()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L162 | neighbors=[AudioAssetError.ts, isAudioAssetErrorEvidence(), AudioPipeline.ts, PipelineErrorEvidence.ts, ProductionExecutionWorker.ts, OpenAIAudioProvider.ts]
- "audio_audiocompensationstore_cleanuproot": "cleanupRoot()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1673 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, cleanupLogicalRoot(), requireProjectSlug(), cleanupRootIfPresent(), requireDeferredWorkspace()]
- "audio_audiocompensationstore_islogicallyretired": "isLogicallyRetired()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2363 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), inspectDeferredBacklog(), AudioCompensationStoreError, readRetirementPlan(), retirementFileName()]
- "audio_audiocompensationstore_parseretirementfilename": "parseRetirementFileName()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1339 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), assertProtectedAudioCanonicalResolution…, inspectDeferredBacklog(), isSafeAudioCompensationRef(), resumeDetachedCompletedRecords()]
- "audio_audiocompensationstore_resumeterminalretirements": "resumeTerminalRetirements()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1082 | neighbors=[AudioCompensationStore.ts, prepareAudioCompensationWorkspace(), pruneCompletedAudioCompensationRecords(), cleanupRootIfPresent(), executeRetirementPlan(), parseRetirementFileName()]
- "audio_audioidentifierpolicy_issafeaudioidentifier": "isSafeAudioIdentifier()" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L32 | neighbors=[AudioAssetError.ts, AudioIdentifierPolicy.ts, containsReservedSafeEvidenceTerm(), requireSafeAudioIdentifier(), AudioPipeline.ts, AudioPublicationIntentStore.ts]
- "audio_audiomanager_audiomanager_generateaudiodata": ".generateAudioData()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L27 | neighbors=[AudioManager, .createFallbackAudioData(), .mapMusic(), .mapNarrator(), .mapProduction(), .mapSections()]
- "audio_audiopipeline_audiofailure": "audioFailure()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L644 | neighbors=[AudioPipeline.ts, addAssetOrFail(), AudioAssetGenerationError, .generateAudio(), buildAndValidateBatch(), generateAndNormalize()]
- "audio_audiopublicationintentstore_audiopublicationintentconflicterror": "AudioPublicationIntentConflictError" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L51 | neighbors=[AudioPublicationIntentStore.ts, .constructor(), AudioPublicationIntentError, getCommittedAudioPublicationAssets(), getPreparedAudioPublicationIntent(), readIntentCollection()]
- "backup_runtimebackupauthority_canonicalbackuproot": "canonicalBackupRoot()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L133 | neighbors=[RuntimeBackupAuthority.ts, assertTrustedRuntimeBackupStorageAuthor…, bootstrapRuntimeBackupStorageAuthority(), bootstrapTestRuntimeBackupStorageAuthor…, authorityInvalid(), samePath()]
- "backup_runtimebackupauthority_readmarker": "readMarker()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L94 | neighbors=[RuntimeBackupAuthority.ts, assertTrustedRuntimeBackupStorageAuthor…, authorityInvalid(), samePath(), serializeMarker(), validRuntimeAuthorityId()]
- "backup_runtimebackupinventory_collectruntimebackupinventorywithpolicy": "collectRuntimeBackupInventoryWithPolicy()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L91 | neighbors=[RuntimeBackupInventory.ts, assertRuntimeBackupTreeMatchesManifest(), collectRuntimeBackupInventory(), assertUniquePortablePaths(), collectGitMetadata(), projectScanRoot()]
- "backup_runtimebackupinventory_walkruntimetree": "walkRuntimeTree()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L213 | neighbors=[RuntimeBackupInventory.ts, collectRuntimeBackupInventoryWithPolicy…, classifyRuntimeFile(), hashStableRuntimeFile(), inferProjectSlug(), relativePosix()]
- "backup_runtimebackupmanifest_serializeruntimebackupmanifest": "serializeRuntimeBackupManifest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L105 | neighbors=[RuntimeBackupManifest.ts, validateRuntimeBackupManifest(), RuntimeBackupVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts, smoke-sprint-129-25c-2b-1-migration-can…, smoke-sprint-129-25c-2b-2-migration-can…]
- "backup_runtimebackuppathpolicy_assertruntimebackupmaterializedpath": "assertRuntimeBackupMaterializedPath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L77 | neighbors=[RuntimeBackupPathPolicy.ts, invalidPath(), validateV2Segments(), validateRuntimeBackupMutationRelativePa…, RuntimeBackupVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackuppathpolicy_runtimebackuppathpolicyversion": "runtimeBackupPathPolicyVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L10 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@06fc5b7ac60729fbbafde7685ad43e98b8e6e3ed": "06fc5b7 fix(test): close sprint 129.42 smoke remediation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 91b37ec feat(production): persist Fatih…, smoke-animation-motion-plan-contract.ts, smoke-production-scene-video-rendering.…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@20717bf3bae79d9aa5b4df4b2834e94a53769541": "20717bf feat(project): add manifest layer and package status tracking" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, c17c96f feat(projects): show manifest p…, ProjectManager.ts, project.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-029.json

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
