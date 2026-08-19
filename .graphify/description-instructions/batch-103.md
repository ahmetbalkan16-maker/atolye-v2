# Node Description Batch 104 of 166

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

- "publish_youtubepublishpipeline_validatestoredpackage": "validateStoredPackage()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishPipeline.ts:L220 | neighbors=[YouTubePublishPipeline.ts, .publishStoredPackage()]
- "publish_youtubepublishproviderconfig_youtubepublishproviderconfig": "youtubePublishProviderConfig" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderConfig.ts:L13 | neighbors=[YouTubeDataApiPublishProvider.ts, YouTubePublishProviderConfig.ts]
- "publish_youtubepublishvalidation_timestamp": "timestamp()" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishValidation.ts:L235 | neighbors=[YouTubePublishValidation.ts, validateYouTubePublishRecord()]
- "resume_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/resume/route.ts:L78 | neighbors=[route.ts, POST()]
- "resume_route_post": "POST()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/resume/route.ts:L12 | neighbors=[route.ts, isSafeSlug()]
- "retry_route_ispipelinestage": "isPipelineStage()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L134 | neighbors=[route.ts, POST()]
- "retry_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L141 | neighbors=[route.ts, POST()]
- "retry_route_readretrybody": "readRetryBody()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/retry/route.ts:L120 | neighbors=[route.ts, POST()]
- "roadmap_adr_019": "ADR-019: Single 'real' Image Provider with Source Router" | kind=entity | source=ROADMAP.md:56 | neighbors=[RealPhotoImageProvider, Sprint 130 - Wikimedia Commons Real Pho…]
- "roadmap_real_photo_image_provider": "RealPhotoImageProvider" | kind=entity | source=ROADMAP.md:58 | neighbors=[ADR-019: Single 'real' Image Provider w…, WikimediaCommonsClient]
- "roadmap_runtime_backup_v3": "Runtime Backup Long-Path, V3 Runtime Authority & Trusted Backup Root" | kind=entity | source=ROADMAP.md:673 | neighbors=[Sprint 129.28 - Production Acceptance R…, Sprint 129.29 - Failed-Terminal Settlem…]
- "roadmap_sprint_100": "Sprint 100 - Durable Lease & Worker Ownership Foundation" | kind=entity | source=ROADMAP.md:1873 | neighbors=[Sprint 99.1 - Durable Storage Recovery …, Sprint 101 - Durable Execution Claim & …]
- "roadmap_sprint_101": "Sprint 101 - Durable Execution Claim & Recovery Coordination" | kind=entity | source=ROADMAP.md:1893 | neighbors=[Sprint 100 - Durable Lease & Worker Own…, Sprint 102 - Durable Execution Attempt …]
- "roadmap_sprint_102": "Sprint 102 - Durable Execution Attempt & Outcome Journal Foundation" | kind=entity | source=ROADMAP.md:1912 | neighbors=[Sprint 101 - Durable Execution Claim & …, Sprint 103 - Production Execution Coord…]
- "roadmap_sprint_103": "Sprint 103 - Production Execution Coordinator Foundation" | kind=entity | source=ROADMAP.md:1930 | neighbors=[Sprint 102 - Durable Execution Attempt …, Sprint 104 - Durable Attempt Lifecycle …]
- "roadmap_sprint_104": "Sprint 104 - Durable Attempt Lifecycle Foundation" | kind=entity | source=ROADMAP.md:1947 | neighbors=[Sprint 103 - Production Execution Coord…, Sprint 105 - Durable Worker Execution F…]
- "roadmap_sprint_105": "Sprint 105 - Durable Worker Execution Foundation" | kind=entity | source=ROADMAP.md:1964 | neighbors=[Sprint 104 - Durable Attempt Lifecycle …, Sprint 106 - Pipeline Stage Durable Exe…]
- "roadmap_sprint_106": "Sprint 106 - Pipeline Stage Durable Execution Integration" | kind=entity | source=ROADMAP.md:1982 | neighbors=[Sprint 105 - Durable Worker Execution F…, Sprint 107 - Durable Pipeline Compositi…]
- "roadmap_sprint_107": "Sprint 107 - Durable Pipeline Composition Root Wiring" | kind=entity | source=ROADMAP.md:1999 | neighbors=[Sprint 106 - Pipeline Stage Durable Exe…, Sprint 108 - Durable Recovery Bootstrap…]
- "roadmap_sprint_108": "Sprint 108 - Durable Recovery Bootstrap Integration" | kind=entity | source=ROADMAP.md:2017 | neighbors=[Sprint 107 - Durable Pipeline Compositi…, Sprint 109 - Process Startup Bootstrap …]
- "roadmap_sprint_109": "Sprint 109 - Process Startup Bootstrap Integration" | kind=entity | source=ROADMAP.md:2036 | neighbors=[Sprint 108 - Durable Recovery Bootstrap…, Sprint 110 - Production Worker Lifecycle]
- "roadmap_sprint_110": "Sprint 110 - Production Worker Lifecycle" | kind=entity | source=ROADMAP.md:2056 | neighbors=[Sprint 109 - Process Startup Bootstrap …, Sprint 112 - Production Runtime Health …]
- "roadmap_sprint_112": "Sprint 112 - Production Runtime Health API" | kind=entity | source=ROADMAP.md:2095 | neighbors=[Sprint 110 - Production Worker Lifecycle, Sprint 113 - Production Visual Asset Pi…]
- "roadmap_sprint_113": "Sprint 113 - Production Visual Asset Pipeline Activation" | kind=entity | source=ROADMAP.md:2113 | neighbors=[Sprint 112 - Production Runtime Health …, Sprint 114 - Production Narration Audio…]
- "roadmap_sprint_118": "Sprint 118 - Assembly Scene-Video Consumption" | kind=entity | source=ROADMAP.md:2227 | neighbors=[Sprint 117 - Production Scene Video Ren…, Sprint 119 - Pipeline Retry Continuatio…]
- "roadmap_sprint_119": "Sprint 119 - Pipeline Retry Continuation Hardening" | kind=entity | source=ROADMAP.md:2251 | neighbors=[Sprint 118 - Assembly Scene-Video Consu…, Sprint 120 - Production Thumbnail Pipel…]
- "roadmap_sprint_120": "Sprint 120 - Production Thumbnail Pipeline Activation" | kind=entity | source=ROADMAP.md:2270 | neighbors=[Sprint 119 - Pipeline Retry Continuatio…, Sprint 121 - Production YouTube Package…]
- "roadmap_sprint_121": "Sprint 121 - Production YouTube Package Pipeline Activation" | kind=entity | source=ROADMAP.md:2293 | neighbors=[Sprint 120 - Production Thumbnail Pipel…, Sprint 122 - Production YouTube Publish…]
- "roadmap_sprint_122": "Sprint 122 - Production YouTube Publish Pipeline Foundation" | kind=entity | source=ROADMAP.md:2317 | neighbors=[Sprint 121 - Production YouTube Package…, Sprint 123 - Production End-to-End Stab…]
- "roadmap_sprint_123": "Sprint 123 - Production End-to-End Stabilization" | kind=entity | source=ROADMAP.md:2343 | neighbors=[Sprint 122 - Production YouTube Publish…, Sprint 124 - Production Publish Reconci…]
- "roadmap_sprint_124": "Sprint 124 - Production Publish Reconciliation Hardening" | kind=entity | source=ROADMAP.md:2369 | neighbors=[Sprint 123 - Production End-to-End Stab…, Sprint 125 - Production End-to-End Vali…]
- "roadmap_sprint_125": "Sprint 125 - Production End-to-End Validation" | kind=entity | source=ROADMAP.md:2395 | neighbors=[Sprint 124 - Production Publish Reconci…, Sprint 126 - Real Production Acceptance…]
- "roadmap_sprint_129": "Sprint 129 - Production Environment Binding and Readiness-Only Machine Validati…" | kind=entity | source=ROADMAP.md:2506 | neighbors=[Sprint 128.2 - Production Acceptance P1…, Sprint 129.5 - Production Acceptance To…]
- "roadmap_sprint_129_21": "Sprint 129.21 - Animation Failure Propagation & Diagnostic Hardening" | kind=entity | source=ROADMAP.md:840 | neighbors=[Sprint 129.20 - Visuals Truncation Prop…, Sprint 129.22 - Animation Structured Ou…]
- "roadmap_sprint_129_22": "Sprint 129.22 - Animation Structured Output Diagnosis and Hardening" | kind=entity | source=ROADMAP.md:827 | neighbors=[Sprint 129.19 - Visuals Structured Outp…, Sprint 129.21 - Animation Failure Propa…]
- "roadmap_sprint_129_25_b1": "Sprint 129.25B.1 - Targeted Runtime Storage Hardening" | kind=entity | source=ROADMAP.md:787 | neighbors=[Sprint 129.25B - Runtime Root Abstracti…, Sprint 129.25 C.1 - Verified Runtime Ba…]
- "roadmap_sprint_129_25_c1": "Sprint 129.25 C.1 - Verified Runtime Backup Foundation" | kind=entity | source=ROADMAP.md:775 | neighbors=[Sprint 129.25B.1 - Targeted Runtime Sto…, Sprint 129.25 C.2A - Guarded Filesystem…]
- "roadmap_sprint_129_25_c2b1": "Sprint 129.25 C.2B.1 - Migration Candidate Schema, Preflight & Verifier" | kind=entity | source=ROADMAP.md:754 | neighbors=[Sprint 129.25 C.2A - Guarded Filesystem…, Sprint 129.25 C.2B.2 - Verified Migrati…]
- "roadmap_sprint_129_25_c2b2": "Sprint 129.25 C.2B.2 - Verified Migration Candidate Creation" | kind=entity | source=ROADMAP.md:742 | neighbors=[Sprint 129.25 C.2B.1 - Migration Candid…, Sprint 129.25 C.2B.3 - Production Stora…]
- "roadmap_sprint_129_25_c2b3": "Sprint 129.25 C.2B.3 - Production Storage Relocation Audit" | kind=entity | source=ROADMAP.md:732 | neighbors=[Sprint 129.25 C.2B.2 - Verified Migrati…, Sprint 129.25 C.2B.4 - Operation-Scoped…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-103.json

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
