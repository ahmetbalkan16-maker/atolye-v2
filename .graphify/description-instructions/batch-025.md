# Node Description Batch 26 of 166

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

- "types_productionexecutiondurablelease_productionexecutionworkersessionidentity": "ProductionExecutionWorkerSessionIdentity" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L16 | neighbors=[ProductionExecutionDurableLease.ts, ProductionPipelineTerminalSettlement.ts, smoke-production-execution-coordinator.…, smoke-production-execution-lifecycle.ts, smoke-production-execution-worker.ts, smoke-production-pipeline-durable-execu…] | lang=en
- "ai_canonicaltimestamp_applicationtimestamperror": "ApplicationTimestampError" | kind=code-symbol | source=src/lib/ai/CanonicalTimestamp.ts:L1 | neighbors=[AIManager.ts, CanonicalTimestamp.ts, .constructor(), createCanonicalApplicationTimestamp(), smoke-sprint-129-15-script-timestamp.ts, smoke-sprint-129-17-scenes-structured-o…] | lang=en
- "ai_canonicaltimestamp_createcanonicalapplicationtimestamp": "createCanonicalApplicationTimestamp()" | kind=code-symbol | source=src/lib/ai/CanonicalTimestamp.ts:L11 | neighbors=[CanonicalTimestamp.ts, ApplicationTimestampError, isCanonicalTimestamp(), ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts] | lang=en
- "ai_generationexecutionpolicy_failclosedorreturn": "failClosedOrReturn()" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L18 | neighbors=[AIManager.ts, GenerationExecutionPolicy.ts, GenerationFallbackBlockedError, AssemblyManager.ts, AudioManager.ts, AnimationPromptGenerator.ts] | lang=en
- "ai_generationexecutionpolicy_generationexecutionpolicy": "GenerationExecutionPolicy" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L1 | neighbors=[AIManager.ts, GenerationExecutionPolicy.ts, AssemblyManager.ts, AudioManager.ts, AnimationPromptGenerator.ts, SEOManager.ts] | lang=en
- "ai_researchstructuredoutput_parsestrictresearchresponse": "parseStrictResearchResponse()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L97 | neighbors=[AIManager.ts, ResearchStructuredOutput.ts, validateProviderResearch(), smoke-sprint-129-11-research-schema-com…, smoke-sprint-129-15-script-timestamp.ts, smoke-sprint-129-17-scenes-structured-o…] | lang=en
- "ai_scriptaiconfig": "ScriptAIConfig.ts" | kind=code-symbol | source=src/lib/ai/ScriptAIConfig.ts:L1 | neighbors=[AIManager.ts, getScriptMaxTokens(), ScriptAIConfigError, scriptTokenBudget, 65d376b Sprint 129.19: Harden visual st…, ProductionReadinessService.ts] | lang=en
- "ai_usage_route": "route.ts" | kind=code-symbol | source=app/api/projects/[slug]/ai-usage/route.ts:L1 | neighbors=[AIUsageManager.ts, AIUsageManager, GET(), isSafeSlug(), RouteContext, ProjectManager.ts] | lang=en
- "ai_visualsaiconfig": "VisualsAIConfig.ts" | kind=code-symbol | source=src/lib/ai/VisualsAIConfig.ts:L1 | neighbors=[getVisualsMaxTokens(), VisualsAIConfigError, visualsTokenBudget, 5166a51 Sprint 129.20: Harden visuals t…, ProductionReadinessService.ts, smoke-sprint-129-20-visuals-truncation-…] | lang=en
- "animation_animationassetpipeline_animationassetpipeline": "AnimationAssetPipeline" | kind=code-symbol | source=src/lib/animation/AnimationAssetPipeline.ts:L58 | neighbors=[AnimationAssetPipeline.ts, .generateAnimationAssets(), route.ts, PipelineStageExecutor.ts, smoke-animation-motion-plan-contract.ts, smoke-production-animation-provider.ts] | lang=en
- "animation_animationstorage_animationstorage_savemotionplan": ".saveMotionPlan()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L64 | neighbors=[AnimationStorage, .getAnimationDir(), .getMotionPlanPath(), .inspectStoredMotionPlan(), requireStorageSentinel(), resolve()] | lang=en
- "animation_animationstructuredoutput_exactfields": "exactFields()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L194 | neighbors=[AnimationStructuredOutput.ts, category(), expectedField(), issue(), safePathSegment(), validateAnimationProviderPlan()] | lang=en
- "assets_visualassetpipeline_visualassetgenerationerror": "VisualAssetGenerationError" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L23 | neighbors=[VisualAssetPipeline.ts, validateNoExistingGeneratedImages(), validateSceneBatch(), .constructor(), .generateAssets(), smoke-production-real-photo-source.ts] | lang=en
- "audio_audioasseterror_audioassetrooterror": "AudioAssetRootError" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L47 | neighbors=[AudioAssetError.ts, .constructor(), AudioCanonicalAdmissionConflictError, AudioPipeline.ts, OpenAIAudioProvider.ts, smoke-production-readiness-acceptance.ts] | lang=en
- "audio_audiocompensationstore_bindprotectedaudiocompensationpublication": "bindProtectedAudioCompensationPublication()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L491 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, digest(), identityInteger(), readProtectedAudioCompensationReceipt(), requireRecordDirectory()] | lang=en
- "audio_audiocompensationstore_record": "record()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2497 | neighbors=[AudioCompensationStore.ts, finalizeRecordPlacement(), readRetirementPlan(), readWorkspaceMarker(), validatePublication(), validatePublicationReservation()] | lang=en
- "audio_audiocompensationstore_requiretrustedworkspace": "requireTrustedWorkspace()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2192 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, createRecordDirectory(), AudioCompensationStoreError, isSafeAudioCompensationRef(), readWorkspaceMarker()] | lang=en
- "audio_audiocompensationstore_validatereceipt": "validateReceipt()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1991 | neighbors=[AudioCompensationStore.ts, readAudioCompensationReceiptFromDirecto…, readProtectedAudioCompensationReceipt(), digest(), identityInteger(), record()] | lang=en
- "audio_audiocompensationstore_writestate": "writeState()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1515 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, transitionAudioCompensationState(), AudioCompensationStoreError, deferRecordDirectory(), digest()] | lang=en
- "audio_audiopipeline_generateandnormalize": "generateAndNormalize()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L173 | neighbors=[AudioPipeline.ts, .generateAudio(), AudioAssetGenerationError, audioFailure(), compensateUnregisteredResult(), contextualEvidence()] | lang=en
- "audio_audiopublicationintentstore_getcommittedaudiopublicationassets": "getCommittedAudioPublicationAssets()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L170 | neighbors=[AssetManager.ts, AudioPublicationIntentStore.ts, AudioPublicationIntentConflictError, AudioPublicationIntentError, intentDirectory(), matchesCanonical()] | lang=en
- "audio_audiopublicationintentstore_getpreparedaudiopublicationintent": "getPreparedAudioPublicationIntent()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L74 | neighbors=[AudioPublicationIntentStore.ts, getAudioPublicationLifecycleState(), AudioPublicationIntentConflictError, AudioPublicationIntentError, intentDirectory(), readIntentCollection()] | lang=en
- "backup_runtimebackupauthority_bootstraptestruntimebackupstorageauthority": "bootstrapTestRuntimeBackupStorageAuthority()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L37 | neighbors=[RuntimeBackupAuthority.ts, authorityInvalid(), bootstrap(), canonicalBackupRoot(), inside(), smoke-sprint-129-25c-1-runtime-backup.ts] | lang=en
- "backup_runtimebackupinventory_collectruntimebackupinventory": "collectRuntimeBackupInventory()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L49 | neighbors=[RuntimeBackupInventory.ts, collectRuntimeBackupInventoryWithPolicy…, RuntimeMigrationCandidatePreflight.ts, runtime-backup.ts, smoke-sprint-129-25c-1-runtime-backup.ts, smoke-sprint-129-25c-2b-1-migration-can…] | lang=en
- "backup_runtimebackupmanifest_aggregateruntimefilerecords": "aggregateRuntimeFileRecords()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L90 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, validateRuntimeBackupManifest(), RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidatePreflight.ts, ProductionCompletedStageRegenerationPla…] | lang=en
- "backup_runtimebackupmanifest_runtimebackupmanifest": "RuntimeBackupManifest" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L63 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupService.ts, RuntimeBackupVerifier.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateVerifier.ts] | lang=en
- "backup_runtimebackuppathpolicy_validateruntimebackupmutationrelativepath": "validateRuntimeBackupMutationRelativePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L54 | neighbors=[RuntimeBackupPathPolicy.ts, assertRuntimeBackupMaterializedPath(), invalidPath(), utf8Length(), validateV2Segments(), RuntimeBackupService.ts] | lang=en
- "backup_runtimebackupservice_requireexistingabsolutedirectory": "requireExistingAbsoluteDirectory()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L288 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), exactBackupDirectory(), materializeAndVerify(), portableVerifyRuntimeBackup(), protectedRootsFor()] | lang=en
- "backup_runtimebackupservice_runtimebackuperror": "RuntimeBackupError" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L35 | neighbors=[RuntimeBackupService.ts, invalidRequest(), materializeAndVerify(), normalizeCreateError(), restoreAndVerifyRuntimeBackup(), .constructor()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0a03cad82ff3630157b0bff406d5dee151ae9259": "0a03cad refactor(types): cleanup domain type architecture" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 5b68c56 refactor(ai): add shared json a…, page.tsx, sceneStep.ts] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@150d8cb052eb9047500f14dee03087418aece810": "150d8cb docs(production): record sprint 97.2 checkpoint" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@1b10df528e004601883a96f91c8db0bb7690d0b2": "1b10df5 docs(production): record sprint 97.3 checkpoint" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2320bcb2dbe595914a762da6923b12add9318534": "2320bcb Sprint 31 Phase 1 - Add Visual Prompt Engine" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 71ed39b Sprint 31 Phase 2 - Add Animati…, VisualManager.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@24a2c697ce1e6fa3a9daa472ebd8fc2a703fd58e": "24a2c69 fix(production): restore operation-scoped audio readiness" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, b1480fe fix(production): close durable …, ProductionReadinessService.ts, smoke-production-readiness-acceptance.ts] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@354f9acad69c44eddb2b6bd91a2fcdfbc4b1b820": "354f9ac docs(production): record sprint 97.7 checkpoint" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@37dc655a115f32013e918ffde96df19c4e5ae4a4": "37dc655 fix(video): preserve full-frame scene composition" | kind=Commit | source=git | neighbors=[0ff6112 feat(production): add stage-bou…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 8f7a37b fix(production): close sprint 1…, FFmpegSceneVideoProvider.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3a28579ce06222ba755458c2909b63154e0942e7": "3a28579 docs: update sprint 66 documentation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3cf4126ccd84fb05b6b57cc6e2f7bf23680cb331": "3cf4126 docs: complete sprint 68 lint cleanup planning" | kind=Commit | source=git | neighbors=[3518022 feat: complete sprint 67 pipeli…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@40fa9373e19926e902f03ea881775d5caae4c14d": "40fa937 Fix project dashboard data loading" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, e9e3d2e Sprint 16 AI Router integration, ProjectList.tsx, ProjectReader.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@42ff8deb615b39e2f4ae27638d38af3ee373e67f": "42ff8de docs(production): record sprint 99.0 checkpoint" | kind=Commit | source=git | neighbors=[02bf9b6 feat(production): add durable e…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=nl

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-025.json

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
