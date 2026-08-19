# Node Description Batch 158 of 166

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

- "scripts_smoke_sprint_129_5_production_acceptance_topic_createmarker": "createMarker()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L70 | neighbors=[smoke-sprint-129-5-production-acceptanc…]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L77 | neighbors=[smoke-sprint-129-5-production-acceptanc…]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_readiness": "readiness" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L27 | neighbors=[smoke-sprint-129-5-production-acceptanc…]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_recursivefiles": "recursiveFiles()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L264 | neighbors=[smoke-sprint-129-5-production-acceptanc…]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_test": "test()" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L43 | neighbors=[smoke-sprint-129-5-production-acceptanc…]
- "scripts_smoke_sprint_129_7_research_structured_output_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L78 | neighbors=[smoke-sprint-129-7-research-structured-…]
- "scripts_smoke_sprint_129_7_research_structured_output_provider": "provider()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L68 | neighbors=[smoke-sprint-129-7-research-structured-…]
- "scripts_smoke_sprint_129_7_research_structured_output_providerresearch": "providerResearch()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L41 | neighbors=[smoke-sprint-129-7-research-structured-…]
- "scripts_smoke_sprint_129_7_research_structured_output_providerresult": "providerResult()" | kind=code-symbol | source=scripts/smoke-sprint-129-7-research-structured-output.ts:L54 | neighbors=[smoke-sprint-129-7-research-structured-…]
- "scripts_smoke_sprint_129_9_failed_stage_resume_digestdirectory": "digestDirectory()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L31 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…]
- "scripts_smoke_sprint_129_9_failed_stage_resume_sourceroot": "sourceRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L17 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…]
- "scripts_validate_canonical_smoke_evidence_child": "child()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L386 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_hashfile": "hashFile()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L394 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_partition": "partition()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L387 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_recordvalue": "RecordValue" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L11 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_rootprewriteinvariants": "rootPrewriteInvariants()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L178 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_sourceroot": "sourceRoot" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L12 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_stdout": "stdout()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L388 | neighbors=[validate-canonical-smoke-evidence.ts]
- "scripts_validate_canonical_smoke_evidence_testroot": "testRoot" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L15 | neighbors=[validate-canonical-smoke-evidence.ts]
- "security_guardedruntimemutationsession_atomicruntimebackupcreaterequest": "AtomicRuntimeBackupCreateRequest" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L80 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_atomicruntimebackupcreateresult": "AtomicRuntimeBackupCreateResult" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L89 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_atomicruntimebackuprestorerequest": "AtomicRuntimeBackupRestoreRequest" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L95 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_atomicruntimebackuprestoreresult": "AtomicRuntimeBackupRestoreResult" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L104 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_guardedruntimefilesystem_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L126 | neighbors=[GuardedRuntimeFilesystem]
- "security_guardedruntimemutationsession_guardedruntimemutationsessionoptions": "GuardedRuntimeMutationSessionOptions" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L69 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_ownedruntimedirectoryadapter": "OwnedRuntimeDirectoryAdapter" | kind=code-symbol | neighbors=[GuardedRuntimeMutationSession]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L884 | neighbors=[RuntimeBackupCreateGuardedOperationImpl]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_partialdirectory": ".partialDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L889 | neighbors=[RuntimeBackupCreateGuardedOperationImpl]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L998 | neighbors=[RuntimeBackupRestoreGuardedOperationImpl]
- "security_guardedruntimemutationsession_runtimemutationreservation": "RuntimeMutationReservation" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L65 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_runtimemutationreservationstate": "RuntimeMutationReservationState" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L114 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_scopedruntimemutationpathvalidator": "ScopedRuntimeMutationPathValidator" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L109 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_guardedruntimemutationsession_sessionconstructionkey": "sessionConstructionKey" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L120 | neighbors=[GuardedRuntimeMutationSession.ts]
- "security_ownedruntimedirectory_ownedruntimedirectory_absolutepath": ".absolutePath()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L60 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_cleanup": ".cleanup()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L95 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_closesessionretainingownership": ".closeSessionRetainingOwnership()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L103 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L55 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_copyfileexclusive": ".copyFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L79 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_ensuredirectory": ".ensureDirectory()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L64 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_publishfileexclusive": ".publishFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L87 | neighbors=[OwnedRuntimeDirectory]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-157.json

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
