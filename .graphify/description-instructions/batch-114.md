# Node Description Batch 115 of 166

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

- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L66 | neighbors=[smoke-sprint-129-38-cross-stage-settled…, main()]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_treedigest": "treeDigest()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L76 | neighbors=[smoke-sprint-129-38-cross-stage-settled…, runRewindPreflightRegression()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_commandcontract": "commandContract()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L309 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L152 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_treedigest": "treeDigest()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L602 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, invalidBoundary()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixtureassemblyprovider_assemble": ".assemble()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L222 | neighbors=[FixtureAssemblyProvider, mp4()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_observeboundedresume": "observeBoundedResume()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L235 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_observedcount": "observedCount()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L243 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_preparationworker": "preparationWorker()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L275 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, write()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_publishrecord": "publishRecord()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L323 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_readyworker": "readyWorker()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L254 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_spawnpreparationworker": "spawnPreparationWorker()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L305 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_treedigest": "treeDigest()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L518 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main()]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_commanderror": "commandError()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L60 | neighbors=[smoke-sprint-129-5-production-acceptanc…, dependencies()]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_dependencies": "dependencies()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L49 | neighbors=[smoke-sprint-129-5-production-acceptanc…, commandError()]
- "scripts_smoke_sprint_129_7_research_structured_output_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L87 | neighbors=[smoke-sprint-129-7-research-structured-…, test()]
- "scripts_smoke_sprint_129_7_research_structured_output_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L35 | neighbors=[smoke-sprint-129-7-research-structured-…, main()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_currentfailedjob": "currentFailedJob()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L96 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, readJson()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_pass": "pass()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L21 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, main()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_readjson": "readJson()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L27 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, currentFailedJob()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_runboundedclifailure": "runBoundedCliFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L103 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, main()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_seedvisualsfailurefixture": "seedVisualsFailureFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L56 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, createFixture()]
- "scripts_validate_canonical_smoke_evidence_cleanupreplacementinvariant": "cleanupReplacementInvariant()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L227 | neighbors=[validate-canonical-smoke-evidence.ts, temporaryCleanupInvariants()]
- "scripts_validate_canonical_smoke_evidence_ownedtemporarycleanupinvariant": "ownedTemporaryCleanupInvariant()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L276 | neighbors=[validate-canonical-smoke-evidence.ts, temporaryCleanupInvariants()]
- "scripts_validate_canonical_smoke_evidence_provenancereject": "provenanceReject()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L309 | neighbors=[validate-canonical-smoke-evidence.ts, reject()]
- "scripts_validate_canonical_smoke_evidence_record": "record()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L393 | neighbors=[validate-canonical-smoke-evidence.ts, forgeInventory()]
- "scripts_validate_canonical_smoke_evidence_sameinodemutationinvariant": "sameInodeMutationInvariant()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L250 | neighbors=[validate-canonical-smoke-evidence.ts, temporaryCleanupInvariants()]
- "scripts_validate_canonical_smoke_evidence_writeraw": "writeRaw()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L392 | neighbors=[validate-canonical-smoke-evidence.ts, mutate()]
- "scripts_validate_canonical_smoke_evidence_writerintegrityinvariants": "writerIntegrityInvariants()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L163 | neighbors=[validate-canonical-smoke-evidence.ts, exact()]
- "security_guardedruntimemutationsession_assertexactinventory": "assertExactInventory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1204 | neighbors=[GuardedRuntimeMutationSession.ts, .createVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_atomicmaterializedmutationpath": "atomicMaterializedMutationPath()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1291 | neighbors=[GuardedRuntimeMutationSession.ts, preflightAtomicRestoreMaterialization()]
- "security_guardedruntimemutationsession_beginruntimemutationrequest": "BeginRuntimeMutationRequest" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L74 | neighbors=[GuardedRuntimeFilesystem.ts, GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_createv3manifest": "createV3Manifest()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1187 | neighbors=[GuardedRuntimeMutationSession.ts, .createVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_guardedruntimefilesystem_beginruntimebackupmutationkey": ".[beginRuntimeBackupMutationKey]()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L324 | neighbors=[GuardedRuntimeFilesystem, .beginMutationWithValidator()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_copyownedfileexclusive": ".copyOwnedFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L564 | neighbors=[GuardedRuntimeMutationSession, .publicBoundary()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_publishownedfileexclusive": ".publishOwnedFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L587 | neighbors=[GuardedRuntimeMutationSession, .publicBoundary()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_writeownedfileexclusive": ".writeOwnedFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L537 | neighbors=[GuardedRuntimeMutationSession, .publicBoundary()]
- "security_guardedruntimemutationsession_ishardlinkunavailable": "isHardLinkUnavailable()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1511 | neighbors=[GuardedRuntimeMutationSession.ts, guardedExclusiveMutation()]
- "security_guardedruntimemutationsession_istargetexists": "isTargetExists()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1506 | neighbors=[GuardedRuntimeMutationSession.ts, guardedExclusiveMutation()]
- "security_guardedruntimemutationsession_portablecasekey": "portableCaseKey()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1502 | neighbors=[GuardedRuntimeMutationSession.ts, .assertPortableCollisionAvailable()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-114.json

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
