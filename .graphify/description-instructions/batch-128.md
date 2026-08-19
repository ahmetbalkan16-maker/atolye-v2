# Node Description Batch 129 of 166

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

- "migration_runtimemigrationcandidateerror_messages": "messages" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L20 | neighbors=[RuntimeMigrationCandidateError.ts]
- "migration_runtimemigrationcandidateerror_runtimemigrationcandidateerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L41 | neighbors=[RuntimeMigrationCandidateError]
- "migration_runtimemigrationcandidateerror_runtimemigrationcandidateerror_tojson": ".toJSON()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L47 | neighbors=[RuntimeMigrationCandidateError]
- "migration_runtimemigrationcandidateerror_runtimemigrationcandidateerrorcode": "RuntimeMigrationCandidateErrorCode" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L1 | neighbors=[RuntimeMigrationCandidateError.ts]
- "migration_runtimemigrationcandidatemanifest_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L440 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidatecapabilitycontractversion": "runtimeMigrationCandidateCapabilityContractVersion" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L27 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidateformatversion": "runtimeMigrationCandidateFormatVersion" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L25 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidateschemaversion": "runtimeMigrationCandidateSchemaVersion" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L24 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidatescopeversion": "runtimeMigrationCandidateScopeVersion" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L26 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationdurablebinding": "RuntimeMigrationDurableBinding" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L34 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationmarkerbinding": "RuntimeMigrationMarkerBinding" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L29 | neighbors=[RuntimeMigrationCandidateManifest.ts]
- "migration_runtimemigrationcandidatepaths_runtimemigrationcandidatepathplan": "RuntimeMigrationCandidatePathPlan" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L16 | neighbors=[RuntimeMigrationCandidatePaths.ts]
- "migration_runtimemigrationcandidatepreflight_runtimemigrationcandidatepreflightreport": "RuntimeMigrationCandidatePreflightReport" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L26 | neighbors=[RuntimeMigrationCandidatePreflight.ts]
- "migration_runtimemigrationcandidateservice_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L598 | neighbors=[RuntimeMigrationCandidateService.ts]
- "migration_runtimemigrationcandidateservice_runtimemigrationcandidatereadiness": "RuntimeMigrationCandidateReadiness" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L79 | neighbors=[RuntimeMigrationCandidateService.ts]
- "migration_runtimemigrationcandidateverifier_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L216 | neighbors=[RuntimeMigrationCandidateVerifier.ts]
- "next_config_nextconfig": "nextConfig" | kind=code-symbol | source=next.config.ts:L3 | neighbors=[next.config.ts]
- "phasereview_doc": "docs/PRODUCTION_EXECUTION_PHASE_REVIEW.md" | kind=entity | source=docs/PRODUCTION_EXECUTION_PHASE_REVIEW.md | neighbors=[docs/PRODUCTION_EXECUTION_SAFETY.md]
- "pipeline_pipelinefailedstageretry_pipelinefailedstageretrypreparationresult": "PipelineFailedStageRetryPreparationResult" | kind=code-symbol | source=src/lib/pipeline/PipelineFailedStageRetry.ts:L24 | neighbors=[PipelineFailedStageRetry.ts]
- "pipeline_pipelinejobmanager_allowedstatetransitions": "allowedStateTransitions" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L41 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmanager_pipelinejobactionresult": "PipelineJobActionResult" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L812 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmanager_pipelinejobmanager_canceljob": ".cancelJob()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L428 | neighbors=[PipelineJobManager]
- "pipeline_pipelinejobmanager_pipelinejobmanager_canpersiststageresult": ".canPersistStageResult()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L515 | neighbors=[PipelineJobManager]
- "pipeline_pipelinejobmanager_pipelinejobmanager_ishistory": ".isHistory()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L792 | neighbors=[PipelineJobManager]
- "pipeline_pipelinejobmanager_pipelinejobmanager_isjoblist": ".isJobList()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L771 | neighbors=[PipelineJobManager]
- "pipeline_pipelinejobmanager_pipelinejobretrypreparationresult": "PipelineJobRetryPreparationResult" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L824 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmanager_pipelinejobstatuses": "pipelineJobStatuses" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L33 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmanager_stagelabels": "stageLabels" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L52 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmanager_tojobstatus": "toJobStatus()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L1020 | neighbors=[PipelineJobManager.ts]
- "pipeline_pipelinejobmutationlock_activelock": "activeLock" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L36 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_canonicalmutationbarriertarget": "CanonicalMutationBarrierTarget" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L45 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_canonicalmutationkind": "CanonicalMutationKind" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L53 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_execfileasync": "execFileAsync" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L40 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_fileidentity": "FileIdentity" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L21 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_lockowner": "LockOwner" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L10 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_ownershiphandle": "OwnershipHandle" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L23 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_ownprocessstart": "ownProcessStart" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L42 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_processstartcache": "processStartCache" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L436 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinejobmutationlock_quarantineprotocolerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L616 | neighbors=[QuarantineProtocolError]
- "pipeline_pipelinejobmutationlock_quarantineremovaloutcome": "QuarantineRemovalOutcome" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L608 | neighbors=[PipelineJobMutationLock.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-128.json

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
