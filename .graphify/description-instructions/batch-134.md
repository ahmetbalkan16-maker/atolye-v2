# Node Description Batch 135 of 166

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

- "production_productionhealthapiclient_productionhealthapiconsumererror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L34 | neighbors=[ProductionHealthApiConsumerError]
- "production_productionhealthapiclient_productionhealthapiconsumererror_status": ".status()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L49 | neighbors=[ProductionHealthApiConsumerError]
- "production_productionhealthapiclient_productionhealthapiconsumererrorkind": "ProductionHealthApiConsumerErrorKind" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L7 | neighbors=[ProductionHealthApiClient.ts]
- "production_productionhealthapiclient_productionstages": "productionStages" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L360 | neighbors=[ProductionHealthApiClient.ts]
- "production_productionhealthapiclient_safemessages": "safeMessages" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L22 | neighbors=[ProductionHealthApiClient.ts]
- "production_productionhealthengine_categoryrank": "categoryRank()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L217 | neighbors=[ProductionHealthEngine.ts]
- "production_productionhealthengine_comparetext": "compareText()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L234 | neighbors=[ProductionHealthEngine.ts]
- "production_productionhealthengine_stagerank": "stageRank()" | kind=code-symbol | source=src/lib/production/ProductionHealthEngine.ts:L230 | neighbors=[ProductionHealthEngine.ts]
- "production_productionhealtherror_httpstatuses": "httpStatuses" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L16 | neighbors=[ProductionHealthError.ts]
- "production_productionhealtherror_productionhealtherror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L28 | neighbors=[ProductionHealthError]
- "production_productionhealtherror_publicmessages": "publicMessages" | kind=code-symbol | source=src/lib/production/ProductionHealthError.ts:L8 | neighbors=[ProductionHealthError.ts]
- "production_productionhealthservice_getproductionhealthinput": "GetProductionHealthInput" | kind=code-symbol | source=src/lib/production/ProductionHealthService.ts:L11 | neighbors=[ProductionHealthService.ts]
- "production_productionintelligenceconsumer_actionpriorities": "actionPriorities" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L31 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_actiontypes": "actionTypes" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L28 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_nodestatuses": "nodeStatuses" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L34 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_planstatuses": "planStatuses" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L32 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_previewstatuses": "previewStatuses" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L35 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_productionintelligenceconsumerresult": "ProductionIntelligenceConsumerResult" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L18 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_stages": "stages" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L24 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceconsumer_stepstatuses": "stepStatuses" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceConsumer.ts:L33 | neighbors=[ProductionIntelligenceConsumer.ts]
- "production_productionintelligenceservice_productionintelligenceservice_derive": ".derive()" | kind=code-symbol | source=src/lib/production/ProductionIntelligenceService.ts:L9 | neighbors=[ProductionIntelligenceService]
- "production_productionlegacypipelineexecutionidentity_productionpipelineidentityversion": "ProductionPipelineIdentityVersion" | kind=code-symbol | source=src/lib/production/ProductionLegacyPipelineExecutionIdentity.ts:L5 | neighbors=[ProductionLegacyPipelineExecutionIdenti…]
- "production_productionlegacypipelineexecutionidentity_versionedproductionpipelineexecutionidentity": "VersionedProductionPipelineExecutionIdentity" | kind=code-symbol | source=src/lib/production/ProductionLegacyPipelineExecutionIdentity.ts:L9 | neighbors=[ProductionLegacyPipelineExecutionIdenti…]
- "production_productionoperationjournal_publicevent": "publicEvent()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L10 | neighbors=[ProductionOperationJournal.ts]
- "production_productionoperationjournal_samebinding": "sameBinding()" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L7 | neighbors=[ProductionOperationJournal.ts]
- "production_productionoperationjournal_terminal": "terminal" | kind=code-symbol | source=src/lib/production/ProductionOperationJournal.ts:L3 | neighbors=[ProductionOperationJournal.ts]
- "production_productionpipelineexecutionadapter_authenticproductionpipelinedurableexecutionerrors": "authenticProductionPipelineDurableExecutionErrors" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L74 | neighbors=[ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutionadapter_productionpipelinedurableexecutionerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L60 | neighbors=[ProductionPipelineDurableExecutionError]
- "production_productionpipelineexecutionadapter_productionpipelineexecutionadapter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L19 | neighbors=[ProductionPipelineExecutionAdapter]
- "production_productionpipelineexecutionadapter_productionpipelineexecutionrequestfactory": "ProductionPipelineExecutionRequestFactory" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L12 | neighbors=[ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutionadapter_productionpipelinefailuresettlement": "ProductionPipelineFailureSettlement" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L15 | neighbors=[ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutionadapter_productionpipelinesettlementresult": "ProductionPipelineSettlementResult" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L13 | neighbors=[ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutionadapter_productionpipelinesuccesssettlement": "ProductionPipelineSuccessSettlement" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionAdapter.ts:L14 | neighbors=[ProductionPipelineExecutionAdapter.ts]
- "production_productionpipelineexecutioncanonicalruntime_canonicalproductionpipelineexecutionregistration": "CanonicalProductionPipelineExecutionRegistration" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L232 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutioncanonicalruntime_claimprocesscanonicallock": "claimProcessCanonicalLock()" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L207 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutioncanonicalruntime_moduleprovenance": "moduleProvenance" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L40 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutioncanonicalruntime_ownsprocesscanonicallock": "ownsProcessCanonicalLock" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L41 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutioncanonicalruntime_processcanonicallockkey": "processCanonicalLockKey" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L37 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutioncanonicalruntime_productionpipelinestageexecutor": "ProductionPipelineStageExecutor" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionCanonicalRuntime.ts:L65 | neighbors=[ProductionPipelineExecutionCanonicalRun…]
- "production_productionpipelineexecutionconfiguration_configureproductionpipelineexecutionoptions": "ConfigureProductionPipelineExecutionOptions" | kind=code-symbol | source=src/lib/production/ProductionPipelineExecutionConfiguration.ts:L31 | neighbors=[ProductionPipelineExecutionConfiguratio…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-134.json

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
