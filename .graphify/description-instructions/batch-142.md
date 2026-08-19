# Node Description Batch 143 of 166

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

- "scripts_run_canonical_smoke_validation_harness": "Harness" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L9 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_run_canonical_smoke_validation_harnesses": "harnesses" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L13 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_run_canonical_smoke_validation_inventoryentry": "InventoryEntry" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L104 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_run_canonical_smoke_validation_migratedorder": "migratedOrder" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L24 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_runtime_backup_repositoryroot": "repositoryRoot" | kind=code-symbol | source=scripts/runtime-backup.ts:L13 | neighbors=[runtime-backup.ts]
- "scripts_smoke_animation_motion_plan_contract_animationscene": "animationScene()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L54 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_expectrejectedwithoutassetwrite": "expectRejectedWithoutAssetWrite()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L128 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_main": "main()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L496 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_mockimage": "mockImage()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L63 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_provider": "provider()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L112 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_runnerharness": "RunnerHarness" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L33 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_animation_motion_plan_contract_valid": "valid()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L124 | neighbors=[smoke-animation-motion-plan-contract.ts]
- "scripts_smoke_assembly_scene_video_consumption_main": "main()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L489 | neighbors=[smoke-assembly-scene-video-consumption.…]
- "scripts_smoke_assembly_scene_video_consumption_originalenvironment": "originalEnvironment" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L40 | neighbors=[smoke-assembly-scene-video-consumption.…]
- "scripts_smoke_assembly_scene_video_consumption_runner_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L123 | neighbors=[Runner]
- "scripts_smoke_assembly_scene_video_consumption_scenes": "scenes" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L46 | neighbors=[smoke-assembly-scene-video-consumption.…]
- "scripts_smoke_assembly_scene_video_consumption_script": "script" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L64 | neighbors=[smoke-assembly-scene-video-consumption.…]
- "scripts_smoke_assembly_scene_video_consumption_videoassemblyprocessrunner": "VideoAssemblyProcessRunner" | kind=code-symbol | neighbors=[Runner]
- "scripts_smoke_assembly_scene_video_consumption_visuals": "visuals" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L53 | neighbors=[smoke-assembly-scene-video-consumption.…]
- "scripts_smoke_canonical_smoke_runtime_foundation_descriptoradapter": "descriptorAdapter()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L316 | neighbors=[smoke-canonical-smoke-runtime-foundatio…]
- "scripts_smoke_canonical_smoke_runtime_foundation_descriptorroot": "descriptorRoot()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L310 | neighbors=[smoke-canonical-smoke-runtime-foundatio…]
- "scripts_smoke_canonical_smoke_runtime_foundation_hosttemproot": "hostTempRoot" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L18 | neighbors=[smoke-canonical-smoke-runtime-foundatio…]
- "scripts_smoke_canonical_smoke_runtime_foundation_readchildworkspace": "readChildWorkspace()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L291 | neighbors=[smoke-canonical-smoke-runtime-foundatio…]
- "scripts_smoke_canonical_smoke_runtime_foundation_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L19 | neighbors=[smoke-canonical-smoke-runtime-foundatio…]
- "scripts_smoke_pipeline_auto_continuation_historyfile": "historyFile" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L35 | neighbors=[smoke-pipeline-auto-continuation.ts]
- "scripts_smoke_pipeline_auto_continuation_jobsfile": "jobsFile" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L34 | neighbors=[smoke-pipeline-auto-continuation.ts]
- "scripts_smoke_pipeline_auto_continuation_pipelineexecutorharness": "PipelineExecutorHarness" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L26 | neighbors=[smoke-pipeline-auto-continuation.ts]
- "scripts_smoke_pipeline_auto_continuation_pipelinerunnerharness": "PipelineRunnerHarness" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L27 | neighbors=[smoke-pipeline-auto-continuation.ts]
- "scripts_smoke_pipeline_auto_continuation_projectfolder": "projectFolder" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L33 | neighbors=[smoke-pipeline-auto-continuation.ts]
- "scripts_smoke_pipeline_history_persistence_main": "main()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L223 | neighbors=[smoke-pipeline-history-persistence.ts]
- "scripts_smoke_pipeline_orchestration_main": "main()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L331 | neighbors=[smoke-pipeline-orchestration.ts]
- "scripts_smoke_pipeline_retry_continuation_hardening_executorharness": "ExecutorHarness" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L42 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_job": "job()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L62 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_main": "main()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L103 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_order": "order" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L51 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_readjobs": "readJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L95 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_readylifecycle": "readyLifecycle()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L539 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_runnerharness": "RunnerHarness" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L25 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_retry_continuation_hardening_stagejob": "stageJob()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L99 | neighbors=[smoke-pipeline-retry-continuation-harde…]
- "scripts_smoke_pipeline_state_corruption_historyfile": "historyFile" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L15 | neighbors=[smoke-pipeline-state-corruption.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-142.json

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
