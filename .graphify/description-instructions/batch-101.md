# Node Description Batch 102 of 166

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

- "providers_ffmpegscenevideoprovider_validateprobe": "validateProbe()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L310 | neighbors=[FFmpegSceneVideoProvider.ts, .generateVideo()]
- "providers_ffmpegvideoassemblyprovider_absoluteinput": "absoluteInput()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L662 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_buildconcatmanifest": "buildConcatManifest()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L537 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_buildcopyconcatargs": "buildCopyConcatArgs()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L549 | neighbors=[FFmpegVideoAssemblyProvider.ts, buildFFmpegArgs()]
- "providers_ffmpegvideoassemblyprovider_buildffprobeargs": "buildFFprobeArgs()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L637 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_buildretimedconcatargs": "buildRetimedConcatArgs()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L581 | neighbors=[FFmpegVideoAssemblyProvider.ts, buildFFmpegArgs()]
- "providers_ffmpegvideoassemblyprovider_buildsceneinputprobeargs": "buildSceneInputProbeArgs()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L649 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_cancopyscenevideos": "canCopySceneVideos()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L507 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_durationtolerance": "durationTolerance()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L633 | neighbors=[FFmpegVideoAssemblyProvider.ts, validateSceneInputProbe()]
- "providers_ffmpegvideoassemblyprovider_expectedoutputduration": "expectedOutputDuration()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L629 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_issafeinputpath": "isSafeInputPath()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L412 | neighbors=[FFmpegVideoAssemblyProvider.ts, validateInput()]
- "providers_ffmpegvideoassemblyprovider_nonempty": "nonEmpty()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L408 | neighbors=[FFmpegVideoAssemblyProvider.ts, validateInput()]
- "providers_ffmpegvideoassemblyprovider_requiresuccessfulprocess": "requireSuccessfulProcess()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L666 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_ffmpegvideoassemblyprovider_spawnrunner_run": ".run()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L209 | neighbors=[.assemble(), SpawnRunner]
- "providers_ffmpegvideoassemblyprovider_validateexecutable": "validateExecutable()" | kind=code-symbol | source=src/lib/assembly/providers/FFmpegVideoAssemblyProvider.ts:L425 | neighbors=[FFmpegVideoAssemblyProvider.ts, .assemble()]
- "providers_imageproviderconfig_imageproviderconfig": "ImageProviderConfig" | kind=code-symbol | source=src/lib/assets/providers/ImageProviderConfig.ts:L18 | neighbors=[ImageProviderConfig.ts, OpenAIImageProvider.ts]
- "providers_mockanimationprovider_frame": "frame()" | kind=code-symbol | source=src/lib/animation/providers/MockAnimationProvider.ts:L45 | neighbors=[MockAnimationProvider.ts, .generateAnimation()]
- "providers_mockanimationprovider_mockanimationprovider_generateanimation": ".generateAnimation()" | kind=code-symbol | source=src/lib/animation/providers/MockAnimationProvider.ts:L18 | neighbors=[MockAnimationProvider, frame()]
- "providers_mockexportprovider_createitem": "createItem()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L147 | neighbors=[MockExportProvider.ts, createExportItems()]
- "providers_mockexportprovider_createnotes": "createNotes()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L173 | neighbors=[MockExportProvider.ts, createMockExportPackage()]
- "providers_mockexportprovider_mockexportprovider_generateexportpackage": ".generateExportPackage()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L14 | neighbors=[MockExportProvider, createMockExportPackage()]
- "providers_mockexportprovider_normalizeformat": "normalizeFormat()" | kind=code-symbol | source=src/lib/export/providers/MockExportProvider.ts:L190 | neighbors=[MockExportProvider.ts, createMockExportPackage()]
- "providers_mockthumbnailprovider_buildsourceline": "buildSourceLine()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L225 | neighbors=[MockThumbnailProvider.ts, buildVariants()]
- "providers_mockthumbnailprovider_crc32": "crc32()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L291 | neighbors=[MockThumbnailProvider.ts, pngChunk()]
- "providers_mockthumbnailprovider_createoverlaytext": "createOverlayText()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L243 | neighbors=[MockThumbnailProvider.ts, buildVariants()]
- "providers_mockthumbnailprovider_findstrongestscene": "findStrongestScene()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L212 | neighbors=[MockThumbnailProvider.ts, buildVariants()]
- "providers_mockthumbnailprovider_infermainsubject": "inferMainSubject()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L196 | neighbors=[MockThumbnailProvider.ts, createMockThumbnailData()]
- "providers_mockthumbnailprovider_mockthumbnailprovider_generatethumbnailasset": ".generateThumbnailAsset()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L39 | neighbors=[MockThumbnailProvider, createDeterministicThumbnailPng()]
- "providers_mockthumbnailprovider_mockthumbnailprovider_generatethumbnailplan": ".generateThumbnailPlan()" | kind=code-symbol | source=src/lib/thumbnail/providers/MockThumbnailProvider.ts:L26 | neighbors=[MockThumbnailProvider, createMockThumbnailData()]
- "providers_mockyoutubeprovider_mockyoutubeprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L21 | neighbors=[MockYouTubeProvider, createMockYouTubeDraft()]
- "providers_mockyoutubeprovider_parseduration": "parseDuration()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L82 | neighbors=[MockYouTubeProvider.ts, createChapters()]
- "providers_mockyoutubeprovider_unique": "unique()" | kind=code-symbol | source=src/lib/youtube/providers/MockYouTubeProvider.ts:L90 | neighbors=[MockYouTubeProvider.ts, createMockYouTubeDraft()]
- "providers_mockyoutubepublishprovider_mockyoutubepublishprovider_reconcilepublish": ".reconcilePublish()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L79 | neighbors=[MockYouTubePublishProvider, reconciliationFailure()]
- "providers_mockyoutubepublishprovider_reconciliationfailure": "reconciliationFailure()" | kind=code-symbol | source=src/lib/youtube/publish/providers/MockYouTubePublishProvider.ts:L115 | neighbors=[MockYouTubePublishProvider.ts, .reconcilePublish()]
- "providers_openaianimationprovider_deterministicrequest": "deterministicRequest()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L270 | neighbors=[OpenAIAnimationProvider.ts, .generateAnimation()]
- "providers_openaianimationprovider_failure": "failure()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L354 | neighbors=[OpenAIAnimationProvider.ts, .generateAnimation()]
- "providers_openaianimationprovider_fetchwithabort": "fetchWithAbort()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L516 | neighbors=[OpenAIAnimationProvider.ts, .request()]
- "providers_openaianimationprovider_isabort": "isAbort()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L535 | neighbors=[OpenAIAnimationProvider.ts, .request()]
- "providers_openaianimationprovider_normalizefinishreason": "normalizeFinishReason()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L428 | neighbors=[OpenAIAnimationProvider.ts, .request()]
- "providers_openaianimationprovider_readwithabort": "readWithAbort()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L504 | neighbors=[OpenAIAnimationProvider.ts, readBoundedJson()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-101.json

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
