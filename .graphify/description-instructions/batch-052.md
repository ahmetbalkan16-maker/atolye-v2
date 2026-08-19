# Node Description Batch 53 of 166

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

- "pipeline_pipelinejobmutationlock_ismissing": "isMissing()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L822 | neighbors=[PipelineJobMutationLock.ts, recoverStaleGate(), recoverVerifiedStaleLock(), verifyCanonicalOwnerPublicationFailureC…]
- "pipeline_pipelinejobmutationlock_mutationrename": "mutationRename()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L789 | neighbors=[PipelineJobMutationLock.ts, observeFilesystemMutation(), publishOwnedLock(), quarantineAndRemove()]
- "pipeline_pipelinejobmutationlock_mutationrmdir": "mutationRmdir()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L806 | neighbors=[PipelineJobMutationLock.ts, observeFilesystemMutation(), quarantineAndRemove(), verifyCanonicalForeignQuarantinePreserv…]
- "pipeline_pipelinerecoveryplanner_createblockedplan": "createBlockedPlan()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L345 | neighbors=[PipelineRecoveryPlanner.ts, .createJobRetryPlan(), .createResumePlan(), .createRetryPlan()]
- "pipeline_pipelinerecoveryplanner_getblockedreason": "getBlockedReason()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L331 | neighbors=[PipelineRecoveryPlanner.ts, .createJobRetryPlan(), .createResumePlan(), .createRetryPlan()]
- "pipeline_pipelinerecoveryplanner_getdependencystatuses": "getDependencyStatuses()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L228 | neighbors=[PipelineRecoveryPlanner.ts, .createJobRetryPlan(), .createResumePlan(), .createRetryPlan()]
- "pipeline_pipelinerecoveryplanner_getnextincompleteorunreadystage": "getNextIncompleteOrUnreadyStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L213 | neighbors=[PipelineRecoveryPlanner.ts, isStageFileReady(), .createResumePlan(), .getNextIncompleteStage()]
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner_createjobretryplan": ".createJobRetryPlan()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L178 | neighbors=[PipelineRecoveryPlanner, createBlockedPlan(), getBlockedReason(), getDependencyStatuses()]
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner_createretryplan": ".createRetryPlan()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L139 | neighbors=[PipelineRecoveryPlanner, createBlockedPlan(), getBlockedReason(), getDependencyStatuses()]
- "pipeline_pipelinerecoveryplanner_pipelinestagedependencies": "pipelineStageDependencies" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L31 | neighbors=[PipelineRecoveryPlanner.ts, ProductionCompletedStageRegenerationGra…, ProductionDependencyGraph.ts, ProductionSnapshotParts.ts]
- "pipeline_pipelinerunner_pipelinerunner_continueprojectonce": ".continueProjectOnce()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L546 | neighbors=[PipelineRunner, isProvenContinuationContenderLoss(), .requireRuntimeStorageContext(), .runPipelineStage()]
- "pipeline_pipelinerunner_pipelinerunner_requireruntimestoragecontext": ".requireRuntimeStorageContext()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L873 | neighbors=[PipelineRunner, .continueProjectOnce(), .executeJobRetryOnce(), .resumeOnce()]
- "pipeline_pipelinerunner_validatestrictproductionresumestate": "validateStrictProductionResumeState()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1120 | neighbors=[PipelineRunner.ts, .resumeOnce(), smoke-sprint-128-1-production-acceptanc…, smoke-sprint-129-28-production-acceptan…]
- "pipeline_pipelinestageexecutor_pipelinestageexecutor_execute": ".execute()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L222 | neighbors=[PipelineStageExecutor, .persistStageResult(), requireStageInput(), requireStorageContext()]
- "pipeline_pipelinestateerror_getpipelinestatepublicerror": "getPipelineStatePublicError()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L33 | neighbors=[PipelineStateApiError.ts, PipelineStateError.ts, isPipelineStateError(), smoke-pipeline-state-error-contract.ts]
- "production_productionacceptanceconfigurationfingerprint_createproductionacceptanceportableconfigurationsnapshot": "createProductionAcceptancePortableConfigurationSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L76 | neighbors=[ProductionAcceptanceConfigurationFinger…, createProductionAcceptancePortableConfi…, ProductionAcceptancePolicy.ts, smoke-sprint-129-23-production-acceptan…]
- "production_productionacceptanceconfigurationfingerprint_productionacceptancecomponentfingerprintsv2": "ProductionAcceptanceComponentFingerprintsV2" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L57 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts, smoke-sprint-129-24-acceptance-marker-r…]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceportableconfigurationfingerprintv2": "productionAcceptancePortableConfigurationFingerprintV2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L196 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptancePolicy.ts, smoke-sprint-129-24-acceptance-marker-r…]
- "production_productionacceptanceconfigurationfingerprint_validproductionacceptancecomponentfingerprintsv2": "validProductionAcceptanceComponentFingerprintsV2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L180 | neighbors=[ProductionAcceptanceConfigurationFinger…, validComponentFingerprintRecord(), ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceexecutionscope_productionacceptanceprovideradaptererror": "ProductionAcceptanceProviderAdapterError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L46 | neighbors=[ProductionAcceptanceExecutionScope.ts, createExplicitProviderDispatchAdapter(), .constructor(), smoke-sprint-129-28-production-acceptan…]
- "production_productionacceptancelegacyauthoritystore_admissionconflict": "admissionConflict()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L488 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, readLegacyReauthorizationAuthority(), verifyArchive(), verifyReceipt()]
- "production_productionacceptancelegacyauthoritystore_ensuredirectory": "ensureDirectory()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L444 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, conflict(), persistence(), publishLegacyArchive()]
- "production_productionacceptancelegacyauthoritystore_legacyarchivelocator": "legacyArchiveLocator()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L32 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, conflict(), validateLegacyAuthority(), ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyauthoritystore_readlegacyvalidation": "readLegacyValidation()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L294 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, readLegacyReauthorizationAuthority(), conflict(), readValidationFile()]
- "production_productionacceptancelegacyauthoritystore_syncdirectory": "syncDirectory()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L453 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, publishExactNoClobber(), publishLegacyPublicationReceipt(), publishLegacyReauthorizationAuthority()]
- "production_productionacceptancelegacyauthoritystore_validatelegacypublicationreceipt": "validateLegacyPublicationReceipt()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L268 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, readLegacyPublicationReceiptDescriptorB…, safeSlug(), validBoundFile()]
- "production_productionacceptancelegacyauthoritystore_writesynced": "writeSynced()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L392 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, publishExactNoClobber(), persistence(), reliable()]
- "production_productionacceptancelegacydurablerecoverysnapshot_causal": "causal()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L531 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertAdmittedDurableBindings(), assertAdmittedDurableIdentityBindings(), assertDurableCausalBindings()]
- "production_productionacceptancelegacyreauthorization_derivelegacyreauthorizationchallengeid": "deriveLegacyReauthorizationChallengeId()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L238 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, canonicalJson(), sha256Bytes(), ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_productionacceptancelegacyreauthorizationv1": "ProductionAcceptanceLegacyReauthorizationV1" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L126 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts]
- "production_productionacceptancelegacyreauthorizationpreflight_readexactfile": "readExactFile()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L255 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, inventoryFingerprint(), failure(), reliable()]
- "production_productionacceptancemarkerdescriptorreader_identity": "identity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L174 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, normalizedFilesystemIdentity(), requireRegularDescriptorIdentity(), requireRegularPathIdentity()]
- "production_productionacceptancemarkerdescriptorreader_normalizedfilesystemidentity": "normalizedFilesystemIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L145 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceMarkerDescriptorRea…, identity(), smoke-sprint-129-28-production-acceptan…]
- "production_productionacceptanceorchestrator_productionacceptanceconfigurationchangederror": "ProductionAcceptanceConfigurationChangedError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L151 | neighbors=[ProductionAcceptanceOrchestrator.ts, .constructor(), .run(), smoke-sprint-129-33-exhausted-retry-adm…]
- "production_productionacceptanceorchestrator_requiresproductionacceptanceresume": "requiresProductionAcceptanceResume()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L371 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionAcceptanceExecutionError, resumeProductionAcceptanceIfNeeded(), smoke-sprint-128-1-production-acceptanc…]
- "production_productionacceptancepolicy_createproductionacceptancemarkerv3profile2value": "createProductionAcceptanceMarkerV3Profile2Value()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1334 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarkerV3Profi…, productionAcceptanceRequestFingerprintV…, prepareProductionAcceptanceMarkerReprep…]
- "production_productionacceptancepolicy_ismarkerv3profile2": "isMarkerV3Profile2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1390 | neighbors=[ProductionAcceptancePolicy.ts, diagnoseProductionAcceptanceConfigurati…, markerMatchesCurrentConfiguration(), prepareProductionAcceptanceMarkerReprep…]
- "production_productionacceptancepolicy_issueproductionacceptancestagecapability": "issueProductionAcceptanceStageCapability()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L470 | neighbors=[PipelineRunner.ts, ProductionAcceptancePolicy.ts, admissionFailure(), smoke-sprint-129-28-production-acceptan…]
- "production_productionacceptancepolicy_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1406 | neighbors=[ProductionAcceptancePolicy.ts, validMarkerV2(), validMarkerV3(), validMarkerV3Profile2()]
- "production_productionacceptancepreflight_requireacceptancerange": "requireAcceptanceRange()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L206 | neighbors=[ProductionAcceptancePreflight.ts, ProductionDurationPreflightError, validateProductionAcceptancePreflight(), validateProductionAcceptanceScriptDurat…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-052.json

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
