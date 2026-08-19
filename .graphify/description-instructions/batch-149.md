# Node Description Batch 150 of 166

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

- "scripts_smoke_production_planner_snapshot_health": "{snapshot,health}" | kind=code-symbol | source=scripts/smoke-production-planner.ts:L2 | neighbors=[smoke-production-planner.ts]
- "scripts_smoke_production_planner_step": "step" | kind=code-symbol | source=scripts/smoke-production-planner.ts:L2 | neighbors=[smoke-production-planner.ts]
- "scripts_smoke_production_publish_reconciliation_hardening_fixedreconcileprovider_constructor": ".constructor()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L581 | neighbors=[FixedReconcileProvider]
- "scripts_smoke_production_publish_reconciliation_hardening_fixedreconcileprovider_publish": ".publish()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L588 | neighbors=[FixedReconcileProvider]
- "scripts_smoke_production_publish_reconciliation_hardening_project": "project" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L41 | neighbors=[smoke-production-publish-reconciliation…]
- "scripts_smoke_production_publish_reconciliation_hardening_publish": "publish()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L646 | neighbors=[smoke-production-publish-reconciliation…]
- "scripts_smoke_production_publish_reconciliation_hardening_root": "root" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L39 | neighbors=[smoke-production-publish-reconciliation…]
- "scripts_smoke_production_publish_reconciliation_hardening_searchresponse": "searchResponse()" | kind=code-symbol | source=scripts/smoke-production-publish-reconciliation-hardening.ts:L634 | neighbors=[smoke-production-publish-reconciliation…]
- "scripts_smoke_production_publish_reconciliation_hardening_youtubepublishprovider": "YouTubePublishProvider" | kind=code-symbol | neighbors=[FixedReconcileProvider]
- "scripts_smoke_production_readiness_acceptance_assertcompletedaudioprobe": "assertCompletedAudioProbe()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L149 | neighbors=[smoke-production-readiness-acceptance.ts]
- "scripts_smoke_production_readiness_acceptance_main": "main()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L102 | neighbors=[smoke-production-readiness-acceptance.ts]
- "scripts_smoke_production_readiness_acceptance_readinesswavfixture": "readinessWavFixture()" | kind=code-symbol | source=scripts/smoke-production-readiness-acceptance.ts:L167 | neighbors=[smoke-production-readiness-acceptance.ts]
- "scripts_smoke_production_real_photo_source_fakeaiprovider": "fakeAIProvider()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L1024 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_fakefetcher": "fakeFetcher()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L86 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_main": "main()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L1032 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_nodelay": "noDelay()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L110 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_patchopenairouter": "patchOpenAIRouter()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L1015 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_pngbytes": "pngBytes" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L33 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_searchresponse": "searchResponse()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L78 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_testinput": "testInput()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L112 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_real_photo_source_wikimediapage": "wikimediaPage()" | kind=code-symbol | source=scripts/smoke-production-real-photo-source.ts:L49 | neighbors=[smoke-production-real-photo-source.ts]
- "scripts_smoke_production_recovery_bootstrap_attemptpolicy": "attemptPolicy" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L28 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_authorization": "authorization" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L29 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_claimpolicy": "claimPolicy" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L28 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_confirmation": "confirmation" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L30 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_coordinatorrequest": "coordinatorRequest" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L33 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_idpolicy": "idPolicy" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L28 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_leasepolicy": "leasePolicy" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L28 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_planner": "planner" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L34 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_session": "session" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L32 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_storagepolicy": "storagePolicy" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L28 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_recovery_bootstrap_worker": "worker" | kind=code-symbol | source=scripts/smoke-production-recovery-bootstrap.ts:L32 | neighbors=[smoke-production-recovery-bootstrap.ts]
- "scripts_smoke_production_runtime_health_api_readresponse": "readResponse()" | kind=code-symbol | source=scripts/smoke-production-runtime-health-api.ts:L32 | neighbors=[smoke-production-runtime-health-api.ts]
- "scripts_smoke_production_scene_video_rendering_actualprocessrunner_run": ".run()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L316 | neighbors=[ActualProcessRunner]
- "scripts_smoke_production_scene_video_rendering_config": "config()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L382 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_edgecolors": "edgeColors" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L222 | neighbors=[smoke-production-scene-video-rendering.…]
- "scripts_smoke_production_scene_video_rendering_eventemitter": "EventEmitter" | kind=code-symbol | neighbors=[FakeChild]
- "scripts_smoke_production_scene_video_rendering_fakechild_kill": ".kill()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L424 | neighbors=[FakeChild]
- "scripts_smoke_production_scene_video_rendering_fakechild_unref": ".unref()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L425 | neighbors=[FakeChild]
- "scripts_smoke_production_scene_video_rendering_filtergraph": "filterGraph()" | kind=code-symbol | source=scripts/smoke-production-scene-video-rendering.ts:L288 | neighbors=[smoke-production-scene-video-rendering.…]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-149.json

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
