# Node Description Batch 69 of 166

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

- "production_productionacceptancelegacyauthoritystore_verifyreceipt": "verifyReceipt()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAuthorityStore.ts:L336 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, readLegacyReauthorizationAuthority(), admissionConflict()]
- "production_productionacceptancelegacydurablerecoverysnapshot_assertadmitteddurablebindings": "assertAdmittedDurableBindings()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L472 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, causal(), assertDurableCausalBindings()]
- "production_productionacceptancelegacydurablerecoverysnapshot_assertadmitteddurableidentitybindings": "assertAdmittedDurableIdentityBindings()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L494 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, causal(), assertDurableCausalBindings()]
- "production_productionacceptancelegacydurablerecoverysnapshot_invalid": "invalid()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L540 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, createLegacyReauthorizationDurableRecov…, readAll()]
- "production_productionacceptancelegacydurablerecoverysnapshot_readall": "readAll()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L222 | neighbors=[ProductionAcceptanceLegacyDurableRecove…, createLegacyReauthorizationDurableRecov…, invalid()]
- "production_productionacceptancelegacyreauthorization_legacyreauthorizationpolicyversion": "legacyReauthorizationPolicyVersion" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L7 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_productionacceptancelegacypublicationreceiptv1": "ProductionAcceptanceLegacyPublicationReceiptV1" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L162 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_reauthorizationdecision": "ReauthorizationDecision" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L181 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_safesha256": "safeSha256()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L202 | neighbors=[ProductionAcceptanceLegacyAuthorityStor…, ProductionAcceptanceLegacyReauthorizati…, ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_identityevidence": "identityEvidence()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L501 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), inventoryFingerprint()]
- "production_productionacceptancelegacyreauthorizationpreflight_normalizerecovery": "normalizeRecovery()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L365 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), failure()]
- "production_productionacceptancelegacyreauthorizationpreflight_realdirectory": "realDirectory()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L448 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), failure()]
- "production_productionacceptancelegacyreauthorizationpreflight_reliable": "reliable()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L497 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, identityOfDirectory(), readExactFile()]
- "production_productionacceptancelegacyreauthorizationpreflight_requiresamecanonicalmarkeridentity": "requireSameCanonicalMarkerIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L475 | neighbors=[ProductionAcceptanceLegacyReauthorizati…, createLegacyReauthorizationPreflight(), failure()]
- "production_productionacceptancelegacyreauthorizationservice_planproductionacceptancelegacyreauthorization": "planProductionAcceptanceLegacyReauthorization()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationService.ts:L52 | neighbors=[ProductionAcceptanceCommand.ts, ProductionAcceptanceLegacyReauthorizati…, smoke-sprint-129-28-production-acceptan…]
- "production_productionacceptancemarkerdescriptorreader_requireplaindirectory": "requirePlainDirectory()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L157 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, readCanonicalProductionAcceptanceMarker…, readProductionAcceptanceFileDescriptorB…]
- "production_productionacceptancemarkerdescriptorreader_requireregulardescriptoridentity": "requireRegularDescriptorIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L169 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, readProductionAcceptanceFileDescriptorB…, identity()]
- "production_productionacceptancemarkerdescriptorreader_requireregularpathidentity": "requireRegularPathIdentity()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L163 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…, readProductionAcceptanceFileDescriptorB…, identity()]
- "production_productionacceptancemediavalidation_productionacceptancemediavalidationerror": "ProductionAcceptanceMediaValidationError" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMediaValidation.ts:L17 | neighbors=[ProductionAcceptanceMediaValidation.ts, .constructor(), validateProductionAcceptanceMedia()]
- "production_productionacceptancemediavalidation_validateproductionacceptancemedia": "validateProductionAcceptanceMedia()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMediaValidation.ts:L27 | neighbors=[ProductionAcceptanceMediaValidation.ts, ProductionAcceptanceMediaValidationError, ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_productionacceptanceorchestrator_evaluatereadiness": ".evaluateReadiness()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L229 | neighbors=[ProductionAcceptanceOrchestrator, .resumeAndFinalize(), .run()]
- "production_productionacceptanceorchestrator_requireuniqueasset": "requireUniqueAsset()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L459 | neighbors=[ProductionAcceptanceOrchestrator.ts, ProductionAcceptanceExecutionError, validateProductionAcceptanceRegistryAss…]
- "production_productionacceptancepolicy_descriptorbinding": "descriptorBinding()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1019 | neighbors=[ProductionAcceptancePolicy.ts, resolveEffectiveProductionAcceptanceAut…, sameDescriptor()]
- "production_productionacceptancepolicy_samecomponentfingerprints": "sameComponentFingerprints()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1383 | neighbors=[ProductionAcceptancePolicy.ts, createProductionAcceptanceMarkerV3(), markerMatchesCurrentConfiguration()]
- "production_productionacceptancepolicy_samedescriptor": "sameDescriptor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L1024 | neighbors=[ProductionAcceptancePolicy.ts, resolveEffectiveProductionAcceptanceAut…, descriptorBinding()]
- "production_productionacceptancepreflight_positiveinteger": "positiveInteger()" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePreflight.ts:L221 | neighbors=[ProductionAcceptancePreflight.ts, validateProductionAcceptancePreflight(), validateProductionSceneAudioMapping()]
- "production_productionacceptancereprepareservice_resolvesafemarkerpaths": "resolveSafeMarkerPaths()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L179 | neighbors=[ProductionAcceptanceReprepareService.ts, reprepareProductionAcceptanceMarker(), isInside()]
- "production_productionacceptancereprepareservice_restoreoriginalmarker": "restoreOriginalMarker()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L146 | neighbors=[ProductionAcceptanceReprepareService.ts, reprepareProductionAcceptanceMarker(), writeSyncedTemporary()]
- "production_productionacceptancereprepareservice_writesyncedtemporary": "writeSyncedTemporary()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceReprepareService.ts:L165 | neighbors=[ProductionAcceptanceReprepareService.ts, reprepareProductionAcceptanceMarker(), restoreOriginalMarker()]
- "production_productioncanonicaldurablelineage_readlatestversioned": "readLatestVersioned()" | kind=code-symbol | source=src/lib/production/ProductionCanonicalDurableLineage.ts:L115 | neighbors=[ProductionCanonicalDurableLineage.ts, escapeRegularExpression(), readProductionCanonicalTerminalDurableL…]
- "production_productioncompletedstageregenerationgraph_getproductionregenerationclosure": "getProductionRegenerationClosure()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationGraph.ts:L7 | neighbors=[ProductionCompletedStageRegenerationGra…, ProductionCompletedStageRegenerationPla…, smoke-sprint-129-41-completed-stage-reg…]
- "production_productioncompletedstageregenerationpaths_regenerationprojectfolder": "regenerationProjectFolder()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPaths.ts:L7 | neighbors=[ProductionCompletedStageRegenerationPat…, regenerationRoot(), ProductionCompletedStageRegenerationSto…]
- "production_productioncompletedstageregenerationplanner_requiredfilehash": "requiredFileHash()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L221 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan(), ProductionRegenerationPlanError]
- "production_productioncompletedstageregenerationplanner_validatenoexternalpublication": "validateNoExternalPublication()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationPlanner.ts:L157 | neighbors=[ProductionCompletedStageRegenerationPla…, createCompletedStageRegenerationPlan(), ProductionRegenerationPlanError]
- "production_productioncompletedstageregenerationservice_filehash": "fileHash()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L437 | neighbors=[ProductionCompletedStageRegenerationSer…, applyMutation(), assertMutation()]
- "production_productioncompletedstageregenerationservice_validaterequest": "validateRequest()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationService.ts:L406 | neighbors=[ProductionCompletedStageRegenerationSer…, prepareCompletedStageRegeneration(), ProductionRegenerationPreparationError]
- "production_productioncompletedstageregenerationstore_collectassetids": "collectAssetIds()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L449 | neighbors=[ProductionCompletedStageRegenerationSto…, buildAudioPreservationFingerprint(), recordRegeneratedPackageCompletion()]
- "production_productioncompletedstageregenerationstore_collectregenerationpredecessorassetevidence": "collectRegenerationPredecessorAssetEvidence()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L368 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, validateSupersessionIntent()]
- "production_productioncompletedstageregenerationstore_isregenerationcompleted": "isRegenerationCompleted()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L63 | neighbors=[ProductionCompletedStageRegenerationPla…, ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…]
- "production_productioncompletedstageregenerationstore_writeonce": "writeOnce()" | kind=code-symbol | source=src/lib/production/ProductionCompletedStageRegenerationStore.ts:L424 | neighbors=[ProductionCompletedStageRegenerationSer…, ProductionCompletedStageRegenerationSto…, writeJsonOnce()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-068.json

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
