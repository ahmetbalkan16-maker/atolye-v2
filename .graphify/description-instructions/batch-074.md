# Node Description Batch 75 of 166

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
LANGUAGE: each entry has a `lang=` marker giving the language of its source.
Write that entry's description in EXACTLY that language. Do not translate to
a single common language — match each node's source language individually.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "providers_openaianimationprovider_validateinput": "validateInput()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L318 | neighbors=[OpenAIAnimationProvider.ts, .generateAnimation(), .getRequestIdentity()] | lang=en
- "providers_openaianimationprovider_validsceneid": "validSceneId()" | kind=code-symbol | source=src/lib/animation/providers/OpenAIAnimationProvider.ts:L439 | neighbors=[OpenAIAnimationProvider.ts, diagnostic(), .generateAnimation()] | lang=en
- "providers_openaiaudioprovider_cancelbody": "cancelBody()" | kind=code-symbol | source=src/lib/audio/providers/OpenAIAudioProvider.ts:L353 | neighbors=[OpenAIAudioProvider.ts, .generateAudio(), readBoundedBody()] | lang=en
- "providers_openaiprovider_openaiprovider_generate": ".generate()" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L17 | neighbors=[OpenAIProvider, normalizeFinishReason(), safeTokenCount()] | lang=en
- "providers_openaiyoutubeprovider_openaiyoutubeprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=src/lib/youtube/providers/OpenAIYouTubeProvider.ts:L42 | neighbors=[OpenAIYouTubeProvider, failure(), readBoundedJson()] | lang=en
- "providers_realphotoimageprovider_rankeligiblecandidates": "rankEligibleCandidates()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L200 | neighbors=[RealPhotoImageProvider.ts, tokenize(), .generateImage()] | lang=en
- "providers_realphotoimageprovider_tokenize": "tokenize()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L221 | neighbors=[RealPhotoImageProvider.ts, rankEligibleCandidates(), titleMatchScore()] | lang=en
- "providers_thumbnailprovider_thumbnailassetgenerationinput": "ThumbnailAssetGenerationInput" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L30 | neighbors=[MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts, ThumbnailProvider.ts] | lang=en
- "providers_thumbnailprovider_thumbnailgenerationresult": "ThumbnailGenerationResult" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L22 | neighbors=[MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts, ThumbnailProvider.ts] | lang=en
- "providers_videoassemblyproviderconfig_integervalue": "integerValue()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L96 | neighbors=[VideoAssemblyProviderConfig.ts, getFFmpegVideoAssemblyConfig(), VideoAssemblyConfigurationError] | lang=en
- "providers_videoassemblyproviderconfig_requireexecutablepath": "requireExecutablePath()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L82 | neighbors=[VideoAssemblyProviderConfig.ts, getFFmpegVideoAssemblyConfig(), VideoAssemblyConfigurationError] | lang=en
- "providers_videoprovider_videoprovidersceneinput": "VideoProviderSceneInput" | kind=code-symbol | source=src/lib/video/providers/VideoProvider.ts:L9 | neighbors=[FFmpegSceneVideoProvider.ts, VideoProvider.ts, VideoPipeline.ts] | lang=en
- "providers_videoproviderconfig_ffmpegscenevideoconfig": "FFmpegSceneVideoConfig" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L17 | neighbors=[FFmpegSceneVideoProvider.ts, VideoProviderConfig.ts, smoke-production-scene-video-rendering.…] | lang=en
- "providers_videoproviderconfig_integervalue": "integerValue()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L62 | neighbors=[VideoProviderConfig.ts, getFFmpegSceneVideoConfig(), VideoProviderConfigurationError] | lang=en
- "providers_videoproviderconfig_requireexecutablepath": "requireExecutablePath()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L49 | neighbors=[VideoProviderConfig.ts, getFFmpegSceneVideoConfig(), VideoProviderConfigurationError] | lang=en
- "providers_youtubedataapipublishprovider_readboundedjson": "readBoundedJson()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L286 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish(), .reconcilePublish()] | lang=en
- "providers_youtubedataapipublishprovider_safeproviderrequestid": "safeProviderRequestId()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L335 | neighbors=[YouTubeDataApiPublishProvider.ts, .publish(), .reconcilePublish()] | lang=en
- "providers_youtubedataapipublishprovider_saferemoteid": "safeRemoteId()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L331 | neighbors=[YouTubeDataApiPublishProvider.ts, .constructor(), .publish()] | lang=en
- "providers_youtubeprovider_configuredyoutubeprovider": "ConfiguredYouTubeProvider" | kind=code-symbol | source=src/lib/youtube/providers/YouTubeProvider.ts:L47 | neighbors=[MockYouTubeProvider.ts, OpenAIYouTubeProvider.ts, YouTubeProvider.ts] | lang=en
- "providers_youtubepublishprovider_configuredyoutubepublishprovider": "ConfiguredYouTubePublishProvider" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubePublishProvider.ts:L24 | neighbors=[MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts, YouTubePublishProvider.ts] | lang=en
- "publish_youtubepublishpipeline_promoterecoveryreceipt": "promoteRecoveryReceipt()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L406 | neighbors=[YouTubePublishPipeline.ts, removeRecoveryReceiptBestEffort(), .publishStoredPackage()] | lang=en
- "publish_youtubepublishpipeline_removerecoveryreceiptbesteffort": "removeRecoveryReceiptBestEffort()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L415 | neighbors=[YouTubePublishPipeline.ts, promoteRecoveryReceipt(), .publishStoredPackage()] | lang=en
- "publish_youtubepublishpipeline_requireassets": "requireAssets()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L245 | neighbors=[YouTubePublishPipeline.ts, uniqueAsset(), .publishStoredPackage()] | lang=en
- "publish_youtubepublishvalidation_createyoutubepublishmetadata": "createYouTubePublishMetadata()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L66 | neighbors=[YouTubePublishPipeline.ts, YouTubePublishValidation.ts, YouTubePublishValidationError] | lang=en
- "publish_youtubepublishvalidation_isyoutubepublishrecord": "isYouTubePublishRecord()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L81 | neighbors=[YouTubePublishValidation.ts, validateYouTubePublishRecord(), smoke-production-youtube-publish-pipeli…] | lang=en
- "publish_youtubepublishvalidation_requirerecord": "requireRecord()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L221 | neighbors=[YouTubePublishValidation.ts, validateYouTubePublishReconciliationRes…, validateYouTubePublishRecord()] | lang=en
- "roadmap_sprint_114": "Sprint 114 - Production Narration Audio Pipeline Activation" | kind=entity | source=ROADMAP.md:2139 | neighbors=[Sprint 113 - Production Visual Asset Pi…, Sprint 43 - Audio Engine Foundation, Sprint 115 - Production Video Assembly …] | lang=en
- "roadmap_sprint_116": "Sprint 116 - Animation Motion Plan Production Contract" | kind=entity | source=ROADMAP.md:2182 | neighbors=[Sprint 115 - Production Video Assembly …, Sprint 41 - Animation Scene-Level Regen…, Sprint 117 - Production Scene Video Ren…] | lang=en
- "roadmap_sprint_117": "Sprint 117 - Production Scene Video Rendering Activation" | kind=entity | source=ROADMAP.md:2204 | neighbors=[Sprint 116 - Animation Motion Plan Prod…, Sprint 42 - Video Engine Foundation, Sprint 118 - Assembly Scene-Video Consu…] | lang=en
- "roadmap_sprint_126": "Sprint 126 - Real Production Acceptance Run Preparation" | kind=entity | source=ROADMAP.md:2416 | neighbors=[Production Acceptance Execution Gate, Sprint 125 - Production End-to-End Vali…, Sprint 127 - Production Animation Provi…] | lang=en
- "roadmap_sprint_128_1": "Sprint 128.1 - Production Acceptance P0 Closure and Operator Entrypoint" | kind=entity | source=ROADMAP.md:2474 | neighbors=[Production Acceptance Execution Gate, Sprint 127 - Production Animation Provi…, Sprint 128.2 - Production Acceptance P1…] | lang=en
- "roadmap_sprint_129_20": "Sprint 129.20 - Visuals Truncation Propagation & Stage Token Budget" | kind=entity | source=ROADMAP.md:851 | neighbors=[Sprint 129.19 - Visuals Structured Outp…, Sprint 129.21 - Animation Failure Propa…, Sprint 129.37 - Assembly AI Token Budge…] | lang=en
- "roadmap_sprint_129_25_c2a": "Sprint 129.25 C.2A - Guarded Filesystem Foundation" | kind=entity | source=ROADMAP.md:764 | neighbors=[Sprint 129.25 C.1 - Verified Runtime Ba…, Sprint 129.25 C.2B.1 - Migration Candid…, Sprint 99.1 - Durable Storage Recovery …] | lang=pt
- "roadmap_sprint_129_29": "Sprint 129.29 - Failed-Terminal Settlement Remediation" | kind=entity | source=ROADMAP.md:661 | neighbors=[Production Acceptance Execution Gate, Runtime Backup Long-Path, V3 Runtime Au…, Sprint 129.30 - Failed-Terminal Evidenc…] | lang=en
- "roadmap_sprint_129_33": "Sprint 129.33 - Exhausted Retry Admission / Final TOCTOU Remediation" | kind=entity | source=ROADMAP.md:475 | neighbors=[Production Acceptance Execution Gate, Sprint 129.32 - Exact job.attempts Inva…, Sprint 129.35 - Legacy Terminal Lineage…] | lang=en
- "roadmap_sprint_129_35": "Sprint 129.35 - Legacy Terminal Lineage Global-Quiescence Compatibility Remedia…" | kind=entity | source=ROADMAP.md:414 | neighbors=[Production Acceptance Execution Gate, Sprint 129.33 - Exhausted Retry Admissi…, Sprint 129.36 - Explicit One-Time Retry…] | lang=en
- "roadmap_sprint_129_39": "Sprint 129.39 - Canonical Stage-Bounded Production Resume" | kind=entity | source=ROADMAP.md:257 | neighbors=[Production Acceptance Execution Gate, Sprint 129.38 - Retry-Budget Settled-Re…, Sprint 129.40 - Production Scene-Video …] | lang=en
- "roadmap_sprint_129_40": "Sprint 129.40 - Production Scene-Video Full-Frame Framing Remediation" | kind=entity | source=ROADMAP.md:228 | neighbors=[Production Acceptance Execution Gate, Sprint 129.39 - Canonical Stage-Bounded…, Sprint 129.41 - Canonical Completed-Sta…] | lang=en
- "roadmap_sprint_129_41": "Sprint 129.41 - Canonical Completed-Stage Regeneration" | kind=entity | source=ROADMAP.md:193 | neighbors=[Production Acceptance Execution Gate, Sprint 129.40 - Production Scene-Video …, Sprint 129.43 - Fatih Documentary Live …] | lang=en
- "roadmap_sprint_41": "Sprint 41 - Animation Scene-Level Regeneration" | kind=entity | source=ROADMAP.md:886 | neighbors=[Sprint 116 - Animation Motion Plan Prod…, Sprint 127 - Production Animation Provi…, Sprint 48 - Final Pipeline Integration] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-074.json

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
