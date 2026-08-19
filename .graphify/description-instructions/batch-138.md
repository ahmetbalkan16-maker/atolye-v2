# Node Description Batch 139 of 166

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

- "providers_ffmpegscenevideoprovider_ffmpegscenevideoprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L45 | neighbors=[FFmpegSceneVideoProvider]
- "providers_ffmpegscenevideoprovider_ffmpegscenevideoprovider_createimmutablevideodispatchadapter": ".createImmutableVideoDispatchAdapter()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L39 | neighbors=[FFmpegSceneVideoProvider]
- "providers_ffmpegvideoassemblyprovider_audiostart": "audioStart()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L625 | neighbors=[FFmpegVideoAssemblyProvider.ts]
- "providers_ffmpegvideoassemblyprovider_configuredvideoassemblyprovider": "ConfiguredVideoAssemblyProvider" | kind=code-symbol | neighbors=[FFmpegVideoAssemblyProvider]
- "providers_ffmpegvideoassemblyprovider_ffmpegvideoassemblyprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L94 | neighbors=[FFmpegVideoAssemblyProvider]
- "providers_ffmpegvideoassemblyprovider_ffmpegvideoassemblyprovider_createimmutableassemblydispatchadapter": ".createImmutableAssemblyDispatchAdapter()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L88 | neighbors=[FFmpegVideoAssemblyProvider]
- "providers_ffmpegvideoassemblyprovider_narrationduration": "narrationDuration()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L619 | neighbors=[FFmpegVideoAssemblyProvider.ts]
- "providers_ffmpegvideoassemblyprovider_processrunoptions": "ProcessRunOptions" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L36 | neighbors=[FFmpegVideoAssemblyProvider.ts]
- "providers_ffmpegvideoassemblyprovider_sameprobesignature": "sameProbeSignature()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L523 | neighbors=[FFmpegVideoAssemblyProvider.ts]
- "providers_ffmpegvideoassemblyprovider_scenevideoprobesignature": "SceneVideoProbeSignature" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L27 | neighbors=[FFmpegVideoAssemblyProvider.ts]
- "providers_ffmpegvideoassemblyprovider_spawnrunner_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L203 | neighbors=[SpawnRunner]
- "providers_gemini": "gemini.ts" | kind=code-symbol | source=src/lib/ai/providers/gemini.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…]
- "providers_geminiprovider_aiprovider": "AIProvider" | kind=code-symbol | neighbors=[GeminiProvider]
- "providers_geminiprovider_geminiprovider_generate": ".generate()" | kind=code-symbol | source=src/lib/ai/providers/GeminiProvider.ts:L4 | neighbors=[GeminiProvider]
- "providers_grok": "grok.ts" | kind=code-symbol | source=src/lib/ai/providers/grok.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…]
- "providers_imageproviderconfig_imageproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L11 | neighbors=[ImageProviderConfigurationError]
- "providers_imageproviderrouter_getdefaultprovider": "getDefaultProvider()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderRouter.ts:L22 | neighbors=[ImageProviderRouter.ts]
- "providers_imageproviderrouter_getprovider": "getProvider()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderRouter.ts:L26 | neighbors=[ImageProviderRouter.ts]
- "providers_imageproviderrouter_imageproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderRouter.ts:L8 | neighbors=[ImageProviderRouter]
- "providers_mockaiprovider_configuredaiprovider": "ConfiguredAIProvider" | kind=code-symbol | neighbors=[MockAIProvider]
- "providers_mockaiprovider_mockaiprovider_createimmutableaidispatchadapter": ".createImmutableAiDispatchAdapter()" | kind=code-symbol | source=src/lib/ai/providers/MockAIProvider.ts:L5 | neighbors=[MockAIProvider]
- "providers_mockaiprovider_mockaiprovider_generate": ".generate()" | kind=code-symbol | source=src/lib/ai/providers/MockAIProvider.ts:L11 | neighbors=[MockAIProvider]
- "providers_mockanimationprovider_configuredanimationprovider": "ConfiguredAnimationProvider" | kind=code-symbol | neighbors=[MockAnimationProvider]
- "providers_mockanimationprovider_mockanimationprovider_createimmutableanimationdispatchadapter": ".createImmutableAnimationDispatchAdapter()" | kind=code-symbol | source=src/lib/animation/providers/MockAnimationProvider.ts:L11 | neighbors=[MockAnimationProvider]
- "providers_mockaudioprovider_configuredaudioprovider": "ConfiguredAudioProvider" | kind=code-symbol | neighbors=[MockAudioProvider]
- "providers_mockaudioprovider_mockaudioprovider_createimmutableaudiodispatchadapter": ".createImmutableAudioDispatchAdapter()" | kind=code-symbol | source=src/lib/audio/providers/MockAudioProvider.ts:L11 | neighbors=[MockAudioProvider]
- "providers_mockaudioprovider_mockaudioprovider_generateaudio": ".generateAudio()" | kind=code-symbol | source=src/lib/audio/providers/MockAudioProvider.ts:L21 | neighbors=[MockAudioProvider]
- "providers_mockaudioprovider_mockaudioprovider_validateinput": ".validateInput()" | kind=code-symbol | source=src/lib/audio/providers/MockAudioProvider.ts:L17 | neighbors=[MockAudioProvider]
- "providers_mockexportprovider_exportprovider": "ExportProvider" | kind=code-symbol | neighbors=[MockExportProvider]
- "providers_mockimageprovider_configuredimageprovider": "ConfiguredImageProvider" | kind=code-symbol | neighbors=[MockImageProvider]
- "providers_mockimageprovider_mockimageprovider_createimmutableimagedispatchadapter": ".createImmutableImageDispatchAdapter()" | kind=code-symbol | source=src/lib/assets/providers/MockImageProvider.ts:L11 | neighbors=[MockImageProvider]
- "providers_mockimageprovider_mockimageprovider_generateimage": ".generateImage()" | kind=code-symbol | source=src/lib/assets/providers/MockImageProvider.ts:L17 | neighbors=[MockImageProvider]
- "providers_mockthumbnailprovider_configuredthumbnailprovider": "ConfiguredThumbnailProvider" | kind=code-symbol | neighbors=[MockThumbnailProvider]
- "providers_mockthumbnailprovider_mockthumbnailprovider_createimmutablethumbnaildispatchadapter": ".createImmutableThumbnailDispatchAdapter()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L19 | neighbors=[MockThumbnailProvider]
- "providers_mockvideoassemblyprovider_configuredvideoassemblyprovider": "ConfiguredVideoAssemblyProvider" | kind=code-symbol | neighbors=[MockVideoAssemblyProvider]
- "providers_mockvideoassemblyprovider_mockvideoassemblyprovider_assemble": ".assemble()" | kind=code-symbol | source=src/lib/assembly/providers/MockVideoAssemblyProvider.ts:L13 | neighbors=[MockVideoAssemblyProvider]
- "providers_mockvideoassemblyprovider_mockvideoassemblyprovider_createimmutableassemblydispatchadapter": ".createImmutableAssemblyDispatchAdapter()" | kind=code-symbol | source=src/lib/assembly/providers/MockVideoAssemblyProvider.ts:L7 | neighbors=[MockVideoAssemblyProvider]
- "providers_mockvideoprovider_configuredvideoprovider": "ConfiguredVideoProvider" | kind=code-symbol | neighbors=[MockVideoProvider]
- "providers_mockvideoprovider_mockvideoprovider_createimmutablevideodispatchadapter": ".createImmutableVideoDispatchAdapter()" | kind=code-symbol | source=src/lib/video/providers/MockVideoProvider.ts:L11 | neighbors=[MockVideoProvider]
- "providers_mockvideoprovider_mockvideoprovider_generatevideo": ".generateVideo()" | kind=code-symbol | source=src/lib/video/providers/MockVideoProvider.ts:L17 | neighbors=[MockVideoProvider]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-138.json

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
