# Node Description Batch 140 of 166

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

- "providers_mockyoutubeprovider_configuredyoutubeprovider": "ConfiguredYouTubeProvider" | kind=code-symbol | neighbors=[MockYouTubeProvider]
- "providers_mockyoutubeprovider_mockyoutubeprovider_createimmutableyoutubedispatchadapter": ".createImmutableYoutubeDispatchAdapter()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L14 | neighbors=[MockYouTubeProvider]
- "providers_mockyoutubepublishprovider_configuredyoutubepublishprovider": "ConfiguredYouTubePublishProvider" | kind=code-symbol | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_matchedresult": "MatchedResult" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L16 | neighbors=[MockYouTubePublishProvider.ts]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L36 | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_createimmutablepublishdispatchadapter": ".createImmutablePublishDispatchAdapter()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L28 | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_publish": ".publish()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L40 | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_seedremotepublish": ".seedRemotePublish()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L106 | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_setreconciliationoutcome": ".setReconciliationOutcome()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L110 | neighbors=[MockYouTubePublishProvider]
- "providers_mockyoutubepublishprovider_nonmatchedoutcome": "NonMatchedOutcome" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L17 | neighbors=[MockYouTubePublishProvider.ts]
- "providers_openaianimationprovider_boundedproviderresponse": "BoundedProviderResponse" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L265 | neighbors=[OpenAIAnimationProvider.ts]
- "providers_openaianimationprovider_configuredanimationprovider": "ConfiguredAnimationProvider" | kind=code-symbol | neighbors=[OpenAIAnimationProvider]
- "providers_openaianimationprovider_failurecode": "FailureCode" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L31 | neighbors=[OpenAIAnimationProvider.ts]
- "providers_openaianimationprovider_fetcher": "Fetcher" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L30 | neighbors=[OpenAIAnimationProvider.ts]
- "providers_openaianimationprovider_openaianimationprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L37 | neighbors=[OpenAIAnimationProvider]
- "providers_openaianimationprovider_openaianimationprovider_createimmutableanimationdispatchadapter": ".createImmutableAnimationDispatchAdapter()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L43 | neighbors=[OpenAIAnimationProvider]
- "providers_openaianimationprovider_providerpayload": "ProviderPayload" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L253 | neighbors=[OpenAIAnimationProvider.ts]
- "providers_openaianimationprovider_requestresult": "RequestResult" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L240 | neighbors=[OpenAIAnimationProvider.ts]
- "providers_openaianimationprovider_responsevalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L540 | neighbors=[ResponseValidationError]
- "providers_openaiaudioprovider_accepted_wav_content_types": "ACCEPTED_WAV_CONTENT_TYPES" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L19 | neighbors=[OpenAIAudioProvider.ts]
- "providers_openaiaudioprovider_configuredaudioprovider": "ConfiguredAudioProvider" | kind=code-symbol | neighbors=[OpenAIAudioProvider]
- "providers_openaiaudioprovider_openaiaudioprovider_createimmutableaudiodispatchadapter": ".createImmutableAudioDispatchAdapter()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L27 | neighbors=[OpenAIAudioProvider]
- "providers_openaiimageprovider_configuredimageprovider": "ConfiguredImageProvider" | kind=code-symbol | neighbors=[OpenAIImageProvider]
- "providers_openaiimageprovider_openaiimageprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L27 | neighbors=[OpenAIImageProvider]
- "providers_openaiimageprovider_openaiimageprovider_createimmutableimagedispatchadapter": ".createImmutableImageDispatchAdapter()" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L31 | neighbors=[OpenAIImageProvider]
- "providers_openaiimageprovider_openaiimageresponse": "OpenAIImageResponse" | kind=code-symbol | source=src/lib/assets/providers/OpenAIImageProvider.ts:L13 | neighbors=[OpenAIImageProvider.ts]
- "providers_openaiprovider_configuredaiprovider": "ConfiguredAIProvider" | kind=code-symbol | neighbors=[OpenAIProvider]
- "providers_openaiprovider_openaiprovider_createimmutableaidispatchadapter": ".createImmutableAiDispatchAdapter()" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L11 | neighbors=[OpenAIProvider]
- "providers_openaithumbnailprovider_configuredthumbnailprovider": "ConfiguredThumbnailProvider" | kind=code-symbol | neighbors=[OpenAIThumbnailProvider]
- "providers_openaithumbnailprovider_openaiimageresponse": "OpenAIImageResponse" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L13 | neighbors=[OpenAIThumbnailProvider.ts]
- "providers_openaithumbnailprovider_openaithumbnailprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L23 | neighbors=[OpenAIThumbnailProvider]
- "providers_openaithumbnailprovider_openaithumbnailprovider_createimmutablethumbnaildispatchadapter": ".createImmutableThumbnailDispatchAdapter()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L29 | neighbors=[OpenAIThumbnailProvider]
- "providers_openaithumbnailprovider_openaithumbnailprovider_generatethumbnailplan": ".generateThumbnailPlan()" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L36 | neighbors=[OpenAIThumbnailProvider]
- "providers_openaiyoutubeprovider_configuredyoutubeprovider": "ConfiguredYouTubeProvider" | kind=code-symbol | neighbors=[OpenAIYouTubeProvider]
- "providers_openaiyoutubeprovider_openairesponse": "OpenAIResponse" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L12 | neighbors=[OpenAIYouTubeProvider.ts]
- "providers_openaiyoutubeprovider_openaiyoutubeprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L23 | neighbors=[OpenAIYouTubeProvider]
- "providers_openaiyoutubeprovider_openaiyoutubeprovider_createimmutableyoutubedispatchadapter": ".createImmutableYoutubeDispatchAdapter()" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L35 | neighbors=[OpenAIYouTubeProvider]
- "providers_openrouterprovider_configuredaiprovider": "ConfiguredAIProvider" | kind=code-symbol | neighbors=[OpenRouterProvider]
- "providers_openrouterprovider_openrouterprovider_createimmutableaidispatchadapter": ".createImmutableAiDispatchAdapter()" | kind=code-symbol | source=src/lib/ai/providers/OpenRouterProvider.ts:L5 | neighbors=[OpenRouterProvider]
- "providers_openrouterprovider_openrouterprovider_generate": ".generate()" | kind=code-symbol | source=src/lib/ai/providers/OpenRouterProvider.ts:L11 | neighbors=[OpenRouterProvider]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-139.json

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
