# Node Description Batch 162 of 166

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

- "studio_projectstatuscards_projectstatuscards": "ProjectStatusCards()" | kind=code-symbol | source=src/components/studio/ProjectStatusCards.tsx:L7 | neighbors=[ProjectStatusCards.tsx]
- "studio_projectstatuscards_projectstatuscardsprops": "ProjectStatusCardsProps" | kind=code-symbol | source=src/components/studio/ProjectStatusCards.tsx:L3 | neighbors=[ProjectStatusCards.tsx]
- "studio_seopanel_info": "Info()" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L34 | neighbors=[SEOPanel.tsx]
- "studio_seopanel_listblock": "ListBlock()" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L54 | neighbors=[SEOPanel.tsx]
- "studio_seopanel_seopanel": "SEOPanel()" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L8 | neighbors=[SEOPanel.tsx]
- "studio_seopanel_seopanelprops": "SEOPanelProps" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L4 | neighbors=[SEOPanel.tsx]
- "studio_seopanel_tagblock": "TagBlock()" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L78 | neighbors=[SEOPanel.tsx]
- "studio_seopanel_textblock": "TextBlock()" | kind=code-symbol | source=src/components/studio/SEOPanel.tsx:L45 | neighbors=[SEOPanel.tsx]
- "studio_studiocard_studiocard": "StudioCard()" | kind=code-symbol | source=src/components/studio/StudioCard.tsx:L8 | neighbors=[StudioCard.tsx]
- "studio_studiocard_studiocardprops": "StudioCardProps" | kind=code-symbol | source=src/components/studio/StudioCard.tsx:L3 | neighbors=[StudioCard.tsx]
- "studio_studioheader_studioheader": "StudioHeader()" | kind=code-symbol | source=src/components/studio/StudioHeader.tsx:L6 | neighbors=[StudioHeader.tsx]
- "studio_studioheader_studioheaderprops": "StudioHeaderProps" | kind=code-symbol | source=src/components/studio/StudioHeader.tsx:L1 | neighbors=[StudioHeader.tsx]
- "studio_studiolayout_studiolayout": "StudioLayout()" | kind=code-symbol | source=src/components/studio/StudioLayout.tsx:L11 | neighbors=[StudioLayout.tsx]
- "studio_studiolayout_studiolayoutprops": "StudioLayoutProps" | kind=code-symbol | source=src/components/studio/StudioLayout.tsx:L5 | neighbors=[StudioLayout.tsx]
- "studio_studiosidebar_menuitems": "menuItems" | kind=code-symbol | source=src/components/studio/StudioSidebar.tsx:L3 | neighbors=[StudioSidebar.tsx]
- "studio_studiosidebar_studiosidebar": "StudioSidebar()" | kind=code-symbol | source=src/components/studio/StudioSidebar.tsx:L11 | neighbors=[StudioSidebar.tsx]
- "studio_thumbnailpanel_info": "Info()" | kind=code-symbol | source=src/components/studio/ThumbnailPanel.tsx:L38 | neighbors=[ThumbnailPanel.tsx]
- "studio_thumbnailpanel_textblock": "TextBlock()" | kind=code-symbol | source=src/components/studio/ThumbnailPanel.tsx:L49 | neighbors=[ThumbnailPanel.tsx]
- "studio_thumbnailpanel_thumbnailpanel": "ThumbnailPanel()" | kind=code-symbol | source=src/components/studio/ThumbnailPanel.tsx:L8 | neighbors=[ThumbnailPanel.tsx]
- "studio_thumbnailpanel_thumbnailpanelprops": "ThumbnailPanelProps" | kind=code-symbol | source=src/components/studio/ThumbnailPanel.tsx:L4 | neighbors=[ThumbnailPanel.tsx]
- "studio_videopanel_info": "Info()" | kind=code-symbol | source=src/components/studio/VideoPanel.tsx:L118 | neighbors=[VideoPanel.tsx]
- "studio_videopanel_videopanel": "VideoPanel()" | kind=code-symbol | source=src/components/studio/VideoPanel.tsx:L14 | neighbors=[VideoPanel.tsx]
- "studio_videopanel_videopanelprops": "VideoPanelProps" | kind=code-symbol | source=src/components/studio/VideoPanel.tsx:L8 | neighbors=[VideoPanel.tsx]
- "thumbnail_route_post": "POST()" | kind=code-symbol | source=app/api/thumbnail/route.ts:L7 | neighbors=[route.ts]
- "thumbnail_thumbnailassetpipeline_generatethumbnailassetinput": "GenerateThumbnailAssetInput" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L32 | neighbors=[ThumbnailAssetPipeline.ts]
- "thumbnail_thumbnailassetpipeline_mime_types": "MIME_TYPES" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L16 | neighbors=[ThumbnailAssetPipeline.ts]
- "thumbnail_thumbnailassetpipeline_thumbnailassetgenerationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L25 | neighbors=[ThumbnailAssetGenerationError]
- "thumbnail_thumbnailengine_generatethumbnailplaninput": "GenerateThumbnailPlanInput" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L13 | neighbors=[ThumbnailEngine.ts]
- "thumbnail_thumbnailengine_thumbnailengine_constructor": ".constructor()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L21 | neighbors=[ThumbnailEngine]
- "thumbnail_thumbnailproviderconfig_thumbnailproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderConfig.ts:L31 | neighbors=[ThumbnailProviderConfigurationError]
- "thumbnail_thumbnailproviderrouter_thumbnailproviderrouter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderRouter.ts:L11 | neighbors=[ThumbnailProviderRouter]
- "thumbnail_thumbnailproviderrouter_thumbnailproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderRouter.ts:L20 | neighbors=[ThumbnailProviderRouter]
- "thumbnail_thumbnailstorage_savedthumbnail": "SavedThumbnail" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L21 | neighbors=[ThumbnailStorage.ts]
- "types_airesponse_airesponseschemaissuereason": "AIResponseSchemaIssueReason" | kind=code-symbol | source=src/types/aiResponse.ts:L18 | neighbors=[aiResponse.ts]
- "types_aiusage_aiusagestage": "AIUsageStage" | kind=code-symbol | source=src/types/aiUsage.ts:L12 | neighbors=[aiUsage.ts]
- "types_animation_animationcrop": "AnimationCrop" | kind=code-symbol | source=src/types/animation.ts:L21 | neighbors=[animation.ts]
- "types_animation_animationstatus": "AnimationStatus" | kind=code-symbol | source=src/types/animation.ts:L1 | neighbors=[animation.ts]
- "types_animation_animationtransform": "AnimationTransform" | kind=code-symbol | source=src/types/animation.ts:L28 | neighbors=[animation.ts]
- "types_animationerror_animationschemaissuecode": "AnimationSchemaIssueCode" | kind=code-symbol | source=src/types/animationError.ts:L50 | neighbors=[animationError.ts]
- "types_assembly_assemblystatus": "AssemblyStatus" | kind=code-symbol | source=src/types/assembly.ts:L1 | neighbors=[assembly.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-161.json

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
