# Node Description Batch 103 of 166

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

- "providers_openaianimationprovider_safecount": "safeCount()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L435 | neighbors=[OpenAIAnimationProvider.ts, usage()]
- "providers_openaianimationprovider_success": "success()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L328 | neighbors=[OpenAIAnimationProvider.ts, .generateAnimation()]
- "providers_openaiaudioprovider_createfailure": "createFailure()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L378 | neighbors=[OpenAIAudioProvider.ts, .generateAudio()]
- "providers_openaiaudioprovider_hassafecontenttype": "hasSafeContentType()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L365 | neighbors=[OpenAIAudioProvider.ts, .generateAudio()]
- "providers_openaiaudioprovider_openaiaudioprovider_validateinput": ".validateInput()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L33 | neighbors=[OpenAIAudioProvider, .generateAudio()]
- "providers_openaiaudioprovider_parsecontentlength": "parseContentLength()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L333 | neighbors=[OpenAIAudioProvider.ts, readBoundedBody()]
- "providers_openaiaudioprovider_readwithabort": "readWithAbort()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L316 | neighbors=[OpenAIAudioProvider.ts, readBoundedBody()]
- "providers_openaiimageprovider_createerrorresult": "createErrorResult()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L193 | neighbors=[OpenAIImageProvider.ts, .generateImage()]
- "providers_openaiimageprovider_createprompt": "createPrompt()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L185 | neighbors=[OpenAIImageProvider.ts, .generateImage()]
- "providers_openaiimageprovider_decodestrictbase64": "decodeStrictBase64()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L174 | neighbors=[OpenAIImageProvider.ts, .generateImage()]
- "providers_openaiimageprovider_readboundedjson": "readBoundedJson()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L142 | neighbors=[OpenAIImageProvider.ts, .generateImage()]
- "providers_openaiprovider_normalizefinishreason": "normalizeFinishReason()" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L61 | neighbors=[OpenAIProvider.ts, .generate()]
- "providers_openaiprovider_safetokencount": "safeTokenCount()" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L68 | neighbors=[OpenAIProvider.ts, .generate()]
- "providers_openaithumbnailprovider_decodestrictbase64": "decodeStrictBase64()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L157 | neighbors=[OpenAIThumbnailProvider.ts, .generateThumbnailAsset()]
- "providers_openaithumbnailprovider_failure": "failure()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L170 | neighbors=[OpenAIThumbnailProvider.ts, .generateThumbnailAsset()]
- "providers_openaithumbnailprovider_readboundedjson": "readBoundedJson()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L120 | neighbors=[OpenAIThumbnailProvider.ts, .generateThumbnailAsset()]
- "providers_openaiyoutubeprovider_failure": "failure()" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L132 | neighbors=[OpenAIYouTubeProvider.ts, .generatePublishingPackage()]
- "providers_openaiyoutubeprovider_readboundedjson": "readBoundedJson()" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L100 | neighbors=[OpenAIYouTubeProvider.ts, .generatePublishingPackage()]
- "providers_providerdispatchadapterauthority_bindowndatamethod": "bindOwnDataMethod()" | kind=code-symbol | source=src/lib/providers/ProviderDispatchAdapterAuthority.ts:L29 | neighbors=[ProviderDispatchAdapterAuthority.ts, createProviderDispatchAdapter()]
- "providers_realphotoimageprovider_buildsearchquery": "buildSearchQuery()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L234 | neighbors=[RealPhotoImageProvider.ts, .generateImage()]
- "providers_realphotoimageprovider_notfoundresult": "notFoundResult()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L258 | neighbors=[RealPhotoImageProvider.ts, .generateImage()]
- "providers_realphotoimageprovider_realphotoimageprovider_pacerequest": ".paceRequest()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L74 | neighbors=[RealPhotoImageProvider, .generateImage()]
- "providers_realphotoimageprovider_titlematchscore": "titleMatchScore()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L226 | neighbors=[RealPhotoImageProvider.ts, tokenize()]
- "providers_realphotoimageprovider_trysavecandidate": "trySaveCandidate()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L172 | neighbors=[RealPhotoImageProvider.ts, .generateImage()]
- "providers_videoassemblyproviderconfig_comparablepath": "comparablePath()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L77 | neighbors=[VideoAssemblyProviderConfig.ts, getFFmpegVideoAssemblyConfig()]
- "providers_videoproviderconfig_comparablepath": "comparablePath()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L57 | neighbors=[VideoProviderConfig.ts, getFFmpegSceneVideoConfig()]
- "providers_youtubedataapipublishprovider_cancelresponsebody": "cancelResponseBody()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L278 | neighbors=[YouTubeDataApiPublishProvider.ts, .reconcilePublish()]
- "providers_youtubedataapipublishprovider_descriptionwithmarker": "descriptionWithMarker()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L241 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish()]
- "providers_youtubedataapipublishprovider_detectthumbnailmime": "detectThumbnailMime()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L339 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish()]
- "providers_youtubedataapipublishprovider_failure": "failure()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L347 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish()]
- "providers_youtubedataapipublishprovider_istrusteduploadurl": "isTrustedUploadUrl()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L320 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish()]
- "providers_youtubedataapipublishprovider_readreconciliationcandidates": "readReconciliationCandidates()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L249 | neighbors=[YouTubeDataApiPublishProvider.ts, .reconcilePublish()]
- "providers_youtubedataapipublishprovider_reconciliationfailure": "reconciliationFailure()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L357 | neighbors=[YouTubeDataApiPublishProvider.ts, .reconcilePublish()]
- "providers_youtubedataapipublishprovider_youtubedataapipublishprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L28 | neighbors=[YouTubeDataApiPublishProvider, safeRemoteId()]
- "providers_youtubeprovider_youtube_generation_error": "YOUTUBE_GENERATION_ERROR" | kind=code-symbol | source=src/lib/youtube/providers/YouTubeProvider.ts:L10 | neighbors=[OpenAIYouTubeProvider.ts, YouTubeProvider.ts]
- "publish_youtubepublishpipeline_createproviderrequest": "createProviderRequest()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L287 | neighbors=[YouTubePublishPipeline.ts, .publishStoredPackage()]
- "publish_youtubepublishpipeline_requirematchingpublishedrecord": "requireMatchingPublishedRecord()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L372 | neighbors=[YouTubePublishPipeline.ts, .publishStoredPackage()]
- "publish_youtubepublishpipeline_requiretimestamp": "requireTimestamp()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L434 | neighbors=[YouTubePublishPipeline.ts, .publishStoredPackage()]
- "publish_youtubepublishpipeline_safeslug": "safeSlug()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L429 | neighbors=[YouTubePublishPipeline.ts, .publishStoredPackage()]
- "publish_youtubepublishpipeline_uniqueasset": "uniqueAsset()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L423 | neighbors=[YouTubePublishPipeline.ts, requireAssets()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-102.json

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
