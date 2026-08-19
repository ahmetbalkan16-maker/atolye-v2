# Node Description Batch 82 of 166

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

- "studio_pipelinejobspanel_canapplyaction": "canApplyAction()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L862 | neighbors=[PipelineJobsPanel.tsx, canCancel(), canRetry()]
- "studio_pipelinejobspanel_formatlasthistoryevent": "formatLastHistoryEvent()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1000 | neighbors=[PipelineJobsPanel.tsx, getHistoryEventTimeLabel(), PipelineIntelligence()]
- "studio_pipelinejobspanel_formatoptionalduration": "formatOptionalDuration()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L992 | neighbors=[PipelineJobsPanel.tsx, formatDuration(), PipelineIntelligence()]
- "studio_pipelinejobspanel_gethistorydurationms": "getHistoryDurationMs()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L931 | neighbors=[PipelineJobsPanel.tsx, getHistoryDurationLabel(), getTimestampMs()]
- "studio_pipelinejobspanel_getrecenthistoryattention": "getRecentHistoryAttention()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1061 | neighbors=[PipelineJobsPanel.tsx, createPipelineHealthInsights(), sortHistoryEvents()]
- "studio_pipelinestatus_getdurationlabel": "getDurationLabel()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L492 | neighbors=[PipelineStatus.tsx, formatDuration(), StageDetails()]
- "studio_pipelinestatus_statusbadge": "StatusBadge()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L410 | neighbors=[PipelineStatus.tsx, getStatusClassName(), getStatusLabel()]
- "thumbnail_thumbnailassetpipeline_createnoncanonicalthumbnail": "createNonCanonicalThumbnail()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L252 | neighbors=[ThumbnailAssetPipeline.ts, prepareThumbnailAttempt(), .compensatePersistenceFailure()]
- "thumbnail_thumbnailassetpipeline_demotegeneratedthumbnailassets": "demoteGeneratedThumbnailAssets()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L204 | neighbors=[ThumbnailAssetPipeline.ts, prepareThumbnailAttempt(), .compensatePersistenceFailure()]
- "thumbnail_thumbnailassetpipeline_thumbnailassetpipeline_compensatepersistencefailure": ".compensatePersistenceFailure()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L154 | neighbors=[ThumbnailAssetPipeline, createNonCanonicalThumbnail(), demoteGeneratedThumbnailAssets()]
- "thumbnail_thumbnailassetpipeline_validateassemblydependency": "validateAssemblyDependency()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L307 | neighbors=[ThumbnailAssetPipeline.ts, .generateThumbnail(), ThumbnailAssetGenerationError]
- "thumbnail_thumbnailassetpipeline_validateinputs": "validateInputs()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailAssetPipeline.ts:L269 | neighbors=[ThumbnailAssetPipeline.ts, .generateThumbnail(), ThumbnailAssetGenerationError]
- "thumbnail_thumbnailengine_isstrictthumbnailplan": "isStrictThumbnailPlan()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L64 | neighbors=[ThumbnailEngine.ts, validTimestamp(), .generateThumbnailPlan()]
- "thumbnail_thumbnailengine_thumbnailengine_generatethumbnailplan": ".generateThumbnailPlan()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L25 | neighbors=[ThumbnailEngine, isStrictThumbnailPlan(), .createFallback()]
- "thumbnail_thumbnailmanager_thumbnailmanager_createfallbackthumbnaildata": ".createFallbackThumbnailData()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailManager.ts:L85 | neighbors=[ThumbnailManager, .createShortText(), .generateThumbnailData()]
- "thumbnail_thumbnailstorage_ensuresafestoragedirectory": "ensureSafeStorageDirectory()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L230 | neighbors=[ThumbnailStorage.ts, .getThumbnailsDir(), .saveThumbnail()]
- "thumbnail_thumbnailstorage_inspectpng": "inspectPng()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L269 | neighbors=[ThumbnailStorage.ts, inspectImageBuffer(), crc32()]
- "thumbnail_thumbnailstorage_mimetypeforextension": "mimeTypeForExtension()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L366 | neighbors=[ThumbnailStorage.ts, requireMatchingExtension(), .readThumbnail()]
- "thumbnail_thumbnailstorage_requirematchingextension": "requireMatchingExtension()" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L374 | neighbors=[ThumbnailStorage.ts, mimeTypeForExtension(), .inspectStoredThumbnail()]
- "types_aiusage_aiusagestatus": "AIUsageStatus" | kind=code-symbol | source=src/types/aiUsage.ts:L5 | neighbors=[AIUsagePanel.tsx, aiUsage.ts, productionSnapshot.ts]
- "types_animation_animationtransitiontype": "AnimationTransitionType" | kind=code-symbol | source=src/types/animation.ts:L18 | neighbors=[AnimationStructuredOutput.ts, AnimationProvider.ts, animation.ts]
- "types_animationerror_animationfailurephase": "AnimationFailurePhase" | kind=code-symbol | source=src/types/animationError.ts:L29 | neighbors=[AnimationAssetPipeline.ts, aiUsage.ts, animationError.ts]
- "types_audioerror_audioassetfailurephase": "AudioAssetFailurePhase" | kind=code-symbol | source=src/types/audioError.ts:L26 | neighbors=[AudioAssetError.ts, smoke-sprint-129-27-audio-remediation.ts, audioError.ts]
- "types_audioerror_audioassetfailurephases": "audioAssetFailurePhases" | kind=code-symbol | source=src/types/audioError.ts:L16 | neighbors=[AudioAssetError.ts, ProductionExecutionDurableAttempt.ts, audioError.ts]
- "types_audioerror_audioassetrooterrorcode": "AudioAssetRootErrorCode" | kind=code-symbol | source=src/types/audioError.ts:L13 | neighbors=[AudioAssetError.ts, smoke-sprint-129-27-audio-remediation.ts, audioError.ts]
- "types_pipelinejob_pipelinejobhistorystatus": "PipelineJobHistoryStatus" | kind=code-symbol | source=src/types/pipelineJob.ts:L12 | neighbors=[PipelineJobManager.ts, pipelineJob.ts, productionSnapshot.ts]
- "types_pipelinerecovery_pipelinedependencystatus": "PipelineDependencyStatus" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L7 | neighbors=[PipelineRecoveryPlanner.ts, pipelineRecovery.ts, productionExecutionRecoveryBootstrap.ts]
- "types_pipelinerecovery_pipelineresumeresult": "PipelineResumeResult" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L27 | neighbors=[PipelineRunner.ts, PipelineResumeAction.tsx, pipelineRecovery.ts]
- "types_pipelinerecovery_pipelineretryresult": "PipelineRetryResult" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L43 | neighbors=[PipelineRunner.ts, PipelineStatus.tsx, pipelineRecovery.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationcontext": "ProductionExecutionAuthorizationContext" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L80 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-execution-authorizatio…, productionExecutionAuthorization.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationschemaversion": "productionExecutionAuthorizationSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L4 | neighbors=[ProductionExecutionAuthorization.ts, smoke-production-execution-phase-review…, productionExecutionAuthorization.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationpolicy": "ProductionExecutionConfirmationPolicy" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L35 | neighbors=[ProductionExecutionConfirmation.ts, smoke-production-execution-confirmation…, productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationschemaversion": "productionExecutionConfirmationSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L4 | neighbors=[ProductionExecutionConfirmation.ts, smoke-production-execution-phase-review…, productionExecutionConfirmation.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorpolicy": "ProductionExecutionCoordinatorPolicy" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L15 | neighbors=[ProductionExecutionCoordinator.ts, productionExecutionCoordinator.ts, productionExecutionWorker.ts]
- "types_productionexecutiondispatch_productionexecutiondispatcheligibilityresult": "ProductionExecutionDispatchEligibilityResult" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L6 | neighbors=[ProductionExecutionDispatch.ts, productionExecutionDispatch.ts, productionExecutionWorker.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchenvelope": "ProductionExecutionDispatchEnvelope" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L2 | neighbors=[ProductionExecutionDispatch.ts, productionExecutionDispatch.ts, productionExecutionWorker.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchschemaversion": "productionExecutionDispatchSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L1 | neighbors=[ProductionExecutionDispatch.ts, smoke-production-execution-phase-review…, productionExecutionDispatch.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptidentity": "ProductionExecutionAttemptIdentity" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L6 | neighbors=[ProductionExecutionDurableAttemptIntegr…, productionExecutionDurableAttempt.ts, ProductionExecutionAttemptOpenRequest]
- "types_productionexecutiondurableattempt_productionexecutionattemptjournalentry": "ProductionExecutionAttemptJournalEntry" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L7 | neighbors=[ProductionExecutionDurableAttempt.ts, ProductionExecutionDurableAttemptIntegr…, productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptreasoncode": "ProductionExecutionAttemptReasonCode" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L5 | neighbors=[ProductionExecutionDurableAttempt.ts, productionExecutionCoordinator.ts, productionExecutionDurableAttempt.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-081.json

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
