# Node Description Batch 166 of 166

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

- "visuals_visualmanager_visualmanagerinput": "VisualManagerInput" | kind=code-symbol | source=src/lib/visuals/VisualManager.ts:L26 | neighbors=[VisualManager.ts]
- "visuals_visualpromptengine_visualpromptengine_createprompt": ".createPrompt()" | kind=code-symbol | source=src/lib/visuals/VisualPromptEngine.ts:L4 | neighbors=[VisualPromptEngine]
- "youtube_youtubeengine_generateyoutubepackageinput": "GenerateYouTubePackageInput" | kind=code-symbol | source=src/lib/youtube/YouTubeEngine.ts:L8 | neighbors=[YouTubeEngine.ts]
- "youtube_youtubeengine_youtubeengine_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/YouTubeEngine.ts:L13 | neighbors=[YouTubeEngine]
- "youtube_youtubeengine_youtubeengine_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=src/lib/youtube/YouTubeEngine.ts:L15 | neighbors=[YouTubeEngine]
- "youtube_youtubepackagepipeline_generateyoutubepackageinput": "GenerateYouTubePackageInput" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L33 | neighbors=[YouTubePackagePipeline.ts]
- "youtube_youtubepackagepipeline_youtubepackagegenerationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/YouTubePackagePipeline.ts:L26 | neighbors=[YouTubePackageGenerationError]
- "youtube_youtubepackagevalidation_youtubepackagevalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/YouTubePackageValidation.ts:L25 | neighbors=[YouTubePackageValidationError]
- "youtube_youtubeproviderconfig_youtubeproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderConfig.ts:L9 | neighbors=[YouTubeProviderConfigurationError]
- "youtube_youtubeproviderrouter_youtubeproviderrouter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderRouter.ts:L10 | neighbors=[YouTubeProviderRouter]
- "youtube_youtubeproviderrouter_youtubeproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/youtube/YouTubeProviderRouter.ts:L19 | neighbors=[YouTubeProviderRouter]
- "027627be_image": "Ottoman Supply Depot and Chain Hauling at the Shore" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/027627be-4070-4b62-85dc-2988ef4e101d.png
- "258a070a_image": "Ottoman Military Preparation Montage" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/258a070a-49a2-4074-afab-d5eab1190e05.png
- "3206e749_image": "Fatih Sultan Mehmet Fetih Haritasını İnceliyor" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/3206e749-5cc3-4dfb-b4d6-4d4476bf31ce.png
- "adr_doc": "ARCHITECTURE_DECISIONS.md (ADR Log)" | kind=entity | source=ARCHITECTURE_DECISIONS.md
- "agents_doc": "AGENTS.md" | kind=entity | source=AGENTS.md
- "b4379818_war_council_meeting": "Ottoman War Council Planning Meeting" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/b4379818-5109-4bc8-953a-c33674a16f4f.png
- "bb72b4af_image": "Top Dökümü ve Kuşatma Kulesi İnşası Görseli" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/bb72b4af-732b-46bd-9acb-916c879afb57.png
- "claudemd_doc": "CLAUDE.md" | kind=entity | source=CLAUDE.md
- "codingstandards_doc": "docs/CodingStandards.md" | kind=entity | source=docs/CodingStandards.md
- "devstandard_doc": "DEVELOPMENT_STANDARD.md" | kind=entity | source=DEVELOPMENT_STANDARD.md
- "docsdecisions_doc": "docs/Decisions.md" | kind=entity | source=docs/Decisions.md
- "docstandard_doc": "DOCUMENTATION_STANDARD.md" | kind=entity | source=DOCUMENTATION_STANDARD.md
- "f3da6631_image": "Ottoman Army Marching Toward City Walls" | kind=entity | source=data/projects/fatih-sultan-mehmet-in-i-stanbul-un-fethine-hazirlanisi-cfe77fd8-8350-4415-bc87-211e3d36c4d5/assets/images/f3da6631-23cb-49fd-9f5c-2df5478f36d4.png
- "file_svg_icon": "File Icon (Next.js boilerplate)" | kind=entity | source=public/file.svg
- "globe_icon": "Globe Icon (Next.js Boilerplate)" | kind=entity | source=public/globe.svg
- "next_svg_nextjs_logo_icon": "Next.js Logo Icon (Boilerplate)" | kind=entity | source=public/next.svg
- "pipeline_pipelinecontext": "PipelineContext.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineContext.ts:L1
- "pipeline_pipelinestatus": "PipelineStatus.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineStatus.ts:L1
- "pipeline_pipelinestore": "PipelineStore.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineStore.ts:L1
- "providers_grokprovider": "GrokProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/GrokProvider.ts:L1
- "readme_doc": "README.md" | kind=entity | source=README.md
- "sprint14_doc": "docs/Sprint-14.md" | kind=entity | source=docs/Sprint-14.md
- "sprinttemplate_doc": "SPRINT_TEMPLATE.md" | kind=entity | source=SPRINT_TEMPLATE.md
- "storageaudit_doc": "docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md" | kind=entity | source=docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md
- "types_voice": "voice.ts" | kind=code-symbol | source=src/types/voice.ts:L1
- "vercel_svg_logo_icon": "Vercel Logo Icon (Next.js Boilerplate)" | kind=entity | source=public/vercel.svg
- "window_svg_icon": "Window Icon (Next.js Boilerplate)" | kind=entity | source=public/window.svg

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-165.json

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
