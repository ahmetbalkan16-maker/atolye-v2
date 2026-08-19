# Node Description Batch 89 of 166

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

- "health_productionhealthmetricrules_productionhealthmetricrules": "productionHealthMetricRules" | kind=code-symbol | source=src/lib/production/health/ProductionHealthMetricRules.ts:L8 | neighbors=[ProductionHealthMetricRules.ts, ProductionHealthEngine.ts]
- "health_productionhealthrules_categoryfromscope": "categoryFromScope()" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L52 | neighbors=[ProductionHealthRules.ts, snapshotFindingToHealth()]
- "health_productionhealthrules_productionhealththresholds": "productionHealthThresholds" | kind=code-symbol | source=src/lib/production/health/ProductionHealthRules.ts:L9 | neighbors=[ProductionHealthMetricRules.ts, ProductionHealthRules.ts]
- "health_route_islifecyclestate": "isLifecycleState()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L126 | neighbors=[route.ts, validRuntimeSnapshotBase()]
- "health_route_validinitializationfailure": "validInitializationFailure()" | kind=code-symbol | source=app/api/runtime/health/route.ts:L137 | neighbors=[route.ts, readinessIsConsistent()]
- "history_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/history/route.ts:L66 | neighbors=[route.ts, GET()]
- "jobid_route_ispipelinejobaction": "isPipelineJobAction()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L142 | neighbors=[route.ts, POST()]
- "jobid_route_issafejobid": "isSafeJobId()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L150 | neighbors=[route.ts, POST()]
- "jobid_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L146 | neighbors=[route.ts, POST()]
- "jobid_route_readactionbody": "readActionBody()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L126 | neighbors=[route.ts, POST()]
- "jobs_route_issafeslug": "isSafeSlug()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/route.ts:L66 | neighbors=[route.ts, GET()]
- "lib_canonicalsmokeevidence_canonicalsmokechildspec": "CanonicalSmokeChildSpec" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L5 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidence_canonicalsmokepartitions": "canonicalSmokePartitions" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L75 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidence_canonicalsmokepartitionspec": "CanonicalSmokePartitionSpec" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L9 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidence_canonicalsmokeregistryfingerprint": "canonicalSmokeRegistryFingerprint" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L102 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidence_childtimeoutpolicyfingerprint": "childTimeoutPolicyFingerprint" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L104 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidence_hostileenvironmentpolicyfingerprint": "hostileEnvironmentPolicyFingerprint" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L103 | neighbors=[CanonicalSmokeEvidence.ts, CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_recordedtemporaryidentity": "RecordedTemporaryIdentity" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L23 | neighbors=[CanonicalSmokeEvidenceV2.ts, Identity]
- "lib_canonicalsmokeevidencev2_setcanonicalevidencevalidationhooks": "setCanonicalEvidenceValidationHooks()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L43 | neighbors=[CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeruntime_applyenvironment": "applyEnvironment()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L457 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_deserialize": "deserialize()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L568 | neighbors=[CanonicalSmokeRuntime.ts, recoverCanonicalSmokeWorkspace()]
- "lib_canonicalsmokeruntime_frozenrecord": "frozenRecord()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L591 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_injectfailure": "injectFailure()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L485 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_isprocessalive": "isProcessAlive()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L551 | neighbors=[CanonicalSmokeRuntime.ts, recoverCanonicalSmokeWorkspace()]
- "lib_canonicalsmokeruntime_requirecanonicalsmokeoperationcontext": "requireCanonicalSmokeOperationContext()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L110 | neighbors=[CanonicalSmokeRuntime.ts, smoke-canonical-smoke-runtime-foundatio…]
- "lib_canonicalsmokeruntime_rootevidence": "RootEvidence" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L67 | neighbors=[CanonicalSmokeRuntime.ts, serialize()]
- "lib_canonicalsmokeruntime_runrestores": "runRestores()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L476 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_safename": "safeName()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L586 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_snapshotenvironment": "snapshotEnvironment()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L453 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_stablejson": "stableJson()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L537 | neighbors=[CanonicalSmokeRuntime.ts, manifestHash()]
- "lib_canonicalsmokeruntime_withcleanupstate": "withCleanupState()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L522 | neighbors=[CanonicalSmokeRuntime.ts, manifestHash()]
- "lib_canonicalsmokeruntime_writemanifest": "writeManifest()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L545 | neighbors=[CanonicalSmokeRuntime.ts, setupCanonicalSmokeRuntime()]
- "lib_historicalaudioordinalfourpreflight_buildcanonicalidentities": "buildCanonicalIdentities()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L108 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, preflightHistoricalAudioOrdinalFour()]
- "lib_historicalaudioordinalfourpreflight_exactversionpaths": "exactVersionPaths()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L64 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, preflightHistoricalAudioOrdinalFour()]
- "lib_historicalaudioordinalfourpreflight_readvalidated": "readValidated()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L69 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, preflightHistoricalAudioOrdinalFour()]
- "lib_historicalaudioordinalfourpreflight_same": "same()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L81 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, preflightHistoricalAudioOrdinalFour()]
- "lib_runtime_tracking_inventory_isallowedignoreddurablepath": "isAllowedIgnoredDurablePath()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L88 | neighbors=[runtime-tracking-inventory.ts, assertRuntimeTrackingAdmission()]
- "lib_runtime_tracking_inventory_relativegitpath": "relativeGitPath()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L120 | neighbors=[runtime-tracking-inventory.ts, collectFiles()]
- "migration_runtimemigrationcandidatemanifest_containshostpath": "containsHostPath()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L445 | neighbors=[RuntimeMigrationCandidateManifest.ts, validateManifest()]
- "migration_runtimemigrationcandidatemanifest_deepfreeze": "deepFreeze()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L451 | neighbors=[RuntimeMigrationCandidateManifest.ts, buildRuntimeMigrationCandidateManifest()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-088.json

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
