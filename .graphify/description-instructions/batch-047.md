# Node Description Batch 48 of 166

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

- "scripts_smoke_production_youtube_package_pipeline_successandreplaytests": "successAndReplayTests()" | kind=code-symbol | source=scripts/smoke-production-youtube-package-pipeline.ts:L186 | neighbors=[smoke-production-youtube-package-pipeli…, DraftProvider, generate(), input(), pass()]
- "scripts_smoke_production_youtube_publish_pipeline_successreplayandconfig": "successReplayAndConfig()" | kind=code-symbol | source=scripts/smoke-production-youtube-publish-pipeline.ts:L126 | neighbors=[smoke-production-youtube-publish-pipeli…, CountingProvider, intent(), pass(), providerRequest()]
- "scripts_smoke_sprint_129_13_script_settlement_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-13-script-settlement.ts:L41 | neighbors=[smoke-sprint-129-13-script-settlement.ts, env(), fixtureProject(), hashTree(), test()]
- "scripts_smoke_sprint_129_17_scenes_structured_output_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-17-scenes-structured-output.ts:L92 | neighbors=[smoke-sprint-129-17-scenes-structured-o…, digest(), scenes(), script(), test()]
- "scripts_smoke_sprint_129_21_animation_failure_diagnostics_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-21-animation-failure-diagnostics.ts:L99 | neighbors=[smoke-sprint-129-21-animation-failure-d…, diagnosticProvider(), hashFile(), hashVisualInputs(), test()]
- "scripts_smoke_sprint_129_22_animation_structured_output_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L107 | neighbors=[smoke-sprint-129-22-animation-structure…, frame(), inventory(), plan(), test()]
- "scripts_smoke_sprint_129_25b_runtime_root_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L62 | neighbors=[smoke-sprint-129-25b-runtime-root.ts, productionBoundaryViolations(), runtimeDiff(), scenario(), sha256()]
- "scripts_smoke_sprint_129_25c_2a_guarded_filesystem_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-2a-guarded-filesystem.ts:L41 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, initializeGitFixture(), publishChild(), reservationChild(), scenario()]
- "scripts_smoke_sprint_129_27_audio_remediation_wav": "wav()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L92 | neighbors=[smoke-sprint-129-27-audio-remediation.ts, createRegistryOwnedFixture(), createTwoPhaseRegistryOwnedFixture(), runConcurrentSaveChildren(), runSaveChild()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_createfailedproductionaudioretryfixture": "createFailedProductionAudioRetryFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L758 | neighbors=[smoke-sprint-129-28-production-acceptan…, explicitTestAuthority(), fixture(), fixtureProviderOptions(), publishCapabilityFixture()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_createfailedpublicresearchfixture": "createFailedPublicResearchFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L712 | neighbors=[smoke-sprint-129-28-production-acceptan…, explicitTestAuthority(), fixture(), publishCapabilityFixture(), runCanonicalRunnerResearchStage()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_researchprovider": "researchProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L469 | neighbors=[smoke-sprint-129-28-production-acceptan…, explicitTestAuthority(), runCanonicalProviderGateFailure(), runExecutorScopeDivergence(), withDirectCapabilityEvidence()]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_runexecutorscopedivergence": "runExecutorScopeDivergence()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1024 | neighbors=[smoke-sprint-129-28-production-acceptan…, fixture(), publishCapabilityFixture(), researchProvider(), runCanonicalRunnerResearchStage()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_assert": "assert()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L92 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, runCrossProcessRaceTest(), runParserTests(), runSettlementRecoveryTest(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_assertcontained": "assertContained()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L146 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, captureOwnedTempRootIdentity(), rewindOwnedProjectToExhaustedAudioFixtu…, runCrossProcessRaceTest(), runSmokeSuite()]
- "scripts_smoke_sprint_129_36_retry_budget_extension_rewindownedprojecttoexhaustedaudiofixture": "rewindOwnedProjectToExhaustedAudioFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L612 | neighbors=[smoke-sprint-129-36-retry-budget-extens…, assertContained(), runCanonicalRewindPoisonRegression(), runExactRewindOwnershipRegression(), runSmokeSuite()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_assertproductionseam": "assertProductionSeam()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L522 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass(), boundedFailure(), boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_invalidboundary": "invalidBoundary()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L296 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, pass(), projectFolder(), seedFailedAssembly(), treeDigest()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixtureassemblyprovider": "FixtureAssemblyProvider" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L212 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, ConfiguredVideoAssemblyProvider, .assemble(), .createImmutableAssemblyDispatchAdapter…, main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixturevideoprovider": "FixtureVideoProvider" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L183 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, ConfiguredVideoProvider, .createImmutableVideoDispatchAdapter(), .generateVideo(), main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_write": "write()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L512 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, Fixture, main(), preparationWorker(), wav()]
- "scripts_validate_canonical_smoke_evidence_orchestratorfiles": "orchestratorFiles()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L385 | neighbors=[validate-canonical-smoke-evidence.ts, makeInterrupted(), rebaseRoot(), rebindBaseline(), rechain()]
- "scripts_validate_canonical_smoke_evidence_rechain": "rechain()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L336 | neighbors=[validate-canonical-smoke-evidence.ts, rebaseRoot(), rebindBaseline(), mutate(), orchestratorFiles()]
- "scripts_validate_canonical_smoke_evidence_temporarycleanupinvariants": "temporaryCleanupInvariants()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L213 | neighbors=[validate-canonical-smoke-evidence.ts, cleanupReadFailureInvariant(), cleanupReplacementInvariant(), ownedTemporaryCleanupInvariant(), sameInodeMutationInvariant()]
- "security_guardedruntimemutationsession_beginprivatelegacyruntimebackuprestoreoperation": "beginPrivateLegacyRuntimeBackupRestoreOperation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L825 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateRuntimeBackupRestoreOperati…, .beginMutation(), invalidPath(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_beginprivateruntimebackuprestoreoperation": "beginPrivateRuntimeBackupRestoreOperation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L809 | neighbors=[GuardedRuntimeMutationSession.ts, beginPrivateRuntimeBackupRestoreOperati…, beginRuntimeBackupMutationKey, invalidPath(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_assertowned": ".assertOwned()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L764 | neighbors=[GuardedRuntimeMutationSession, .assertActive(), .sessionTokenMatches(), identityMatches(), .releaseOwnedDirectory()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_cleanupowneddirectory": ".cleanupOwnedDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L616 | neighbors=[GuardedRuntimeMutationSession, .sessionTokenMatches(), identityMatches(), .close(), .closeRetainingOwnedDirectory()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_closeretainingowneddirectory": ".closeRetainingOwnedDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L647 | neighbors=[GuardedRuntimeMutationSession, .cleanupOwnedDirectory(), .releaseReservation(), .sessionTokenMatches(), identityMatches()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L387 | neighbors=[GuardedRuntimeMutationSession, createExclusiveTokenFile(), invalidPath(), requireStableDirectory(), requireStableFile()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_createowneddirectory": ".createOwnedDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L435 | neighbors=[beginPrivateRuntimeBackupCreateOperatio…, beginPrivateRuntimeBackupRestoreOperati…, GuardedRuntimeMutationSession, .publicBoundary(), .publishVerified()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_prepareowneddestination": ".prepareOwnedDestination()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L702 | neighbors=[GuardedRuntimeMutationSession, .assertPortableCollisionAvailable(), .ensureOwnedDirectory(), relativePosix(), resolveContained()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_releasereservation": ".releaseReservation()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L737 | neighbors=[GuardedRuntimeMutationSession, .close(), .closeRetainingOwnedDirectory(), .sessionTokenMatches(), identityMatches()]
- "security_guardedruntimemutationsession_preflightatomicrestorematerialization": "preflightAtomicRestoreMaterialization()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1247 | neighbors=[GuardedRuntimeMutationSession.ts, .restoreVerifiedRuntimeBackup(), assertAtomicAbsoluteMaterializedPath(), atomicMaterializedMutationPath(), validateAtomicMaterializedManifestPath()]
- "security_guardedruntimemutationsession_requireguardedcleanup": "requireGuardedCleanup()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1069 | neighbors=[GuardedRuntimeMutationSession.ts, .abort(), .commit(), .abort(), .commit()]
- "security_guardedruntimemutationsession_requirestabledirectory": "requireStableDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1435 | neighbors=[GuardedRuntimeMutationSession.ts, guardedExclusiveMutation(), .constructor(), invalidPath(), requireStableObject()]
- "security_portablenoclobberfilepublisher_copyfileexclusivereservation": "copyFileExclusiveReservation()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L113 | neighbors=[PortableNoClobberFilePublisher.ts, inspectExactFile(), matchesIdentity(), syncDirectory(), reserveFilePortableNoClobber()]
- "security_portablenoclobberfilepublisher_finalizereservedfileportablenoclobber": "finalizeReservedFilePortableNoClobber()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L360 | neighbors=[PortableNoClobberFilePublisher.ts, inspectExactFile(), requireExpectedFile(), syncDirectory(), AudioStorage.ts]
- "security_runtimepathpolicy_invalidpath": "invalidPath()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L127 | neighbors=[RuntimePathPolicy.ts, assertNoRuntimePathCollisions(), assertRuntimeMaterializedPath(), validateMutationRelativePath(), validateRuntimeLogicalPath()]
- "security_runtimepathpolicy_runtimeportablecollisionkey": "runtimePortableCollisionKey()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L63 | neighbors=[RuntimeBackupManifest.ts, RuntimeMigrationCandidateManifest.ts, RuntimePathPolicy.ts, assertNoRuntimePathCollisions(), validateRuntimeLogicalPath()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-047.json

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
