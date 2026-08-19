# Node Description Batch 116 of 166

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

- "security_guardedruntimemutationsession_relativeposix": "relativePosix()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1491 | neighbors=[GuardedRuntimeMutationSession.ts, .prepareOwnedDestination()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_writecanonicalmanifest": ".writeCanonicalManifest()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L908 | neighbors=[.createVerifiedRuntimeBackup(), RuntimeBackupCreateGuardedOperationImpl]
- "security_ownedruntimedirectory_ownedruntimedirectoryadapter": "OwnedRuntimeDirectoryAdapter" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L23 | neighbors=[GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts]
- "security_ownedruntimedirectory_ownedruntimedirectorystate": "OwnedRuntimeDirectoryState" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L10 | neighbors=[GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts]
- "security_ownedruntimedirectory_ownedruntimewriteoptions": "OwnedRuntimeWriteOptions" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L17 | neighbors=[GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts]
- "security_ownedruntimedirectory_runtimeobjectidentity": "RuntimeObjectIdentity" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L4 | neighbors=[GuardedRuntimeMutationSession.ts, OwnedRuntimeDirectory.ts]
- "security_runtimemutationerror_istargetexists": "isTargetExists()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L66 | neighbors=[RuntimeMutationError.ts, normalizeRuntimeMutationError()]
- "security_runtimemutationerror_messagefor": "messageFor()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L71 | neighbors=[RuntimeMutationError.ts, .constructor()]
- "security_runtimemutationerror_runtimemutationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L21 | neighbors=[RuntimeMutationError, messageFor()]
- "security_runtimepathcapabilityprobe_capabilityunavailable": "capabilityUnavailable()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L102 | neighbors=[RuntimePathCapabilityProbe.ts, probeRuntimePathCapabilities()]
- "security_runtimepathcapabilityprobe_filesystemkind": "filesystemKind()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L92 | neighbors=[RuntimePathCapabilityProbe.ts, probeRuntimePathCapabilities()]
- "security_runtimepathcapabilityprobe_isnodeerror": "isNodeError()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L106 | neighbors=[RuntimePathCapabilityProbe.ts, probeRuntimePathCapabilities()]
- "security_runtimepathcapabilityprobe_runtimepathcapabilityreport": "RuntimePathCapabilityReport" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathCapabilityProbe.ts:L7 | neighbors=[GuardedRuntimeMutationSession.ts, RuntimePathCapabilityProbe.ts]
- "security_runtimeprotectedroots_overlap": "overlap()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L165 | neighbors=[RuntimeProtectedRoots.ts, .assertWritableRoot()]
- "security_runtimeprotectedroots_runtimeprotectedrootentry": "RuntimeProtectedRootEntry" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L34 | neighbors=[RuntimeProtectedRoots.ts, RuntimeProtectedRootInput]
- "security_runtimeprotectedroots_runtimeprotectedrootinput": "RuntimeProtectedRootInput" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L19 | neighbors=[RuntimeProtectedRoots.ts, RuntimeProtectedRootEntry]
- "security_runtimeprotectedroots_runtimeprotectedrootrole": "RuntimeProtectedRootRole" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L9 | neighbors=[GuardedRuntimeMutationSession.ts, RuntimeProtectedRoots.ts]
- "security_runtimeprotectedroots_runtimeprotectedroots_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L41 | neighbors=[RuntimeProtectedRoots, .assertComplete()]
- "security_runtimeprotectedroots_runtimeprotectedroots_root": ".root()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L55 | neighbors=[RuntimeProtectedRoots, .assertWritableRoot()]
- "seo_seomanager_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/seo/SEOManager.ts:L146 | neighbors=[SEOManager.ts, isStrictSEOResponse()]
- "slug_page_formatdate": "formatDate()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L482 | neighbors=[page.tsx, ProjectStudioPage()]
- "slug_page_projectstudiopage": "ProjectStudioPage()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L49 | neighbors=[page.tsx, formatDate()]
- "sources_wikimediacommonsclient_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L339 | neighbors=[WikimediaCommonsClient.ts, parseSearchResponse()]
- "sources_wikimediacommonsclient_safehttpsurl": "safeHttpsUrl()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L234 | neighbors=[WikimediaCommonsClient.ts, .downloadImage()]
- "sources_wikimediacommonsclient_selectdownloadtarget": "selectDownloadTarget()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L314 | neighbors=[WikimediaCommonsClient.ts, parseSearchResponse()]
- "sources_wikimediacommonsclient_striphtml": "stripHtml()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L333 | neighbors=[WikimediaCommonsClient.ts, parseSearchResponse()]
- "sources_wikimediacommonsclient_wikimediacommonscandidate": "WikimediaCommonsCandidate" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L31 | neighbors=[RealPhotoImageProvider.ts, WikimediaCommonsClient.ts]
- "steps_researchstep": "researchStep.ts" | kind=code-symbol | source=src/lib/ai/steps/researchStep.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, researchStep()]
- "steps_scenestep_estimateduration": "estimateDuration()" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L49 | neighbors=[sceneStep.ts, sceneStep()]
- "steps_scenestep_includesany": "includesAny()" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L44 | neighbors=[sceneStep.ts, sceneStep()]
- "storage_audiostorage_audioinspection": "AudioInspection" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L66 | neighbors=[AudioStorage.ts, SavedAudio]
- "storage_audiostorage_audiostorage_compensatepublishedaudio": ".compensatePublishedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L622 | neighbors=[AudioStorage, .compensatePublishedAudioResult()]
- "storage_audiostorage_audiostorage_completepublishedaudio": ".completePublishedAudio()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L667 | neighbors=[AudioStorage, .handoffPublishedAudio()]
- "storage_audiostorage_audiostorage_getcompensationref": ".getCompensationRef()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L803 | neighbors=[AudioStorage, getTrustedReceipt()]
- "storage_audiostorage_savedaudio": "SavedAudio" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L71 | neighbors=[AudioStorage.ts, AudioInspection]
- "storage_filestorage_filestorage_exists": ".exists()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L40 | neighbors=[FileStorage, resolvePath()]
- "storage_filestorage_filestorage_listdirs": ".listDirs()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L95 | neighbors=[FileStorage, resolvePath()]
- "storage_filestorage_filestorage_loadjson": ".loadJson()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L84 | neighbors=[FileStorage, resolvePath()]
- "storage_filestorage_filestorage_remove": ".remove()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L108 | neighbors=[FileStorage, withWriteAuthority()]
- "storage_filestorage_filestorage_savejson": ".saveJson()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L45 | neighbors=[FileStorage, withWriteAuthority()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-115.json

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
