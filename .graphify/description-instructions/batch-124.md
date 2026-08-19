# Node Description Batch 125 of 166

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

- "app_layout_rootlayout": "RootLayout()" | kind=code-symbol | source=app/layout.tsx:L9 | neighbors=[layout.tsx]
- "app_page_page": "Page()" | kind=code-symbol | source=app/page.tsx:L3 | neighbors=[page.tsx]
- "assembly_assemblyaiconfig_assemblyaiconfigerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assembly/AssemblyAIConfig.ts:L11 | neighbors=[AssemblyAIConfigError]
- "assembly_assemblyaiconfig_assemblytokenbudget": "assemblyTokenBudget" | kind=code-symbol | source=src/lib/assembly/AssemblyAIConfig.ts:L1 | neighbors=[AssemblyAIConfig.ts]
- "assembly_assemblymanager_assemblymanager_findaudiosection": ".findAudioSection()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L281 | neighbors=[AssemblyManager]
- "assembly_assemblymanager_assemblymanager_findchapter": ".findChapter()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L264 | neighbors=[AssemblyManager]
- "assembly_assemblymanager_assemblymanager_findvideoscene": ".findVideoScene()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L293 | neighbors=[AssemblyManager]
- "assembly_assemblymanager_assemblymanager_findvisual": ".findVisual()" | kind=code-symbol | source=src/lib/assembly/AssemblyManager.ts:L273 | neighbors=[AssemblyManager]
- "assembly_route_post": "POST()" | kind=code-symbol | source=app/api/assembly/route.ts:L12 | neighbors=[route.ts]
- "assembly_videoassemblymanager_image_mime_types": "IMAGE_MIME_TYPES" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L31 | neighbors=[VideoAssemblyManager.ts]
- "assembly_videoassemblymanager_renderexistingassetsinput": "RenderExistingAssetsInput" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L47 | neighbors=[VideoAssemblyManager.ts]
- "assembly_videoassemblymanager_videoassemblyerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L40 | neighbors=[VideoAssemblyError]
- "assets_assetgallery_assetgalleryprops": "AssetGalleryProps" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L11 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_assetgroup": "AssetGroup" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L25 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_assetgrouplist": "AssetGroupList()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L425 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_assetpreviewfallback": "AssetPreviewFallback()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L578 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_assetsresponse": "AssetsResponse" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L19 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_buildactiveassetidmap": "buildActiveAssetIdMap()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L638 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_fetchprojectassets": "fetchProjectAssets()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L33 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_getgroupsortvalue": "getGroupSortValue()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L692 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_getgrouptitle": "getGroupTitle()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L684 | neighbors=[AssetGallery.tsx]
- "assets_assetgallery_info": "Info()" | kind=code-symbol | source=src/components/assets/AssetGallery.tsx:L591 | neighbors=[AssetGallery.tsx]
- "assets_assetmanager_assetmanager_createasset": ".createAsset()" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L81 | neighbors=[AssetManager]
- "assets_assetmanager_assetpatch": "AssetPatch" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L16 | neighbors=[AssetManager.ts]
- "assets_assetmanager_createassetinput": "CreateAssetInput" | kind=code-symbol | source=src/lib/assets/AssetManager.ts:L10 | neighbors=[AssetManager.ts]
- "assets_route_get": "GET()" | kind=code-symbol | source=app/api/assets/route.ts:L7 | neighbors=[route.ts]
- "assets_visualassetpipeline_generateassetsinput": "GenerateAssetsInput" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L33 | neighbors=[VisualAssetPipeline.ts]
- "assets_visualassetpipeline_normalizedgenerationresult": "NormalizedGenerationResult" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L47 | neighbors=[VisualAssetPipeline.ts]
- "assets_visualassetpipeline_safe_image_mime_types": "SAFE_IMAGE_MIME_TYPES" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L17 | neighbors=[VisualAssetPipeline.ts]
- "assets_visualassetpipeline_visualassetgenerationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/VisualAssetPipeline.ts:L26 | neighbors=[VisualAssetGenerationError]
- "assets_visualpromptpreview_visualpromptpreview": "VisualPromptPreview()" | kind=code-symbol | source=src/components/assets/VisualPromptPreview.tsx:L13 | neighbors=[VisualPromptPreview.tsx]
- "assets_visualpromptpreview_visualpromptpreviewprops": "VisualPromptPreviewProps" | kind=code-symbol | source=src/components/assets/VisualPromptPreview.tsx:L5 | neighbors=[VisualPromptPreview.tsx]
- "audio_audioasseterror_audioasseterrormetadata": "AudioAssetErrorMetadata" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L34 | neighbors=[AudioAssetError.ts]
- "audio_audioasseterror_audiocanonicaladmissionconflicterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L62 | neighbors=[AudioCanonicalAdmissionConflictError]
- "audio_audioasseterror_evidence_keys": "EVIDENCE_KEYS" | kind=code-symbol | source=src/lib/audio/AudioAssetError.ts:L17 | neighbors=[AudioAssetError.ts]
- "audio_audiocompensationstore_audiocompensationbacklogsaturatederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L148 | neighbors=[AudioCompensationBacklogSaturatedError]
- "audio_audiocompensationstore_audiocompensationlifecyclestatus": "AudioCompensationLifecycleStatus" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L57 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_audiocompensationretirementplan": "AudioCompensationRetirementPlan" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L176 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_audiocompensationstate": "AudioCompensationState" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L122 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_audiocompensationstoreerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L139 | neighbors=[AudioCompensationStoreError]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-124.json

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
