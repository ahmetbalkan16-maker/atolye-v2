# Node Description Batch 66 of 166

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

- "components_styleselector": "StyleSelector.tsx" | kind=code-symbol | source=src/components/StyleSelector.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, StyleSelector(), StyleSelectorProps]
- "fixtures_sprint_129_33_path_race_child_replacementinventoryhash": "replacementInventoryHash()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L161 | neighbors=[sprint-129-33-path-race-child.ts, main(), sha256()]
- "fixtures_sprint_129_33_path_race_child_sha256": "sha256()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L157 | neighbors=[sprint-129-33-path-race-child.ts, main(), replacementInventoryHash()]
- "fixtures_sprint_129_33_pipeline_job_lock_child_main": "main()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-pipeline-job-lock-child.ts:L18 | neighbors=[sprint-129-33-pipeline-job-lock-child.ts, assertOwnershipLoss(), waitFor()]
- "health_productionhealthrules_createhealthfinding": "createHealthFinding()" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L16 | neighbors=[ProductionHealthCoreRules.ts, ProductionHealthMetricRules.ts, ProductionHealthRules.ts]
- "health_productionhealthrules_createrule": "createRule()" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L43 | neighbors=[ProductionHealthCoreRules.ts, ProductionHealthMetricRules.ts, ProductionHealthRules.ts]
- "health_productionhealthrules_snapshotfindingtohealth": "snapshotFindingToHealth()" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L32 | neighbors=[ProductionHealthRules.ts, categoryFromScope(), ProductionHealthEngine.ts]
- "health_route_get": "GET()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L63 | neighbors=[route.ts, createProductionRuntimeHealthResponse(), smoke-production-runtime-health-api.ts]
- "health_route_jsonresponse": "jsonResponse()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L151 | neighbors=[route.ts, createProductionRuntimeHealthResponse(), unavailableResponse()]
- "health_route_projecthealthstatus": "projectHealthStatus()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L67 | neighbors=[route.ts, createProductionRuntimeHealthResponse(), readinessIsConsistent()]
- "health_route_readobservedat": "readObservedAt()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L177 | neighbors=[route.ts, createProductionRuntimeHealthResponse(), validDate()]
- "health_route_unavailableresponse": "unavailableResponse()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L163 | neighbors=[route.ts, createProductionRuntimeHealthResponse(), jsonResponse()]
- "health_route_validdate": "validDate()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L187 | neighbors=[route.ts, readObservedAt(), validOptionalDate()]
- "health_route_validoptionaldate": "validOptionalDate()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L147 | neighbors=[route.ts, validDate(), validRuntimeSnapshotBase()]
- "history_route_get": "GET()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/history/route.ts:L12 | neighbors=[route.ts, isSafeSlug(), smoke-pipeline-state-error-contract.ts]
- "instrumentation": "instrumentation.ts" | kind=code-symbol | source=instrumentation.ts:L1 | neighbors=[af745ac Sprint 109: Process Startup Boo…, register(), ProductionRuntimeCompositionRoot.ts]
- "jobs_route_get": "GET()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/route.ts:L12 | neighbors=[route.ts, isSafeSlug(), smoke-pipeline-state-error-contract.ts]
- "lib_canonicalsmokeevidence_canonicalevidenceerrorcode": "CanonicalEvidenceErrorCode" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L15 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeevidence_canonicalsmokechildren": "canonicalSmokeChildren" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L38 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeevidence_normalizejson": "normalizeJson()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L106 | neighbors=[CanonicalSmokeEvidence.ts, addIntegrity(), canonicalStringify()]
- "lib_canonicalsmokeevidencev2_assertnopartials": "assertNoPartials()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L395 | neighbors=[CanonicalSmokeEvidenceV2.ts, deriveAggregateResult(), validateResume()]
- "lib_canonicalsmokeevidencev2_environmentevidence": "environmentEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L349 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), writeFinal()]
- "lib_canonicalsmokeevidencev2_expectedcontract": "expectedContract()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L400 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), validateMatrixContract()]
- "lib_canonicalsmokeevidencev2_identity": "Identity" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L21 | neighbors=[CanonicalSmokeEvidenceV2.ts, normalizePath(), RecordedTemporaryIdentity]
- "lib_canonicalsmokeevidencev2_inventory": "Inventory" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L19 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), inventoryFromEntries()]
- "lib_canonicalsmokeevidencev2_inventoryfromentries": "inventoryFromEntries()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L318 | neighbors=[CanonicalSmokeEvidenceV2.ts, Inventory, loadInventory()]
- "lib_canonicalsmokeevidencev2_registrationevidence": "registrationEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L355 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), writeFinal()]
- "lib_canonicalsmokeevidencev2_terminal": "terminal()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L440 | neighbors=[CanonicalSmokeEvidenceV2.ts, runChild(), validateChildEvidence()]
- "lib_canonicalsmokeruntime_rejectreparseroot": "rejectReparseRoot()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L434 | neighbors=[CanonicalSmokeRuntime.ts, identitySafeRemoveLeaf(), recoverCanonicalSmokeWorkspace()]
- "lib_canonicalsmokeruntime_sameidentity": "sameIdentity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L572 | neighbors=[CanonicalSmokeRuntime.ts, identitySafeRemoveLeaf(), recoverCanonicalSmokeWorkspace()]
- "lib_canonicalsmokeruntime_serialize": "serialize()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L564 | neighbors=[CanonicalSmokeRuntime.ts, createManifest(), RootEvidence]
- "lib_historicalaudioordinalfourpreflight_createembeddedonlyunexpectedhistoricalaudioordinalfourrecord": "createEmbeddedOnlyUnexpectedHistoricalAudioOrdinalFourRecord()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L512 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, writeJson(), smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourattemptv1binding": "poisonHistoricalAudioOrdinalFourAttemptV1Binding()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L469 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, bodyWithoutIntegrity(), smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourclaimv1binding": "poisonHistoricalAudioOrdinalFourClaimV1Binding()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L451 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, withClaimIntegrity(), smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourleasev2ownership": "poisonHistoricalAudioOrdinalFourLeaseV2Ownership()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L497 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, poisonHistoricalAudioOrdinalFourLease(), smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_poisonhistoricalaudioordinalfourleasev2version": "poisonHistoricalAudioOrdinalFourLeaseV2Version()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L505 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, poisonHistoricalAudioOrdinalFourLease(), smoke-sprint-129-38-cross-stage-settled…]
- "lib_historicalaudioordinalfourpreflight_rewritelease": "rewriteLease()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L348 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, createAlternativeHistoricalAudioOrdinal…, withLeaseIntegrity()]
- "lib_historicalaudioordinalfourpreflight_writejson": "writeJson()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L338 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, createAlternativeHistoricalAudioOrdinal…, createEmbeddedOnlyUnexpectedHistoricalA…]
- "lib_runtime_tracking_inventory_collectfiles": "collectFiles()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L105 | neighbors=[runtime-tracking-inventory.ts, relativeGitPath(), collectRuntimeTrackingInventory()]
- "lib_runtime_tracking_inventory_samepath": "samePath()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L124 | neighbors=[runtime-tracking-inventory.ts, assertRuntimeTrackingAdmission(), collectRuntimeTrackingInventory()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-065.json

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
