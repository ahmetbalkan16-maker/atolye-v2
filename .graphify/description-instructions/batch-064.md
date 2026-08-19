# Node Description Batch 65 of 166

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

- "audio_audioasseterror_optionalinteger": "optionalInteger()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L230 | neighbors=[AudioAssetError.ts, isAudioAssetErrorEvidence(), integer()]
- "audio_audiocompensationstore_admissionreservationbytes": "admissionReservationBytes()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2474 | neighbors=[AudioCompensationStore.ts, AudioCompensationBacklogSaturatedError, prepareAudioCompensationWorkspace()]
- "audio_audiocompensationstore_cleanuplogicalroot": "cleanupLogicalRoot()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1653 | neighbors=[AudioCompensationStore.ts, cleanupRoot(), ensureCleanupRoot()]
- "audio_audiocompensationstore_countrecorddirectories": "countRecordDirectories()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1711 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, recordCount()]
- "audio_audiocompensationstore_samepath": "samePath()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1720 | neighbors=[AudioCompensationStore.ts, finalizeRecordPlacement(), requireTrustedWorkspace()]
- "audio_audiocompensationstore_syncdirectoryentry": "syncDirectoryEntry()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1828 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, writeDurableJsonNoClobber()]
- "audio_audiocompensationstore_unlinkexactfile": "unlinkExactFile()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2432 | neighbors=[AudioCompensationStore.ts, removeTemporaryAliasForCurrent(), digest()]
- "audio_audiocompensationstore_validtransition": "validTransition()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2078 | neighbors=[AudioCompensationStore.ts, transitionAudioCompensationState(), validateState()]
- "audio_audiomanager_audiomanager_createfallbackaudiodata": ".createFallbackAudioData()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L77 | neighbors=[AudioManager, .formatDuration(), .generateAudioData()]
- "audio_audiomanager_audiomanager_createfallbacksection": ".createFallbackSection()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L105 | neighbors=[AudioManager, .extractEmphasis(), .formatDuration()]
- "audio_audiomanager_audiomanager_formatduration": ".formatDuration()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L228 | neighbors=[AudioManager, .createFallbackAudioData(), .createFallbackSection()]
- "audio_audiopipeline_buildandvalidatebatch": "buildAndValidateBatch()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L519 | neighbors=[AudioPipeline.ts, .generateAudio(), audioFailure()]
- "audio_audiopipeline_getprovidername": "getProviderName()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L599 | neighbors=[AudioPipeline.ts, .generateAudio(), audioFailure()]
- "audio_audiopublicationintentstore_digest": "digest()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L392 | neighbors=[AudioPublicationIntentStore.ts, prepareAudioPublicationIntent(), validIntent()]
- "audio_audiopublicationintentstore_hasexactkeys": "hasExactKeys()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L387 | neighbors=[AudioPublicationIntentStore.ts, validIntent(), validPublication()]
- "audio_audiopublicationintentstore_matchescanonical": "matchesCanonical()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L325 | neighbors=[AudioPublicationIntentStore.ts, getAudioPublicationLifecycleState(), getCommittedAudioPublicationAssets()]
- "audio_audiopublicationintentstore_validpublication": "validPublication()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L373 | neighbors=[AudioPublicationIntentStore.ts, validIntent(), hasExactKeys()]
- "audio_audioservice_audioservice": "AudioService" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L27 | neighbors=[AudioService.ts, .generateAudio(), AudioPanel.tsx]
- "audio_audioservice_audioservice_generateaudio": ".generateAudio()" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L28 | neighbors=[AudioService, isAssets(), isAudioData()]
- "audio_route_resolvescript": "resolveScript()" | kind=code-symbol | source=app/api/audio/route.ts:L65 | neighbors=[route.ts, POST(), isScriptData()]
- "backup_runtimebackupauthority_defaultbackuproot": "defaultBackupRoot()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L126 | neighbors=[RuntimeBackupAuthority.ts, bootstrapRuntimeBackupStorageAuthority(), canonicalBackupRoot()]
- "backup_runtimebackupauthority_runtimebackupstorageauthority": "RuntimeBackupStorageAuthority" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L16 | neighbors=[RuntimeBackupAuthority.ts, RuntimeBackupService.ts, ProductionCompletedStageRegenerationSer…]
- "backup_runtimebackupauthority_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L150 | neighbors=[RuntimeBackupAuthority.ts, canonicalBackupRoot(), readMarker()]
- "backup_runtimebackupauthority_serializemarker": "serializeMarker()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L115 | neighbors=[RuntimeBackupAuthority.ts, readMarker(), readOrCreateRuntimeAuthorityId()]
- "backup_runtimebackupauthority_validruntimeauthorityid": "validRuntimeAuthorityId()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L122 | neighbors=[RuntimeBackupAuthority.ts, assertTrustedRuntimeBackupStorageAuthor…, readMarker()]
- "backup_runtimebackupinventory_assertruntimebackuptreematchesmanifest": "assertRuntimeBackupTreeMatchesManifest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L58 | neighbors=[RuntimeBackupInventory.ts, collectRuntimeBackupInventoryWithPolicy…, RuntimeBackupVerifier.ts]
- "backup_runtimebackupinventory_relativeposix": "relativePosix()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L360 | neighbors=[RuntimeBackupInventory.ts, collectGitMetadata(), walkRuntimeTree()]
- "backup_runtimebackupinventory_requirecontainedorequal": "requireContainedOrEqual()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L352 | neighbors=[RuntimeBackupInventory.ts, samePath(), walkRuntimeTree()]
- "backup_runtimebackupmanifest_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L293 | neighbors=[RuntimeBackupManifest.ts, compareRecords(), validateRuntimeBackupManifest()]
- "backup_runtimebackupmanifest_manifestpathpolicyversion": "manifestPathPolicyVersion()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L330 | neighbors=[RuntimeBackupManifest.ts, getRuntimeBackupManifestPathPolicyVersi…, validateRuntimeBackupManifest()]
- "backup_runtimebackupmanifest_runtimebackupfileclassification": "RuntimeBackupFileClassification" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L26 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts]
- "backup_runtimebackupmanifest_runtimebackupformatversionv1": "runtimeBackupFormatVersionV1" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L18 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupmanifest_runtimebackupmanifestschemaversionv1": "runtimeBackupManifestSchemaVersionV1" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L17 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupservice_decodecreatedependencies": "decodeCreateDependencies()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L228 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), invalidRequest()]
- "backup_runtimebackupservice_protectedrootsfor": "protectedRootsFor()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L209 | neighbors=[RuntimeBackupService.ts, createVerifiedRuntimeBackup(), requireExistingAbsoluteDirectory()]
- "backup_runtimebackupservice_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L319 | neighbors=[RuntimeBackupService.ts, exactBackupDirectory(), requireExistingAbsoluteDirectory()]
- "backup_runtimebackupverifier_requireregularfile": "requireRegularFile()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L167 | neighbors=[RuntimeBackupVerifier.ts, samePath(), verifyRuntimeBackup()]
- "backup_runtimebackupverifier_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L188 | neighbors=[RuntimeBackupVerifier.ts, requireAbsoluteDirectory(), requireRegularFile()]
- "changelog_sprint_129_41": "Sprint 129.41 Canonical Completed-Stage Regeneration" | kind=entity | source=CHANGELOG.md:L225-L258 | neighbors=[Sprint 129.38 Retry-Budget Settled-Rece…, Sprint 129.42 Completed-Stage Regenerat…, Sprint 129.43 Fatih Documentary Live Au…]
- "components_hero": "Hero.tsx" | kind=code-symbol | source=src/components/Hero.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, Hero(), HeroProps]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-064.json

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
