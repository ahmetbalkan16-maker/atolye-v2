# Node Description Batch 154 of 166

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

- "scripts_smoke_sprint_129_25c_1_runtime_backup_waitforfile": "waitForFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1641 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_withcopyfileinterceptor": "withCopyFileInterceptor()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1488 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_withreadfilesyncinterceptor": "withReadFileSyncInterceptor()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1523 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_withrmdirsyncinterceptor": "withRmdirSyncInterceptor()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1567 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_withrmsyncinterceptor": "withRmSyncInterceptor()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1508 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_withwritefilesyncinterceptor": "withWriteFileSyncInterceptor()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1544 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_writefilesync": "WriteFileSync" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1485 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_ispermissionorunsupported": "isPermissionOrUnsupported()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L633 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_recordunsupportedskip": "recordUnsupportedSkip()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L628 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_repositoryroot": "repositoryRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L31 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_runchild": "runChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L607 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L54 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_mutablecandidate": "MutableCandidate" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L34 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_mutatemanifest": "mutateManifest()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L77 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_platformresults": "platformResults" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L33 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_treesnapshot": "treeSnapshot()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L62 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_assertnomutations": "assertNoMutations()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L335 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_createcandidate": "createCandidate()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L162 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_current": "current()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L76 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L81 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_expectsafecode": "expectSafeCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L208 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_fixture": "Fixture" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L35 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_instrumentedcounters": "InstrumentedCounters" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L47 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_iswithin": "isWithin()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L324 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_iswriteflag": "isWriteFlag()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L329 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_mutablefs": "MutableFs" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L271 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_platformresults": "platformResults" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L31 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_rewritecandidatemanifest": "rewriteCandidateManifest()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L221 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_snapshot": "snapshot()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L343 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_withrootmutationspy": "withRootMutationSpy()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L273 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…]
- "scripts_smoke_sprint_129_25c_2b_4_runtime_context_countfilesifpresent": "countFilesIfPresent()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-4-runtime-context.ts:L1174 | neighbors=[smoke-sprint-129-25c-2b-4-runtime-conte…]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_environment": "environment()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L52 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L122 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_script": "script()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L56 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…]
- "scripts_smoke_sprint_129_27_audio_remediation_assertaudioroot": "assertAudioRoot()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L362 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_audiointentroot": "audioIntentRoot()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L673 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_audiorunner": "audioRunner" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L426 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_audiorunnerharness": "AudioRunnerHarness" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L412 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_chunkedwav": "chunkedWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L246 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_concurrentsaveresult": "ConcurrentSaveResult" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L986 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-153.json

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
