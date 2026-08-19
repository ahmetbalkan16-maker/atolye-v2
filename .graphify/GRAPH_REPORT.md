# Graph Report - .  (2026-08-18)

## Corpus Check
- label mode - file stats not available

## Summary
- 6638 nodes · 20668 edges · 185 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output
- Edge kinds: contains: 5018 · imports: 4587 · calls: 4402 · imports_from: 2943 · MODIFIES: 1365 · ON_BRANCH: 1200 · method: 688 · PARENT_OF: 231 · depends_on: 77 · implements: 65 · inherits: 37 · re_exports: 25 · references: 12 · blocks: 9 · semantically_similar_to: 7 · conceptually_related_to: 1 · fixes: 1


## Graph Freshness
- Built from Git commit: `52fca36`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `ProjectManager` - 122 edges
2. `PipelineJobManager` - 83 edges
3. `ProductionStepKey` - 62 edges
4. `PipelineRunner` - 51 edges
5. `ProjectReader` - 44 edges
6. `ProductionExecutionFilePersistenceAdapter` - 43 edges
7. `AdapterBackedProductionExecutionDurableStorage` - 42 edges
8. `RuntimeStorageContext` - 42 edges
9. `AudioCompensationStoreError` - 41 edges
10. `createRuntimeStorageContext()` - 41 edges

## Surprising Connections (you probably didn't know these)
- `docs/Roadmap.md` --semantically_similar_to--> `docs/Architecture.md`  [INFERRED] [semantically similar]
  docs/Roadmap.md → docs/Architecture.md
- `GET()` --calls--> `getContentType()`  [EXTRACTED]
  app/api/assets/videos/[slug]/[fileName]/route.ts → app/api/assets/images/[slug]/[fileName]/route.ts
- `GET()` --calls--> `isInsideDirectory()`  [EXTRACTED]
  app/api/assets/videos/[slug]/[fileName]/route.ts → app/api/assets/images/[slug]/[fileName]/route.ts
- `GET()` --calls--> `isSafeFileName()`  [EXTRACTED]
  app/api/assets/videos/[slug]/[fileName]/route.ts → app/api/assets/images/[slug]/[fileName]/route.ts
- `GET()` --calls--> `isSafePathSegment()`  [EXTRACTED]
  app/api/assets/videos/[slug]/[fileName]/route.ts → app/api/assets/images/[slug]/[fileName]/route.ts

## Hyperedges (group relationships)
- **Real Photo Sourcing Feature Rollout (Sprints 130/130.1/130.2)** — chkpt_real_photo_image_provider, chkpt_wikimedia_commons_client [INFERRED 0.85]
- **Fatih Project Manifest Bookkeeping Reconciliation** — chkpt_reconcile_fatih_backfill_script, chkpt_pipeline_job_manager, chkpt_project_manager [INFERRED 0.80]
- **FFmpeg-Triggered Smoke Fixture Regression Discovery & Closure** — chkpt_smoke_animation_provider, chkpt_smoke_assembly_scene_video_consumption, chkpt_smoke_video_assembly_wiring [INFERRED 0.80]
- **RuntimeStorageContext Threading Remediation Pattern** — changelog_sprint_129_42, changelog_sprint_129_44, changelog_runtime_storage_context [INFERRED 0.85]
- **Fatih Documentary Production Data Flow** — changelog_audio_json, changelog_assembly_json, changelog_assets_json [EXTRACTED 0.90]
- **Retry-Budget Extension & Settlement Fail-Closed Chain** — changelog_sprint_129_38, changelog_retry_budget_extension_authority, changelog_terminal_settlement, changelog_pipeline_failed_stage_retry [EXTRACTED 0.85]
- **Real Photo Source Feature (Sprint 130 family)** — roadmap_sprint_130, roadmap_adr_019, roadmap_real_photo_image_provider, roadmap_wikimedia_commons_client [EXTRACTED 0.95]
- **Retry Budget Extension Authority Remediation Chain** — roadmap_sprint_129_36, roadmap_sprint_129_35, roadmap_sprint_129_33, roadmap_sprint_129_32 [EXTRACTED 0.90]
- **Durable Production Execution Phase (Sprint 99-108)** — roadmap_sprint_99_1, roadmap_sprint_100, roadmap_sprint_101, roadmap_sprint_102, roadmap_sprint_103, roadmap_sprint_104, roadmap_sprint_105, roadmap_sprint_106, roadmap_sprint_107, roadmap_sprint_108 [EXTRACTED 0.95]
- **P0 Blocking Relocation Entrypoints** — storageaudit_api1, storageaudit_api2, storageaudit_rt1, storageaudit_d1, storageaudit_sec1 [EXTRACTED 0.90]
- **AI Onboarding Reading Sequence** — readme_doc, philosophy_doc, vision_doc, airules_doc, context_doc [EXTRACTED 0.90]

## Communities

### Community 0 - "Early Feature Commit History"
Cohesion: 0.08
Nodes (160): agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep, wip/production-audio-resume-prep-v2, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, 0024504 feat(pipeline): add execution timeline foundation (Sprint 81), 0108d60 feat(ai): add mock-first provider guardrails (+152 more)

### Community 1 - "Historical Audio Ordinal Preflight"
Cohesion: 0.03
Nodes (138): 9d652d5 fix(production): close sprint 129.36 retry budget extension, eacb090 fix(production): close sprint 129.36 retry budget extension, bodyWithoutIntegrity(), buildCanonicalIdentities(), createAlternativeHistoricalAudioOrdinalFourChain(), createEmbeddedOnlyUnexpectedHistoricalAudioOrdinalFourRecord(), exactVersionPaths(), HistoricalAudioAuthority (+130 more)

### Community 2 - "Production Retry & Persistence Fixes"
Cohesion: 0.03
Nodes (100): 2863b3a fix(production): bind queued exhausted drift to persisted run type, 8f7a37b fix(production): close sprint 129.41 remediation, a029553 fix(production): close sprint 129.33 retry admission safety, cfb4887 feat(sprint-129.35): legacy terminal lineage global-quiescence compatibility remediation, PipelineRetryReconciledLineageBinding, canonicalProductionSecurityValue(), ProductionExecutionFilePersistenceAdapter, ProductionExecutionPersistenceAdapter (+92 more)

### Community 3 - "Execution Coordinator & Lifecycle"
Cohesion: 0.02
Nodes (127): denied(), ProductionExecutionCoordinator, defaultProductionExecutionClaimPolicy, defaultProductionExecutionDurableLeasePolicy, mapReason(), ProductionExecutionLifecycle, ProductionExecutionRecoveryPlannerPort, buildProductionExecutionWorkerPlan() (+119 more)

### Community 4 - "Early Engine Foundation Commits"
Cohesion: 0.03
Nodes (82): isScriptData(), POST(), resolveScript(), 0a03cad refactor(types): cleanup domain type architecture, 20717bf feat(project): add manifest layer and package status tracking, 528dcf8 feat(audio): add audio narration engine core, 56fd9c7 feat(thumbnail): add thumbnail engine core, 56ff577 Sprint 14 - Project documentation foundation (+74 more)

### Community 5 - "AI Manager Core Orchestration"
Cohesion: 0.04
Nodes (88): AIManager, AIResponseError, getAIResponseSchemaEvidence(), isAIResponseSchemaEvidence(), serializeAIResponseSchemaIssues(), ApplicationTimestampError, createCanonicalApplicationTimestamp(), isCanonicalTimestamp() (+80 more)

### Community 6 - "Runtime Backup Manifest Versioning"
Cohesion: 0.04
Nodes (95): runtimeBackupAggregateVersion, runtimeBackupFormatVersionV2, runtimeBackupManifestSchemaVersionV2, runtimeBackupPathPolicyVersion, RuntimeBackupVerificationReport, messages, migrationCandidateError(), RuntimeMigrationCandidateError (+87 more)

### Community 7 - "Retry Hardening Commit History"
Cohesion: 0.04
Nodes (102): 0c83b5b feat: add retry scheduler compensation, 24d0cba feat(pipeline): harden retry failure responses (Sprint 85), 2f12699 feat: harden retry state-load preflight, 4c104fa feat(production): wire durable pipeline execution, 7afa3c8 feat(pipeline): integrate retry execution (Sprint 84), 7cf9535 feat(pipeline): implement job state consistency (Sprint 83), a669ed5 feat(pipeline): harden retry dependency preflight (Sprint 86), e705042 feat: harden pipeline state error contracts (+94 more)

### Community 8 - "Stage Execution & Acceptance Scope"
Cohesion: 0.03
Nodes (85): bc53393 wip: preserve sprint 129.28 final two-p1 remediation, cc0f176 feat: complete Sprint 129.28 durable authority hardening, materializePipelineStageExecutionOptions(), PipelineExecutionState, PipelineStageExecutionOptions, adapterFactoryNames, createExplicitProviderDispatchAdapter(), createProductionAcceptanceProviderSelection() (+77 more)

