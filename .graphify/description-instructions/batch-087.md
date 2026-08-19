# Node Description Batch 88 of 166

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "backup_runtimebackupmanifest_validsourcelogicalidentity": "validSourceLogicalIdentity()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupManifest.ts:L348 | neighbors=[RuntimeBackupManifest.ts, validateRuntimeBackupManifest()]
- "backup_runtimebackupservice_messagefor": "messageFor()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L329 | neighbors=[RuntimeBackupService.ts, .constructor()]
- "backup_runtimebackupservice_portableruntimebackupverificationreport": "PortableRuntimeBackupVerificationReport" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L79 | neighbors=[RuntimeBackupService.ts, RuntimeBackupRestoreReport]
- "backup_runtimebackupservice_runtimebackupcreatedependencies": "RuntimeBackupCreateDependencies" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L48 | neighbors=[RuntimeBackupService.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupservice_runtimebackupcreaterequest": "RuntimeBackupCreateRequest" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L43 | neighbors=[RuntimeBackupService.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupservice_runtimebackuperror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L36 | neighbors=[RuntimeBackupError, messageFor()]
- "backup_runtimebackupservice_runtimebackuprestorereport": "RuntimeBackupRestoreReport" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L70 | neighbors=[RuntimeBackupService.ts, PortableRuntimeBackupVerificationReport]
- "backup_runtimebackupservice_runtimebackuprestorerequest": "RuntimeBackupRestoreRequest" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L59 | neighbors=[RuntimeBackupService.ts, smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupverifier_assertbackupmaterializationbudget": "assertBackupMaterializationBudget()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L137 | neighbors=[RuntimeBackupVerifier.ts, verifyRuntimeBackup()]
- "backup_runtimebackupverifier_requireexactdirectoryentries": "requireExactDirectoryEntries()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L175 | neighbors=[RuntimeBackupVerifier.ts, verifyRuntimeBackup()]
- "changelog_sprint_129_38": "Sprint 129.38 Retry-Budget Settled-Receipt Cross-Stage Replay Remediation" | kind=entity | source=CHANGELOG.md:L316-L381 | neighbors=[Sprint 129.41 Canonical Completed-Stage…, Sprint 129.39 Canonical Stage-Bounded P…]
- "changelog_sprint_129_39": "Sprint 129.39 Canonical Stage-Bounded Production Resume" | kind=entity | source=CHANGELOG.md:L285-L313 | neighbors=[Sprint 129.38 Retry-Budget Settled-Rece…, Sprint 129.40 Production Scene-Video Fu…]
- "changelog_sprint_129_42": "Sprint 129.42 Completed-Stage Regeneration Smoke Realignment" | kind=entity | source=CHANGELOG.md:L210-L223 | neighbors=[Sprint 129.41 Canonical Completed-Stage…, Sprint 129.44 Production Visual Asset W…]
- "changelog_sprint_129_43": "Sprint 129.43 Fatih Documentary Live Audio & Assembly Production Run" | kind=entity | source=CHANGELOG.md:L191-L208 | neighbors=[Sprint 129.41 Canonical Completed-Stage…, Sprint 129.45 Fatih Manifest/Job/Projec…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@52fca36f9d07922ccb34887e79f63a79d01f35d6": "52fca36 chore: add project tooling configuration" | kind=Commit | source=git | neighbors=[main, 56b2221 docs(agents): add multi-compute…]
- "eslint_config": "eslint.config.mjs" | kind=code-symbol | source=eslint.config.mjs:L1 | neighbors=[c5e9d33 feat(production): add durable c…, eslintConfig]
- "export_exportengine_exportengine_createfallback": ".createFallback()" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L41 | neighbors=[ExportEngine, .generateExportPackage()]
- "export_exportengine_exportengine_generateexportpackage": ".generateExportPackage()" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L23 | neighbors=[ExportEngine, .createFallback()]
- "export_exportengine_generateexportpackage": "generateExportPackage()" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L56 | neighbors=[ExportEngine.ts, ExportEngine]
- "export_exportproviderconfig_defaultexportproviderconfig": "defaultExportProviderConfig" | kind=code-symbol | source=src/lib/export/ExportProviderConfig.ts:L7 | neighbors=[ExportProviderConfig.ts, ExportProviderRouter.ts]
- "export_exportproviderconfig_exportproviderconfig": "ExportProviderConfig" | kind=code-symbol | source=src/lib/export/ExportProviderConfig.ts:L3 | neighbors=[ExportProviderConfig.ts, ExportProviderRouter.ts]
- "export_route_isassemblyplandata": "isAssemblyPlanData()" | kind=code-symbol | source=app/api/export/route.ts:L157 | neighbors=[route.ts, POST()]
- "export_route_isaudiodata": "isAudioData()" | kind=code-symbol | source=app/api/export/route.ts:L148 | neighbors=[route.ts, POST()]
- "export_route_isseodata": "isSEOData()" | kind=code-symbol | source=app/api/export/route.ts:L176 | neighbors=[route.ts, POST()]
- "export_route_isthumbnaildata": "isThumbnailData()" | kind=code-symbol | source=app/api/export/route.ts:L167 | neighbors=[route.ts, POST()]
- "export_route_loadprojectexportsources": "loadProjectExportSources()" | kind=code-symbol | source=app/api/export/route.ts:L107 | neighbors=[route.ts, POST()]
- "export_route_normalizeformat": "normalizeFormat()" | kind=code-symbol | source=app/api/export/route.ts:L140 | neighbors=[route.ts, POST()]
- "export_route_normalizeslug": "normalizeSlug()" | kind=code-symbol | source=app/api/export/route.ts:L132 | neighbors=[route.ts, POST()]
- "filename_route_getcontenttype": "getContentType()" | kind=code-symbol | source=app/api/assets/images/[slug]/[fileName]/route.ts:L69 | neighbors=[route.ts, GET()]
- "filename_route_isinsidedirectory": "isInsideDirectory()" | kind=code-symbol | source=app/api/assets/images/[slug]/[fileName]/route.ts:L59 | neighbors=[route.ts, GET()]
- "filename_route_issafefilename": "isSafeFileName()" | kind=code-symbol | source=app/api/assets/images/[slug]/[fileName]/route.ts:L55 | neighbors=[route.ts, GET()]
- "filename_route_issafepathsegment": "isSafePathSegment()" | kind=code-symbol | source=app/api/assets/images/[slug]/[fileName]/route.ts:L51 | neighbors=[route.ts, GET()]
- "filename_route_issafewavfilename": "isSafeWavFileName()" | kind=code-symbol | source=app/api/assets/audio/[slug]/[fileName]/route.ts:L40 | neighbors=[route.ts, GET()]
- "fixtures_sprint_129_33_path_race_child_countracemutationattempts": "countRaceMutationAttempts()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L110 | neighbors=[sprint-129-33-path-race-child.ts, main()]
- "fixtures_sprint_129_33_path_race_child_foreignpreservationbytes": "foreignPreservationBytes()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L153 | neighbors=[sprint-129-33-path-race-child.ts, main()]
- "fixtures_sprint_129_33_path_race_child_sourcepath": "sourcePath()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L167 | neighbors=[sprint-129-33-path-race-child.ts, main()]
- "fixtures_sprint_129_33_path_race_child_waitfor": "waitFor()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L26 | neighbors=[sprint-129-33-path-race-child.ts, main()]
- "fixtures_sprint_129_33_pipeline_job_lock_child_assertownershiploss": "assertOwnershipLoss()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-pipeline-job-lock-child.ts:L80 | neighbors=[sprint-129-33-pipeline-job-lock-child.ts, main()]
- "fixtures_sprint_129_33_pipeline_job_lock_child_waitfor": "waitFor()" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-pipeline-job-lock-child.ts:L10 | neighbors=[sprint-129-33-pipeline-job-lock-child.ts, main()]
- "health_productionhealthcorerules_productionhealthcorerules": "productionHealthCoreRules" | kind=code-symbol | source=src/lib/production/health/ProductionHealthCoreRules.ts:L8 | neighbors=[ProductionHealthCoreRules.ts, ProductionHealthEngine.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-087.json

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
