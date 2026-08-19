# Node Description Batch 18 of 166

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

- "audio_audiocompensationstore_inspectdeferredbacklog": "inspectDeferredBacklog()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L2276 | neighbors=[AudioCompensationStore.ts, getDeferredAudioCompensationBacklogStat…, cleanupRootIfPresent(), isLogicallyRetired(), isSafeAudioCompensationRef(), measureDeferredWorkspace()] | lang=en
- "audio_audiocompensationstore_readretirementplan": "readRetirementPlan()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1267 | neighbors=[AudioCompensationStore.ts, executeRetirementPlan(), isLogicallyRetired(), AudioCompensationStoreError, digest(), identityInteger()] | lang=en
- "audio_audiocompensationstore_removeregistryownedaudiocompensationrecord": "removeRegistryOwnedAudioCompensationRecord()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L772 | neighbors=[AudioCompensationStore.ts, AudioCompensationStoreError, cleanupRootIfPresent(), executeRetirementPlan(), isSafeAudioCompensationRef(), readProtectedAudioCompensationReceipt()] | lang=en
- "audio_audiocompensationstore_writedurablejsonnoclobber": "writeDurableJsonNoClobber()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1728 | neighbors=[AudioCompensationStore.ts, bindProtectedAudioCompensationPublicati…, createProtectedAudioCompensationReceipt…, finalizeRecordPlacement(), prepareAudioCompensationWorkspace(), reserveProtectedAudioCompensationPublic…] | lang=en
- "backup_runtimebackupservice_createverifiedruntimebackup": "createVerifiedRuntimeBackup()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L85 | neighbors=[RuntimeBackupService.ts, decodeCreateDependencies(), decodeCreateRequest(), normalizeCreateError(), protectedRootsFor(), requireExistingAbsoluteDirectory()] | lang=en
- "backup_runtimebackupservice_invalidrequest": "invalidRequest()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L325 | neighbors=[RuntimeBackupService.ts, decodeCreateDependencies(), decodeCreateRequest(), decodePortableRequest(), decodeRestoreRequest(), exactBackupDirectory()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0d7b72cf14f49dc60908f940cad6ed9b6ef9a490": "0d7b72c feat(production): add execution safety planning foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2d330472afa786959b4338d124b78033c97c2c3b": "2d33047 feat(production): integrate durable execution with pipeline stages" | kind=Commit | source=git | neighbors=[0c8dfb2 feat(production): add durable w…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@351802223177d58d146b914cd59ee6122d23f38f": "3518022 feat: complete sprint 67 pipeline queue ui hardening" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3652d015c7a510af3cac120653f7d7a471d907b9": "3652d01 feat(production): add operation journal contract" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3be36691efdb80eb1d275a714776d1267f95b93a": "3be3669 feat(production): complete durable production execution phase" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@4077613d025a04c8218565c3730ae8d682c45223": "4077613 feat(production): add execution coordinator foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@560e0131a3fa2732817db6747603e273ecf02ad3": "560e013 feat(production): add worker execution contract" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5b68c56a4d96199acae56ba14947c407ce308e2d": "5b68c56 refactor(ai): add shared json and mapping utilities" | kind=Commit | source=git | neighbors=[0a03cad refactor(types): cleanup domain…, AssemblyManager.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, c18dd35 refactor(ai): extend shared uti…] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@65a14b48c519456db0cfc8266eee1f1073e3aadf": "65a14b4 feat(production): add health evidence panel" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@733a715a0a4cd451c457be63bde89737c3343893": "733a715 feat(snapshot): harden production snapshot consistency" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@7561f3d5e53735dad3144bcb3573c4b93b18d41b": "7561f3d feat(production): harden durable storage recovery and indexing" | kind=Commit | source=git | neighbors=[42ff8de docs(production): record sprint…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8017502faa8c5d5daf89f76030a450c4c692cfe1": "8017502 feat(production): add queue dispatch contract" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8ac37cd292248ea2a5621cbf2cfefc89584f14ec": "8ac37cd feat(production): add snapshot contract foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@8ccddcb7444d0c33255ac316cdd13006aba9155a": "8ccddcb feat(visual): improve asset generation workflow and versioning ui" | kind=Commit | source=git | neighbors=[72fc633 feat(asset): integrate openai i…, AssetGallery.tsx, route.ts, VisualPromptPreview.tsx, agents/api-graphify-mcp-integration, main] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@aba67dacaf6209d41248f1b81ce640e04a3daedd": "aba67da feat(production): add health findings panel" | kind=Commit | source=git | neighbors=[53955f6 feat(production): add health ui…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b8e8aaa48ddd7bc60c90fed631b1c53626de581b": "b8e8aaa feat(pipeline): add stage completion orchestration" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@bfb10e22ec760cde338e3ae90f8ea180c6f6dedb": "bfb10e2 feat(pipeline): add safe auto-continuation" | kind=Commit | source=git | neighbors=[b8e8aaa feat(pipeline): add stage compl…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c19748c15637c65eb58e2333eb188740f04ec1ec": "c19748c feat(pipeline): add resume execution foundation" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c812810ad0316339ee712f72c624c77e09bcfad6": "c812810 Sprint 112: Add production runtime health API" | kind=Commit | source=git | neighbors=[0e442b3 Sprint 111: Add production runt…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@d612d96317fd353dbf72124bd13bda77b521bebe": "d612d96 feat: add production execution persistence foundation" | kind=Commit | source=git | neighbors=[cda6d48 docs(production): close product…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@d655db9ac9e5e72eb8818cc251ec4abd0b65153e": "d655db9 feat(production): add execution transaction contract" | kind=Commit | source=git | neighbors=[1b10df5 docs(production): record sprint…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@dd74765c206fe2123c2aacaed6339831a9245f66": "dd74765 feat: detect corrupted pipeline state" | kind=Commit | source=git | neighbors=[c5fd1ea feat: harden pipeline history p…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e70e1736e2ec71035bb690b5adf7155ac00d3b45": "e70e173 feat(production): add controlled execution gateway" | kind=Commit | source=git | neighbors=[354f9ac docs(production): record sprint…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@fd0ec3801154c666a2dd491e7534ae68e6de6d79": "fd0ec38 feat(studio): add pipeline resume action" | kind=Commit | source=git | neighbors=[a945ab4 feat(pipeline): add resume API …, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "fixtures_sprint_129_33_pipeline_job_lock_child": "sprint-129-33-pipeline-job-lock-child.ts" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-pipeline-job-lock-child.ts:L1 | neighbors=[a029553 fix(production): close sprint 1…, assertOwnershipLoss(), main(), waitFor(), PipelineJobManager.ts, PipelineJobManager] | lang=en
- "lib_canonicalsmokeevidencev2_string": "string()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L69 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), deriveAggregateResult(), loadInventory(), runEvidenceMatrix(), fail()] | lang=en
- "lib_canonicalsmokeevidencev2_validatebaselineevidence": "validateBaselineEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L423 | neighbors=[CanonicalSmokeEvidenceV2.ts, deriveAggregateResult(), runEvidenceMatrix(), array(), cleanData(), fail()] | lang=en
- "lib_canonicalsmokeevidencev2_validatefinalintegrityevidence": "validateFinalIntegrityEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L740 | neighbors=[CanonicalSmokeEvidenceV2.ts, deriveAggregateResult(), array(), cleanData(), equal(), fail()] | lang=en
- "lib_canonicalsmokeevidencev2_validatematrixcontract": "validateMatrixContract()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L405 | neighbors=[CanonicalSmokeEvidenceV2.ts, deriveAggregateResult(), runEvidenceMatrix(), currentHead(), equal(), expectedContract()] | lang=en
- "lib_canonicalsmokeevidencev2_writefinal": "writeFinal()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L724 | neighbors=[CanonicalSmokeEvidenceV2.ts, runEvidenceMatrix(), currentHead(), dataProjectsState(), environmentEvidence(), loadInventory()] | lang=en
- "lib_canonicalsmokeruntime_recovercanonicalsmokeworkspace": "recoverCanonicalSmokeWorkspace()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L114 | neighbors=[CanonicalSmokeRuntime.ts, canonicalPath(), deserialize(), identity(), identitySafeRemoveLeaf(), isProcessAlive()] | lang=en
- "migration_runtimemigrationcandidateerror_runtimemigrationcandidateerror": "RuntimeMigrationCandidateError" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateError.ts:L40 | neighbors=[RuntimeMigrationCandidateError.ts, migrationCandidateError(), .constructor(), .toJSON(), RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidatePaths.ts] | lang=en
- "pipeline_pipelinestateapierror": "PipelineStateApiError.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineStateApiError.ts:L1 | neighbors=[e705042 feat: harden pipeline state err…, route.ts, route.ts, route.ts, createPipelineStateErrorResponse(), PipelineStateError.ts] | lang=en
- "pipeline_route": "route.ts" | kind=code-symbol | source=app/api/pipeline/route.ts:L1 | neighbors=[4c104fa feat(production): wire durable …, 5a68409 feat(pipeline): add full docume…, 7cf9535 feat(pipeline): implement job s…, e705042 feat: harden pipeline state err…, fb444fd wip: preserve C.2B.3 audit and …, PipelineRunner.ts] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-017.json

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
