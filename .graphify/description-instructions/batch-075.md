# Node Description Batch 76 of 166

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "roadmap_sprint_42": "Sprint 42 - Video Engine Foundation" | kind=entity | source=ROADMAP.md:904 | neighbors=[Sprint 115 - Production Video Assembly …, Sprint 117 - Production Scene Video Ren…, Sprint 48 - Final Pipeline Integration]
- "roadmap_sprint_99_1": "Sprint 99.1 - Durable Storage Recovery & Index Hardening" | kind=entity | source=ROADMAP.md:1854 | neighbors=[Sprint 100 - Durable Lease & Worker Own…, Sprint 129.25 C.2A - Guarded Filesystem…, Sprint 98.0 - Production Execution Pers…]
- "runtime_productionruntimeoperationcontext_requirestoragecontext": "requireStorageContext()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L172 | neighbors=[ProductionRuntimeOperationContext.ts, createProductionRuntimeOperationContext…, ProductionRuntimeOperationContextError]
- "runtime_productionruntimeoperationcontext_sameauthority": "sameAuthority()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L192 | neighbors=[ProductionRuntimeOperationContext.ts, assertProductionRuntimeOperationAuthori…, assertProductionRuntimeOperationContext…]
- "runtime_runtimeoperationscope_getactiveruntimeoperationscope": "getActiveRuntimeOperationScope()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L93 | neighbors=[RuntimeOperationScope.ts, activeStore(), RuntimeStoragePaths.ts]
- "runtime_runtimeoperationscope_requireactiveproductionruntimeoperationcontext": "requireActiveProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L63 | neighbors=[ProductionRuntimeOperationContext.ts, RuntimeOperationScope.ts, getActiveProductionRuntimeOperationCont…]
- "runtime_runtimeoperationscope_requireexactactiveproductionruntimeoperationcontext": "requireExactActiveProductionRuntimeOperationContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L74 | neighbors=[ProductionRuntimeOperationContext.ts, RuntimeOperationScope.ts, getActiveProductionRuntimeOperationCont…]
- "runtime_runtimestoragepaths_digest": "digest()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L748 | neighbors=[RuntimeStoragePaths.ts, authorityClaim(), authorityIdentity()]
- "runtime_runtimestoragepaths_getprojectsroot": "getProjectsRoot()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L208 | neighbors=[ProjectReader.ts, RuntimeStoragePaths.ts, resolveRuntimeStorageContext()]
- "runtime_runtimestoragepaths_isportableruntimepathsegment": "isPortableRuntimePathSegment()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L677 | neighbors=[RuntimeBackupManifest.ts, RuntimeStoragePaths.ts, requireMachineSegment()]
- "runtime_runtimestoragepaths_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L756 | neighbors=[RuntimeStoragePaths.ts, isRuntimeStorageContext(), requireMatchingAuthorityClaim()]
- "runtime_runtimestoragepaths_isruntimestoragecontext": "isRuntimeStorageContext()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L752 | neighbors=[RuntimeStoragePaths.ts, isRecord(), resolveRuntimeStorageContext()]
- "runtime_runtimestoragepaths_normalizedforidentity": "normalizedForIdentity()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L743 | neighbors=[RuntimeStoragePaths.ts, authorityClaim(), authorityIdentity()]
- "runtime_runtimestoragepaths_readauthorityowner": "readAuthorityOwner()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L350 | neighbors=[RuntimeStoragePaths.ts, assertProjectWriteAuthorityLease(), RuntimeStorageError]
- "runtime_runtimestoragepaths_requiresafesegment": "requireSafeSegment()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L663 | neighbors=[RuntimeStoragePaths.ts, requireMachineSegment(), RuntimeStorageError]
- "scripts_run_canonical_smoke_validation_assertterminalresult": "assertTerminalResult()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L93 | neighbors=[run-canonical-smoke-validation.ts, runExternalValidatorSelfReview(), runHarness()]
- "scripts_run_canonical_smoke_validation_digest": "digest()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L164 | neighbors=[run-canonical-smoke-validation.ts, fileHash(), inventory()]
- "scripts_run_canonical_smoke_validation_h": "h()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L63 | neighbors=[run-canonical-smoke-validation.ts, main(), runExternalValidatorSelfReview()]
- "scripts_runtime_backup_main": "main()" | kind=code-symbol | source=scripts/runtime-backup.ts:L24 | neighbors=[runtime-backup.ts, argument(), report()]
- "scripts_smoke_pipeline_state_corruption_readjobs": "readJobs()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L62 | neighbors=[smoke-pipeline-state-corruption.ts, testMissingFiles(), testValidPayloads()]
- "scripts_smoke_pipeline_state_corruption_testmissingfiles": "testMissingFiles()" | kind=code-symbol | source=scripts/smoke-pipeline-state-corruption.ts:L89 | neighbors=[smoke-pipeline-state-corruption.ts, main(), readJobs()]
- "scripts_smoke_pipeline_state_error_contract_testnotfoundandunexpectederror": "testNotFoundAndUnexpectedError()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L409 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), readResponse()]
- "scripts_smoke_pipeline_state_error_contract_testretryconflict": "testRetryConflict()" | kind=code-symbol | source=scripts/smoke-pipeline-state-error-contract.ts:L367 | neighbors=[smoke-pipeline-state-error-contract.ts, main(), readResponse()]
- "scripts_smoke_production_animation_provider_plan": "plan()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L75 | neighbors=[smoke-production-animation-provider.ts, openAIResponse(), frame()]
- "scripts_smoke_production_animation_provider_productionprovider": "productionProvider()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L96 | neighbors=[smoke-production-animation-provider.ts, createProductionAnimation(), configuredAnimationProvider()]
- "scripts_smoke_production_animation_provider_run": "run()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L215 | neighbors=[smoke-production-animation-provider.ts, createProductionAnimation(), scenario()]
- "scripts_smoke_production_animation_provider_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L51 | neighbors=[smoke-production-animation-provider.ts, main(), run()]
- "scripts_smoke_production_animation_provider_verifyassembly": "verifyAssembly()" | kind=code-symbol | source=scripts/smoke-production-animation-provider.ts:L743 | neighbors=[smoke-production-animation-provider.ts, assemblyProvider(), wav()]
- "scripts_smoke_production_audio_asset_wiring_assetspath": "assetsPath()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L287 | neighbors=[smoke-production-audio-asset-wiring.ts, expectWriteFreeFailure(), readAssets()]
- "scripts_smoke_production_audio_asset_wiring_createprovider": "createProvider()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L225 | neighbors=[smoke-production-audio-asset-wiring.ts, expectWriteFreeFailure(), runFailureThroughRunner()]
- "scripts_smoke_production_audio_asset_wiring_createrunnerfixture": "createRunnerFixture()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L409 | neighbors=[smoke-production-audio-asset-wiring.ts, createExecutionState(), runFailureThroughRunner()]
- "scripts_smoke_production_audio_asset_wiring_createwavchunk": "createWavChunk()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L207 | neighbors=[smoke-production-audio-asset-wiring.ts, createProductionStreamingSentinelWav(), createWav()]
- "scripts_smoke_production_audio_asset_wiring_expectwritefreefailure": "expectWriteFreeFailure()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L359 | neighbors=[smoke-production-audio-asset-wiring.ts, assetsPath(), createProvider()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_canonicalattempt": "canonicalAttempt()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L231 | neighbors=[smoke-production-durable-attempt-lineag…, journal(), createFixture()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_canonicalrecord": "canonicalRecord()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L192 | neighbors=[smoke-production-durable-attempt-lineag…, identityFor(), createFixture()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_expectrejected": "expectRejected()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L374 | neighbors=[smoke-production-durable-attempt-lineag…, scenario(), main()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_main": "main()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L411 | neighbors=[smoke-production-durable-attempt-lineag…, expectRejected(), scenario()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L337 | neighbors=[smoke-production-durable-attempt-lineag…, expectRejected(), main()]
- "scripts_smoke_production_end_to_end_box": "box()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L295 | neighbors=[smoke-production-end-to-end.ts, mp4(), track()]
- "scripts_smoke_production_end_to_end_expectfailure": "expectFailure()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L173 | neighbors=[smoke-production-end-to-end.ts, pass(), run()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-075.json

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
