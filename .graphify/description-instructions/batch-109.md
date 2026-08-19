# Node Description Batch 110 of 166

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

- "scripts_smoke_production_recovery_bootstrap_mutation": "mutation()" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L38 | neighbors=[smoke-production-recovery-bootstrap.ts, main()]
- "scripts_smoke_production_recovery_bootstrap_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L37 | neighbors=[smoke-production-recovery-bootstrap.ts, main()]
- "scripts_smoke_production_recovery_bootstrap_snapshot": "snapshot()" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L39 | neighbors=[smoke-production-recovery-bootstrap.ts, main()]
- "scripts_smoke_production_runtime_health_api_main": "main()" | kind=code-symbol | source=scripts/smoke-production-runtime-health-api.ts:L42 | neighbors=[smoke-production-runtime-health-api.ts, runtimeStatus()]
- "scripts_smoke_production_runtime_health_api_runtimestatus": "runtimeStatus()" | kind=code-symbol | source=scripts/smoke-production-runtime-health-api.ts:L9 | neighbors=[smoke-production-runtime-health-api.ts, main()]
- "scripts_smoke_production_runtime_startup_attempt": "attempt()" | kind=code-symbol | source=scripts/smoke-production-runtime-startup.ts:L8 | neighbors=[smoke-production-runtime-startup.ts, main()]
- "scripts_smoke_production_runtime_startup_bootstrap": "bootstrap()" | kind=code-symbol | source=scripts/smoke-production-runtime-startup.ts:L9 | neighbors=[smoke-production-runtime-startup.ts, main()]
- "scripts_smoke_production_runtime_startup_dependencies": "dependencies()" | kind=code-symbol | source=scripts/smoke-production-runtime-startup.ts:L10 | neighbors=[smoke-production-runtime-startup.ts, main()]
- "scripts_smoke_production_runtime_status_bootstrap": "bootstrap()" | kind=code-symbol | source=scripts/smoke-production-runtime-status.ts:L14 | neighbors=[smoke-production-runtime-status.ts, main()]
- "scripts_smoke_production_runtime_status_main": "main()" | kind=code-symbol | source=scripts/smoke-production-runtime-status.ts:L28 | neighbors=[smoke-production-runtime-status.ts, bootstrap()]
- "scripts_smoke_production_scene_video_rendering_assertcolor": "assertColor()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L366 | neighbors=[smoke-production-scene-video-rendering.…, assertFullFrameMarkers()]
- "scripts_smoke_production_scene_video_rendering_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L277 | neighbors=[smoke-production-scene-video-rendering.…, pngChunk()]
- "scripts_smoke_production_scene_video_rendering_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L105 | neighbors=[smoke-production-scene-video-rendering.…, plan()]
- "scripts_smoke_production_scene_video_rendering_frame": "frame()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L73 | neighbors=[smoke-production-scene-video-rendering.…, plan()]
- "scripts_smoke_production_scene_video_rendering_markedpng": "markedPng()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L233 | neighbors=[smoke-production-scene-video-rendering.…, pngChunk()]
- "scripts_smoke_production_scene_video_rendering_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L212 | neighbors=[smoke-production-scene-video-rendering.…, .run()]
- "scripts_smoke_production_scene_video_rendering_pixel": "pixel()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L361 | neighbors=[smoke-production-scene-video-rendering.…, assertFullFrameMarkers()]
- "scripts_smoke_production_scene_video_rendering_renderingrunner_run": ".run()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L397 | neighbors=[RenderingRunner, mp4()]
- "scripts_smoke_production_scene_video_rendering_run": "run()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L428 | neighbors=[smoke-production-scene-video-rendering.…, scenario()]
- "scripts_smoke_production_scene_video_rendering_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L67 | neighbors=[smoke-production-scene-video-rendering.…, run()]
- "scripts_smoke_production_scene_video_rendering_videoassemblyprocessrunner": "VideoAssemblyProcessRunner" | kind=code-symbol | neighbors=[ActualProcessRunner, RenderingRunner]
- "scripts_smoke_production_snapshot_builder_capturefiles": "captureFiles()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L391 | neighbors=[smoke-production-snapshot-builder.ts, verifyFilesystemReadOnly()]
- "scripts_smoke_production_snapshot_builder_clonebundle": "cloneBundle()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L181 | neighbors=[smoke-production-snapshot-builder.ts, run()]
- "scripts_smoke_production_snapshot_builder_historyevent": "historyEvent()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L100 | neighbors=[smoke-production-snapshot-builder.ts, history()]
- "scripts_smoke_production_snapshot_builder_job": "job()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L74 | neighbors=[smoke-production-snapshot-builder.ts, run()]
- "scripts_smoke_production_snapshot_builder_writejson": "writeJson()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L383 | neighbors=[smoke-production-snapshot-builder.ts, verifyFilesystemReadOnly()]
- "scripts_smoke_production_snapshot_contract_main": "main()" | kind=code-symbol | source=scripts/smoke-production-snapshot-contract.ts:L47 | neighbors=[smoke-production-snapshot-contract.ts, stageFixture()]
- "scripts_smoke_production_snapshot_contract_notrecorded": "notRecorded()" | kind=code-symbol | source=scripts/smoke-production-snapshot-contract.ts:L19 | neighbors=[smoke-production-snapshot-contract.ts, stageFixture()]
- "scripts_smoke_production_thumbnail_pipeline_audiodata": "audioData()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L279 | neighbors=[smoke-production-thumbnail-pipeline.ts, pipelineFixture()]
- "scripts_smoke_production_thumbnail_pipeline_box": "box()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L233 | neighbors=[smoke-production-thumbnail-pipeline.ts, createProductionAssembly()]
- "scripts_smoke_production_thumbnail_pipeline_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L249 | neighbors=[smoke-production-thumbnail-pipeline.ts, rewritePngDimensions()]
- "scripts_smoke_production_thumbnail_pipeline_expectfailure": "expectFailure()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L184 | neighbors=[smoke-production-thumbnail-pipeline.ts, generate()]
- "scripts_smoke_production_thumbnail_pipeline_rewritepngdimensions": "rewritePngDimensions()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L241 | neighbors=[smoke-production-thumbnail-pipeline.ts, crc32()]
- "scripts_smoke_production_thumbnail_pipeline_run": "run()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L304 | neighbors=[smoke-production-thumbnail-pipeline.ts, scenario()]
- "scripts_smoke_production_thumbnail_pipeline_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L61 | neighbors=[smoke-production-thumbnail-pipeline.ts, run()]
- "scripts_smoke_production_thumbnail_pipeline_videodata": "videoData()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L269 | neighbors=[smoke-production-thumbnail-pipeline.ts, pipelineFixture()]
- "scripts_smoke_production_video_assembly_wiring_box": "box()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L221 | neighbors=[smoke-production-video-assembly-wiring.…, mp4()]
- "scripts_smoke_production_video_assembly_wiring_expectfailure": "expectFailure()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L423 | neighbors=[smoke-production-video-assembly-wiring.…, fixture()]
- "scripts_smoke_production_video_assembly_wiring_fakerunner_run": ".run()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L245 | neighbors=[FakeRunner, mp4()]
- "scripts_smoke_production_video_assembly_wiring_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L185 | neighbors=[smoke-production-video-assembly-wiring.…, run()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-109.json

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
