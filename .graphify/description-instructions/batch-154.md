# Node Description Batch 155 of 166

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

- "scripts_smoke_sprint_129_27_audio_remediation_directorybytesnapshot": "directoryByteSnapshot()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L219 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_latestattemptevidence": "latestAttemptEvidence()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L370 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_logicalfilebytes": "logicalFileBytes()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L175 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_originalenvironment": "originalEnvironment" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L81 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_providerfailure": "providerFailure()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L342 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_providerforsavedaudio": "providerForSavedAudio()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L389 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_replacecanonicalwithforeigncopy": "replaceCanonicalWithForeignCopy()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L695 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_response": "response()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L325 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_restoreenvironment": "restoreEnvironment()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L5468 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_rewriteintent": "rewriteIntent()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L682 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_run": "run()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L1186 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_runrecoverychild": "runRecoveryChild()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L830 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_27_audio_remediation_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-27-audio-remediation.ts:L291 | neighbors=[smoke-sprint-129-27-audio-remediation.ts]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_configuredenvironmentkeys": "configuredEnvironmentKeys" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L164 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_deterministicfixturemp4": "deterministicFixtureMp4()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L554 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_deterministicfixturepng": "deterministicFixturePng()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L571 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_deterministicfixturewav": "deterministicFixtureWav()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L589 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_environment": "environment" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L163 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_fullpipelineairesponse": "fullPipelineAiResponse()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L480 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_jobs": "jobs()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L214 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_main": "main()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1201 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_publishfixture": "publishFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L254 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_recordreadrace": "RecordReadRace" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L1077 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_recovery": "recovery()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L205 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_researchexecutionscope": "researchExecutionScope()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L934 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_rewriteauthority": "rewriteAuthority()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L273 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_rewritedurablerecord": "rewriteDurableRecord()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L282 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L140 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_settledurablefixtureinactive": "settleDurableFixtureInactive()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L295 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_storedfixtureassemblyprovider": "storedFixtureAssemblyProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L598 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_storedfixturethumbnailprovider": "storedFixtureThumbnailProvider()" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L615 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_testadaptercontract": "testAdapterContract" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L432 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_28_production_acceptance_reauthorization_testproviderselections": "testProviderSelections" | kind=code-symbol | source=scripts/smoke-sprint-129-28-production-acceptance-reauthorization.ts:L632 | neighbors=[smoke-sprint-129-28-production-acceptan…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_buildchildenvironment": "buildChildEnvironment()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L170 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childaction": "ChildAction" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L56 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childenvironmentallowlist": "childEnvironmentAllowlist" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L70 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childenvironmentkeys": "childEnvironmentKeys" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L76 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childindex": "childIndex" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L1101 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_childpayload": "ChildPayload" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L57 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]
- "scripts_smoke_sprint_129_29_failed_terminal_settlement_failure": "failure()" | kind=code-symbol | source=scripts/smoke-sprint-129-29-failed-terminal-settlement.ts:L52 | neighbors=[smoke-sprint-129-29-failed-terminal-set…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-154.json

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
