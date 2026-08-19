# Node Description Batch 145 of 166

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

- "scripts_smoke_production_controlled_execution_gateway_policy": "policy" | kind=code-symbol | source=scripts/smoke-production-controlled-execution-gateway.ts:L1 | neighbors=[smoke-production-controlled-execution-g…]
- "scripts_smoke_production_dependency_graph_actions": "actions" | kind=code-symbol | source=scripts/smoke-production-dependency-graph.ts:L2 | neighbors=[smoke-production-dependency-graph.ts]
- "scripts_smoke_production_dependency_graph_graph": "graph" | kind=code-symbol | source=scripts/smoke-production-dependency-graph.ts:L2 | neighbors=[smoke-production-dependency-graph.ts]
- "scripts_smoke_production_dependency_graph_snapshot_health": "{snapshot,health}" | kind=code-symbol | source=scripts/smoke-production-dependency-graph.ts:L2 | neighbors=[smoke-production-dependency-graph.ts]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_assertvalidationpreconditions": "assertValidationPreconditions()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L342 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_byteidentity": "byteIdentity()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L327 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_declaredboundary": "DeclaredBoundary" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L63 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_fixture": "Fixture" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L87 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_replaceattempt": "replaceAttempt()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L285 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_replacerecord": "replaceRecord()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L276 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_stage": "stage" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L55 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_tree": "tree()" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L294 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_treeentry": "TreeEntry" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L122 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_durable_attempt_lineage_compatibility_treesnapshot": "TreeSnapshot" | kind=code-symbol | source=scripts/smoke-production-durable-attempt-lineage-compatibility.ts:L131 | neighbors=[smoke-production-durable-attempt-lineag…]
- "scripts_smoke_production_end_to_end_aiprovider": "AIProvider" | kind=code-symbol | neighbors=[DeterministicAIProvider]
- "scripts_smoke_production_end_to_end_audioprovider": "AudioProvider" | kind=code-symbol | neighbors=[StoredAudioProvider]
- "scripts_smoke_production_end_to_end_deterministicaiprovider_createimmutableaidispatchadapter": ".createImmutableAiDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L220 | neighbors=[DeterministicAIProvider]
- "scripts_smoke_production_end_to_end_deterministicaiprovider_generate": ".generate()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L221 | neighbors=[DeterministicAIProvider]
- "scripts_smoke_production_end_to_end_deterministicyoutubeprovider_createimmutableyoutubedispatchadapter": ".createImmutableYoutubeDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L286 | neighbors=[DeterministicYouTubeProvider]
- "scripts_smoke_production_end_to_end_deterministicyoutubeprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L287 | neighbors=[DeterministicYouTubeProvider]
- "scripts_smoke_production_end_to_end_main": "main()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L300 | neighbors=[smoke-production-end-to-end.ts]
- "scripts_smoke_production_end_to_end_root": "root" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L41 | neighbors=[smoke-production-end-to-end.ts]
- "scripts_smoke_production_end_to_end_runtoken": "runToken" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L43 | neighbors=[smoke-production-end-to-end.ts]
- "scripts_smoke_production_end_to_end_slug": "slug" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L40 | neighbors=[smoke-production-end-to-end.ts]
- "scripts_smoke_production_end_to_end_stabilization_bytes": "bytes()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L271 | neighbors=[smoke-production-end-to-end-stabilizati…]
- "scripts_smoke_production_end_to_end_stabilization_countingpublishprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L253 | neighbors=[CountingPublishProvider]
- "scripts_smoke_production_end_to_end_stabilization_explicitfailureprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L258 | neighbors=[ExplicitFailureProvider]
- "scripts_smoke_production_end_to_end_stabilization_indeterminateprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L263 | neighbors=[IndeterminateProvider]
- "scripts_smoke_production_end_to_end_stabilization_main": "main()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L51 | neighbors=[smoke-production-end-to-end-stabilizati…]
- "scripts_smoke_production_end_to_end_stabilization_neverpackageprovider_generatepublishingpackage": ".generatePublishingPackage()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L268 | neighbors=[NeverPackageProvider]
- "scripts_smoke_production_end_to_end_stabilization_project": "project" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L30 | neighbors=[smoke-production-end-to-end-stabilizati…]
- "scripts_smoke_production_end_to_end_stabilization_publish": "publish()" | kind=code-symbol | source=scripts/smoke-production-end-to-end-stabilization.ts:L189 | neighbors=[smoke-production-end-to-end-stabilizati…]
- "scripts_smoke_production_end_to_end_stabilization_youtubeprovider": "YouTubeProvider" | kind=code-symbol | neighbors=[NeverPackageProvider]
- "scripts_smoke_production_end_to_end_storedassemblyprovider_createimmutableassemblydispatchadapter": ".createImmutableAssemblyDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L264 | neighbors=[StoredAssemblyProvider]
- "scripts_smoke_production_end_to_end_storedaudioprovider_createimmutableaudiodispatchadapter": ".createImmutableAudioDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L244 | neighbors=[StoredAudioProvider]
- "scripts_smoke_production_end_to_end_storedaudioprovider_validateinput": ".validateInput()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L245 | neighbors=[StoredAudioProvider]
- "scripts_smoke_production_end_to_end_storedimageprovider_createimmutableimagedispatchadapter": ".createImmutableImageDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L231 | neighbors=[StoredImageProvider]
- "scripts_smoke_production_end_to_end_storedscenevideoprovider_createimmutablevideodispatchadapter": ".createImmutableVideoDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L253 | neighbors=[StoredSceneVideoProvider]
- "scripts_smoke_production_end_to_end_storedscenevideoprovider_generatevideo": ".generateVideo()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L254 | neighbors=[StoredSceneVideoProvider]
- "scripts_smoke_production_end_to_end_storedthumbnailprovider_createimmutablethumbnaildispatchadapter": ".createImmutableThumbnailDispatchAdapter()" | kind=code-symbol | source=scripts/smoke-production-end-to-end.ts:L273 | neighbors=[StoredThumbnailProvider]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-144.json

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
