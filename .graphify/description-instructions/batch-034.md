# Node Description Batch 35 of 166

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

- "youtube_route_post": "POST()" | kind=code-symbol | source=app/api/youtube/route.ts:L19 | neighbors=[smoke-production-publish-reconciliation…, smoke-production-youtube-package-pipeli…, smoke-production-youtube-publish-pipeli…, route.ts, failure(), response()]
- "youtube_youtubepackagevalidation_isyoutubepublishingpackage": "isYouTubePublishingPackage()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L69 | neighbors=[route.ts, PipelineRecoveryPlanner.ts, PipelineStageExecutor.ts, smoke-production-youtube-package-pipeli…, route.ts, YouTubePackageValidation.ts]
- "ai_aiproviderconfig_aiproviderconfig": "AIProviderConfig" | kind=code-symbol | source=src/lib/ai/AIProviderConfig.ts:L3 | neighbors=[AIProviderConfig.ts, runObservedAIRequest.ts, ProductionReadinessService.ts, OpenAIProvider.ts, AIRouter.ts, smoke-sprint-129-13-script-settlement.ts]
- "ai_airesponseerror_getairesponseschemaevidence": "getAIResponseSchemaEvidence()" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L27 | neighbors=[AIResponseError.ts, PipelineErrorEvidence.ts, ProductionExecutionWorker.ts, smoke-sprint-129-11-research-schema-com…, smoke-sprint-129-17-scenes-structured-o…, smoke-sprint-129-19-visuals-structured-…]
- "ai_airesponseerror_serializeairesponseschemaissues": "serializeAIResponseSchemaIssues()" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L54 | neighbors=[AIResponseError.ts, isAIResponseSchemaEvidence(), ProductionExecutionWorker.ts, smoke-sprint-129-11-research-schema-com…, smoke-sprint-129-17-scenes-structured-o…, smoke-sprint-129-19-visuals-structured-…]
- "ai_canonicaltimestamp_iscanonicaltimestamp": "isCanonicalTimestamp()" | kind=code-symbol | source=src/lib/ai/CanonicalTimestamp.ts:L24 | neighbors=[CanonicalTimestamp.ts, createCanonicalApplicationTimestamp(), ResearchStructuredOutput.ts, smoke-sprint-129-15-script-timestamp.ts, smoke-sprint-129-17-scenes-structured-o…, smoke-sprint-129-19-visuals-structured-…]
- "ai_researchstructuredoutput_validateproviderresearch": "validateProviderResearch()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L117 | neighbors=[ResearchStructuredOutput.ts, parseStrictResearchResponse(), isRecord(), observedType(), validateArray(), validateString()]
- "ai_scriptaiconfig_getscriptmaxtokens": "getScriptMaxTokens()" | kind=code-symbol | source=src/lib/ai/ScriptAIConfig.ts:L18 | neighbors=[AIManager.ts, ScriptAIConfig.ts, ScriptAIConfigError, ProductionReadinessService.ts, smoke-sprint-129-13-script-settlement.ts, smoke-sprint-129-20-visuals-truncation-…]
- "ai_scriptstructuredoutput_observedtype": "observedType()" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L143 | neighbors=[ScriptStructuredOutput.ts, validateChapters(), validateKeywords(), validatePositiveInteger(), validateProviderScript(), validateString()]
- "ai_visualsaiconfig_getvisualsmaxtokens": "getVisualsMaxTokens()" | kind=code-symbol | source=src/lib/ai/VisualsAIConfig.ts:L18 | neighbors=[VisualsAIConfig.ts, VisualsAIConfigError, ProductionReadinessService.ts, smoke-sprint-129-20-visuals-truncation-…, smoke-sprint-129-26-audio-truncation-bu…, VisualManager.ts]
- "ai_visualstructuredoutput_observedtype": "observedType()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L208 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), validateSearchKeywords(), validateString(), validateThumbnail(), validateVisualScenes()]
- "ai_visualstructuredoutput_validatethumbnail": "validateThumbnail()" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L163 | neighbors=[VisualStructuredOutput.ts, validateProviderVisualPlan(), exactFields(), isRecord(), observedType(), validateString()]
- "animation_animationmotionplanerror_isanimationmotionplanerrorevidence": "isAnimationMotionPlanErrorEvidence()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L47 | neighbors=[AnimationMotionPlanError.ts, optionalInteger(), optionalSafe(), optionalSchemaIssues(), serializeAnimationMotionPlanEvidence(), PipelineErrorEvidence.ts]
- "animation_animationmotionplanerror_sanitizeanimationproviderdiagnosticmetadata": "sanitizeAnimationProviderDiagnosticMetadata()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanError.ts:L108 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanError.ts, .constructor(), integer(), safe(), sanitizeSchemaIssues()]
- "animation_animationmotionplanvalidation_isvalidanimationduration": "isValidAnimationDuration()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L21 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene(), finiteBetween(), AnimationStorage.ts, OpenAIAnimationProvider.ts]
- "animation_animationservice_animationservice_requestanimations": ".requestAnimations()" | kind=code-symbol | source=src/lib/animation/AnimationService.ts:L175 | neighbors=[AnimationService, .generateFromAnimationData(), .generateFromAnimationScenes(), .generateFromSceneVisualData(), .regenerateSceneAnimation(), isAssets()]
- "animation_animationstructuredoutput_category": "category()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L232 | neighbors=[AnimationStructuredOutput.ts, exactFields(), validateAnimationProviderPlan(), validateEnum(), validateFrame(), validateNumericObject()]
- "animation_animationstructuredoutput_validatenumericobject": "validateNumericObject()" | kind=code-symbol | source=src/lib/animation/AnimationStructuredOutput.ts:L130 | neighbors=[AnimationStructuredOutput.ts, validateFrame(), category(), exactFields(), isRecord(), issue()]
- "animations_route_post": "POST()" | kind=code-symbol | source=app/api/animations/route.ts:L11 | neighbors=[route.ts, filterAnimationScenesBySceneId(), isAnimationScenes(), isSceneData(), isVisualData(), normalizeSceneId()]
- "assembly_assemblyaiconfig": "AssemblyAIConfig.ts" | kind=code-symbol | source=src/lib/assembly/AssemblyAIConfig.ts:L1 | neighbors=[AssemblyAIConfigError, assemblyTokenBudget, getAssemblyMaxTokens(), AssemblyManager.ts, a2830bc fix(production): close sprint 1…, smoke-sprint-129-37-assembly-truncation…]
- "assets_assetmanager_assetmanager_getprojectassets": ".getProjectAssets()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L38 | neighbors=[AssetManager, .addAsset(), .addAssetAtomically(), .createDefaultAssets(), .getAssetsPath(), .updateAsset()]
- "assets_visualassetpipeline_visualassetpipeline_generateassets": ".generateAssets()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L67 | neighbors=[VisualAssetPipeline, normalizeGenerationResult(), persistFailedAsset(), validateNoExistingGeneratedImages(), validateSceneBatch(), VisualAssetGenerationError]
- "assets_visualpromptpreview": "VisualPromptPreview.tsx" | kind=code-symbol | source=src/components/assets/VisualPromptPreview.tsx:L1 | neighbors=[AssetGallery.tsx, VisualPromptPreview(), VisualPromptPreviewProps, visual.ts, VisualData, 8ccddcb feat(visual): improve asset gen…]
- "audio_audioasseterror_audiocanonicaladmissionconflicterror": "AudioCanonicalAdmissionConflictError" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L61 | neighbors=[AudioAssetError.ts, AudioAssetRootError, .constructor(), AudioPipeline.ts, smoke-sprint-129-27-audio-remediation.ts, AudioStorage.ts]
- "audio_audioasseterror_isaudioasseterrorevidence": "isAudioAssetErrorEvidence()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L122 | neighbors=[AudioAssetError.ts, getAudioAssetErrorEvidence(), integer(), optionalInteger(), serializeAudioAssetErrorEvidence(), PipelineErrorEvidence.ts]
- "audio_audiocompensationstore_audiocompensationbacklogsaturatederror": "AudioCompensationBacklogSaturatedError" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L146 | neighbors=[AudioCompensationStore.ts, admissionReservationBytes(), .constructor(), AudioCompensationStoreError, prepareAudioCompensationWorkspace(), AudioStorage.ts]
- "audio_audiocompensationstore_createrecorddirectory": "createRecordDirectory()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1566 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, AudioCompensationStoreError, deferRecordDirectory(), requireDeferredWorkspace(), requireTrustedWorkspace()]
- "audio_audiocompensationstore_executeretirementplan": "executeRetirementPlan()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1239 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, readRetirementPlan(), removeRegistryOwnedAudioCompensationRec…, resumeTerminalRetirements(), retireTerminalWorkspace()]
- "audio_audiocompensationstore_readaudiocompensationreceiptforretention": "readAudioCompensationReceiptForRetention()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1426 | neighbors=[AudioCompensationStore.ts, assertProtectedAudioCanonicalResolution…, pruneCompletedAudioCompensationRecords(), readAudioCompensationReceiptFromDirecto…, requireRecordDirectory(), removeCompletedRecord()]
- "audio_audiocompensationstore_readoptionalpublication": "readOptionalPublication()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1868 | neighbors=[AudioCompensationStore.ts, readAudioCompensationReceiptFromDirecto…, AudioCompensationStoreError, readJsonFile(), validatePublication(), readProtectedAudioCompensationReceipt()]
- "audio_audiocompensationstore_readoptionalpublicationreservation": "readOptionalPublicationReservation()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1884 | neighbors=[AudioCompensationStore.ts, readAudioCompensationReceiptFromDirecto…, AudioCompensationStoreError, readJsonFile(), validatePublicationReservation(), readProtectedAudioCompensationReceipt()]
- "audio_audiocompensationstore_requirereceiptinput": "requireReceiptInput()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2091 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, AudioCompensationStoreError, identityInteger(), requireProjectSlug(), safeInteger()]
- "audio_audiocompensationstore_safeinteger": "safeInteger()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2501 | neighbors=[AudioCompensationStore.ts, mergeCanonicalReadIdentity(), prepareAudioCompensationWorkspace(), readWorkspaceMarker(), requireReceiptInput(), validateReceipt()]
- "audio_audiocompensationstore_transitionaudiocompensationstate": "transitionAudioCompensationState()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L742 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, readProtectedAudioCompensationReceipt(), validTransition(), writeState(), AudioStorage.ts]
- "audio_audiocompensationstore_validatepublication": "validatePublication()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1928 | neighbors=[AudioCompensationStore.ts, readOptionalPublication(), digest(), identityInteger(), record(), validDate()]
- "audio_audiocompensationstore_validatepublicationreservation": "validatePublicationReservation()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1903 | neighbors=[AudioCompensationStore.ts, readOptionalPublicationReservation(), reserveProtectedAudioCompensationPublic…, digest(), identityInteger(), record()]
- "audio_audiodescriptorboundverification_readaudiofiledescriptorbound": "readAudioFileDescriptorBound()" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L48 | neighbors=[AudioDescriptorBoundVerification.ts, AudioDescriptorVerificationError, digestBytes(), reliableIdentity(), readContainedAudioFileDescriptorBound(), AudioPublicationIntentStore.ts]
- "audio_audioidentifierpolicy_containsreservedsafeevidenceterm": "containsReservedSafeEvidenceTerm()" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L25 | neighbors=[AudioAssetError.ts, AudioIdentifierPolicy.ts, isSafeAudioIdentifier(), AudioPublicationIntentStore.ts, ProductionExecutionDurableAttempt.ts, ProductionExecutionWorker.ts]
- "audio_audiopipeline_audiopipeline": "AudioPipeline" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L67 | neighbors=[AudioPipeline.ts, .generateAudio(), route.ts, PipelineStageExecutor.ts, smoke-production-audio-asset-wiring.ts, smoke-sprint-129-27-audio-remediation.ts]
- "audio_audiopublicationintentstore_readintentcollection": "readIntentCollection()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L336 | neighbors=[AudioPublicationIntentStore.ts, getCommittedAudioPublicationAssets(), getPreparedAudioPublicationIntent(), AudioPublicationIntentConflictError, AudioPublicationIntentError, canonicalPathIdentity()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-034.json

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
