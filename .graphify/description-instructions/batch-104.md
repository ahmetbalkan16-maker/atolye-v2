# Node Description Batch 105 of 166

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "roadmap_sprint_129_25_c2b4": "Sprint 129.25 C.2B.4 - Operation-Scoped Runtime Context Propagation" | kind=entity | source=ROADMAP.md:722 | neighbors=[Sprint 129.25 C.2B.3 - Production Stora…, Sprint 129.27 - Audio Atomicity, Compen…]
- "roadmap_sprint_129_27": "Sprint 129.27 - Audio Atomicity, Compensation & Publication Hardening" | kind=entity | source=ROADMAP.md:699 | neighbors=[Sprint 129.25 C.2B.4 - Operation-Scoped…, Sprint 129.28 - Production Acceptance R…]
- "roadmap_sprint_129_28": "Sprint 129.28 - Production Acceptance Reauthorization and Durable Identity Auth…" | kind=entity | source=ROADMAP.md:684 | neighbors=[Runtime Backup Long-Path, V3 Runtime Au…, Sprint 129.27 - Audio Atomicity, Compen…]
- "roadmap_sprint_129_5": "Sprint 129.5 - Production Acceptance Topic Input Contract" | kind=entity | source=ROADMAP.md:2521 | neighbors=[Sprint 129 - Production Environment Bin…, Sprint 129.7 - Research Structured Outp…]
- "roadmap_sprint_129_7": "Sprint 129.7 - Research Structured Output Reliability Hardening" | kind=entity | source=ROADMAP.md:2538 | neighbors=[Sprint 129.5 - Production Acceptance To…, Sprint 129.9 - Failed-Stage Resume Reco…]
- "roadmap_sprint_129_9": "Sprint 129.9 - Failed-Stage Resume Reconciliation Hardening" | kind=entity | source=ROADMAP.md:2555 | neighbors=[Sprint 129.19 - Visuals Structured Outp…, Sprint 129.7 - Research Structured Outp…]
- "roadmap_sprint_130_1": "Sprint 130.1 - Real Photo Source Quality & Reliability Follow-up" | kind=entity | source=ROADMAP.md:29 | neighbors=[Sprint 130 - Wikimedia Commons Real Pho…, Sprint 130.2 - Real Photo Source Downlo…]
- "roadmap_sprint_43": "Sprint 43 - Audio Engine Foundation" | kind=entity | source=ROADMAP.md:918 | neighbors=[Sprint 114 - Production Narration Audio…, Sprint 48 - Final Pipeline Integration]
- "roadmap_sprint_44": "Sprint 44 - Assembly Engine Foundation" | kind=entity | source=ROADMAP.md:932 | neighbors=[Sprint 115 - Production Video Assembly …, Sprint 48 - Final Pipeline Integration]
- "roadmap_sprint_54": "Sprint 54 - Pipeline Retry & Resume Planning Foundation" | kind=entity | source=ROADMAP.md:1066 | neighbors=[Sprint 48 - Final Pipeline Integration, Sprint 64 - Pipeline Queue / Job Manage…]
- "roadmap_sprint_64": "Sprint 64 - Pipeline Queue / Job Management Foundation" | kind=entity | source=ROADMAP.md:1206 | neighbors=[Sprint 54 - Pipeline Retry & Resume Pla…, Sprint 66 - Pipeline Queue Scheduler]
- "roadmap_sprint_66": "Sprint 66 - Pipeline Queue Scheduler" | kind=entity | source=ROADMAP.md:1242 | neighbors=[Sprint 64 - Pipeline Queue / Job Manage…, Sprint 77 - Pipeline Execution History …]
- "roadmap_sprint_77": "Sprint 77 - Pipeline Execution History Foundation" | kind=entity | source=ROADMAP.md:1432 | neighbors=[Sprint 66 - Pipeline Queue Scheduler, Sprint 83 - Pipeline Job State Consiste…]
- "roadmap_sprint_83": "Sprint 83 - Pipeline Job State Consistency" | kind=entity | source=ROADMAP.md:1530 | neighbors=[Sprint 77 - Pipeline Execution History …, Sprint 93 - Pipeline Orchestration Foun…]
- "roadmap_sprint_93": "Sprint 93 - Pipeline Orchestration Foundation" | kind=entity | source=ROADMAP.md:1770 | neighbors=[Sprint 83 - Pipeline Job State Consiste…, Sprint 98.0 - Production Execution Pers…]
- "roadmap_sprint_98_0": "Sprint 98.0 - Production Execution Persistence Adapter Foundation" | kind=entity | source=ROADMAP.md:1829 | neighbors=[Sprint 93 - Pipeline Orchestration Foun…, Sprint 99.1 - Durable Storage Recovery …]
- "runtime_productionruntimecompositionroot_initializeproductionprocessruntime": "initializeProductionProcessRuntime()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L39 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimecompositionroot_isnodeerror": "isNodeError()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L70 | neighbors=[ProductionRuntimeCompositionRoot.ts, listProjectSlugsReadOnly()]
- "runtime_productionruntimecompositionroot_listprojectslugsreadonly": "listProjectSlugsReadOnly()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L60 | neighbors=[ProductionRuntimeCompositionRoot.ts, isNodeError()]
- "runtime_productionruntimecompositionroot_shutdownproductionprocessruntime": "shutdownProductionProcessRuntime()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L56 | neighbors=[ProductionRuntimeCompositionRoot.ts, run-production-acceptance.ts]
- "runtime_productionruntimeoperationcontext_messagefor": "messageFor()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L213 | neighbors=[ProductionRuntimeOperationContext.ts, .constructor()]
- "runtime_productionruntimeoperationcontext_normalizedpath": "normalizedPath()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L204 | neighbors=[ProductionRuntimeOperationContext.ts, createAuthorityIdentity()]
- "runtime_productionruntimeoperationcontext_productionruntimeoperationcontexterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L20 | neighbors=[ProductionRuntimeOperationContextError, messageFor()]
- "runtime_runtimeoperationscope_ispromiselike": "isPromiseLike()" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L112 | neighbors=[RuntimeOperationScope.ts, runWithProductionRuntimeOperationContex…]
- "runtime_runtimeoperationscope_runtimeoperationscopebinding": "RuntimeOperationScopeBinding" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L11 | neighbors=[RuntimeOperationScope.ts, RuntimeOperationScopeStore]
- "runtime_runtimeoperationscope_runtimeoperationscopestore": "RuntimeOperationScopeStore" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L20 | neighbors=[RuntimeOperationScope.ts, RuntimeOperationScopeBinding]
- "runtime_runtimestoragepaths_getlegacyprojectsroot": "getLegacyProjectsRoot()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L204 | neighbors=[RuntimeStoragePaths.ts, createRuntimeStorageContext()]
- "runtime_runtimestoragepaths_messagefor": "messageFor()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L764 | neighbors=[RuntimeStoragePaths.ts, .constructor()]
- "runtime_runtimestoragepaths_runtimestorageconfiguration": "RuntimeStorageConfiguration" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L32 | neighbors=[RuntimeStoragePaths.ts, RuntimeStorageContext]
- "runtime_runtimestoragepaths_runtimestorageerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L74 | neighbors=[RuntimeStorageError, messageFor()]
- "runtime_runtimestoragepaths_validconfiguredroot": "validConfiguredRoot()" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L698 | neighbors=[RuntimeStoragePaths.ts, createRuntimeStorageContext()]
- "scripts_production_intelligence_fixture_known": "known()" | kind=code-symbol | source=scripts/production-intelligence-fixture.ts:L5 | neighbors=[production-intelligence-fixture.ts, intelligenceFixture()]
- "scripts_production_intelligence_fixture_missing": "missing()" | kind=code-symbol | source=scripts/production-intelligence-fixture.ts:L6 | neighbors=[production-intelligence-fixture.ts, intelligenceFixture()]
- "scripts_reconcile_fatih_129_45_backfill_backfillstage": "backfillStage()" | kind=code-symbol | source=scripts/reconcile-fatih-129-45-backfill.ts:L25 | neighbors=[reconcile-fatih-129-45-backfill.ts, main()]
- "scripts_reconcile_fatih_129_45_backfill_main": "main()" | kind=code-symbol | source=scripts/reconcile-fatih-129-45-backfill.ts:L87 | neighbors=[reconcile-fatih-129-45-backfill.ts, backfillStage()]
- "scripts_run_canonical_smoke_validation_dataprojectsgitstate": "dataProjectsGitState()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L142 | neighbors=[run-canonical-smoke-validation.ts, runHarness()]
- "scripts_run_canonical_smoke_validation_discoverremainders": "discoverRemainders()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L133 | neighbors=[run-canonical-smoke-validation.ts, runHarness()]
- "scripts_run_canonical_smoke_validation_filehash": "fileHash()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L167 | neighbors=[run-canonical-smoke-validation.ts, digest()]
- "scripts_run_canonical_smoke_validation_hostileenvironment": "hostileEnvironment()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L149 | neighbors=[run-canonical-smoke-validation.ts, runHarness()]
- "scripts_run_production_acceptance_isolatedclievidencedependencies": "isolatedCliEvidenceDependencies()" | kind=code-symbol | source=scripts/run-production-acceptance.ts:L8 | neighbors=[run-production-acceptance.ts, main()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-104.json

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
