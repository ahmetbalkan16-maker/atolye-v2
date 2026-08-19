# Node Description Batch 146 of 166

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

- "scripts_smoke_production_end_to_end_storedthumbnailprovider_generatethumbnailplan": ".generateThumbnailPlan()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L274 | neighbors=[StoredThumbnailProvider]
- "scripts_smoke_production_end_to_end_throwingimageprovider_generateimage": ".generateImage()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L240 | neighbors=[ThrowingImageProvider]
- "scripts_smoke_production_end_to_end_thumbnailprovider": "ThumbnailProvider" | kind=code-symbol | neighbors=[StoredThumbnailProvider]
- "scripts_smoke_production_end_to_end_videoassemblyprovider": "VideoAssemblyProvider" | kind=code-symbol | neighbors=[StoredAssemblyProvider]
- "scripts_smoke_production_end_to_end_videoprovider": "VideoProvider" | kind=code-symbol | neighbors=[StoredSceneVideoProvider]
- "scripts_smoke_production_end_to_end_youtubeprovider": "YouTubeProvider" | kind=code-symbol | neighbors=[DeterministicYouTubeProvider]
- "scripts_smoke_production_execution_authorization_allcapabilities": "allCapabilities" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L16 | neighbors=[smoke-production-execution-authorizatio…]
- "scripts_smoke_production_execution_authorization_context": "context" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L35 | neighbors=[smoke-production-execution-authorizatio…]
- "scripts_smoke_production_execution_authorization_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L25 | neighbors=[smoke-production-execution-authorizatio…]
- "scripts_smoke_production_execution_authorization_request": "request" | kind=code-symbol | source=scripts/smoke-production-execution-authorization.ts:L17 | neighbors=[smoke-production-execution-authorizatio…]
- "scripts_smoke_production_execution_confirmation_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L24 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_authorizationpolicy": "authorizationPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L19 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_authorizationrequest": "authorizationRequest" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L14 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_built": "built" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L27 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_executionrequest": "executionRequest" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L25 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_grant": "grant" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L34 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_confirmation_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-confirmation.ts:L26 | neighbors=[smoke-production-execution-confirmation…]
- "scripts_smoke_production_execution_contract_plan": "{plan}" | kind=code-symbol | source=scripts/smoke-production-execution-contract.ts:L2 | neighbors=[smoke-production-execution-contract.ts]
- "scripts_smoke_production_execution_contract_request": "request" | kind=code-symbol | source=scripts/smoke-production-execution-contract.ts:L2 | neighbors=[smoke-production-execution-contract.ts]
- "scripts_smoke_production_execution_contract_snapshot_health": "{snapshot,health}" | kind=code-symbol | source=scripts/smoke-production-execution-contract.ts:L2 | neighbors=[smoke-production-execution-contract.ts]
- "scripts_smoke_production_execution_coordinator_attemptpolicy": "attemptPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L19 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L20 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_claimpolicy": "claimPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L19 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L21 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L19 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_leasepolicy": "leasePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L19 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_session": "session" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L23 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_storagepolicy": "storagePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L19 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_coordinator_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-coordinator.ts:L23 | neighbors=[smoke-production-execution-coordinator.…]
- "scripts_smoke_production_execution_dispatch_base": "base" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[smoke-production-execution-dispatch.ts]
- "scripts_smoke_production_execution_dispatch_envelope": "envelope" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[smoke-production-execution-dispatch.ts]
- "scripts_smoke_production_execution_dispatch_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-dispatch.ts:L1 | neighbors=[smoke-production-execution-dispatch.ts]
- "scripts_smoke_production_execution_durable_attempt_ap": "ap" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L2 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_auth": "auth" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L3 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_conf": "conf" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L3 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_cp": "cp" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L2 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_e": "e()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L4 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_idp": "idp" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L2 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_lp": "lp" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L2 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_open": "open()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L4 | neighbors=[smoke-production-execution-durable-atte…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-145.json

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
