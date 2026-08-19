# Node Description Batch 156 of 166

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

- "scripts_smoke_sprint_129_29_failed_terminal_settlement_spawnchild": "spawnChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L182 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_withattemptintegrity": "withAttemptIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L115 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_withclaimintegrity": "withClaimIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L108 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_withleaseintegrity": "withLeaseIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L122 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_controlledfailure": "controlledFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L115 | neighbors=[smoke-sprint-129-30-persistence-boundar…]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_faultoperation": "FaultOperation" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L33 | neighbors=[smoke-sprint-129-30-persistence-boundar…]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_faultspec": "FaultSpec" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L34 | neighbors=[smoke-sprint-129-30-persistence-boundar…]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_oneshotpersistencefaultadapter_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L47 | neighbors=[OneShotPersistenceFaultAdapter]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_productionexecutionpersistenceadapter": "ProductionExecutionPersistenceAdapter" | kind=code-symbol | neighbors=[OneShotPersistenceFaultAdapter]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_assertinvalid": "assertInvalid()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L119 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L126 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L18 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…]
- "scripts_smoke_sprint_129_32_retry_durable_attempt_ordinal_controlledfailure": "controlledFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-32-retry-durable-attempt-ordinal.ts:L32 | neighbors=[smoke-sprint-129-32-retry-durable-attem…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_capturedboundarytotals": "capturedBoundaryTotals" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L72 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_controlledfailure": "controlledFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L219 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L267 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_findquarantineleaves": "findQuarantineLeaves()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L179 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_invocationcounters": "InvocationCounters" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L225 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_preparevaliddrift": "prepareValidDrift()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L613 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_racemutationcounters": "RaceMutationCounters" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L153 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_readreplacementevidence": "readReplacementEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L162 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_replacementevidence": "ReplacementEvidence" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L145 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_statesnapshot": "StateSnapshot" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L239 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_waitforfile": "waitForFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L211 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_withclaimintegrity": "withClaimIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L585 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_withfixture": "withFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L246 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_withleaseintegrity": "withLeaseIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L573 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_writeseedevidence": "writeSeedEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L619 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_adapterwithreadmutation": "adapterWithReadMutation()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L167 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_assertcompletesyntheticlineagevalid": "assertCompleteSyntheticLineageValid()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L407 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_assertintegrityvalidrecord": "assertIntegrityValidRecord()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L385 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_classify": "classify()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L157 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_durablephysicalsnapshot": "DurablePhysicalSnapshot" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L189 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L578 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L63 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_withclaimintegrity": "withClaimIntegrity()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L182 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_adapterwithreadmutation": "adapterWithReadMutation()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L321 | neighbors=[smoke-sprint-129-35-legacy-global-quies…]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_durablephysicalsnapshot": "DurablePhysicalSnapshot" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L280 | neighbors=[smoke-sprint-129-35-legacy-global-quies…]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L336 | neighbors=[smoke-sprint-129-35-legacy-global-quies…]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L47 | neighbors=[smoke-sprint-129-35-legacy-global-quies…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-155.json

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
