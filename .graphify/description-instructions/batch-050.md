# Node Description Batch 51 of 166

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

- "assembly_assemblyaiconfig_getassemblymaxtokens": "getAssemblyMaxTokens()" | kind=code-symbol | source=src/lib/assembly/AssemblyAIConfig.ts:L18 | neighbors=[AssemblyAIConfig.ts, AssemblyAIConfigError, AssemblyManager.ts, smoke-sprint-129-37-assembly-truncation…]
- "assembly_assemblymanager_assemblymanager_createfallbackscene": ".createFallbackScene()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L154 | neighbors=[AssemblyManager, .formatDuration(), .inferCameraMovement(), .inferEffects()]
- "assembly_assemblymanager_isstrictassemblyresponse": "isStrictAssemblyResponse()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L337 | neighbors=[AssemblyManager.ts, .generateAssemblyPlan(), nonEmptyString(), validTimestamp()]
- "assembly_videoassemblymanager_buildaudiosegments": "buildAudioSegments()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L333 | neighbors=[VideoAssemblyManager.ts, requireAudioAsset(), VideoAssemblyError, .renderExistingAssets()]
- "assembly_videoassemblymanager_requireaudioasset": "requireAudioAsset()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L661 | neighbors=[VideoAssemblyManager.ts, buildAudioSegments(), VideoAssemblyError, requireMixAsset()]
- "assets_assetmanager_assetmanager_getassetspath": ".getAssetsPath()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L19 | neighbors=[AssetManager, .getProjectAssets(), .saveProjectAssets(), .saveProjectAssetsAtomically()]
- "assets_assetmanager_assetmanager_saveprojectassets": ".saveProjectAssets()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L57 | neighbors=[AssetManager, .addAsset(), .getAssetsPath(), .updateAsset()]
- "audio_audioasseterror_integer": "integer()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L220 | neighbors=[AudioAssetError.ts, createAudioAssetErrorEvidence(), isAudioAssetErrorEvidence(), optionalInteger()]
- "audio_audioasseterror_serializeaudioasseterrorevidence": "serializeAudioAssetErrorEvidence()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L169 | neighbors=[AudioAssetError.ts, isAudioAssetErrorEvidence(), ProductionExecutionWorker.ts, smoke-sprint-129-27-audio-remediation.ts]
- "audio_audiocompensationstore_buildretirementplan": "buildRetirementPlan()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1105 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, digest(), retireTerminalWorkspace()]
- "audio_audiocompensationstore_getdeferredaudiocompensationbacklogstatus": "getDeferredAudioCompensationBacklogStatus()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L889 | neighbors=[AudioCompensationStore.ts, inspectDeferredBacklog(), requireProjectSlug(), smoke-sprint-129-27-audio-remediation.ts]
- "audio_audiocompensationstore_getprotectedaudiocompensationpublicationsourcepath": "getProtectedAudioCompensationPublicationSourcePath()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L297 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, requireDeferredWorkspace(), AudioStorage.ts]
- "audio_audiocompensationstore_receiptrootifpresent": "receiptRootIfPresent()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1689 | neighbors=[AudioCompensationStore.ts, receiptRoot(), recordCount(), requireRecordDirectory()]
- "audio_audiocompensationstore_recordcount": "recordCount()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L926 | neighbors=[AudioCompensationStore.ts, activeRecordCount(), countRecordDirectories(), receiptRootIfPresent()]
- "audio_audiocompensationstore_removetemporaryaliasforcurrent": "removeTemporaryAliasForCurrent()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1054 | neighbors=[AudioCompensationStore.ts, removeProtectedAudioTemporaryAlias(), unlinkExactFile(), retireTerminalWorkspace()]
- "audio_audiocompensationstore_requireexactpublicationauthority": "requireExactPublicationAuthority()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1956 | neighbors=[AudioCompensationStore.ts, readAudioCompensationReceiptFromDirecto…, readProtectedAudioCompensationReceipt(), AudioCompensationStoreError]
- "audio_audiocompensationstore_retirementfilename": "retirementFileName()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1335 | neighbors=[AudioCompensationStore.ts, isLogicallyRetired(), removeRegistryOwnedAudioCompensationRec…, retireTerminalWorkspace()]
- "audio_audioidentifierpolicy_audioidentifierpolicyerror": "AudioIdentifierPolicyError" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L17 | neighbors=[AudioIdentifierPolicy.ts, .constructor(), requireSafeAudioIdentifier(), AudioProviderConfig.ts]
- "audio_audiomanager_isstrictaudioresponse": "isStrictAudioResponse()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L247 | neighbors=[AudioManager.ts, .generateAudioData(), nonEmptyString(), validTimestamp()]
- "audio_audiopublicationintentstore_getaudiopublicationlifecyclestate": "getAudioPublicationLifecycleState()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L102 | neighbors=[AudioPublicationIntentStore.ts, getPreparedAudioPublicationIntent(), matchesCanonical(), smoke-sprint-129-27-audio-remediation.ts]
- "audio_audiopublicationintentstore_validateintentasset": "validateIntentAsset()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L320 | neighbors=[AudioPublicationIntentStore.ts, canonicalAssetPath(), validateAsset(), validIntent()]
- "backup_runtimebackupauthority_bootstrap": "bootstrap()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L65 | neighbors=[RuntimeBackupAuthority.ts, readOrCreateRuntimeAuthorityId(), bootstrapRuntimeBackupStorageAuthority(), bootstrapTestRuntimeBackupStorageAuthor…]
- "backup_runtimebackupinventory_collectgitmetadata": "collectGitMetadata()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L261 | neighbors=[RuntimeBackupInventory.ts, relativePosix(), samePath(), collectRuntimeBackupInventoryWithPolicy…]
- "backup_runtimebackupinventory_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L385 | neighbors=[RuntimeBackupInventory.ts, collectGitMetadata(), hashStableRuntimeFile(), requireContainedOrEqual()]
- "backup_runtimebackupmanifest_emptyclassificationtotals": "emptyClassificationTotals()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L281 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, validateTotals(), smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupmanifest_runtimebackupaggregateversion": "runtimeBackupAggregateVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L23 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateVerifier.ts]
- "backup_runtimebackupmanifest_runtimebackupfilerecord": "RuntimeBackupFileRecord" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L43 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidatePreflight.ts]
- "backup_runtimebackupmanifest_runtimebackupformatversion": "runtimeBackupFormatVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L22 | neighbors=[RuntimeBackupManifest.ts, RuntimeBackupService.ts, ProductionCompletedStageRegenerationSer…, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackupmanifest_runtimebackupmanifestschemaversion": "runtimeBackupManifestSchemaVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L21 | neighbors=[RuntimeBackupManifest.ts, RuntimeBackupService.ts, ProductionCompletedStageRegenerationSer…, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackupmanifest_validategitmetadata": "validateGitMetadata()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L219 | neighbors=[RuntimeBackupManifest.ts, validateFileRecord(), assertExactKeys(), isRecord()]
- "backup_runtimebackupmanifest_validatesourceruntimeauthority": "validateSourceRuntimeAuthority()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L309 | neighbors=[RuntimeBackupManifest.ts, validateRuntimeBackupManifest(), assertExactKeys(), isRecord()]
- "backup_runtimebackuppathpolicy_runtimebackuppathlimits": "runtimeBackupPathLimits" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L16 | neighbors=[RuntimeBackupPathPolicy.ts, RuntimeBackupVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackuppathpolicy_utf8length": "utf8Length()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L112 | neighbors=[RuntimeBackupPathPolicy.ts, validateRuntimeBackupMutationRelativePa…, validateRuntimeBackupRelativePath(), validateV2Segments()]
- "backup_runtimebackupservice_decodecreaterequest": "decodeCreateRequest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L218 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), invalidRequest(), requireTrustedAuthority()]
- "backup_runtimebackupservice_decodeportablerequest": "decodePortableRequest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L249 | neighbors=[RuntimeBackupService.ts, invalidRequest(), requireTrustedAuthority(), portableVerifyRuntimeBackup()]
- "backup_runtimebackupservice_decoderestorerequest": "decodeRestoreRequest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L234 | neighbors=[RuntimeBackupService.ts, invalidRequest(), requireTrustedAuthority(), restoreAndVerifyRuntimeBackup()]
- "backup_runtimebackupservice_normalizecreateerror": "normalizeCreateError()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L302 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), invalidRequest(), RuntimeBackupError]
- "backup_runtimebackupservice_validatebackupid": "validateBackupId()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L277 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), restoreAndVerifyRuntimeBackup(), invalidRequest()]
- "backup_runtimebackupverifier_requireabsolutedirectory": "requireAbsoluteDirectory()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L119 | neighbors=[RuntimeBackupVerifier.ts, samePath(), verifyRuntimeBackup(), verifyRuntimeTreeAgainstManifest()]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@56b2221cb8baa8ab429b47b9b605dc7c2900d0d3": "56b2221 docs(agents): add multi-computer session pull/commit discipline" | kind=Commit | source=git | neighbors=[2d9074c fix(visuals): real photo source…, agents/api-graphify-mcp-integration, main, 52fca36 chore: add project tooling conf…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-050.json

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