### Community 9 - "Production Execution Authorization"
Cohesion: 0.04
Nodes (102): stableProductionId(), stableProductionValue(), actions, canonical(), defaultProductionExecutionAuthorizationPolicy, evaluate(), evaluateProductionExecutionAuthorization(), hasCycle() (+94 more)

### Community 10 - "Canonical Smoke Runtime Harness"
Cohesion: 0.03
Nodes (82): 99834f4 feat: complete Sprint 129.28 durable authority hardening, applyEnvironment(), assertCanonicalSmokeRuntimeStorageContext(), assertRunOwnedContext(), canonicalPath(), CanonicalSmokeFinalizationResult, CanonicalSmokeInventoryEntry, CanonicalSmokeOwnershipManifest (+74 more)

### Community 11 - "Asset & YouTube Publish Sprints"
Cohesion: 0.05
Nodes (79): AssetPatch, CreateAssetInput, 220ad1e Sprint 122: Add production YouTube publish pipeline, 7696afb Sprint 124: Harden YouTube publish reconciliation, ae42dc4 Sprint 123: Stabilize production end-to-end pipeline, MatchedResult, NonMatchedOutcome, cancelResponseBody() (+71 more)

### Community 12 - "YouTube Package Pipeline Route"
Cohesion: 0.05
Nodes (73): ca97d40 Sprint 121: Add production YouTube package pipeline, isAssemblyPlanData(), isAudioData(), isSEOData(), isThumbnailData(), loadProjectExportSources(), normalizeFormat(), normalizeSlug() (+65 more)

### Community 13 - "Guarded Filesystem Backup Atomics"
Cohesion: 0.05
Nodes (55): assertAtomicAbsoluteMaterializedPath(), assertAtomicCreateRoots(), assertAtomicRestoreRoots(), assertExactAtomicKeys(), assertExactInventory(), assertIdentity(), atomicContainedFilePath(), atomicMaterializedMutationPath() (+47 more)

### Community 14 - "Mock Thumbnail Provider"
Cohesion: 0.05
Nodes (68): 5883c6d Sprint 120: Activate production thumbnail pipeline, buildSourceLine(), buildVariants(), ConfiguredThumbnailProvider, crc32(), createDeterministicThumbnailPng(), createMockThumbnailData(), createOverlayText() (+60 more)

### Community 15 - "Animation Provider Configuration"
Cohesion: 0.04
Nodes (61): 7a10970 Sprint 127: Activate production animation provider, AnimationGenerationFailure, AnimationGenerationInput, AnimationGenerationResult, AnimationGenerationResultBase, AnimationProvider, ConfiguredAnimationProvider, AnimationProviderConfigurationError (+53 more)

### Community 16 - "Production Action Recommendation Engine"
Cohesion: 0.05
Nodes (62): d3c574c feat(production): add intelligence planning and execution foundations, fa9d06c fix(production): harden intelligence phase contracts, pipelineRecoveryStageOrder, actionTypeFor(), ProductionActionEngine, titleFor(), toAction(), detectProductionDependencyCycles() (+54 more)

### Community 17 - "FFmpeg Scene Video Rendering"
Cohesion: 0.04
Nodes (64): 2a03d89 Sprint 117: Activate production scene video rendering, absoluteInput(), buildMotionFilter(), buildSceneFFmpegArgs(), buildSceneFFprobeArgs(), clamp(), ConfiguredVideoProvider, FFmpegSceneVideoProvider (+56 more)

### Community 18 - "Durable Storage Idempotency Policy"
Cohesion: 0.05
Nodes (79): installDurableStorageConstructionTestHook(), terminal, buildProductionExecutionIdempotencyIdentity(), canonicalDate(), canonicalTransitions, evaluateProductionExecutionIdempotencyReplay(), evaluateProductionExecutionIdempotencyTransition(), evaluateProductionExecutionRecoveryEligibility() (+71 more)

### Community 19 - "Generation Policy & Visual Prompts"
Cohesion: 0.05
Nodes (46): failClosedOrReturn(), GenerationExecutionPolicy, GenerationFallbackBlockedError, SceneDataInput, SceneItem, AssemblyAIConfigError, assemblyTokenBudget, getAssemblyMaxTokens() (+38 more)

### Community 20 - "Execution Persistence & Journal"
Cohesion: 0.04
Nodes (68): defaultProductionControlledExecutionGatewayPolicy, CanonicalRead, directoryDurability(), evaluateProductionExecutionDirectoryDurability(), kinds, ProductionExecutionDurableRecoveryOptions, ProductionExecutionFilePersistenceOptions, TrustedProductionExecutionPersistenceFileOperations (+60 more)

### Community 21 - "Runtime Backup Verification Service"
Cohesion: 0.05
Nodes (60): runtimeBackupFormatVersion, RuntimeBackupManifest, runtimeBackupManifestSchemaVersion, runtimeBackupManifestSha256(), runtimeBackupPathLimits, createVerifiedRuntimeBackup(), decodeCreateDependencies(), decodeCreateRequest() (+52 more)

### Community 22 - "Audio Provider Configuration"
Cohesion: 0.05
Nodes (59): 4f09cf6 Sprint 114: Activate production narration audio pipeline, 6286a7c feat(audio): complete truncation budget and durable storage hardening, e31d35d wip: checkpoint two-phase audio publication review findings, AudioGenerationInput, AudioProvider, ConfiguredAudioProvider, AudioProviderConfigurationError, getOpenAIAudioProviderConfig() (+51 more)

### Community 23 - "Pipeline Runner Canonical Lock"
Cohesion: 0.05
Nodes (72): assertPipelineRunnerProductionRuntimeOperationActive(), assertProcessCanonicalLockOwnership(), CanonicalPipelineRuntimeRegistration, executePipelineRunnerProductionRuntimeOperation(), installPipelineRunnerProductionRuntime(), moduleProvenance, ownsProcessCanonicalLock, PipelineRunnerProductionRuntimeSnapshot (+64 more)

### Community 24 - "Audio Compensation Store"
Cohesion: 0.10
Nodes (77): activeRecordCount(), admissionReservationBytes(), assertProtectedAudioCanonicalResolutionAllowed(), AudioCompensationBacklogSaturatedError, AudioCompensationLifecycleStatus, AudioCompensationRetirementPlan, AudioCompensationState, AudioCompensationStoreError (+69 more)

### Community 25 - "Production Runtime Bootstrap"
Cohesion: 0.05
Nodes (58): e3b5c6c Sprint 110: Add production worker lifecycle, classifications, emptyCounts(), ProductionRuntimeInitializationError, ProductionRuntimeInitializer, ProductionRuntimeInitializerDependencies, success(), validBootstrap() (+50 more)

### Community 26 - "Project Manifest API Route"
Cohesion: 0.04
Nodes (10): GET(), isSafeSlug(), RouteContext, ProjectManager, ScenesArtifactConflictError, ScriptArtifactConflictError, VisualsArtifactConflictError, backfillStage() (+2 more)

### Community 27 - "Durable Attempt Lineage Boundary"
Cohesion: 0.05
Nodes (63): 0d87231 wip: checkpoint Sprint 129.32 stale settlement compatibility, BoundaryCarrier, createProductionDurableAttemptLineageBindingError(), durableAttemptLineageBoundary, productionDurableAttemptLineageBindingInvalidCode, ProductionDurableAttemptLineageBoundary, readProductionDurableAttemptLineageBoundary(), validateProductionExecutionDurableAttempt() (+55 more)

### Community 28 - "Acceptance Configuration Fingerprinting"
Cohesion: 0.07
Nodes (68): 3b885dc Sprint 129.24: Add controlled acceptance marker reprepare, a76335f Sprint 129.23: Harden production acceptance portability, componentFingerprint(), CONFIGURATION_COMPONENT_NAMES, CONFIGURATION_COMPONENT_NAMES_V2, createProductionAcceptancePortableConfigurationSnapshot(), createProductionAcceptancePortableConfigurationSnapshotV2(), findProductionAcceptanceConfigurationMismatches() (+60 more)

### Community 29 - "Durable Execution Claim Service"
Cohesion: 0.06
Nodes (54): AdapterBackedProductionExecutionClaimService, assessment(), buildClaim(), claimReplay(), classifyProductionExecutionClaimArtifact(), conflict(), date(), escape() (+46 more)

### Community 30 - "Video Assembly Provider"
Cohesion: 0.05
Nodes (46): ConfiguredVideoAssemblyProvider, FFmpegVideoAssemblyProvider, ConfiguredVideoAssemblyProvider, MockVideoAssemblyProvider, ConfiguredVideoAssemblyProvider, VideoAssemblyProvider, comparablePath(), FFmpegVideoAssemblyConfig (+38 more)

