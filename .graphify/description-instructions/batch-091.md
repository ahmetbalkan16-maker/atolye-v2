# Node Description Batch 92 of 166

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

- "pipeline_pipelinerunner_retryexecutionreasoncode": "retryExecutionReasonCode()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1158 | neighbors=[PipelineRunner.ts, .executeJobRetryOnce()]
- "pipeline_pipelinerunner_validresumeboundary": "validResumeBoundary()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunner.ts:L1079 | neighbors=[PipelineRunner.ts, .resumeOnce()]
- "pipeline_pipelinerunnercanonicalruntime_pipelinerunnerproductionruntimesnapshot": "PipelineRunnerProductionRuntimeSnapshot" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L23 | neighbors=[PipelineRunnerCanonicalRuntime.ts, ProductionPipelineExecutionConfiguratio…]
- "pipeline_pipelinerunnercanonicalruntime_snapshotpipelinerunnerproductionruntime": "snapshotPipelineRunnerProductionRuntime()" | kind=code-symbol | source=src/lib/pipeline/PipelineRunnerCanonicalRuntime.ts:L27 | neighbors=[PipelineRunnerCanonicalRuntime.ts, ProductionPipelineExecutionConfiguratio…]
- "pipeline_pipelinestageexecutor_pipelinestageexecutor_persiststageresult": ".persistStageResult()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L602 | neighbors=[PipelineStageExecutor, .execute()]
- "pipeline_pipelinestageexecutor_requirestageinput": "requireStageInput()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L618 | neighbors=[PipelineStageExecutor.ts, .execute()]
- "pipeline_pipelinestageexecutor_requirestoragecontext": "requireStorageContext()" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L611 | neighbors=[PipelineStageExecutor.ts, .execute()]
- "pipeline_pipelinestateerror_getpipelinestatefilename": "getPipelineStateFileName()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L90 | neighbors=[PipelineStateError.ts, isPipelineStateError()]
- "pipeline_pipelinestateerror_ispipelinestatefailure": "isPipelineStateFailure()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L98 | neighbors=[PipelineStateError.ts, isPipelineStateError()]
- "pipeline_pipelinestateerror_ispipelinestatekind": "isPipelineStateKind()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L94 | neighbors=[PipelineStateError.ts, isPipelineStateError()]
- "pipeline_pipelinestateerror_pipelinestateerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L20 | neighbors=[PipelineStateError, getPipelineStateErrorCode()]
- "pipeline_pipelinestateerror_pipelinestatefailure": "PipelineStateFailure" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L2 | neighbors=[PipelineStateError.ts, smoke-pipeline-state-corruption.ts]
- "pipeline_pipelinestateerror_pipelinestatekind": "PipelineStateKind" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L1 | neighbors=[PipelineJobManager.ts, PipelineStateError.ts]
- "pipeline_route_post": "POST()" | kind=code-symbol | source=app/api/pipeline/route.ts:L5 | neighbors=[route.ts, smoke-pipeline-state-error-contract.ts]
- "production_productionacceptancecommand_ispipelinerecoverystagekey": "isPipelineRecoveryStageKey()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L473 | neighbors=[ProductionAcceptanceCommand.ts, parseResumeArguments()]
- "production_productionacceptancecommand_parsediagnosearguments": "parseDiagnoseArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L395 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parseexecutearguments": "parseExecuteArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L411 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_parserepreparearguments": "parseReprepareArguments()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L375 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_safeprojectslug": "safeProjectSlug()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L286 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_success": "success()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L290 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptancecommand_trustedcommanderrorcode": "trustedCommandErrorCode()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceCommand.ts:L257 | neighbors=[ProductionAcceptanceCommand.ts, runProductionAcceptanceCommand()]
- "production_productionacceptanceconfigurationfingerprint_componentfingerprint": "componentFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L238 | neighbors=[ProductionAcceptanceConfigurationFinger…, createProductionAcceptancePortableConfi…]
- "production_productionacceptanceconfigurationfingerprint_findproductionacceptanceconfigurationmismatches": "findProductionAcceptanceConfigurationMismatches()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L206 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceconfigurationfingerprint_findproductionacceptanceconfigurationmismatchesv2": "findProductionAcceptanceConfigurationMismatchesV2()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L215 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceconfigurationfingerprint_productionacceptancecomponentfingerprints": "ProductionAcceptanceComponentFingerprints" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L53 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceportableconfigurationfingerprint": "productionAcceptancePortableConfigurationFingerprint()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L186 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceconfigurationfingerprint_productionacceptanceportableconfigurationsnapshot": "ProductionAcceptancePortableConfigurationSnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L61 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceconfigurationfingerprint_validcomponentfingerprintrecord": "validComponentFingerprintRecord()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L224 | neighbors=[ProductionAcceptanceConfigurationFinger…, validProductionAcceptanceComponentFinge…]
- "production_productionacceptanceconfigurationfingerprint_validproductionacceptancecomponentfingerprints": "validProductionAcceptanceComponentFingerprints()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceConfigurationFingerprint.ts:L167 | neighbors=[ProductionAcceptanceConfigurationFinger…, ProductionAcceptancePolicy.ts]
- "production_productionacceptanceexecutionscope_normalizeimmutableproviderdispatchadapter": "normalizeImmutableProviderDispatchAdapter()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L242 | neighbors=[ProductionAcceptanceExecutionScope.ts, createExplicitProviderDispatchAdapter()]
- "production_productionacceptanceexecutionscope_productionacceptanceprovidercapabilitiesforstage": "productionAcceptanceProviderCapabilitiesForStage()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L300 | neighbors=[ProductionAcceptanceExecutionScope.ts, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptanceexecutionscope_productionacceptanceprovideroptions": "ProductionAcceptanceProviderOptions" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L6 | neighbors=[ProductionAcceptanceExecutionScope.ts, ProductionAcceptancePolicy.ts]
- "production_productionacceptancelegacyadmissioncontext_getproductionacceptanceretryadmission": "getProductionAcceptanceRetryAdmission()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L59 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…, ProductionPipelineExecutionFactory.ts]
- "production_productionacceptancelegacyauthoritystore_validboundfile": "validBoundFile()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L361 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, validateLegacyPublicationReceipt()]
- "production_productionacceptancelegacydurablerecoverysnapshot_assertsemanticstorestates": "assertSemanticStoreStates()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L309 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, createLegacyReauthorizationDurableRecov…]
- "production_productionacceptancelegacydurablerecoverysnapshot_claimmatchesattempt": "claimMatchesAttempt()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L461 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings()]
- "production_productionacceptancelegacydurablerecoverysnapshot_excludingcurrentexecution": "excludingCurrentExecution()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L253 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, createLegacyReauthorizationDurableRecov…]
- "production_productionacceptancelegacydurablerecoverysnapshot_latestexact": "latestExact()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L282 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, createLegacyReauthorizationDurableRecov…]
- "production_productionacceptancelegacydurablerecoverysnapshot_latestvalues": "latestValues()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L420 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings()]
- "production_productionacceptancelegacydurablerecoverysnapshot_reservationmatchesattempt": "reservationMatchesAttempt()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L451 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-091.json

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
