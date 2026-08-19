# Node Description Batch 130 of 166

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

- "pipeline_pipelinejobmutationlock_quarantineremovalproof": "QuarantineRemovalProof" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L598 | neighbors=[PipelineJobMutationLock.ts]
- "pipeline_pipelinequeuescheduler_pipelinequeuescheduler_getnextrunnablestage": ".getNextRunnableStage()" | kind=code-symbol | source=src/lib/pipeline/PipelineQueueScheduler.ts:L12 | neighbors=[PipelineQueueScheduler]
- "pipeline_pipelinequeuescheduler_pipelinequeuescheduleresult": "PipelineQueueScheduleResult" | kind=code-symbol | source=src/lib/pipeline/PipelineQueueScheduler.ts:L6 | neighbors=[PipelineQueueScheduler.ts]
- "pipeline_pipelinerecoveryplanner_getdependencynotreadyreason": "getDependencyNotReadyReason()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L315 | neighbors=[PipelineRecoveryPlanner.ts]
- "pipeline_pipelinerecoveryplanner_pipelinerecoveryplanner_getfailedstages": ".getFailedStages()" | kind=code-symbol | source=src/lib/pipeline/PipelineRecoveryPlanner.ts:L77 | neighbors=[PipelineRecoveryPlanner]
- "pipeline_pipelineretryadmission_productionpipelineexecutionidentity": "ProductionPipelineExecutionIdentity" | kind=code-symbol | source=src/lib/pipeline/PipelineRetryAdmission.ts:L14 | neighbors=[PipelineRetryAdmission.ts]
- "pipeline_pipelinerunner_continuationcontenderlosscodes": "continuationContenderLossCodes" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1091 | neighbors=[PipelineRunner.ts]
- "pipeline_pipelinerunner_pipelinecontinuationadmission": "PipelineContinuationAdmission" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1154 | neighbors=[PipelineRunner.ts]
- "pipeline_pipelinerunner_pipelinecontinuationdispatchresult": "PipelineContinuationDispatchResult" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1147 | neighbors=[PipelineRunner.ts]
- "pipeline_pipelinerunner_pipelinerunner_configurecontinuationadmission": ".configureContinuationAdmission()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L126 | neighbors=[PipelineRunner]
- "pipeline_pipelinerunner_pipelinerunner_configuredurableexecution": ".configureDurableExecution()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L122 | neighbors=[PipelineRunner]
- "pipeline_pipelinerunner_pipelinerunner_continueprojectscoped": ".continueProjectScoped()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L467 | neighbors=[PipelineRunner]
- "pipeline_pipelinerunner_pipelinerunner_restorecontinuationadmission": ".restoreContinuationAdmission()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L132 | neighbors=[PipelineRunner]
- "pipeline_pipelinerunner_pipelinerunner_snapshotcontinuationadmission": ".snapshotContinuationAdmission()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L128 | neighbors=[PipelineRunner]
- "pipeline_pipelinerunnercanonicalruntime_canonicalpipelineruntimeregistration": "CanonicalPipelineRuntimeRegistration" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L129 | neighbors=[PipelineRunnerCanonicalRuntime.ts]
- "pipeline_pipelinerunnercanonicalruntime_claimprocesscanonicallock": "claimProcessCanonicalLock()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L104 | neighbors=[PipelineRunnerCanonicalRuntime.ts]
- "pipeline_pipelinerunnercanonicalruntime_moduleprovenance": "moduleProvenance" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L18 | neighbors=[PipelineRunnerCanonicalRuntime.ts]
- "pipeline_pipelinerunnercanonicalruntime_ownsprocesscanonicallock": "ownsProcessCanonicalLock" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L19 | neighbors=[PipelineRunnerCanonicalRuntime.ts]
- "pipeline_pipelinerunnercanonicalruntime_processcanonicallockkey": "processCanonicalLockKey" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L15 | neighbors=[PipelineRunnerCanonicalRuntime.ts]
- "pipeline_pipelinestageexecutor_pipelinestageexecutor_createinitialstate": ".createInitialState()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L149 | neighbors=[PipelineStageExecutor]
- "pipeline_pipelinestageexecutor_pipelinestageexecutor_loadstate": ".loadState()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L167 | neighbors=[PipelineStageExecutor]
- "pipeline_pipelinestateerror_getpipelinestateerrorregistry": "getPipelineStateErrorRegistry()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L104 | neighbors=[PipelineStateError.ts]
- "pipeline_pipelinestateerror_pipelinestateerrorcode": "PipelineStateErrorCode" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L4 | neighbors=[PipelineStateError.ts]
- "pipeline_pipelinestateerror_pipelinestateerrorregistry": "pipelineStateErrorRegistry" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L15 | neighbors=[PipelineStateError.ts]
- "pipeline_pipelinestateerror_pipelinestateerrorregistrykey": "pipelineStateErrorRegistryKey" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L12 | neighbors=[PipelineStateError.ts]
- "postcss_config": "postcss.config.mjs" | kind=code-symbol | source=postcss.config.mjs:L1 | neighbors=[config]
- "postcss_config_config": "config" | kind=code-symbol | source=postcss.config.mjs:L1 | neighbors=[postcss.config.mjs]
- "production_productionacceptancecommand_defaultdependencies": "defaultDependencies" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L87 | neighbors=[ProductionAcceptanceCommand.ts]
- "production_productionacceptancecommand_productionacceptancecommandresult": "ProductionAcceptanceCommandResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L82 | neighbors=[ProductionAcceptanceCommand.ts]
- "production_productionacceptancecommand_resumepublicerrorcodes": "resumePublicErrorCodes" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L247 | neighbors=[ProductionAcceptanceCommand.ts]
- "production_productionacceptanceconfigurationfingerprint_configuration_component_names": "CONFIGURATION_COMPONENT_NAMES" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L4 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceconfigurationfingerprint_configuration_component_names_v2": "CONFIGURATION_COMPONENT_NAMES_V2" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L41 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceconfigurationcomponent": "ProductionAcceptanceConfigurationComponent" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L47 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceconfigurationcomponentv2": "ProductionAcceptanceConfigurationComponentV2" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L50 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceconfigurationfingerprint_readbinary": "ReadBinary" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L74 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceconfigurationfingerprint_secretidentity": "secretIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L247 | neighbors=[ProductionAcceptanceConfigurationFinger…]
- "production_productionacceptanceexecutionscope_adapterfactorynames": "adapterFactoryNames" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L66 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_configuredprovider": "configuredProvider()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L334 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_createexplicitimmutableproviderauthority": "createExplicitImmutableProviderAuthority()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L79 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_productionacceptanceexecutionscopeversion": "productionAcceptanceExecutionScopeVersion" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L31 | neighbors=[ProductionAcceptanceExecutionScope.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-129.json

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
