# Node Description Batch 62 of 166

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

- "studio_pipelinejobspanel_ispipelinejob": "isPipelineJob()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1158 | neighbors=[PipelineJobsPanel.tsx, isPipelineJobStatus(), isSafeJobId(), JobRow()]
- "studio_pipelinejobspanel_sorthistoryevents": "sortHistoryEvents()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L740 | neighbors=[PipelineJobsPanel.tsx, createHistoryInsights(), getRecentHistoryAttention(), PipelineJobsPanel()]
- "studio_productionhealthpanel_healthsummary": "HealthSummary()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L147 | neighbors=[ProductionHealthPanel.tsx, formatDateTime(), getSeverityClassName(), getStatusClassName()]
- "studio_productionhealthpanel_loadproductionhealthuistate": "loadProductionHealthUiState()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L78 | neighbors=[smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-ui.ts, ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_productionhealthuistate": "ProductionHealthUiState" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L17 | neighbors=[smoke-production-health-evidence.ts, smoke-production-health-findings.ts, smoke-production-health-ui.ts, ProductionHealthPanel.tsx]
- "studio_projectprogress": "ProjectProgress.tsx" | kind=code-symbol | source=src/components/studio/ProjectProgress.tsx:L1 | neighbors=[a6de923 feat(studio): add production da…, index.ts, ProjectProgress(), ProjectProgressProps]
- "thumbnail_thumbnailassetpipeline_preparethumbnailattempt": "prepareThumbnailAttempt()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L181 | neighbors=[ThumbnailAssetPipeline.ts, createNonCanonicalThumbnail(), demoteGeneratedThumbnailAssets(), .generateThumbnail()]
- "thumbnail_thumbnailassetpipeline_validateproviderresult": "validateProviderResult()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L368 | neighbors=[ThumbnailAssetPipeline.ts, .generateThumbnail(), ThumbnailAssetGenerationError, validDate()]
- "thumbnail_thumbnailmanager_thumbnailmanager_generatethumbnaildata": ".generateThumbnailData()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L20 | neighbors=[ThumbnailManager, .createFallbackThumbnailData(), .mapGeneration(), .mapVariants()]
- "thumbnail_thumbnailproviderconfig_thumbnailproviderconfigurationerror": "ThumbnailProviderConfigurationError" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailProviderConfig.ts:L28 | neighbors=[smoke-production-thumbnail-pipeline.ts, ThumbnailProviderConfig.ts, resolveThumbnailProviderName(), .constructor()]
- "thumbnail_thumbnailstorage_thumbnailstorage_getthumbnailurl": ".getThumbnailUrl()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L135 | neighbors=[ThumbnailStorage, requireSafeFileName(), requireSafeSegment(), .saveThumbnail()]
- "types_animation_animationmotiontype": "AnimationMotionType" | kind=code-symbol | source=src/types/animation.ts:L17 | neighbors=[AnimationStructuredOutput.ts, AnimationProvider.ts, smoke-production-scene-video-rendering.…, animation.ts]
- "types_animationerror_animationmotionplanerrorevidence": "AnimationMotionPlanErrorEvidence" | kind=code-symbol | source=src/types/animationError.ts:L87 | neighbors=[AnimationMotionPlanError.ts, animationError.ts, AnimationProviderDiagnosticMetadata, errorEvidence.ts]
- "types_animationerror_animationschemaissue": "AnimationSchemaIssue" | kind=code-symbol | source=src/types/animationError.ts:L62 | neighbors=[AnimationMotionPlanError.ts, AnimationStructuredOutput.ts, aiUsage.ts, animationError.ts]
- "types_assembly_assemblyscene": "AssemblyScene" | kind=code-symbol | source=src/types/assembly.ts:L6 | neighbors=[AssemblyManager.ts, MockThumbnailProvider.ts, MockYouTubeProvider.ts, assembly.ts]
- "types_asset_imageprovidername": "ImageProviderName" | kind=code-symbol | source=src/types/asset.ts:L100 | neighbors=[VisualAssetPipeline.ts, ImageProvider.ts, ImageProviderConfig.ts, asset.ts]
- "types_audio_audiogenerationtarget": "AudioGenerationTarget" | kind=code-symbol | source=src/types/audio.ts:L11 | neighbors=[AudioAssetError.ts, AudioPipeline.ts, AudioProvider.ts, audio.ts]
- "types_audio_audioprovidername": "AudioProviderName" | kind=code-symbol | source=src/types/audio.ts:L7 | neighbors=[AudioPipeline.ts, AudioProvider.ts, AudioProviderConfig.ts, audio.ts]
- "types_audioerror_audioasseterrorevidence": "AudioAssetErrorEvidence" | kind=code-symbol | source=src/types/audioError.ts:L28 | neighbors=[AudioAssetError.ts, AudioPipeline.ts, audioError.ts, errorEvidence.ts]
- "types_audioerror_audioassetrooterrorcodes": "audioAssetRootErrorCodes" | kind=code-symbol | source=src/types/audioError.ts:L1 | neighbors=[AudioAssetError.ts, ProductionExecutionDurableAttempt.ts, smoke-sprint-129-27-audio-remediation.ts, audioError.ts]
- "types_export_exportformat": "ExportFormat" | kind=code-symbol | source=src/types/export.ts:L10 | neighbors=[route.ts, ExportProvider.ts, MockExportProvider.ts, export.ts]
- "types_export_exportprovidername": "ExportProviderName" | kind=code-symbol | source=src/types/export.ts:L7 | neighbors=[ExportProviderConfig.ts, ExportProviderRouter.ts, ExportProvider.ts, export.ts]
- "types_pipelinejob_pipelinejobaction": "PipelineJobAction" | kind=code-symbol | source=src/types/pipelineJob.ts:L11 | neighbors=[route.ts, PipelineJobManager.ts, PipelineJobsPanel.tsx, pipelineJob.ts]
- "types_pipelinerecovery_pipelinerecoveryplan": "PipelineRecoveryPlan" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L16 | neighbors=[PipelineRecoveryPlanner.ts, ProductionExecutionRecoveryBootstrap.ts, smoke-retry-persistence.ts, pipelineRecovery.ts]
- "types_pipelinerecovery_pipelineresumeoptions": "PipelineResumeOptions" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L39 | neighbors=[PipelineRunner.ts, ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts, pipelineRecovery.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationpolicy": "ProductionExecutionAuthorizationPolicy" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L67 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-execution-authorizatio…, smoke-production-execution-confirmation…, productionExecutionAuthorization.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationrequest": "ProductionExecutionAuthorizationRequest" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L51 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-execution-authorizatio…, smoke-production-execution-confirmation…, productionExecutionAuthorization.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationbinding": "ProductionExecutionConfirmationBinding" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L18 | neighbors=[ProductionExecutionConfirmation.ts, productionExecutionConfirmation.ts, ProductionExecutionConfirmationGrant, ProductionExecutionConfirmationRequest]
- "types_productionexecutionconfirmation_productionexecutionconfirmationgrant": "ProductionExecutionConfirmationGrant" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L29 | neighbors=[ProductionExecutionConfirmation.ts, smoke-production-execution-confirmation…, productionExecutionConfirmation.ts, ProductionExecutionConfirmationBinding]
- "types_productionexecutionconfirmation_productionexecutionconfirmationrequest": "ProductionExecutionConfirmationRequest" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L24 | neighbors=[ProductionExecutionConfirmation.ts, smoke-production-execution-confirmation…, productionExecutionConfirmation.ts, ProductionExecutionConfirmationBinding]
- "types_productionexecutiondurableattempt_productionexecutionattemptpolicy": "ProductionExecutionAttemptPolicy" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L11 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionCoordinator.ts, productionExecutionDurableAttempt.ts, productionExecutionLifecycle.ts]
- "types_productionexecutiondurableattempt_productionexecutionoutcomeproposalrequest": "ProductionExecutionOutcomeProposalRequest" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L10 | neighbors=[ProductionExecutionDurableAttempt.ts, smoke-production-execution-durable-atte…, productionExecutionDurableAttempt.ts, ProductionExecutionOutcomeFinalizationR…]
- "types_productionexecutiondurableclaim_productionexecutionclaimrequest": "ProductionExecutionClaimRequest" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L19 | neighbors=[ProductionExecutionDurableClaim.ts, smoke-production-execution-durable-clai…, productionExecutionCoordinator.ts, productionExecutionDurableClaim.ts]
- "types_productionexecutiondurablelease_productionexecutionleaseacquisitionrequest": "ProductionExecutionLeaseAcquisitionRequest" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L27 | neighbors=[ProductionExecutionDurableLease.ts, smoke-production-execution-durable-leas…, productionExecutionDurableLease.ts, LeaseMutationBase]
- "types_productionexecutiondurablelease_productionexecutionleaseheartbeatrequest": "ProductionExecutionLeaseHeartbeatRequest" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L28 | neighbors=[ProductionExecutionDurableLease.ts, smoke-production-execution-durable-leas…, productionExecutionDurableLease.ts, LeaseMutationBase]
- "types_productionexecutiondurablelease_productionexecutionleasereleaserequest": "ProductionExecutionLeaseReleaseRequest" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L29 | neighbors=[ProductionExecutionDurableLease.ts, smoke-production-execution-durable-leas…, productionExecutionDurableLease.ts, LeaseMutationBase]
- "types_productionexecutiondurablelease_productionexecutionleasetakeoverrequest": "ProductionExecutionLeaseTakeoverRequest" | kind=code-symbol | source=src/types/productionExecutionDurableLease.ts:L30 | neighbors=[ProductionExecutionDurableLease.ts, smoke-production-execution-durable-leas…, productionExecutionDurableLease.ts, LeaseMutationBase]
- "types_productionexecutionidempotency_productionexecutionidempotencyevaluationcontext": "ProductionExecutionIdempotencyEvaluationContext" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L74 | neighbors=[ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts, productionExecutionDurableStorage.ts, productionExecutionIdempotency.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencylease": "ProductionExecutionIdempotencyLease" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L30 | neighbors=[smoke-production-execution-durable-stor…, smoke-production-execution-idempotency.…, productionExecutionIdempotency.ts, productionExecutionWorker.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencystate": "ProductionExecutionIdempotencyState" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L6 | neighbors=[ProductionExecutionIdempotency.ts, ProductionPipelineTerminalSettlement.ts, productionExecutionDurableStorage.ts, productionExecutionIdempotency.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-061.json

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
