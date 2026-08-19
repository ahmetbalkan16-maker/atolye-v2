# Node Description Batch 157 of 166

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

- "scripts_smoke_sprint_129_36_race_worker_args": "args" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L19 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_authorityid": "authorityId" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L30 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_jobid": "jobId" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L29 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_projectslug": "projectSlug" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L27 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_runtimeroot": "runtimeRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L26 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_stage": "stage" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L28 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_race_worker_workerid": "workerId" | kind=code-symbol | source=scripts/smoke-sprint-129-36-race-worker.ts:L31 | neighbors=[smoke-sprint-129-36-race-worker.ts]
- "scripts_smoke_sprint_129_36_retry_budget_extension_fileentry": "FileEntry" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L107 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_36_retry_budget_extension_ownedtemprootidentity": "OwnedTempRootIdentity" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L153 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_36_retry_budget_extension_productionpipelineexecutionidentity": "ProductionPipelineExecutionIdentity" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L39 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_36_retry_budget_extension_raceworkerresult": "RaceWorkerResult" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L299 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_36_retry_budget_extension_repoproddir": "repoProdDir" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L83 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_36_retry_budget_extension_rewinddurableartifact": "RewindDurableArtifact" | kind=code-symbol | source=scripts/smoke-sprint-129-36-retry-budget-extension.ts:L593 | neighbors=[smoke-sprint-129-36-retry-budget-extens…]
- "scripts_smoke_sprint_129_37_assembly_truncation_budget_environment": "environment()" | kind=code-symbol | source=scripts/smoke-sprint-129-37-assembly-truncation-budget.ts:L41 | neighbors=[smoke-sprint-129-37-assembly-truncation…]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_hash": "hash()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L72 | neighbors=[smoke-sprint-129-38-cross-stage-settled…]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_productionprojectroot": "productionProjectRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L63 | neighbors=[smoke-sprint-129-38-cross-stage-settled…]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_refreshmarker": "refreshMarker()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L268 | neighbors=[smoke-sprint-129-38-cross-stage-settled…]
- "scripts_smoke_sprint_129_38_cross_stage_settled_receipt_replay_rewindexactaudioordinalfour": "rewindExactAudioOrdinalFour()" | kind=code-symbol | source=scripts/smoke-sprint-129-38-cross-stage-settled-receipt-replay.ts:L93 | neighbors=[smoke-sprint-129-38-cross-stage-settled…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_configuredaiprovider": "ConfiguredAIProvider" | kind=code-symbol | neighbors=[FixtureAIProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_configuredvideoassemblyprovider": "ConfiguredVideoAssemblyProvider" | kind=code-symbol | neighbors=[FixtureAssemblyProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureai": "fixtureAI" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L129 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureaiprovider_createimmutableaidispatchadapter": ".createImmutableAiDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L57 | neighbors=[FixtureAIProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureaiprovider_generate": ".generate()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L64 | neighbors=[FixtureAIProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureassembly": "fixtureAssembly" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L130 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureassemblyprovider_assemble": ".assemble()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L97 | neighbors=[FixtureAssemblyProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixtureassemblyprovider_createimmutableassemblydispatchadapter": ".createImmutableAssemblyDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L90 | neighbors=[FixtureAssemblyProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixturethumbnail": "fixtureThumbnail" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L131 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixturethumbnailprovider_generatethumbnailasset": ".generateThumbnailAsset()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L121 | neighbors=[FixtureThumbnailProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_fixturethumbnailprovider_generatethumbnailplan": ".generateThumbnailPlan()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L112 | neighbors=[FixtureThumbnailProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_mockthumbnailprovider": "MockThumbnailProvider" | kind=code-symbol | neighbors=[FixtureThumbnailProvider]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_resumeobservation": "ResumeObservation" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L474 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_runnerinternal": "RunnerInternal" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L138 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_39_stage_bounded_resume_withfixtureproviders": "withFixtureProviders()" | kind=code-symbol | source=scripts/smoke-sprint-129-39-stage-bounded-resume.ts:L184 | neighbors=[smoke-sprint-129-39-stage-bounded-resum…]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_configuredvideoassemblyprovider": "ConfiguredVideoAssemblyProvider" | kind=code-symbol | neighbors=[FixtureAssemblyProvider]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_configuredvideoprovider": "ConfiguredVideoProvider" | kind=code-symbol | neighbors=[FixtureVideoProvider]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixtureassemblyprovider_createimmutableassemblydispatchadapter": ".createImmutableAssemblyDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L216 | neighbors=[FixtureAssemblyProvider]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixturevideoprovider_createimmutablevideodispatchadapter": ".createImmutableVideoDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L187 | neighbors=[FixtureVideoProvider]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_fixturevideoprovider_generatevideo": ".generateVideo()" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L193 | neighbors=[FixtureVideoProvider]
- "scripts_smoke_sprint_129_41_completed_stage_regeneration_preparationworkerinput": "PreparationWorkerInput" | kind=code-symbol | source=scripts/smoke-sprint-129-41-completed-stage-regeneration.ts:L265 | neighbors=[smoke-sprint-129-41-completed-stage-reg…]
- "scripts_smoke_sprint_129_5_production_acceptance_topic_completion": "completion" | kind=code-symbol | source=scripts/smoke-sprint-129-5-production-acceptance-topic.ts:L33 | neighbors=[smoke-sprint-129-5-production-acceptanc…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-156.json

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
