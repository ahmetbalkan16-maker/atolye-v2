# Node Description Batch 161 of 166

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

- "studio_pipelinejobspanel_pipelinehealthseverity": "PipelineHealthSeverity" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L54 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_pipelinehistoryinsights": "PipelineHistoryInsights" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L44 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_pipelinejobspanelprops": "PipelineJobsPanelProps" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L14 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_pipelinejobstatuses": "pipelineJobStatuses" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L62 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelinejobspanel_summarypill": "SummaryPill()" | kind=code-symbol | source=src/components/studio/PipelineJobsPanel.tsx:L703 | neighbors=[PipelineJobsPanel.tsx]
- "studio_pipelineresumeaction_pipelineresumeaction": "PipelineResumeAction()" | kind=code-symbol | source=src/components/studio/PipelineResumeAction.tsx:L21 | neighbors=[PipelineResumeAction.tsx]
- "studio_pipelineresumeaction_pipelineresumeactionprops": "PipelineResumeActionProps" | kind=code-symbol | source=src/components/studio/PipelineResumeAction.tsx:L9 | neighbors=[PipelineResumeAction.tsx]
- "studio_pipelineresumeaction_resumeresponse": "ResumeResponse" | kind=code-symbol | source=src/components/studio/PipelineResumeAction.tsx:L14 | neighbors=[PipelineResumeAction.tsx]
- "studio_pipelinestatus_createpipelinestatusprops": "createPipelineStatusProps()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L378 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_detailitem": "DetailItem()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L311 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_errorblock": "ErrorBlock()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L333 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_infobox": "InfoBox()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L424 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_isretryablestatus": "isRetryableStatus()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L420 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_pipelinestatusprops": "PipelineStatusProps" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L13 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_retryresponse": "RetryResponse" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L23 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_retrytoast": "RetryToast()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L357 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_statusdetailitem": "StatusDetailItem()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L322 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_summaryitem": "SummaryItem()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L399 | neighbors=[PipelineStatus.tsx]
- "studio_pipelinestatus_usageitem": "UsageItem()" | kind=code-symbol | source=src/components/studio/PipelineStatus.tsx:L346 | neighbors=[PipelineStatus.tsx]
- "studio_productionhealthfindingevidence_evidencemeta": "EvidenceMeta()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingEvidence.tsx:L66 | neighbors=[ProductionHealthFindingEvidence.tsx]
- "studio_productionhealthfindingevidence_formatevidencevalue": "formatEvidenceValue()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingEvidence.tsx:L79 | neighbors=[ProductionHealthFindingEvidence.tsx]
- "studio_productionhealthfindingevidence_productionhealthfindingevidence": "ProductionHealthFindingEvidence()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingEvidence.tsx:L14 | neighbors=[ProductionHealthFindingEvidence.tsx]
- "studio_productionhealthfindingevidence_productionhealthfindingevidenceprops": "ProductionHealthFindingEvidenceProps" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingEvidence.tsx:L8 | neighbors=[ProductionHealthFindingEvidence.tsx]
- "studio_productionhealthfindingspanel_detail": "Detail()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L110 | neighbors=[ProductionHealthFindingsPanel.tsx]
- "studio_productionhealthfindingspanel_productionhealthfindingspanel": "ProductionHealthFindingsPanel()" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L14 | neighbors=[ProductionHealthFindingsPanel.tsx]
- "studio_productionhealthfindingspanel_productionhealthfindingspanelprops": "ProductionHealthFindingsPanelProps" | kind=code-symbol | source=src/components/studio/ProductionHealthFindingsPanel.tsx:L8 | neighbors=[ProductionHealthFindingsPanel.tsx]
- "studio_productionhealthpanel_badge": "Badge()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L236 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_errorstate": "ErrorState()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L130 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_loadingstate": "LoadingState()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L118 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_productionhealthloader": "ProductionHealthLoader" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L22 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_productionhealthpanel": "ProductionHealthPanel()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L32 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_productionhealthpanelprops": "ProductionHealthPanelProps" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L27 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_retrybutton": "RetryButton()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L224 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionhealthpanel_summaryitem": "SummaryItem()" | kind=code-symbol | source=src/components/studio/ProductionHealthPanel.tsx:L244 | neighbors=[ProductionHealthPanel.tsx]
- "studio_productionpackagesummary_productionpackagesummary": "ProductionPackageSummary()" | kind=code-symbol | source=src/components/studio/ProductionPackageSummary.tsx:L8 | neighbors=[ProductionPackageSummary.tsx]
- "studio_productionpackagesummary_productionpackagesummaryprops": "ProductionPackageSummaryProps" | kind=code-symbol | source=src/components/studio/ProductionPackageSummary.tsx:L4 | neighbors=[ProductionPackageSummary.tsx]
- "studio_projectactions_projectactions": "ProjectActions()" | kind=code-symbol | source=src/components/studio/ProjectActions.tsx:L7 | neighbors=[ProjectActions.tsx]
- "studio_projectactions_projectactionsprops": "ProjectActionsProps" | kind=code-symbol | source=src/components/studio/ProjectActions.tsx:L3 | neighbors=[ProjectActions.tsx]
- "studio_projectprogress_projectprogress": "ProjectProgress()" | kind=code-symbol | source=src/components/studio/ProjectProgress.tsx:L5 | neighbors=[ProjectProgress.tsx]
- "studio_projectprogress_projectprogressprops": "ProjectProgressProps" | kind=code-symbol | source=src/components/studio/ProjectProgress.tsx:L1 | neighbors=[ProjectProgress.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-160.json

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
