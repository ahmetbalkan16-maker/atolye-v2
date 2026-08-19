# Node Description Batch 111 of 166

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

- "scripts_smoke_production_video_assembly_wiring_wav": "wav()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L203 | neighbors=[smoke-production-video-assembly-wiring.…, fixture()]
- "scripts_smoke_production_visual_asset_wiring_createexecutionstate": "createExecutionState()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L279 | neighbors=[smoke-production-visual-asset-wiring.ts, createRunnerFixture()]
- "scripts_smoke_production_visual_asset_wiring_createmockprovider": "createMockProvider()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L192 | neighbors=[smoke-production-visual-asset-wiring.ts, run()]
- "scripts_smoke_production_visual_asset_wiring_generate": "generate()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L219 | neighbors=[smoke-production-visual-asset-wiring.ts, run()]
- "scripts_smoke_production_visual_asset_wiring_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L123 | neighbors=[smoke-production-visual-asset-wiring.ts, run()]
- "scripts_smoke_production_worker_lifecycle_durableevidence": "durableEvidence()" | kind=code-symbol | source=scripts/smoke-production-worker-lifecycle.ts:L25 | neighbors=[smoke-production-worker-lifecycle.ts, main()]
- "scripts_smoke_production_worker_lifecycle_initialization": "initialization()" | kind=code-symbol | source=scripts/smoke-production-worker-lifecycle.ts:L24 | neighbors=[smoke-production-worker-lifecycle.ts, main()]
- "scripts_smoke_production_youtube_package_pipeline_box": "box()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L484 | neighbors=[smoke-production-youtube-package-pipeli…, minimalMp4()]
- "scripts_smoke_production_youtube_package_pipeline_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L500 | neighbors=[smoke-production-youtube-package-pipeli…, pngChunk()]
- "scripts_smoke_production_youtube_package_pipeline_draftprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L448 | neighbors=[DraftProvider, draft()]
- "scripts_smoke_production_youtube_package_pipeline_providerconfigtests": "providerConfigTests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L208 | neighbors=[smoke-production-youtube-package-pipeli…, pass()]
- "scripts_smoke_production_youtube_package_pipeline_youtubeprovider": "YouTubeProvider" | kind=code-symbol | neighbors=[DraftProvider, StaticProvider]
- "scripts_smoke_production_youtube_publish_pipeline_box": "box()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L282 | neighbors=[smoke-production-youtube-publish-pipeli…, minimalMp4()]
- "scripts_smoke_production_youtube_publish_pipeline_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L285 | neighbors=[smoke-production-youtube-publish-pipeli…, pngChunk()]
- "scripts_smoke_production_youtube_publish_pipeline_intent": "intent()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L247 | neighbors=[smoke-production-youtube-publish-pipeli…, successReplayAndConfig()]
- "scripts_smoke_production_youtube_publish_pipeline_withfile": "withFile()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L263 | neighbors=[smoke-production-youtube-publish-pipeli…, storedStateAndAssetFailures()]
- "scripts_smoke_production_youtube_publish_pipeline_withmissingfile": "withMissingFile()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L258 | neighbors=[smoke-production-youtube-publish-pipeli…, storedStateAndAssetFailures()]
- "scripts_smoke_production_youtube_publish_pipeline_youtubepublishprovider": "YouTubePublishProvider" | kind=code-symbol | neighbors=[CountingProvider, ExplicitFailureProvider]
- "scripts_smoke_retry_persistence_joblist": "jobList()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L28 | neighbors=[smoke-retry-persistence.ts, writeJobs()]
- "scripts_smoke_retry_persistence_testcompensationguards": "testCompensationGuards()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L70 | neighbors=[smoke-retry-persistence.ts, writeJobs()]
- "scripts_smoke_retry_persistence_testpreparationwritefailure": "testPreparationWriteFailure()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L42 | neighbors=[smoke-retry-persistence.ts, writeJobs()]
- "scripts_smoke_sprint_128_1_production_acceptance_box": "box()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L100 | neighbors=[smoke-sprint-128-1-production-acceptanc…, mp4()]
- "scripts_smoke_sprint_128_1_production_acceptance_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L107 | neighbors=[smoke-sprint-128-1-production-acceptanc…, box()]
- "scripts_smoke_sprint_128_1_production_acceptance_restore": "restore()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L401 | neighbors=[smoke-sprint-128-1-production-acceptanc…, run()]
- "scripts_smoke_sprint_128_1_production_acceptance_saferemoveproject": "safeRemoveProject()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L402 | neighbors=[smoke-sprint-128-1-production-acceptanc…, run()]
- "scripts_smoke_sprint_128_1_production_acceptance_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L50 | neighbors=[smoke-sprint-128-1-production-acceptanc…, run()]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_issue": "issue()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L85 | neighbors=[smoke-sprint-129-11-research-schema-com…, schemaError()]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L95 | neighbors=[smoke-sprint-129-11-research-schema-com…, test()]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_schemaerror": "schemaError()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L75 | neighbors=[smoke-sprint-129-11-research-schema-com…, issue()]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L28 | neighbors=[smoke-sprint-129-11-research-schema-com…, main()]
- "scripts_smoke_sprint_129_13_script_settlement_env": "env()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L29 | neighbors=[smoke-sprint-129-13-script-settlement.ts, main()]
- "scripts_smoke_sprint_129_13_script_settlement_fixtureproject": "fixtureProject()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L39 | neighbors=[smoke-sprint-129-13-script-settlement.ts, main()]
- "scripts_smoke_sprint_129_13_script_settlement_hashtree": "hashTree()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L38 | neighbors=[smoke-sprint-129-13-script-settlement.ts, main()]
- "scripts_smoke_sprint_129_13_script_settlement_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L28 | neighbors=[smoke-sprint-129-13-script-settlement.ts, main()]
- "scripts_smoke_sprint_129_15_script_timestamp_digest": "digest()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L24 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, main()]
- "scripts_smoke_sprint_129_15_script_timestamp_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L22 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, main()]
- "scripts_smoke_sprint_129_15_script_timestamp_result": "result()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L21 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, main()]
- "scripts_smoke_sprint_129_15_script_timestamp_script": "script()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L20 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, main()]
- "scripts_smoke_sprint_129_15_script_timestamp_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L19 | neighbors=[smoke-sprint-129-15-script-timestamp.ts, main()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_digest": "digest()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L68 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, main()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-110.json

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
