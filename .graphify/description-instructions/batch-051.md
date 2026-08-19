# Node Description Batch 52 of 166

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

- "components_generatevisualsbutton": "GenerateVisualsButton.tsx" | kind=code-symbol | source=src/components/GenerateVisualsButton.tsx:L1 | neighbors=[6c1ae5a Sprint 15 - Multi AI Provider A…, 91ba270 Atölye V2 checkpoint - pipeline…, GenerateVisualsButton(), Props]
- "context_doc": "ATOLYE_CONTEXT.md" | kind=entity | source=ATOLYE_CONTEXT.md | neighbors=[ATOLYE_AI_RULES.md, ATOLYE_MASTER_ROADMAP.md, PROJECT_PHILOSOPHY.md, VISION.md]
- "dashboard_dashboardlayout": "DashboardLayout.tsx" | kind=code-symbol | source=src/components/dashboard/DashboardLayout.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, DashboardLayout(), DashboardLayoutProps, page.tsx]
- "export_exportproviderrouter_exportproviderrouter": "ExportProviderRouter" | kind=code-symbol | source=src/lib/export/ExportProviderRouter.ts:L9 | neighbors=[ExportEngine.ts, ExportProviderRouter.ts, .constructor(), .getProvider()]
- "health_route_readinessisconsistent": "readinessIsConsistent()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L87 | neighbors=[route.ts, projectHealthStatus(), validInitializationFailure(), validRuntimeSnapshotBase()]
- "health_route_validruntimesnapshotbase": "validRuntimeSnapshotBase()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L109 | neighbors=[route.ts, readinessIsConsistent(), isLifecycleState(), validOptionalDate()]
- "lib_canonicalsmokeevidence_verifyintegrity": "verifyIntegrity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L95 | neighbors=[CanonicalSmokeEvidence.ts, canonicalStringify(), sha256(), CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_assertexistingevidenceroot": "assertExistingEvidenceRoot()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L185 | neighbors=[CanonicalSmokeEvidenceV2.ts, assertRootPlacement(), tempParentChain(), runEvidenceMatrix()]
- "lib_canonicalsmokeevidencev2_assertmatrixrunid": "assertMatrixRunId()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L393 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), assertRootPlacement(), defaultEvidenceRoot()]
- "lib_canonicalsmokeevidencev2_defaultevidenceroot": "defaultEvidenceRoot()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L78 | neighbors=[CanonicalSmokeEvidenceV2.ts, assertMatrixRunId(), runEvidenceMatrix(), run-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeevidencev2_git": "git()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L341 | neighbors=[CanonicalSmokeEvidenceV2.ts, currentHead(), dataProjectsState(), fail()]
- "lib_canonicalsmokeevidencev2_orchestratorfiles": "orchestratorFiles()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L596 | neighbors=[CanonicalSmokeEvidenceV2.ts, orchestrators(), runEvidenceMatrix(), validateProvenance()]
- "lib_canonicalsmokeevidencev2_orchestrators": "orchestrators()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L598 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), orchestratorFiles(), validateProvenance()]
- "lib_canonicalsmokeevidencev2_resolverelative": "resolveRelative()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L390 | neighbors=[CanonicalSmokeEvidenceV2.ts, loadInventory(), fail(), validateChildEvidence()]
- "lib_canonicalsmokeevidencev2_writeimmutablejson": "writeImmutableJson()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L258 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), publishIntegratedJson(), validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeruntime_assertcanonicalsmokeruntimestoragecontext": "assertCanonicalSmokeRuntimeStorageContext()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L103 | neighbors=[CanonicalSmokeRuntime.ts, assertRunOwnedContext(), canonicalPath(), smoke-canonical-smoke-runtime-foundatio…]
- "lib_canonicalsmokeruntime_canonicalsmokeruntime": "CanonicalSmokeRuntime" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L81 | neighbors=[CanonicalSmokeRuntime.ts, smoke-production-end-to-end.ts, smoke-production-execution-persistence.…, smoke-production-readiness-acceptance.ts]
- "lib_canonicalsmokeruntime_contains": "contains()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L575 | neighbors=[CanonicalSmokeRuntime.ts, assertRunOwnedContext(), canonicalPath(), identitySafeRemoveLeaf()]
- "lib_canonicalsmokeruntime_createmanifest": "createManifest()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L492 | neighbors=[CanonicalSmokeRuntime.ts, manifestHash(), serialize(), setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_identity": "identity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L555 | neighbors=[CanonicalSmokeRuntime.ts, identitySafeRemoveLeaf(), recoverCanonicalSmokeWorkspace(), setupCanonicalSmokeRuntime()]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourattemptv1": "poisonHistoricalAudioOrdinalFourAttemptV1()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L435 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, rewriteAttempt(), smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourclaimv1": "poisonHistoricalAudioOrdinalFourClaimV1()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L422 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, rewriteClaim(), smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourlease": "poisonHistoricalAudioOrdinalFourLease()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L483 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, withLeaseIntegrity(), poisonHistoricalAudioOrdinalFourLeaseV2…, poisonHistoricalAudioOrdinalFourLeaseV2…]
- "lib_historicalaudioordinalfourpreflight_rewriteattempt": "rewriteAttempt()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L369 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, createAlternativeHistoricalAudioOrdinal…, poisonHistoricalAudioOrdinalFourAttempt…, bodyWithoutIntegrity()]
- "lib_historicalaudioordinalfourpreflight_rewriteclaim": "rewriteClaim()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L355 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, createAlternativeHistoricalAudioOrdinal…, poisonHistoricalAudioOrdinalFourClaimV1…, withClaimIntegrity()]
- "lib_historicalaudioordinalfourpreflight_withclaimintegrity": "withClaimIntegrity()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L91 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, poisonHistoricalAudioOrdinalFourClaimV1…, rewriteClaim(), bodyWithoutIntegrity()]
- "lib_runtime_tracking_inventory_assertruntimetrackingadmission": "assertRuntimeTrackingAdmission()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L61 | neighbors=[runtime-tracking-inventory.ts, isAllowedIgnoredDurablePath(), samePath(), smoke-sprint-129-25b-runtime-root.ts]
- "migration_runtimemigrationcandidateerror_migrationcandidateerror": "migrationCandidateError()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L52 | neighbors=[RuntimeMigrationCandidateError.ts, RuntimeMigrationCandidateError, RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts]
- "migration_runtimemigrationcandidatemanifest_minimalruntimedirectoryclosure": "minimalRuntimeDirectoryClosure()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L217 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest(), validateManifest(), RuntimeMigrationCandidateVerifier.ts]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidatemanifest": "RuntimeMigrationCandidateManifest" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L40 | neighbors=[RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidatePreflight.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidatemanifest_validatebindings": "validateBindings()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L387 | neighbors=[RuntimeMigrationCandidateManifest.ts, invalid(), validateManifest(), validateSourceEvidence()]
- "migration_runtimemigrationcandidateservice_completed": "completed()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L455 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, requireCleanupCompleted(), requiresMutationRecovery()]
- "pipeline_pipelinejobmanager_getjobid": "getJobId()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L896 | neighbors=[PipelineJobManager.ts, manifestExecutionTotalToAttemptIndex(), .createJob(), .transitionStageJobUnlocked()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_cantransition": ".canTransition()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L464 | neighbors=[PipelineJobManager, .applyActionUnlocked(), .prepareJobRetryUnderLock(), .transitionStageJobUnlocked()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_readpipelinestatefile": ".readPipelineStateFile()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L735 | neighbors=[PipelineJobManager, .readHistory(), .readJobList(), getPipelineStateKind()]
- "pipeline_pipelinejobmanager_pipelinejobmanager_seedjobsfrommanifest": ".seedJobsFromManifest()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L569 | neighbors=[PipelineJobManager, .listJobs(), .readHistory(), .writeJobListUnderLock()]
- "pipeline_pipelinejobmutationlock_canonicalprojectfolder": "canonicalProjectFolder()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L491 | neighbors=[PipelineJobMutationLock.ts, verifyCanonicalForeignQuarantinePreserv…, verifyCanonicalOwnerPublicationFailureC…, withCanonicalPipelineJobMutationLock()]
- "pipeline_pipelinejobmutationlock_identityof": "identityOf()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L529 | neighbors=[PipelineJobMutationLock.ts, publishOwnedLock(), quarantineAndRemove(), verifyCanonicalForeignQuarantinePreserv…]
- "pipeline_pipelinejobmutationlock_inspectlock": "inspectLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L407 | neighbors=[PipelineJobMutationLock.ts, parseOwner(), recoverVerifiedStaleLock(), releaseOwnedLock()]
- "pipeline_pipelinejobmutationlock_invokecanonicalmutationinvocation": "invokeCanonicalMutationInvocation()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L814 | neighbors=[PipelineJobMutationLock.ts, publishOwnedLock(), quarantineAndRemove(), withAcquisitionGate()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-051.json

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
