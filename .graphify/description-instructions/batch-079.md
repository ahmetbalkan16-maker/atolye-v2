# Node Description Batch 80 of 166

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

- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childmain": "childMain()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L138 | neighbors=[smoke-sprint-129-29-failed-terminal-set…, childResult(), waitForFile()]
- "scripts_smoke_sprint_129_30_persistence_boundary_retry_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-30-persistence-boundary-retry.ts:L109 | neighbors=[smoke-sprint-129-30-persistence-boundar…, main(), .write()]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_finitewav": "finiteWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L57 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, finiteChunk(), formatBytes()]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_formatbytes": "formatBytes()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L24 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, finiteWav(), sentinelWav()]
- "scripts_smoke_sprint_129_31_openai_streaming_wav_sentinelwav": "sentinelWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L70 | neighbors=[smoke-sprint-129-31-openai-streaming-wa…, formatBytes(), sentinelChunkedWav()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_assertrejected": "assertRejected()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L592 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertZero(), captureBoundaries()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_assertsafecli": "assertSafeCli()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L1879 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, cliDependencies(), test()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_assertzero": "assertZero()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L496 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, assertRejected(), main()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_clievidence": "cliEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L1901 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, test(), main()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_hostilematrix": "hostileMatrix()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L870 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, test(), main()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_manifestseedevidence": "manifestSeedEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L651 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, main(), test()]
- "scripts_smoke_sprint_129_33_exhausted_retry_admission_retryandrecoveryevidence": "retryAndRecoveryEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-33-exhausted-retry-admission.ts:L1366 | neighbors=[smoke-sprint-129-33-exhausted-retry-adm…, main(), test()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_identityvalidadapter": "identityValidAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L277 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, syntheticIdentity(), withLeaseIntegrity()]
- "scripts_smoke_sprint_129_34_queued_exhausted_run_type_writejob": "writeJob()" | kind=code-symbol | source=scripts/smoke-sprint-129-34-queued-exhausted-run-type.ts:L151 | neighbors=[smoke-sprint-129-34-queued-exhausted-ru…, createActiveAuthority(), createFixture()]
- "scripts_smoke_sprint_129_35_legacy_global_quiescence_createmixedproductiontopologyfixture": "createMixedProductionTopologyFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-35-legacy-global-quiescence.ts:L58 | neighbors=[smoke-sprint-129-35-legacy-global-quies…, convertHistoricalLineagesToV1Legacy(), writeJobList()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runparsertests": "runParserTests()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L235 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assert(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_runsettlementrecoverytest": "runSettlementRecoveryTest()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L492 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assert(), runSmokeSuite()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_observeresume": "observeResume()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L481 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_observeresumefailure": "observeResumeFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L499 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedFailure(), legacyUnbounded()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_providerdispatchesafter": "providerDispatchesAfter()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L552 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_assertownedtempmutationtarget": "assertOwnedTempMutationTarget()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L86 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, Fixture, republishCanonicalAudioFixture()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_check": "check()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L80 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, assertSupersessionPrecommitRejection(), main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_mp4": "mp4()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L129 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, Fixture, .assemble()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_plan": "plan()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L532 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, assertSupersessionPrecommitRejection(), main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_publishcanonicalaudiofixture": "publishCanonicalAudioFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L139 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, Fixture, republishCanonicalAudioFixture()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_wav": "wav()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L117 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, Fixture, write()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L44 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, seedVisualsFailureFixture(), withFixture()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_withfixture": "withFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L85 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, main(), createFixture()]
- "scripts_validate_canonical_smoke_evidence_cleanupreadfailureinvariant": "cleanupReadFailureInvariant()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L285 | neighbors=[validate-canonical-smoke-evidence.ts, exact(), temporaryCleanupInvariants()]
- "scripts_validate_canonical_smoke_evidence_makeinterrupted": "makeInterrupted()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L359 | neighbors=[validate-canonical-smoke-evidence.ts, orchestratorFiles(), resumeReject()]
- "scripts_validate_canonical_smoke_evidence_read": "read()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L389 | neighbors=[validate-canonical-smoke-evidence.ts, forgeInventory(), mutate()]
- "scripts_validate_canonical_smoke_evidence_resumereject": "resumeReject()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L311 | neighbors=[validate-canonical-smoke-evidence.ts, copyFixture(), makeInterrupted()]
- "scripts_validate_canonical_smoke_evidence_statidentity": "statIdentity()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L383 | neighbors=[validate-canonical-smoke-evidence.ts, authorityFor(), normalize()]
- "security_guardedruntimemutationsession_assertexactatomickeys": "assertExactAtomicKeys()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1341 | neighbors=[GuardedRuntimeMutationSession.ts, assertAtomicCreateRoots(), assertAtomicRestoreRoots()]
- "security_guardedruntimemutationsession_assertidentity": "assertIdentity()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1460 | neighbors=[GuardedRuntimeMutationSession.ts, identityMatches(), guardedExclusiveMutation()]
- "security_guardedruntimemutationsession_beginruntimebackupmutationkey": "beginRuntimeBackupMutationKey" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L121 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateRuntimeBackupCreateOperatio…, beginPrivateRuntimeBackupRestoreOperati…]
- "security_guardedruntimemutationsession_decodeatomiccreaterequest": "decodeAtomicCreateRequest()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1145 | neighbors=[GuardedRuntimeMutationSession.ts, invalidPath(), .createVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_decodeatomicrestorerequest": "decodeAtomicRestoreRequest()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1165 | neighbors=[GuardedRuntimeMutationSession.ts, invalidPath(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_guardedruntimefilesystem_beginmutation": ".beginMutation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L128 | neighbors=[beginPrivateLegacyRuntimeBackupRestoreO…, GuardedRuntimeFilesystem, .beginMutationWithValidator()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_acquireexclusivereservation": ".acquireExclusiveReservation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L472 | neighbors=[GuardedRuntimeMutationSession, .publicBoundary(), .publishVerified()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-079.json

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
