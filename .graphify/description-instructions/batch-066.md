# Node Description Batch 67 of 166

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

- "masterroadmap_doc": "ATOLYE_MASTER_ROADMAP.md" | kind=entity | source=ATOLYE_MASTER_ROADMAP.md | neighbors=[ATOLYE_CONTEXT.md, PROJECT_PHILOSOPHY.md, VISION.md]
- "migration_runtimemigrationcandidatemanifest_bindingsfor": "bindingsFor()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L418 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest(), validateManifest()]
- "migration_runtimemigrationcandidatemanifest_canonicalmanifest": "canonicalManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L459 | neighbors=[RuntimeMigrationCandidateManifest.ts, runtimeMigrationCandidateIdentitySha256…, serializeRuntimeMigrationCandidateManif…]
- "migration_runtimemigrationcandidatemanifest_durablebinding": "durableBinding()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L426 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest(), validateManifest()]
- "migration_runtimemigrationcandidatemanifest_hashcanonical": "hashCanonical()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L448 | neighbors=[RuntimeMigrationCandidateManifest.ts, runtimeMigrationCandidateIdentitySha256…, runtimeMigrationCandidatePolicySha256()]
- "migration_runtimemigrationcandidatepaths_isunsupportednetworkcandidateroot": "isUnsupportedNetworkCandidateRoot()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L95 | neighbors=[RuntimeMigrationCandidatePaths.ts, RuntimeMigrationCandidatePreflight.ts, smoke-sprint-129-25c-2b-1-migration-can…]
- "migration_runtimemigrationcandidatepreflight_classifywindowsdrivetypeevidence": "classifyWindowsDriveTypeEvidence()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L191 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyReadOnlyCapability(), smoke-sprint-129-25c-2b-1-migration-can…]
- "migration_runtimemigrationcandidatepreflight_filesystemkind": "filesystemKind()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L231 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyReadOnlyCapability(), preflightRuntimeMigrationCandidate()]
- "migration_runtimemigrationcandidatepreflight_readwindowsdrivetypeevidence": "readWindowsDriveTypeEvidence()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L200 | neighbors=[RuntimeMigrationCandidatePreflight.ts, classifyReadOnlyCapability(), smoke-sprint-129-25c-2b-1-migration-can…]
- "migration_runtimemigrationcandidateservice_hasconflictingoperationevidence": "hasConflictingOperationEvidence()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L474 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, pathEntryExists()]
- "migration_runtimemigrationcandidateservice_observe": "observe()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L467 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, publishCandidateNoClobber()]
- "migration_runtimemigrationcandidateservice_publishcandidatenoclobber": "publishCandidateNoClobber()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L376 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, observe()]
- "migration_runtimemigrationcandidateservice_readiness": "readiness()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L399 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, reuseExistingCandidate()]
- "migration_runtimemigrationcandidateservice_requirecleanupcompleted": "requireCleanupCompleted()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L449 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, completed()]
- "migration_runtimemigrationcandidateservice_requiresmutationrecovery": "requiresMutationRecovery()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L459 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, completed()]
- "migration_runtimemigrationcandidateservice_requirestagingdirectory": "requireStagingDirectory()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L547 | neighbors=[RuntimeMigrationCandidateService.ts, samePath(), verifyStagedMigrationCandidate()]
- "migration_runtimemigrationcandidateservice_requirestagingfile": "requireStagingFile()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L557 | neighbors=[RuntimeMigrationCandidateService.ts, samePath(), verifyStagedMigrationCandidate()]
- "migration_runtimemigrationcandidateservice_reuseexistingcandidate": "reuseExistingCandidate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L356 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, readiness()]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidateservice": "RuntimeMigrationCandidateService" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L92 | neighbors=[RuntimeMigrationCandidateService.ts, .createVerifiedMigrationCandidate(), smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidateservice_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L592 | neighbors=[RuntimeMigrationCandidateService.ts, requireStagingDirectory(), requireStagingFile()]
- "migration_runtimemigrationcandidateverifier_requireabsolutedirectory": "requireAbsoluteDirectory()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L182 | neighbors=[RuntimeMigrationCandidateVerifier.ts, samePath(), verifyMigrationCandidate()]
- "migration_runtimemigrationcandidateverifier_requireregularfile": "requireRegularFile()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L195 | neighbors=[RuntimeMigrationCandidateVerifier.ts, samePath(), verifyMigrationCandidate()]
- "migration_runtimemigrationcandidateverifier_samepath": "samePath()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L211 | neighbors=[RuntimeMigrationCandidateVerifier.ts, requireAbsoluteDirectory(), requireRegularFile()]
- "philosophy_doc": "PROJECT_PHILOSOPHY.md" | kind=entity | source=PROJECT_PHILOSOPHY.md | neighbors=[ATOLYE_CONTEXT.md, ATOLYE_MASTER_ROADMAP.md, VISION.md]
- "pipeline_pipelineerrorevidence_ispipelineerrorevidence": "isPipelineErrorEvidence()" | kind=code-symbol | source=src/lib/pipeline/PipelineErrorEvidence.ts:L23 | neighbors=[PipelineErrorEvidence.ts, PipelineJobManager.ts, ProjectManager.ts]
- "pipeline_pipelinejobmanager_isoptionalnonnegativeinteger": "isOptionalNonNegativeInteger()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L930 | neighbors=[PipelineJobManager.ts, isPipelineJob(), isPipelineJobHistoryEvent()]
- "pipeline_pipelinejobmanager_isoptionalstring": "isOptionalString()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L1012 | neighbors=[PipelineJobManager.ts, isPipelineJob(), isPipelineJobHistoryEvent()]
- "pipeline_pipelinejobmanager_ispipelinejobhistorystatus": "isPipelineJobHistoryStatus()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L939 | neighbors=[PipelineJobManager.ts, isPipelineJobHistoryEvent(), .recordHistoryEvent()]
- "pipeline_pipelinejobmanager_isproductionstepkey": "isProductionStepKey()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L1005 | neighbors=[PipelineJobManager.ts, isPipelineJob(), isPipelineJobHistoryEvent()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_createjob": ".createJob()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L552 | neighbors=[PipelineJobManager, getJobId(), .transitionStageJobUnlocked()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_writejoblistunderlock": ".writeJobListUnderLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L667 | neighbors=[PipelineJobManager, .seedJobsFromManifest(), .writeJobListUnlocked()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_writejoblistunlocked": ".writeJobListUnlocked()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L675 | neighbors=[PipelineJobManager, .writeJobList(), .writeJobListUnderLock()]
- "pipeline_pipelinejobmutationlock_assertownershippath": "assertOwnershipPath()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L565 | neighbors=[PipelineJobMutationLock.ts, releaseOwnedGate(), releaseOwnedLock()]
- "pipeline_pipelinejobmutationlock_assertquarantinecontainer": "assertQuarantineContainer()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L740 | neighbors=[PipelineJobMutationLock.ts, assertDirectoryIdentity(), quarantineAndRemove()]
- "pipeline_pipelinejobmutationlock_delay": "delay()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L826 | neighbors=[PipelineJobMutationLock.ts, withAcquisitionGate(), withCanonicalPipelineJobMutationLock()]
- "pipeline_pipelinejobmutationlock_freezeownershiphandle": "freezeOwnershipHandle()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L560 | neighbors=[PipelineJobMutationLock.ts, publishOwnedLock(), withAcquisitionGate()]
- "pipeline_pipelinejobmutationlock_injectreleasefailure": "injectReleaseFailure()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L590 | neighbors=[PipelineJobMutationLock.ts, releaseOwnedGate(), releaseOwnedLock()]
- "pipeline_pipelinejobmutationlock_mutationunlink": "mutationUnlink()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L798 | neighbors=[PipelineJobMutationLock.ts, observeFilesystemMutation(), quarantineAndRemove()]
- "pipeline_pipelinejobmutationlock_parseowner": "parseOwner()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L423 | neighbors=[PipelineJobMutationLock.ts, inspectLock(), recoverStaleGate()]
- "pipeline_pipelinejobmutationlock_processisalive": "processIsAlive()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L551 | neighbors=[PipelineJobMutationLock.ts, readOsProcessStartEpochMs(), sameLiveProcess()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-066.json

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