### Community 31 - "Audio Asset Error Evidence"
Cohesion: 0.05
Nodes (43): AudioAssetErrorMetadata, AudioAssetRootError, AudioCanonicalAdmissionConflictError, createAudioAssetErrorEvidence(), EVIDENCE_KEYS, getAudioAssetErrorEvidence(), integer(), isAudioAssetErrorEvidence() (+35 more)

### Community 32 - "Durable Execution Lease Service"
Cohesion: 0.07
Nodes (53): acquisitionConflict(), acquisitionReplay(), AdapterBackedProductionExecutionDurableLeaseService, buildLease(), date(), denied(), evaluateProductionExecutionDurableLeaseLifecycle(), evaluation() (+45 more)

### Community 33 - "Production Snapshot Builder"
Cohesion: 0.06
Nodes (56): buildProductionSnapshot(), buildProject(), known(), ProductionSnapshotBuilder, unavailable(), calculateCoverage(), createCanonicalStageOrder(), createSourceState() (+48 more)

### Community 34 - "Pipeline Job State Machine"
Cohesion: 0.07
Nodes (29): PipelineJobManager, history(), historyEvent(), readHistoryFile(), record(), run(), terminalJob(), testRenameFailurePreservesDestination() (+21 more)

### Community 35 - "Animation Asset Pipeline"
Cohesion: 0.06
Nodes (48): AnimationAssetPipeline, AnimationAssetPipelineResult, GenerateAnimationAssetsInput, IMAGE_MIME_TYPES, persistProviderUsage(), PreparedScene, prepareScenes(), requireProviderName() (+40 more)

### Community 36 - "Audio Compensation & Publication Storage"
Cohesion: 0.08
Nodes (40): AudioCompensationWorkspace, ProtectedAudioCanonicalReadIdentity, ProtectedAudioCompensationPublication, ProtectedAudioCompensationReceipt, resolveRuntimeLogicalPath(), RuntimeStorageAuthorityLease, acquireAudioProjectWriteAuthority(), attachPublicationOwnership() (+32 more)

### Community 37 - "Canonical Evidence Digest Utilities"
Cohesion: 0.08
Nodes (42): applyResult(), arrays(), artifactIdentity(), authorizationShape(), buildIndex(), canonicalJson(), cleanup(), confirmationShape() (+34 more)

### Community 38 - "Script Schema & Early Dashboard"
Cohesion: 0.04
Nodes (18): ScriptDocument, ScriptSection, 91ba270 Atölye V2 checkpoint - pipeline base + client/server separation + research API, a319525 Setup ProjectManager V2 architecture, Props, HeroProps, loadingMessages, PipelineResponse (+10 more)

### Community 39 - "Guarded Filesystem Smoke Test"
Cohesion: 0.07
Nodes (44): aecde83 feat(runtime): add guarded filesystem foundation, completeProtectedInputs(), guardedForRoot(), initializeGitFixture(), main(), publishChild(), repositoryRoot, reservationChild() (+36 more)

### Community 40 - "Legacy Acceptance Authority Store"
Cohesion: 0.09
Nodes (54): admissionConflict(), conflict(), ensureDirectory(), legacyArchiveLocator(), markLegacyReauthorizationValidated(), persistence(), publishExactNoClobber(), publishLegacyArchive() (+46 more)

### Community 41 - "Production Health Rules Engine"
Cohesion: 0.07
Nodes (40): productionHealthCoreRules, productionHealthMetricRules, categoryFromScope(), createHealthFinding(), createRule(), productionHealthThresholds, snapshotFindingToHealth(), aggregateStageOutputs() (+32 more)

### Community 42 - "Fixture Providers For Smoke Tests"
Cohesion: 0.05
Nodes (38): CanonicalSmokeRuntime, ProductionEndToEndValidationCode, AIProvider, AudioProvider, box(), corruptFile(), crc32(), DeterministicAIProvider (+30 more)

### Community 43 - "Pipeline Jobs Dashboard Panel"
Cohesion: 0.06
Nodes (46): canApplyAction(), canCancel(), canRetry(), createHistoryInsights(), createJobSummary(), createPipelineHealthInsights(), formatAttentionItems(), formatDate() (+38 more)

### Community 44 - "Acceptance Workflow Orchestrator"
Cohesion: 0.07
Nodes (37): f21fc24 Sprint 128: Harden production acceptance workflow, authenticProductionAcceptanceBlockedErrors, authenticProductionAcceptanceConfigurationChangedErrors, authenticProductionAcceptanceExecutionErrors, isThumbnailMimeType(), ProductionAcceptanceBlockedError, ProductionAcceptanceCompletionReport, ProductionAcceptanceConfigurationChangedError (+29 more)

### Community 45 - "Durable Attempt Integrity Fingerprinting"
Cohesion: 0.06
Nodes (44): classifyProductionExecutionAttemptArtifact(), defaultProductionExecutionAttemptPolicy, terminal, buildProductionExecutionAttemptBindingFingerprint(), buildProductionExecutionAttemptJournalEntryIntegrity(), buildProductionExecutionDurableAttemptIntegrity(), buildProductionExecutionOutcomeProposalFingerprint(), ap (+36 more)

### Community 46 - "Video Assembly Manager"
Cohesion: 0.08
Nodes (42): buildAudioSegments(), getProviderName(), IMAGE_MIME_TYPES, isExactMockResult(), isValidRealResult(), persistFailedAssetSafely(), RenderExistingAssetsInput, requireAudioAsset() (+34 more)

### Community 47 - "Runtime Backup Inventory Collection"
Cohesion: 0.09
Nodes (49): assertRuntimeBackupTreeMatchesManifest(), assertUniquePortablePaths(), classifyRuntimeFile(), collectGitMetadata(), collectRuntimeBackupInventory(), collectRuntimeBackupInventoryWithPolicy(), compareRecords(), compareText() (+41 more)

### Community 48 - "Runtime Storage Context & Authority"
Cohesion: 0.10
Nodes (49): acquireProjectWriteAuthority(), assertAuthorityClaimCompatible(), assertNoDualRootDivergence(), assertPathContained(), assertProjectWriteAuthority(), assertProjectWriteAuthorityLease(), assertProjectWriteAuthorityWithContext(), authorityClaim() (+41 more)

### Community 49 - "AI Provider Chat Client"
Cohesion: 0.08
Nodes (28): ChatCompletionCreateParams, ChatCompletionMessage, ChatCompletionResponse, openai, metadata, 6c1ae5a Sprint 15 - Multi AI Provider Architecture, AIProvider, AIProviderGenerateOptions (+20 more)

### Community 50 - "Production Health API Consumer"
Cohesion: 0.07
Nodes (33): GetProductionHealthOptions, ProductionHealthApiConsumerError, deriveIntelligence(), GetProductionHealthInput, ProductionHealthReport, ProductionHealthService, finding(), main() (+25 more)

### Community 51 - "Production Readiness Probe Service"
Cohesion: 0.10
Nodes (37): animationProviderCheck(), check(), comparablePath(), createProbeWorkspace(), isExecutableFile(), isInside(), mediaChecksWithoutWorkspace(), missingProbeChecks() (+29 more)

### Community 52 - "AI Provider Router & Usage"
Cohesion: 0.07
Nodes (27): AIProviderConfig, AIResponseErrorCode, defaultProvider, router, getModelName(), normalizeProviderOutput(), ObservedAIRequestInput, ObservedAIRequestResult (+19 more)

### Community 53 - "Image Provider Configuration"
Cohesion: 0.08
Nodes (32): bec4962 Sprint 113: Activate production visual asset pipeline, ConfiguredImageProvider, ImageGenerationInput, ImageProvider, getOpenAIImageProviderConfig(), getRealImageProviderConfig(), ImageProviderConfig, ImageProviderConfigurationError (+24 more)

### Community 54 - "Canonical Durable Lineage Validation"
Cohesion: 0.08
Nodes (39): assertExpected(), assertIdentity(), assertTerminalConsistency(), escapeRegularExpression(), ProductionCanonicalDurableLineage, ProductionCanonicalDurableLineageExpectedVersions, readLatestVersioned(), readProductionCanonicalTerminalDurableLineage() (+31 more)

### Community 55 - "Canonical Smoke Evidence Partitioning"
Cohesion: 0.07
Nodes (36): CanonicalEvidenceError, CanonicalEvidenceErrorCode, canonicalSmokeChildren, CanonicalSmokeChildSpec, canonicalSmokePartitions, CanonicalSmokePartitionSpec, canonicalSmokeRegistryFingerprint, childTimeoutPolicyFingerprint (+28 more)

### Community 56 - "Animation Structured Output Schema"
Cohesion: 0.09
Nodes (35): AnimationStructuredOutputValidation, CanonicalAnimationProviderPlan, canonicalAnimationProviderSchema, category(), createAnimationMotionPlanSystemPrompt(), cropFields, cropNumberSpecs, exactFields() (+27 more)

