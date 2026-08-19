# Node Description Batch 106 of 166

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

- "scripts_run_production_acceptance_main": "main()" | kind=code-symbol | source=scripts/run-production-acceptance.ts:L25 | neighbors=[run-production-acceptance.ts, isolatedCliEvidenceDependencies()]
- "scripts_run_production_regeneration_main": "main()" | kind=code-symbol | source=scripts/run-production-regeneration.ts:L27 | neighbors=[run-production-regeneration.ts, parseExactArguments()]
- "scripts_run_production_regeneration_parseexactarguments": "parseExactArguments()" | kind=code-symbol | source=scripts/run-production-regeneration.ts:L10 | neighbors=[run-production-regeneration.ts, main()]
- "scripts_runtime_backup_argument": "argument()" | kind=code-symbol | source=scripts/runtime-backup.ts:L15 | neighbors=[runtime-backup.ts, main()]
- "scripts_runtime_backup_report": "report()" | kind=code-symbol | source=scripts/runtime-backup.ts:L20 | neighbors=[runtime-backup.ts, main()]
- "scripts_smoke_animation_motion_plan_contract_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L85 | neighbors=[smoke-animation-motion-plan-contract.ts, pipelineFixture()]
- "scripts_smoke_animation_motion_plan_contract_pipelinefixture": "pipelineFixture()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L146 | neighbors=[smoke-animation-motion-plan-contract.ts, fixture()]
- "scripts_smoke_animation_motion_plan_contract_run": "run()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L175 | neighbors=[smoke-animation-motion-plan-contract.ts, scenario()]
- "scripts_smoke_animation_motion_plan_contract_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-animation-motion-plan-contract.ts:L48 | neighbors=[smoke-animation-motion-plan-contract.ts, run()]
- "scripts_smoke_assembly_scene_video_consumption_box": "box()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L89 | neighbors=[smoke-assembly-scene-video-consumption.…, mp4()]
- "scripts_smoke_assembly_scene_video_consumption_plan": "plan()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L102 | neighbors=[smoke-assembly-scene-video-consumption.…, fixture()]
- "scripts_smoke_assembly_scene_video_consumption_render": "render()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L270 | neighbors=[smoke-assembly-scene-video-consumption.…, expectPreflightFailure()]
- "scripts_smoke_assembly_scene_video_consumption_run": "run()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L292 | neighbors=[smoke-assembly-scene-video-consumption.…, scenario()]
- "scripts_smoke_assembly_scene_video_consumption_runner_run": ".run()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L130 | neighbors=[Runner, mp4()]
- "scripts_smoke_assembly_scene_video_consumption_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L72 | neighbors=[smoke-assembly-scene-video-consumption.…, run()]
- "scripts_smoke_assembly_scene_video_consumption_wav": "wav()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L78 | neighbors=[smoke-assembly-scene-video-consumption.…, fixture()]
- "scripts_smoke_canonical_smoke_runtime_foundation_assertregistrationequal": "assertRegistrationEqual()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L282 | neighbors=[smoke-canonical-smoke-runtime-foundatio…, main()]
- "scripts_smoke_canonical_smoke_runtime_foundation_main": "main()" | kind=code-symbol | source=scripts/smoke-canonical-smoke-runtime-foundation.ts:L25 | neighbors=[smoke-canonical-smoke-runtime-foundatio…, assertRegistrationEqual()]
- "scripts_smoke_pipeline_auto_continuation_job": "job()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L38 | neighbors=[smoke-pipeline-auto-continuation.ts, main()]
- "scripts_smoke_pipeline_auto_continuation_joblist": "jobList()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L62 | neighbors=[smoke-pipeline-auto-continuation.ts, writeJobs()]
- "scripts_smoke_pipeline_auto_continuation_jobsforstage": "jobsForStage()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L91 | neighbors=[smoke-pipeline-auto-continuation.ts, main()]
- "scripts_smoke_pipeline_auto_continuation_readhistory": "readHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L85 | neighbors=[smoke-pipeline-auto-continuation.ts, main()]
- "scripts_smoke_pipeline_auto_continuation_readjobs": "readJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L81 | neighbors=[smoke-pipeline-auto-continuation.ts, main()]
- "scripts_smoke_pipeline_auto_continuation_writejobs": "writeJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L71 | neighbors=[smoke-pipeline-auto-continuation.ts, jobList()]
- "scripts_smoke_pipeline_history_persistence_readhistoryfile": "readHistoryFile()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L68 | neighbors=[smoke-pipeline-history-persistence.ts, testSuccessfulWrite()]
- "scripts_smoke_pipeline_orchestration_joblist": "jobList()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L42 | neighbors=[smoke-pipeline-orchestration.ts, writeJobs()]
- "scripts_smoke_pipeline_orchestration_testnextstageresolver": "testNextStageResolver()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L69 | neighbors=[smoke-pipeline-orchestration.ts, run()]
- "scripts_smoke_pipeline_retry_continuation_hardening_joblist": "jobList()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L85 | neighbors=[smoke-pipeline-retry-continuation-harde…, writeJobs()]
- "scripts_smoke_pipeline_retry_continuation_hardening_writejobs": "writeJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-retry-continuation-hardening.ts:L89 | neighbors=[smoke-pipeline-retry-continuation-harde…, jobList()]
- "scripts_smoke_pipeline_state_error_contract_history": "history()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L71 | neighbors=[smoke-pipeline-state-error-contract.ts, testValidResponses()]
- "scripts_smoke_pipeline_state_error_contract_jobs": "jobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L62 | neighbors=[smoke-pipeline-state-error-contract.ts, testValidResponses()]
- "scripts_smoke_pipeline_state_error_contract_testrobustdiscrimination": "testRobustDiscrimination()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L299 | neighbors=[smoke-pipeline-state-error-contract.ts, main()]
- "scripts_smoke_production_animation_provider_assemblyprovider": "assemblyProvider()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L790 | neighbors=[smoke-production-animation-provider.ts, verifyAssembly()]
- "scripts_smoke_production_animation_provider_configuredanimationprovider": "configuredAnimationProvider()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L137 | neighbors=[smoke-production-animation-provider.ts, productionProvider()]
- "scripts_smoke_production_animation_provider_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L167 | neighbors=[smoke-production-animation-provider.ts, createProductionAnimation()]
- "scripts_smoke_production_animation_provider_frame": "frame()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L68 | neighbors=[smoke-production-animation-provider.ts, plan()]
- "scripts_smoke_production_animation_provider_main": "main()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L830 | neighbors=[smoke-production-animation-provider.ts, scenario()]
- "scripts_smoke_production_animation_provider_openairesponse": "openAIResponse()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L85 | neighbors=[smoke-production-animation-provider.ts, plan()]
- "scripts_smoke_production_animation_provider_wav": "wav()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L819 | neighbors=[smoke-production-animation-provider.ts, verifyAssembly()]
- "scripts_smoke_production_audio_asset_wiring_createexecutionstate": "createExecutionState()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L402 | neighbors=[smoke-production-audio-asset-wiring.ts, createRunnerFixture()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-105.json

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
