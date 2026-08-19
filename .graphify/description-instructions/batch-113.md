# Node Description Batch 114 of 166

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

- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_latestdurablepath": "latestDurablePath()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L943 | neighbors=[smoke-sprint-129-28-production-acceptan…, poisonRunningAttempt()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_poisonlatestrunningattempt": "poisonLatestRunningAttempt()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1002 | neighbors=[smoke-sprint-129-28-production-acceptan…, rewriteJsonFile()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_readyworker": "readyWorker()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L421 | neighbors=[smoke-sprint-129-28-production-acceptan…, withDirectCapabilityEvidence()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_seedactivedurablestate": "seedActiveDurableState()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L332 | neighbors=[smoke-sprint-129-28-production-acceptan…, verifyRecordLevelParity()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childresult": "childResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L92 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, childMain()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L207 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, test()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_normalizedenvironmentkey": "normalizedEnvironmentKey()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L80 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, sensitiveEnvironmentKey()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_sensitiveenvironmentkey": "sensitiveEnvironmentKey()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L84 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, normalizedEnvironmentKey()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L46 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, main()]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_waitforfile": "waitForFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L129 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, childMain()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L119 | neighbors=[smoke-sprint-129-30-persistence-boundar…, test()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter_listkeys": ".listKeys()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L75 | neighbors=[OneShotPersistenceFaultAdapter, .matches()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter_read": ".read()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L64 | neighbors=[OneShotPersistenceFaultAdapter, .matches()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_persistenceversion": "persistenceVersion()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L98 | neighbors=[smoke-sprint-129-30-persistence-boundar…, .write()]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_finitechunk": "finiteChunk()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L49 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, finiteWav()]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_sentinelchunkedwav": "sentinelChunkedWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L102 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, sentinelWav()]
- "scripts_smoke_sprint_129_32_retry_durable_attempt_ordinal_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-32-retry-durable-attempt-ordinal.ts:L36 | neighbors=[smoke-sprint-129-32-retry-durable-attem…, test()]
- "scripts_smoke_sprint_129_32_retry_durable_attempt_ordinal_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-32-retry-durable-attempt-ordinal.ts:L26 | neighbors=[smoke-sprint-129-32-retry-durable-attem…, main()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_captureboundaries": "captureBoundaries()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L507 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertRejected()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_clidependencies": "cliDependencies()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L1871 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertSafeCli()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_runactualcliprocess": "runActualCliProcess()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L193 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, childEnvironment()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_spawnlockchild": "spawnLockChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L99 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, childEnvironment()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_spawnpathracechild": "spawnPathRaceChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L120 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, childEnvironment()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_createactiveauthority": "createActiveAuthority()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L528 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, writeJob()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L69 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, writeJob()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_syntheticidentity": "syntheticIdentity()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L223 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, identityValidAdapter()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_withleaseintegrity": "withLeaseIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L270 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, identityValidAdapter()]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_converthistoricallineagestov1legacy": "convertHistoricalLineagesToV1Legacy()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L177 | neighbors=[smoke-sprint-129-35-legacy-global-quies…, createMixedProductionTopologyFixture()]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_writejoblist": "writeJobList()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L274 | neighbors=[smoke-sprint-129-35-legacy-global-quies…, createMixedProductionTopologyFixture()]
- "scripts_smoke_sprint_129_36_race_worker_emitresult": "emitResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L169 | neighbors=[smoke-sprint-129-36-race-worker.ts, run()]
- "scripts_smoke_sprint_129_36_race_worker_run": "run()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L33 | neighbors=[smoke-sprint-129-36-race-worker.ts, emitResult()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_assertnocleanuplinks": "assertNoCleanupLinks()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L178 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, cleanupOwnedTempRoot()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_finddurableartifact": "findDurableArtifact()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L719 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, runExactRewindOwnershipRegression()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_fixtures": "fixtures()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L45 | neighbors=[smoke-sprint-129-37-assembly-truncation…, generateWith()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_generatewith": "generateWith()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L174 | neighbors=[smoke-sprint-129-37-assembly-truncation…, fixtures()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L146 | neighbors=[smoke-sprint-129-37-assembly-truncation…, main()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_result": "result()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L159 | neighbors=[smoke-sprint-129-37-assembly-truncation…, main()]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L35 | neighbors=[smoke-sprint-129-37-assembly-truncation…, main()]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L282 | neighbors=[smoke-sprint-129-38-cross-stage-settled…, test()]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_runrewindpreflightregression": "runRewindPreflightRegression()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L186 | neighbors=[smoke-sprint-129-38-cross-stage-settled…, treeDigest()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-113.json

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
