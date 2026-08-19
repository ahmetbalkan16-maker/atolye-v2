# Node Description Batch 73 of 166

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

- "production_productionreadinessservice_validateproductionreadinesschecks": "validateProductionReadinessChecks()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L674 | neighbors=[ProductionReadinessService.ts, .evaluate(), smoke-production-readiness-acceptance.ts]
- "production_productionregenerationphysicalguard_comparable": "comparable()" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L108 | neighbors=[ProductionRegenerationPhysicalGuard.ts, isContained(), samePath()]
- "production_productionsnapshotcontract_calculatecoverage": "calculateCoverage()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L77 | neighbors=[ProductionSnapshotContract.ts, ProductionSnapshotParts.ts, smoke-production-snapshot-contract.ts]
- "production_productionsnapshotcontract_resolveeffectivestagestatus": "resolveEffectiveStageStatus()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L18 | neighbors=[ProductionSnapshotContract.ts, ProductionSnapshotParts.ts, smoke-production-snapshot-contract.ts]
- "production_productionsnapshotcontract_resolveprojectcompletionconsistency": "resolveProjectCompletionConsistency()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L53 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotContract.ts, smoke-production-snapshot-contract.ts]
- "production_productionsnapshotparts_dependencyreadiness": "dependencyReadiness()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L407 | neighbors=[ProductionSnapshotParts.ts, known(), unavailableForSource()]
- "production_productionsnapshotparts_finding": "finding()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L461 | neighbors=[ProductionSnapshotParts.ts, collectFindings(), sourceFinding()]
- "production_productionsnapshotparts_outputreadiness": "outputReadiness()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L422 | neighbors=[ProductionSnapshotParts.ts, known(), unavailableForSource()]
- "production_productionsnapshotparts_sourcefinding": "sourceFinding()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L456 | neighbors=[ProductionSnapshotParts.ts, collectFindings(), finding()]
- "production_productionsnapshotsourcereader_isjob": "isJob()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L198 | neighbors=[ProductionSnapshotSourceReader.ts, isJobStatus(), isRecord()]
- "production_productionsnapshotsourcereader_ismanifest": "isManifest()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L162 | neighbors=[ProductionSnapshotSourceReader.ts, isProject(), isRecord()]
- "production_productionworkerlifecycle_productionworkerlifecycle_authoritysnapshot": ".authoritySnapshot()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L177 | neighbors=[ProductionWorkerLifecycle, activeLifecycle(), readProductionWorkerLifecycleAuthority()]
- "production_productionworkerlifecycle_productionworkerlifecycle_executeaccepted": ".executeAccepted()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L153 | neighbors=[ProductionWorkerLifecycle, .execute(), ProductionWorkerLifecycleExecutionRejec…]
- "production_productionworkerlifecycle_productionworkerlifecycle_executewithruntimeoperationcontext": ".executeWithRuntimeOperationContext()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L135 | neighbors=[ProductionWorkerLifecycle, bindActiveLifecycle(), unbindActiveLifecycle()]
- "production_productionworkerlifecycle_productionworkerlifecycle_readtimestamp": ".readTimestamp()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L245 | neighbors=[ProductionWorkerLifecycle, validDate(), .transitionTo()]
- "production_productionworkerlifecycle_productionworkerlifecycle_statussnapshot": ".statusSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L63 | neighbors=[ProductionWorkerLifecycle, .beginInitialization(), .initializationFailureSnapshot()]
- "production_productionworkerlifecycle_validdate": "validDate()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L334 | neighbors=[ProductionWorkerLifecycle.ts, .beginInitialization(), .readTimestamp()]
- "projects_projectmanager_projectmanager_createmanifest": ".createManifest()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L108 | neighbors=[ProjectManager, .createBaseManifest(), .createProject()]
- "projects_projectmanager_projectmanager_createproject": ".createProject()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L88 | neighbors=[ProjectManager, .createManifest(), .createSlug()]
- "projects_projectmanager_projectmanager_getoptionalnumber": ".getOptionalNumber()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L760 | neighbors=[ProjectManager, .normalizeAttemptMetadata(), .normalizePackageUsage()]
- "projects_projectmanager_projectmanager_getprojectfrommanifest": ".getProjectFromManifest()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L838 | neighbors=[ProjectManager, .getManifest(), .isRecord()]
- "projects_projectmanager_projectmanager_normalizepackageusage": ".normalizePackageUsage()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L728 | neighbors=[ProjectManager, .getOptionalNumber(), .isRecord()]
- "projects_projectmanager_projectmanager_persistvisualsartifact": ".persistVisualsArtifact()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L332 | neighbors=[ProjectManager, VisualsArtifactConflictError, .saveVisuals()]
- "projects_projectmanager_projectmanager_savescenes": ".saveScenes()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L306 | neighbors=[ProjectManager, .updatePackageStatus(), ScenesArtifactConflictError]
- "projects_projectmanager_projectmanager_savescript": ".saveScript()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L285 | neighbors=[ProjectManager, .updatePackageStatus(), ScriptArtifactConflictError]
- "projects_projectmanager_projectmanager_savevisuals": ".saveVisuals()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L327 | neighbors=[ProjectManager, .persistVisualsArtifact(), .updatePackageStatus()]
- "projects_projectmanager_projectmanager_updatepackageusage": ".updatePackageUsage()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L248 | neighbors=[ProjectManager, .ensureManifest(), .mergePackageUsage()]
- "projects_projectprogress_calculateproductionprogress": "calculateProductionProgress()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L107 | neighbors=[projectProgress.ts, calculateCompletionPercentage(), page.tsx]
- "projects_projectprogress_getcompletedstages": "getCompletedStages()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L189 | neighbors=[projectProgress.ts, getCompletedStagesBySlug(), getCompletedStagesFromManifest()]
- "projects_projectprogress_getcompletedstagesbyslug": "getCompletedStagesBySlug()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L199 | neighbors=[projectProgress.ts, getCompletedStages(), getProjectProgressBySlug()]
- "projects_projectprogress_getcompletedstagesfromprogress": "getCompletedStagesFromProgress()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L312 | neighbors=[projectProgress.ts, createProgressSummary(), getProjectProgressBySlug()]
- "projects_projectprogress_getcompletionpercentagebyslug": "getCompletionPercentageBySlug()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L253 | neighbors=[projectProgress.ts, getCompletionPercentage(), getProjectProgressBySlug()]
- "projects_projectprogress_getcurrentstage": "getCurrentStage()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L213 | neighbors=[projectProgress.ts, getCurrentStageBySlug(), getCurrentStageFromManifest()]
- "projects_projectprogress_getcurrentstagebyslug": "getCurrentStageBySlug()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L223 | neighbors=[projectProgress.ts, getCurrentStage(), getProjectProgressBySlug()]
- "projects_projectprogress_getcurrentstagefrommanifest": "getCurrentStageFromManifest()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L281 | neighbors=[projectProgress.ts, createManifestProjectProgress(), getCurrentStage()]
- "projects_projectprogress_getcurrentstagefromprogress": "getCurrentStageFromProgress()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L320 | neighbors=[projectProgress.ts, createProgressSummary(), getProjectProgressBySlug()]
- "projects_projectprogress_getnextstagefromprogress": "getNextStageFromProgress()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L332 | neighbors=[projectProgress.ts, createProgressSummary(), getProjectProgressBySlug()]
- "projects_projectprogress_getstageprogress": "getStageProgress()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L291 | neighbors=[projectProgress.ts, createProgressSummary(), getProjectProgressBySlug()]
- "projects_projectprogress_productionstepstate": "ProductionStepState" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L10 | neighbors=[projectProgress.ts, ProductionPackageSummary.tsx, ProjectStatusCards.tsx]
- "projects_projectreader_isnodeerror": "isNodeError()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L114 | neighbors=[ProjectReader.ts, .listProjects(), .readJSONState()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-072.json

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
