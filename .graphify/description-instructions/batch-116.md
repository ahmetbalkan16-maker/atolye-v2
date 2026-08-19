# Node Description Batch 117 of 166

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

- "storage_filestorage_filestorage_savejsonatomically": ".saveJsonAtomically()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L59 | neighbors=[FileStorage, withWriteAuthority()]
- "storage_imagestorage_ensurestoragedirectory": "ensureStorageDirectory()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L202 | neighbors=[ImageStorage.ts, .saveImage()]
- "storage_imagestorage_getextensionfrommimetype": "getExtensionFromMimeType()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L178 | neighbors=[ImageStorage.ts, createImageFileName()]
- "storage_imagestorage_parseimagedata": "parseImageData()" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L148 | neighbors=[ImageStorage.ts, .saveImage()]
- "storage_videostorage_seconds": "seconds()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L272 | neighbors=[VideoStorage.ts, readMovieDuration()]
- "storage_videostorage_storedvideoinspection": "StoredVideoInspection" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L22 | neighbors=[VideoStorage.ts, VideoInspection]
- "storage_videostorage_videoinspection": "VideoInspection" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L17 | neighbors=[VideoStorage.ts, StoredVideoInspection]
- "storage_videostorage_videostorage_createrenderpaths": ".createRenderPaths()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L41 | neighbors=[VideoStorage, .createPaths()]
- "storage_videostorage_videostorage_createscenerenderpaths": ".createSceneRenderPaths()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L45 | neighbors=[VideoStorage, .createPaths()]
- "storage_videostorage_videostorage_finalize": ".finalize()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L92 | neighbors=[VideoStorage, inside()]
- "storage_videostorage_videostorage_removeifexists": ".removeIfExists()" | kind=code-symbol | source=src/lib/assets/storage/VideoStorage.ts:L222 | neighbors=[VideoStorage, inside()]
- "studio_aiusagepanel_aiusagepanel": "AIUsagePanel()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L34 | neighbors=[AIUsagePanel.tsx, formatDate()]
- "studio_aiusagepanel_formatdate": "formatDate()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L451 | neighbors=[AIUsagePanel.tsx, AIUsagePanel()]
- "studio_aiusagepanel_getstatusclassname": "getStatusClassName()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L331 | neighbors=[AIUsagePanel.tsx, StatusBadge()]
- "studio_aiusagepanel_statusbadge": "StatusBadge()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L319 | neighbors=[AIUsagePanel.tsx, getStatusClassName()]
- "studio_pipelinejobspanel_formatattentionitems": "formatAttentionItems()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L996 | neighbors=[PipelineJobsPanel.tsx, PipelineIntelligence()]
- "studio_pipelinejobspanel_formatoptionalpercent": "formatOptionalPercent()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L983 | neighbors=[PipelineJobsPanel.tsx, PipelineIntelligence()]
- "studio_pipelinejobspanel_gethistoryeventtimems": "getHistoryEventTimeMs()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L953 | neighbors=[PipelineJobsPanel.tsx, getTimestampMs()]
- "studio_pipelinejobspanel_gethistorystatusclassname": "getHistoryStatusClassName()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1036 | neighbors=[PipelineJobsPanel.tsx, HistoryRow()]
- "studio_pipelinejobspanel_getlongrunningjobs": "getLongRunningJobs()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1046 | neighbors=[PipelineJobsPanel.tsx, createPipelineHealthInsights()]
- "studio_pipelinejobspanel_getoptionalstring": "getOptionalString()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L973 | neighbors=[PipelineJobsPanel.tsx, JobRow()]
- "studio_pipelinejobspanel_getstatusclassname": "getStatusClassName()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1024 | neighbors=[PipelineJobsPanel.tsx, StatusBadge()]
- "studio_pipelinejobspanel_getstatuslabel": "getStatusLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L885 | neighbors=[PipelineJobsPanel.tsx, getUnsupportedReason()]
- "studio_pipelinejobspanel_ispipelinejobstatus": "isPipelineJobStatus()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1179 | neighbors=[PipelineJobsPanel.tsx, isPipelineJob()]
- "studio_pipelinejobspanel_issafejobid": "isSafeJobId()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1217 | neighbors=[PipelineJobsPanel.tsx, isPipelineJob()]
- "studio_pipelinejobspanel_statusbadge": "StatusBadge()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L714 | neighbors=[PipelineJobsPanel.tsx, getStatusClassName()]
- "studio_pipelinestatus_formatcost": "formatCost()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L528 | neighbors=[PipelineStatus.tsx, StageDetails()]
- "studio_pipelinestatus_formatdatetime": "formatDateTime()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L481 | neighbors=[PipelineStatus.tsx, StageDetails()]
- "studio_pipelinestatus_formatduration": "formatDuration()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L508 | neighbors=[PipelineStatus.tsx, getDurationLabel()]
- "studio_pipelinestatus_formatnumber": "formatNumber()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L524 | neighbors=[PipelineStatus.tsx, StageDetails()]
- "studio_pipelinestatus_getruntypelabel": "getRunTypeLabel()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L459 | neighbors=[PipelineStatus.tsx, StageDetails()]
- "studio_pipelinestatus_getstagelabel": "getStageLabel()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L435 | neighbors=[PipelineStatus.tsx, PipelineStatus()]
- "studio_pipelinestatus_getstatusclassname": "getStatusClassName()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L469 | neighbors=[PipelineStatus.tsx, StatusBadge()]
- "studio_pipelinestatus_getstatuslabel": "getStatusLabel()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L447 | neighbors=[PipelineStatus.tsx, StatusBadge()]
- "studio_pipelinestatus_pipelinestatus": "PipelineStatus()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L30 | neighbors=[PipelineStatus.tsx, getStageLabel()]
- "studio_productionhealthfindingspanel_findingcard": "FindingCard()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L60 | neighbors=[ProductionHealthFindingsPanel.tsx, getSeverityClassName()]
- "studio_productionhealthfindingspanel_getseverityclassname": "getSeverityClassName()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L123 | neighbors=[ProductionHealthFindingsPanel.tsx, FindingCard()]
- "studio_productionhealthpanel_formatdatetime": "formatDateTime()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L275 | neighbors=[ProductionHealthPanel.tsx, HealthSummary()]
- "studio_productionhealthpanel_getseverityclassname": "getSeverityClassName()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L265 | neighbors=[ProductionHealthPanel.tsx, HealthSummary()]
- "studio_productionhealthpanel_getstatusclassname": "getStatusClassName()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L255 | neighbors=[ProductionHealthPanel.tsx, HealthSummary()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-116.json

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
