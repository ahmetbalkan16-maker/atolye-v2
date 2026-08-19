# Node Description Batch 41 of 166

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

- "ai_audioaiconfig_getaudiomaxtokens": "getAudioMaxTokens()" | kind=code-symbol | source=src/lib/ai/AudioAIConfig.ts:L18 | neighbors=[AudioAIConfig.ts, AudioAIConfigError, AudioManager.ts, ProductionReadinessService.ts, smoke-sprint-129-26-audio-truncation-bu…]
- "ai_scenestructuredoutput_observedtype": "observedType()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L202 | neighbors=[SceneStructuredOutput.ts, validateId(), validateProviderScenes(), validateScenes(), validateString()]
- "ai_scenestructuredoutput_parsestrictscenesresponse": "parseStrictScenesResponse()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L81 | neighbors=[AIManager.ts, SceneStructuredOutput.ts, validateProviderScenes(), smoke-sprint-129-17-scenes-structured-o…, smoke-sprint-129-19-visuals-structured-…]
- "ai_scriptaiconfig_scriptaiconfigerror": "ScriptAIConfigError" | kind=code-symbol | source=src/lib/ai/ScriptAIConfig.ts:L8 | neighbors=[AIManager.ts, ScriptAIConfig.ts, getScriptMaxTokens(), .constructor(), smoke-sprint-129-13-script-settlement.ts]
- "ai_visualsaiconfig_visualsaiconfigerror": "VisualsAIConfigError" | kind=code-symbol | source=src/lib/ai/VisualsAIConfig.ts:L8 | neighbors=[VisualsAIConfig.ts, getVisualsMaxTokens(), .constructor(), smoke-sprint-129-20-visuals-truncation-…, VisualManager.ts]
- "animation_animationmotionplanvalidation_isvalidanimationmotionframe": "isValidAnimationMotionFrame()" | kind=code-symbol | source=src/lib/animation/AnimationMotionPlanValidation.ts:L25 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanValidation.ts, isAnimationMotionPlanScene(), finiteBetween(), AnimationStorage.ts]
- "animation_animationstorage_animationstorage_getmotionplanpath": ".getMotionPlanPath()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L60 | neighbors=[AnimationStorage, .getAnimationDir(), safeSegment(), .motionPlanTargetExists(), .saveMotionPlan()]
- "animation_animationstorage_animationstorage_motionplantargetexists": ".motionPlanTargetExists()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L144 | neighbors=[AnimationStorage, .getAnimationDir(), .getMotionPlanPath(), requireStorageSentinel(), resolve()]
- "animation_animationstorage_requirestoragesentinel": "requireStorageSentinel()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L184 | neighbors=[AnimationStorage.ts, .inspectStoredMotionPlan(), .motionPlanTargetExists(), .removeMotionPlanIfExists(), .saveMotionPlan()]
- "animation_animationstorage_resolve": "resolve()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L292 | neighbors=[AnimationStorage.ts, .inspectStoredMotionPlan(), .motionPlanTargetExists(), .removeMotionPlanIfExists(), .saveMotionPlan()]
- "animation_animationstorage_validateartifact": "validateArtifact()" | kind=code-symbol | source=src/lib/animation/AnimationStorage.ts:L214 | neighbors=[AnimationStorage.ts, .inspectStoredMotionPlan(), .saveMotionPlan(), exactFrame(), safeValue()]
- "assembly_assemblyaiconfig_assemblyaiconfigerror": "AssemblyAIConfigError" | kind=code-symbol | source=src/lib/assembly/AssemblyAIConfig.ts:L8 | neighbors=[AssemblyAIConfig.ts, .constructor(), getAssemblyMaxTokens(), AssemblyManager.ts, smoke-sprint-129-37-assembly-truncation…]
- "assembly_assemblymanager_assemblymanager_generateassemblyplan": ".generateAssemblyPlan()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L32 | neighbors=[AssemblyManager, .createFallbackAssemblyPlan(), .mapRender(), .mapScenes(), isStrictAssemblyResponse()]
- "assembly_videoassemblymanager_validateidentitysets": "validateIdentitySets()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L300 | neighbors=[VideoAssemblyManager.ts, requireIds(), sameIds(), VideoAssemblyError, .renderExistingAssets()]
- "audio_audiocompensationstore_deferrecorddirectory": "deferRecordDirectory()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2111 | neighbors=[AudioCompensationStore.ts, createProtectedAudioCompensationReceipt…, createRecordDirectory(), finalizeRecordPlacement(), writeState()]
- "audio_audiocompensationstore_ensurecleanuproot": "ensureCleanupRoot()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1657 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, cleanupLogicalRoot(), requireProjectSlug(), prepareAudioCompensationWorkspace()]
- "audio_audiocompensationstore_mergecanonicalreadidentity": "mergeCanonicalReadIdentity()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L384 | neighbors=[AudioCompensationStore.ts, assertProtectedAudioCanonicalResolution…, AudioCompensationStoreError, identityInteger(), safeInteger()]
- "audio_audiocompensationstore_receiptroot": "receiptRoot()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1633 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, receiptLogicalRoot(), requireProjectSlug(), receiptRootIfPresent()]
- "audio_audiocompensationstore_removecompletedrecord": "removeCompletedRecord()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L985 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, readAudioCompensationReceiptForRetentio…, retireTerminalWorkspace(), removeRegistryOwnedAudioCompensationRec…]
- "audio_audiocompensationstore_removeprotectedaudiotemporaryalias": "removeProtectedAudioTemporaryAlias()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L637 | neighbors=[AudioCompensationStore.ts, readProtectedAudioCompensationReceipt(), removeTemporaryAliasForCurrent(), requireDeferredWorkspace(), AudioStorage.ts]
- "audio_audiocompensationstore_validatestate": "validateState()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2025 | neighbors=[AudioCompensationStore.ts, digest(), record(), validDate(), validTransition()]
- "audio_audiocompensationstore_validdate": "validDate()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2518 | neighbors=[AudioCompensationStore.ts, readWorkspaceMarker(), validatePublication(), validateReceipt(), validateState()]
- "audio_audiodescriptorboundverification_audiodescriptorverificationerror": "AudioDescriptorVerificationError" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L16 | neighbors=[AudioDescriptorBoundVerification.ts, .constructor(), readAudioFileDescriptorBound(), readContainedAudioFileDescriptorBound(), AudioStorage.ts]
- "audio_audiodescriptorboundverification_readcontainedaudiofiledescriptorbound": "readContainedAudioFileDescriptorBound()" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L24 | neighbors=[AudioDescriptorBoundVerification.ts, AudioDescriptorVerificationError, readAudioFileDescriptorBound(), AudioPublicationIntentStore.ts, AudioStorage.ts]
- "audio_audioidentifierpolicy_requiresafeaudioidentifier": "requireSafeAudioIdentifier()" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L39 | neighbors=[AudioAssetError.ts, AudioIdentifierPolicy.ts, AudioIdentifierPolicyError, isSafeAudioIdentifier(), AudioProviderConfig.ts]
- "audio_audiopipeline_addassetorfail": "addAssetOrFail()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L418 | neighbors=[AudioPipeline.ts, AudioAssetGenerationError, audioFailure(), contextualEvidence(), .generateAudio()]
- "audio_audiopipeline_contextualevidence": "contextualEvidence()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L617 | neighbors=[AudioPipeline.ts, addAssetOrFail(), generateAndNormalize(), normalizeGenerationResult(), validateProviderInputs()]
- "audio_audiopipeline_validateproviderinputs": "validateProviderInputs()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L579 | neighbors=[AudioPipeline.ts, .generateAudio(), AudioAssetGenerationError, contextualEvidence(), getProviderNameSafely()]
- "audio_audiopublicationintentstore_canonicalassetpath": "canonicalAssetPath()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L216 | neighbors=[AudioPublicationIntentStore.ts, AudioPublicationIntentError, prepareAudioPublicationIntent(), validateAsset(), validateIntentAsset()]
- "audio_audiopublicationintentstore_intentdirectory": "intentDirectory()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L203 | neighbors=[AudioPublicationIntentStore.ts, getCommittedAudioPublicationAssets(), getPreparedAudioPublicationIntent(), AudioPublicationIntentError, prepareAudioPublicationIntent()]
- "audio_audiopublicationintentstore_readintent": "readIntent()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L280 | neighbors=[AudioPublicationIntentStore.ts, prepareAudioPublicationIntent(), AudioPublicationIntentError, validIntent(), writeIntentNoClobber()]
- "audio_audiopublicationintentstore_validateasset": "validateAsset()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L228 | neighbors=[AudioPublicationIntentStore.ts, prepareAudioPublicationIntent(), AudioPublicationIntentError, canonicalAssetPath(), validateIntentAsset()]
- "audio_audiopublicationintentstore_writeintentnoclobber": "writeIntentNoClobber()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L255 | neighbors=[AudioPublicationIntentStore.ts, prepareAudioPublicationIntent(), AudioPublicationIntentConflictError, AudioPublicationIntentError, readIntent()]
- "backup_runtimebackupauthority_authorityinvalid": "authorityInvalid()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L162 | neighbors=[RuntimeBackupAuthority.ts, bootstrapTestRuntimeBackupStorageAuthor…, canonicalBackupRoot(), readMarker(), readOrCreateRuntimeAuthorityId()]
- "backup_runtimebackupauthority_readorcreateruntimeauthorityid": "readOrCreateRuntimeAuthorityId()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L77 | neighbors=[RuntimeBackupAuthority.ts, bootstrap(), authorityInvalid(), readMarker(), serializeMarker()]
- "backup_runtimebackupmanifest_getruntimebackupmanifestpathpolicyversion": "getRuntimeBackupManifestPathPolicyVersion()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L324 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, manifestPathPolicyVersion(), RuntimeBackupVerifier.ts, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackupmanifest_runtimebackupformatversionv2": "runtimeBackupFormatVersionV2" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L20 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupmanifest_runtimebackupmanifestschemaversionv2": "runtimeBackupManifestSchemaVersionV2" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L19 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupmanifest_validatetotals": "validateTotals()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L238 | neighbors=[RuntimeBackupManifest.ts, validateRuntimeBackupManifest(), assertExactKeys(), emptyClassificationTotals(), isRecord()]
- "backup_runtimebackuppathpolicy_invalidpath": "invalidPath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L116 | neighbors=[RuntimeBackupPathPolicy.ts, assertRuntimeBackupMaterializedPath(), validateRuntimeBackupMutationRelativePa…, validateRuntimeBackupRelativePath(), validateV2Segments()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-040.json

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
