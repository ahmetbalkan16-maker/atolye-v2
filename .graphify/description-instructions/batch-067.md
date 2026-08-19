# Node Description Batch 68 of 166

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

- "pipeline_pipelinejobmutationlock_quarantineprotocolerror": "QuarantineProtocolError" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L613 | neighbors=[PipelineJobMutationLock.ts, quarantineAndRemove(), .constructor()]
- "pipeline_pipelinejobmutationlock_readosprocessstartepochms": "readOsProcessStartEpochMs()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L449 | neighbors=[PipelineJobMutationLock.ts, readCanonicalProcessStartEpochMs(), processIsAlive()]
- "pipeline_pipelinejobmutationlock_sameidentity": "sameIdentity()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L556 | neighbors=[PipelineJobMutationLock.ts, recoverVerifiedStaleLock(), releaseOwnedLock()]
- "pipeline_pipelinerecoveryplanner_getnextpipelinestage": "getNextPipelineStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L49 | neighbors=[PipelineJobManager.ts, PipelineRecoveryPlanner.ts, smoke-pipeline-orchestration.ts]
- "pipeline_pipelinerecoveryplanner_isstagefileready": "isStageFileReady()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L254 | neighbors=[PipelineRecoveryPlanner.ts, getNextIncompleteOrUnreadyStage(), readStageData()]
- "pipeline_pipelineretryadmission_fingerprintidentity": "fingerprintIdentity()" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L193 | neighbors=[PipelineRetryAdmission.ts, assertCanonicalPipelineRetryAdmission(), sameExecutionIdentity()]
- "pipeline_pipelineretryadmission_freezepipelineretryadmission": "freezePipelineRetryAdmission()" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L78 | neighbors=[PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, ProductionPipelineRetryBudgetExtensionT…]
- "pipeline_pipelineretryadmission_sameexecutionidentity": "sameExecutionIdentity()" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L186 | neighbors=[PipelineRetryAdmission.ts, assertCanonicalPipelineRetryAdmission(), fingerprintIdentity()]
- "pipeline_pipelinerunner_pipelinerunner_continueproject": ".continueProject()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L457 | neighbors=[PipelineRunner, .withRuntimeOperation(), .dispatchProjectContinuationOnce()]
- "pipeline_pipelinerunner_pipelinerunner_dispatchprojectcontinuation": ".dispatchProjectContinuation()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L477 | neighbors=[PipelineRunner, .withRuntimeOperation(), .executeJobRetryOnce()]
- "pipeline_pipelinerunner_pipelinerunner_executejobretry": ".executeJobRetry()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L658 | neighbors=[PipelineRunner, .withRuntimeOperation(), .retryStageOnce()]
- "pipeline_pipelinerunner_pipelinerunner_runpipelinestage": ".runPipelineStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L879 | neighbors=[PipelineRunner, .continueProjectOnce(), .runStage()]
- "pipeline_pipelinerunner_pipelinerunner_runscheduledstages": ".runScheduledStages()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L907 | neighbors=[PipelineRunner, .resumeOnce(), .runOnce()]
- "pipeline_pipelinerunnercanonicalruntime_assertpipelinerunnerproductionruntimeoperationactive": "assertPipelineRunnerProductionRuntimeOperationActive()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L91 | neighbors=[PipelineRunner.ts, PipelineRunnerCanonicalRuntime.ts, assertProcessCanonicalLockOwnership()]
- "pipeline_pipelinerunnercanonicalruntime_executepipelinerunnerproductionruntimeoperation": "executePipelineRunnerProductionRuntimeOperation()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L68 | neighbors=[PipelineRunner.ts, PipelineRunnerCanonicalRuntime.ts, assertProcessCanonicalLockOwnership()]
- "pipeline_pipelinerunnercanonicalruntime_installpipelinerunnerproductionruntime": "installPipelineRunnerProductionRuntime()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L42 | neighbors=[PipelineRunner.ts, PipelineRunnerCanonicalRuntime.ts, assertProcessCanonicalLockOwnership()]
- "pipeline_pipelinerunnercanonicalruntime_restorepipelinerunnerproductionruntime": "restorePipelineRunnerProductionRuntime()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L31 | neighbors=[PipelineRunnerCanonicalRuntime.ts, assertProcessCanonicalLockOwnership(), ProductionPipelineExecutionConfiguratio…]
- "pipeline_pipelinestageexecutor_pipelinestageexecutionoptions": "PipelineStageExecutionOptions" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L99 | neighbors=[PipelineRunner.ts, PipelineStageExecutor.ts, smoke-sprint-129-28-production-acceptan…]
- "pipeline_pipelinestateerror_getpipelinestateerrorcode": "getPipelineStateErrorCode()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L72 | neighbors=[PipelineStateError.ts, isPipelineStateError(), .constructor()]
- "production_productionacceptancecommand_commandfailure": "commandFailure()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L301 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand(), usageFailure()]
- "production_productionacceptancecommand_parseextendretrybudgetarguments": "parseExtendRetryBudgetArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L490 | neighbors=[ProductionAcceptanceCommand.ts, exactValue(), runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parselegacyreauthorizationarguments": "parseLegacyReauthorizationArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L334 | neighbors=[ProductionAcceptanceCommand.ts, exactValue(), runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parselegacyreauthorizationplanarguments": "parseLegacyReauthorizationPlanArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L322 | neighbors=[ProductionAcceptanceCommand.ts, exactValue(), runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parseresumearguments": "parseResumeArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L442 | neighbors=[ProductionAcceptanceCommand.ts, isPipelineRecoveryStageKey(), runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parseretrybudgetextensionplanarguments": "parseRetryBudgetExtensionPlanArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L477 | neighbors=[ProductionAcceptanceCommand.ts, exactValue(), runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_productionacceptancecommanddependencies": "ProductionAcceptanceCommandDependencies" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L60 | neighbors=[ProductionAcceptanceCommand.ts, run-production-acceptance.ts, smoke-sprint-129-39-stage-bounded-resum…]
- "production_productionacceptancecommand_usagefailure": "usageFailure()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L297 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand(), commandFailure()]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceportableconfigurationsnapshotv2": "ProductionAcceptancePortableConfigurationSnapshotV2" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L67 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceexecutionscope_createexplicitproviderdispatchadapter": "createExplicitProviderDispatchAdapter()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L215 | neighbors=[ProductionAcceptanceExecutionScope.ts, normalizeImmutableProviderDispatchAdapt…, ProductionAcceptanceProviderAdapterError]
- "production_productionacceptanceexecutionscope_productionacceptancestageexecutionscope": "ProductionAcceptanceStageExecutionScope" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L93 | neighbors=[ProductionAcceptanceExecutionScope.ts, ProductionAcceptancePolicy.ts, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptanceexecutionscope_sameproductionacceptanceexecutionscope": "sameProductionAcceptanceExecutionScope()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L323 | neighbors=[ProductionAcceptanceExecutionScope.ts, serializableProductionAcceptanceExecuti…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceexecutionscope_sameproductionacceptanceproviderselection": "sameProductionAcceptanceProviderSelection()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L279 | neighbors=[ProductionAcceptanceExecutionScope.ts, serializableProductionAcceptanceProvide…, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptanceexecutionscope_serializableproductionacceptanceexecutionscope": "serializableProductionAcceptanceExecutionScope()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L306 | neighbors=[ProductionAcceptanceExecutionScope.ts, sameProductionAcceptanceExecutionScope(), ProductionPipelineExecutionFactory.ts]
- "production_productionacceptanceexecutionscope_serializableproductionacceptanceproviderselection": "serializableProductionAcceptanceProviderSelection()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L291 | neighbors=[ProductionAcceptanceExecutionScope.ts, sameProductionAcceptanceProviderSelecti…, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptancelegacyadmissioncontext_getproductionacceptancelegacyadmittedexecution": "getProductionAcceptanceLegacyAdmittedExecution()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L34 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…, ProductionAcceptanceLegacyDurableRecove…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyadmissioncontext_getproductionacceptancelegacypreviousretryjob": "getProductionAcceptanceLegacyPreviousRetryJob()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L46 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…, ProductionAcceptanceLegacyReauthorizati…, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptancelegacyadmissioncontext_withproductionacceptancelegacyadmittedexecution": "withProductionAcceptanceLegacyAdmittedExecution()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L27 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…, ProductionAcceptancePolicy.ts, smoke-sprint-129-28-production-acceptan…]
- "production_productionacceptancelegacyauthoritystore_readlegacyarchivedescriptorbound": "readLegacyArchiveDescriptorBound()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L108 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, verifyArchive(), ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyauthoritystore_reliable": "reliable()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L459 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, readExactSnapshot(), writeSynced()]
- "production_productionacceptancelegacyauthoritystore_safeslug": "safeSlug()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L468 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, validateLegacyAuthority(), validateLegacyPublicationReceipt()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-067.json

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