### Community 57 - "Animation Service API"
Cohesion: 0.07
Nodes (26): AnimationApiPayload, AnimationApiResponse, AnimationService, AnimationServiceBaseInput, AnimationServiceOptions, AnimationServiceResult, generateAnimationsFromAnimationData(), GenerateAnimationsFromAnimationDataInput (+18 more)

### Community 58 - "Stage-Bounded Resume Test Harness"
Cohesion: 0.10
Nodes (33): ProductionAcceptanceBoundedResumeResult, ProductionPipelineExecutionEvent, ProductionPipelineExecutionEventDetail, assertNoDownstreamDurable(), assertProductionSeam(), assertQuiescent(), boundedFailure(), boundedSuccess() (+25 more)

### Community 59 - "Real Photo Source Feature"
Cohesion: 0.09
Nodes (23): 018d91e feat(visuals): add Wikimedia Commons real photo source (Sprint 130), 2d9074c fix(visuals): real photo source quality, reliability & latency (Sprint 130.1/130.2), buildSearchQuery(), ConfiguredImageProvider, notFoundResult(), RankedCandidate, rankEligibleCandidates(), RealPhotoImageProvider (+15 more)

### Community 60 - "Acceptance Media & FFmpeg Assembly"
Cohesion: 0.09
Nodes (30): ProductionAcceptanceMediaResult, ProductionAcceptanceMediaValidationError, validateProductionAcceptanceMedia(), absoluteInput(), buildConcatManifest(), buildCopyConcatArgs(), buildFFmpegArgs(), buildFFprobeArgs() (+22 more)

### Community 61 - "Production Health API Errors"
Cohesion: 0.10
Nodes (31): isProductionHealthApiConsumerError(), createProductionHealthErrorResponse(), logProductionHealthError(), noStoreHeaders, httpStatuses, isProductionHealthError(), ProductionHealthError, ProductionHealthErrorCode (+23 more)

### Community 62 - "Canonical Evidence JSON Utilities"
Cohesion: 0.10
Nodes (32): addIntegrity(), canonicalStringify(), normalizeJson(), setCanonicalEvidenceValidationHooks(), writeImmutableJson(), authorityFor(), cleanupReadFailureInvariant(), cleanupReplacementInvariant() (+24 more)

### Community 63 - "Pipeline Job Mutation Lock"
Cohesion: 0.10
Nodes (37): activeLock, assertCanonicalPipelineJobMutationLock(), assertNestedScope(), assertOwnershipPath(), CanonicalMutationBarrierTarget, CanonicalMutationKind, canonicalProjectFolder(), delay() (+29 more)

### Community 64 - "Durable Attempt Adapter Service"
Cohesion: 0.13
Nodes (24): AdapterBackedProductionExecutionAttemptService, bindingReason(), canonicalAudioEvidence(), date(), entryEqual(), journalSequenceValid(), mapPersistence(), mapWrite() (+16 more)

### Community 65 - "Execution Recovery Bootstrap"
Cohesion: 0.09
Nodes (31): applyRecordReadFailures(), AttemptChain, classify(), classifyStores(), counts(), deriveStorePolicy(), emptyStoreCounts(), emptyStoreStates() (+23 more)

### Community 66 - "Export Package Engine"
Cohesion: 0.12
Nodes (23): ExportEngine, generateExportPackage(), GenerateExportPackageInput, defaultExportProviderConfig, ExportProviderConfig, ExportProviderRouter, ExportGenerationInput, ExportGenerationResult (+15 more)

### Community 67 - "Audio Descriptor & Publication Intent"
Cohesion: 0.15
Nodes (28): AudioDescriptorFileIdentity, AudioDescriptorVerificationError, digestBytes(), readAudioFileDescriptorBound(), readContainedAudioFileDescriptorBound(), reliableIdentity(), AudioPublicationIntent, AudioPublicationIntentConflictError (+20 more)

### Community 68 - "Production Acceptance CLI Commands"
Cohesion: 0.10
Nodes (31): commandFailure(), defaultDependencies, exactValue(), isPipelineRecoveryStageKey(), parseDiagnoseArguments(), parseExecuteArguments(), parseExtendRetryBudgetArguments(), parseLegacyReauthorizationArguments() (+23 more)

### Community 69 - "End-to-End Stabilization Test"
Cohesion: 0.13
Nodes (25): box(), CountingPublishProvider, crc32(), ExplicitFailureProvider, failureCancellationAndValidation(), happyPathAndReplay(), IndeterminateProvider, markAllCompleted() (+17 more)

### Community 70 - "Pipeline Runner Continuation"
Cohesion: 0.10
Nodes (8): canonicalErrorCode(), getRetryStageFromJobId(), isProvenContinuationContenderLoss(), parseConsumedRetryBudgetAuthorityId(), PipelineRunner, retryExecutionReasonCode(), validateStrictProductionResumeState(), validResumeBoundary()

### Community 71 - "Acceptance Reprepare Service"
Cohesion: 0.10
Nodes (23): authenticProductionAcceptanceReprepareErrors, defaultFileOperations, isAuthenticProductionAcceptanceReprepareError(), isInside(), parseJSON(), ProductionAcceptanceReprepareDependencies, ProductionAcceptanceReprepareError, ProductionAcceptanceReprepareFileOperations (+15 more)

### Community 72 - "Audio Manager Fallback Generation"
Cohesion: 0.11
Nodes (14): AudioAIConfigError, audioTokenBudget, getAudioMaxTokens(), AudioManager, isStrictAudioResponse(), nonEmptyString(), validTimestamp(), createAudioPrompt() (+6 more)

### Community 73 - "Production Intelligence Consumer"
Cohesion: 0.17
Nodes (30): actionPriorities, actionTypes, isEnum(), isOptionalString(), isRecord(), isStage(), isString(), nodeStatuses (+22 more)

### Community 74 - "Acceptance Topic Slug Normalization"
Cohesion: 0.11
Nodes (22): readProductionAcceptancePolicy(), authenticProductionAcceptanceTopicErrors, createProductionAcceptanceProjectSlug(), isAuthenticProductionAcceptanceTopicError(), normalizeProductionAcceptanceTopic(), ProductionAcceptanceTopicError, ProductionAcceptanceTopicErrorCode, productionAcceptanceTopicFingerprint() (+14 more)

### Community 75 - "Animation Motion Plan Validation"
Cohesion: 0.13
Nodes (25): mergeAnimationData(), sortAnimationScenes(), animationStatuses, hasMotionPlanFields(), isAnimationMotionPlanData(), isAnimationMotionPlanScene(), isCompatibleAnimationData(), isLegacyAnimationScene() (+17 more)

### Community 76 - "Audio Pipeline Generation"
Cohesion: 0.14
Nodes (25): addAssetOrFail(), AudioAssetGenerationError, audioFailure(), AudioPipeline, AudioPipelineResult, buildAndValidateBatch(), buildMixPrompt(), compensateUnregisteredResult() (+17 more)

### Community 77 - "Production Worker Lifecycle"
Cohesion: 0.14
Nodes (9): activeLifecycle(), ProductionWorkerLifecycle, readProductionWorkerLifecycleAuthority(), result(), runWithProductionWorkerLifecycleIdentity(), safeProjectSlug(), safeReason(), validDate() (+1 more)

### Community 78 - "Completed Stage Regeneration Test"
Cohesion: 0.14
Nodes (23): assertOwnedTempMutationTarget(), assertSupersessionPrecommitRejection(), check(), ConfiguredVideoAssemblyProvider, ConfiguredVideoProvider, Fixture, FixtureAssemblyProvider, FixtureVideoProvider (+15 more)

### Community 79 - "Visual Asset API & Pipeline"
Cohesion: 0.13
Nodes (21): filterVisualDataBySceneId(), isVisualData(), POST(), GenerateAssetsInput, NormalizedGenerationResult, normalizeGenerationResult(), normalizeImageMimeType(), normalizeNonEmptyString() (+13 more)

### Community 80 - "Early Studio Feature Commits"
Cohesion: 0.09
Nodes (17): 076e2b7 Sprint 30 Phase 2 - Project Manifest save system, 10c20ec Connect AI script generation pipeline, 40fa937 Fix project dashboard data loading, 5a68409 feat(pipeline): add full documentary generation workflow, 5d7b62d Connect scene generation pipeline to AI provider, 732ceca feat(visuals): add visual manager core with AI-backed visual data, b1c33f4 feat(studio): add project studio viewer, c17c96f feat(projects): show manifest progress on dashboard (+9 more)

### Community 81 - "Production Runtime Health Route"
Cohesion: 0.14
Nodes (23): createProductionRuntimeHealthResponse(), GET(), isLifecycleState(), jsonResponse(), productionDependencies, ProductionRuntimeHealthDependencies, projectHealthStatus(), readinessIsConsistent() (+15 more)

