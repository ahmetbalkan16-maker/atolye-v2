# Node Description Batch 9 of 166

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
Write every description in Portuguese (pt). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "types_project_projectpackageruntype": "ProjectPackageRunType" | kind=code-symbol | source=src/types/project.ts:L67 | neighbors=[PipelineFailedStageRetry.ts, PipelineRetryAdmission.ts, PipelineRunner.ts, PipelineStageExecutor.ts, ProductionAcceptanceExecutionScope.ts, ProductionAcceptancePolicy.ts]
- "ai_generationexecutionpolicy": "GenerationExecutionPolicy.ts" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L1 | neighbors=[AIManager.ts, failClosedOrReturn(), GenerationExecutionPolicy, GenerationFallbackBlockedError, strictGenerationExecutionPolicy, AssemblyManager.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@3480988ab74b788d0cb179a6bba562dffd4c6d05": "3480988 Sprint 115: Activate production video assembly pipeline" | kind=Commit | source=git | neighbors=[VideoAssemblyManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1]
- "jobid_route": "route.ts" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L1 | neighbors=[24d0cba feat(pipeline): harden retry fa…, 3518022 feat: complete sprint 67 pipeli…, 4c104fa feat(production): wire durable …, 7afa3c8 feat(pipeline): integrate retry…, 94269fa feat: complete sprint 64 pipeli…, e705042 feat: harden pipeline state err…]
- "production_productionacceptancetopic": "ProductionAcceptanceTopic.ts" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L1 | neighbors=[65d376b Sprint 129.19: Harden visual st…, a029553 fix(production): close sprint 1…, ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceOrchestrator.ts, ProductionAcceptancePolicy.ts]
- "scripts_smoke_pipeline_history_persistence": "smoke-pipeline-history-persistence.ts" | kind=code-symbol | source=scripts/smoke-pipeline-history-persistence.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, c5fd1ea feat: harden pipeline history p…, CanonicalSmokeRuntime.ts, withCanonicalSmokeRuntime(), SmokeResult.ts, emitSmokeResult()]
- "scripts_smoke_production_worker_lifecycle": "smoke-production-worker-lifecycle.ts" | kind=code-symbol | source=scripts/smoke-production-worker-lifecycle.ts:L1 | neighbors=[99834f4 feat: complete Sprint 129.28 du…, e3b5c6c Sprint 110: Add production work…, fb444fd wip: preserve C.2B.3 audit and …, ProductionPipelineExecutionFactory.ts, executeConfiguredProductionPipelineStag…, installCanonicalProductionPipelineExecu…]
- "security_guardedruntimemutationsession_guardedruntimemutationsession": "GuardedRuntimeMutationSession" | kind=code-symbol | source=src/lib/runtime/security/GuardedRuntimeMutationSession.ts:L375 | neighbors=[RuntimeMigrationCandidateService.ts, smoke-sprint-129-25c-2a-guarded-filesys…, GuardedRuntimeMutationSession.ts, .beginMutationWithValidator(), .acquireExclusiveReservation(), .assertActive()]
- "security_runtimepathpolicy": "RuntimePathPolicy.ts" | kind=code-symbol | source=src/lib/runtime/security/RuntimePathPolicy.ts:L1 | neighbors=[RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, RuntimeBackupVerifier.ts, aecde83 feat(runtime): add guarded file…, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidatePaths.ts]
- "studio_aiusagepanel": "AIUsagePanel.tsx" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L1 | neighbors=[04b6c0f feat(studio): add AI usage filt…, 26fb978 feat(studio): add AI diagnostic…, 838244a feat(studio): enhance AI diagno…, AIUsagePanel(), AIUsagePanelProps, AIUsageResponse]
- "thumbnail_thumbnailstorage_thumbnailstorage": "ThumbnailStorage" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailStorage.ts:L41 | neighbors=[route.ts, ProductionAcceptanceOrchestrator.ts, ProductionEndToEndValidation.ts, ProductionReadinessService.ts, MockThumbnailProvider.ts, OpenAIThumbnailProvider.ts]
- "types_productionexecutionidempotency_productionexecutionidempotencyrecord": "ProductionExecutionIdempotencyRecord" | kind=code-symbol | source=src/types/productionExecutionIdempotency.ts:L34 | neighbors=[ProductionDurableAttemptLineageClassifi…, ProductionExecutionDurableStorage.ts, ProductionExecutionIdempotency.ts, ProductionExecutionPersistence.ts, ProductionExecutionRecoveryBootstrap.ts, ProductionPipelineExecutionFactory.ts]
- "types_thumbnail_thumbnaildata": "ThumbnailData" | kind=code-symbol | source=src/types/thumbnail.ts:L74 | neighbors=[route.ts, PipelineStageExecutor.ts, seoPrompt.ts, ExportProvider.ts, MockThumbnailProvider.ts, ThumbnailProvider.ts]
- "types_video": "video.ts" | kind=code-symbol | source=src/types/video.ts:L1 | neighbors=[AssemblyManager.ts, VideoAssemblyManager.ts, 2a03d89 Sprint 117: Activate production…, 8c15471 feat(video): add mock video eng…, PipelineStageExecutor.ts, ExportProvider.ts]
- "assembly_route": "route.ts" | kind=code-symbol | source=app/api/assembly/route.ts:L1 | neighbors=[AssemblyManager.ts, AssemblyManager, POST(), ProjectManager.ts, ProjectManager, animation.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@0108d60a99cdf551e5689f595711443fdb72511a": "0108d60 feat(ai): add mock-first provider guardrails" | kind=Commit | source=git | neighbors=[AIManager.ts, AIProviderConfig.ts, client.ts, pipeline.ts, AssemblyManager.ts, AudioManager.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@220ad1e9e5bac2ca635c24be0c95e31115810dc6": "220ad1e Sprint 122: Add production YouTube publish pipeline" | kind=Commit | source=git | neighbors=[agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@c70a533df8948fe2b31f751212048c0dfb0324f1": "c70a533 Sprint 126: Add production readiness and acceptance orchestration" | kind=Commit | source=git | neighbors=[0e0ff02 Sprint 125: Add production end-…, AIManager.ts, GenerationExecutionPolicy.ts, AssemblyManager.ts, AudioManager.ts, agents/api-graphify-mcp-integration]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@ffe4b50b14cc5f8ab818e8d5cd6564b8cf4d44df": "ffe4b50 Sprint 116: Add animation motion plan production contract" | kind=Commit | source=git | neighbors=[3480988 Sprint 115: Activate production…, AnimationAssetPipeline.ts, animationMerge.ts, AnimationMotionPlanValidation.ts, AnimationService.ts, route.ts]
- "filename_route": "route.ts" | kind=code-symbol | source=app/api/assets/videos/[slug]/[fileName]/route.ts:L1 | neighbors=[3480988 Sprint 115: Activate production…, 4f09cf6 Sprint 114: Activate production…, 5883c6d Sprint 120: Activate production…, 6286a7c feat(audio): complete truncatio…, 72fc633 feat(asset): integrate openai i…, GET()]
- "health_route": "route.ts" | kind=code-symbol | source=app/api/runtime/health/route.ts:L1 | neighbors=[c812810 Sprint 112: Add production runt…, createProductionRuntimeHealthResponse(), GET(), isLifecycleState(), jsonResponse(), productionDependencies]
- "lib_canonicalsmokeevidencev2_runevidencematrix": "runEvidenceMatrix()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L774 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), assertExistingEvidenceRoot(), currentHead(), defaultEvidenceRoot(), fail()]
- "pipeline_pipelinequeuescheduler": "PipelineQueueScheduler.ts" | kind=code-symbol | source=src/lib/pipeline/PipelineQueueScheduler.ts:L1 | neighbors=[7afa3c8 feat(pipeline): integrate retry…, 7cf9535 feat(pipeline): implement job s…, aa6afc2 feat: complete sprint 66 pipeli…, PipelineJobManager.ts, PipelineJobManager, PipelineQueueScheduler]
- "pipeline_pipelinestageexecutor_pipelinestageexecutor": "PipelineStageExecutor" | kind=code-symbol | source=src/lib/pipeline/PipelineStageExecutor.ts:L148 | neighbors=[PipelineRunner.ts, PipelineStageExecutor.ts, .createInitialState(), .execute(), .loadState(), .persistStageResult()]
- "production_productionexecutioncoordinator": "ProductionExecutionCoordinator.ts" | kind=code-symbol | source=src/lib/production/ProductionExecutionCoordinator.ts:L1 | neighbors=[4077613 feat(production): add execution…, denied(), ProductionExecutionCoordinator, ProductionExecutionDurableAttempt.ts, AdapterBackedProductionExecutionAttempt…, ProductionExecutionDurableClaim.ts]
- "production_productionexecutiondurableclaim_adapterbackedproductionexecutionclaimservice": "AdapterBackedProductionExecutionClaimService" | kind=code-symbol | source=src/lib/production/ProductionExecutionDurableClaim.ts:L12 | neighbors=[ProductionExecutionCoordinator.ts, ProductionExecutionDurableClaim.ts, .abandonExecutionClaim(), .acquireExecutionClaim(), .activeClaimForRecord(), .closeClaim()]
- "production_productionexecutionidempotency_buildproductionexecutionidempotencyidentity": "buildProductionExecutionIdempotencyIdentity()" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L35 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionIdempotency.ts, canonicalDate(), failure(), ProductionExecutionPersistence.ts, ProductionPipelineExecutionFactory.ts]
- "production_productionexecutionidempotency_defaultproductionexecutionidempotencypolicy": "defaultProductionExecutionIdempotencyPolicy" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L14 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, ProductionExecutionIdempotency.ts, ProductionExecutionPersistence.ts, ProductionPipelineExecutionFactory.ts, ProductionPipelineRetryAdmissionBinding…, ProductionPipelineRetryReconciliation.ts]
- "production_productionpipelineexecutioninstrumentation": "ProductionPipelineExecutionInstrumentation.ts" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionInstrumentation.ts:L1 | neighbors=[0ff6112 feat(production): add stage-bou…, 99834f4 feat: complete Sprint 129.28 du…, bc53393 wip: preserve sprint 129.28 fin…, cc0f176 feat: complete Sprint 129.28 du…, PipelineRunner.ts, PipelineStageExecutor.ts]
- "production_productionsnapshotcontract": "ProductionSnapshotContract.ts" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L1 | neighbors=[8ac37cd feat(production): add snapshot …, ProductionSnapshotBuilder.ts, PipelineRecoveryPlanner.ts, pipelineRecoveryStageOrder, calculateCoverage(), createCanonicalStageOrder()]
- "providers_imageprovider": "ImageProvider.ts" | kind=code-symbol | source=src/lib/assets/providers/ImageProvider.ts:L1 | neighbors=[VisualAssetPipeline.ts, 018d91e feat(visuals): add Wikimedia Co…, 72fc633 feat(asset): integrate openai i…, 99834f4 feat: complete Sprint 129.28 du…, bec4962 Sprint 113: Activate production…, f986047 Sprint 32 Phase 4 - Add Visual …]
- "providers_openaithumbnailprovider": "OpenAIThumbnailProvider.ts" | kind=code-symbol | source=src/lib/thumbnail/providers/OpenAIThumbnailProvider.ts:L1 | neighbors=[5883c6d Sprint 120: Activate production…, 99834f4 feat: complete Sprint 129.28 du…, MockThumbnailProvider.ts, createMockThumbnailData(), decodeStrictBase64(), failure()]
- "providers_youtubepublishprovider": "YouTubePublishProvider.ts" | kind=code-symbol | source=src/lib/youtube/publish/providers/YouTubePublishProvider.ts:L1 | neighbors=[220ad1e Sprint 122: Add production YouT…, 7696afb Sprint 124: Harden YouTube publ…, 99834f4 feat: complete Sprint 129.28 du…, PipelineStageExecutor.ts, MockYouTubePublishProvider.ts, YouTubeDataApiPublishProvider.ts]
- "scripts_smoke_production_phase_closure": "smoke-production-phase-closure.ts" | kind=code-symbol | source=scripts/smoke-production-phase-closure.ts:L1 | neighbors=[0d7b72c feat(production): add execution…, b4ec40e feat(production): add persisten…, ProductionExecutionContract.ts, ProductionExecutionContract, ProductionExecutionSafetyPlan.ts, firstRealExecutionCandidate]
- "thumbnail_thumbnailengine": "ThumbnailEngine.ts" | kind=code-symbol | source=src/lib/thumbnail/ThumbnailEngine.ts:L1 | neighbors=[4cde4cd feat(thumbnail): add thumbnail …, c70a533 Sprint 126: Add production read…, PipelineStageExecutor.ts, smoke-production-readiness-acceptance.ts, GenerationExecutionPolicy.ts, GenerationExecutionPolicy]
- "types_animationerror": "animationError.ts" | kind=code-symbol | source=src/types/animationError.ts:L1 | neighbors=[AnimationAssetPipeline.ts, AnimationMotionPlanError.ts, AnimationStructuredOutput.ts, 5a31d1f Sprint 129.22: Harden animation…, 6094cd8 Sprint 129.21: Harden productio…, AnimationProvider.ts]
- "types_productionexecutiontransaction": "productionExecutionTransaction.ts" | kind=code-symbol | source=src/types/productionExecutionTransaction.ts:L1 | neighbors=[d655db9 feat(production): add execution…, ProductionExecutionPersistence.ts, ProductionExecutionTransaction.ts, ProductionExecutionWorker.ts, smoke-production-execution-persistence.…, smoke-production-execution-phase-review…]
- "video_videodatavalidation": "VideoDataValidation.ts" | kind=code-symbol | source=src/lib/video/VideoDataValidation.ts:L1 | neighbors=[route.ts, VideoAssemblyManager.ts, 2a03d89 Sprint 117: Activate production…, 6e53895 Sprint 118: Consume scene video…, route.ts, PipelineRecoveryPlanner.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@5883c6d6199435abb27b5a6f952bac825fdef2aa": "5883c6d Sprint 120: Activate production thumbnail pipeline" | kind=Commit | source=git | neighbors=[1c34a9e Sprint 119: Harden pipeline ret…, AssetManager.ts, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@6c1ae5aeb9fbe2eaa1bc325141ad69e11bb67a98": "6c1ae5a Sprint 15 - Multi AI Provider Architecture" | kind=Commit | source=git | neighbors=[56ff577 Sprint 14 - Project documentati…, client.ts, pipeline.ts, types.ts, layout.tsx, wip/production-audio-resume-prep]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-008.json

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
