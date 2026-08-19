# Node Description Batch 137 of 166

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

- "production_productionreadinessservice_readinesswav": "readinessWav()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L532 | neighbors=[ProductionReadinessService.ts]
- "production_productionregenerationphysicalguard_productionregenerationphysicalidentity": "ProductionRegenerationPhysicalIdentity" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L5 | neighbors=[ProductionRegenerationPhysicalGuard.ts]
- "production_productionruntimeinitializer_classifications": "classifications" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L81 | neighbors=[ProductionRuntimeInitializer.ts]
- "production_productionruntimeinitializer_failure": "failure()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L87 | neighbors=[ProductionRuntimeInitializer.ts]
- "production_productionruntimeinitializer_productionruntimeinitializationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L75 | neighbors=[ProductionRuntimeInitializationError]
- "production_productionruntimeinitializer_productionruntimeinitializer_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L18 | neighbors=[ProductionRuntimeInitializer]
- "production_productionruntimeinitializer_productionruntimeinitializer_failure": ".failure()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L68 | neighbors=[ProductionRuntimeInitializer]
- "production_productionsnapshotcontract_effectivestagestatusinput": "EffectiveStageStatusInput" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L12 | neighbors=[ProductionSnapshotContract.ts]
- "production_productionsnapshotparts_compareascending": "compareAscending()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L517 | neighbors=[ProductionSnapshotParts.ts]
- "production_productionsnapshotparts_comparedescending": "compareDescending()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L513 | neighbors=[ProductionSnapshotParts.ts]
- "production_productionsnapshotparts_gethistoryduration": "getHistoryDuration()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L386 | neighbors=[ProductionSnapshotParts.ts]
- "production_productionsnapshotparts_stageindex": "stageIndex()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L490 | neighbors=[ProductionSnapshotParts.ts]
- "production_productionsnapshotparts_statusescompatible": "statusesCompatible()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L428 | neighbors=[ProductionSnapshotParts.ts]
- "production_productionsnapshotsourcereader_ispackagestatus": "isPackageStatus()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L288 | neighbors=[ProductionSnapshotSourceReader.ts]
- "production_productionsnapshotsourcereader_productionsnapshotsourcereader_read": ".read()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L52 | neighbors=[ProductionSnapshotSourceReader]
- "production_productionsnapshotsourcereader_readoutputsource": "readOutputSource()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L126 | neighbors=[ProductionSnapshotSourceReader.ts]
- "production_productionsnapshotsourcereader_stageoutputfiles": "stageOutputFiles" | kind=code-symbol | source=src/lib/production/ProductionSnapshotSourceReader.ts:L18 | neighbors=[ProductionSnapshotSourceReader.ts]
- "production_productionworkerlifecycle_activelifecyclebinding": "ActiveLifecycleBinding" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L278 | neighbors=[ProductionWorkerLifecycle.ts]
- "production_productionworkerlifecycle_activelifecycles": "activeLifecycles" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L279 | neighbors=[ProductionWorkerLifecycle.ts]
- "production_productionworkerlifecycle_productionworkerlifecycle_bindruntimeoperationcontext": ".bindRuntimeOperationContext()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L119 | neighbors=[ProductionWorkerLifecycle]
- "production_productionworkerlifecycle_productionworkerlifecycle_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L57 | neighbors=[ProductionWorkerLifecycle]
- "production_productionworkerlifecycle_productionworkerlifecycleauthoritysnapshot": "ProductionWorkerLifecycleAuthoritySnapshot" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L27 | neighbors=[ProductionWorkerLifecycle.ts]
- "production_productionworkerlifecycle_productionworkerlifecycleexecutionidentity": "ProductionWorkerLifecycleExecutionIdentity" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L19 | neighbors=[ProductionWorkerLifecycle.ts]
- "production_productionworkerlifecycle_productionworkerlifecycleexecutionrejectederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionWorkerLifecycle.ts:L13 | neighbors=[ProductionWorkerLifecycleExecutionRejec…]
- "projects_projectmanager_projectmanager_getanimation": ".getAnimation()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L508 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getaudio": ".getAudio()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L516 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getresearch": ".getResearch()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L492 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getscenes": ".getScenes()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L500 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getscript": ".getScript()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L496 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getvisuals": ".getVisuals()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L504 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getyoutubepublish": ".getYouTubePublish()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L448 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getyoutubepublishrecoverystate": ".getYouTubePublishRecoveryState()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L440 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_getyoutubepublishstate": ".getYouTubePublishState()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L436 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_normalizepackagestatus": ".normalizePackageStatus()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L714 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_removeyoutube": ".removeYouTube()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L464 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_removeyoutubepublish": ".removeYouTubePublish()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L452 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_removeyoutubepublishrecovery": ".removeYouTubePublishRecovery()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L456 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_restoreyoutube": ".restoreYouTube()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L468 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_saveyoutubepublish": ".saveYouTubePublish()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L401 | neighbors=[ProjectManager]
- "projects_projectmanager_projectmanager_saveyoutubepublishrecovery": ".saveYouTubePublishRecovery()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L411 | neighbors=[ProjectManager]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-136.json

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
