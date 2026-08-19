# Node Description Batch 126 of 166

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

- "audio_audiocompensationstore_audiocompensationworkspacemarker": "AudioCompensationWorkspaceMarker" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L163 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_protectedaudiocompensationpublicationreservation": "ProtectedAudioCompensationPublicationReservation" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L105 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_saferetirementrelativefile": "safeRetirementRelativeFile()" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L1320 | neighbors=[AudioCompensationStore.ts]
- "audio_audiocompensationstore_trustedworkspaces": "trustedWorkspaces" | kind=code-symbol | source=src/lib/audio/AudioCompensationStore.ts:L200 | neighbors=[AudioCompensationStore.ts]
- "audio_audiodescriptorboundverification_audiodescriptorfileidentity": "AudioDescriptorFileIdentity" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L9 | neighbors=[AudioDescriptorBoundVerification.ts]
- "audio_audiodescriptorboundverification_audiodescriptorverificationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioDescriptorBoundVerification.ts:L17 | neighbors=[AudioDescriptorVerificationError]
- "audio_audioidentifierpolicy_audioidentifierpolicyerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L18 | neighbors=[AudioIdentifierPolicyError]
- "audio_audioidentifierpolicy_reserved_safe_evidence_terms": "RESERVED_SAFE_EVIDENCE_TERMS" | kind=code-symbol | source=src/lib/audio/AudioIdentifierPolicy.ts:L5 | neighbors=[AudioIdentifierPolicy.ts]
- "audio_audiopipeline_audioassetgenerationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L35 | neighbors=[AudioAssetGenerationError]
- "audio_audiopipeline_audiopipelineresult": "AudioPipelineResult" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L62 | neighbors=[AudioPipeline.ts]
- "audio_audiopipeline_generateaudio": "generateAudio()" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L167 | neighbors=[AudioPipeline.ts]
- "audio_audiopipeline_generateaudioinput": "GenerateAudioInput" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L44 | neighbors=[AudioPipeline.ts]
- "audio_audiopipeline_normalizedaudioresult": "NormalizedAudioResult" | kind=code-symbol | source=src/lib/audio/AudioPipeline.ts:L51 | neighbors=[AudioPipeline.ts]
- "audio_audiopublicationintentstore_audiopublicationintent": "AudioPublicationIntent" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L58 | neighbors=[AudioPublicationIntentStore.ts]
- "audio_audiopublicationintentstore_audiopublicationintentconflicterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L52 | neighbors=[AudioPublicationIntentConflictError]
- "audio_audiopublicationintentstore_audiopublicationintenterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L44 | neighbors=[AudioPublicationIntentError]
- "audio_audiopublicationintentstore_audiopublicationlifecyclestate": "AudioPublicationLifecycleState" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L40 | neighbors=[AudioPublicationIntentStore.ts]
- "audio_audiopublicationintentstore_audiopublicationlifecyclestates": "audioPublicationLifecycleStates" | kind=code-symbol | source=src/lib/audio/AudioPublicationIntentStore.ts:L32 | neighbors=[AudioPublicationIntentStore.ts]
- "audio_audioservice_audioapiresponse": "AudioApiResponse" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L18 | neighbors=[AudioService.ts]
- "audio_audioservice_audioserviceoptions": "AudioServiceOptions" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L4 | neighbors=[AudioService.ts]
- "audio_audioservice_audioserviceresult": "AudioServiceResult" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L13 | neighbors=[AudioService.ts]
- "audio_audioservice_generateaudio": "generateAudio()" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L54 | neighbors=[AudioService.ts]
- "audio_audioservice_generateaudioinput": "GenerateAudioInput" | kind=code-symbol | source=src/lib/audio/AudioService.ts:L9 | neighbors=[AudioService.ts]
- "backup_runtimebackupauthority_runtimeauthorityschemaversion": "runtimeAuthoritySchemaVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L11 | neighbors=[RuntimeBackupAuthority.ts]
- "backup_runtimebackupauthority_runtimebackuprootenvironmentvariable": "runtimeBackupRootEnvironmentVariable" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L14 | neighbors=[RuntimeBackupAuthority.ts]
- "backup_runtimebackupauthority_runtimebackupstorageauthorityschemaversion": "runtimeBackupStorageAuthoritySchemaVersion" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L12 | neighbors=[RuntimeBackupAuthority.ts]
- "backup_runtimebackupauthority_trustedauthorities": "trustedAuthorities" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupAuthority.ts:L23 | neighbors=[RuntimeBackupAuthority.ts]
- "backup_runtimebackupinventory_runtimebackuptreeidentity": "runtimeBackupTreeIdentity()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupInventory.ts:L80 | neighbors=[RuntimeBackupInventory.ts]
- "backup_runtimebackupservice_portableruntimebackupverificationrequest": "PortableRuntimeBackupVerificationRequest" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L65 | neighbors=[RuntimeBackupService.ts]
- "backup_runtimebackupservice_runtimebackupcreateresult": "RuntimeBackupCreateResult" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L52 | neighbors=[RuntimeBackupService.ts]
- "backup_runtimebackupservice_runtimebackuperrorcode": "RuntimeBackupErrorCode" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupService.ts:L24 | neighbors=[RuntimeBackupService.ts]
- "backup_runtimebackupverifier_comparetext": "compareText()" | kind=code-symbol | source=src/lib/runtime/backup/RuntimeBackupVerifier.ts:L184 | neighbors=[RuntimeBackupVerifier.ts]
- "changelog_sprint_129_40": "Sprint 129.40 Production Scene-Video Full-Frame Framing Remediation" | kind=entity | source=CHANGELOG.md:L260-L283 | neighbors=[Sprint 129.39 Canonical Stage-Bounded P…]
- "changelog_sprint_129_44": "Sprint 129.44 Production Visual Asset Wiring Runtime Context Enforcement" | kind=entity | source=CHANGELOG.md:L178-L189 | neighbors=[Sprint 129.42 Completed-Stage Regenerat…]
- "changelog_sprint_129_45": "Sprint 129.45 Fatih Manifest/Job/Project Bookkeeping Backfill" | kind=entity | source=CHANGELOG.md:L152-L176 | neighbors=[Sprint 129.43 Fatih Documentary Live Au…]
- "components_dashboard_dashboard": "Dashboard()" | kind=code-symbol | source=src/components/Dashboard.tsx:L5 | neighbors=[Dashboard.tsx]
- "components_generatevisualsbutton_generatevisualsbutton": "GenerateVisualsButton()" | kind=code-symbol | source=src/components/GenerateVisualsButton.tsx:L12 | neighbors=[GenerateVisualsButton.tsx]
- "components_generatevisualsbutton_props": "Props" | kind=code-symbol | source=src/components/GenerateVisualsButton.tsx:L6 | neighbors=[GenerateVisualsButton.tsx]
- "components_hero_hero": "Hero()" | kind=code-symbol | source=src/components/Hero.tsx:L6 | neighbors=[Hero.tsx]
- "components_hero_heroprops": "HeroProps" | kind=code-symbol | source=src/components/Hero.tsx:L1 | neighbors=[Hero.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-125.json

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
