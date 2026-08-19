# Node Description Batch 87 of 166

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

- "audio_audiodescriptorboundverification_digestbytes": "digestBytes()" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L125 | neighbors=[AudioDescriptorBoundVerification.ts, readAudioFileDescriptorBound()]
- "audio_audiodescriptorboundverification_reliableidentity": "reliableIdentity()" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L120 | neighbors=[AudioDescriptorBoundVerification.ts, readAudioFileDescriptorBound()]
- "audio_audiomanager_audiomanager_extractemphasis": ".extractEmphasis()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L238 | neighbors=[AudioManager, .createFallbackSection()]
- "audio_audiomanager_audiomanager_mapmusic": ".mapMusic()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L180 | neighbors=[AudioManager, .generateAudioData()]
- "audio_audiomanager_audiomanager_mapnarrator": ".mapNarrator()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L119 | neighbors=[AudioManager, .generateAudioData()]
- "audio_audiomanager_audiomanager_mapproduction": ".mapProduction()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L197 | neighbors=[AudioManager, .generateAudioData()]
- "audio_audiomanager_audiomanager_mapsections": ".mapSections()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L138 | neighbors=[AudioManager, .generateAudioData()]
- "audio_audiomanager_nonemptystring": "nonEmptyString()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L265 | neighbors=[AudioManager.ts, isStrictAudioResponse()]
- "audio_audiomanager_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/audio/AudioManager.ts:L266 | neighbors=[AudioManager.ts, isStrictAudioResponse()]
- "audio_audiopipeline_buildmixprompt": "buildMixPrompt()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L739 | neighbors=[AudioPipeline.ts, .generateAudio()]
- "audio_audiopipeline_compensateunregisteredresult": "compensateUnregisteredResult()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L613 | neighbors=[AudioPipeline.ts, generateAndNormalize()]
- "audio_audiopipeline_creategeneratedasset": "createGeneratedAsset()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L357 | neighbors=[AudioPipeline.ts, .generateAudio()]
- "audio_audiopipeline_getprovidernamesafely": "getProviderNameSafely()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L653 | neighbors=[AudioPipeline.ts, validateProviderInputs()]
- "audio_audiopipeline_isexpectedtarget": "isExpectedTarget()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L661 | neighbors=[AudioPipeline.ts, normalizeGenerationResult()]
- "audio_audiopipeline_issafemodelname": "isSafeModelName()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L686 | neighbors=[AudioPipeline.ts, normalizeGenerationResult()]
- "audio_audiopipeline_isvalidcreatedat": "isValidCreatedAt()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L678 | neighbors=[AudioPipeline.ts, normalizeGenerationResult()]
- "audio_audiopipeline_normalizesafeaudiopath": "normalizeSafeAudioPath()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L690 | neighbors=[AudioPipeline.ts, normalizeGenerationResult()]
- "audio_audiopipeline_normalizesafeaudiourl": "normalizeSafeAudioUrl()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L724 | neighbors=[AudioPipeline.ts, normalizeGenerationResult()]
- "audio_audiopipeline_persistfailedassetsafely": "persistFailedAssetSafely()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L389 | neighbors=[AudioPipeline.ts, generateAndNormalize()]
- "audio_audiopublicationintentstore_canonicalpathidentity": "canonicalPathIdentity()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L368 | neighbors=[AudioPublicationIntentStore.ts, readIntentCollection()]
- "audio_audioservice_isassets": "isAssets()" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L69 | neighbors=[AudioService.ts, .generateAudio()]
- "audio_audioservice_isaudiodata": "isAudioData()" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L60 | neighbors=[AudioService.ts, .generateAudio()]
- "audio_route_isscriptdata": "isScriptData()" | kind=code-symbol | source=app/api/audio/route.ts:L80 | neighbors=[route.ts, resolveScript()]
- "audio_route_post": "POST()" | kind=code-symbol | source=app/api/audio/route.ts:L8 | neighbors=[route.ts, resolveScript()]
- "backup_runtimebackupauthority_inside": "inside()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L156 | neighbors=[RuntimeBackupAuthority.ts, bootstrapTestRuntimeBackupStorageAuthor…]
- "backup_runtimebackupinventory_assertuniqueportablepaths": "assertUniquePortablePaths()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L333 | neighbors=[RuntimeBackupInventory.ts, collectRuntimeBackupInventoryWithPolicy…]
- "backup_runtimebackupinventory_classifyruntimefile": "classifyRuntimeFile()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L318 | neighbors=[RuntimeBackupInventory.ts, walkRuntimeTree()]
- "backup_runtimebackupinventory_comparerecords": "compareRecords()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L377 | neighbors=[RuntimeBackupInventory.ts, compareText()]
- "backup_runtimebackupinventory_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L381 | neighbors=[RuntimeBackupInventory.ts, compareRecords()]
- "backup_runtimebackupinventory_inferprojectslug": "inferProjectSlug()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L313 | neighbors=[RuntimeBackupInventory.ts, walkRuntimeTree()]
- "backup_runtimebackupinventory_projectscanroot": "projectScanRoot()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L299 | neighbors=[RuntimeBackupInventory.ts, collectRuntimeBackupInventoryWithPolicy…]
- "backup_runtimebackupinventory_runtimebackupinventoryoptions": "RuntimeBackupInventoryOptions" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L38 | neighbors=[RuntimeBackupInventory.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupinventory_sameidentity": "sameIdentity()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L368 | neighbors=[RuntimeBackupInventory.ts, hashStableRuntimeFile()]
- "backup_runtimebackupmanifest_comparerecords": "compareRecords()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L286 | neighbors=[RuntimeBackupManifest.ts, compareText()]
- "backup_runtimebackupmanifest_containsabsolutehostpath": "containsAbsoluteHostPath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L357 | neighbors=[RuntimeBackupManifest.ts, validateRuntimeBackupManifest()]
- "backup_runtimebackupmanifest_runtimebackupauthorityschemaversion": "runtimeBackupAuthoritySchemaVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L24 | neighbors=[RuntimeBackupManifest.ts, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackupmanifest_runtimebackupclassifications": "runtimeBackupClassifications" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L269 | neighbors=[RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts]
- "backup_runtimebackupmanifest_runtimebackupgitmetadata": "RuntimeBackupGitMetadata" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L37 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts]
- "backup_runtimebackupmanifest_runtimebackupinventorytotals": "RuntimeBackupInventoryTotals" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L54 | neighbors=[RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts]
- "backup_runtimebackupmanifest_validrelativepath": "validRelativePath()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L297 | neighbors=[RuntimeBackupManifest.ts, validateFileRecord()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-086.json

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
