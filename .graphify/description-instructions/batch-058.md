# Node Description Batch 59 of 166

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

- "scripts_smoke_production_execution_worker_maindurable": "mainDurable()" | kind=code-symbol | source=scripts/smoke-production-execution-worker.ts:L21 | neighbors=[smoke-production-execution-worker.ts, dRequest(), dSetup(), dTree()]
- "scripts_smoke_production_health_api_consumer_createjsonfetch": "createJsonFetch()" | kind=code-symbol | source=scripts/smoke-production-health-api-consumer.ts:L170 | neighbors=[smoke-production-health-api-consumer.ts, jsonResponse(), responseFetch(), main()]
- "scripts_smoke_production_health_service_writejson": "writeJson()" | kind=code-symbol | source=scripts/smoke-production-health-service.ts:L322 | neighbors=[smoke-production-health-service.ts, run(), writeCompleteFixture(), file()]
- "scripts_smoke_production_health_ui_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-ui.ts:L16 | neighbors=[smoke-production-health-ui.ts, criticalReport(), render(), withHealth()]
- "scripts_smoke_production_intelligence_review_main": "main()" | kind=code-symbol | source=scripts/smoke-production-intelligence-review.ts:L19 | neighbors=[smoke-production-intelligence-review.ts, exists(), verifySourceBoundaries(), withMutedConsole()]
- "scripts_smoke_production_publish_reconciliation_hardening_marker": "marker()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L524 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), publishingIntent(), reconciliationRequest()]
- "scripts_smoke_production_publish_reconciliation_hardening_matchedresult": "matchedResult()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L547 | neighbors=[smoke-production-publish-reconciliation…, bindingAndStateValidation(), matchedReconciliation(), persistenceApiAndRecovery()]
- "scripts_smoke_production_publish_reconciliation_hardening_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L74 | neighbors=[smoke-production-publish-reconciliation…, main(), minimalMp4(), png()]
- "scripts_smoke_production_readiness_acceptance_readinessservice": "readinessService()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L630 | neighbors=[smoke-production-readiness-acceptance.ts, run(), verifyProbeCleanupFailsClosed(), verifyRuntimeReevaluation()]
- "scripts_smoke_production_readiness_acceptance_verifyaudiooperationscope": "verifyAudioOperationScope()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L117 | neighbors=[smoke-production-readiness-acceptance.ts, run(), find(), probeDirectories()]
- "scripts_smoke_production_readiness_acceptance_verifyruntimereevaluation": "verifyRuntimeReevaluation()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L525 | neighbors=[smoke-production-readiness-acceptance.ts, run(), find(), readinessService()]
- "scripts_smoke_production_recovery_bootstrap_main": "main()" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L41 | neighbors=[smoke-production-recovery-bootstrap.ts, mutation(), setup(), snapshot()]
- "scripts_smoke_production_runtime_startup_main": "main()" | kind=code-symbol | source=scripts/smoke-production-runtime-startup.ts:L12 | neighbors=[smoke-production-runtime-startup.ts, attempt(), bootstrap(), dependencies()]
- "scripts_smoke_production_scene_video_rendering_renderingrunner": "RenderingRunner" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L393 | neighbors=[smoke-production-scene-video-rendering.…, .constructor(), .run(), VideoAssemblyProcessRunner]
- "scripts_smoke_production_snapshot_builder_usage": "usage()" | kind=code-symbol | source=scripts/smoke-production-snapshot-builder.ts:L160 | neighbors=[smoke-production-snapshot-builder.ts, bundle(), run(), verifyFilesystemReadOnly()]
- "scripts_smoke_production_thumbnail_pipeline_assemblymock": "assemblyMock()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L68 | neighbors=[smoke-production-thumbnail-pipeline.ts, createProductionAssembly(), pipelineFixture(), thumbnailAssetInput()]
- "scripts_smoke_production_thumbnail_pipeline_pipelinefixture": "pipelineFixture()" | kind=code-symbol | source=scripts/smoke-production-thumbnail-pipeline.ts:L291 | neighbors=[smoke-production-thumbnail-pipeline.ts, assemblyMock(), audioData(), videoData()]
- "scripts_smoke_production_video_assembly_wiring_env": "env()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L193 | neighbors=[smoke-production-video-assembly-wiring.…, run(), runAssemblyFailureThroughRunner(), runPublicPipelineAssemblyFailure()]
- "scripts_smoke_production_video_assembly_wiring_fakerunner": "FakeRunner" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L237 | neighbors=[smoke-production-video-assembly-wiring.…, .constructor(), .run(), VideoAssemblyProcessRunner]
- "scripts_smoke_production_video_assembly_wiring_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L319 | neighbors=[smoke-production-video-assembly-wiring.…, createAssemblyRunnerFixture(), expectFailure(), wav()]
- "scripts_smoke_production_video_assembly_wiring_runassemblyfailurethroughrunner": "runAssemblyFailureThroughRunner()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L507 | neighbors=[smoke-production-video-assembly-wiring.…, run(), createAssemblyRunnerFixture(), env()]
- "scripts_smoke_production_visual_asset_wiring_readassets": "readAssets()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L215 | neighbors=[smoke-production-visual-asset-wiring.ts, expectSafeFailure(), assetsPath(), runVisualFailureThroughRunner()]
- "scripts_smoke_production_youtube_package_pipeline_persistencetests": "persistenceTests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L342 | neighbors=[smoke-production-youtube-package-pipeli…, DraftProvider, generate(), pass()]
- "scripts_smoke_production_youtube_package_pipeline_staticprovider": "StaticProvider" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L454 | neighbors=[smoke-production-youtube-package-pipeli…, .constructor(), .generatePublishingPackage(), YouTubeProvider]
- "scripts_smoke_retry_persistence_writejobs": "writeJobs()" | kind=code-symbol | source=scripts/smoke-retry-persistence.ts:L37 | neighbors=[smoke-retry-persistence.ts, testCompensationGuards(), testPreparationWriteFailure(), jobList()]
- "scripts_smoke_sprint_128_1_production_acceptance_run": "run()" | kind=code-symbol | source=scripts/smoke-sprint-128-1-production-acceptance.ts:L114 | neighbors=[smoke-sprint-128-1-production-acceptanc…, restore(), safeRemoveProject(), test()]
- "scripts_smoke_sprint_129_20_visuals_truncation_budget_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-20-visuals-truncation-budget.ts:L114 | neighbors=[smoke-sprint-129-20-visuals-truncation-…, digest(), result(), test()]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L76 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…, runtimeDiff(), scenario(), sha256()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_createfailedpublicaudioresumefixture": "createFailedPublicAudioResumeFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L880 | neighbors=[smoke-sprint-129-28-production-acceptan…, explicitTestAuthority(), fixture(), publishCapabilityFixture()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_runcanonicalrunnerresearchstage": "runCanonicalRunnerResearchStage()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L689 | neighbors=[smoke-sprint-129-28-production-acceptan…, createFailedPublicResearchFixture(), runCanonicalProviderGateFailure(), runExecutorScopeDivergence()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter_matches": ".matches()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L84 | neighbors=[OneShotPersistenceFaultAdapter, .listKeys(), .read(), .write()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter_write": ".write()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L52 | neighbors=[OneShotPersistenceFaultAdapter, .matches(), persistenceVersion(), test()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_childenvironment": "childEnvironment()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L83 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, runActualCliProcess(), spawnLockChild(), spawnPathRaceChild()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_computefileinventory": "computeFileInventory()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L113 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, runCanonicalRewindPoisonRegression(), runExactRewindOwnershipRegression(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_inventorydigest": "inventoryDigest()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L137 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, runCanonicalRewindPoisonRegression(), runExactRewindOwnershipRegression(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runcleanupsafetyregression": "runCleanupSafetyRegression()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L203 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, captureOwnedTempRootIdentity(), cleanupOwnedTempRoot(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runcrossprocessracetest": "runCrossProcessRaceTest()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L311 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assert(), assertContained(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runrealordinalfourproductionwritertest": "runRealOrdinalFourProductionWriterTest()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L932 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, captureOwnedTempRootIdentity(), cleanupOwnedTempRoot(), runSmokeSuite()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L189 | neighbors=[smoke-sprint-129-37-assembly-truncation…, provider(), result(), test()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureaiprovider": "FixtureAIProvider" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L54 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, ConfiguredAIProvider, .createImmutableAiDispatchAdapter(), .generate()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-058.json

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
