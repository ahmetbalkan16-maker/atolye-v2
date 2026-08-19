# Node Description Batch 153 of 166

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

- "scripts_smoke_sprint_129_22_animation_structured_output_completionresponse": "completionResponse()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L71 | neighbors=[smoke-sprint-129-22-animation-structure…]
- "scripts_smoke_sprint_129_22_animation_structured_output_config": "config()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L54 | neighbors=[smoke-sprint-129-22-animation-structure…]
- "scripts_smoke_sprint_129_22_animation_structured_output_hash": "hash()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L88 | neighbors=[smoke-sprint-129-22-animation-structure…]
- "scripts_smoke_sprint_129_22_animation_structured_output_input": "input()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L45 | neighbors=[smoke-sprint-129-22-animation-structure…]
- "scripts_smoke_sprint_129_22_animation_structured_output_response": "response()" | kind=code-symbol | source=scripts/smoke-sprint-129-22-animation-structured-output.ts:L64 | neighbors=[smoke-sprint-129-22-animation-structure…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_commanddependencies": "commandDependencies()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L478 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_exists": "exists()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L538 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_fileoperations": "fileOperations()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L489 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_fixturefolders": "fixtureFolders" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L30 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_readmarker": "readMarker()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L503 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_temporaryfiles": "temporaryFiles()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L527 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_24_acceptance_marker_reprepare_withtamperedcomponent": "withTamperedComponent()" | kind=code-symbol | source=scripts/smoke-sprint-129-24-acceptance-marker-reprepare.ts:L361 | neighbors=[smoke-sprint-129-24-acceptance-marker-r…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_context": "context()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L64 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_expectcode": "expectCode()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L56 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_markerpath": "markerPath" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L35 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_motionplan": "motionPlan()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L424 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_png": "png()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L402 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_repositoryroot": "repositoryRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L33 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_sceneplan": "scenePlan()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L448 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_1_runtime_hardening_wav": "wav()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-1-runtime-hardening.ts:L406 | neighbors=[smoke-sprint-129-25b-1-runtime-hardenin…]
- "scripts_smoke_sprint_129_25b_runtime_root_createtrackingadmissionfixture": "createTrackingAdmissionFixture()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L331 | neighbors=[smoke-sprint-129-25b-runtime-root.ts]
- "scripts_smoke_sprint_129_25b_runtime_root_expectruntimeerror": "expectRuntimeError()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L44 | neighbors=[smoke-sprint-129-25b-runtime-root.ts]
- "scripts_smoke_sprint_129_25b_runtime_root_markerpath": "markerPath" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L29 | neighbors=[smoke-sprint-129-25b-runtime-root.ts]
- "scripts_smoke_sprint_129_25b_runtime_root_repositoryroot": "repositoryRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L28 | neighbors=[smoke-sprint-129-25b-runtime-root.ts]
- "scripts_smoke_sprint_129_25b_runtime_root_writeignoredfixturefile": "writeIgnoredFixtureFile()" | kind=code-symbol | source=scripts/smoke-sprint-129-25b-runtime-root.ts:L344 | neighbors=[smoke-sprint-129-25b-runtime-root.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_allocatebackuprootforpartiallength": "allocateBackupRootForPartialLength()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1325 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_allocatenestedbackuprootforpartiallength": "allocateNestedBackupRootForPartialLength()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1359 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_asv1manifest": "asV1Manifest()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1592 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_comparetext": "compareText()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1412 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_copyfilesync": "CopyFileSync" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1482 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_insidepath": "insidePath()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1584 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_livemarker": "liveMarker" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L51 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_manifestwithfiles": "manifestWithFiles()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1416 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_readfilesync": "ReadFileSync" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1484 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_repositoryroot": "repositoryRoot" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L49 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_rmdirsync": "RmdirSync" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1486 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_rmsync": "RmSync" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1483 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_runconcurrentcreateprocess": "runConcurrentCreateProcess()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1650 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_runtimemutationresidues": "runtimeMutationResidues()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1394 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]
- "scripts_smoke_sprint_129_25c_1_runtime_backup_strictdtovariants": "strictDtoVariants()" | kind=code-symbol | source=scripts/smoke-sprint-129-25c-1-runtime-backup.ts:L1439 | neighbors=[smoke-sprint-129-25c-1-runtime-backup.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-152.json

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
