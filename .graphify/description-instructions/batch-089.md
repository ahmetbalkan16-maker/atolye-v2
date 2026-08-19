# Node Description Batch 90 of 166

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

- "migration_runtimemigrationcandidatepaths_insideorequal": "insideOrEqual()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L100 | neighbors=[RuntimeMigrationCandidatePaths.ts, planMigrationCandidatePaths()]
- "migration_runtimemigrationcandidatepaths_pathsoverlap": "pathsOverlap()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L104 | neighbors=[RuntimeMigrationCandidatePaths.ts, planMigrationCandidatePaths()]
- "migration_runtimemigrationcandidatepaths_validatemigrationcandidateid": "validateMigrationCandidateId()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L26 | neighbors=[RuntimeMigrationCandidatePaths.ts, planMigrationCandidatePaths()]
- "migration_runtimemigrationcandidatepreflight_bindings": "bindings()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L244 | neighbors=[RuntimeMigrationCandidatePreflight.ts, preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidatepreflight_cleanprojectsworktree": "cleanProjectsWorktree()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L264 | neighbors=[RuntimeMigrationCandidatePreflight.ts, preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidatepreflight_durableaggregate": "durableAggregate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L249 | neighbors=[RuntimeMigrationCandidatePreflight.ts, preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidatepreflight_insideorequal": "insideOrEqual()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L277 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyReadOnlyCapability()]
- "migration_runtimemigrationcandidatepreflight_knownnetworkfilesystem": "knownNetworkFilesystem()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L240 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyReadOnlyCapability()]
- "migration_runtimemigrationcandidatepreflight_pathsoverlap": "pathsOverlap()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L282 | neighbors=[RuntimeMigrationCandidatePreflight.ts, preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidatepreflight_treeidentity": "treeIdentity()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L253 | neighbors=[RuntimeMigrationCandidatePreflight.ts, preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidateservice_assertfilematches": "assertFileMatches()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L435 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateservice_buildexpectedcandidatemanifest": "buildExpectedCandidateManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L336 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateservice_containedbackupfile": "containedBackupFile()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L426 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateservice_inspectstagingdirectories": "inspectStagingDirectories()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L572 | neighbors=[RuntimeMigrationCandidateService.ts, verifyStagedMigrationCandidate()]
- "migration_runtimemigrationcandidateservice_istargetexists": "isTargetExists()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L602 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateservice_pathentryexists": "pathEntryExists()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L494 | neighbors=[RuntimeMigrationCandidateService.ts, hasConflictingOperationEvidence()]
- "migration_runtimemigrationcandidateservice_requireexactstagingentries": "requireExactStagingEntries()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L565 | neighbors=[RuntimeMigrationCandidateService.ts, verifyStagedMigrationCandidate()]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidatecreatedependencies": "RuntimeMigrationCandidateCreateDependencies" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L47 | neighbors=[RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidatecreaterequest": "RuntimeMigrationCandidateCreateRequest" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L36 | neighbors=[RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidatemutationevent": "RuntimeMigrationCandidateMutationEvent" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L65 | neighbors=[RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidateservice_createverifiedmigrationcandidate": ".createVerifiedMigrationCandidate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L93 | neighbors=[RuntimeMigrationCandidateService, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateservice_verifybackup": "verifyBackup()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L418 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…]
- "migration_runtimemigrationcandidateverifier_asbackupmanifest": "asBackupManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L139 | neighbors=[RuntimeMigrationCandidateVerifier.ts, verifyMigrationCandidate()]
- "migration_runtimemigrationcandidateverifier_canonicaljson": "canonicalJson()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L217 | neighbors=[RuntimeMigrationCandidateVerifier.ts, verifyMigrationCandidateBinding()]
- "migration_runtimemigrationcandidateverifier_inspectprojectstree": "inspectProjectsTree()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L159 | neighbors=[RuntimeMigrationCandidateVerifier.ts, verifyMigrationCandidate()]
- "migration_runtimemigrationcandidateverifier_requireexactentries": "requireExactEntries()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L203 | neighbors=[RuntimeMigrationCandidateVerifier.ts, verifyMigrationCandidate()]
- "migration_runtimemigrationcandidateverifier_runtimemigrationcandidateverificationreport": "RuntimeMigrationCandidateVerificationReport" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L24 | neighbors=[RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts]
- "next_config": "next.config.ts" | kind=code-symbol | source=next.config.ts:L1 | neighbors=[e9e3d2e Sprint 16 AI Router integration, nextConfig]
- "pipeline_pipelineerrorevidence_getpipelineerrorevidence": "getPipelineErrorEvidence()" | kind=code-symbol | source=src/lib/pipeline/PipelineErrorEvidence.ts:L15 | neighbors=[PipelineErrorEvidence.ts, PipelineRunner.ts]
- "pipeline_pipelinejobmanager_createhistoryevent": "createHistoryEvent()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L947 | neighbors=[PipelineJobManager.ts, .recordHistoryEvent()]
- "pipeline_pipelinejobmanager_getpipelinestatekind": "getPipelineStateKind()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L1016 | neighbors=[PipelineJobManager.ts, .readPipelineStateFile()]
- "pipeline_pipelinejobmanager_ispipelinejobstatus": "isPipelineJobStatus()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L935 | neighbors=[PipelineJobManager.ts, isPipelineJob()]
- "pipeline_pipelinejobmanager_manifestexecutiontotaltoattemptindex": "manifestExecutionTotalToAttemptIndex()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L838 | neighbors=[PipelineJobManager.ts, getJobId()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_applyaction": ".applyAction()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L360 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_compensatepreparedretry": ".compensatePreparedRetry()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L201 | neighbors=[PipelineJobManager, .withProjectLock()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_getjob": ".getJob()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L95 | neighbors=[PipelineJobManager, .listJobs()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_getjobforstage": ".getJobForStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L113 | neighbors=[PipelineJobManager, .listJobs()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_getjobforstagereadonly": ".getJobForStageReadOnly()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L122 | neighbors=[PipelineJobManager, .readJobList()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_getjobreadonly": ".getJobReadOnly()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L104 | neighbors=[PipelineJobManager, .readJobList()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_listhistory": ".listHistory()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L84 | neighbors=[PipelineJobManager, .readHistory()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-089.json

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
