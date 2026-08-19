# Node Description Batch 141 of 166

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

- "providers_providerdispatchadapterauthority_provideradapterprimitive": "ProviderAdapterPrimitive" | kind=code-symbol | source=src/lib/providers/ProviderDispatchAdapterAuthority.ts:L3 | neighbors=[ProviderDispatchAdapterAuthority.ts]
- "providers_realphotoimageprovider_configuredimageprovider": "ConfiguredImageProvider" | kind=code-symbol | neighbors=[RealPhotoImageProvider]
- "providers_realphotoimageprovider_isbookscanartifact": "isBookScanArtifact()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L217 | neighbors=[RealPhotoImageProvider.ts]
- "providers_realphotoimageprovider_isfreelicense": "isFreeLicense()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L247 | neighbors=[RealPhotoImageProvider.ts]
- "providers_realphotoimageprovider_rankedcandidate": "RankedCandidate" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L22 | neighbors=[RealPhotoImageProvider.ts]
- "providers_realphotoimageprovider_realphotoimageprovider_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L48 | neighbors=[RealPhotoImageProvider]
- "providers_realphotoimageprovider_realphotoimageprovider_createimmutableimagedispatchadapter": ".createImmutableImageDispatchAdapter()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L68 | neighbors=[RealPhotoImageProvider]
- "providers_realphotoimageprovider_tosafeimagemimetype": "toSafeImageMimeType()" | kind=code-symbol | source=src/lib/assets/providers/RealPhotoImageProvider.ts:L241 | neighbors=[RealPhotoImageProvider.ts]
- "providers_thumbnailprovider_thumbnailassetfailure": "ThumbnailAssetFailure" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L60 | neighbors=[ThumbnailProvider.ts]
- "providers_thumbnailprovider_thumbnailassetresultbase": "ThumbnailAssetResultBase" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L39 | neighbors=[ThumbnailProvider.ts]
- "providers_thumbnailprovider_thumbnailassetsuccess": "ThumbnailAssetSuccess" | kind=code-symbol | source=src/lib/thumbnail/providers/ThumbnailProvider.ts:L46 | neighbors=[ThumbnailProvider.ts]
- "providers_videoassemblyproviderconfig_ffmpegvideoassemblyconfig": "FFmpegVideoAssemblyConfig" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L17 | neighbors=[VideoAssemblyProviderConfig.ts]
- "providers_videoassemblyproviderconfig_videoassemblyconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderConfig.ts:L10 | neighbors=[VideoAssemblyConfigurationError]
- "providers_videoassemblyproviderrouter_videoassemblyproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderRouter.ts:L7 | neighbors=[VideoAssemblyProviderRouter]
- "providers_videoproviderconfig_videoproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderConfig.ts:L10 | neighbors=[VideoProviderConfigurationError]
- "providers_videoproviderrouter_videoproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/video/providers/VideoProviderRouter.ts:L7 | neighbors=[VideoProviderRouter]
- "providers_youtubedataapipublishprovider_configuredyoutubepublishprovider": "ConfiguredYouTubePublishProvider" | kind=code-symbol | neighbors=[YouTubeDataApiPublishProvider]
- "providers_youtubedataapipublishprovider_fetcher": "Fetcher" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L17 | neighbors=[YouTubeDataApiPublishProvider.ts]
- "providers_youtubedataapipublishprovider_youtubedataapipublishprovider_createimmutablepublishdispatchadapter": ".createImmutablePublishDispatchAdapter()" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubeDataApiPublishProvider.ts:L149 | neighbors=[YouTubeDataApiPublishProvider]
- "publish_youtubepublishpipeline_youtubepublisherror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L35 | neighbors=[YouTubePublishError]
- "publish_youtubepublishproviderconfig_youtubepublishproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderConfig.ts:L6 | neighbors=[YouTubePublishProviderConfigurationError]
- "publish_youtubepublishproviderrouter_youtubepublishproviderrouter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderRouter.ts:L11 | neighbors=[YouTubePublishProviderRouter]
- "publish_youtubepublishproviderrouter_youtubepublishproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderRouter.ts:L18 | neighbors=[YouTubePublishProviderRouter]
- "publish_youtubepublishvalidation_youtubepublishvalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L20 | neighbors=[YouTubePublishValidationError]
- "research_page_researchcard": "ResearchCard()" | kind=code-symbol | source=app/research/page.tsx:L148 | neighbors=[page.tsx]
- "research_page_researchlist": "ResearchList()" | kind=code-symbol | source=app/research/page.tsx:L167 | neighbors=[page.tsx]
- "research_page_researchpage": "ResearchPage()" | kind=code-symbol | source=app/research/page.tsx:L7 | neighbors=[page.tsx]
- "research_route_post": "POST()" | kind=code-symbol | source=app/api/research/route.ts:L5 | neighbors=[route.ts]
- "resume_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/resume/route.ts:L6 | neighbors=[route.ts]
- "retry_route_retryrequestbody": "RetryRequestBody" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L13 | neighbors=[route.ts]
- "retry_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L7 | neighbors=[route.ts]
- "retry_route_validstages": "validStages" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L17 | neighbors=[route.ts]
- "roadmap_sprint_129_24": "Sprint 129.24 - Existing Acceptance Marker Portability" | kind=entity | source=ROADMAP.md:807 | neighbors=[Sprint 128.2 - Production Acceptance P1…]
- "roadmap_sprint_129_25_b": "Sprint 129.25B - Runtime Root Abstraction & Tracking Policy Foundation" | kind=entity | source=ROADMAP.md:797 | neighbors=[Sprint 129.25B.1 - Targeted Runtime Sto…]
- "roadmap_sprint_129_30": "Sprint 129.30 - Failed-Terminal Evidence and Retry Boundary Hardening" | kind=entity | source=ROADMAP.md:643 | neighbors=[Sprint 129.29 - Failed-Terminal Settlem…]
- "roadmap_sprint_129_32": "Sprint 129.32 - Exact job.attempts Invariant for Failed Retry Durable Attempt S…" | kind=entity | source=ROADMAP.md:548 | neighbors=[Sprint 129.33 - Exhausted Retry Admissi…]
- "roadmap_sprint_129_43": "Sprint 129.43 - Fatih Documentary Live Audio & Assembly Production Run" | kind=entity | source=ROADMAP.md:159 | neighbors=[Sprint 129.41 - Canonical Completed-Sta…]
- "roadmap_sprint_130_2": "Sprint 130.2 - Real Photo Source Download Reliability & Latency Budget" | kind=entity | source=ROADMAP.md:4 | neighbors=[Sprint 130.1 - Real Photo Source Qualit…]
- "roadmap_sprint_131_plus": "Sprint 131+ - Additional Real Photo Sources (Planned)" | kind=entity | source=ROADMAP.md:77 | neighbors=[Sprint 130 - Wikimedia Commons Real Pho…]
- "roadmap_sprint_49": "Sprint 49 - Real AI Provider Integration Guardrails" | kind=entity | source=ROADMAP.md:1001 | neighbors=[Sprint 48 - Final Pipeline Integration]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-140.json

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