### Community 82 - "Durable Execution Storage Adapter"
Cohesion: 0.17
Nodes (12): AdapterBackedProductionExecutionDurableStorage, apply(), date(), escape(), key(), mapped(), message(), out() (+4 more)

### Community 83 - "Production Health API Client"
Cohesion: 0.17
Nodes (24): buildUrl(), getProductionHealth(), isApiErrorPayload(), isCounts(), isFinding(), isFiniteNumber(), isHealthResult(), isHealthStatus() (+16 more)

### Community 84 - "Pipeline Status Display Components"
Cohesion: 0.10
Nodes (16): ProjectProgressSummary, ProjectStageProgress, formatCost(), formatDateTime(), formatDuration(), formatNumber(), getDurationLabel(), getRunTypeLabel() (+8 more)

### Community 85 - "Descriptor-Bound Read Adapter"
Cohesion: 0.15
Nodes (18): assertContained(), createProductionExecutionReadDescriptor(), descriptorBindings, directories, DurableIdentityChangedError, FileIdentity, fingerprintIdentity(), nodeCode() (+10 more)

### Community 86 - "Readiness Acceptance Smoke Test"
Cohesion: 0.18
Nodes (21): find(), probeDirectories(), readinessService(), removeMarkedSmokeProject(), removeProbeRoot(), restoreAndRemoveProbeRoot(), run(), stageState() (+13 more)

### Community 87 - "Baseline Evidence Validation Utilities"
Cohesion: 0.28
Nodes (24): array(), assertNoPartials(), cleanData(), deriveAggregateResult(), equal(), expectedContract(), fail(), loadInventory() (+16 more)

### Community 88 - "Legacy Reauthorization Preflight"
Cohesion: 0.20
Nodes (23): getProductionAcceptanceLegacyPreviousRetryJob(), createLegacyReauthorizationPreflight(), ExactRead, excludeAdmittedJob(), EXCLUDED_ROOT_ENTRIES, failure(), identityEvidence(), identityOfDirectory() (+15 more)

### Community 89 - "Completed Stage Regeneration Store"
Cohesion: 0.21
Nodes (23): buildAudioPreservationFingerprint(), canonicalRegenerationJson(), collectAssetIds(), collectRegenerationPredecessorAssetEvidence(), collectRegenerationStageOutputAssetIds(), collectRegistryBindings(), isRegenerationPackageCanonical(), listRegenerationIds() (+15 more)

### Community 90 - "Publish Reconciliation Validation"
Cohesion: 0.16
Nodes (21): bindingAndStateValidation(), box(), canonicalAndReceiptPaths(), dataApiReadOnlyReconciliation(), failClosedOutcomes(), FixedReconcileProvider, main(), markAllCompleted() (+13 more)

### Community 91 - "Video Storage Path Security"
Cohesion: 0.16
Nodes (12): ContainedFile, requireContainedStorageDirectory(), requireContainedStorageFile(), inside(), readMovieDuration(), resolveRelative(), safeMp4FileName(), safeSegment() (+4 more)

### Community 92 - "Thumbnail Storage & Image Inspection"
Cohesion: 0.22
Nodes (16): crc32(), ensureSafeStorageDirectory(), extensionForMimeType(), inspectImageBuffer(), inspectJpeg(), inspectPng(), inspectWebp(), isInside() (+8 more)

### Community 93 - "Animation Motion Plan Storage"
Cohesion: 0.19
Nodes (16): finiteBetween(), isValidAnimationDuration(), isValidAnimationMotionFrame(), AnimationMotionPlanArtifact, AnimationStorage, exactFrame(), exactKeys(), requireStorageSentinel() (+8 more)

### Community 94 - "Runtime Git Tracking Inventory"
Cohesion: 0.13
Nodes (17): assertRuntimeTrackingAdmission(), collectFiles(), collectRuntimeTrackingInventory(), isAllowedIgnoredDurablePath(), relativeGitPath(), RuntimeTrackingAdmissionReport, RuntimeTrackingInventory, samePath() (+9 more)

### Community 95 - "Visuals Token Budget Config"
Cohesion: 0.15
Nodes (9): getVisualsMaxTokens(), VisualsAIConfigError, visualsTokenBudget, digest(), main(), result(), test(), visualPlan() (+1 more)

### Community 96 - "Migration Candidate Path Planning"
Cohesion: 0.16
Nodes (20): RuntimeBackupFileRecord, insideOrEqual(), isUnsupportedNetworkCandidateRoot(), pathsOverlap(), planMigrationCandidatePaths(), RuntimeMigrationCandidatePathPlan, validateMigrationCandidateId(), bindings() (+12 more)

### Community 97 - "Legacy Durable Recovery Snapshot"
Cohesion: 0.16
Nodes (20): getProductionAcceptanceLegacyAdmittedExecution(), assertAdmittedDurableBindings(), assertAdmittedDurableIdentityBindings(), assertDurableCausalBindings(), assertSemanticStoreStates(), causal(), claimMatchesAttempt(), createLegacyReauthorizationDurableRecoverySnapshot() (+12 more)

### Community 98 - "Production Execution Safety Plan"
Cohesion: 0.15
Nodes (15): firstRealExecutionCandidate, productionActionRiskProfiles, productionExecutionInvariants, productionExecutionRoadmap, productionExecutionThreats, capability(), expectedOrder, hasDependencyCycle() (+7 more)

### Community 99 - "Production Snapshot Source Reader"
Cohesion: 0.14
Nodes (17): isHistory(), isHistoryEvent(), isJob(), isJobList(), isJobStatus(), isManifest(), isProject(), isProjectStatus() (+9 more)

### Community 100 - "Completed Stage Regeneration Service"
Cohesion: 0.18
Nodes (18): applyMutation(), assertMutation(), assertPreparedReplay(), atomicReplace(), buildMutations(), createMutation(), fileHash(), Mutation (+10 more)

### Community 101 - "Execution Dispatch Eligibility"
Cohesion: 0.15
Nodes (18): buildProductionExecutionDispatchEnvelope(), date(), defaultProductionExecutionDispatchPolicy, evaluateProductionExecutionDispatchEligibility(), result(), base, envelope, main() (+10 more)

### Community 102 - "Visual Structured Output Schema"
Cohesion: 0.17
Nodes (19): CanonicalVisualPlan, canonicalVisualProviderSchema, createVisualPlanPrompt(), exactFields(), isRecord(), observedType(), parseStrictVisualPlanResponse(), searchKeywordsSpec (+11 more)

### Community 103 - "Runtime Backup Authority Bootstrap"
Cohesion: 0.23
Nodes (18): assertTrustedRuntimeBackupStorageAuthority(), authorityInvalid(), bootstrap(), bootstrapRuntimeBackupStorageAuthority(), bootstrapTestRuntimeBackupStorageAuthority(), canonicalBackupRoot(), defaultBackupRoot(), inside() (+10 more)

### Community 104 - "Pipeline Stage Continuation Executor"
Cohesion: 0.12
Nodes (9): PipelineContinuationResult, PipelineStageExecutor, requireStageInput(), requireStorageContext(), ExecutorHarness, jobList(), order, RunnerHarness (+1 more)

### Community 105 - "Canonical Smoke Validation Runner"
Cohesion: 0.18
Nodes (17): assertTerminalResult(), broad, dataProjectsGitState(), digest(), discoverRemainders(), Expected, fileHash(), h() (+9 more)

### Community 106 - "Pipeline Orchestration Test Suite"
Cohesion: 0.40
Nodes (17): job(), jobList(), jobsForStage(), readJobs(), run(), testCancellationDoesNotEnqueue(), testCompletedEnqueuesNextStage(), testConcurrentCompletionIsIdempotent() (+9 more)

### Community 107 - "Image Storage & Inspection"
Cohesion: 0.20
Nodes (13): createImageFileName(), ensureStorageDirectory(), getExtensionFromMimeType(), ImageData, ImageInspection, ImageStorage, ParsedImageData, parseImageData() (+5 more)

### Community 108 - "Evidence Root Publishing"
Cohesion: 0.25
Nodes (18): acquireLease(), aggregateEvidence(), assertExistingEvidenceRoot(), identityEqual(), normalizePath(), orchestratorFiles(), orchestrators(), prepareNewEvidenceRoot() (+10 more)

### Community 109 - "Completed Stage Regeneration Planner"
Cohesion: 0.20
Nodes (14): pipelineStageDependencies, getProductionRegenerationClosure(), createCompletedStageRegenerationPlan(), fingerprintTree(), latestGeneration(), optionalFileHash(), ProductionRegenerationPlanError, ProductionRegenerationPlanErrorCode (+6 more)

### Community 110 - "YouTube Provider Test Fixtures"
Cohesion: 0.16
Nodes (15): assetFailureTests(), draft(), DraftProvider, failWith(), generate(), input(), mutateAssets(), openAITests() (+7 more)

