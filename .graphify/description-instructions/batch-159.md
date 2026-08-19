# Node Description Batch 160 of 166

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

- "storage_audiostorage_trustedpublicationreceipts": "trustedPublicationReceipts" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L98 | neighbors=[AudioStorage.ts]
- "storage_filestorage_ensurestoragedirectory": "ensureStorageDirectory()" | kind=code-symbol | source=src/lib/storage/FileStorage.ts:L26 | neighbors=[FileStorage.ts]
- "storage_imagestorage_imagedata": "ImageData" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L17 | neighbors=[ImageStorage.ts]
- "storage_imagestorage_imageinspection": "ImageInspection" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L34 | neighbors=[ImageStorage.ts]
- "storage_imagestorage_parsedimagedata": "ParsedImageData" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L38 | neighbors=[ImageStorage.ts]
- "storage_imagestorage_savedimage": "SavedImage" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L27 | neighbors=[ImageStorage.ts]
- "storage_imagestorage_saveimageinput": "SaveImageInput" | kind=code-symbol | source=src/lib/assets/storage/ImageStorage.ts:L19 | neighbors=[ImageStorage.ts]
- "storage_storagepathsecurity_containedfile": "ContainedFile" | kind=code-symbol | source=src/lib/assets/storage/StoragePathSecurity.ts:L9 | neighbors=[StoragePathSecurity.ts]
- "studio_aiusagepanel_aiusagepanelprops": "AIUsagePanelProps" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L7 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_aiusageresponse": "AIUsageResponse" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L11 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_createusagesummary": "createUsageSummary()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L392 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_filterselect": "FilterSelect()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L276 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_filterusagerecords": "filterUsageRecords()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L341 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_getsearchablerecordtext": "getSearchableRecordText()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L376 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_getuniqueoptions": "getUniqueOptions()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L388 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_providerdistributionitem": "ProviderDistributionItem" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L27 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_sortbynewest": "sortByNewest()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L444 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_summaryitem": "SummaryItem()" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L308 | neighbors=[AIUsagePanel.tsx]
- "studio_aiusagepanel_usagesummary": "UsageSummary" | kind=code-symbol | source=src/components/studio/AIUsagePanel.tsx:L17 | neighbors=[AIUsagePanel.tsx]
- "studio_assemblypanel_assemblypanel": "AssemblyPanel()" | kind=code-symbol | source=src/components/studio/AssemblyPanel.tsx:L19 | neighbors=[AssemblyPanel.tsx]
- "studio_assemblypanel_assemblypanelprops": "AssemblyPanelProps" | kind=code-symbol | source=src/components/studio/AssemblyPanel.tsx:L7 | neighbors=[AssemblyPanel.tsx]
- "studio_assemblypanel_assemblyresponse": "AssemblyResponse" | kind=code-symbol | source=src/components/studio/AssemblyPanel.tsx:L13 | neighbors=[AssemblyPanel.tsx]
- "studio_assemblypanel_info": "Info()" | kind=code-symbol | source=src/components/studio/AssemblyPanel.tsx:L175 | neighbors=[AssemblyPanel.tsx]
- "studio_audiopanel_audiopanel": "AudioPanel()" | kind=code-symbol | source=src/components/studio/AudioPanel.tsx:L14 | neighbors=[AudioPanel.tsx]
- "studio_audiopanel_audiopanelprops": "AudioPanelProps" | kind=code-symbol | source=src/components/studio/AudioPanel.tsx:L8 | neighbors=[AudioPanel.tsx]
- "studio_audiopanel_info": "Info()" | kind=code-symbol | source=src/components/studio/AudioPanel.tsx:L144 | neighbors=[AudioPanel.tsx]
- "studio_pipelinejobspanel_getactionlabel": "getActionLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L877 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_getactionprogresslabel": "getActionProgressLabel()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L881 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_historyresponse": "HistoryResponse" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L28 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_isactivejob": "isActiveJob()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L858 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_ispipelinejobaction": "isPipelineJobAction()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1183 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_ispipelinejobhistoryevent": "isPipelineJobHistoryEvent()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1187 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_issafeslug": "isSafeSlug()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1213 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_jobactionstate": "JobActionState" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L39 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_jobdetail": "JobDetail()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L692 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_jobsresponse": "JobsResponse" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L18 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_loadhistoryoptions": "LoadHistoryOptions" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L34 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_parsehistory": "parseHistory()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1135 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_parsejoblist": "parseJobList()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L1112 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_pipelinehealthinsights": "PipelineHealthInsights" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L56 | neighbors=[PipelineJobsPanel.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-159.json

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
