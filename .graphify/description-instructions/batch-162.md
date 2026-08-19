# Node Description Batch 163 of 166

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

- "types_asset_assetstatus": "AssetStatus" | kind=code-symbol | source=src/types/asset.ts:L8 | neighbors=[asset.ts]
- "types_asset_assettype": "AssetType" | kind=code-symbol | source=src/types/asset.ts:L1 | neighbors=[asset.ts]
- "types_asset_imagegenerationfailure": "ImageGenerationFailure" | kind=code-symbol | source=src/types/asset.ts:L158 | neighbors=[asset.ts]
- "types_asset_imagegenerationfilelocator": "ImageGenerationFileLocator" | kind=code-symbol | source=src/types/asset.ts:L123 | neighbors=[asset.ts]
- "types_asset_imagegenerationmocksuccess": "ImageGenerationMockSuccess" | kind=code-symbol | source=src/types/asset.ts:L114 | neighbors=[asset.ts]
- "types_asset_imagegenerationrealphotosuccess": "ImageGenerationRealPhotoSuccess" | kind=code-symbol | source=src/types/asset.ts:L141 | neighbors=[asset.ts]
- "types_asset_imagegenerationrealsuccess": "ImageGenerationRealSuccess" | kind=code-symbol | source=src/types/asset.ts:L133 | neighbors=[asset.ts]
- "types_asset_imagegenerationresultbase": "ImageGenerationResultBase" | kind=code-symbol | source=src/types/asset.ts:L106 | neighbors=[asset.ts]
- "types_asset_imagegenerationurllocator": "ImageGenerationUrlLocator" | kind=code-symbol | source=src/types/asset.ts:L128 | neighbors=[asset.ts]
- "types_asset_videomimetype": "VideoMimeType" | kind=code-symbol | source=src/types/asset.ts:L104 | neighbors=[asset.ts]
- "types_audio_audiogenerationfailure": "AudioGenerationFailure" | kind=code-symbol | source=src/types/audio.ts:L50 | neighbors=[audio.ts]
- "types_audio_audiogenerationmocksuccess": "AudioGenerationMockSuccess" | kind=code-symbol | source=src/types/audio.ts:L27 | neighbors=[audio.ts]
- "types_audio_audiogenerationrealsuccess": "AudioGenerationRealSuccess" | kind=code-symbol | source=src/types/audio.ts:L38 | neighbors=[audio.ts]
- "types_audio_audiogenerationresultbase": "AudioGenerationResultBase" | kind=code-symbol | source=src/types/audio.ts:L20 | neighbors=[audio.ts]
- "types_audio_audiostatus": "AudioStatus" | kind=code-symbol | source=src/types/audio.ts:L1 | neighbors=[audio.ts]
- "types_export_exportmanifest": "ExportManifest" | kind=code-symbol | source=src/types/export.ts:L47 | neighbors=[export.ts]
- "types_pipeline_pipelineproject": "PipelineProject" | kind=code-symbol | source=src/types/pipeline.ts:L28 | neighbors=[pipeline.ts]
- "types_pipeline_pipelinerunresult": "PipelineRunResult" | kind=code-symbol | source=src/types/pipeline.ts:L38 | neighbors=[pipeline.ts]
- "types_pipeline_pipelinestep": "PipelineStep" | kind=code-symbol | source=src/types/pipeline.ts:L1 | neighbors=[pipeline.ts]
- "types_pipeline_pipelinestepstate": "PipelineStepState" | kind=code-symbol | source=src/types/pipeline.ts:L19 | neighbors=[pipeline.ts]
- "types_pipeline_pipelinestepstatus": "PipelineStepStatus" | kind=code-symbol | source=src/types/pipeline.ts:L12 | neighbors=[pipeline.ts]
- "types_pipelinerecovery_pipelinerecoveryplantype": "PipelineRecoveryPlanType" | kind=code-symbol | source=src/types/pipelineRecovery.ts:L5 | neighbors=[pipelineRecovery.ts]
- "types_productioncontrolledexecutiongateway_productioncontrolledexecutiongatewaymode": "ProductionControlledExecutionGatewayMode" | kind=code-symbol | source=src/types/productionControlledExecutionGateway.ts:L1 | neighbors=[productionControlledExecutionGateway.ts]
- "types_productionexecutionauthorization_productionexecutionactoridentity": "ProductionExecutionActorIdentity" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L33 | neighbors=[productionExecutionAuthorization.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationconfirmationlevel": "ProductionExecutionAuthorizationConfirmationLevel" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L9 | neighbors=[productionExecutionAuthorization.ts]
- "types_productionexecutionauthorization_productionexecutionauthorizationdecision": "ProductionExecutionAuthorizationDecision" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L7 | neighbors=[productionExecutionAuthorization.ts]
- "types_productionexecutionauthorization_productionexecutionworkeridentity": "ProductionExecutionWorkerIdentity" | kind=code-symbol | source=src/types/productionExecutionAuthorization.ts:L43 | neighbors=[productionExecutionAuthorization.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationmetadata": "ProductionExecutionConfirmationMetadata" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L17 | neighbors=[productionExecutionConfirmation.ts]
- "types_productionexecutionconfirmation_productionexecutionconfirmationstatus": "ProductionExecutionConfirmationStatus" | kind=code-symbol | source=src/types/productionExecutionConfirmation.ts:L6 | neighbors=[productionExecutionConfirmation.ts]
- "types_productionexecutioncoordinator_productionexecutioncoordinatorschemaversion": "productionExecutionCoordinatorSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionCoordinator.ts:L5 | neighbors=[productionExecutionCoordinator.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchpriority": "ProductionExecutionDispatchPriority" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L1 | neighbors=[productionExecutionDispatch.ts]
- "types_productionexecutiondispatch_productionexecutiondispatchstate": "ProductionExecutionDispatchState" | kind=code-symbol | source=src/types/productionExecutionDispatch.ts:L1 | neighbors=[productionExecutionDispatch.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptbinding": "ProductionExecutionAttemptBinding" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L6 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptrecoveryclassification": "ProductionExecutionAttemptRecoveryClassification" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L14 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionattemptstate": "ProductionExecutionAttemptState" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L4 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutiondurableattemptschemaversion": "productionExecutionDurableAttemptSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L3 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutiondurableattemptstorageversion": "productionExecutionDurableAttemptStorageVersion" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L3 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionjournalentrytype": "ProductionExecutionJournalEntryType" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L4 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableattempt_productionexecutionoutcometype": "ProductionExecutionOutcomeType" | kind=code-symbol | source=src/types/productionExecutionDurableAttempt.ts:L4 | neighbors=[productionExecutionDurableAttempt.ts]
- "types_productionexecutiondurableclaim_productionexecutionclaimbinding": "ProductionExecutionClaimBinding" | kind=code-symbol | source=src/types/productionExecutionDurableClaim.ts:L15 | neighbors=[productionExecutionDurableClaim.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-162.json

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
