# Node Description Batch 32 of 166

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

- "production_productionexecutiondurableattempt_plan": "plan()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L23 | neighbors=[ProductionExecutionDurableAttempt.ts, .abandonExecutionAttempt(), .appendAttemptJournal(), .finalizeExecutionOutcome(), .preflight(), .proposeExecutionOutcome()]
- "production_productionexecutiondurableattempt_safeentry": "safeEntry()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableAttempt.ts:L22 | neighbors=[ProductionExecutionDurableAttempt.ts, .appendAttemptJournal(), .transitionExecutionLifecycle(), date(), safe(), safeEvidence()]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice_evaluateexecutionclaimrecovery": ".evaluateExecutionClaimRecovery()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L36 | neighbors=[AdapterBackedProductionExecutionClaimSe…, .latestClaim(), assessment(), date(), mapStorage(), safe()]
- "production_productionexecutiondurablelease_safe": "safe()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableLease.ts:L106 | neighbors=[ProductionExecutionDurableLease.ts, .evaluate(), .load(), validateMutation(), validLease(), validSession()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_createrecord": ".createRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L16 | neighbors=[AdapterBackedProductionExecutionDurable…, .read(), .validateRecord(), key(), mapped(), out()]
- "production_productionexecutiondurablestorage_adapterbackedproductionexecutiondurablestorage_transition": ".transition()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L19 | neighbors=[AdapterBackedProductionExecutionDurable…, .releaseReservation(), .read(), apply(), key(), mapped()]
- "production_productionexecutiondurablestorage_mapped": "mapped()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L31 | neighbors=[ProductionExecutionDurableStorage.ts, .createRecord(), .createReservation(), .find(), .read(), .transition()]
- "production_productionexecutiondurablestorage_validateproductionexecutiondurablerecord": "validateProductionExecutionDurableRecord()" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableStorage.ts:L12 | neighbors=[ProductionCanonicalDurableLineage.ts, ProductionExecutionDurableStorage.ts, .validateRecord(), date(), out(), safe()]
- "production_productionexecutiongateway_productionexecutiongateway": "ProductionExecutionGateway" | kind=code-symbol | source=src/lib/production/ProductionExecutionGateway.ts:L7 | neighbors=[ProductionExecutionGateway.ts, .dryRun(), .execute(), smoke-production-execution-gateway.ts, smoke-production-execution-job.ts, smoke-production-intelligence-phase-rev…]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_inspectindex": ".inspectIndex()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L291 | neighbors=[ProductionExecutionDurableRecoveryServi…, artifactIdentity(), errorCode(), indexFile(), .readIndex(), recoveryFinding()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_readindex": ".readIndex()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L316 | neighbors=[ProductionExecutionDurableRecoveryServi…, .inspectIndex(), .lookup(), digest(), errorCode(), indexShape()]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_readrecoveryartifact": ".readRecoveryArtifact()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L302 | neighbors=[ProductionExecutionDurableRecoveryServi…, .apply(), .collectCanonicalRecords(), errorCode(), isRecord(), validatePayload()]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_readcanonical": ".readCanonical()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L130 | neighbors=[ProductionExecutionFilePersistenceAdapt…, .read(), canonicalJson(), diagnostic(), errorCode(), validatePayload()]
- "production_productionexecutionpersistence_transactionshape": "transactionShape()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L377 | neighbors=[ProductionExecutionPersistence.ts, arrays(), integer(), integrity(), isRecord(), strings()]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrap": "ProductionExecutionRecoveryBootstrap" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L81 | neighbors=[ProductionExecutionRecoveryBootstrap.ts, .bootstrapRecovery(), .constructor(), ProductionRuntimeInitializer.ts, ProductionRuntimeCompositionRoot.ts, smoke-production-recovery-bootstrap.ts]
- "production_productionhealthservice_productionhealthreport": "ProductionHealthReport" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L16 | neighbors=[ProductionHealthApiClient.ts, ProductionHealthService.ts, smoke-production-health-api-consumer.ts, smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-ui.ts]
- "production_productionintelligenceconsumer_isenum": "isEnum()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L148 | neighbors=[ProductionIntelligenceConsumer.ts, parseAction(), parseExecutionPreview(), parseJobPreview(), parseNode(), parsePlan()]
- "production_productionintelligenceconsumer_isstage": "isStage()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L147 | neighbors=[ProductionIntelligenceConsumer.ts, parseAction(), parseEdge(), parseJobPreview(), parseNode(), parseStage()]
- "production_productionintelligenceconsumer_parseexecutionpreview": "parseExecutionPreview()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L114 | neighbors=[ProductionIntelligenceConsumer.ts, isEnum(), isOptionalString(), isRecord(), isString(), parseOperation()]
- "production_productionpipelineexecutionadapter_productionpipelineexecutioncontext": "ProductionPipelineExecutionContext" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L11 | neighbors=[ProductionLegacyPipelineExecutionIdenti…, ProductionPipelineExecutionAdapter.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionIdentity.ts, ProductionPipelineExecutionSemantics.ts]
- "production_productionpipelineexecutioninstrumentation_runwithproductionpipelineexecutioninstrumentation": "runWithProductionPipelineExecutionInstrumentation()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L57 | neighbors=[ProductionPipelineExecutionInstrumentat…, smoke-production-video-assembly-wiring.…, smoke-production-visual-asset-wiring.ts, smoke-sprint-129-28-production-acceptan…, smoke-sprint-129-38-cross-stage-settled…, smoke-sprint-129-39-stage-bounded-resum…]
- "production_productionpipelineexecutionsemantics": "ProductionPipelineExecutionSemantics.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionSemantics.ts:L1 | neighbors=[8f7a37b fix(production): close sprint 1…, ProductionPipelineExecutionFactory.ts, ProductionPipelineExecutionAdapter.ts, ProductionPipelineExecutionContext, productionPipelineExecutionAuthorizatio…, ProductionPipelineRetryAdmissionBinding…]
- "production_productionpipelineretrybudgetextensionstore_writeretrybudgetextensionreceipt": "writeRetryBudgetExtensionReceipt()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionStore.ts:L200 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, assertCanonicalProjectContainment(), ensureExtensionDirectory(), ProductionPipelineRetryBudgetExtensionT…, ProductionPipelineTerminalSettlement.ts, smoke-sprint-129-36-retry-budget-extens…]
- "production_productionpipelineterminalsettlement_settlefailedproductionpipelineexecution": "settleFailedProductionPipelineExecution()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L245 | neighbors=[ProductionPipelineExecutionCanonicalRun…, ProductionPipelineRetryReconciliation.ts, ProductionPipelineTerminalSettlement.ts, withFailedSettlementLock(), smoke-sprint-129-29-failed-terminal-set…, smoke-sprint-129-38-cross-stage-settled…]
- "production_productionpipelineterminalsettlement_settlependingsuccessfulproductionpipelineexecutions": "settlePendingSuccessfulProductionPipelineExecutions()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L113 | neighbors=[ProductionPipelineExecutionCanonicalRun…, ProductionPipelineTerminalSettlement.ts, allowed(), denied(), latestArtifacts(), settleSuccessfulProductionPipelineExecu…]
- "production_productionprojectslug_isvalidproductionprojectslug": "isValidProductionProjectSlug()" | kind=code-symbol | source=src/lib/production/ProductionProjectSlug.ts:L1 | neighbors=[ProductionExecutionAuthorization.ts, ProductionExecutionConfirmation.ts, ProductionExecutionContract.ts, ProductionExecutionTransaction.ts, ProductionHealthApiClient.ts, ProductionHealthService.ts]
- "production_productionregenerationphysicalguard_assertphysicaltarget": "assertPhysicalTarget()" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L54 | neighbors=[ProductionRegenerationPhysicalGuard.ts, exactDirectory(), isContained(), nearestExisting(), samePath(), assertProductionRegenerationPhysicalPro…]
- "production_productionsnapshotparts_buildusage": "buildUsage()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L75 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, createDistribution(), known(), minimumCoverage(), sortNewest()]
- "production_productionworkerlifecycle_productionworkerlifecycle_fail": ".fail()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L107 | neighbors=[ProductionWorkerLifecycle, .snapshot(), .transitionTo(), result(), safeProjectSlug(), safeReason()]
- "production_productionworkerlifecycle_productionworkerlifecycle_startonce": ".startOnce()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L205 | neighbors=[ProductionWorkerLifecycle, .start(), .fail(), .snapshot(), .transitionTo(), result()]
- "production_productionworkerlifecycle_productionworkerlifecycle_transitionto": ".transitionTo()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L239 | neighbors=[ProductionWorkerLifecycle, .beginInitialization(), .drainOnce(), .fail(), .startOnce(), .stopOnce()]
- "projects_projectmanager_projectmanager_readgenerationawarepackage": ".readGenerationAwarePackage()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L540 | neighbors=[ProjectManager, .getAssembly(), .getExport(), .getSEO(), .getThumbnail(), .getVideo()]
- "prompts_seoprompt": "seoPrompt.ts" | kind=code-symbol | source=src/lib/seo/prompts/seoPrompt.ts:L1 | neighbors=[a4839b8 feat(seo): add youtube seo engi…, createSEOPrompt(), script.ts, ScriptData, thumbnail.ts, ThumbnailData]
- "prompts_thumbnailprompt": "thumbnailPrompt.ts" | kind=code-symbol | source=src/lib/thumbnail/prompts/thumbnailPrompt.ts:L1 | neighbors=[56fd9c7 feat(thumbnail): add thumbnail …, createThumbnailPrompt(), script.ts, ScriptData, visual.ts, VisualData]
- "providers_animationprovider_animationgenerationinput": "AnimationGenerationInput" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L13 | neighbors=[AnimationProvider.ts, MockAnimationProvider.ts, OpenAIAnimationProvider.ts, smoke-animation-motion-plan-contract.ts, smoke-production-animation-provider.ts, smoke-sprint-129-21-animation-failure-d…]
- "providers_animationproviderconfig_getopenaianimationproviderconfig": "getOpenAIAnimationProviderConfig()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L35 | neighbors=[ProductionReadinessService.ts, AnimationProviderConfig.ts, AnimationProviderConfigurationError, integer(), validOpenAIEndpoint(), OpenAIAnimationProvider.ts]
- "providers_animationproviderrouter_animationproviderrouter": "AnimationProviderRouter" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderRouter.ts:L6 | neighbors=[AnimationAssetPipeline.ts, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, AnimationProviderRouter.ts, .getProvider()]
- "providers_audioprovider_audioprovider": "AudioProvider" | kind=code-symbol | source=src/lib/audio/providers/AudioProvider.ts:L16 | neighbors=[AudioPipeline.ts, PipelineStageExecutor.ts, AudioProvider.ts, AudioProviderRouter.ts, smoke-production-audio-asset-wiring.ts, smoke-production-end-to-end.ts]
- "providers_audioproviderconfig_audioproviderconfigurationerror": "AudioProviderConfigurationError" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L11 | neighbors=[AudioProviderConfig.ts, .constructor(), resolveAudioProviderName(), resolveIntegerConfigValue(), resolveSafeConfigValue(), OpenAIAudioProvider.ts]
- "providers_audioproviderconfig_getopenaiaudioproviderconfig": "getOpenAIAudioProviderConfig()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L56 | neighbors=[ProductionReadinessService.ts, AudioProviderConfig.ts, resolveIntegerConfigValue(), resolveSafeConfigValue(), OpenAIAudioProvider.ts, smoke-production-audio-asset-wiring.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-031.json

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
