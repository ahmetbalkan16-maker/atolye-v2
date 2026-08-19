# Node Description Batch 36 of 166

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
LANGUAGE: each entry has a `lang=` marker giving the language of its source.
Write that entry's description in EXACTLY that language. Do not translate to
a single common language — match each node's source language individually.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "audio_audiopublicationintentstore_validintent": "validIntent()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L299 | neighbors=[AudioPublicationIntentStore.ts, readIntent(), digest(), hasExactKeys(), validateIntentAsset(), validPublication()] | lang=en
- "backup_runtimebackupauthority_asserttrustedruntimebackupstorageauthority": "assertTrustedRuntimeBackupStorageAuthority()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L49 | neighbors=[RuntimeBackupAuthority.ts, canonicalBackupRoot(), readMarker(), validRuntimeAuthorityId(), RuntimeBackupService.ts, ProductionCompletedStageRegenerationSer…] | lang=en
- "backup_runtimebackupauthority_bootstrapruntimebackupstorageauthority": "bootstrapRuntimeBackupStorageAuthority()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L26 | neighbors=[RuntimeBackupAuthority.ts, bootstrap(), canonicalBackupRoot(), defaultBackupRoot(), run-production-regeneration.ts, runtime-backup.ts] | lang=en
- "backup_runtimebackupinventory_hashstableruntimefile": "hashStableRuntimeFile()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L155 | neighbors=[RuntimeBackupInventory.ts, sameIdentity(), samePath(), walkRuntimeTree(), RuntimeMigrationCandidateService.ts, GuardedRuntimeMutationSession.ts] | lang=en
- "backup_runtimebackupmanifest_assertexactkeys": "assertExactKeys()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L365 | neighbors=[RuntimeBackupManifest.ts, validateFileRecord(), validateGitMetadata(), validateRuntimeBackupManifest(), validateSourceRuntimeAuthority(), validateTotals()] | lang=en
- "backup_runtimebackupmanifest_isrecord": "isRecord()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L361 | neighbors=[RuntimeBackupManifest.ts, validateFileRecord(), validateGitMetadata(), validateRuntimeBackupManifest(), validateSourceRuntimeAuthority(), validateTotals()] | lang=en
- "backup_runtimebackupmanifest_runtimebackupmanifestsha256": "runtimeBackupManifestSha256()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L110 | neighbors=[RuntimeBackupManifest.ts, RuntimeBackupVerifier.ts, smoke-sprint-129-25c-1-runtime-backup.ts, smoke-sprint-129-25c-2b-1-migration-can…, smoke-sprint-129-25c-2b-2-migration-can…, GuardedRuntimeMutationSession.ts] | lang=en
- "backup_runtimebackupmanifest_validatefilerecord": "validateFileRecord()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L188 | neighbors=[RuntimeBackupManifest.ts, assertExactKeys(), isRecord(), validateGitMetadata(), validRelativePath(), validateRuntimeBackupManifest()] | lang=en
- "backup_runtimebackuppathpolicy_validatev2segments": "validateV2Segments()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L91 | neighbors=[RuntimeBackupPathPolicy.ts, assertRuntimeBackupMaterializedPath(), validateRuntimeBackupMutationRelativePa…, validateRuntimeBackupRelativePath(), invalidPath(), utf8Length()] | lang=en
- "backup_runtimebackupservice_portableverifyruntimebackup": "portableVerifyRuntimeBackup()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L145 | neighbors=[RuntimeBackupService.ts, decodePortableRequest(), materializeAndVerify(), requireExistingAbsoluteDirectory(), runtime-backup.ts, smoke-sprint-129-25c-1-runtime-backup.ts] | lang=en
- "backup_runtimebackupverifier_verifyruntimetreeagainstmanifest": "verifyRuntimeTreeAgainstManifest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L99 | neighbors=[RuntimeBackupVerifier.ts, verifyRuntimeBackup(), requireAbsoluteDirectory(), RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts, GuardedRuntimeMutationSession.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@10c20ecada650e825140f5dbe221352f83e1ef41": "10c20ec Connect AI script generation pipeline" | kind=Commit | source=git | neighbors=[AIManager.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 5d7b62d Connect scene generation pipeli…, e3eba68 Connect research API to AIManag…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5d7b62d8059c058fb499908e52b812ed6ff5cc50": "5d7b62d Connect scene generation pipeline to AI provider" | kind=Commit | source=git | neighbors=[10c20ec Connect AI script generation pi…, AIManager.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 732ceca feat(visuals): add visual manag…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8803c39d406c6bc156167a4408e90d78c3470fef": "8803c39 fix(test): enforce production visual runtime storage context" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 05bea2f docs(checkpoint): close sprints…, smoke-production-visual-asset-wiring.ts, 91b37ec feat(production): persist Fatih…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@9ea85cfea30f2c0a71579213d12b10fcbe491e52": "9ea85cf fix(production): remove residual recovery debug log" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 9d652d5 fix(production): close sprint 1…, ProductionExecutionRecoveryBootstrap.ts, cfb4887 feat(sprint-129.35): legacy ter…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a319525c7cb2adfa638e97fb672b2a6176448903": "a319525 Setup ProjectManager V2 architecture" | kind=Commit | source=git | neighbors=[wip/sprint-129-28-remediation, 60d8f0c Sprint 11 completed - Scene Eng…, getProjects.ts, projectTypes.ts, openai.ts, route.ts] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c53ddad57a5adc7b697acc0c82a3e4965442d170": "c53ddad refactor(ai): migrate AIManager to shared utilities" | kind=Commit | source=git | neighbors=[c18dd35 refactor(ai): extend shared uti…, AIManager.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 20717bf feat(project): add manifest lay…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c97ecfcdd01e85379489ce3ac627594f2f7dc0f2": "c97ecfc test(production): close sprint 129.32 exact retry ordinal" | kind=Commit | source=git | neighbors=[0d87231 wip: checkpoint Sprint 129.32 s…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, a029553 fix(production): close sprint 1…, smoke-sprint-129-29-failed-terminal-set…] | lang=en
- "export_exportproviderconfig": "ExportProviderConfig.ts" | kind=code-symbol | source=src/lib/export/ExportProviderConfig.ts:L1 | neighbors=[8bc6e5f feat(youtube-export): add youtu…, defaultExportProviderConfig, ExportProviderConfig, export.ts, ExportProviderName, ExportProviderRouter.ts] | lang=en
- "lib_canonicalsmokeevidence_addintegrity": "addIntegrity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L90 | neighbors=[CanonicalSmokeEvidence.ts, canonicalStringify(), normalizeJson(), sha256(), CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts] | lang=en
- "lib_canonicalsmokeevidence_canonicalstringify": "canonicalStringify()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L88 | neighbors=[CanonicalSmokeEvidence.ts, addIntegrity(), normalizeJson(), verifyIntegrity(), CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts] | lang=en
- "lib_canonicalsmokeevidencev2_cleandata": "cleanData()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L335 | neighbors=[CanonicalSmokeEvidenceV2.ts, object(), runChild(), validateBaselineEvidence(), validateChildEvidence(), validateFinalIntegrityEvidence()] | lang=en
- "lib_canonicalsmokeevidencev2_identityequal": "identityEqual()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L101 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), prepareNewEvidenceRoot(), requireStableDirectory(), runEvidenceMatrix(), writeAtomic()] | lang=en
- "lib_canonicalsmokeevidencev2_remainders": "remainders()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L337 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), ownershipRemainders(), runChild(), runPartition(), writeFinal()] | lang=en
- "lib_canonicalsmokeevidencev2_requirestabledirectory": "requireStableDirectory()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L140 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), prepareNewEvidenceRoot(), fail(), identityEqual(), writeAtomic()] | lang=en
- "lib_canonicalsmokeevidencev2_validateregistrationfingerprint": "validateRegistrationFingerprint()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L378 | neighbors=[CanonicalSmokeEvidenceV2.ts, validateBaselineEvidence(), validateFinalIntegrityEvidence(), equal(), fail(), object()] | lang=en
- "lib_canonicalsmokeevidencev2_zero": "zero()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L332 | neighbors=[CanonicalSmokeEvidenceV2.ts, runChild(), runPartition(), validateChildEvidence(), validateFinalIntegrityEvidence(), validatePartitionEvidence()] | lang=en
- "lib_historicalaudioordinalfourpreflight_bodywithoutintegrity": "bodyWithoutIntegrity()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L342 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, poisonHistoricalAudioOrdinalFourAttempt…, preflightHistoricalAudioOrdinalFour(), rewriteAttempt(), withClaimIntegrity(), withLeaseIntegrity()] | lang=en
- "lib_runtime_tracking_inventory_collectruntimetrackinginventory": "collectRuntimeTrackingInventory()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L21 | neighbors=[runtime-tracking-inventory.ts, collectFiles(), samePath(), smoke-sprint-129-25b-1-runtime-hardenin…, smoke-sprint-129-25b-runtime-root.ts, smoke-sprint-129-25c-1-runtime-backup.ts] | lang=en
- "migration_runtimemigrationcandidatemanifest_serializeruntimemigrationcandidatemanifest": "serializeRuntimeMigrationCandidateManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L162 | neighbors=[RuntimeMigrationCandidateManifest.ts, canonicalManifest(), validateRuntimeMigrationCandidateManife…, RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-2b-1-migration-can…] | lang=en
- "migration_runtimemigrationcandidatemanifest_validatedurablebinding": "validateDurableBinding()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L407 | neighbors=[RuntimeMigrationCandidateManifest.ts, exact(), invalid(), isRecord(), sha256(), validateManifest()] | lang=en
- "migration_runtimemigrationcandidatemanifest_validatesourcebackup": "validateSourceBackup()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L320 | neighbors=[RuntimeMigrationCandidateManifest.ts, validateManifest(), exact(), invalid(), isRecord(), sha256()] | lang=en
- "migration_runtimemigrationcandidatemanifest_validatesourceevidence": "validateSourceEvidence()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L371 | neighbors=[RuntimeMigrationCandidateManifest.ts, validateManifest(), exact(), invalid(), isRecord(), validateBindings()] | lang=en
- "migration_runtimemigrationcandidatepaths_planmigrationcandidatepaths": "planMigrationCandidatePaths()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidatePaths.ts:L33 | neighbors=[RuntimeMigrationCandidatePaths.ts, insideOrEqual(), pathsOverlap(), validateMigrationCandidateId(), RuntimeMigrationCandidatePreflight.ts, smoke-sprint-129-25c-2b-1-migration-can…] | lang=en
- "migration_runtimemigrationcandidateservice_verifystagedmigrationcandidate": "verifyStagedMigrationCandidate()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateService.ts:L504 | neighbors=[RuntimeMigrationCandidateService.ts, createVerifiedMigrationCandidateInterna…, inspectStagingDirectories(), requireExactStagingEntries(), requireStagingDirectory(), requireStagingFile()] | lang=en
- "pipeline_pipelinejobmanager_pipelinejobmanager_readjoblist": ".readJobList()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L632 | neighbors=[PipelineJobManager, .getJobForStageReadOnly(), .getJobReadOnly(), .listJobs(), .listJobsReadOnly(), .readPipelineStateFile()] | lang=en
- "pipeline_pipelinejobmanager_pipelinejobmanager_recordhistoryevent": ".recordHistoryEvent()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L689 | neighbors=[PipelineJobManager, .applyActionUnlocked(), createHistoryEvent(), isPipelineJobHistoryStatus(), .readHistory(), .transitionStageJobUnlocked()] | lang=en
- "pipeline_pipelinejobmanager_pipelinejobmanager_writejoblist": ".writeJobList()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L656 | neighbors=[PipelineJobManager, .applyActionUnlocked(), .prepareJobRetryUnderLock(), .transitionStageJobUnlocked(), .withProjectLock(), .writeJobListUnlocked()] | lang=en
- "pipeline_pipelinejobmutationlock_releaseownedgate": "releaseOwnedGate()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L576 | neighbors=[PipelineJobMutationLock.ts, assertOwnershipPath(), injectReleaseFailure(), invokeCanonicalMutationBarrier(), quarantineAndRemove(), withAcquisitionGate()] | lang=en
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner_createresumeplan": ".createResumePlan()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L91 | neighbors=[PipelineRecoveryPlanner, createBlockedPlan(), getBlockedReason(), getDependencyStatuses(), getNextIncompleteOrUnreadyStage(), getStagesFrom()] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-035.json

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
