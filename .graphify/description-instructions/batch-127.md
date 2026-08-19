# Node Description Batch 128 of 166

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

- "lib_canonicalsmokeevidence_expectedscenarios": "ExpectedScenarios" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L4 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_hostileenvironmentpolicy": "hostileEnvironmentPolicy" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L77 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_jsonobject": "JsonObject" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L12 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_jsonprimitive": "JsonPrimitive" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L10 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_jsonvalue": "JsonValue" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L11 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_mutablejsonobject": "MutableJsonObject" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L13 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_partitionids": "partitionIds" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L74 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidencev2_compare": "compare()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L64 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_delta": "Delta" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L20 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_evidencevalidationhooks": "EvidenceValidationHooks" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L25 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_hostileenvironmentpolicy": "hostileEnvironmentPolicy" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L46 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_inventoryentry": "InventoryEntry" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L16 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_jsonobject": "JsonObject" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L14 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_mutablerecord": "MutableRecord" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L15 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_productionroot": "productionRoot" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L40 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_runevidenceoptions": "RunEvidenceOptions" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L772 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_serializationpolicyfingerprint": "serializationPolicyFingerprint" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L35 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_sharedroot": "sharedRoot" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L39 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeevidencev2_validationhooks": "validationHooks" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L41 | neighbors=[CanonicalSmokeEvidenceV2.ts]
- "lib_canonicalsmokeruntime_canonicalsmokefinalizationresult": "CanonicalSmokeFinalizationResult" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L69 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_canonicalsmokeinventoryentry": "CanonicalSmokeInventoryEntry" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L178 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_canonicalsmokeownershipmanifest": "CanonicalSmokeOwnershipManifest" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L45 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_canonicalsmokeruntimeoptions": "CanonicalSmokeRuntimeOptions" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L156 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L600 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_defaultenvironment": "defaultEnvironment" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L25 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_environmentsnapshot": "EnvironmentSnapshot" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L173 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_filehash": "fileHash()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L597 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_fileidentity": "FileIdentity" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L174 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_inventorycanonicalsmoketree": "inventoryCanonicalSmokeTree()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L401 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_restoreenvironment": "restoreEnvironment()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L462 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_canonicalsmokeruntime_serializedidentity": "SerializedIdentity" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L176 | neighbors=[CanonicalSmokeRuntime.ts]
- "lib_historicalaudioordinalfourpreflight_historicalaudioauthority": "HistoricalAudioAuthority" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L35 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts]
- "lib_historicalaudioordinalfourpreflight_historicalaudioconsumedreceipt": "HistoricalAudioConsumedReceipt" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L47 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts]
- "lib_historicalaudioordinalfourpreflight_historicalaudioordinalfourpreflight": "HistoricalAudioOrdinalFourPreflight" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L52 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts]
- "lib_historicalaudioordinalfourpreflight_jsonobject": "JsonObject" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L33 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts]
- "lib_historicalaudioordinalfourpreflight_supportedretrybindings": "supportedRetryBindings()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L97 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts]
- "lib_runtime_tracking_inventory_isgitignored": "isGitIgnored()" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L130 | neighbors=[runtime-tracking-inventory.ts]
- "lib_runtime_tracking_inventory_runtimetrackingadmissionreport": "RuntimeTrackingAdmissionReport" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L14 | neighbors=[runtime-tracking-inventory.ts]
- "lib_runtime_tracking_inventory_runtimetrackinginventory": "RuntimeTrackingInventory" | kind=code-symbol | source=scripts/lib/runtime-tracking-inventory.ts:L5 | neighbors=[runtime-tracking-inventory.ts]
- "logger_logger": "logger.ts" | kind=code-symbol | source=src/lib/logger/logger.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-127.json

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
