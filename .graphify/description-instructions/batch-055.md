# Node Description Batch 56 of 166

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

- "production_productionpipelineretrybudgetextensionschema_validateextensionreceiptintegrity": "validateExtensionReceiptIntegrity()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionSchema.ts:L193 | neighbors=[ProductionPipelineRetryBudgetExtensionS…, ProductionPipelineRetryBudgetExtensionS…, smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-38-cross-stage-settled…]
- "production_productionpipelineretrybudgetextensionservice_applyretrybudgetextension": "applyRetryBudgetExtension()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionService.ts:L356 | neighbors=[ProductionAcceptanceCommand.ts, ProductionPipelineRetryBudgetExtensionS…, smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-38-cross-stage-settled…]
- "production_productionpipelineretrybudgetextensionservice_planretrybudgetextension": "planRetryBudgetExtension()" | kind=code-symbol | source=src/lib/production/ProductionPipelineRetryBudgetExtensionService.ts:L97 | neighbors=[ProductionAcceptanceCommand.ts, ProductionPipelineRetryBudgetExtensionS…, smoke-sprint-129-36-retry-budget-extens…, smoke-sprint-129-38-cross-stage-settled…]
- "production_productionpipelineterminalsettlement_failedattemptevidence": "failedAttemptEvidence()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L577 | neighbors=[ProductionPipelineTerminalSettlement.ts, boundedIdentifier(), boundedOperation(), settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_readandverifyfailedchain": "readAndVerifyFailedChain()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L616 | neighbors=[ProductionPipelineTerminalSettlement.ts, readFailedSettlementAuthorityInventory(), verifyRetryBudgetExtensionSiblingBindin…, settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_readfailedsettlementauthorityinventory": "readFailedSettlementAuthorityInventory()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L885 | neighbors=[ProductionPipelineTerminalSettlement.ts, readAndVerifyFailedChain(), authorityInventoryFailure(), readLatestVersionedAuthorities()]
- "production_productionreadinessservice_createprobeworkspace": "createProbeWorkspace()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L402 | neighbors=[ProductionReadinessService.ts, comparablePath(), removeSafeProbeRoot(), .evaluate()]
- "production_productionreadinessservice_mediacheckswithoutworkspace": "mediaChecksWithoutWorkspace()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L590 | neighbors=[ProductionReadinessService.ts, check(), normalize(), .evaluate()]
- "production_productionreadinessservice_productionreadinessservice_apikeycheck": ".apiKeyCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L182 | neighbors=[ProductionReadinessService, check(), readValue(), .evaluate()]
- "production_productionreadinessservice_productionreadinessservice_providerselectioncheck": ".providerSelectionCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L264 | neighbors=[ProductionReadinessService, .evaluate(), check(), normalize()]
- "production_productionreadinessservice_providercheck": "providerCheck()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L611 | neighbors=[ProductionReadinessService.ts, .providerChecks(), check(), normalize()]
- "production_productionreadinessservice_removesafeproberoot": "removeSafeProbeRoot()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L554 | neighbors=[ProductionReadinessService.ts, createProbeWorkspace(), removeProbeWorkspace(), requireSafeProbeRoot()]
- "production_productionreadinessservice_requiresafeproberoot": "requireSafeProbeRoot()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L562 | neighbors=[ProductionReadinessService.ts, removeSafeProbeRoot(), comparablePath(), isInside()]
- "production_productionreadinessservice_resolveffmpegconfig": "resolveFFmpegConfig()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L731 | neighbors=[ProductionReadinessService.ts, .probeMedia(), normalize(), readValue()]
- "production_productionruntimeinitializer_productionruntimeinitializationerror": "ProductionRuntimeInitializationError" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L74 | neighbors=[ProductionRuntimeInitializer.ts, .constructor(), ProductionRuntimeCompositionRoot.ts, smoke-production-runtime-startup.ts]
- "production_productionsnapshotbuilder_buildproductionsnapshot": "buildProductionSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L34 | neighbors=[ProductionSnapshotBuilder.ts, buildProject(), .build(), smoke-production-snapshot-builder.ts]
- "production_productionsnapshotbuilder_buildproject": "buildProject()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L71 | neighbors=[ProductionSnapshotBuilder.ts, buildProductionSnapshot(), known(), unavailable()]
- "production_productionsnapshotbuilder_productionsnapshotbuilder": "ProductionSnapshotBuilder" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L24 | neighbors=[ProductionHealthService.ts, ProductionSnapshotBuilder.ts, .build(), smoke-production-snapshot-builder.ts]
- "production_productionsnapshotparts_buildpipeline": "buildPipeline()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L273 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, notRecorded(), stageFromBlockedReason()]
- "production_productionsnapshotparts_buildqueue": "buildQueue()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L110 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, known(), unavailableForSource()]
- "production_productionsnapshotparts_buildstagehistory": "buildStageHistory()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L374 | neighbors=[ProductionSnapshotParts.ts, known(), notRecorded(), sortNewest()]
- "production_productionsnapshotparts_notrecorded": "notRecorded()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L505 | neighbors=[ProductionSnapshotParts.ts, buildPipeline(), buildStageHistory(), stageFromBlockedReason()]
- "production_productionsnapshotparts_sortnewest": "sortNewest()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L509 | neighbors=[ProductionSnapshotParts.ts, buildHistory(), buildStageHistory(), buildUsage()]
- "production_productionsnapshotparts_stagefromblockedreason": "stageFromBlockedReason()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L433 | neighbors=[ProductionSnapshotParts.ts, buildPipeline(), known(), notRecorded()]
- "production_productionsnapshotsourcereader_isproject": "isProject()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L150 | neighbors=[ProductionSnapshotSourceReader.ts, isManifest(), isProjectStatus(), isRecord()]
- "production_productionsnapshotsourcereader_productionsnapshotsourcebundle": "ProductionSnapshotSourceBundle" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L38 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts, smoke-production-snapshot-builder.ts]
- "production_productionsnapshotsourcereader_productionsnapshotsourcereader": "ProductionSnapshotSourceReader" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L51 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotSourceReader.ts, .read(), .readSources()]
- "production_productionworkerlifecycle_activelifecycle": "activeLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L299 | neighbors=[ProductionWorkerLifecycle.ts, .authoritySnapshot(), readProductionWorkerLifecycleAuthority(), runWithProductionWorkerLifecycleIdentit…]
- "production_productionworkerlifecycle_productionworkerlifecycle_begininitialization": ".beginInitialization()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L81 | neighbors=[ProductionWorkerLifecycle, .statusSnapshot(), .transitionTo(), validDate()]
- "production_productionworkerlifecycle_readproductionworkerlifecycleauthority": "readProductionWorkerLifecycleAuthority()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L304 | neighbors=[ProductionAcceptancePolicy.ts, ProductionWorkerLifecycle.ts, activeLifecycle(), .authoritySnapshot()]
- "projects_projectmanager_projectmanager_createbasemanifest": ".createBaseManifest()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L570 | neighbors=[ProjectManager, .getProductionStepKeys(), .createManifest(), .syncManifestFromFiles()]
- "projects_projectmanager_projectmanager_getproductionstepkeys": ".getProductionStepKeys()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L868 | neighbors=[ProjectManager, .createBaseManifest(), .normalizePackages(), .syncManifestFromFiles()]
- "projects_projectmanager_projectmanager_getproject": ".getProject()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L488 | neighbors=[ProjectManager, .getManifest(), .syncManifestFromFiles(), .updateStatus()]
- "projects_projectmanager_projectmanager_normalizeattemptmetadata": ".normalizeAttemptMetadata()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L766 | neighbors=[ProjectManager, .getOptionalNumber(), .isRecord(), .normalizeRunType()]
- "projects_projectmanager_projectmanager_normalizemanifest": ".normalizeManifest()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L609 | neighbors=[ProjectManager, .getManifest(), .isRecord(), .normalizePackages()]
- "projects_projectmanager_projectmanager_normalizepackages": ".normalizePackages()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L632 | neighbors=[ProjectManager, .normalizeManifest(), .getProductionStepKeys(), .isRecord()]
- "projects_projectmanager_scenesartifactconflicterror": "ScenesArtifactConflictError" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L38 | neighbors=[ProjectManager.ts, .saveScenes(), .constructor(), smoke-sprint-129-17-scenes-structured-o…]
- "projects_projectmanager_scriptartifactconflicterror": "ScriptArtifactConflictError" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L28 | neighbors=[ProjectManager.ts, .saveScript(), .constructor(), smoke-sprint-129-15-script-timestamp.ts]
- "projects_projectmanager_visualsartifactconflicterror": "VisualsArtifactConflictError" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L48 | neighbors=[ProjectManager.ts, .persistVisualsArtifact(), .constructor(), smoke-sprint-129-19-visuals-structured-…]
- "projects_projectprogress_getcompletedstagesfrommanifest": "getCompletedStagesFromManifest()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L273 | neighbors=[projectProgress.ts, createManifestProjectProgress(), getCompletedStages(), getCompletionPercentage()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-055.json

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
