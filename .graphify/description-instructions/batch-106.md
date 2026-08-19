# Node Description Batch 107 of 166

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

- "scripts_smoke_production_audio_asset_wiring_createproductionstreamingsentinelwav": "createProductionStreamingSentinelWav()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L295 | neighbors=[smoke-production-audio-asset-wiring.ts, createWavChunk()]
- "scripts_smoke_production_audio_asset_wiring_createriff": "createRiff()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L215 | neighbors=[smoke-production-audio-asset-wiring.ts, createWav()]
- "scripts_smoke_production_audio_asset_wiring_createstoredopenairesult": "createStoredOpenAIResult()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L263 | neighbors=[smoke-production-audio-asset-wiring.ts, createWav()]
- "scripts_smoke_production_audio_asset_wiring_expectsafefailure": "expectSafeFailure()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L341 | neighbors=[smoke-production-audio-asset-wiring.ts, readAssets()]
- "scripts_smoke_production_audio_asset_wiring_scenario": "scenario()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L171 | neighbors=[smoke-production-audio-asset-wiring.ts, run()]
- "scripts_smoke_production_audio_asset_wiring_setenvironment": "setEnvironment()" | kind=code-symbol | source=scripts/smoke-production-audio-asset-wiring.ts:L179 | neighbors=[smoke-production-audio-asset-wiring.ts, run()]
- "scripts_smoke_production_controlled_execution_gateway_main": "main()" | kind=code-symbol | source=scripts/smoke-production-controlled-execution-gateway.ts:L1 | neighbors=[smoke-production-controlled-execution-g…, run()]
- "scripts_smoke_production_controlled_execution_gateway_run": "run()" | kind=code-symbol | source=scripts/smoke-production-controlled-execution-gateway.ts:L1 | neighbors=[smoke-production-controlled-execution-g…, main()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_canonicalclaim": "canonicalClaim()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L96 | neighbors=[smoke-production-durable-attempt-lineag…, createFixture()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_identityfor": "identityFor()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L148 | neighbors=[smoke-production-durable-attempt-lineag…, canonicalRecord()]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_journal": "journal()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L138 | neighbors=[smoke-production-durable-attempt-lineag…, canonicalAttempt()]
- "scripts_smoke_production_end_to_end_corruptfile": "corruptFile()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L181 | neighbors=[smoke-production-end-to-end.ts, run()]
- "scripts_smoke_production_end_to_end_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L298 | neighbors=[smoke-production-end-to-end.ts, pngChunk()]
- "scripts_smoke_production_end_to_end_imageprovider": "ImageProvider" | kind=code-symbol | neighbors=[StoredImageProvider, ThrowingImageProvider]
- "scripts_smoke_production_end_to_end_mutateassets": "mutateAssets()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L177 | neighbors=[smoke-production-end-to-end.ts, run()]
- "scripts_smoke_production_end_to_end_readjson": "readJson()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L190 | neighbors=[smoke-production-end-to-end.ts, run()]
- "scripts_smoke_production_end_to_end_requirefixtureroot": "requireFixtureRoot()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L210 | neighbors=[smoke-production-end-to-end.ts, removeOwnedFixture()]
- "scripts_smoke_production_end_to_end_restoreassets": "restoreAssets()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L180 | neighbors=[smoke-production-end-to-end.ts, run()]
- "scripts_smoke_production_end_to_end_stabilization_box": "box()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L273 | neighbors=[smoke-production-end-to-end-stabilizati…, minimalMp4()]
- "scripts_smoke_production_end_to_end_stabilization_crc32": "crc32()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L276 | neighbors=[smoke-production-end-to-end-stabilizati…, pngChunk()]
- "scripts_smoke_production_end_to_end_stabilization_stagefile": "stageFile()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L225 | neighbors=[smoke-production-end-to-end-stabilizati…, markAllCompleted()]
- "scripts_smoke_production_end_to_end_storedassemblyprovider_assemble": ".assemble()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L265 | neighbors=[StoredAssemblyProvider, mp4()]
- "scripts_smoke_production_end_to_end_storedaudioprovider_generateaudio": ".generateAudio()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L246 | neighbors=[StoredAudioProvider, wav()]
- "scripts_smoke_production_end_to_end_storedimageprovider_generateimage": ".generateImage()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L232 | neighbors=[StoredImageProvider, png()]
- "scripts_smoke_production_end_to_end_storedthumbnailprovider_generatethumbnailasset": ".generateThumbnailAsset()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L278 | neighbors=[StoredThumbnailProvider, png()]
- "scripts_smoke_production_end_to_end_validate": "validate()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L172 | neighbors=[smoke-production-end-to-end.ts, run()]
- "scripts_smoke_production_end_to_end_wav": "wav()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L292 | neighbors=[smoke-production-end-to-end.ts, .generateAudio()]
- "scripts_smoke_production_execution_authorization_evaluate": "evaluate()" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L36 | neighbors=[smoke-production-execution-authorizatio…, main()]
- "scripts_smoke_production_execution_authorization_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L39 | neighbors=[smoke-production-execution-authorizatio…, evaluate()]
- "scripts_smoke_production_execution_confirmation_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L37 | neighbors=[smoke-production-execution-confirmation…, validate()]
- "scripts_smoke_production_execution_confirmation_makegrant": "makeGrant()" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L30 | neighbors=[smoke-production-execution-confirmation…, validate()]
- "scripts_smoke_production_execution_coordinator_tree": "tree()" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L37 | neighbors=[smoke-production-execution-coordinator.…, main()]
- "scripts_smoke_production_execution_dispatch_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[smoke-production-execution-dispatch.ts, run()]
- "scripts_smoke_production_execution_dispatch_run": "run()" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[smoke-production-execution-dispatch.ts, main()]
- "scripts_smoke_production_execution_durable_attempt_main": "main()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L5 | neighbors=[smoke-production-execution-durable-atte…, s()]
- "scripts_smoke_production_execution_durable_attempt_s": "s()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L4 | neighbors=[smoke-production-execution-durable-atte…, main()]
- "scripts_smoke_production_execution_durable_claim_claim": "claim()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L7 | neighbors=[smoke-production-execution-durable-clai…, main()]
- "scripts_smoke_production_execution_durable_claim_s": "s()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L7 | neighbors=[smoke-production-execution-durable-clai…, main()]
- "scripts_smoke_production_execution_durable_lease_acquire": "acquire()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L24 | neighbors=[smoke-production-execution-durable-leas…, main()]
- "scripts_smoke_production_execution_durable_lease_heartbeat": "heartbeat()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L25 | neighbors=[smoke-production-execution-durable-leas…, main()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-106.json

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
