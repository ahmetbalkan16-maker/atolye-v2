# Node Description Batch 142 of 166

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

- "roadmap_wikimedia_commons_client": "WikimediaCommonsClient" | kind=entity | source=ROADMAP.md:58 | neighbors=[RealPhotoImageProvider]
- "router_airouter_airouter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/router/AIRouter.ts:L15 | neighbors=[AIRouter]
- "router_airouter_airouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/ai/router/AIRouter.ts:L23 | neighbors=[AIRouter]
- "runtime_productionruntimecompositionroot_processruntimeinitializer": "processRuntimeInitializer" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L29 | neighbors=[ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimecompositionroot_processruntimeoperationcontext": "processRuntimeOperationContext" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L21 | neighbors=[ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimecompositionroot_processruntimestoragecontext": "processRuntimeStorageContext" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L20 | neighbors=[ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimecompositionroot_productionworkerlifecycle": "productionWorkerLifecycle" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L27 | neighbors=[ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimecompositionroot_runtimenow": "runtimeNow()" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeCompositionRoot.ts:L19 | neighbors=[ProductionRuntimeCompositionRoot.ts]
- "runtime_productionruntimeoperationcontext_createproductionruntimeoperationcontextoptions": "CreateProductionRuntimeOperationContextOptions" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L44 | neighbors=[ProductionRuntimeOperationContext.ts]
- "runtime_productionruntimeoperationcontext_deriveproductionruntimeoperationcontextoptions": "DeriveProductionRuntimeOperationContextOptions" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L51 | neighbors=[ProductionRuntimeOperationContext.ts]
- "runtime_productionruntimeoperationcontext_productionruntimeauthorityidentity": "ProductionRuntimeAuthorityIdentity" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L27 | neighbors=[ProductionRuntimeOperationContext.ts]
- "runtime_productionruntimeoperationcontext_productionruntimeoperationcontexterrorcode": "ProductionRuntimeOperationContextErrorCode" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L14 | neighbors=[ProductionRuntimeOperationContext.ts]
- "runtime_productionruntimeoperationcontext_storagebindings": "storageBindings" | kind=code-symbol | source=src/lib/runtime/ProductionRuntimeOperationContext.ts:L56 | neighbors=[ProductionRuntimeOperationContext.ts]
- "runtime_runtimeoperationscope_operationscope": "operationScope" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L24 | neighbors=[RuntimeOperationScope.ts]
- "runtime_runtimeoperationscope_runtimeoperationscopetoken": "RuntimeOperationScopeToken" | kind=code-symbol | source=src/lib/runtime/RuntimeOperationScope.ts:L16 | neighbors=[RuntimeOperationScope.ts]
- "runtime_runtimestoragepaths_authorityleasebrand": "authorityLeaseBrand" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L14 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_runtimestorageauthorityenvironmentvariable": "runtimeStorageAuthorityEnvironmentVariable" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L56 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_runtimestorageclassification": "RuntimeStorageClassification" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L26 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_runtimestorageerrorcode": "RuntimeStorageErrorCode" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L63 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_runtimestorageresolutionoptions": "RuntimeStorageResolutionOptions" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L49 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_trustedauthorityleases": "trustedAuthorityLeases" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L15 | neighbors=[RuntimeStoragePaths.ts]
- "runtime_runtimestoragepaths_trustedruntimestoragecontexts": "trustedRuntimeStorageContexts" | kind=code-symbol | source=src/lib/runtime/RuntimeStoragePaths.ts:L13 | neighbors=[RuntimeStoragePaths.ts]
- "scenes_page": "page.tsx" | kind=code-symbol | source=app/scenes/page.tsx:L1 | neighbors=[ScenesPage()]
- "scenes_page_scenespage": "ScenesPage()" | kind=code-symbol | source=app/scenes/page.tsx:L1 | neighbors=[page.tsx]
- "script_page_scriptcard": "ScriptCard()" | kind=code-symbol | source=app/script/page.tsx:L148 | neighbors=[page.tsx]
- "script_page_scriptpage": "ScriptPage()" | kind=code-symbol | source=app/script/page.tsx:L8 | neighbors=[page.tsx]
- "scripts_inventory_canonical_smoke_harnesses_classify": "classify()" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L26 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_inventory_canonical_smoke_harnesses_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L63 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_inventory_canonical_smoke_harnesses_files": "files" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L18 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_inventory_canonical_smoke_harnesses_root": "root" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L17 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_inventory_canonical_smoke_harnesses_rows": "rows" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L21 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_inventory_canonical_smoke_harnesses_smokeinventoryrow": "SmokeInventoryRow" | kind=code-symbol | source=scripts/inventory-canonical-smoke-harnesses.ts:L4 | neighbors=[inventory-canonical-smoke-harnesses.ts]
- "scripts_reconcile_fatih_129_45_backfill_stages": "STAGES" | kind=code-symbol | source=scripts/reconcile-fatih-129-45-backfill.ts:L23 | neighbors=[reconcile-fatih-129-45-backfill.ts]
- "scripts_run_canonical_smoke_child_main": "main()" | kind=code-symbol | source=scripts/run-canonical-smoke-child.ts:L11 | neighbors=[run-canonical-smoke-child.ts]
- "scripts_run_canonical_smoke_child_waitfornestedfoundationfinalization": "waitForNestedFoundationFinalization()" | kind=code-symbol | source=scripts/run-canonical-smoke-child.ts:L43 | neighbors=[run-canonical-smoke-child.ts]
- "scripts_run_canonical_smoke_child_withtimeout": "withTimeout()" | kind=code-symbol | source=scripts/run-canonical-smoke-child.ts:L34 | neighbors=[run-canonical-smoke-child.ts]
- "scripts_run_canonical_smoke_evidence_argument": "argument()" | kind=code-symbol | source=scripts/run-canonical-smoke-evidence.ts:L5 | neighbors=[run-canonical-smoke-evidence.ts]
- "scripts_run_canonical_smoke_validation_broad": "broad" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L26 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_run_canonical_smoke_validation_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L170 | neighbors=[run-canonical-smoke-validation.ts]
- "scripts_run_canonical_smoke_validation_expected": "Expected" | kind=code-symbol | source=scripts/run-canonical-smoke-validation.ts:L8 | neighbors=[run-canonical-smoke-validation.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-141.json

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
