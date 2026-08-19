# Node Description Batch 112 of 166

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

- "scripts_smoke_sprint_129_17_scenes_structured_output_issue": "issue()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L87 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, schemaError()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_scenes": "scenes()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L48 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, main()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L27 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, main()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_digest": "digest()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L50 | neighbors=[smoke-sprint-129-19-visuals-structured-…, main()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_issue": "issue()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L52 | neighbors=[smoke-sprint-129-19-visuals-structured-…, schemaError()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_physicalprovider": "physicalProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L54 | neighbors=[smoke-sprint-129-19-visuals-structured-…, main()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_plan": "plan()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L45 | neighbors=[smoke-sprint-129-19-visuals-structured-…, main()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L40 | neighbors=[smoke-sprint-129-19-visuals-structured-…, main()]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_digest": "digest()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L94 | neighbors=[smoke-sprint-129-20-visuals-truncation-…, main()]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L33 | neighbors=[smoke-sprint-129-20-visuals-truncation-…, main()]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_visualplan": "visualPlan()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L53 | neighbors=[smoke-sprint-129-20-visuals-truncation-…, result()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_diagnosticprovider": "diagnosticProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L83 | neighbors=[smoke-sprint-129-21-animation-failure-d…, main()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_expectprovidercode": "expectProviderCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L56 | neighbors=[smoke-sprint-129-21-animation-failure-d…, input()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_frame": "frame()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L43 | neighbors=[smoke-sprint-129-21-animation-failure-d…, plan()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_hashfile": "hashFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L71 | neighbors=[smoke-sprint-129-21-animation-failure-d…, main()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_hashvisualinputs": "hashVisualInputs()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L75 | neighbors=[smoke-sprint-129-21-animation-failure-d…, main()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_input": "input()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L39 | neighbors=[smoke-sprint-129-21-animation-failure-d…, expectProviderCode()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_plan": "plan()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L47 | neighbors=[smoke-sprint-129-21-animation-failure-d…, frame()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L29 | neighbors=[smoke-sprint-129-21-animation-failure-d…, main()]
- "scripts_smoke_sprint_129_22_animation_structured_output_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L28 | neighbors=[smoke-sprint-129-22-animation-structure…, main()]
- "scripts_smoke_sprint_129_22_animation_structured_output_walk": "walk()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L100 | neighbors=[smoke-sprint-129-22-animation-structure…, inventory()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_command": "command()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L254 | neighbors=[smoke-sprint-129-23-production-acceptan…, commandDependencies()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_commanddependencies": "commandDependencies()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L261 | neighbors=[smoke-sprint-129-23-production-acceptan…, command()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_configurationenvironment": "configurationEnvironment()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L231 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_createschema2marker": "createSchema2Marker()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L271 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_exists": "exists()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L320 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_inventory": "inventory()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L304 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_isdisposablefixture": "isDisposableFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L313 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_23_production_acceptance_portability_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-23-production-acceptance-portability.ts:L24 | neighbors=[smoke-sprint-129-23-production-acceptan…, main()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_configurationenvironment": "configurationEnvironment()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L455 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_createbinaries": "createBinaries()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L439 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_createschema2fixture": "createSchema2Fixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L391 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_inventory": "inventory()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L508 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_isdisposablefixture": "isDisposableFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L531 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main()]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_runtimediff": "runtimeDiff()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L43 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…, main()]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L50 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…, main()]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_sha256": "sha256()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L39 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…, main()]
- "scripts_smoke_sprint_129_25b_runtime_root_productionboundaryviolations": "productionBoundaryViolations()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L351 | neighbors=[smoke-sprint-129-25b-runtime-root.ts, main()]
- "scripts_smoke_sprint_129_25b_runtime_root_runtimediff": "runtimeDiff()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L55 | neighbors=[smoke-sprint-129-25b-runtime-root.ts, main()]
- "scripts_smoke_sprint_129_25b_runtime_root_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L38 | neighbors=[smoke-sprint-129-25b-runtime-root.ts, main()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-111.json

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
