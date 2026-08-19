# Node Description Batch 99 of 166

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

- "production_productionpipelineterminalsettlement_receiptbindingfailure": "receiptBindingFailure()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L871 | neighbors=[ProductionPipelineTerminalSettlement.ts, finalizeProductionPipelineRetryBudgetEx…]
- "production_productionpipelineterminalsettlement_samereleasedlease": "sameReleasedLease()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L954 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_terminalfailurecode": "terminalFailureCode()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L609 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleFailedProductionPipelineExecution…]
- "production_productionpipelineterminalsettlement_verifyretrybudgetextensionsiblingbinding": "verifyRetryBudgetExtensionSiblingBinding()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L769 | neighbors=[ProductionPipelineTerminalSettlement.ts, readAndVerifyFailedChain()]
- "production_productionpipelineterminalsettlement_withfailedsettlementlock": "withFailedSettlementLock()" | kind=code-symbol | source=src/lib/production/ProductionPipelineTerminalSettlement.ts:L478 | neighbors=[ProductionPipelineTerminalSettlement.ts, settleFailedProductionPipelineExecution…]
- "production_productionplanner_isunreliable": "isUnreliable()" | kind=code-symbol | source=src/lib/production/ProductionPlanner.ts:L21 | neighbors=[ProductionPlanner.ts, .create()]
- "production_productionplanner_productionplanner_create": ".create()" | kind=code-symbol | source=src/lib/production/ProductionPlanner.ts:L7 | neighbors=[ProductionPlanner, isUnreliable()]
- "production_productionqueuedexhausteddriftclassifier_globallyquiescent": "globallyQuiescent()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L104 | neighbors=[ProductionQueuedExhaustedDriftClassifie…, classifyQueuedExhaustedPipelineJobDrift…]
- "production_productionqueuedexhausteddriftclassifier_parsepipelinestageruntype": "parsePipelineStageRunType()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L112 | neighbors=[ProductionQueuedExhaustedDriftClassifie…, classifyQueuedExhaustedPipelineJobDrift…]
- "production_productionqueuedexhausteddriftclassifier_queuedexhausteddriftreasoncode": "queuedExhaustedDriftReasonCode" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L16 | neighbors=[PipelineRunner.ts, ProductionQueuedExhaustedDriftClassifie…]
- "production_productionqueuedexhausteddriftclassifier_reject": "reject()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftClassifier.ts:L28 | neighbors=[ProductionQueuedExhaustedDriftClassifie…, classifyQueuedExhaustedPipelineJobDrift…]
- "production_productionqueuedexhausteddriftrecovery_classify": "classify()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L188 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…, recoverQueuedExhaustedPipelineJobDrift()]
- "production_productionqueuedexhausteddriftrecovery_committedunverified": "committedUnverified()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L55 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…, recoverQueuedExhaustedPipelineJobDrift()]
- "production_productionqueuedexhausteddriftrecovery_createadapter": "createAdapter()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L203 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…, recoverQueuedExhaustedPipelineJobDrift()]
- "production_productionqueuedexhausteddriftrecovery_rejected": "rejected()" | kind=code-symbol | source=src/lib/production/ProductionQueuedExhaustedDriftRecovery.ts:L49 | neighbors=[ProductionQueuedExhaustedDriftRecovery.…, recoverQueuedExhaustedPipelineJobDrift()]
- "production_productionreadinessservice_isexecutablefile": "isExecutableFile()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L701 | neighbors=[ProductionReadinessService.ts, .probeMedia()]
- "production_productionreadinessservice_missingprobechecks": "missingProbeChecks()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L585 | neighbors=[ProductionReadinessService.ts, .evaluate()]
- "production_productionreadinessservice_readinesspng": "readinessPng()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L528 | neighbors=[ProductionReadinessService.ts, probeStorageAdapters()]
- "production_productionreadinessservice_resolvecurrentprocessffmpegconfig": "resolveCurrentProcessFFmpegConfig()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L724 | neighbors=[ProductionReadinessService.ts, .probeMedia()]
- "production_productionreadinessservice_safeconfig": "safeConfig()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L704 | neighbors=[ProductionReadinessService.ts, .modelConfigurationCheck()]
- "production_productionreadinessservice_saferun": "safeRun()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L696 | neighbors=[ProductionReadinessService.ts, .probeMedia()]
- "production_productionreadinessservice_safetimestamp": "safeTimestamp()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L709 | neighbors=[ProductionReadinessService.ts, .evaluate()]
- "production_productionreadinessservice_successful": "successful()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L700 | neighbors=[ProductionReadinessService.ts, .probeMedia()]
- "production_productionreadinessservice_validinteger": "validInteger()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L705 | neighbors=[ProductionReadinessService.ts, .modelConfigurationCheck()]
- "production_productionreadinessservice_validnumber": "validNumber()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L706 | neighbors=[ProductionReadinessService.ts, .modelConfigurationCheck()]
- "production_productionreadinessservice_validprobe": "validProbe()" | kind=code-symbol | source=src/lib/production/ProductionReadinessService.ts:L711 | neighbors=[ProductionReadinessService.ts, .probeMedia()]
- "production_productionregenerationphysicalguard_nearestexisting": "nearestExisting()" | kind=code-symbol | source=src/lib/production/ProductionRegenerationPhysicalGuard.ts:L77 | neighbors=[ProductionRegenerationPhysicalGuard.ts, assertPhysicalTarget()]
- "production_productionruntimeinitializer_emptycounts": "emptyCounts()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L95 | neighbors=[ProductionRuntimeInitializer.ts, .initializeOnce()]
- "production_productionruntimeinitializer_productionruntimeinitializer_initialize": ".initialize()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L20 | neighbors=[ProductionRuntimeInitializer, .initializeOnce()]
- "production_productionruntimeinitializer_productionruntimeinitializerdependencies": "ProductionRuntimeInitializerDependencies" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L6 | neighbors=[ProductionRuntimeInitializer.ts, smoke-production-runtime-startup.ts]
- "production_productionruntimeinitializer_success": "success()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L83 | neighbors=[ProductionRuntimeInitializer.ts, .initializeOnce()]
- "production_productionruntimeinitializer_validbootstrap": "validBootstrap()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L91 | neighbors=[ProductionRuntimeInitializer.ts, .initializeOnce()]
- "production_productionruntimeinitializer_validdate": "validDate()" | kind=code-symbol | source=src/lib/production/ProductionRuntimeInitializer.ts:L96 | neighbors=[ProductionRuntimeInitializer.ts, .initializeOnce()]
- "production_productionsnapshotbuilder_known": "known()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L109 | neighbors=[ProductionSnapshotBuilder.ts, buildProject()]
- "production_productionsnapshotbuilder_productionsnapshotbuilder_build": ".build()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L25 | neighbors=[ProductionSnapshotBuilder, buildProductionSnapshot()]
- "production_productionsnapshotbuilder_unavailable": "unavailable()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotBuilder.ts:L100 | neighbors=[ProductionSnapshotBuilder.ts, buildProject()]
- "production_productionsnapshotcontract_createcanonicalstageorder": "createCanonicalStageOrder()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L113 | neighbors=[ProductionSnapshotContract.ts, smoke-production-snapshot-contract.ts]
- "production_productionsnapshotcontract_createsourcestate": "createSourceState()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotContract.ts:L100 | neighbors=[ProductionSnapshotContract.ts, smoke-production-snapshot-contract.ts]
- "production_productionsnapshotparts_buildstages": "buildStages()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L166 | neighbors=[ProductionSnapshotBuilder.ts, ProductionSnapshotParts.ts]
- "production_productionsnapshotparts_createdistribution": "createDistribution()" | kind=code-symbol | source=src/lib/production/ProductionSnapshotParts.ts:L392 | neighbors=[ProductionSnapshotParts.ts, buildUsage()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-098.json

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