### Community 111 - "Portable No-Clobber File Publisher"
Cohesion: 0.28
Nodes (17): copyFileExclusiveDurable(), copyFileExclusiveReservation(), finalizeReservedFilePortableNoClobber(), HARD_LINK_UNAVAILABLE_CODES, inspectExactFile(), isHardLinkUnavailable(), matchesIdentity(), PortableNoClobberPublishInput (+9 more)

### Community 112 - "Controlled Execution Gateway"
Cohesion: 0.18
Nodes (14): evaluateProductionControlledExecutionGateway(), names, orchestration(), input, main(), policy, run(), ProductionControlledExecutionGatewayInput (+6 more)

### Community 113 - "Project Reader & Listing"
Cohesion: 0.19
Nodes (9): isNodeError(), ProjectJSONReadResult, ProjectReader, requireSafeJsonFileName(), getProgressSummary(), getStageSummary(), ProjectListItem, ProjectProgressStageSummary (+1 more)

### Community 114 - "Quarantine Mutation Verification"
Cohesion: 0.23
Nodes (15): assertDirectoryIdentity(), assertQuarantineContainer(), identityOf(), matchesQuarantinedProof(), mutationMkdir(), mutationRename(), mutationRmdir(), mutationUnlink() (+7 more)

### Community 115 - "End-to-End Validation Inspection"
Cohesion: 0.31
Nodes (14): hasHandler(), inspectAudio(), inspectImage(), inspectStructuralStreams(), inspectThumbnail(), inspectVideo(), isRecord(), ProductionEndToEndValidationError (+6 more)

### Community 116 - "Script Config & Token Budget"
Cohesion: 0.21
Nodes (8): getScriptMaxTokens(), ScriptAIConfigError, scriptTokenBudget, env(), fixtureProject(), hashTree(), main(), test()

### Community 117 - "Publish Persistence & Recovery Test"
Cohesion: 0.17
Nodes (13): CountingProvider, ExplicitFailureProvider, intent(), mutateAssets(), pass(), persistenceApiRunnerAndRecovery(), providerRequest(), realProviderFailures() (+5 more)

### Community 118 - "Acceptance Marker Descriptor Reader"
Cohesion: 0.25
Nodes (13): CanonicalProductionAcceptanceMarkerDescriptorSnapshot, DescriptorBoundFileIdentity, DescriptorBoundFileSnapshot, identity(), insideOrEqual(), normalizedFilesystemIdentity(), productionAcceptanceMarkerIdentityPolicyVersion, readCanonicalProductionAcceptanceMarkerDescriptorBound() (+5 more)

### Community 119 - "Real Photo Source Smoke Test"
Cohesion: 0.16
Nodes (5): createTrackedProvider(), fakeOpenAIProvider(), pngBytes, run(), scenario()

### Community 120 - "Assembly Manager Fallback Plan"
Cohesion: 0.24
Nodes (1): AssemblyManager

### Community 121 - "Path Race Test Harness"
Cohesion: 0.24
Nodes (12): countRaceMutationAttempts(), foreignPreservationBytes(), main(), RaceMutationCounters, replacementInventoryHash(), sha256(), sourcePath(), Target (+4 more)

### Community 122 - "Runtime Ownership Content Inventory"
Cohesion: 0.31
Nodes (13): currentHead(), dataProjectsState(), environmentEvidence(), git(), initialize(), ownershipRemainders(), registrationEvidence(), remainders() (+5 more)

### Community 123 - "Pipeline Recovery Planner"
Cohesion: 0.28
Nodes (7): createBlockedPlan(), getBlockedReason(), getDependencyStatuses(), getNextIncompleteOrUnreadyStage(), getStagesFrom(), isStageFileReady(), readStageData()

### Community 124 - "Pipeline Auto-Continuation Test"
Cohesion: 0.22
Nodes (12): historyFile, job(), jobList(), jobsFile, jobsForStage(), main(), PipelineExecutorHarness, PipelineRunnerHarness (+4 more)

### Community 125 - "Runtime Hardening Smoke Test"
Cohesion: 0.19
Nodes (6): main(), markerPath, repositoryRoot, runtimeDiff(), scenario(), sha256()

### Community 126 - "Production Health Rules Test"
Cohesion: 0.35
Nodes (11): productionHealthRules, clone(), coverage(), hasCode(), known(), main(), notRecorded(), setUsage() (+3 more)

### Community 127 - "Retry Admission & Budget Sprints"
Cohesion: 0.33
Nodes (11): Production Acceptance Execution Gate, Sprint 129.32 - Exact job.attempts Invariant for Failed Retry Durable Attempt Selection, Sprint 129.33 - Exhausted Retry Admission / Final TOCTOU Remediation, Sprint 129.35 - Legacy Terminal Lineage Global-Quiescence Compatibility Remediation, Sprint 129.36 - Explicit One-Time Retry Budget Extension Authority, Sprint 129.37 - Assembly AI Token Budget and Truncation Remediation, Sprint 129.38 - Retry-Budget Settled-Receipt Cross-Stage Replay Remediation, Sprint 129.39 - Canonical Stage-Bounded Production Resume (+3 more)

### Community 128 - "Thumbnail Engine & Package Route"
Cohesion: 0.27
Nodes (7): generateThumbnailPlan(), ThumbnailEngine, isAssemblyPlanData(), isAudioData(), loadProjectThumbnailSources(), normalizeSlug(), POST()

### Community 129 - "Asset Manager Atomic Writes"
Cohesion: 0.42
Nodes (1): AssetManager

### Community 130 - "Audio Service API"
Cohesion: 0.24
Nodes (7): AudioApiResponse, AudioService, AudioServiceOptions, AudioServiceResult, GenerateAudioInput, isAssets(), isAudioData()

### Community 131 - "Regeneration Physical Path Guard"
Cohesion: 0.53
Nodes (9): assertPhysicalTarget(), assertProductionRegenerationPhysicalProject(), comparable(), exactDirectory(), isContained(), nearestExisting(), ProductionRegenerationPhysicalIdentity, reassertProductionRegenerationPhysicalProject() (+1 more)

### Community 132 - "Durable Execution Foundation Sprints"
Cohesion: 0.20
Nodes (10): Sprint 100 - Durable Lease & Worker Ownership Foundation, Sprint 101 - Durable Execution Claim & Recovery Coordination, Sprint 54 - Pipeline Retry & Resume Planning Foundation, Sprint 64 - Pipeline Queue / Job Management Foundation, Sprint 66 - Pipeline Queue Scheduler, Sprint 77 - Pipeline Execution History Foundation, Sprint 83 - Pipeline Job State Consistency, Sprint 93 - Pipeline Orchestration Foundation (+2 more)

### Community 133 - "Durable Worker Integration Sprints"
Cohesion: 0.20
Nodes (10): Sprint 102 - Durable Execution Attempt & Outcome Journal Foundation, Sprint 103 - Production Execution Coordinator Foundation, Sprint 104 - Durable Attempt Lifecycle Foundation, Sprint 105 - Durable Worker Execution Foundation, Sprint 106 - Pipeline Stage Durable Execution Integration, Sprint 107 - Durable Pipeline Composition Root Wiring, Sprint 108 - Durable Recovery Bootstrap Integration, Sprint 109 - Process Startup Bootstrap Integration (+2 more)

### Community 134 - "Production Stage Activation Sprints"
Cohesion: 0.27
Nodes (10): Sprint 113 - Production Visual Asset Pipeline Activation, Sprint 114 - Production Narration Audio Pipeline Activation, Sprint 115 - Production Video Assembly Activation, Sprint 116 - Animation Motion Plan Production Contract, Sprint 117 - Production Scene Video Rendering Activation, Sprint 42 - Video Engine Foundation, Sprint 43 - Audio Engine Foundation, Sprint 44 - Assembly Engine Foundation (+2 more)

### Community 135 - "Race Worker Test Fixture"
Cohesion: 0.22
Nodes (9): args, authorityId, emitResult(), jobId, projectSlug, run(), runtimeRoot, stage (+1 more)

### Community 136 - "Owned Runtime Directory Session"
Cohesion: 0.20
Nodes (1): OwnedRuntimeDirectory

### Community 137 - "Asset Serving Route Security"
Cohesion: 0.36
Nodes (8): GET(), getContentType(), isInsideDirectory(), isSafeFileName(), isSafePathSegment(), isSafeWavFileName(), ROOT_DIR, RouteContext

### Community 138 - "Pipeline Job Lock Test"
Cohesion: 0.31
Nodes (8): assertOwnershipLoss(), main(), waitFor(), installCanonicalStaleObservationTestHook(), processIsAlive(), readCanonicalProcessStartEpochMs(), readOsProcessStartEpochMs(), sameLiveProcess()

### Community 139 - "YouTube Publish Provider Reconciliation"
Cohesion: 0.22
Nodes (3): ConfiguredYouTubePublishProvider, MockYouTubePublishProvider, reconciliationFailure()

