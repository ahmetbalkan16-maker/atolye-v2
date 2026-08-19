# Node Description Batch 151 of 166

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

- "scripts_smoke_production_scene_video_rendering_main": "main()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L880 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_png": "png" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L64 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_provider": "provider()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L194 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_readfirstframe": "readFirstFrame()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L294 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_renderingrunner_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L396 | neighbors=[RenderingRunner]
- "scripts_smoke_production_scene_video_rendering_runnerharness": "RunnerHarness" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L51 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_validmock": "validMock()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L208 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_videoassemblychildprocess": "VideoAssemblyChildProcess" | kind=code-symbol | neighbors=[FakeChild]
- "scripts_smoke_production_snapshot_builder_comparetext": "compareText()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L405 | neighbors=[smoke-production-snapshot-builder.ts]
- "scripts_smoke_production_snapshot_builder_main": "main()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L294 | neighbors=[smoke-production-snapshot-builder.ts]
- "scripts_smoke_production_thumbnail_pipeline_injectedprovider": "injectedProvider()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L136 | neighbors=[smoke-production-thumbnail-pipeline.ts]
- "scripts_smoke_production_thumbnail_pipeline_main": "main()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L742 | neighbors=[smoke-production-thumbnail-pipeline.ts]
- "scripts_smoke_production_thumbnail_pipeline_resolveruntimelogicalpath": "resolveRuntimeLogicalPath()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L784 | neighbors=[smoke-production-thumbnail-pipeline.ts]
- "scripts_smoke_production_thumbnail_pipeline_thumbnailfiles": "thumbnailFiles()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L260 | neighbors=[smoke-production-thumbnail-pipeline.ts]
- "scripts_smoke_production_video_assembly_wiring_assembly": "assembly" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L164 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_baseaudio": "baseAudio" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L137 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_childprocess": "childProcess()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L307 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_controlledchild_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L286 | neighbors=[ControlledChild]
- "scripts_smoke_production_video_assembly_wiring_controlledchild_kill": ".kill()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L292 | neighbors=[ControlledChild]
- "scripts_smoke_production_video_assembly_wiring_controlledchild_unref": ".unref()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L302 | neighbors=[ControlledChild]
- "scripts_smoke_production_video_assembly_wiring_eventemitter": "EventEmitter" | kind=code-symbol | neighbors=[ControlledChild]
- "scripts_smoke_production_video_assembly_wiring_fakerunner_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L240 | neighbors=[FakeRunner]
- "scripts_smoke_production_video_assembly_wiring_issafeprocesserror": "isSafeProcessError()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L311 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_main": "main()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L1341 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_originalenvironment": "originalEnvironment" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L89 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_pipelinerunner": "pipelineRunner" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L119 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_pipelinerunnerinternals": "PipelineRunnerInternals" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L100 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_replacedirectorywithexternaljunction": "replaceDirectoryWithExternalJunction()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L381 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_resolveruntimelogicalpath": "resolveRuntimeLogicalPath()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L198 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_scenes": "scenes" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L121 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_videoassemblyprocessrunner": "VideoAssemblyProcessRunner" | kind=code-symbol | neighbors=[FakeRunner]
- "scripts_smoke_production_video_assembly_wiring_visuals": "visuals" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L128 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_video_assembly_wiring_withprojectsrootjunction": "withProjectsRootJunction()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L397 | neighbors=[smoke-production-video-assembly-wiring.…]
- "scripts_smoke_production_visual_asset_wiring_assertorderedsubsequence": "assertOrderedSubsequence()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L1055 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_createsuccessresult": "createSuccessResult()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L158 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_issafevisualasseterror": "isSafeVisualAssetError()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L271 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_main": "main()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L1065 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_pipelinerunnerinternals": "PipelineRunnerInternals" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L102 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_runner": "runner" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L121 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_setimageprovider": "setImageProvider()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L133 | neighbors=[smoke-production-visual-asset-wiring.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-150.json

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
