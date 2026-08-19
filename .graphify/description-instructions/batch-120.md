# Node Description Batch 121 of 166

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

- "types_productionexecutionworker_productionexecutionworkerpolicy": "ProductionExecutionWorkerPolicy" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L5 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerreasoncode": "ProductionExecutionWorkerReasonCode" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L7 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerresultenvelope": "ProductionExecutionWorkerResultEnvelope" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L10 | neighbors=[ProductionExecutionWorker.ts, productionExecutionWorker.ts]
- "types_productionexecutionworker_productionexecutionworkerschemaversion": "productionExecutionWorkerSchemaVersion" | kind=code-symbol | source=src/types/productionExecutionWorker.ts:L2 | neighbors=[smoke-production-execution-phase-review…, productionExecutionWorker.ts]
- "types_productionhealth_productionhealthcounts": "ProductionHealthCounts" | kind=code-symbol | source=src/types/productionHealth.ts:L61 | neighbors=[ProductionHealthEngine.ts, productionHealth.ts]
- "types_productionhealth_productionhealthfindinginput": "ProductionHealthFindingInput" | kind=code-symbol | source=src/types/productionHealth.ts:L122 | neighbors=[ProductionHealthRules.ts, productionHealth.ts]
- "types_productionhealth_productionhealthrulecategory": "ProductionHealthRuleCategory" | kind=code-symbol | source=src/types/productionHealth.ts:L24 | neighbors=[ProductionHealthRules.ts, productionHealth.ts]
- "types_productionhealth_productionhealthsourceconfidence": "ProductionHealthSourceConfidence" | kind=code-symbol | source=src/types/productionHealth.ts:L73 | neighbors=[ProductionHealthEngine.ts, productionHealth.ts]
- "types_productionintelligence_productiondependencyedge": "ProductionDependencyEdge" | kind=code-symbol | source=src/types/productionIntelligence.ts:L33 | neighbors=[ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionintelligence_productiondependencynode": "ProductionDependencyNode" | kind=code-symbol | source=src/types/productionIntelligence.ts:L26 | neighbors=[ProductionIntelligenceConsumer.ts, productionIntelligence.ts]
- "types_productionoperationjournal_productionoperationjournaleventtype": "ProductionOperationJournalEventType" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L2 | neighbors=[ProductionOperationJournal.ts, productionOperationJournal.ts]
- "types_productionoperationjournal_productionoperationjournalpolicy": "ProductionOperationJournalPolicy" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L5 | neighbors=[ProductionOperationJournal.ts, productionOperationJournal.ts]
- "types_productionoperationjournal_productionoperationjournalprojectionresult": "ProductionOperationJournalProjectionResult" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L8 | neighbors=[ProductionOperationJournal.ts, productionOperationJournal.ts]
- "types_productionoperationjournal_productionoperationjournalreasoncode": "ProductionOperationJournalReasonCode" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L6 | neighbors=[ProductionOperationJournal.ts, productionOperationJournal.ts]
- "types_productionoperationjournal_productionoperationjournalvalidationresult": "ProductionOperationJournalValidationResult" | kind=code-symbol | source=src/types/productionOperationJournal.ts:L7 | neighbors=[ProductionOperationJournal.ts, productionOperationJournal.ts]
- "types_productionreadiness_productionreadinesscheck": "ProductionReadinessCheck" | kind=code-symbol | source=src/types/productionReadiness.ts:L49 | neighbors=[ProductionReadinessService.ts, productionReadiness.ts]
- "types_productionreadiness_productionreadinesscheckid": "ProductionReadinessCheckId" | kind=code-symbol | source=src/types/productionReadiness.ts:L10 | neighbors=[ProductionReadinessService.ts, productionReadiness.ts]
- "types_productionreadiness_productionreadinesscheckids": "productionReadinessCheckIds" | kind=code-symbol | source=src/types/productionReadiness.ts:L39 | neighbors=[ProductionReadinessService.ts, productionReadiness.ts]
- "types_productionreadiness_productionreadinessschemaversion": "productionReadinessSchemaVersion" | kind=code-symbol | source=src/types/productionReadiness.ts:L1 | neighbors=[ProductionReadinessService.ts, productionReadiness.ts]
- "types_productionreadiness_productionreadinessstatus": "ProductionReadinessStatus" | kind=code-symbol | source=src/types/productionReadiness.ts:L3 | neighbors=[ProductionReadinessService.ts, productionReadiness.ts]
- "types_productionruntimehealth_productionruntimehealthstatus": "ProductionRuntimeHealthStatus" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L5 | neighbors=[route.ts, productionRuntimeHealth.ts]
- "types_productionruntimehealth_productionruntimehealthyresponse": "ProductionRuntimeHealthyResponse" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L18 | neighbors=[productionRuntimeHealth.ts, ProductionRuntimeHealthResponseBase]
- "types_productionruntimehealth_productionruntimenonhealthyresponse": "ProductionRuntimeNonHealthyResponse" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L25 | neighbors=[productionRuntimeHealth.ts, ProductionRuntimeHealthResponseBase]
- "types_productionruntimehealth_productionruntimeunavailableresponse": "ProductionRuntimeUnavailableResponse" | kind=code-symbol | source=src/types/productionRuntimeHealth.ts:L32 | neighbors=[productionRuntimeHealth.ts, ProductionRuntimeHealthResponseBase]
- "types_productionruntimeinitialization_productionruntimeinitializationresult": "ProductionRuntimeInitializationResult" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L47 | neighbors=[ProductionRuntimeInitializer.ts, productionRuntimeInitialization.ts]
- "types_productionruntimeinitialization_productionruntimeprojectbootstrapresult": "ProductionRuntimeProjectBootstrapResult" | kind=code-symbol | source=src/types/productionRuntimeInitialization.ts:L16 | neighbors=[ProductionRuntimeInitializer.ts, productionRuntimeInitialization.ts]
- "types_productionruntimestatus_productionruntimeinitializationfailurestatus": "ProductionRuntimeInitializationFailureStatus" | kind=code-symbol | source=src/types/productionRuntimeStatus.ts:L5 | neighbors=[ProductionWorkerLifecycle.ts, productionRuntimeStatus.ts]
- "types_productionsnapshot_productionsnapshotcoveragemetric": "ProductionSnapshotCoverageMetric" | kind=code-symbol | source=src/types/productionSnapshot.ts:L148 | neighbors=[ProductionSnapshotContract.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshothistory": "ProductionSnapshotHistory" | kind=code-symbol | source=src/types/productionSnapshot.ts:L129 | neighbors=[ProductionSnapshotParts.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotpipeline": "ProductionSnapshotPipeline" | kind=code-symbol | source=src/types/productionSnapshot.ts:L75 | neighbors=[ProductionSnapshotParts.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotproject": "ProductionSnapshotProject" | kind=code-symbol | source=src/types/productionSnapshot.ts:L66 | neighbors=[ProductionSnapshotBuilder.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotschemaversion": "productionSnapshotSchemaVersion" | kind=code-symbol | source=src/types/productionSnapshot.ts:L11 | neighbors=[ProductionSnapshotBuilder.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotsourcestatus": "ProductionSnapshotSourceStatus" | kind=code-symbol | source=src/types/productionSnapshot.ts:L34 | neighbors=[ProductionSnapshotContract.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotstagehistorysummary": "ProductionSnapshotStageHistorySummary" | kind=code-symbol | source=src/types/productionSnapshot.ts:L120 | neighbors=[ProductionSnapshotParts.ts, productionSnapshot.ts]
- "types_productionsnapshot_productionsnapshotusage": "ProductionSnapshotUsage" | kind=code-symbol | source=src/types/productionSnapshot.ts:L155 | neighbors=[ProductionSnapshotParts.ts, productionSnapshot.ts]
- "types_productionsnapshot_projectcompletionconsistency": "ProjectCompletionConsistency" | kind=code-symbol | source=src/types/productionSnapshot.ts:L48 | neighbors=[ProductionSnapshotContract.ts, productionSnapshot.ts]
- "types_productionworkerlifecycle_productionworkerlifecycleresult": "ProductionWorkerLifecycleResult" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L27 | neighbors=[ProductionWorkerLifecycle.ts, productionWorkerLifecycle.ts]
- "types_productionworkerlifecycle_productionworkerlifecyclestartrequest": "ProductionWorkerLifecycleStartRequest" | kind=code-symbol | source=src/types/productionWorkerLifecycle.ts:L36 | neighbors=[ProductionWorkerLifecycle.ts, productionWorkerLifecycle.ts]
- "types_project_projectpackagemanifest": "ProjectPackageManifest" | kind=code-symbol | source=src/types/project.ts:L51 | neighbors=[ProjectManager.ts, project.ts]
- "types_thumbnail_thumbnailgenerationinfo": "ThumbnailGenerationInfo" | kind=code-symbol | source=src/types/thumbnail.ts:L48 | neighbors=[ThumbnailManager.ts, thumbnail.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-120.json

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
