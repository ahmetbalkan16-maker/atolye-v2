# Node Description Batch 78 of 166

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

- "scripts_smoke_production_publish_reconciliation_hardening_reconciliationrequest": "reconciliationRequest()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L618 | neighbors=[smoke-production-publish-reconciliation…, dataApiReadOnlyReconciliation(), marker()]
- "scripts_smoke_production_readiness_acceptance_probedirectories": "probeDirectories()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L639 | neighbors=[smoke-production-readiness-acceptance.ts, run(), verifyAudioOperationScope()]
- "scripts_smoke_production_readiness_acceptance_removeproberoot": "removeProbeRoot()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L610 | neighbors=[smoke-production-readiness-acceptance.ts, restoreAndRemoveProbeRoot(), verifyProbeCleanupFailsClosed()]
- "scripts_smoke_production_readiness_acceptance_restoreandremoveproberoot": "restoreAndRemoveProbeRoot()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L600 | neighbors=[smoke-production-readiness-acceptance.ts, removeProbeRoot(), verifyProbeCleanupFailsClosed()]
- "scripts_smoke_production_readiness_acceptance_stagestate": "stageState()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L577 | neighbors=[smoke-production-readiness-acceptance.ts, verifyPackageOnlyPublish(), verifyPersistedStrictPolicy()]
- "scripts_smoke_production_readiness_acceptance_verifymockanimationisblocked": "verifyMockAnimationIsBlocked()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L269 | neighbors=[smoke-production-readiness-acceptance.ts, run(), find()]
- "scripts_smoke_production_readiness_acceptance_verifypersistedstrictpolicy": "verifyPersistedStrictPolicy()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L456 | neighbors=[smoke-production-readiness-acceptance.ts, verifyPackageOnlyPublish(), stageState()]
- "scripts_smoke_production_readiness_acceptance_verifystrictaiproviderfailure": "verifyStrictAIProviderFailure()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L185 | neighbors=[smoke-production-readiness-acceptance.ts, run(), strictPlanFixtures()]
- "scripts_smoke_production_scene_video_rendering_actualprocessrunner": "ActualProcessRunner" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L313 | neighbors=[smoke-production-scene-video-rendering.…, .run(), VideoAssemblyProcessRunner]
- "scripts_smoke_production_scene_video_rendering_assertfullframemarkers": "assertFullFrameMarkers()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L336 | neighbors=[smoke-production-scene-video-rendering.…, assertColor(), pixel()]
- "scripts_smoke_production_scene_video_rendering_plan": "plan()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L80 | neighbors=[smoke-production-scene-video-rendering.…, fixture(), frame()]
- "scripts_smoke_production_scene_video_rendering_pngchunk": "pngChunk()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L268 | neighbors=[smoke-production-scene-video-rendering.…, markedPng(), crc32()]
- "scripts_smoke_production_snapshot_builder_history": "history()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L120 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), historyEvent()]
- "scripts_smoke_production_snapshot_builder_jobs": "jobs()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L96 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), run()]
- "scripts_smoke_production_snapshot_builder_manifest": "manifest()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L43 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), run()]
- "scripts_smoke_production_snapshot_builder_project": "project()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L32 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), run()]
- "scripts_smoke_production_snapshot_builder_usagerecord": "usageRecord()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L133 | neighbors=[smoke-production-snapshot-builder.ts, run(), verifyFilesystemReadOnly()]
- "scripts_smoke_production_snapshot_contract_stagefixture": "stageFixture()" | kind=code-symbol | source=scripts/smoke-production-snapshot-contract.ts:L23 | neighbors=[smoke-production-snapshot-contract.ts, main(), notRecorded()]
- "scripts_smoke_production_thumbnail_pipeline_createproductionassembly": "createProductionAssembly()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L195 | neighbors=[smoke-production-thumbnail-pipeline.ts, assemblyMock(), box()]
- "scripts_smoke_production_thumbnail_pipeline_generate": "generate()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L167 | neighbors=[smoke-production-thumbnail-pipeline.ts, expectFailure(), thumbnailPlan()]
- "scripts_smoke_production_thumbnail_pipeline_thumbnailassetinput": "thumbnailAssetInput()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L125 | neighbors=[smoke-production-thumbnail-pipeline.ts, assemblyMock(), thumbnailPlan()]
- "scripts_smoke_production_thumbnail_pipeline_thumbnailplan": "thumbnailPlan()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L94 | neighbors=[smoke-production-thumbnail-pipeline.ts, generate(), thumbnailAssetInput()]
- "scripts_smoke_production_video_assembly_wiring_createassemblyrunnerfixture": "createAssemblyRunnerFixture()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L452 | neighbors=[smoke-production-video-assembly-wiring.…, fixture(), runAssemblyFailureThroughRunner()]
- "scripts_smoke_production_video_assembly_wiring_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L229 | neighbors=[smoke-production-video-assembly-wiring.…, .run(), box()]
- "scripts_smoke_production_video_assembly_wiring_runpublicpipelineassemblyfailure": "runPublicPipelineAssemblyFailure()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L691 | neighbors=[smoke-production-video-assembly-wiring.…, run(), env()]
- "scripts_smoke_production_visual_asset_wiring_assetspath": "assetsPath()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L211 | neighbors=[smoke-production-visual-asset-wiring.ts, expectWriteFreePreflightFailure(), readAssets()]
- "scripts_smoke_production_visual_asset_wiring_createprovider": "createProvider()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L173 | neighbors=[smoke-production-visual-asset-wiring.ts, run(), runVisualFailureThroughRunner()]
- "scripts_smoke_production_visual_asset_wiring_createrunnerfixture": "createRunnerFixture()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L304 | neighbors=[smoke-production-visual-asset-wiring.ts, createExecutionState(), runVisualFailureThroughRunner()]
- "scripts_smoke_production_visual_asset_wiring_createsuccessprovider": "createSuccessProvider()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L142 | neighbors=[smoke-production-visual-asset-wiring.ts, expectWriteFreePreflightFailure(), run()]
- "scripts_smoke_production_visual_asset_wiring_expectsafefailure": "expectSafeFailure()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L234 | neighbors=[smoke-production-visual-asset-wiring.ts, readAssets(), run()]
- "scripts_smoke_production_visual_asset_wiring_expectwritefreepreflightfailure": "expectWriteFreePreflightFailure()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L252 | neighbors=[smoke-production-visual-asset-wiring.ts, assetsPath(), createSuccessProvider()]
- "scripts_smoke_production_worker_lifecycle_main": "main()" | kind=code-symbol | source=scripts/smoke-production-worker-lifecycle.ts:L27 | neighbors=[smoke-production-worker-lifecycle.ts, durableEvidence(), initialization()]
- "scripts_smoke_production_youtube_package_pipeline_draft": "draft()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L461 | neighbors=[smoke-production-youtube-package-pipeli…, .generatePublishingPackage(), validationTests()]
- "scripts_smoke_production_youtube_package_pipeline_failwith": "failWith()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L421 | neighbors=[smoke-production-youtube-package-pipeli…, assetFailureTests(), pass()]
- "scripts_smoke_production_youtube_package_pipeline_generate": "generate()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L410 | neighbors=[smoke-production-youtube-package-pipeli…, persistenceTests(), successAndReplayTests()]
- "scripts_smoke_production_youtube_package_pipeline_input": "input()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L473 | neighbors=[smoke-production-youtube-package-pipeli…, openAITests(), successAndReplayTests()]
- "scripts_smoke_production_youtube_package_pipeline_minimalmp4": "minimalMp4()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L477 | neighbors=[smoke-production-youtube-package-pipeli…, box(), setup()]
- "scripts_smoke_production_youtube_package_pipeline_mutateassets": "mutateAssets()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L433 | neighbors=[smoke-production-youtube-package-pipeli…, assetFailureTests(), pass()]
- "scripts_smoke_production_youtube_package_pipeline_openaitests": "openAITests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L213 | neighbors=[smoke-production-youtube-package-pipeli…, input(), pass()]
- "scripts_smoke_production_youtube_package_pipeline_png": "png()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L489 | neighbors=[smoke-production-youtube-package-pipeli…, pngChunk(), setup()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-077.json

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
