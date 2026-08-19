# Node Description Batch 134 of 166

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

- "production_productionexecutionidempotency_messages": "messages" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L10 | neighbors=[ProductionExecutionIdempotency.ts]
- "production_productionexecutionidempotency_productionexecutionreservationlifecyclestate": "ProductionExecutionReservationLifecycleState" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L21 | neighbors=[ProductionExecutionIdempotency.ts]
- "production_productionexecutionidempotency_states": "states" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L5 | neighbors=[ProductionExecutionIdempotency.ts]
- "production_productionexecutionidempotency_terminalstates": "terminalStates" | kind=code-symbol | source=src/lib/production/ProductionExecutionIdempotency.ts:L6 | neighbors=[ProductionExecutionIdempotency.ts]
- "production_productionexecutionjobcontract_productionexecutionjobcontract_preview": ".preview()" | kind=code-symbol | source=src/lib/production/ProductionExecutionJobContract.ts:L5 | neighbors=[ProductionExecutionJobContract]
- "production_productionexecutionlifecycle_productionexecutionlifecycle_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionLifecycle.ts:L7 | neighbors=[ProductionExecutionLifecycle]
- "production_productionexecutionlifecycle_productionexecutionlifecycle_inspect": ".inspect()" | kind=code-symbol | source=src/lib/production/ProductionExecutionLifecycle.ts:L9 | neighbors=[ProductionExecutionLifecycle]
- "production_productionexecutionpersistence_canonicalread": "CanonicalRead" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L345 | neighbors=[ProductionExecutionPersistence.ts]
- "production_productionexecutionpersistence_journalintegrityvalid": "journalIntegrityValid()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L387 | neighbors=[ProductionExecutionPersistence.ts]
- "production_productionexecutionpersistence_kinds": "kinds" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L46 | neighbors=[ProductionExecutionPersistence.ts]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryoptions": "ProductionExecutionDurableRecoveryOptions" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L27 | neighbors=[ProductionExecutionPersistence.ts]
- "production_productionexecutionpersistence_productionexecutiondurablerecoveryservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L154 | neighbors=[ProductionExecutionDurableRecoveryServi…]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceadapter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L54 | neighbors=[ProductionExecutionFilePersistenceAdapt…]
- "production_productionexecutionpersistence_productionexecutionfilepersistenceoptions": "ProductionExecutionFilePersistenceOptions" | kind=code-symbol | source=src/lib/production/ProductionExecutionPersistence.ts:L34 | neighbors=[ProductionExecutionPersistence.ts]
- "production_productionexecutionpersistence_productionexecutionpersistenceadapter": "ProductionExecutionPersistenceAdapter" | kind=code-symbol | neighbors=[ProductionExecutionFilePersistenceAdapt…]
- "production_productionexecutionrecoverybootstrap_attemptchain": "AttemptChain" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L240 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_codeunitcompare": "codeUnitCompare()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L541 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_immutablesuccessor": "immutableSuccessor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L347 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverybootstrap_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L84 | neighbors=[ProductionExecutionRecoveryBootstrap]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverysemanticauthority": "ProductionExecutionRecoverySemanticAuthority" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L29 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystorefamily": "ProductionExecutionRecoveryStoreFamily" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L46 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystorenormalizedoutcome": "ProductionExecutionRecoveryStoreNormalizedOutcome" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L52 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystoreobservedstate": "ProductionExecutionRecoveryStoreObservedState" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L50 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystorerequirementstate": "ProductionExecutionRecoveryStoreRequirementState" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L48 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystoresemanticstate": "ProductionExecutionRecoveryStoreSemanticState" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L72 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionrecoverystorestates": "ProductionExecutionRecoveryStoreStates" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L74 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_productionexecutionreservationsemanticidentity": "ProductionExecutionReservationSemanticIdentity" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L63 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_readfailurepriority": "readFailurePriority()" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L235 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_reservationauthorityentry": "ReservationAuthorityEntry" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L371 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionrecoverybootstrap_terminalstates": "terminalStates" | kind=code-symbol | source=src/lib/production/ProductionExecutionRecoveryBootstrap.ts:L78 | neighbors=[ProductionExecutionRecoveryBootstrap.ts]
- "production_productionexecutionsafetyplan_actionrisk": "actionRisk()" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L93 | neighbors=[ProductionExecutionSafetyPlan.ts]
- "production_productionexecutionsafetyplan_capability": "capability()" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L91 | neighbors=[ProductionExecutionSafetyPlan.ts]
- "production_productionexecutionsafetyplan_roadmap": "roadmap()" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L94 | neighbors=[ProductionExecutionSafetyPlan.ts]
- "production_productionexecutionsafetyplan_threat": "threat()" | kind=code-symbol | source=src/lib/production/ProductionExecutionSafetyPlan.ts:L92 | neighbors=[ProductionExecutionSafetyPlan.ts]
- "production_productionexecutionworker_productionexecutionworkerexecutionservice_constructor": ".constructor()" | kind=code-symbol | source=src/lib/production/ProductionExecutionWorker.ts:L18 | neighbors=[ProductionExecutionWorkerExecutionServi…]
- "production_productionglobalterminalquiescence_contiguous": "contiguous()" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L419 | neighbors=[ProductionGlobalTerminalQuiescence.ts]
- "production_productionglobalterminalquiescence_production_step_order": "PRODUCTION_STEP_ORDER" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L429 | neighbors=[ProductionGlobalTerminalQuiescence.ts]
- "production_productionglobalterminalquiescence_productionstepkeys": "productionStepKeys" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L444 | neighbors=[ProductionGlobalTerminalQuiescence.ts]
- "production_productionglobalterminalquiescence_quiescencelineageidentityversion": "QuiescenceLineageIdentityVersion" | kind=code-symbol | source=src/lib/production/ProductionGlobalTerminalQuiescence.ts:L29 | neighbors=[ProductionGlobalTerminalQuiescence.ts]
- "production_productionhealthapiclient_productionhealthapiconsumererror_code": ".code()" | kind=code-symbol | source=src/lib/production/ProductionHealthApiClient.ts:L45 | neighbors=[ProductionHealthApiConsumerError]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-133.json

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
