# Node Description Batch 147 of 166

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

- "scripts_smoke_production_execution_durable_attempt_outcome": "outcome()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L4 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_session": "session" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L3 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_sp": "sp" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L2 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_attempt_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-durable-attempt.ts:L3 | neighbors=[smoke-production-execution-durable-atte…]
- "scripts_smoke_production_execution_durable_claim_auth": "auth" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L5 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_claimpolicy": "claimPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L4 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L5 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_expect": "expect()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L7 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L4 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_leasepolicy": "leasePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L4 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_record": "record()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L6 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_reservation": "reservation()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L6 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_session": "session" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L5 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_storagepolicy": "storagePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L4 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_tree": "tree()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L7 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_claim_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-durable-claim.ts:L5 | neighbors=[smoke-production-execution-durable-clai…]
- "scripts_smoke_production_execution_durable_lease_auth": "auth" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L18 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L19 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_expect": "expect()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L27 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L15 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_leasepolicy": "leasePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L17 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_record": "record()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L23 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_session": "session" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L22 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_storagepolicy": "storagePolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L16 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_lease_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-execution-durable-lease.ts:L21 | neighbors=[smoke-production-execution-durable-leas…]
- "scripts_smoke_production_execution_durable_recovery_auth": "auth" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L15 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_recovery_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L16 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_recovery_finding": "finding()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L20 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_recovery_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L13 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_recovery_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L14 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_recovery_snapshot": "snapshot()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-recovery.ts:L21 | neighbors=[smoke-production-execution-durable-reco…]
- "scripts_smoke_production_execution_durable_storage_baseidentity": "baseIdentity" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L6 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_durable_storage_codeerror": "codeError()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L26 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_durable_storage_expect": "expect()" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L9 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_durable_storage_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L4 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_durable_storage_lease": "lease" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L8 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_durable_storage_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-execution-durable-storage.ts:L4 | neighbors=[smoke-production-execution-durable-stor…]
- "scripts_smoke_production_execution_gateway_plan": "{plan}" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L2 | neighbors=[smoke-production-execution-gateway.ts]
- "scripts_smoke_production_execution_gateway_req": "req" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L2 | neighbors=[smoke-production-execution-gateway.ts]
- "scripts_smoke_production_execution_gateway_result": "result" | kind=code-symbol | source=scripts/smoke-production-execution-gateway.ts:L2 | neighbors=[smoke-production-execution-gateway.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-146.json

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
