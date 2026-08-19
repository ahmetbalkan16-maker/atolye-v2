# Node Description Batch 131 of 166

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

- "production_productionacceptanceexecutionscope_productionacceptanceprovideradaptererror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L48 | neighbors=[ProductionAcceptanceProviderAdapterError]
- "production_productionacceptanceexecutionscope_productionacceptanceprovideradaptererrorcode": "productionAcceptanceProviderAdapterErrorCode" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L43 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_productionacceptanceproviderbinding": "ProductionAcceptanceProviderBinding" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L34 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_productionacceptanceproviderselectionversion": "productionAcceptanceProviderSelectionVersion" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L18 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_provideradapterfactoryname": "ProviderAdapterFactoryName" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L55 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_provideradaptermethods": "providerAdapterMethods" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L270 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_providername": "providerName()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L339 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptanceexecutionscope_providerslots": "providerSlots" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceExecutionScope.ts:L106 | neighbors=[ProductionAcceptanceExecutionScope.ts]
- "production_productionacceptancelegacyadmissioncontext_admittedexecutionstorage": "admittedExecutionStorage" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L22 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…]
- "production_productionacceptancelegacyadmissioncontext_previousretryjobstorage": "previousRetryJobStorage" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L24 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…]
- "production_productionacceptancelegacyadmissioncontext_productionacceptancelegacyadmittedexecution": "ProductionAcceptanceLegacyAdmittedExecution" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L5 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…]
- "production_productionacceptancelegacyadmissioncontext_retryadmissionstorage": "retryAdmissionStorage" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L25 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…]
- "production_productionacceptancelegacyadmissioncontext_withproductionacceptancelegacypreviousretryjob": "withProductionAcceptanceLegacyPreviousRetryJob()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyAdmissionContext.ts:L39 | neighbors=[ProductionAcceptanceLegacyAdmissionCont…]
- "production_productionacceptancelegacydurablerecoverysnapshot_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L536 | neighbors=[ProductionAcceptanceLegacyDurableRecove…]
- "production_productionacceptancelegacydurablerecoverysnapshot_legacydurablerecoveryauthoritysnapshot": "LegacyDurableRecoveryAuthoritySnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L33 | neighbors=[ProductionAcceptanceLegacyDurableRecove…]
- "production_productionacceptancelegacydurablerecoverysnapshot_terminalattemptstates": "terminalAttemptStates" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L30 | neighbors=[ProductionAcceptanceLegacyDurableRecove…]
- "production_productionacceptancelegacydurablerecoverysnapshot_terminalexecutionstates": "terminalExecutionStates" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyDurableRecoverySnapshot.ts:L31 | neighbors=[ProductionAcceptanceLegacyDurableRecove…]
- "production_productionacceptancelegacyreauthorization_authenticproductionacceptancelegacyreauthorizationerrors": "authenticProductionAcceptanceLegacyReauthorizationErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L99 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_productionacceptancelegacyreauthorizationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L84 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorization_productionacceptancelegacyreauthorizationerrorcode": "ProductionAcceptanceLegacyReauthorizationErrorCode" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorization.ts:L80 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_exactread": "ExactRead" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L246 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_excluded_root_entries": "EXCLUDED_ROOT_ENTRIES" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L47 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancelegacyreauthorizationpreflight_legacymarkerv2value": "LegacyMarkerV2Value" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceLegacyReauthorizationPreflight.ts:L60 | neighbors=[ProductionAcceptanceLegacyReauthorizati…]
- "production_productionacceptancemarkerdescriptorreader_canonicalproductionacceptancemarkerdescriptorsnapshot": "CanonicalProductionAcceptanceMarkerDescriptorSnapshot" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L39 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…]
- "production_productionacceptancemarkerdescriptorreader_descriptorboundfileidentity": "DescriptorBoundFileIdentity" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L31 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…]
- "production_productionacceptancemarkerdescriptorreader_productionacceptancemarkeridentitypolicyversion": "productionAcceptanceMarkerIdentityPolicyVersion" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMarkerDescriptorReader.ts:L8 | neighbors=[ProductionAcceptanceMarkerDescriptorRea…]
- "production_productionacceptancemediavalidation_productionacceptancemediaresult": "ProductionAcceptanceMediaResult" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMediaValidation.ts:L8 | neighbors=[ProductionAcceptanceMediaValidation.ts]
- "production_productionacceptancemediavalidation_productionacceptancemediavalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceMediaValidation.ts:L20 | neighbors=[ProductionAcceptanceMediaValidationError]
- "production_productionacceptanceorchestrator_authenticproductionacceptanceblockederrors": "authenticProductionAcceptanceBlockedErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L132 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_authenticproductionacceptanceconfigurationchangederrors": "authenticProductionAcceptanceConfigurationChangedErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L165 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_authenticproductionacceptanceexecutionerrors": "authenticProductionAcceptanceExecutionErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L141 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_productionacceptanceblockederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L105 | neighbors=[ProductionAcceptanceBlockedError]
- "production_productionacceptanceorchestrator_productionacceptancecompletionreport": "ProductionAcceptanceCompletionReport" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L54 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_productionacceptanceconfigurationchangederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L155 | neighbors=[ProductionAcceptanceConfigurationChange…]
- "production_productionacceptanceorchestrator_productionacceptanceexecutionerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L119 | neighbors=[ProductionAcceptanceExecutionError]
- "production_productionacceptanceorchestrator_productionacceptanceorchestrator_runtimestatus": ".runtimeStatus()" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L366 | neighbors=[ProductionAcceptanceOrchestrator]
- "production_productionacceptanceorchestrator_productionacceptanceproject": "productionAcceptanceProject" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L48 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptanceorchestrator_productionacceptancerequest": "ProductionAcceptanceRequest" | kind=code-symbol | source=src/lib/production/ProductionAcceptanceOrchestrator.ts:L97 | neighbors=[ProductionAcceptanceOrchestrator.ts]
- "production_productionacceptancepolicy_authenticproductionacceptancepolicyerrors": "authenticProductionAcceptancePolicyErrors" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L190 | neighbors=[ProductionAcceptancePolicy.ts]
- "production_productionacceptancepolicy_configuration_names": "CONFIGURATION_NAMES" | kind=code-symbol | source=src/lib/production/ProductionAcceptancePolicy.ts:L65 | neighbors=[ProductionAcceptancePolicy.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-130.json

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
