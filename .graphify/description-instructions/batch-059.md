# Node Description Batch 60 of 166

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

- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureassemblyprovider": "FixtureAssemblyProvider" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L86 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, ConfiguredVideoAssemblyProvider, .assemble(), .createImmutableAssemblyDispatchAdapter…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixturethumbnailprovider": "FixtureThumbnailProvider" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L108 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, .generateThumbnailAsset(), .generateThumbnailPlan(), MockThumbnailProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_job": "job()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L594 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedFailure(), boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_legacyunbounded": "legacyUnbounded()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L283 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, observeResumeFailure(), pass(), seedFailedAssembly()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_projectfolder": "projectFolder()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L598 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, assertNoDownstreamDurable(), assertQuiescent(), invalidBoundary()]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_providerdispatches": "providerDispatches()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L543 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…, boundedFailure(), boundedSuccess(), laterBoundary()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_assertsupersessionprecommitrejection": "assertSupersessionPrecommitRejection()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L540 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, check(), plan(), main()]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_republishcanonicalaudiofixture": "republishCanonicalAudioFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L170 | neighbors=[smoke-sprint-129-41-completed-stage-reg…, main(), assertOwnedTempMutationTarget(), publishCanonicalAudioFixture()]
- "scripts_smoke_sprint_129_9_failed_stage_resume_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-9-failed-stage-resume.ts:L121 | neighbors=[smoke-sprint-129-9-failed-stage-resume.…, pass(), runBoundedCliFailure(), withFixture()]
- "scripts_validate_canonical_smoke_evidence_authorityfor": "authorityFor()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L380 | neighbors=[validate-canonical-smoke-evidence.ts, normalize(), statIdentity(), rebaseRoot()]
- "scripts_validate_canonical_smoke_evidence_copyfixture": "copyFixture()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L320 | neighbors=[validate-canonical-smoke-evidence.ts, rebaseRoot(), reject(), resumeReject()]
- "scripts_validate_canonical_smoke_evidence_exact": "exact()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L299 | neighbors=[validate-canonical-smoke-evidence.ts, cleanupReadFailureInvariant(), reject(), writerIntegrityInvariants()]
- "scripts_validate_canonical_smoke_evidence_forgeinventory": "forgeInventory()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L369 | neighbors=[validate-canonical-smoke-evidence.ts, mutate(), read(), record()]
- "scripts_validate_canonical_smoke_evidence_normalize": "normalize()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L395 | neighbors=[validate-canonical-smoke-evidence.ts, authorityFor(), rebaseRoot(), statIdentity()]
- "scripts_validate_canonical_smoke_evidence_rebindbaseline": "rebindBaseline()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L346 | neighbors=[validate-canonical-smoke-evidence.ts, mutate(), orchestratorFiles(), rechain()]
- "scripts_validate_canonical_smoke_evidence_reject": "reject()" | kind=code-symbol | source=scripts/validate-canonical-smoke-evidence.ts:L304 | neighbors=[validate-canonical-smoke-evidence.ts, provenanceReject(), copyFixture(), exact()]
- "security_guardedruntimemutationsession_assertatomicabsolutematerializedpath": "assertAtomicAbsoluteMaterializedPath()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1304 | neighbors=[GuardedRuntimeMutationSession.ts, invalidPath(), preflightAtomicCreateMaterialization(), preflightAtomicRestoreMaterialization()]
- "security_guardedruntimemutationsession_assertatomiccreateroots": "assertAtomicCreateRoots()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1090 | neighbors=[GuardedRuntimeMutationSession.ts, assertExactAtomicKeys(), invalidPath(), .createVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_assertatomicrestoreroots": "assertAtomicRestoreRoots()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1116 | neighbors=[GuardedRuntimeMutationSession.ts, assertExactAtomicKeys(), invalidPath(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_atomiccontainedfilepath": "atomicContainedFilePath()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1314 | neighbors=[GuardedRuntimeMutationSession.ts, invalidPath(), .createVerifiedRuntimeBackup(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_cleanupatomicemptydirectory": "cleanupAtomicEmptyDirectory()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1323 | neighbors=[GuardedRuntimeMutationSession.ts, identityMatches(), .createVerifiedRuntimeBackup(), .restoreVerifiedRuntimeBackup()]
- "security_guardedruntimemutationsession_createexclusivetokenfile": "createExclusiveTokenFile()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1391 | neighbors=[GuardedRuntimeMutationSession.ts, captureCreatedObject(), identityMatches(), .constructor()]
- "security_guardedruntimemutationsession_guardedruntimefilesystem_beginmutationwithvalidator": ".beginMutationWithValidator()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L345 | neighbors=[GuardedRuntimeFilesystem, .beginMutation(), GuardedRuntimeMutationSession, .[beginRuntimeBackupMutationKey]()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_assertactive": ".assertActive()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L774 | neighbors=[GuardedRuntimeMutationSession, .sessionTokenMatches(), identityMatches(), .assertOwned()]
- "security_guardedruntimemutationsession_guardedruntimemutationsession_assertportablecollisionavailable": ".assertPortableCollisionAvailable()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L723 | neighbors=[GuardedRuntimeMutationSession, invalidPath(), portableCaseKey(), .prepareOwnedDestination()]
- "security_guardedruntimemutationsession_prepareownedpayloadfile": "prepareOwnedPayloadFile()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1075 | neighbors=[GuardedRuntimeMutationSession.ts, .ensureDirectory(), .materializeInventoryFile(), .materializeVerifiedFile()]
- "security_guardedruntimemutationsession_requirestablefile": "requireStableFile()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1441 | neighbors=[GuardedRuntimeMutationSession.ts, .constructor(), invalidPath(), requireStableObject()]
- "security_guardedruntimemutationsession_requirestableobject": "requireStableObject()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1447 | neighbors=[GuardedRuntimeMutationSession.ts, requireStableDirectory(), requireStableFile(), invalidPath()]
- "security_guardedruntimemutationsession_runtimebackupcreateguardedoperationimpl_materializeinventoryfile": ".materializeInventoryFile()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L893 | neighbors=[.createVerifiedRuntimeBackup(), RuntimeBackupCreateGuardedOperationImpl, invalidPath(), prepareOwnedPayloadFile()]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl_commit": ".commit()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1035 | neighbors=[RuntimeBackupRestoreGuardedOperationImpl, .close(), invalidPath(), requireGuardedCleanup()]
- "security_guardedruntimemutationsession_runtimebackuprestoreguardedoperationimpl_materializeverifiedfile": ".materializeVerifiedFile()" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L1006 | neighbors=[.restoreVerifiedRuntimeBackup(), RuntimeBackupRestoreGuardedOperationImpl, invalidPath(), prepareOwnedPayloadFile()]
- "security_portablenoclobberfilepublisher_ishardlinkunavailable": "isHardLinkUnavailable()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L454 | neighbors=[PortableNoClobberFilePublisher.ts, publishFilePortableNoClobber(), publishFileViaReservedStaging(), reserveFilePortableNoClobber()]
- "security_portablenoclobberfilepublisher_removepublishedfileifowned": "removePublishedFileIfOwned()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L215 | neighbors=[PortableNoClobberFilePublisher.ts, copyFileExclusiveDurable(), publishFilePortableNoClobber(), AudioStorage.ts]
- "security_portablenoclobberfilepublisher_requireexpectedfile": "requireExpectedFile()" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L459 | neighbors=[PortableNoClobberFilePublisher.ts, finalizeReservedFilePortableNoClobber(), publishFilePortableNoClobber(), reserveFilePortableNoClobber()]
- "security_runtimemutationerror_normalizeruntimemutationerror": "normalizeRuntimeMutationError()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L41 | neighbors=[GuardedRuntimeMutationSession.ts, RuntimeMutationError.ts, isTargetExists(), RuntimeMutationError]
- "security_runtimepathpolicy_assertnoruntimepathcollisions": "assertNoRuntimePathCollisions()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L68 | neighbors=[smoke-sprint-129-25c-2a-guarded-filesys…, RuntimePathPolicy.ts, invalidPath(), runtimePortableCollisionKey()]
- "security_runtimepathpolicy_isportableruntimesegment": "isPortableRuntimeSegment()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L50 | neighbors=[RuntimeBackupPathPolicy.ts, RuntimeMigrationCandidateManifest.ts, RuntimePathPolicy.ts, utf8Length()]
- "security_runtimepathpolicy_runtimeportablepathlimits": "runtimePortablePathLimits" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L5 | neighbors=[RuntimeBackupPathPolicy.ts, smoke-sprint-129-25c-2a-guarded-filesys…, smoke-sprint-129-25c-2b-1-migration-can…, RuntimePathPolicy.ts]
- "security_runtimepathpolicy_utf8length": "utf8Length()" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L123 | neighbors=[RuntimePathPolicy.ts, isPortableRuntimeSegment(), validateMutationRelativePath(), validateRuntimeLogicalPath()]
- "security_runtimeprotectedroots_overlaps": "overlaps()" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L151 | neighbors=[RuntimeProtectedRoots.ts, runtimePathInside(), samePath(), .assertWritableRoot()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-059.json

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
