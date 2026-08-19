# Node Description Batch 93 of 166

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

- "production_productionacceptancelegacydurablerecoverysnapshot_reservationmatchesclaim": "reservationMatchesClaim()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L441 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings()]
- "production_productionacceptancelegacydurablerecoverysnapshot_reservationmatchesidempotency": "reservationMatchesIdempotency()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L432 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, assertDurableCausalBindings()]
- "production_productionacceptancelegacyreauthorization_isauthenticproductionacceptancelegacyreauthorizationerror": "isAuthenticProductionAcceptanceLegacyReauthorizationError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L100 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_legacyreauthorizationauthorityfile": "legacyReauthorizationAuthorityFile" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L11 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_legacyreauthorizationerrorcodes": "legacyReauthorizationErrorCodes" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L18 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_legacyreauthorizationpublicationreceiptfile": "legacyReauthorizationPublicationReceiptFile" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L13 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_productionacceptanceeffectivemarkerv3profile2": "ProductionAcceptanceEffectiveMarkerV3Profile2" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L108 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_excludeadmittedjob": "excludeAdmittedJob()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L392 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight()]
- "production_productionacceptancelegacyreauthorizationpreflight_inside": "inside()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L492 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight()]
- "production_productionacceptancelegacyreauthorizationpreflight_legacyreauthorizationpreflightdependencies": "LegacyReauthorizationPreflightDependencies" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L93 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_normalizerecoverydependency": "normalizeRecoveryDependency()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L414 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, failure()]
- "production_productionacceptancelegacyreauthorizationpreflight_normalizerecoveryjob": "normalizeRecoveryJob()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L428 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, failure()]
- "production_productionacceptancelegacyreauthorizationpreflight_productionacceptancelegacyreauthorizationsnapshot": "ProductionAcceptanceLegacyReauthorizationSnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L75 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_saferunid": "safeRunId()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L509 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, parseLegacyMarker()]
- "production_productionacceptancelegacyreauthorizationpreflight_safeslug": "safeSlug()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L505 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight()]
- "production_productionacceptancelegacyreauthorizationpreflight_validtimestamp": "validTimestamp()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L513 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, parseLegacyMarker()]
- "production_productionacceptancelegacyreauthorizationservice_buildauthority": "buildAuthority()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L177 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, reauthorizeProductionAcceptanceLegacyMa…]
- "production_productionacceptancelegacyreauthorizationservice_buildreceipt": "buildReceipt()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L243 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, reauthorizeProductionAcceptanceLegacyMa…]
- "production_productionacceptancelegacyreauthorizationservice_legacyreauthorizationplan": "LegacyReauthorizationPlan" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L35 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationservice_legacyreauthorizationresult": "LegacyReauthorizationResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L44 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancemarkerdescriptorreader_descriptorboundfilesnapshot": "DescriptorBoundFileSnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L13 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceMarkerDescriptorRea…]
- "production_productionacceptancemarkerdescriptorreader_insideorequal": "insideOrEqual()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L140 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, readProductionAcceptanceFileDescriptorB…]
- "production_productionacceptancemarkerdescriptorreader_requireexactidentity": "requireExactIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L187 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, readProductionAcceptanceFileDescriptorB…]
- "production_productionacceptanceorchestrator_isauthenticproductionacceptanceblockederror": "isAuthenticProductionAcceptanceBlockedError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L133 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_isauthenticproductionacceptanceconfigurationchangederror": "isAuthenticProductionAcceptanceConfigurationChangedError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L166 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_isauthenticproductionacceptanceexecutionerror": "isAuthenticProductionAcceptanceExecutionError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L143 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_isthumbnailmimetype": "isThumbnailMimeType()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L465 | neighbors=[ProductionAcceptanceOrchestrator.ts, validateProductionAcceptanceRegistryAss…]
- "production_productionacceptanceorchestrator_productionacceptanceboundedresumeresult": "ProductionAcceptanceBoundedResumeResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L79 | neighbors=[ProductionAcceptanceOrchestrator.ts, smoke-sprint-129-39-stage-bounded-resum…]
- "production_productionacceptanceorchestrator_productionacceptanceresumeresult": "ProductionAcceptanceResumeResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L93 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptancepolicy_isauthenticproductionacceptancepolicyerror": "isAuthenticProductionAcceptancePolicyError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L191 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_isdurablecausaladmissionfailure": "isDurableCausalAdmissionFailure()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L674 | neighbors=[ProductionAcceptancePolicy.ts, consumeProductionAcceptanceStageCapabil…]
- "production_productionacceptancepolicy_productionacceptanceconfigurationdiagnostic": "ProductionAcceptanceConfigurationDiagnostic" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L165 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_stageexecutionidentitymismatch": "stageExecutionIdentityMismatch()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L721 | neighbors=[ProductionAcceptancePolicy.ts, consumeProductionAcceptanceStageCapabil…]
- "production_productionacceptancereprepareservice_isauthenticproductionacceptancereprepareerror": "isAuthenticProductionAcceptanceReprepareError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L57 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancereprepareservice_isinside": "isInside()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L208 | neighbors=[ProductionAcceptanceReprepareService.ts, resolveSafeMarkerPaths()]
- "production_productionacceptancereprepareservice_parsejson": "parseJSON()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L204 | neighbors=[ProductionAcceptanceReprepareService.ts, reprepareProductionAcceptanceMarker()]
- "production_productionacceptancereprepareservice_productionacceptancerepreparefileoperations": "ProductionAcceptanceReprepareFileOperations" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L22 | neighbors=[ProductionAcceptanceReprepareService.ts, smoke-sprint-129-24-acceptance-marker-r…]
- "production_productionacceptancereprepareservice_productionacceptancereprepareresult": "ProductionAcceptanceReprepareResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L36 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceReprepareService.ts]
- "production_productionacceptancetopic_isauthenticproductionacceptancetopicerror": "isAuthenticProductionAcceptanceTopicError()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L28 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceTopic.ts]
- "production_productionacceptancetopic_productionacceptancetopiclimits": "productionAcceptanceTopicLimits" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceTopic.ts:L4 | neighbors=[ProductionAcceptanceTopic.ts, smoke-sprint-129-5-production-acceptanc…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-092.json

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
