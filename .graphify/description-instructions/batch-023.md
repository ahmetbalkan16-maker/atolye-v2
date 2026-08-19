# Node Description Batch 24 of 166

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

- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a669ed5f58ec2445e1ec6e983a5f8b24e399f962": "a669ed5 feat(pipeline): harden retry dependency preflight (Sprint 86)" | kind=Commit | source=git | neighbors=[24d0cba feat(pipeline): harden retry fa…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@a945ab49026c88dd15e5842585688e8de3bca6d8": "a945ab4 feat(pipeline): add resume API endpoint" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@b5a618e3d4fb9d22aefafdc6cffa6564017546b9": "b5a618e feat(studio): add assembly production panel" | kind=Commit | source=git | neighbors=[5fd1307 feat(assembly): add video assem…, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 0a03cad refactor(types): cleanup domain…, projectProgress.ts] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c1244e6fca2535496fbfda9c75141c08d72a130b": "c1244e6 feat(pipeline): integrate final production pipeline" | kind=Commit | source=git | neighbors=[14d180a feat(project): integrate youtub…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c17c96f16aa3ec239cad1d2d608dd234bc414654": "c17c96f feat(projects): show manifest progress on dashboard" | kind=Commit | source=git | neighbors=[20717bf feat(project): add manifest lay…, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 076e2b7 Sprint 30 Phase 2 - Project Man…, ProjectList.tsx] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c2dfc4c8ef9e77ee63fb925cdc70bb92d6fb676b": "c2dfc4c fix: complete sprint 72 asset image rendering cleanup" | kind=Commit | source=git | neighbors=[0e1f281 fix: complete sprint 71 react h…, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ce9ef34f3ed767b711686345304c1b52b86d641c": "ce9ef34 complete Sprint 129.27 audio atomicity hardening" | kind=Commit | source=git | neighbors=[6286a7c feat(audio): complete truncatio…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=fr
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e3ecaa9222fcabe2051d0174b081cbe5f075de44": "e3ecaa9 Sprint 31 Phase 3 - Add Thumbnail Concept Engine" | kind=Commit | source=git | neighbors=[71ed39b Sprint 31 Phase 2 - Add Animati…, agents/api-graphify-mcp-integration, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e9e3d2e619bd801d6d40e111bda0d569f53f8620": "e9e3d2e Sprint 16 AI Router integration" | kind=Commit | source=git | neighbors=[40fa937 Fix project dashboard data load…, AIManager.ts, pipeline.ts, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ed3020b5a39d705e8fa4fc809795ad6173bc214f": "ed3020b Sprint 30 Phase 3 - Enhanced project progress UI" | kind=Commit | source=git | neighbors=[076e2b7 Sprint 30 Phase 2 - Project Man…, wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 2320bcb Sprint 31 Phase 1 - Add Visual …, ProjectList.tsx] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@f29e59400ae092ba529d7a7221b7ddec6e50acec": "f29e594 feat(asset): add real image preview to asset gallery" | kind=Commit | source=git | neighbors=[5890d1f feat(project): add manifest bas…, AssetGallery.tsx, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@f81c5663ad33787da310770ab09ea13f9ffb0fd8": "f81c566 feat: complete sprint 60 pipeline retry UI" | kind=Commit | source=git | neighbors=[85c678f feat(pipeline): add retry studi…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@fb08a5f0530cac953a3945a651db5b88413f5359": "fb08a5f feat(pipeline): add retry execution foundation" | kind=Commit | source=git | neighbors=[31fc08b feat(pipeline): add retry execu…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=pt
- "health_productionhealthmetricrules": "ProductionHealthMetricRules.ts" | kind=code-symbol | source=src/lib/production/health/ProductionHealthMetricRules.ts:L1 | neighbors=[ae73d56 feat(production): add determini…, productionHealthMetricRules, ProductionHealthRules.ts, createHealthFinding(), createRule(), productionHealthThresholds] | lang=en
- "lib_canonicalsmokeevidencev2_deriveaggregateresult": "deriveAggregateResult()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L823 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), assertNoPartials(), fail(), string(), validateBaselineEvidence()] | lang=en
- "lib_canonicalsmokeevidencev2_normalizepath": "normalizePath()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L63 | neighbors=[CanonicalSmokeEvidenceV2.ts, Identity, processIdentity(), publishIntegratedJson(), readJson(), rootAuthority()] | lang=en
- "lib_canonicalsmokeevidencev2_object": "object()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L65 | neighbors=[CanonicalSmokeEvidenceV2.ts, cleanData(), loadInventory(), fail(), validateChildEvidence(), validateEnvironmentFingerprint()] | lang=en
- "lib_canonicalsmokeevidencev2_validatepartitionevidence": "validatePartitionEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L548 | neighbors=[CanonicalSmokeEvidenceV2.ts, runEvidenceMatrix(), array(), equal(), fail(), loadInventory()] | lang=en
- "lib_historicalaudioordinalfourpreflight_preflighthistoricalaudioordinalfour": "preflightHistoricalAudioOrdinalFour()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L154 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, bodyWithoutIntegrity(), buildCanonicalIdentities(), exactVersionPaths(), readValidated(), same()] | lang=en
- "migration_runtimemigrationcandidatemanifest_exact": "exact()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L435 | neighbors=[RuntimeMigrationCandidateManifest.ts, invalid(), validateCapability(), validateDurableBinding(), validateGitEvidence(), validateManifest()] | lang=en
- "migration_runtimemigrationcandidatemanifest_validateruntimemigrationcandidatemanifest": "validateRuntimeMigrationCandidateManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L230 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest(), runtimeMigrationCandidateIdentitySha256…, runtimeMigrationCandidatePolicySha256(), serializeRuntimeMigrationCandidateManif…, validateManifest()] | lang=en
- "pipeline_pipelinejobmanager_pipelinejobmanager_listjobs": ".listJobs()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L70 | neighbors=[PipelineJobManager, .applyActionUnlocked(), .getJob(), .getJobForStage(), .readJobList(), .seedJobsFromManifest()] | lang=en
- "pipeline_pipelinestateerror_ispipelinestateerror": "isPipelineStateError()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L50 | neighbors=[PipelineRunner.ts, PipelineStateApiError.ts, PipelineStateError.ts, getPipelineStatePublicError(), getPipelineStateErrorCode(), getPipelineStateFileName()] | lang=en
- "production_productionacceptancelegacyauthoritystore_readlegacyreauthorizationauthority": "readLegacyReauthorizationAuthority()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L131 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, admissionConflict(), conflict(), readLegacyPublicationReceiptDescriptorB…, readLegacyReauthorizationAuthorityDescr…, readLegacyValidation()] | lang=en
- "production_productionacceptancelegacyreauthorization_productionacceptancelegacyreauthorizationerror": "ProductionAcceptanceLegacyReauthorizationError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L83 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyDurableRecove…, ProductionAcceptanceLegacyReauthorizati…, .constructor(), ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…] | lang=en
- "production_productionacceptanceorchestrator_productionacceptanceorchestrator": "ProductionAcceptanceOrchestrator" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L174 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts, .evaluateReadiness(), .finalize(), .resumeAndFinalize(), .run()] | lang=en
- "production_productionacceptancepolicy_markproductionacceptancevalidated": "markProductionAcceptanceValidated()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L377 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePolicy.ts, markerMatchesCurrentConfiguration(), ProductionAcceptancePolicyError, resolveEffectiveProductionAcceptanceAut…, safeSlug()] | lang=en
- "production_productionacceptancepolicy_prepareproductionacceptancemarkerreprepare": "prepareProductionAcceptanceMarkerReprepare()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1037 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarkerV3Profi…, isMarkerV3Profile2(), productionAcceptanceConfigurationFinger…, ProductionAcceptancePolicyError, safeSlug()] | lang=en
- "production_productionacceptancepolicy_productionacceptancerequestfingerprintv3profile2": "productionAcceptanceRequestFingerprintV3Profile2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1310 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts, createProductionAcceptanceMarkerV3Profi…, ProductionAcceptancePolicyError, safeRunId(), validMarkerV3Profile2()] | lang=en
- "production_productionacceptancetopic_productionacceptancetopicfingerprint": "productionAcceptanceTopicFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L54 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts, ProductionAcceptanceTopic.ts, normalizeProductionAcceptanceTopic(), smoke-sprint-129-23-production-acceptan…, smoke-sprint-129-24-acceptance-marker-r…] | lang=en
- "production_productioncompletedstageregenerationgraph": "ProductionCompletedStageRegenerationGraph.ts" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationGraph.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, pipelineStageDependencies, getProductionRegenerationClosure(), pipelineRecovery.ts] | lang=en
- "production_productionendtoendvalidation_productionendtoendvalidationerror": "ProductionEndToEndValidationError" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L31 | neighbors=[ProductionEndToEndValidation.ts, inspectAudio(), inspectImage(), inspectThumbnail(), inspectVideo(), .constructor()] | lang=en
- "production_productionendtoendvalidation_requirevalid": "requireValid()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L270 | neighbors=[ProductionEndToEndValidation.ts, inspectAudio(), inspectImage(), inspectThumbnail(), inspectVideo(), requireAsset()] | lang=en
- "production_productionendtoendvalidation_validatesnapshot": "validateSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionEndToEndValidation.ts:L75 | neighbors=[ProductionEndToEndValidation.ts, inspectAudio(), inspectImage(), inspectThumbnail(), inspectVideo(), isRecord()] | lang=en
- "production_productionexecutioncoordinator_productionexecutioncoordinator": "ProductionExecutionCoordinator" | kind=code-symbol | source=src/lib/production/ProductionExecutionCoordinator.ts:L7 | neighbors=[ProductionExecutionCoordinator.ts, .constructor(), .coordinate(), ProductionExecutionWorker.ts, ProductionPipelineExecutionFactory.ts, smoke-production-execution-coordinator.…] | lang=en
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_evaluateexecutionattemptrecovery": ".evaluateExecutionAttemptRecovery()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L12 | neighbors=[AdapterBackedProductionExecutionAttempt…, .latest(), .links(), date(), journalSequenceValid(), pathReason()] | lang=en
- "production_productionexecutiondurableattempt_adapterbackedproductionexecutionattemptservice_transitionexecutionlifecycle": ".transitionExecutionLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L17 | neighbors=[AdapterBackedProductionExecutionAttempt…, .latest(), .links(), .write(), bindingReason(), mutationReason()] | lang=en
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_commit": ".commit()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L79 | neighbors=[AdapterBackedProductionExecutionDurable…, .acquire(), denied(), mapWrite(), result(), validLease()] | lang=en
- "production_productionexecutiondurablelease_adapterbackedproductionexecutiondurableleaseservice_release": ".release()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L44 | neighbors=[AdapterBackedProductionExecutionDurable…, .commit(), .load(), date(), denied(), ownershipReason()] | lang=en
- "production_productionexecutiondurablelease_denied": "denied()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L101 | neighbors=[ProductionExecutionDurableLease.ts, .acquire(), .commit(), .heartbeat(), .load(), .release()] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-023.json

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
