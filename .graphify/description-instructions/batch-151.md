# Node Description Batch 152 of 166

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

- "scripts_smoke_production_visual_asset_wiring_validpngbytes": "validPngBytes" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L74 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_versionfromkey": "versionFromKey()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L1050 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_visual_asset_wiring_visualdata": "visualData" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L77 | neighbors=[smoke-production-visual-asset-wiring.ts]
- "scripts_smoke_production_worker_lifecycle_bootstrap": "bootstrap()" | kind=code-symbol | source=scripts/smoke-production-worker-lifecycle.ts:L23 | neighbors=[smoke-production-worker-lifecycle.ts]
- "scripts_smoke_production_youtube_package_pipeline_main": "main()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L51 | neighbors=[smoke-production-youtube-package-pipeli…]
- "scripts_smoke_production_youtube_package_pipeline_staticprovider_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L457 | neighbors=[StaticProvider]
- "scripts_smoke_production_youtube_package_pipeline_staticprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L458 | neighbors=[StaticProvider]
- "scripts_smoke_production_youtube_publish_pipeline_countingprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L270 | neighbors=[CountingProvider]
- "scripts_smoke_production_youtube_publish_pipeline_explicitfailureprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L278 | neighbors=[ExplicitFailureProvider]
- "scripts_smoke_production_youtube_publish_pipeline_main": "main()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L50 | neighbors=[smoke-production-youtube-publish-pipeli…]
- "scripts_smoke_production_youtube_publish_pipeline_publish": "publish()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L237 | neighbors=[smoke-production-youtube-publish-pipeli…]
- "scripts_smoke_retry_persistence_main": "main()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L187 | neighbors=[smoke-retry-persistence.ts]
- "scripts_smoke_retry_persistence_pipelineexecutorharness": "PipelineExecutorHarness" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L15 | neighbors=[smoke-retry-persistence.ts]
- "scripts_smoke_retry_persistence_pipelinerunnerharness": "PipelineRunnerHarness" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L16 | neighbors=[smoke-retry-persistence.ts]
- "scripts_smoke_retry_persistence_testrunnercontracts": "testRunnerContracts()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L115 | neighbors=[smoke-retry-persistence.ts]
- "scripts_smoke_sprint_128_1_production_acceptance_assembly": "assembly()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L82 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_128_1_production_acceptance_audio": "audio()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L73 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_128_1_production_acceptance_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L391 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_128_1_production_acceptance_scenes": "scenes()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L70 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_128_1_production_acceptance_script": "script()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L57 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_128_1_production_acceptance_wav": "wav()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L89 | neighbors=[smoke-sprint-128-1-production-acceptanc…]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L91 | neighbors=[smoke-sprint-129-11-research-schema-com…]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L34 | neighbors=[smoke-sprint-129-11-research-schema-com…]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L71 | neighbors=[smoke-sprint-129-11-research-schema-com…]
- "scripts_smoke_sprint_129_11_research_schema_compatibility_providerresult": "providerResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-11-research-schema-compatibility.ts:L59 | neighbors=[smoke-sprint-129-11-research-schema-com…]
- "scripts_smoke_sprint_129_13_script_settlement_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L37 | neighbors=[smoke-sprint-129-13-script-settlement.ts]
- "scripts_smoke_sprint_129_13_script_settlement_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L36 | neighbors=[smoke-sprint-129-13-script-settlement.ts]
- "scripts_smoke_sprint_129_13_script_settlement_providerresult": "providerResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L35 | neighbors=[smoke-sprint-129-13-script-settlement.ts]
- "scripts_smoke_sprint_129_13_script_settlement_scriptfixture": "scriptFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L31 | neighbors=[smoke-sprint-129-13-script-settlement.ts]
- "scripts_smoke_sprint_129_15_script_timestamp_research": "research()" | kind=code-symbol | source=scripts/smoke-sprint-129-15-script-timestamp.ts:L23 | neighbors=[smoke-sprint-129-15-script-timestamp.ts]
- "scripts_smoke_sprint_129_17_scenes_structured_output_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L64 | neighbors=[smoke-sprint-129-17-scenes-structured-o…]
- "scripts_smoke_sprint_129_17_scenes_structured_output_result": "result()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L60 | neighbors=[smoke-sprint-129-17-scenes-structured-o…]
- "scripts_smoke_sprint_129_19_visuals_structured_output_png": "png" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L38 | neighbors=[smoke-sprint-129-19-visuals-structured-…]
- "scripts_smoke_sprint_129_19_visuals_structured_output_providerresult": "providerResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L48 | neighbors=[smoke-sprint-129-19-visuals-structured-…]
- "scripts_smoke_sprint_129_19_visuals_structured_output_textprovider": "textProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L49 | neighbors=[smoke-sprint-129-19-visuals-structured-…]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_environment": "environment()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L108 | neighbors=[smoke-sprint-129-20-visuals-truncation-…]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L82 | neighbors=[smoke-sprint-129-20-visuals-truncation-…]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_scenes": "scenes()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L39 | neighbors=[smoke-sprint-129-20-visuals-truncation-…]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_config": "config()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L35 | neighbors=[smoke-sprint-129-21-animation-failure-d…]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_response": "response()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L52 | neighbors=[smoke-sprint-129-21-animation-failure-d…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-151.json

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
