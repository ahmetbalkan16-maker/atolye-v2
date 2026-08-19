# Node Description Batch 100 of 166

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

- "production_productionsnapshotparts_minimumcoverage": "minimumCoverage()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L403 | neighbors=[ProductionSnapshotParts.ts, buildUsage()]
- "production_productionsnapshotparts_selectlatestjob": "selectLatestJob()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L360 | neighbors=[ProductionSnapshotParts.ts, smoke-production-snapshot-builder.ts]
- "production_productionsnapshotparts_sortanddedupefindings": "sortAndDedupeFindings()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L474 | neighbors=[ProductionSnapshotParts.ts, collectFindings()]
- "production_productionsnapshotparts_sourceentries": "sourceEntries()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L439 | neighbors=[ProductionSnapshotParts.ts, collectFindings()]
- "production_productionsnapshotsourcereader_ishistory": "isHistory()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L212 | neighbors=[ProductionSnapshotSourceReader.ts, isRecord()]
- "production_productionsnapshotsourcereader_ishistoryevent": "isHistoryEvent()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L223 | neighbors=[ProductionSnapshotSourceReader.ts, isRecord()]
- "production_productionsnapshotsourcereader_isjoblist": "isJobList()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L187 | neighbors=[ProductionSnapshotSourceReader.ts, isRecord()]
- "production_productionsnapshotsourcereader_isjobstatus": "isJobStatus()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L298 | neighbors=[ProductionSnapshotSourceReader.ts, isJob()]
- "production_productionsnapshotsourcereader_isprojectstatus": "isProjectStatus()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L268 | neighbors=[ProductionSnapshotSourceReader.ts, isProject()]
- "production_productionsnapshotsourcereader_isusagelog": "isUsageLog()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L235 | neighbors=[ProductionSnapshotSourceReader.ts, isRecord()]
- "production_productionsnapshotsourcereader_isusagerecord": "isUsageRecord()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L246 | neighbors=[ProductionSnapshotSourceReader.ts, isRecord()]
- "production_productionsnapshotsourcereader_productionsnapshotsource": "ProductionSnapshotSource" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L33 | neighbors=[ProductionSnapshotParts.ts, ProductionSnapshotSourceReader.ts]
- "production_productionsnapshotsourcereader_productionsnapshotsourcereader_readsources": ".readSources()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L58 | neighbors=[ProductionSnapshotSourceReader, readValidatedSource()]
- "production_productionsnapshotsourcereader_readvalidatedsource": "readValidatedSource()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L101 | neighbors=[ProductionSnapshotSourceReader.ts, .readSources()]
- "production_productionworkerlifecycle_bindactivelifecycle": "bindActiveLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L281 | neighbors=[ProductionWorkerLifecycle.ts, .executeWithRuntimeOperationContext()]
- "production_productionworkerlifecycle_productionworkerlifecycle_execute": ".execute()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L128 | neighbors=[ProductionWorkerLifecycle, .executeAccepted()]
- "production_productionworkerlifecycle_productionworkerlifecycle_initializationfailuresnapshot": ".initializationFailureSnapshot()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L255 | neighbors=[ProductionWorkerLifecycle, .statusSnapshot()]
- "production_productionworkerlifecycle_productionworkerlifecycle_start": ".start()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L89 | neighbors=[ProductionWorkerLifecycle, .startOnce()]
- "production_productionworkerlifecycle_productionworkerlifecycle_stop": ".stop()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L102 | neighbors=[ProductionWorkerLifecycle, .stopOnce()]
- "production_productionworkerlifecycle_productionworkerlifecycle_withexecutionidentity": ".withExecutionIdentity()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L196 | neighbors=[ProductionWorkerLifecycle, runWithProductionWorkerLifecycleIdentit…]
- "production_productionworkerlifecycle_safeprojectslug": "safeProjectSlug()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L333 | neighbors=[ProductionWorkerLifecycle.ts, .fail()]
- "production_productionworkerlifecycle_safereason": "safeReason()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L332 | neighbors=[ProductionWorkerLifecycle.ts, .fail()]
- "production_productionworkerlifecycle_unbindactivelifecycle": "unbindActiveLifecycle()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L291 | neighbors=[ProductionWorkerLifecycle.ts, .executeWithRuntimeOperationContext()]
- "production_productionworkerlifecycle_validinitialization": "validInitialization()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L324 | neighbors=[ProductionWorkerLifecycle.ts, .startOnce()]
- "projects_getprojects": "getProjects.ts" | kind=code-symbol | source=src/lib/projects/getProjects.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, a319525 Setup ProjectManager V2 archite…]
- "projects_projectmanager_projectmanager_createpackagemanifest": ".createPackageManifest()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L594 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_createslug": ".createSlug()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L74 | neighbors=[ProjectManager, .createProject()]
- "projects_projectmanager_projectmanager_getassembly": ".getAssembly()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L536 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_getexport": ".getExport()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L532 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_getseo": ".getSEO()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L524 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_getthumbnail": ".getThumbnail()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L520 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_getvideo": ".getVideo()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L512 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_getyoutube": ".getYouTube()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L528 | neighbors=[ProjectManager, .readGenerationAwarePackage()]
- "projects_projectmanager_projectmanager_markyoutubepublished": ".markYouTubePublished()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L460 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_mergepackageusage": ".mergePackageUsage()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L815 | neighbors=[ProjectManager, .updatePackageUsage()]
- "projects_projectmanager_projectmanager_normalizeruntype": ".normalizeRunType()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L828 | neighbors=[ProjectManager, .normalizeAttemptMetadata()]
- "projects_projectmanager_projectmanager_saveanimation": ".saveAnimation()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L347 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_saveassembly": ".saveAssembly()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L480 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_saveaudio": ".saveAudio()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L360 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_saveexport": ".saveExport()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L473 | neighbors=[ProjectManager, .updatePackageStatus()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-099.json

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
