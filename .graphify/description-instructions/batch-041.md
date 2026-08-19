# Node Description Batch 42 of 166

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

- "backup_runtimebackuppathpolicy_runtimebackuppathpolicyversionv1": "runtimeBackupPathPolicyVersionV1" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L9 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, RuntimeBackupVerifier.ts, GuardedRuntimeMutationSession.ts]
- "backup_runtimebackuppathpolicy_runtimebackupportablecollisionkey": "runtimeBackupPortableCollisionKey()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupPathPolicy.ts:L46 | neighbors=[RuntimeBackupInventory.ts, RuntimeBackupManifest.ts, RuntimeBackupPathPolicy.ts, validateRuntimeBackupRelativePath(), smoke-sprint-129-25c-1-runtime-backup.ts]
- "backup_runtimebackupservice_exactbackupdirectory": "exactBackupDirectory()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L260 | neighbors=[RuntimeBackupService.ts, invalidRequest(), requireExistingAbsoluteDirectory(), samePath(), restoreAndVerifyRuntimeBackup()]
- "backup_runtimebackupservice_materializeandverify": "materializeAndVerify()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L166 | neighbors=[RuntimeBackupService.ts, requireExistingAbsoluteDirectory(), RuntimeBackupError, portableVerifyRuntimeBackup(), restoreAndVerifyRuntimeBackup()]
- "backup_runtimebackupservice_requiretrustedauthority": "requireTrustedAuthority()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L267 | neighbors=[RuntimeBackupService.ts, decodeCreateRequest(), decodePortableRequest(), decodeRestoreRequest(), invalidRequest()]
- "backup_runtimebackupverifier_runtimebackupverificationreport": "RuntimeBackupVerificationReport" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L23 | neighbors=[RuntimeBackupService.ts, RuntimeBackupVerifier.ts, RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateService.ts, GuardedRuntimeMutationSession.ts]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@076e2b775f98c70d4f72c874d0a083be258a8ce5": "076e2b7 Sprint 30 Phase 2 - Project Manifest save system" | kind=Commit | source=git | neighbors=[wip/production-audio-resume-prep, wip/sprint-129-28-final-two-p1, wip/sprint-129-28-remediation, ed3020b Sprint 30 Phase 3 - Enhanced pr…, c17c96f feat(projects): show manifest p…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@2fc58f962c94763861d9e777772de935fd923d89": "2fc58f9 chore(checkpoint): preserve Sprint 129.32 production blocker" | kind=Commit | source=git | neighbors=[09ab1e9 fix(audio): support OpenAI stre…, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 0d87231 wip: checkpoint Sprint 129.32 s…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@60d8f0c26f7ab5c4225d1b9df724539d9144c7da": "60d8f0c Sprint 11 completed - Scene Engine architecture" | kind=Commit | source=git | neighbors=[wip/sprint-129-28-remediation, 91ba270 Atölye V2 checkpoint - pipeline…, route.ts, page.tsx, a319525 Setup ProjectManager V2 archite…]
- "commit:repo:github.com/ahmetbalkan16-maker/atolye-v2@91b37ec41b666f5d1976972b670ccedf84985f15": "91b37ec feat(production): persist Fatih documentary audio and assembly output" | kind=Commit | source=git | neighbors=[06fc5b7 fix(test): close sprint 129.42 …, agents/api-graphify-mcp-integration, main, wip/production-audio-resume-prep-v2, 8803c39 fix(test): enforce production v…]
- "components_dashboard": "Dashboard.tsx" | kind=code-symbol | source=src/components/Dashboard.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, Dashboard(), DashboardStats.tsx, ProjectList.tsx, HomeClient.tsx]
- "components_sidebar": "Sidebar.tsx" | kind=code-symbol | source=src/components/Sidebar.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, HomeClient.tsx, menuItems, Sidebar(), page.tsx]
- "components_topicinput": "TopicInput.tsx" | kind=code-symbol | source=src/components/TopicInput.tsx:L1 | neighbors=[5a68409 feat(pipeline): add full docume…, 91ba270 Atölye V2 checkpoint - pipeline…, HomeClient.tsx, TopicInput(), TopicInputProps]
- "dashboard_dashboardstats": "DashboardStats.tsx" | kind=code-symbol | source=src/components/dashboard/DashboardStats.tsx:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, a6de923 feat(studio): add production da…, Dashboard.tsx, DashboardStats(), Project]
- "jobid_route_post": "POST()" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L19 | neighbors=[route.ts, isPipelineJobAction(), isSafeJobId(), isSafeSlug(), readActionBody()]
- "lib_canonicalsmokeevidence_canonicalevidenceerror": "CanonicalEvidenceError" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L29 | neighbors=[CanonicalSmokeEvidence.ts, .constructor(), CanonicalSmokeEvidenceV2.ts, run-canonical-smoke-evidence.ts, validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeevidence_sha256": "sha256()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L89 | neighbors=[CanonicalSmokeEvidence.ts, addIntegrity(), verifyIntegrity(), CanonicalSmokeEvidenceV2.ts, validate-canonical-smoke-evidence.ts]
- "lib_canonicalsmokeevidencev2_assertrootplacement": "assertRootPlacement()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L126 | neighbors=[CanonicalSmokeEvidenceV2.ts, assertExistingEvidenceRoot(), assertMatrixRunId(), fail(), prepareNewEvidenceRoot()]
- "lib_canonicalsmokeevidencev2_currenthead": "currentHead()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L343 | neighbors=[CanonicalSmokeEvidenceV2.ts, git(), runEvidenceMatrix(), validateMatrixContract(), writeFinal()]
- "lib_canonicalsmokeevidencev2_dataprojectsstate": "dataProjectsState()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L333 | neighbors=[CanonicalSmokeEvidenceV2.ts, git(), initialize(), runChild(), writeFinal()]
- "lib_canonicalsmokeevidencev2_ownershipremainders": "ownershipRemainders()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L340 | neighbors=[CanonicalSmokeEvidenceV2.ts, initialize(), remainders(), runChild(), writeFinal()]
- "lib_canonicalsmokeevidencev2_processidentity": "processIdentity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L344 | neighbors=[CanonicalSmokeEvidenceV2.ts, acquireLease(), aggregateEvidence(), normalizePath(), runEvidenceMatrix()]
- "lib_canonicalsmokeevidencev2_tempparentchain": "tempParentChain()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L105 | neighbors=[CanonicalSmokeEvidenceV2.ts, assertExistingEvidenceRoot(), prepareNewEvidenceRoot(), rootAuthority(), fail()]
- "lib_canonicalsmokeevidencev2_validateaggregateevidence": "validateAggregateEvidence()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L853 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), equal(), fail(), readJson()]
- "lib_canonicalsmokeevidencev2_validateevidencerootauthority": "validateEvidenceRootAuthority()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L189 | neighbors=[CanonicalSmokeEvidenceV2.ts, equal(), fail(), rootAuthority(), validateMatrixContract()]
- "lib_canonicalsmokeevidencev2_validateleaseidentity": "validateLeaseIdentity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L620 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), normalizePath(), object(), validateProvenance()]
- "lib_canonicalsmokeevidencev2_validateprocessidentity": "validateProcessIdentity()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L610 | neighbors=[CanonicalSmokeEvidenceV2.ts, fail(), normalizePath(), object(), validateProvenance()]
- "lib_canonicalsmokeevidencev2_writeorchestrator": "writeOrchestrator()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidenceV2.ts:L600 | neighbors=[CanonicalSmokeEvidenceV2.ts, aggregateEvidence(), runEvidenceMatrix(), publishIntegratedJson(), string()]
- "lib_canonicalsmokeruntime_assertrunownedcontext": "assertRunOwnedContext()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L441 | neighbors=[CanonicalSmokeRuntime.ts, assertCanonicalSmokeRuntimeStorageConte…, contains(), samePath(), setupCanonicalSmokeRuntime()]
- "lib_canonicalsmokeruntime_manifesthash": "manifestHash()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L530 | neighbors=[CanonicalSmokeRuntime.ts, createManifest(), stableJson(), recoverCanonicalSmokeWorkspace(), withCleanupState()]
- "lib_canonicalsmokeruntime_samepath": "samePath()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeRuntime.ts:L579 | neighbors=[CanonicalSmokeRuntime.ts, assertRunOwnedContext(), identitySafeRemoveLeaf(), recoverCanonicalSmokeWorkspace(), canonicalPath()]
- "lib_historicalaudioordinalfourpreflight_withleaseintegrity": "withLeaseIntegrity()" | kind=code-symbol | source=scripts/lib/HistoricalAudioOrdinalFourPreflight.ts:L85 | neighbors=[HistoricalAudioOrdinalFourPreflight.ts, poisonHistoricalAudioOrdinalFourLease(), preflightHistoricalAudioOrdinalFour(), rewriteLease(), bodyWithoutIntegrity()]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidatemanifestsha256": "runtimeMigrationCandidateManifestSha256()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L167 | neighbors=[RuntimeMigrationCandidateManifest.ts, RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts, smoke-sprint-129-25c-2b-1-migration-can…, smoke-sprint-129-25c-2b-2-migration-can…]
- "migration_runtimemigrationcandidatemanifest_runtimemigrationcandidatepolicysha256": "runtimeMigrationCandidatePolicySha256()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L171 | neighbors=[RuntimeMigrationCandidateManifest.ts, runtimeMigrationCandidateIdentitySha256…, hashCanonical(), validateRuntimeMigrationCandidateManife…, RuntimeMigrationCandidateService.ts]
- "migration_runtimemigrationcandidatemanifest_sha256": "sha256()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L439 | neighbors=[RuntimeMigrationCandidateManifest.ts, runtimeMigrationCandidateId(), validateDurableBinding(), validateManifest(), validateSourceBackup()]
- "migration_runtimemigrationcandidatemanifest_validatecapability": "validateCapability()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L339 | neighbors=[RuntimeMigrationCandidateManifest.ts, exact(), invalid(), isRecord(), validateManifest()]
- "migration_runtimemigrationcandidatemanifest_validategitevidence": "validateGitEvidence()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L351 | neighbors=[RuntimeMigrationCandidateManifest.ts, exact(), invalid(), isRecord(), validateManifest()]
- "migration_runtimemigrationcandidatemanifest_validateoperation": "validateOperation()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateManifest.ts:L361 | neighbors=[RuntimeMigrationCandidateManifest.ts, validateManifest(), exact(), invalid(), isRecord()]
- "migration_runtimemigrationcandidateverifier_verifymigrationcandidatebinding": "verifyMigrationCandidateBinding()" | kind=code-symbol | source=src/lib/runtime/migration/RuntimeMigrationCandidateVerifier.ts:L113 | neighbors=[RuntimeMigrationCandidateService.ts, RuntimeMigrationCandidateVerifier.ts, canonicalJson(), verifyMigrationCandidate(), smoke-sprint-129-25c-2b-1-migration-can…]
- "pipeline_pipelinejobmanager_ispipelinejob": "isPipelineJob()" | kind=code-symbol | source=src/lib/pipeline/PipelineJobManager.ts:L900 | neighbors=[PipelineJobManager.ts, isOptionalNonNegativeInteger(), isOptionalString(), isPipelineJobStatus(), isProductionStepKey()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-041.json

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
