# Node Description Batch 113 of 166

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

- "scripts_smoke_sprint_129_25b_runtime_root_sha256": "sha256()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L51 | neighbors=[smoke-sprint-129-25b-runtime-root.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_createfixture": "createFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1298 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_initializegitfixture": "initializeGitFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1319 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_runconcurrentcreatechild": "runConcurrentCreateChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1600 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_runsourcedriftchild": "runSourceDriftChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1629 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_runtimediff": "runtimeDiff()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L65 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L55 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_sha256": "sha256()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L61 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts, main()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_completeprotectedinputs": "completeProtectedInputs()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L538 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, guardedForRoot()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_initializegitfixture": "initializeGitFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L555 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, main()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_publishchild": "publishChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L587 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, main()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L35 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, main()]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L48 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…, main()]
- "scripts_smoke_sprint_129_25c_2b_1_migration_candidate_writejsonfile": "writeJsonFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-1-migration-candidate.ts:L58 | neighbors=[smoke-sprint-129-25c-2b-1-migration-can…, main()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_runwithfixture": "runWithFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L70 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, scenario()]
- "scripts_smoke_sprint_129_25c_2b_2_migration_candidate_create_writejson": "writeJson()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-2-migration-candidate-create.ts:L86 | neighbors=[smoke-sprint-129-25c-2b-2-migration-can…, createFixture()]
- "scripts_smoke_sprint_129_25c_2b_4_runtime_context_initialization": "initialization()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-4-runtime-context.ts:L1151 | neighbors=[smoke-sprint-129-25c-2b-4-runtime-conte…, main()]
- "scripts_smoke_sprint_129_25c_2b_4_runtime_context_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2b-4-runtime-context.ts:L41 | neighbors=[smoke-sprint-129-25c-2b-4-runtime-conte…, initialization()]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_audioresponse": "audioResponse()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L86 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…, result()]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_digest": "digest()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L38 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…, main()]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_result": "result()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L110 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…, audioResponse()]
- "scripts_smoke_sprint_129_26_audio_truncation_budget_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-26-audio-truncation-budget.ts:L32 | neighbors=[smoke-sprint-129-26-audio-truncation-bu…, main()]
- "scripts_smoke_sprint_129_27_audio_remediation_audiodata": "audioData()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L267 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, renderWithRealAssemblyConsumer()]
- "scripts_smoke_sprint_129_27_audio_remediation_basicfmtbytes": "basicFmtBytes()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L263 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, customWav()]
- "scripts_smoke_sprint_129_27_audio_remediation_compensationquarantinepath": "compensationQuarantinePath()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L207 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, compensationWorkspacePath()]
- "scripts_smoke_sprint_129_27_audio_remediation_compensationworkspacepath": "compensationWorkspacePath()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L193 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, compensationQuarantinePath()]
- "scripts_smoke_sprint_129_27_audio_remediation_createregistryownedfixture": "createRegistryOwnedFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L601 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, wav()]
- "scripts_smoke_sprint_129_27_audio_remediation_createtwophaseregistryownedfixture": "createTwoPhaseRegistryOwnedFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L637 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, wav()]
- "scripts_smoke_sprint_129_27_audio_remediation_customwav": "customWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L126 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, basicFmtBytes()]
- "scripts_smoke_sprint_129_27_audio_remediation_latestdurableattempt": "latestDurableAttempt()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L458 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, assertFullAudioFailureChain()]
- "scripts_smoke_sprint_129_27_audio_remediation_minimalmp4": "minimalMp4()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L118 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, mp4Box()]
- "scripts_smoke_sprint_129_27_audio_remediation_mp4box": "mp4Box()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L110 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, minimalMp4()]
- "scripts_smoke_sprint_129_27_audio_remediation_removeregistryrecord": "removeRegistryRecord()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L310 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, withProjectAuthority()]
- "scripts_smoke_sprint_129_27_audio_remediation_renderwithrealassemblyconsumer": "renderWithRealAssemblyConsumer()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L716 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, audioData()]
- "scripts_smoke_sprint_129_27_audio_remediation_runconcurrentsavechildren": "runConcurrentSaveChildren()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L1000 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, wav()]
- "scripts_smoke_sprint_129_27_audio_remediation_runsavechild": "runSaveChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L903 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, wav()]
- "scripts_smoke_sprint_129_27_audio_remediation_scriptfixture": "scriptFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L428 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, assertFullAudioFailureChain()]
- "scripts_smoke_sprint_129_27_audio_remediation_withprojectauthority": "withProjectAuthority()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L297 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, removeRegistryRecord()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_createfixtureruntimestoragecontext": "createFixtureRuntimeStorageContext()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L169 | neighbors=[smoke-sprint-129-28-production-acceptan…, withDirectCapabilityEvidence()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_installrecordopenrace": "installRecordOpenRace()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1079 | neighbors=[smoke-sprint-129-28-production-acceptan…, verifyRecordLevelParity()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-112.json

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
