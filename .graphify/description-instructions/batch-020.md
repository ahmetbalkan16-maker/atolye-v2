# Node Description Batch 21 of 166

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
Write every description in Portuguese (pt). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@9d3c476fd60704d21aee2cc4e25eb99ab9c26819": "9d3c476 fix(production): close sprint 129.38 settlement replay authority" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 0ff6112 feat(production): add stage-bou…, HistoricalAudioOrdinalFourPreflight.ts, ProductionAcceptanceCommand.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@9e31d20fe7831934d176197bace5982998859f8b": "9e31d20 feat(animation): add animation ui integration" | kind=Commit | source=git | neighbors=[8c6b061 feat(animation): add animation …, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a4839b8d3a0e8a5cad6807f986efdf8d68299910": "a4839b8 feat(seo): add youtube seo engine core" | kind=Commit | source=git | neighbors=[56fd9c7 feat(thumbnail): add thumbnail …, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, e3b7e47 feat(studio): add full producti…, ProjectManager.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@aa6afc26bfc60a0739e7e2e248bdc2df3558fe49": "aa6afc2 feat: complete sprint 66 pipeline queue scheduler" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b58a3503388a089aacaf0ff296faf29563acd8aa": "b58a350 fix(production): close failed-terminal settlement lifecycle" | kind=Commit | source=git | neighbors=[19c8f70 feat: complete two-phase produc…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, b63ce67 test(production): close sprint …, ProductionPipelineExecutionAdapter.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c5fd1ea3799c7698acf480a30d96cbedb4e26164": "c5fd1ea feat: harden pipeline history persistence" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@f7730b992c47c03c33d202dd6a5fbe20a344d0b0": "f7730b9 feat(pipeline): add recovery planning foundation" | kind=Commit | source=git | neighbors=[04b6c0f feat(studio): add AI usage filt…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "components_homeclient": "HomeClient.tsx" | kind=code-symbol | source=src/components/HomeClient.tsx:L1 | neighbors=[page.tsx, 0e1f281 fix: complete sprint 71 react h…, 5a68409 feat(pipeline): add full docume…, 6c1ae5a Sprint 15 - Multi AI Provider A…, Dashboard.tsx, HomeClient()]
- "filename_route_get": "GET()" | kind=code-symbol | source=app/api/assets/videos/[slug]/[fileName]/route.ts:L9 | neighbors=[route.ts, getContentType(), isInsideDirectory(), isSafeFileName(), isSafePathSegment(), isSafeWavFileName()]
- "lib_canonicalsmokeevidencev2_validateresume": "validateResume()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L708 | neighbors=[CanonicalSmokeEvidenceV2.ts, runEvidenceMatrix(), assertNoPartials(), equal(), fail(), string()]
- "migration_runtimemigrationcandidatemanifest_buildruntimemigrationcandidatemanifest": "buildRuntimeMigrationCandidateManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L108 | neighbors=[RuntimeMigrationCandidateManifest.ts, bindingsFor(), deepFreeze(), durableBinding(), minimalRuntimeDirectoryClosure(), runtimeMigrationCandidateId()]
- "migration_runtimemigrationcandidatemanifest_invalid": "invalid()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L444 | neighbors=[RuntimeMigrationCandidateManifest.ts, exact(), validateBindings(), validateCapability(), validateDurableBinding(), validateGitEvidence()]
- "migration_runtimemigrationcandidatepreflight_preflightruntimemigrationcandidate": "preflightRuntimeMigrationCandidate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePreflight.ts:L42 | neighbors=[RuntimeMigrationCandidatePreflight.ts, bindings(), classifyReadOnlyCapability(), cleanProjectsWorktree(), durableAggregate(), filesystemKind()]
- "migration_runtimemigrationcandidateverifier_verifymigrationcandidate": "verifyMigrationCandidate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L37 | neighbors=[RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts, asBackupManifest(), inspectProjectsTree(), requireAbsoluteDirectory(), requireExactEntries()]
- "pipeline_pipelinefailedstageretry_preparefailedstageretry": "prepareFailedStageRetry()" | kind=code-symbol | source=src/lib/pipeline/PipelineFailedStageRetry.ts:L29 | neighbors=[PipelineFailedStageRetry.ts, PipelineRunner.ts, smoke-sprint-129-19-visuals-structured-…, smoke-sprint-129-27-audio-remediation.ts, smoke-sprint-129-29-failed-terminal-set…, smoke-sprint-129-33-exhausted-retry-adm…]
- "pipeline_pipelinejobmanager_pipelinejobmanager_withprojectlock": ".withProjectLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L519 | neighbors=[PipelineJobManager, .applyAction(), .compensatePreparedRetry(), .listJobs(), .persistProjectCompletion(), .persistStageFailure()]
- "pipeline_pipelinejobmutationlock_publishownedlock": "publishOwnedLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L258 | neighbors=[PipelineJobMutationLock.ts, assertDirectoryIdentity(), freezeOwnershipHandle(), identityOf(), invokeCanonicalMutationInvocation(), mutationMkdir()]
- "pipeline_pipelinejobmutationlock_withacquisitiongate": "withAcquisitionGate()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L345 | neighbors=[PipelineJobMutationLock.ts, verifyCanonicalOwnerPublicationFailureC…, delay(), freezeOwnershipHandle(), invokeCanonicalMutationInvocation(), isAlreadyExists()]
- "production_productionacceptanceconfigurationfingerprint_createproductionacceptanceportableconfigurationsnapshotv2": "createProductionAcceptancePortableConfigurationSnapshotV2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L115 | neighbors=[ProductionAcceptanceConfigurationFinger…, componentFingerprint(), createProductionAcceptancePortableConfi…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePolicy.ts]
- "production_productionacceptancelegacyauthoritystore_publishexactnoclobber": "publishExactNoClobber()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L366 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, markLegacyReauthorizationValidated(), conflict(), persistence(), readExact(), syncDirectory()]
- "production_productionacceptancelegacydurablerecoverysnapshot_assertdurablecausalbindings": "assertDurableCausalBindings()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L330 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertAdmittedDurableBindings(), assertAdmittedDurableIdentityBindings(), causal(), claimMatchesAttempt(), latestValues()]
- "production_productionacceptancelegacydurablerecoverysnapshot_createlegacyreauthorizationdurablerecoverysnapshot": "createLegacyReauthorizationDurableRecoverySnapshot()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L53 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings(), assertSemanticStoreStates(), excludingCurrentExecution(), invalid(), latestExact()]
- "production_productionacceptancepolicy_createproductionacceptancemarker": "createProductionAcceptanceMarker()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L199 | neighbors=[ProductionAcceptancePolicy.ts, productionAcceptanceConfigurationFinger…, ProductionAcceptancePolicyError, productionAcceptanceRequestFingerprint(), safeRunId(), safeSlug()]
- "production_productionacceptancepolicy_productionacceptancestageexecutionidentity": "ProductionAcceptanceStageExecutionIdentity" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L430 | neighbors=[PipelineRunner.ts, PipelineStageExecutor.ts, ProductionAcceptancePolicy.ts, ProductionDurableAttemptLineageClassifi…, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptancepolicy_saferunid": "safeRunId()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1402 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarker(), createProductionAcceptanceMarkerV3(), createProductionAcceptanceMarkerV3Profi…, productionAcceptanceRequestFingerprint(), productionAcceptanceRequestFingerprintV…]
- "production_productionacceptancepolicy_validmarker": "validMarker()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1160 | neighbors=[ProductionAcceptancePolicy.ts, diagnoseProductionAcceptanceConfigurati…, markProductionAcceptanceValidated(), prepareProductionAcceptanceMarkerReprep…, readProductionAcceptanceAdmissionAuthor…, readProductionAcceptanceMarker()]
- "production_productionexecutiondescriptorboundreadadapter_createproductionexecutionreaddescriptor": "createProductionExecutionReadDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDescriptorBoundReadAdapter.ts:L51 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionExecutionDescriptorBoundReadA…, assertContained(), fingerprintIdentity(), readDirectoryIdentity(), smoke-canonical-smoke-runtime-foundatio…]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_latest": ".latest()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L15 | neighbors=[AdapterBackedProductionExecutionAttempt…, .abandonExecutionAttempt(), .appendAttemptJournal(), .evaluateExecutionAttemptRecovery(), .finalizeExecutionOutcome(), mapPersistence()]
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_write": ".write()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L17 | neighbors=[AdapterBackedProductionExecutionAttempt…, .abandonExecutionAttempt(), .appendAttemptJournal(), .finalizeExecutionOutcome(), .openExecutionAttempt(), .proposeExecutionOutcome()]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_closeclaim": ".closeClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L38 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .abandonExecutionClaim(), .latestClaim(), .writeClaim(), date(), operation()]
- "production_productionexecutiondurableclaim_validateproductionexecutiondurableclaim": "validateProductionExecutionDurableClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L46 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableClaim.ts, validClaim()]
- "production_productionexecutiondurableclaim_validclaim": "validClaim()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L48 | neighbors=[ProductionExecutionDurableClaim.ts, .evaluateExecutionClaimRecovery(), .latestClaim(), .writeClaim(), classifyProductionExecutionClaimArtifac…, validateProductionExecutionDurableClaim…]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_heartbeat": ".heartbeat()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L29 | neighbors=[AdapterBackedProductionExecutionDurable…, .commit(), .load(), date(), denied(), heartbeatReplay()]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_load": ".load()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L78 | neighbors=[AdapterBackedProductionExecutionDurable…, .acquire(), .heartbeat(), denied(), mapRead(), result()]
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_takeover": ".takeover()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L69 | neighbors=[AdapterBackedProductionExecutionDurable…, acquisitionReplay(), .commit(), .load(), buildLease(), denied()]
- "production_productionexecutiondurablelease_validateproductionexecutiondurablelease": "validateProductionExecutionDurableLease()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L90 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableClaim.ts, ProductionExecutionDurableLease.ts, validLease()]
- "production_productionexecutiondurablelease_validlease": "validLease()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L96 | neighbors=[ProductionExecutionDurableLease.ts, .commit(), .evaluate(), .load(), .takeover(), evaluateProductionExecutionDurableLease…]
- "production_productionexecutionpersistence_idempotencyrecordvalid": "idempotencyRecordValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L379 | neighbors=[ProductionExecutionPersistence.ts, canonicalJson(), durableLeaseValid(), idempotencyPolicy(), identityFromRecord(), integer()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_scan": ".scan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L160 | neighbors=[ProductionExecutionDurableRecoveryServi…, .rebuildIndex(), artifactIdentity(), diagnostic(), errorCode(), .collectCanonicalRecords()]
- "production_productionexecutionpersistence_reservationvalid": "reservationValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L383 | neighbors=[ProductionExecutionPersistence.ts, authorizationShape(), canonicalJson(), confirmationShape(), idempotencyPolicy(), integer()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-020.json

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
