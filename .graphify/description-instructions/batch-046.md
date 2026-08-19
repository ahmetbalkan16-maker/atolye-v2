# Node Description Batch 47 of 166

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

- "runtime_runtimestoragepaths_validateruntimelogicalpath": "validateRuntimeLogicalPath()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L608 | neighbors=[RuntimeStoragePaths.ts, resolveRuntimeLogicalPath(), resolveRuntimeLogicalPathForWrite(), requireProjectSlug(), RuntimeStorageError]
- "scripts_run_canonical_smoke_validation_runexternalvalidatorselfreview": "runExternalValidatorSelfReview()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L205 | neighbors=[run-canonical-smoke-validation.ts, main(), assertTerminalResult(), h(), inventory()]
- "scripts_smoke_assembly_scene_video_consumption_fixture": "fixture()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L172 | neighbors=[smoke-assembly-scene-video-consumption.…, expectPreflightFailure(), mp4(), plan(), wav()]
- "scripts_smoke_assembly_scene_video_consumption_runner": "Runner" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L119 | neighbors=[smoke-assembly-scene-video-consumption.…, expectPreflightFailure(), .constructor(), .run(), VideoAssemblyProcessRunner]
- "scripts_smoke_pipeline_auto_continuation_main": "main()" | kind=code-symbol | source=scripts/smoke-pipeline-auto-continuation.ts:L95 | neighbors=[smoke-pipeline-auto-continuation.ts, job(), jobsForStage(), readHistory(), readJobs()]
- "scripts_smoke_pipeline_history_persistence_record": "record()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L74 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testSuccessfulWrite(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_history_persistence_run": "run()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L211 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testSuccessfulWrite(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_history_persistence_terminaljob": "terminalJob()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L43 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testSuccessfulWrite(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_history_persistence_testsuccessfulwrite": "testSuccessfulWrite()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L78 | neighbors=[smoke-pipeline-history-persistence.ts, run(), readHistoryFile(), record(), terminalJob()]
- "scripts_smoke_pipeline_orchestration_testfinalstagedoesnotenqueue": "testFinalStageDoesNotEnqueue()" | kind=code-symbol | source=scripts/smoke-pipeline-orchestration.ts:L158 | neighbors=[smoke-pipeline-orchestration.ts, run(), job(), readJobs(), writeJobs()]
- "scripts_smoke_pipeline_state_corruption_assertidentifiederror": "assertIdentifiedError()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L77 | neighbors=[smoke-pipeline-state-corruption.ts, testMalformedHistory(), testMalformedJobs(), testStructurallyInvalidHistory(), testStructurallyInvalidJobs()]
- "scripts_smoke_pipeline_state_corruption_captureerror": "captureError()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L66 | neighbors=[smoke-pipeline-state-corruption.ts, testMalformedHistory(), testMalformedJobs(), testStructurallyInvalidHistory(), testStructurallyInvalidJobs()]
- "scripts_smoke_pipeline_state_corruption_testmalformedhistory": "testMalformedHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L117 | neighbors=[smoke-pipeline-state-corruption.ts, main(), assertIdentifiedError(), captureError(), writeRaw()]
- "scripts_smoke_pipeline_state_corruption_testmalformedjobs": "testMalformedJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L103 | neighbors=[smoke-pipeline-state-corruption.ts, main(), assertIdentifiedError(), captureError(), writeRaw()]
- "scripts_smoke_pipeline_state_corruption_teststructurallyinvalidhistory": "testStructurallyInvalidHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L151 | neighbors=[smoke-pipeline-state-corruption.ts, main(), assertIdentifiedError(), captureError(), writeRaw()]
- "scripts_smoke_pipeline_state_corruption_teststructurallyinvalidjobs": "testStructurallyInvalidJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L131 | neighbors=[smoke-pipeline-state-corruption.ts, main(), assertIdentifiedError(), captureError(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_testinvalidhistory": "testInvalidHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L186 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_testinvalidjobs": "testInvalidJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L150 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_testmalformedhistory": "testMalformedHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L171 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_testmalformedjobs": "testMalformedJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L137 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse(), writeRaw()]
- "scripts_smoke_production_audio_asset_wiring_runfailurethroughrunner": "runFailureThroughRunner()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L438 | neighbors=[smoke-production-audio-asset-wiring.ts, run(), createProvider(), createRunnerFixture(), readAssets()]
- "scripts_smoke_production_end_to_end_deterministicaiprovider": "DeterministicAIProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L219 | neighbors=[smoke-production-end-to-end.ts, AIProvider, .createImmutableAiDispatchAdapter(), .generate(), run()]
- "scripts_smoke_production_end_to_end_deterministicyoutubeprovider": "DeterministicYouTubeProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L283 | neighbors=[smoke-production-end-to-end.ts, .createImmutableYoutubeDispatchAdapter(), .generatePublishingPackage(), YouTubeProvider, run()]
- "scripts_smoke_production_end_to_end_stabilization_happypathandreplay": "happyPathAndReplay()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L83 | neighbors=[smoke-production-end-to-end-stabilizati…, CountingPublishProvider, NeverPackageProvider, pass(), run()]
- "scripts_smoke_production_end_to_end_stabilization_resetpublish": "resetPublish()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L193 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), mutateAssets(), reconciliationAndRestart(), recoveryPlannerConsistency()]
- "scripts_smoke_production_end_to_end_storedassemblyprovider": "StoredAssemblyProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L262 | neighbors=[smoke-production-end-to-end.ts, run(), .assemble(), .createImmutableAssemblyDispatchAdapter…, VideoAssemblyProvider]
- "scripts_smoke_production_end_to_end_storedimageprovider": "StoredImageProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L229 | neighbors=[smoke-production-end-to-end.ts, run(), ImageProvider, .createImmutableImageDispatchAdapter(), .generateImage()]
- "scripts_smoke_production_end_to_end_storedscenevideoprovider": "StoredSceneVideoProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L251 | neighbors=[smoke-production-end-to-end.ts, run(), .createImmutableVideoDispatchAdapter(), .generateVideo(), VideoProvider]
- "scripts_smoke_production_execution_durable_lease_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L28 | neighbors=[smoke-production-execution-durable-leas…, acquire(), heartbeat(), release(), scenario()]
- "scripts_smoke_production_health_evidence_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-evidence.ts:L19 | neighbors=[smoke-production-health-evidence.ts, finding(), renderEvidence(), renderFindings(), renderPanel()]
- "scripts_smoke_production_health_findings_main": "main()" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L18 | neighbors=[smoke-production-health-findings.ts, finding(), renderFindings(), renderPanel(), reportWithFindings()]
- "scripts_smoke_production_health_rules_known": "known()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L18 | neighbors=[smoke-production-health-rules.ts, coverage(), main(), snapshot(), stage()]
- "scripts_smoke_production_health_rules_snapshot": "snapshot()" | kind=code-symbol | source=scripts/smoke-production-health-rules.ts:L47 | neighbors=[smoke-production-health-rules.ts, main(), coverage(), known(), notRecorded()]
- "scripts_smoke_production_publish_reconciliation_hardening_dataapireadonlyreconciliation": "dataApiReadOnlyReconciliation()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L456 | neighbors=[smoke-production-publish-reconciliation…, .reconcilePublish(), pass(), reconciliationRequest(), main()]
- "scripts_smoke_production_readiness_acceptance_verifypackageonlypublish": "verifyPackageOnlyPublish()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L342 | neighbors=[smoke-production-readiness-acceptance.ts, run(), removeMarkedSmokeProject(), stageState(), verifyPersistedStrictPolicy()]
- "scripts_smoke_production_scene_video_rendering_fakechild": "FakeChild" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L419 | neighbors=[smoke-production-scene-video-rendering.…, EventEmitter, .kill(), .unref(), VideoAssemblyChildProcess]
- "scripts_smoke_production_video_assembly_wiring_controlledchild": "ControlledChild" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L280 | neighbors=[smoke-production-video-assembly-wiring.…, .constructor(), .kill(), .unref(), EventEmitter]
- "scripts_smoke_production_video_assembly_wiring_run": "run()" | kind=code-symbol | source=scripts/smoke-production-video-assembly-wiring.ts:L800 | neighbors=[smoke-production-video-assembly-wiring.…, env(), runAssemblyFailureThroughRunner(), runPublicPipelineAssemblyFailure(), scenario()]
- "scripts_smoke_production_visual_asset_wiring_runvisualfailurethroughrunner": "runVisualFailureThroughRunner()" | kind=code-symbol | source=scripts/smoke-production-visual-asset-wiring.ts:L332 | neighbors=[smoke-production-visual-asset-wiring.ts, run(), createProvider(), createRunnerFixture(), readAssets()]
- "scripts_smoke_production_youtube_package_pipeline_assetfailuretests": "assetFailureTests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L266 | neighbors=[smoke-production-youtube-package-pipeli…, DraftProvider, failWith(), mutateAssets(), pass()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-046.json

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
