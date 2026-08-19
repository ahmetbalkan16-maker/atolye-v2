# Node Description Batch 81 of 166

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

- "security_guardedruntimemutationsession_guardedruntimemutationsession_ensureowneddirectory": ".ensureOwnedDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L507 | neighbors=[GuardedRuntimeMutationSession, .publicBoundary(), .prepareOwnedDestination()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_releaseowneddirectory": ".releaseOwnedDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L632 | neighbors=[GuardedRuntimeMutationSession, .assertOwned(), identityMatches()]
- "security_guardedruntimemutationsession_preflightatomiccreatematerialization": "preflightAtomicCreateMaterialization()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1214 | neighbors=[GuardedRuntimeMutationSession.ts, .createVerifiedRuntimeBackup(), assertAtomicAbsoluteMaterializedPath()]
- "security_guardedruntimemutationsession_resolvecontained": "resolveContained()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1480 | neighbors=[GuardedRuntimeMutationSession.ts, .prepareOwnedDestination(), invalidPath()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_abort": ".abort()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L975 | neighbors=[RuntimeBackupCreateGuardedOperationImpl, .close(), requireGuardedCleanup()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_commit": ".commit()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L962 | neighbors=[RuntimeBackupCreateGuardedOperationImpl, invalidPath(), requireGuardedCleanup()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_verifypublished": ".verifyPublished()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L952 | neighbors=[.createVerifiedRuntimeBackup(), RuntimeBackupCreateGuardedOperationImpl, invalidPath()]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl_abort": ".abort()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1053 | neighbors=[RuntimeBackupRestoreGuardedOperationImpl, .close(), requireGuardedCleanup()]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl_verifymaterialization": ".verifyMaterialization()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1025 | neighbors=[.restoreVerifiedRuntimeBackup(), RuntimeBackupRestoreGuardedOperationImpl, invalidPath()]
- "security_guardedruntimemutationsession_validateatomicmaterializedmanifestpath": "validateAtomicMaterializedManifestPath()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1278 | neighbors=[GuardedRuntimeMutationSession.ts, .restoreVerifiedRuntimeBackup(), preflightAtomicRestoreMaterialization()]
- "security_portablenoclobberfilepublisher_matchesidentity": "matchesIdentity()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L444 | neighbors=[PortableNoClobberFilePublisher.ts, copyFileExclusiveDurable(), copyFileExclusiveReservation()]
- "security_portablenoclobberfilepublisher_portablepublishedfile": "PortablePublishedFile" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L7 | neighbors=[AudioPublicationIntentStore.ts, PortableNoClobberFilePublisher.ts, AudioStorage.ts]
- "security_runtimemutationerror_runtimemutationcleanupstatus": "RuntimeMutationCleanupStatus" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L10 | neighbors=[GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts, RuntimeMutationError.ts]
- "security_runtimepathpolicy_runtimeportablepathpolicyversion": "runtimePortablePathPolicyVersion" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L4 | neighbors=[RuntimeMigrationCandidateManifest.ts, smoke-sprint-129-25c-2a-guarded-filesys…, RuntimePathPolicy.ts]
- "security_runtimeprotectedroots_invalidpath": "invalidPath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L161 | neighbors=[RuntimeProtectedRoots.ts, canonicalRoot(), .assertComplete()]
- "security_runtimeprotectedroots_runtimeprotectedroots_assertcomplete": ".assertComplete()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L51 | neighbors=[RuntimeProtectedRoots, invalidPath(), .constructor()]
- "seo_seomanager_isstrictseoresponse": "isStrictSEOResponse()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L138 | neighbors=[SEOManager.ts, validTimestamp(), .generateSEOData()]
- "seo_seomanager_seomanager_uniquestrings": ".uniqueStrings()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L131 | neighbors=[SEOManager, .createFallbackSEOData(), .getStringArray()]
- "slug_route_get": "GET()" | kind=code-symbol | source=app/api/production/health/[slug]/route.ts:L16 | neighbors=[smoke-production-health-service.ts, smoke-production-intelligence-review.ts, route.ts]
- "sources_wikimediacommonsclient_wikimediacommonsclient_search": ".search()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L90 | neighbors=[WikimediaCommonsClient, parseSearchResponse(), .withRetry()]
- "sources_wikimediacommonsclient_wikimediacommonsclient_withretry": ".withRetry()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L144 | neighbors=[WikimediaCommonsClient, .downloadImage(), .search()]
- "steps_scenestep_scenestep": "sceneStep()" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L55 | neighbors=[sceneStep.ts, estimateDuration(), includesAny()]
- "storage_audiostorage_audiostorage_inspectpreparedwav": ".inspectPreparedWav()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L247 | neighbors=[AudioStorage, .inspectWav(), getTrustedReceipt()]
- "storage_audiostorage_audiostorage_transferpublicationownership": ".transferPublicationOwnership()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L612 | neighbors=[AudioStorage, attachPublicationOwnership(), getTrustedReceipt()]
- "storage_audiostorage_compensatetrustedpublication": "compensateTrustedPublication()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1166 | neighbors=[AudioStorage.ts, .saveAudio(), compensateProtectedPublication()]
- "storage_audiostorage_failcompensation": "failCompensation()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1516 | neighbors=[AudioStorage.ts, compensateProtectedPublication(), recoveryResult()]
- "storage_audiostorage_invalidwav": "invalidWav()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1574 | neighbors=[AudioStorage.ts, .inspectWav(), AudioWavValidationError]
- "storage_audiostorage_recoverpreparedpublicationifpresent": "recoverPreparedPublicationIfPresent()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1070 | neighbors=[AudioStorage.ts, .recoverPublishedAudio(), resolvePath()]
- "storage_audiostorage_requiresafepathsegment": "requireSafePathSegment()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1617 | neighbors=[AudioStorage.ts, .getAudioDir(), .getAudioUrl()]
- "storage_audiostorage_sanitizefilename": "sanitizeFileName()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1625 | neighbors=[AudioStorage.ts, .prepareAudio(), .saveAudio()]
- "storage_audiostorage_sha256": "sha256()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1578 | neighbors=[AudioStorage.ts, .prepareAudio(), .saveAudio()]
- "storage_audiostorage_writeandsyncownedtemporaryfile": "writeAndSyncOwnedTemporaryFile()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1107 | neighbors=[AudioStorage.ts, .prepareAudio(), .saveAudio()]
- "storage_imagestorage_resolvepath": "resolvePath()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L192 | neighbors=[ImageStorage.ts, .inspectStoredImage(), .saveImage()]
- "storage_imagestorage_sanitizepathsegment": "sanitizePathSegment()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L207 | neighbors=[ImageStorage.ts, .getImagesDir(), .getImageUrl()]
- "storage_videostorage_inside": "inside()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L307 | neighbors=[VideoStorage.ts, .finalize(), .removeIfExists()]
- "storage_videostorage_readmovieduration": "readMovieDuration()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L239 | neighbors=[VideoStorage.ts, seconds(), .inspectMp4()]
- "storage_videostorage_resolverelative": "resolveRelative()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L278 | neighbors=[VideoStorage.ts, .createPaths(), .inspectStoredMp4()]
- "storage_videostorage_safemp4filename": "safeMp4FileName()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L295 | neighbors=[VideoStorage.ts, .getVideoPath(), .getVideoUrl()]
- "storage_videostorage_safesegment": "safeSegment()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L288 | neighbors=[VideoStorage.ts, .getVideoDir(), .getVideoUrl()]
- "storage_videostorage_videostorage_inspectmp4": ".inspectMp4()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L116 | neighbors=[VideoStorage, readMovieDuration(), .inspectStoredMp4()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-080.json

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
