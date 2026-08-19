# Node Description Batch 144 of 166

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

- "scripts_smoke_pipeline_state_corruption_jobsfile": "jobsFile" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L14 | neighbors=[smoke-pipeline-state-corruption.ts]
- "scripts_smoke_pipeline_state_corruption_projectfolder": "projectFolder" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L13 | neighbors=[smoke-pipeline-state-corruption.ts]
- "scripts_smoke_pipeline_state_corruption_validhistory": "validHistory" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L38 | neighbors=[smoke-pipeline-state-corruption.ts]
- "scripts_smoke_pipeline_state_corruption_validjob": "validJob" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L18 | neighbors=[smoke-pipeline-state-corruption.ts]
- "scripts_smoke_pipeline_state_corruption_validjobs": "validJobs" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L31 | neighbors=[smoke-pipeline-state-corruption.ts]
- "scripts_smoke_pipeline_state_error_contract_context": "context" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L47 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_historyfile": "historyFile" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L45 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_job": "job" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L49 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_jobsfile": "jobsFile" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L44 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_pipelineexecutorharness": "PipelineExecutorHarness" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L28 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_pipelinerunnerharness": "PipelineRunnerHarness" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L32 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_pipeline_state_error_contract_projectfolder": "projectFolder" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L43 | neighbors=[smoke-pipeline-state-error-contract.ts]
- "scripts_smoke_production_actions_before": "before" | kind=code-symbol | source=scripts/smoke-production-actions.ts:L2 | neighbors=[smoke-production-actions.ts]
- "scripts_smoke_production_actions_health": "{health}" | kind=code-symbol | source=scripts/smoke-production-actions.ts:L2 | neighbors=[smoke-production-actions.ts]
- "scripts_smoke_production_actions_one": "one" | kind=code-symbol | source=scripts/smoke-production-actions.ts:L2 | neighbors=[smoke-production-actions.ts]
- "scripts_smoke_production_actions_two": "two" | kind=code-symbol | source=scripts/smoke-production-actions.ts:L2 | neighbors=[smoke-production-actions.ts]
- "scripts_smoke_production_animation_provider_animationcheck": "animationCheck()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L152 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_animationenvironment": "animationEnvironment()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L156 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_config": "config()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L57 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_input": "input()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L92 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L809 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_physicalruntimepath": "physicalRuntimePath()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L47 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_png": "png" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L44 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_readiness": "readiness()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L148 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_animation_provider_scenevideoprovider": "sceneVideoProvider()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L709 | neighbors=[smoke-production-animation-provider.ts]
- "scripts_smoke_production_audio_asset_wiring_audiodata": "audioData" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L124 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_generate": "generate()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L326 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_issafeaudioerror": "isSafeAudioError()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L387 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_issafedurableerror": "isSafeDurableError()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L395 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_listprojectentries": "listProjectEntries()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L316 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_main": "main()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L1621 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_originalenvironment": "originalEnvironment" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L71 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_pipelinerunnerinternals": "PipelineRunnerInternals" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L154 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_projectsroot": "projectsRoot" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L67 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_runner": "runner" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L169 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_scriptdata": "scriptData" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L85 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_temporaryruntimeroot": "temporaryRuntimeRoot" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L66 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_temporaryworkspace": "temporaryWorkspace" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L65 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_audio_asset_wiring_validmockresult": "validMockResult()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L248 | neighbors=[smoke-production-audio-asset-wiring.ts]
- "scripts_smoke_production_controlled_execution_gateway_input": "input" | kind=code-symbol | source=scripts/smoke-production-controlled-execution-gateway.ts:L1 | neighbors=[smoke-production-controlled-execution-g…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-143.json

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