### Community 140 - "Health API Consumer Test"
Cohesion: 0.44
Nodes (8): abortablePendingFetch(), assertConsumerError(), cloneReport(), createJsonFetch(), jsonResponse(), main(), rejectingFetch(), responseFetch()

### Community 141 - "OpenAI Streaming WAV Validation"
Cohesion: 0.33
Nodes (5): finiteChunk(), finiteWav(), formatBytes(), sentinelChunkedWav(), sentinelWav()

### Community 142 - "File Storage Core Operations"
Cohesion: 0.33
Nodes (3): FileStorage, resolvePath(), withWriteAuthority()

### Community 143 - "AI Usage Manager"
Cohesion: 0.46
Nodes (1): AIUsageManager

### Community 144 - "Retry & Bookkeeping Sprint Series"
Cohesion: 0.25
Nodes (8): Sprint 129.38 Retry-Budget Settled-Receipt Cross-Stage Replay Remediation, Sprint 129.39 Canonical Stage-Bounded Production Resume, Sprint 129.40 Production Scene-Video Full-Frame Framing Remediation, Sprint 129.41 Canonical Completed-Stage Regeneration, Sprint 129.42 Completed-Stage Regeneration Smoke Realignment, Sprint 129.43 Fatih Documentary Live Audio & Assembly Production Run, Sprint 129.44 Production Visual Asset Wiring Runtime Context Enforcement, Sprint 129.45 Fatih Manifest/Job/Project Bookkeeping Backfill

### Community 145 - "Project Writer JSON Operations"
Cohesion: 0.50
Nodes (2): ProjectWriter, requireSafeJsonFileName()

### Community 146 - "Runtime Storage Hardening Sprints"
Cohesion: 0.25
Nodes (8): Sprint 129.25B - Runtime Root Abstraction & Tracking Policy Foundation, Sprint 129.25B.1 - Targeted Runtime Storage Hardening, Sprint 129.25 C.1 - Verified Runtime Backup Foundation, Sprint 129.25 C.2A - Guarded Filesystem Foundation, Sprint 129.25 C.2B.1 - Migration Candidate Schema, Preflight & Verifier, Sprint 129.25 C.2B.2 - Verified Migration Candidate Creation, Sprint 129.25 C.2B.3 - Production Storage Relocation Audit, Sprint 129.25 C.2B.4 - Operation-Scoped Runtime Context Propagation

### Community 147 - "Visuals & Animation Hardening Sprints"
Cohesion: 0.29
Nodes (8): Sprint 129 - Production Environment Binding and Readiness-Only Machine Validation, Sprint 129.19 - Visuals Structured Output and Application-Owned Timestamp Hardening, Sprint 129.20 - Visuals Truncation Propagation & Stage Token Budget, Sprint 129.21 - Animation Failure Propagation & Diagnostic Hardening, Sprint 129.22 - Animation Structured Output Diagnosis and Hardening, Sprint 129.5 - Production Acceptance Topic Input Contract, Sprint 129.7 - Research Structured Output Reliability Hardening, Sprint 129.9 - Failed-Stage Resume Reconciliation Hardening

### Community 148 - "Persistence Fault Adapter Test"
Cohesion: 0.36
Nodes (3): OneShotPersistenceFaultAdapter, persistenceVersion(), ProductionExecutionPersistenceAdapter

### Community 149 - "Legacy Scene Step Migration"
Cohesion: 0.32
Nodes (7): estimateDuration(), includesAny(), LegacySceneData, LegacyScenesFile, LegacyScriptData, LegacyScriptSection, sceneStep()

### Community 150 - "JSON Field Extraction Helpers"
Cohesion: 0.29
Nodes (2): getCreatedAt(), getString()

### Community 151 - "Real Photo Source Roadmap"
Cohesion: 0.29
Nodes (7): ADR-019: Single 'real' Image Provider with Source Router, RealPhotoImageProvider, Sprint 130 - Wikimedia Commons Real Photo Source for Visuals, Sprint 130.1 - Real Photo Source Quality & Reliability Follow-up, Sprint 130.2 - Real Photo Source Download Reliability & Latency Budget, Sprint 131+ - Additional Real Photo Sources (Planned), WikimediaCommonsClient

### Community 152 - "YouTube & Assembly Activation Sprints"
Cohesion: 0.29
Nodes (7): Sprint 118 - Assembly Scene-Video Consumption, Sprint 119 - Pipeline Retry Continuation Hardening, Sprint 120 - Production Thumbnail Pipeline Activation, Sprint 121 - Production YouTube Package Pipeline Activation, Sprint 122 - Production YouTube Publish Pipeline Foundation, Sprint 123 - Production End-to-End Stabilization, Sprint 124 - Production Publish Reconciliation Hardening

### Community 153 - "Acceptance & Animation Activation Sprints"
Cohesion: 0.29
Nodes (7): Sprint 125 - Production End-to-End Validation, Sprint 126 - Real Production Acceptance Run Preparation, Sprint 127 - Production Animation Provider Activation, Sprint 128.1 - Production Acceptance P0 Closure and Operator Entrypoint, Sprint 128.2 - Production Acceptance P1 Hardening, Sprint 129.24 - Existing Acceptance Marker Portability, Sprint 41 - Animation Scene-Level Regeneration

### Community 154 - "Smoke Harness Inventory"
Cohesion: 0.29
Nodes (4): files, root, rows, SmokeInventoryRow

### Community 155 - "Regeneration Binding Type Definitions"
Cohesion: 0.33
Nodes (6): ProductionRegenerationBinding, ProductionRegenerationFileFingerprint, ProductionRegenerationIntent, ProductionRegenerationPlan, ProductionRegenerationPreparedReceipt, productionRegenerationSchemaVersion

### Community 156 - "Visual Engine Prompt Generation"
Cohesion: 0.29
Nodes (4): SceneInput, VisualEngine, VisualPrompt, VisualStyle

### Community 158 - "Visual Manager Data Persistence"
Cohesion: 0.73
Nodes (1): VisualManager

### Community 159 - "SEO Manager Generation"
Cohesion: 0.80
Nodes (1): SEOManager

### Community 160 - "Thumbnail Manager Generation"
Cohesion: 0.60
Nodes (1): ThumbnailManager

### Community 161 - "Regeneration Path Resolution"
Cohesion: 0.60
Nodes (4): regenerationDirectory(), regenerationProjectFolder(), regenerationRoot(), regenerationRootName

### Community 162 - "Animation Prompt Fallback Generator"
Cohesion: 0.70
Nodes (1): AnimationPromptGenerator

### Community 163 - "Audio & Retry Sprint Series"
Cohesion: 0.40
Nodes (5): Runtime Backup Long-Path, V3 Runtime Authority & Trusted Backup Root, Sprint 129.27 - Audio Atomicity, Compensation & Publication Hardening, Sprint 129.28 - Production Acceptance Reauthorization and Durable Identity Authority Hardening, Sprint 129.29 - Failed-Terminal Settlement Remediation, Sprint 129.30 - Failed-Terminal Evidence and Retry Boundary Hardening

### Community 164 - "Video Assembly Child Process Mock"
Cohesion: 0.40
Nodes (3): EventEmitter, FakeChild, VideoAssemblyChildProcess

### Community 165 - "AI JSON Response Parsing"
Cohesion: 0.83
Nodes (3): extractJson(), parseAIJsonResponse(), safeJsonParse()

### Community 166 - "Architecture & Roadmap Docs"
Cohesion: 1.00
Nodes (2): docs/Architecture.md, docs/Roadmap.md

### Community 167 - "ESLint Configuration"
Cohesion: 1.00
Nodes (1): eslintConfig

### Community 168 - "Production Execution Safety Docs"
Cohesion: 1.00
Nodes (2): docs/PRODUCTION_EXECUTION_SAFETY.md, docs/PRODUCTION_EXECUTION_PHASE_REVIEW.md

### Community 169 - "PostCSS Configuration"
Cohesion: 1.00
Nodes (1): config

### Community 171 - "Ottoman Supply Depot Image"
Cohesion: 1.00
Nodes (1): Ottoman Supply Depot and Chain Hauling at the Shore

### Community 172 - "Ottoman Military Preparation Image"
Cohesion: 1.00
Nodes (1): Ottoman Military Preparation Montage

### Community 173 - "Fetih Haritasını İnceleme"
Cohesion: 1.00
Nodes (1): Fatih Sultan Mehmet Fetih Haritasını İnceliyor

### Community 174 - "Architecture Decision Records"
Cohesion: 1.00
Nodes (1): ARCHITECTURE_DECISIONS.md (ADR Log)

### Community 176 - "Ottoman War Council Image"
Cohesion: 1.00
Nodes (1): Ottoman War Council Planning Meeting

### Community 177 - "Top Dökümü ve Kuşatma Kulesi"
Cohesion: 1.00
Nodes (1): Top Dökümü ve Kuşatma Kulesi İnşası Görseli

