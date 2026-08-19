# Node Description Batch 97 of 166

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

- "production_productionexecutionworker_statusof": "statusOf()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L40 | neighbors=[ProductionExecutionWorker.ts, .execute()]
- "production_productionexecutionworker_terminal": "terminal()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L40 | neighbors=[ProductionExecutionWorker.ts, .execute()]
- "production_productionglobalterminalquiescence_escaperegularexpression": "escapeRegularExpression()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L450 | neighbors=[ProductionGlobalTerminalQuiescence.ts, readLatestVersioned()]
- "production_productionglobalterminalquiescence_isproductionstepkey": "isProductionStepKey()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L446 | neighbors=[ProductionGlobalTerminalQuiescence.ts, validateProductionGlobalTerminalQuiesce…]
- "production_productionglobalterminalquiescence_parseversionedkey": "parseVersionedKey()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L412 | neighbors=[ProductionGlobalTerminalQuiescence.ts, validateProductionGlobalTerminalQuiesce…]
- "production_productionglobalterminalquiescence_sameset": "sameSet()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L425 | neighbors=[ProductionGlobalTerminalQuiescence.ts, validateProductionGlobalTerminalQuiesce…]
- "production_productionhealthapiclient_buildurl": "buildUrl()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L170 | neighbors=[ProductionHealthApiClient.ts, getProductionHealth()]
- "production_productionhealthapiclient_getproductionhealthoptions": "GetProductionHealthOptions" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L15 | neighbors=[ProductionHealthApiClient.ts, ProductionHealthPanel.tsx]
- "production_productionhealthapiclient_isfinding": "isFinding()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L253 | neighbors=[ProductionHealthApiClient.ts, isRecord()]
- "production_productionhealthapiclient_ishealthstatus": "isHealthStatus()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L351 | neighbors=[ProductionHealthApiClient.ts, isHealthResult()]
- "production_productionhealthapiclient_isoverallseverity": "isOverallSeverity()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L342 | neighbors=[ProductionHealthApiClient.ts, isHealthResult()]
- "production_productionhealthapiclient_isproductionhealtherrorcode": "isProductionHealthErrorCode()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L330 | neighbors=[ProductionHealthApiClient.ts, isApiErrorPayload()]
- "production_productionhealthapiclient_isproductionstage": "isProductionStage()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L375 | neighbors=[ProductionHealthApiClient.ts, isSnapshotStage()]
- "production_productionhealthapiclient_normalizetimeout": "normalizeTimeout()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L164 | neighbors=[ProductionHealthApiClient.ts, getProductionHealth()]
- "production_productionhealthapierror_logproductionhealtherror": "logProductionHealthError()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiError.ts:L32 | neighbors=[ProductionHealthApiError.ts, createProductionHealthErrorResponse()]
- "production_productionhealthapierror_nostoreheaders": "noStoreHeaders" | kind=code-symbol | source=src/lib/production/ProductionHealthApiError.ts:L28 | neighbors=[ProductionHealthApiError.ts, route.ts]
- "production_productionhealthengine_aggregatestageoutputs": "aggregateStageOutputs()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L117 | neighbors=[ProductionHealthEngine.ts, calculateSourceConfidence()]
- "production_productionhealthengine_countfindings": "countFindings()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L178 | neighbors=[ProductionHealthEngine.ts, .evaluate()]
- "production_productionhealthengine_getoverallseverity": "getOverallSeverity()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L187 | neighbors=[ProductionHealthEngine.ts, .evaluate()]
- "production_productionhealthengine_getstatus": "getStatus()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L196 | neighbors=[ProductionHealthEngine.ts, .evaluate()]
- "production_productionhealthengine_headlineforstatus": "headlineForStatus()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L206 | neighbors=[ProductionHealthEngine.ts, .evaluate()]
- "production_productionhealthengine_productionhealthrules": "productionHealthRules" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L22 | neighbors=[ProductionHealthEngine.ts, smoke-production-health-rules.ts]
- "production_productionhealthengine_severityrank": "severityRank()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L213 | neighbors=[ProductionHealthEngine.ts, dedupeFindings()]
- "production_productionhealthengine_sortfindings": "sortFindings()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L167 | neighbors=[ProductionHealthEngine.ts, .evaluate()]
- "production_productionhealthengine_stableevidence": "stableEvidence()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L158 | neighbors=[ProductionHealthEngine.ts, findingIdentity()]
- "production_productionhealtherror_isproductionhealtherror": "isProductionHealthError()" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L40 | neighbors=[ProductionHealthError.ts, toProductionHealthError()]
- "production_productionhealtherror_productionhealtherrorcode": "ProductionHealthErrorCode" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L1 | neighbors=[ProductionHealthApiClient.ts, ProductionHealthError.ts]
- "production_productionhealthservice_deriveintelligence": "deriveIntelligence()" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L68 | neighbors=[ProductionHealthService.ts, .getProductionHealth()]
- "production_productionhealthservice_productionhealthservice_getproductionhealth": ".getProductionHealth()" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L26 | neighbors=[ProductionHealthService, deriveIntelligence()]
- "production_productionintelligenceconsumer_parsestage": "parseStage()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L141 | neighbors=[ProductionIntelligenceConsumer.ts, isStage()]
- "production_productionintelligenceconsumer_parsestring": "parseString()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L142 | neighbors=[ProductionIntelligenceConsumer.ts, isString()]
- "production_productionoperationjournal_date": "date()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L7 | neighbors=[ProductionOperationJournal.ts, buildProductionOperationJournalEvent()]
- "production_productionoperationjournal_reason": "reason()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L3 | neighbors=[ProductionOperationJournal.ts, validateProductionOperationJournalSeque…]
- "production_productionoperationjournal_safe": "safe()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L7 | neighbors=[ProductionOperationJournal.ts, buildProductionOperationJournalEvent()]
- "production_productionoperationjournal_statefor": "stateFor()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L7 | neighbors=[ProductionOperationJournal.ts, projectProductionOperationJournalState()]
- "production_productionpipelineexecutionadapter_productionpipelineexecutionadapter_execute": ".execute()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L20 | neighbors=[ProductionPipelineExecutionAdapter, ProductionPipelineDurableExecutionError]
- "production_productionpipelineexecutioncanonicalruntime_canonicalproductionpipelineexecutionsnapshot": "CanonicalProductionPipelineExecutionSnapshot" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L45 | neighbors=[ProductionPipelineExecutionCanonicalRun…, ProductionPipelineExecutionConfiguratio…]
- "production_productionpipelineexecutioncanonicalruntime_createcanonicalproductionpipelineexecutionexecutor": "createCanonicalProductionPipelineExecutionExecutor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L119 | neighbors=[ProductionPipelineExecutionCanonicalRun…, installCanonicalProductionPipelineExecu…]
- "production_productionpipelineexecutioncanonicalruntime_executedurableproductionpipelinestage": "executeDurableProductionPipelineStage()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L143 | neighbors=[ProductionPipelineExecutionCanonicalRun…, executePreparedDurableProductionPipelin…]
- "production_productionpipelineexecutioncanonicalruntime_executeprepareddurableproductionpipelinestage": "executePreparedDurableProductionPipelineStage()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L154 | neighbors=[ProductionPipelineExecutionCanonicalRun…, executeDurableProductionPipelineStage()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-096.json

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
