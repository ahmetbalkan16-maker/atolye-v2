# Node Description Batch 11 of 166

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

- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@7eef83a3c890193407efec02635b4ff9b528c47e": "7eef83a feat: add runtime backup v3 authority and long-path support" | kind=Commit | source=git | neighbors=[RuntimeBackupAuthority.ts, RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, RuntimeBackupService.ts, RuntimeBackupVerifier.ts] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@aecde83beb525a7a4646cfa9280e12815a1fb18d": "aecde83 feat(runtime): add guarded filesystem foundation" | kind=Commit | source=git | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupService.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@e705042a746a384c2e2155fad1847836f33368b3": "e705042 feat: harden pipeline state error contracts" | kind=Commit | source=git | neighbors=[dd74765 feat: detect corrupted pipeline…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "pipeline_pipelinejobmutationlock_quarantineandremove": "quarantineAndRemove()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobMutationLock.ts:L623 | neighbors=[PipelineJobMutationLock.ts, assertDirectoryIdentity(), assertQuarantineContainer(), identityOf(), invokeCanonicalMutationBarrier(), invokeCanonicalMutationInvocation()] | lang=en
- "pipeline_pipelinestateerror": "PipelineStateError.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineStateError.ts:L1 | neighbors=[e705042 feat: harden pipeline state err…, PipelineJobManager.ts, PipelineRunner.ts, PipelineStateApiError.ts, getPipelineStateErrorCode(), getPipelineStateErrorRegistry()] | lang=en
- "production_productionexecutiondispatch": "ProductionExecutionDispatch.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionDispatch.ts:L1 | neighbors=[35b40d0 test(production): complete exec…, 8017502 feat(production): add queue dis…, ProductionDeterminism.ts, stableProductionId(), buildProductionExecutionDispatchEnvelop…, date()] | lang=en
- "production_productionreadinessservice_productionreadinessservice_evaluate": ".evaluate()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L106 | neighbors=[ProductionReadinessService, check(), createProbeWorkspace(), mediaChecksWithoutWorkspace(), missingProbeChecks(), normalizeChecks()] | lang=en
- "providers_audioproviderconfig": "AudioProviderConfig.ts" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L1 | neighbors=[4f09cf6 Sprint 114: Activate production…, 6286a7c feat(audio): complete truncatio…, ProductionReadinessService.ts, AudioIdentifierPolicy.ts, AudioIdentifierPolicyError, requireSafeAudioIdentifier()] | lang=en
- "providers_openaiprovider": "OpenAIProvider.ts" | kind=code-symbol | source=src/lib/ai/providers/OpenAIProvider.ts:L1 | neighbors=[0108d60 feat(ai): add mock-first provid…, 65d376b Sprint 129.19: Harden visual st…, 6c1ae5a Sprint 15 - Multi AI Provider A…, 99834f4 feat: complete Sprint 129.28 du…, index.ts, openai.ts] | lang=en
- "scripts_run_canonical_smoke_validation": "run-canonical-smoke-validation.ts" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, assertTerminalResult(), broad, codeUnitCompare(), dataProjectsGitState(), digest()] | lang=en
- "scripts_runtime_backup": "runtime-backup.ts" | kind=code-symbol | source=scripts/runtime-backup.ts:L1 | neighbors=[7eef83a feat: add runtime backup v3 aut…, b813acc feat(runtime): add verified run…, RuntimeBackupAuthority.ts, bootstrapRuntimeBackupStorageAuthority(), RuntimeBackupInventory.ts, collectRuntimeBackupInventory()] | lang=en
- "thumbnails_route": "route.ts" | kind=code-symbol | source=app/api/thumbnails/route.ts:L1 | neighbors=[2a03d89 Sprint 117: Activate production…, 4cde4cd feat(thumbnail): add thumbnail …, ProjectManager.ts, ProjectManager, ThumbnailEngine.ts, ThumbnailEngine] | lang=en
- "types_productionexecutionconfirmation_productionexecutionconfirmationvalidationresult": "ProductionExecutionConfirmationValidationResult" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L51 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionConfirmation.ts, ProductionExecutionPersistence.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryAdmissionBinding…, smoke-production-execution-coordinator.…] | lang=en
- "types_videoassembly": "videoAssembly.ts" | kind=code-symbol | source=src/types/videoAssembly.ts:L1 | neighbors=[VideoAssemblyManager.ts, 3480988 Sprint 115: Activate production…, 6e53895 Sprint 118: Consume scene video…, f21fc24 Sprint 128: Harden production a…, FFmpegVideoAssemblyProvider.ts, VideoAssemblyProvider.ts] | lang=en
- "ai_airesponseerror_airesponseerror": "AIResponseError" | kind=code-symbol | source=src/lib/ai/AIResponseError.ts:L16 | neighbors=[AIManager.ts, AIResponseError.ts, .constructor(), ResearchStructuredOutput.ts, SceneStructuredOutput.ts, ScriptStructuredOutput.ts] | lang=en
- "assembly_videoassemblymanager_videoassemblyerror": "VideoAssemblyError" | kind=code-symbol | source=src/lib/assembly/VideoAssemblyManager.ts:L37 | neighbors=[VideoAssemblyManager.ts, buildAudioSegments(), getProviderName(), requireAudioAsset(), requireIds(), requireImageAsset()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@018d91eb0a73f073fe1543c9fad9ce2dc3a68652": "018d91e feat(visuals): add Wikimedia Commons real photo source (Sprint 130)" | kind=Commit | source=git | neighbors=[VisualStructuredOutput.ts, VisualAssetPipeline.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 2d9074c fix(visuals): real photo source…] | lang=en
- "migration_runtimemigrationcandidatemanifest_validatemanifest": "validateManifest()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L241 | neighbors=[RuntimeMigrationCandidateManifest.ts, bindingsFor(), containsHostPath(), durableBinding(), exact(), invalid()] | lang=en
- "pipeline_pipelineerrorevidence": "PipelineErrorEvidence.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineErrorEvidence.ts:L1 | neighbors=[6094cd8 Sprint 129.21: Harden productio…, 6286a7c feat(audio): complete truncatio…, AIResponseError.ts, getAIResponseSchemaEvidence(), isAIResponseSchemaEvidence(), AnimationMotionPlanError.ts] | lang=en
- "production_productionacceptancepolicy_productionacceptancepolicyerror": "ProductionAcceptancePolicyError" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L177 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarker(), createProductionAcceptanceMarkerV3(), createProductionAcceptanceMarkerV3Profi…, diagnoseProductionAcceptanceConfigurati…, markProductionAcceptanceValidated()] | lang=en
- "production_productiondurableattemptlineageclassifier_classifyproductiondurableattemptlineage": "classifyProductionDurableAttemptLineage()" | kind=code-symbol | source=src/lib/production/ProductionDurableAttemptLineageClassifier.ts:L38 | neighbors=[PipelineJobManager.ts, ProductionDurableAttemptLineageClassifi…, attemptBindingBoundary(), buildLineagePlans(), claimBindingBoundary(), durableLineageRunType()] | lang=en
- "production_productionexecutionlifecycle": "ProductionExecutionLifecycle.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionLifecycle.ts:L1 | neighbors=[0c8dfb2 feat(production): add durable w…, 32f5ab9 feat(production): add durable a…, ProductionExecutionDurableAttempt.ts, AdapterBackedProductionExecutionAttempt…, mapReason(), ProductionExecutionLifecycle] | lang=en
- "production_productionpipelineretryreconciliation_reconcilefailedpipelineexecution": "reconcileFailedPipelineExecution()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryReconciliation.ts:L54 | neighbors=[PipelineFailedStageRetry.ts, ProductionPipelineRetryBudgetExtensionT…, ProductionPipelineRetryReconciliation.ts, failure(), mapSettlementFailure(), runTypeFromOperation()] | lang=en
- "production_productionreadinessservice_productionreadinessservice": "ProductionReadinessService" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L87 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, .apiKeyCheck(), .constructor(), .environmentCheck(), .evaluate()] | lang=en
- "providers_videoassemblyproviderrouter": "VideoAssemblyProviderRouter.ts" | kind=code-symbol | source=src/lib/assembly/providers/VideoAssemblyProviderRouter.ts:L1 | neighbors=[VideoAssemblyManager.ts, 3480988 Sprint 115: Activate production…, PipelineStageExecutor.ts, ProductionAcceptanceOrchestrator.ts, ProductionReadinessService.ts, FFmpegVideoAssemblyProvider.ts] | lang=en
- "publish_youtubepublishproviderrouter": "YouTubePublishProviderRouter.ts" | kind=code-symbol | source=src/lib/youtube/publish/YouTubePublishProviderRouter.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, PipelineStageExecutor.ts, YouTubePublishPipeline.ts, MockYouTubePublishProvider.ts, MockYouTubePublishProvider] | lang=en
- "runtime_productionruntimeoperationcontext_productionruntimeoperationcontexterror": "ProductionRuntimeOperationContextError" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L19 | neighbors=[PipelineRunner.ts, PipelineRunnerCanonicalRuntime.ts, ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionConfiguratio…, ProductionWorkerLifecycle.ts, ProductionRuntimeOperationContext.ts] | lang=en
- "scripts_smoke_production_execution_authorization": "smoke-production-execution-authorization.ts" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L1 | neighbors=[d9ebd32 feat(production): add execution…, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, ProductionExecutionAuthorization.ts, defaultProductionExecutionAuthorization…, evaluateProductionExecutionAuthorizatio…] | lang=en
- "scripts_smoke_production_health_findings": "smoke-production-health-findings.ts" | kind=code-symbol | source=scripts/smoke-production-health-findings.ts:L1 | neighbors=[aba67da feat(production): add health fi…, ProductionHealthApiClient.ts, ProductionHealthApiConsumerError, ProductionHealthService.ts, ProductionHealthReport, ProductionHealthService] | lang=en
- "scripts_smoke_sprint_129_31_openai_streaming_wav": "smoke-sprint-129-31-openai-streaming-wav.ts" | kind=code-symbol | source=scripts/smoke-sprint-129-31-openai-streaming-wav.ts:L1 | neighbors=[09ab1e9 fix(audio): support OpenAI stre…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), SmokeResult.ts, emitSmokeResult(), OpenAIAudioProvider.ts] | lang=en
- "storage_filestorage": "FileStorage.ts" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L1 | neighbors=[AssetManager.ts, 507becc Sprint 129.25B: Runtime root ab…, 5883c6d Sprint 120: Activate production…, 91ba270 Atölye V2 checkpoint - pipeline…, ProductionReadinessService.ts, smoke-sprint-129-25b-1-runtime-hardenin…] | lang=en
- "types_pipelinejob_pipelinejobhistory": "PipelineJobHistory" | kind=code-symbol | source=src/types/pipelineJob.ts:L62 | neighbors=[PipelineJobManager.ts, ProductionQueuedExhaustedDriftClassifie…, ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts, smoke-pipeline-history-persistence.ts, smoke-pipeline-state-corruption.ts] | lang=en
- "types_productionexecutiondurableattempt_productionexecutiondurableattemptrecord": "ProductionExecutionDurableAttemptRecord" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L9 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, ProductionCanonicalDurableLineage.ts, ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…, ProductionExecutionRecoveryBootstrap.ts] | lang=en
- "types_productionruntimeinitialization": "productionRuntimeInitialization.ts" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L1 | neighbors=[af745ac Sprint 109: Process Startup Boo…, e3b5c6c Sprint 110: Add production work…, ProductionRuntimeInitializer.ts, ProductionRuntimeCompositionRoot.ts, smoke-production-worker-lifecycle.ts, smoke-sprint-129-25c-2b-4-runtime-conte…] | lang=en
- "ai_aiusagemanager_aiusagemanager": "AIUsageManager" | kind=code-symbol | source=src/lib/ai/AIUsageManager.ts:L9 | neighbors=[AIUsageManager.ts, .appendRecord(), .getUsageLog(), .isProductionStep(), .isUsageLog(), .mapRecordToPackageUsage()] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@573e9e665c475faad4b039f81b18b5ceb3269cb9": "573e9e6 feat(audio): add mock audio engine foundation" | kind=Commit | source=git | neighbors=[AudioPipeline.ts, AudioService.ts, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5a31d1f503b35e5d6b4bc6436ff9726366fb271f": "5a31d1f Sprint 129.22: Harden animation structured output contract" | kind=Commit | source=git | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanError.ts, AnimationStructuredOutput.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@bec4962d5cb2f0f45351d8a546e6d40c973f8858": "bec4962 Sprint 113: Activate production visual asset pipeline" | kind=Commit | source=git | neighbors=[VisualAssetPipeline.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c4d459acfd0f03155190736a44e5de424b14cab9": "c4d459a feat(assembly): add final production package foundation" | kind=Commit | source=git | neighbors=[573e9e6 feat(audio): add mock audio eng…, AssemblyManager.ts, route.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep] | lang=pt
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c5e9d339b2342a2c3c1923e2df7399c98a4aecf6": "c5e9d33 feat(production): add durable claim and attempt coordination" | kind=Commit | source=git | neighbors=[80adfc8 feat(production): add durable e…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1] | lang=en

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-010.json

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
