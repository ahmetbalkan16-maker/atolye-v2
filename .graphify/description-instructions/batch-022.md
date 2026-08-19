# Node Description Batch 23 of 166

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

- "types_productionsnapshot_productionsnapshot": "ProductionSnapshot" | kind=code-symbol | source=src/types/productionSnapshot.ts:L226 | neighbors=[ProductionDependencyGraph.ts, ProductionHealthEngine.ts, ProductionHealthService.ts, ProductionIntelligenceService.ts, ProductionPlanner.ts, ProductionSnapshotBuilder.ts] | lang=en
- "utils_mapping": "mapping.ts" | kind=code-symbol | source=src/lib/ai/utils/mapping.ts:L1 | neighbors=[5b68c56 refactor(ai): add shared json a…, c18dd35 refactor(ai): extend shared uti…, index.ts, getCreatedAt(), getNumber(), getOptionalString()] | lang=en
- "youtube_youtubepackagevalidation_normalizeyoutubepackagedraft": "normalizeYouTubePackageDraft()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L32 | neighbors=[smoke-production-youtube-package-pipeli…, YouTubePackagePipeline.ts, YouTubePackageValidation.ts, normalizeChapters(), normalizeHashtags(), normalizeTags()] | lang=en
- "youtube_youtubeproviderrouter_youtubeproviderrouter": "YouTubeProviderRouter" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderRouter.ts:L7 | neighbors=[PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, smoke-production-youtube-package-pipeli…, smoke-sprint-129-28-production-acceptan…, YouTubeEngine.ts] | lang=en
- "ai_aiproviderconfig": "AIProviderConfig.ts" | kind=code-symbol | source=src/lib/ai/AIProviderConfig.ts:L1 | neighbors=[AIProviderConfig, getConfiguredProvider(), AIRouter.ts, ProviderName, runObservedAIRequest.ts, 0108d60 feat(ai): add mock-first provid…] | lang=en
- "ai_researchaiconfig": "ResearchAIConfig.ts" | kind=code-symbol | source=src/lib/ai/ResearchAIConfig.ts:L1 | neighbors=[AIManager.ts, getResearchMaxTokens(), ResearchAIConfigError, researchTokenBudget, 65d376b Sprint 129.19: Harden visual st…, ProductionReadinessService.ts] | lang=en
- "ai_visualengine": "visualEngine.ts" | kind=code-symbol | source=src/lib/ai/visualEngine.ts:L1 | neighbors=[createVisualPrompt(), generateVisualPrompts(), SceneDataInput, SceneItem, visual.ts, VisualData] | lang=en
- "ai_visualstructuredoutput_validateprovidervisualplan": "validateProviderVisualPlan()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L115 | neighbors=[VisualStructuredOutput.ts, parseStrictVisualPlanResponse(), exactFields(), isRecord(), observedType(), validateThumbnail()] | lang=en
- "animation_animationmotionplanvalidation_isanimationmotionplanscene": "isAnimationMotionPlanScene()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L46 | neighbors=[animationMerge.ts, AnimationMotionPlanValidation.ts, isLegacyAnimationScene(), isNonEmptyString(), isSafeProviderName(), isValidAnimationDuration()] | lang=en
- "animation_animationstructuredoutput_validateanimationproviderplan": "validateAnimationProviderPlan()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L81 | neighbors=[AnimationStructuredOutput.ts, category(), exactFields(), isRecord(), issue(), validateEnum()] | lang=en
- "animation_animationstructuredoutput_validateframe": "validateFrame()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L104 | neighbors=[AnimationStructuredOutput.ts, validateAnimationProviderPlan(), category(), exactFields(), finite(), isRecord()] | lang=en
- "assets_visualassetpipeline_normalizegenerationresult": "normalizeGenerationResult()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L210 | neighbors=[VisualAssetPipeline.ts, normalizeImageMimeType(), normalizeNonEmptyString(), normalizePositiveInteger(), normalizeSafeImagePath(), normalizeSafeImageUrl()] | lang=en
- "audio_audiocompensationstore_assertprotectedaudiocanonicalresolutionallowed": "assertProtectedAudioCanonicalResolutionAllowed()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L318 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, cleanupRootIfPresent(), isSafeAudioCompensationRef(), mergeCanonicalReadIdentity(), parseRetirementFileName()] | lang=en
- "audio_audiocompensationstore_prunecompletedaudiocompensationrecords": "pruneCompletedAudioCompensationRecords()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L809 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, cleanupRootIfPresent(), readAudioCompensationReceiptForRetentio…, requireProjectSlug(), resumeDetachedCompletedRecords()] | lang=en
- "audio_audiopipeline_audiopipeline_generateaudio": ".generateAudio()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L68 | neighbors=[AudioPipeline, addAssetOrFail(), audioFailure(), buildAndValidateBatch(), buildMixPrompt(), createGeneratedAsset()] | lang=en
- "audio_audiopipeline_normalizegenerationresult": "normalizeGenerationResult()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L247 | neighbors=[AudioPipeline.ts, generateAndNormalize(), AudioAssetGenerationError, contextualEvidence(), isExpectedTarget(), isSafeModelName()] | lang=en
- "audio_audiopublicationintentstore_prepareaudiopublicationintent": "prepareAudioPublicationIntent()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L117 | neighbors=[AudioPublicationIntentStore.ts, AudioPublicationIntentError, canonicalAssetPath(), digest(), intentDirectory(), readIntent()] | lang=en
- "backup_runtimebackuppathpolicy_validateruntimebackuprelativepath": "validateRuntimeBackupRelativePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L26 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, runtimeBackupPortableCollisionKey(), invalidPath(), utf8Length()] | lang=en
- "backup_runtimebackupservice_restoreandverifyruntimebackup": "restoreAndVerifyRuntimeBackup()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L115 | neighbors=[RuntimeBackupService.ts, decodeRestoreRequest(), exactBackupDirectory(), materializeAndVerify(), RuntimeBackupError, validateBackupId()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0024504bb869990180dd21cdaf50c58d8e3c62a8": "0024504 feat(pipeline): add execution timeline foundation (Sprint 81)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@04b6c0faaa4608de460a3c197239179d3b17f062": "04b6c0f feat(studio): add AI usage filters and search" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@05bea2f3bb57c7b03e9c4d3365f5cde36c0d4f49": "05bea2f docs(checkpoint): close sprints 129.42-129.47" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 018d91e feat(visuals): add Wikimedia Co…, reconcile-fatih-129-45-backfill.ts, smoke-assembly-scene-video-consumption.…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@09ab1e968d695110be3de0bde5e5a22ba79d19cd": "09ab1e9 fix(audio): support OpenAI streaming WAV sentinels" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 2fc58f9 chore(checkpoint): preserve Spr…, smoke-production-audio-asset-wiring.ts, smoke-sprint-129-27-audio-remediation.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0c78bc19995ebbb7dd832abe2e660dbd7dc8f67b": "0c78bc1 feat: complete sprint 73 production engine smoke validation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@11fe46b378451b72fdc8f19172d25802edec87a1": "11fe46b feat(pipeline): add execution timeline foundation (Sprint 82)" | kind=Commit | source=git | neighbors=[0024504 feat(pipeline): add execution t…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@19c8f703ed731193aaa30388d7dad0fcbc0fed7e": "19c8f70 feat: complete two-phase production audio publication" | kind=Commit | source=git | neighbors=[AudioDescriptorBoundVerification.ts, AudioPublicationIntentStore.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, b58a350 fix(production): close failed-t…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@1de9af404f656965077734629877ada0b2545340": "1de9af4 feat(pipeline): add observability details to jobs (Sprint 76)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@21df73e7d28f23c9536f9438af6f3f2fe5f03daa": "21df73e feat: complete sprint 62 pipeline diagnostics polish" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@33994624a02991f15dc684b05f809a0ef55319ca": "3399462 feat(pipeline): improve queue reliability and auto refresh (Sprint 75)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@343e0a836b77049b0a4a4e132e4d35e526c94033": "343e0a8 Sprint 32 Phase 6 - Add Asset Read API" | kind=Commit | source=git | neighbors=[route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@35dd1496a799d3a3e6131ae235f771434201517d": "35dd149 feat(pipeline): add execution timeline foundation (Sprint 80)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@422d8f26896bc9f83505aa4ebce58e2d3b2ad6d0": "422d8f2 feat(pipeline): add history viewer foundation (Sprint 79)" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4306f4b20e8f0173888c5a107dc48c1222b6d77a": "4306f4b feat(animation): add animation engine and prompt foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5890d1f8847cfeffe27326452843cc98b7972289": "5890d1f feat(project): add manifest based progress tracking" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5a68409aaa91a039e56b82bd5b6b2e8f9e48d3e0": "5a68409 feat(pipeline): add full documentary generation workflow" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, a6de923 feat(studio): add production da…, HomeClient.tsx, TopicInput.tsx] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@60504be4df13e9c8c8ff2e8cf9413a87e6e2028d": "60504be feat: complete sprint 74 pipeline queue ux hardening" | kind=Commit | source=git | neighbors=[0c78bc1 feat: complete sprint 73 produc…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@714fa03f628c428c1dba7310ae9c7f25cd3e829a": "714fa03 Sprint 32 Phase 5 - Add Asset API Gateway" | kind=Commit | source=git | neighbors=[route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@838244acf1f1c71190a0d1ed807dc3e6beee0f34": "838244a feat(studio): enhance AI diagnostics summary" | kind=Commit | source=git | neighbors=[26fb978 feat(studio): add AI diagnostic…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8c6b061d2c4e7362774992700f38fd182f5f514a": "8c6b061 feat(animation): add animation service layer" | kind=Commit | source=git | neighbors=[4f8ac6b feat(animation): connect animat…, AnimationService.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a2830bc6e687c1c5921b8c662b82aefff5d84b6c": "a2830bc fix(production): close sprint 129.37 assembly truncation budget" | kind=Commit | source=git | neighbors=[AssemblyAIConfig.ts, AssemblyManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 9d3c476 fix(production): close sprint 1…] | lang=pt

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-022.json

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
