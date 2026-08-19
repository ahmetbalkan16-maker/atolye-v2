# Node Description Batch 58 of 166

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

- "runtime_productionruntimeoperationcontext_digest": "digest()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L209 | neighbors=[ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationContext…, createAuthorityIdentity(), createProductionRuntimeOperationContext…]
- "runtime_productionruntimeoperationcontext_requireidentifier": "requireIdentifier()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L180 | neighbors=[ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationContext…, createProductionRuntimeOperationContext…, ProductionRuntimeOperationContextError]
- "runtime_productionruntimeoperationcontext_requireoperationtype": "requireOperationType()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L186 | neighbors=[ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationContext…, createProductionRuntimeOperationContext…, ProductionRuntimeOperationContextError]
- "runtime_runtimeoperationscope_activestore": "activeStore()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L102 | neighbors=[RuntimeOperationScope.ts, getActiveProductionRuntimeOperationCont…, getActiveRuntimeOperationScope(), runWithProductionRuntimeOperationContex…]
- "runtime_runtimeoperationscope_runwithproductionruntimeoperationcontext": "runWithProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L26 | neighbors=[ProductionRuntimeOperationContext.ts, RuntimeOperationScope.ts, activeStore(), isPromiseLike()]
- "runtime_runtimestoragepaths_assertprojectwriteauthority": "assertProjectWriteAuthority()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L225 | neighbors=[RuntimeStoragePaths.ts, assertProjectWriteAuthorityWithContext(), requireProjectSlug(), resolveRuntimeStorageContext()]
- "runtime_runtimestoragepaths_isnodeerror": "isNodeError()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L760 | neighbors=[RuntimeStoragePaths.ts, acquireProjectWriteAuthority(), ensureSafeDirectory(), establishAuthorityClaim()]
- "runtime_runtimestoragepaths_isoutsiderelative": "isOutsideRelative()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L721 | neighbors=[RuntimeStoragePaths.ts, assertPathContained(), ensureSafeDirectory(), isPathInsideOrEqual()]
- "runtime_runtimestoragepaths_requireexactrealdirectory": "requireExactRealDirectory()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L645 | neighbors=[RuntimeStoragePaths.ts, ensureSafeDirectory(), requireContainedRealDirectory(), validateExistingDirectory()]
- "runtime_runtimestoragepaths_resolveruntimestorageconfiguration": "resolveRuntimeStorageConfiguration()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L198 | neighbors=[RuntimeStoragePaths.ts, createRuntimeStorageContext(), smoke-sprint-129-25b-1-runtime-hardenin…, smoke-sprint-129-25b-runtime-root.ts]
- "scripts_run_canonical_smoke_validation_inventory": "inventory()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L108 | neighbors=[run-canonical-smoke-validation.ts, digest(), runExternalValidatorSelfReview(), runHarness()]
- "scripts_run_canonical_smoke_validation_main": "main()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L172 | neighbors=[run-canonical-smoke-validation.ts, h(), runExternalValidatorSelfReview(), runHarness()]
- "scripts_smoke_assembly_scene_video_consumption_expectpreflightfailure": "expectPreflightFailure()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L279 | neighbors=[smoke-assembly-scene-video-consumption.…, fixture(), render(), Runner]
- "scripts_smoke_assembly_scene_video_consumption_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-assembly-scene-video-consumption.ts:L95 | neighbors=[smoke-assembly-scene-video-consumption.…, fixture(), box(), .run()]
- "scripts_smoke_pipeline_history_persistence_history": "history()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L34 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_history_persistence_historyevent": "historyEvent()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L18 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_history_persistence_writehistory": "writeHistory()" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L63 | neighbors=[smoke-pipeline-history-persistence.ts, testRenameFailurePreservesDestination(), testReplacementOrderingAndRetention(), testTempWriteFailurePreservesDestinatio…]
- "scripts_smoke_pipeline_state_corruption_testvalidpayloads": "testValidPayloads()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L171 | neighbors=[smoke-pipeline-state-corruption.ts, main(), readJobs(), writeRaw()]
- "scripts_smoke_pipeline_state_error_contract_testhistoryreadfailure": "testHistoryReadFailure()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L262 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse()]
- "scripts_smoke_pipeline_state_error_contract_testmainpipelinesingletypedlog": "testMainPipelineSingleTypedLog()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L602 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse()]
- "scripts_smoke_pipeline_state_error_contract_testreadfailure": "testReadFailure()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L209 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse()]
- "scripts_smoke_pipeline_state_error_contract_testretrystatepropagationandgenericfailures": "testRetryStatePropagationAndGenericFailures()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L446 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), assertSafeStateError(), readResponse()]
- "scripts_smoke_production_animation_provider_createproductionanimation": "createProductionAnimation()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L197 | neighbors=[smoke-production-animation-provider.ts, fixture(), productionProvider(), run()]
- "scripts_smoke_production_audio_asset_wiring_createwav": "createWav()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L187 | neighbors=[smoke-production-audio-asset-wiring.ts, createStoredOpenAIResult(), createRiff(), createWavChunk()]
- "scripts_smoke_production_audio_asset_wiring_readassets": "readAssets()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L291 | neighbors=[smoke-production-audio-asset-wiring.ts, expectSafeFailure(), assetsPath(), runFailureThroughRunner()]
- "scripts_smoke_production_audio_asset_wiring_run": "run()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L567 | neighbors=[smoke-production-audio-asset-wiring.ts, runFailureThroughRunner(), scenario(), setEnvironment()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L255 | neighbors=[smoke-production-durable-attempt-lineag…, canonicalAttempt(), canonicalClaim(), canonicalRecord()]
- "scripts_smoke_production_end_to_end_fixtureguardscenarios": "fixtureGuardScenarios()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L191 | neighbors=[smoke-production-end-to-end.ts, pass(), removeOwnedFixture(), run()]
- "scripts_smoke_production_end_to_end_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L293 | neighbors=[smoke-production-end-to-end.ts, box(), track(), .assemble()]
- "scripts_smoke_production_end_to_end_pass": "pass()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L217 | neighbors=[smoke-production-end-to-end.ts, expectFailure(), fixtureGuardScenarios(), run()]
- "scripts_smoke_production_end_to_end_png": "png()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L296 | neighbors=[smoke-production-end-to-end.ts, pngChunk(), .generateImage(), .generateThumbnailAsset()]
- "scripts_smoke_production_end_to_end_stabilization_explicitfailureprovider": "ExplicitFailureProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L256 | neighbors=[smoke-production-end-to-end-stabilizati…, .publish(), YouTubePublishProvider, failureCancellationAndValidation()]
- "scripts_smoke_production_end_to_end_stabilization_indeterminateprovider": "IndeterminateProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L261 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), .publish(), YouTubePublishProvider]
- "scripts_smoke_production_end_to_end_stabilization_mutateassets": "mutateAssets()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L198 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), pass(), resetPublish()]
- "scripts_smoke_production_end_to_end_stabilization_neverpackageprovider": "NeverPackageProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L266 | neighbors=[smoke-production-end-to-end-stabilizati…, happyPathAndReplay(), .generatePublishingPackage(), YouTubeProvider]
- "scripts_smoke_production_end_to_end_stabilization_publishedrecord": "publishedRecord()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L229 | neighbors=[smoke-production-end-to-end-stabilizati…, failureCancellationAndValidation(), reconciliationAndRestart(), recoveryPlannerConsistency()]
- "scripts_smoke_production_end_to_end_stabilization_setup": "setup()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L60 | neighbors=[smoke-production-end-to-end-stabilizati…, run(), minimalMp4(), png()]
- "scripts_smoke_production_end_to_end_throwingimageprovider": "ThrowingImageProvider" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L238 | neighbors=[smoke-production-end-to-end.ts, run(), ImageProvider, .generateImage()]
- "scripts_smoke_production_execution_coordinator_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L38 | neighbors=[smoke-production-execution-coordinator.…, request(), setup(), tree()]
- "scripts_smoke_production_execution_idempotency_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-idempotency.ts:L22 | neighbors=[smoke-production-execution-idempotency.…, record(), reservation(), transition()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-057.json

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
