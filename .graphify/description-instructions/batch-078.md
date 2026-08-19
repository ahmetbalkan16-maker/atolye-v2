# Node Description Batch 79 of 166

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

- "scripts_smoke_production_youtube_package_pipeline_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L496 | neighbors=[smoke-production-youtube-package-pipeli…, png(), crc32()]
- "scripts_smoke_production_youtube_package_pipeline_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L71 | neighbors=[smoke-production-youtube-package-pipeli…, minimalMp4(), png()]
- "scripts_smoke_production_youtube_package_pipeline_validationtests": "validationTests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L248 | neighbors=[smoke-production-youtube-package-pipeli…, draft(), pass()]
- "scripts_smoke_production_youtube_publish_pipeline_explicitfailureprovider": "ExplicitFailureProvider" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L276 | neighbors=[smoke-production-youtube-publish-pipeli…, .publish(), YouTubePublishProvider]
- "scripts_smoke_production_youtube_publish_pipeline_minimalmp4": "minimalMp4()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L281 | neighbors=[smoke-production-youtube-publish-pipeli…, box(), setup()]
- "scripts_smoke_production_youtube_publish_pipeline_mutateassets": "mutateAssets()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L252 | neighbors=[smoke-production-youtube-publish-pipeli…, pass(), storedStateAndAssetFailures()]
- "scripts_smoke_production_youtube_publish_pipeline_persistenceapirunnerandrecovery": "persistenceApiRunnerAndRecovery()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L200 | neighbors=[smoke-production-youtube-publish-pipeli…, CountingProvider, pass()]
- "scripts_smoke_production_youtube_publish_pipeline_png": "png()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L283 | neighbors=[smoke-production-youtube-publish-pipeli…, pngChunk(), setup()]
- "scripts_smoke_production_youtube_publish_pipeline_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L284 | neighbors=[smoke-production-youtube-publish-pipeli…, png(), crc32()]
- "scripts_smoke_production_youtube_publish_pipeline_providerrequest": "providerRequest()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L243 | neighbors=[smoke-production-youtube-publish-pipeli…, realProviderFailures(), successReplayAndConfig()]
- "scripts_smoke_production_youtube_publish_pipeline_realproviderfailures": "realProviderFailures()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L164 | neighbors=[smoke-production-youtube-publish-pipeli…, pass(), providerRequest()]
- "scripts_smoke_production_youtube_publish_pipeline_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L69 | neighbors=[smoke-production-youtube-publish-pipeli…, minimalMp4(), png()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_schemaerror": "schemaError()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L79 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, issue(), script()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_script": "script()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L33 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, main(), schemaError()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_scenes": "scenes()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L42 | neighbors=[smoke-sprint-129-19-visuals-structured-…, main(), schemaError()]
- "scripts_smoke_sprint_129_19_visuals_structured_output_schemaerror": "schemaError()" | kind=code-symbol | source=scripts/smoke-sprint-129-19-visuals-structured-output.ts:L51 | neighbors=[smoke-sprint-129-19-visuals-structured-…, issue(), scenes()]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_result": "result()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L70 | neighbors=[smoke-sprint-129-20-visuals-truncation-…, main(), visualPlan()]
- "scripts_smoke_sprint_129_22_animation_structured_output_frame": "frame()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L34 | neighbors=[smoke-sprint-129-22-animation-structure…, main(), plan()]
- "scripts_smoke_sprint_129_22_animation_structured_output_inventory": "inventory()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L92 | neighbors=[smoke-sprint-129-22-animation-structure…, walk(), main()]
- "scripts_smoke_sprint_129_22_animation_structured_output_plan": "plan()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L41 | neighbors=[smoke-sprint-129-22-animation-structure…, main(), frame()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_mismatchscenario": "mismatchScenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L342 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main(), test()]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L32 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…, main(), mismatchScenario()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_guardedforroot": "guardedForRoot()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L532 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, completeProtectedInputs(), reservationChild()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_reservationchild": "reservationChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L565 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, main(), guardedForRoot()]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L86 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…, scenario(), writeJsonFile()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_createcounters": "createCounters()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L235 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, instrumentedCreate(), instrumentedFailure()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L90 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, writeJson(), scenario()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_instrumentedcreate": "instrumentedCreate()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L176 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, createCounters(), withProductionBoundarySpy()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_instrumentedfailure": "instrumentedFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L193 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, createCounters(), withProductionBoundarySpy()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L55 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, createFixture(), runWithFixture()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_withproductionboundaryspy": "withProductionBoundarySpy()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L258 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, instrumentedCreate(), instrumentedFailure()]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L134 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…, digest(), test()]
- "scripts_smoke_sprint_129_27_audio_remediation_assertfullaudiofailurechain": "assertFullAudioFailureChain()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L477 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, latestDurableAttempt(), scriptFixture()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_assertreservationcorruptsemantic": "assertReservationCorruptSemantic()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1065 | neighbors=[smoke-sprint-129-28-production-acceptan…, descriptorBoundAdapter(), exactStorePolicyEntry()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_createpublicresumefixture": "createPublicResumeFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L857 | neighbors=[smoke-sprint-129-28-production-acceptan…, fixture(), publishCapabilityFixture()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_descriptorboundadapter": "descriptorBoundAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L189 | neighbors=[smoke-sprint-129-28-production-acceptan…, assertReservationCorruptSemantic(), verifyRecordLevelParity()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_exactstorepolicyentry": "exactStorePolicyEntry()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L634 | neighbors=[smoke-sprint-129-28-production-acceptan…, assertReservationCorruptSemantic(), verifyRecordLevelParity()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_fixtureprovideroptions": "fixtureProviderOptions()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L536 | neighbors=[smoke-sprint-129-28-production-acceptan…, createFailedProductionAudioRetryFixture…, explicitTestAuthority()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_poisonrunningattempt": "poisonRunningAttempt()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1014 | neighbors=[smoke-sprint-129-28-production-acceptan…, latestDurablePath(), rewriteJsonFile()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_rewritejsonfile": "rewriteJsonFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L952 | neighbors=[smoke-sprint-129-28-production-acceptan…, poisonLatestRunningAttempt(), poisonRunningAttempt()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-078.json

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