### Community 179 - "Coding Standards Reference"
Cohesion: 1.00
Nodes (1): docs/CodingStandards.md

### Community 181 - "Architecture Decision Log"
Cohesion: 1.00
Nodes (1): docs/Decisions.md

### Community 183 - "Ottoman Siege March Image"
Cohesion: 1.00
Nodes (1): Ottoman Army Marching Toward City Walls

### Community 184 - "File Icon Boilerplate"
Cohesion: 1.00
Nodes (1): File Icon (Next.js boilerplate)

### Community 185 - "Globe Icon Boilerplate"
Cohesion: 1.00
Nodes (1): Globe Icon (Next.js Boilerplate)

### Community 186 - "Next.js Logo Icon"
Cohesion: 1.00
Nodes (1): Next.js Logo Icon (Boilerplate)

### Community 192 - "Sprint 14 Planning Doc"
Cohesion: 1.00
Nodes (1): docs/Sprint-14.md

### Community 194 - "Storage Relocation Audit Doc"
Cohesion: 1.00
Nodes (1): docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md

### Community 196 - "Vercel Logo Icon"
Cohesion: 1.00
Nodes (1): Vercel Logo Icon (Next.js Boilerplate)

### Community 197 - "Window Icon Boilerplate"
Cohesion: 1.00
Nodes (1): Window Icon (Next.js Boilerplate)

## Knowledge Gaps
- **961 isolated node(s):** `RouteContext`, `ROOT_DIR`, `RouteContext`, `RouteContext`, `RouteContext` (+956 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Assembly Manager Fallback Plan`** (1 nodes): `AssemblyManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Asset Manager Atomic Writes`** (1 nodes): `AssetManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Owned Runtime Directory Session`** (1 nodes): `OwnedRuntimeDirectory`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `AI Usage Manager`** (1 nodes): `AIUsageManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Project Writer JSON Operations`** (2 nodes): `ProjectWriter`, `requireSafeJsonFileName()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `JSON Field Extraction Helpers`** (2 nodes): `getCreatedAt()`, `getString()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Visual Manager Data Persistence`** (1 nodes): `VisualManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SEO Manager Generation`** (1 nodes): `SEOManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Thumbnail Manager Generation`** (1 nodes): `ThumbnailManager`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Animation Prompt Fallback Generator`** (1 nodes): `AnimationPromptGenerator`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Architecture & Roadmap Docs`** (2 nodes): `docs/Architecture.md`, `docs/Roadmap.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `ESLint Configuration`** (1 nodes): `eslintConfig`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Production Execution Safety Docs`** (2 nodes): `docs/PRODUCTION_EXECUTION_SAFETY.md`, `docs/PRODUCTION_EXECUTION_PHASE_REVIEW.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `PostCSS Configuration`** (1 nodes): `config`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Ottoman Supply Depot Image`** (1 nodes): `Ottoman Supply Depot and Chain Hauling at the Shore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Ottoman Military Preparation Image`** (1 nodes): `Ottoman Military Preparation Montage`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Fetih Haritasını İnceleme`** (1 nodes): `Fatih Sultan Mehmet Fetih Haritasını İnceliyor`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Architecture Decision Records`** (1 nodes): `ARCHITECTURE_DECISIONS.md (ADR Log)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Ottoman War Council Image`** (1 nodes): `Ottoman War Council Planning Meeting`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Top Dökümü ve Kuşatma Kulesi`** (1 nodes): `Top Dökümü ve Kuşatma Kulesi İnşası Görseli`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Coding Standards Reference`** (1 nodes): `docs/CodingStandards.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Architecture Decision Log`** (1 nodes): `docs/Decisions.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Ottoman Siege March Image`** (1 nodes): `Ottoman Army Marching Toward City Walls`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `File Icon Boilerplate`** (1 nodes): `File Icon (Next.js boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Globe Icon Boilerplate`** (1 nodes): `Globe Icon (Next.js Boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Next.js Logo Icon`** (1 nodes): `Next.js Logo Icon (Boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Sprint 14 Planning Doc`** (1 nodes): `docs/Sprint-14.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Storage Relocation Audit Doc`** (1 nodes): `docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vercel Logo Icon`** (1 nodes): `Vercel Logo Icon (Next.js Boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Window Icon Boilerplate`** (1 nodes): `Window Icon (Next.js Boilerplate)`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ProjectManager` connect `Project Manifest API Route` to `AI Provider Router & Usage`, `Animation Motion Plan Validation`, `Generation Policy & Visual Prompts`, `Early Engine Foundation Commits`, `YouTube Package Pipeline Route`, `Retry Hardening Commit History`, `Pipeline Recovery Planner`, `Stage Execution & Acceptance Scope`, `Acceptance Workflow Orchestrator`, `Acceptance Topic Slug Normalization`, `End-to-End Validation Inspection`, `Production Retry & Persistence Fixes`, `Asset & YouTube Publish Sprints`, `Early Studio Feature Commits`, `Animation Provider Configuration`, `Canonical Smoke Runtime Harness`, `Pipeline Auto-Continuation Test`, `Pipeline Stage Continuation Executor`, `Audio Provider Configuration`, `Fixture Providers For Smoke Tests`, `End-to-End Stabilization Test`, `Readiness Acceptance Smoke Test`, `FFmpeg Scene Video Rendering`, `Mock Thumbnail Provider`, `Video Assembly Provider`, `AI Manager Core Orchestration`, `Script Config & Token Budget`, `Animation Asset Pipeline`, `Audio Asset Error Evidence`, `Stage-Bounded Resume Test Harness`, `Completed Stage Regeneration Test`, `Thumbnail Engine & Package Route`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `ProductionStepKey` connect `Production Retry & Persistence Fixes` to `AI Provider Router & Usage`, `Early Studio Feature Commits`, `Retry Hardening Commit History`, `Historical Audio Ordinal Preflight`, `Stage Execution & Acceptance Scope`, `Production Acceptance CLI Commands`, `Acceptance Configuration Fingerprinting`, `Completed Stage Regeneration Store`, `Production Action Recommendation Engine`, `Canonical Durable Lineage Validation`, `End-to-End Validation Inspection`, `Production Health Rules Engine`, `Production Intelligence Consumer`, `Production Execution Authorization`, `Production Snapshot Builder`, `Production Snapshot Source Reader`, `Early Engine Foundation Commits`, `Project Reader & Listing`, `Project Manifest API Route`, `Animation Provider Configuration`, `Pipeline Auto-Continuation Test`, `Pipeline Orchestration Test Suite`, `Pipeline Stage Continuation Executor`, `Audio Provider Configuration`, `End-to-End Stabilization Test`, `Production Health Rules Test`, `Production Health API Errors`, `Asset & YouTube Publish Sprints`, `FFmpeg Scene Video Rendering`, `Canonical Smoke Runtime Harness`, `Video Assembly Provider`, `Execution Persistence & Journal`, `Stage-Bounded Resume Test Harness`, `Pipeline Status Display Components`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `RuntimeStorageContext` connect `Runtime Storage Context & Authority` to `Animation Motion Plan Storage`, `Audio Compensation Store`, `Audio Descriptor & Publication Intent`, `Runtime Backup Authority Bootstrap`, `Runtime Backup Inventory Collection`, `Canonical Smoke Runtime Harness`, `Migration Candidate Path Planning`, `Runtime Backup Manifest Versioning`, `Stage Execution & Acceptance Scope`, `Legacy Reauthorization Preflight`, `Acceptance Reprepare Service`, `Regeneration Path Resolution`, `Completed Stage Regeneration Planner`, `Completed Stage Regeneration Service`, `Completed Stage Regeneration Store`, `Production Retry & Persistence Fixes`, `Historical Audio Ordinal Preflight`, `Production Readiness Probe Service`, `Regeneration Physical Path Guard`, `Early Engine Foundation Commits`, `FFmpeg Scene Video Rendering`, `Acceptance Media & FFmpeg Assembly`, `Pipeline Runner Canonical Lock`, `Animation Provider Configuration`, `Audio Asset Error Evidence`, `Guarded Filesystem Backup Atomics`, `Guarded Filesystem Smoke Test`, `Audio Compensation & Publication Storage`, `Image Storage & Inspection`, `Video Storage Path Security`, `Thumbnail Storage & Image Inspection`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `RouteContext`, `ROOT_DIR`, `RouteContext` to the rest of the system?**
  _961 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Early Feature Commit History` be split into smaller, more focused modules?**
  _Cohesion score 0.07783018867924528 - nodes in this community are weakly interconnected._
- **Should `Historical Audio Ordinal Preflight` be split into smaller, more focused modules?**
  _Cohesion score 0.03323534215253961 - nodes in this community are weakly interconnected._
- **Should `Production Retry & Persistence Fixes` be split into smaller, more focused modules?**
  _Cohesion score 0.02730281301709873 - nodes in this community are weakly interconnected._