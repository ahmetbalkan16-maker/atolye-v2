# Node Description Batch 61 of 166

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

- "security_runtimeprotectedroots_runtimecandidateprotectedrootsfromcontext": "runtimeCandidateProtectedRootsFromContext()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L89 | neighbors=[RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidateService.ts, RuntimeProtectedRoots.ts, RuntimeProtectedRoots]
- "security_strictruntimedto_decodestrictruntimedto": "decodeStrictRuntimeDto()" | kind=code-symbol | source=src/lib/runtime/security/StrictRuntimeDto.ts:L3 | neighbors=[RuntimeBackupService.ts, RuntimeBackupVerifier.ts, GuardedRuntimeMutationSession.ts, StrictRuntimeDto.ts]
- "seo_seomanager_seomanager_createfallbackseodata": ".createFallbackSEOData()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L72 | neighbors=[SEOManager, .getHashtags(), .uniqueStrings(), .generateSEOData()]
- "seo_seomanager_seomanager_gethashtags": ".getHashtags()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L121 | neighbors=[SEOManager, .createFallbackSEOData(), .generateSEOData(), .getStringArray()]
- "seo_seomanager_seomanager_getstringarray": ".getStringArray()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L112 | neighbors=[SEOManager, .generateSEOData(), .getHashtags(), .uniqueStrings()]
- "slug_page_formatcharacteritem": "formatCharacterItem()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L416 | neighbors=[page.tsx, formatListItem(), getStringValue(), isRecord()]
- "slug_page_formattimelineitem": "formatTimelineItem()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L397 | neighbors=[page.tsx, formatListItem(), getStringValue(), isRecord()]
- "slug_page_getstringvalue": "getStringValue()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L468 | neighbors=[page.tsx, formatCharacterItem(), formatListItem(), formatTimelineItem()]
- "slug_page_isrecord": "isRecord()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L464 | neighbors=[page.tsx, formatCharacterItem(), formatListItem(), formatTimelineItem()]
- "sources_wikimediacommonsclient_readboundedbody": "readBoundedBody()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L202 | neighbors=[WikimediaCommonsClient.ts, WikimediaCommonsClientError, .downloadOnce(), .request()]
- "sources_wikimediacommonsclient_wikimediacommonsclient_downloadimage": ".downloadImage()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L126 | neighbors=[WikimediaCommonsClient, safeHttpsUrl(), .withRetry(), WikimediaCommonsClientError]
- "sources_wikimediacommonsclient_wikimediacommonsclient_downloadonce": ".downloadOnce()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L156 | neighbors=[WikimediaCommonsClient, readBoundedBody(), WikimediaCommonsClientError, WikimediaCommonsRateLimitedError]
- "sources_wikimediacommonsclient_wikimediacommonsclient_request": ".request()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L176 | neighbors=[WikimediaCommonsClient, readBoundedBody(), WikimediaCommonsClientError, WikimediaCommonsRateLimitedError]
- "storage_audiostorage_attachpublicationownership": "attachPublicationOwnership()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1154 | neighbors=[AudioStorage.ts, .prepareAudio(), .saveAudio(), .transferPublicationOwnership()]
- "storage_audiostorage_audiostorage_inspectstoredwav": ".inspectStoredWav()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L865 | neighbors=[AudioStorage, .getAudioPath(), .inspectWav(), .readStoredWav()]
- "storage_audiostorage_audiostorage_ispreparedaudio": ".isPreparedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L267 | neighbors=[AudioStorage, .getAudioPath(), getTrustedReceipt(), resolvePath()]
- "storage_audiostorage_audiostorage_ispublishedaudioregistryowned": ".isPublishedAudioRegistryOwned()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L772 | neighbors=[AudioStorage, acquireAudioProjectWriteAuthority(), getTrustedReceipt(), registryOwnership()]
- "storage_audiostorage_audiowavvalidationerror": "AudioWavValidationError" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L102 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, AudioStorage.ts, .constructor(), invalidWav()]
- "storage_audiostorage_cleanupterminalcompensation": "cleanupTerminalCompensation()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1480 | neighbors=[AudioStorage.ts, .getAudioDir(), resolvePath(), compensateProtectedPublication()]
- "storage_audiostorage_completeunusedreceipt": "completeUnusedReceipt()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1536 | neighbors=[AudioStorage.ts, .commitPreparedAudio(), .prepareAudio(), .saveAudio()]
- "storage_audiostorage_readcanonicalfiledescriptorbound": "readCanonicalFileDescriptorBound()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L1409 | neighbors=[AudioStorage.ts, .readStoredWav(), compensateProtectedPublication(), recoverMissingPublicationBinding()]
- "storage_filestorage_resolvepath": "resolvePath()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L13 | neighbors=[FileStorage.ts, .exists(), .listDirs(), .loadJson()]
- "storage_filestorage_withwriteauthority": "withWriteAuthority()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L119 | neighbors=[FileStorage.ts, .remove(), .saveJson(), .saveJsonAtomically()]
- "storage_imagestorage_createimagefilename": "createImageFileName()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L171 | neighbors=[ImageStorage.ts, getExtensionFromMimeType(), sanitizeFileName(), .saveImage()]
- "storage_imagestorage_imagestorage_getimagesdir": ".getImagesDir()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L77 | neighbors=[ImageStorage, .getImagePath(), sanitizePathSegment(), .inspectStoredImage()]
- "storage_imagestorage_imagestorage_getimageurl": ".getImageUrl()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L85 | neighbors=[ImageStorage, sanitizeFileName(), sanitizePathSegment(), .saveImage()]
- "storage_imagestorage_imagestorage_inspectstoredimage": ".inspectStoredImage()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L92 | neighbors=[ImageStorage, .getImagePath(), .getImagesDir(), resolvePath()]
- "storage_imagestorage_sanitizefilename": "sanitizeFileName()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L211 | neighbors=[ImageStorage.ts, createImageFileName(), .getImagePath(), .getImageUrl()]
- "storage_videostorage_videostorage_getvideourl": ".getVideoUrl()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L35 | neighbors=[VideoStorage, .createPaths(), safeMp4FileName(), safeSegment()]
- "studio_pipelinejobspanel_cancancel": "canCancel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L850 | neighbors=[PipelineJobsPanel.tsx, canApplyAction(), getUnsupportedReason(), JobRow()]
- "studio_pipelinejobspanel_canretry": "canRetry()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L854 | neighbors=[PipelineJobsPanel.tsx, canApplyAction(), getUnsupportedReason(), JobRow()]
- "studio_pipelinejobspanel_createhistoryinsights": "createHistoryInsights()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L746 | neighbors=[PipelineJobsPanel.tsx, getQueueHealthLabel(), sortHistoryEvents(), PipelineJobsPanel()]
- "studio_pipelinejobspanel_createjobsummary": "createJobSummary()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L724 | neighbors=[PipelineJobsPanel.tsx, createPipelineHealthInsights(), getQueueHealthLabel(), PipelineJobsPanel()]
- "studio_pipelinejobspanel_formatdate": "formatDate()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L897 | neighbors=[PipelineJobsPanel.tsx, getHistoryEventTimeLabel(), HistoryRow(), JobRow()]
- "studio_pipelinejobspanel_formatduration": "formatDuration()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1008 | neighbors=[PipelineJobsPanel.tsx, formatOptionalDuration(), getHistoryDurationLabel(), getJobDurationLabel()]
- "studio_pipelinejobspanel_gethistorydurationlabel": "getHistoryDurationLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L925 | neighbors=[PipelineJobsPanel.tsx, formatDuration(), getHistoryDurationMs(), HistoryRow()]
- "studio_pipelinejobspanel_gethistoryeventtimelabel": "getHistoryEventTimeLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L946 | neighbors=[PipelineJobsPanel.tsx, formatLastHistoryEvent(), formatDate(), HistoryRow()]
- "studio_pipelinejobspanel_getjobdurationlabel": "getJobDurationLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L908 | neighbors=[PipelineJobsPanel.tsx, formatDuration(), getTimestampMs(), JobRow()]
- "studio_pipelinejobspanel_getqueuehealthlabel": "getQueueHealthLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1071 | neighbors=[PipelineJobsPanel.tsx, createHistoryInsights(), createJobSummary(), formatNumber()]
- "studio_pipelinejobspanel_gettimestampms": "getTimestampMs()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L963 | neighbors=[PipelineJobsPanel.tsx, getHistoryDurationMs(), getHistoryEventTimeMs(), getJobDurationLabel()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-060.json

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
