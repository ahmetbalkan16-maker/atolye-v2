# Node Description Batch 159 of 166

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

- "security_ownedruntimedirectory_ownedruntimedirectory_releaseownership": ".releaseOwnership()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L99 | neighbors=[OwnedRuntimeDirectory]
- "security_ownedruntimedirectory_ownedruntimedirectory_writefileexclusive": ".writeFileExclusive()" | kind=code-symbol | source=src/lib/runtime/security/OwnedRuntimeDirectory.ts:L68 | neighbors=[OwnedRuntimeDirectory]
- "security_portablenoclobberfilepublisher_hard_link_unavailable_codes": "HARD_LINK_UNAVAILABLE_CODES" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L33 | neighbors=[PortableNoClobberFilePublisher.ts]
- "security_portablenoclobberfilepublisher_portablenoclobberpublishinput": "PortableNoClobberPublishInput" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L15 | neighbors=[PortableNoClobberFilePublisher.ts]
- "security_portablenoclobberfilepublisher_portablenoclobberreservationinput": "PortableNoClobberReservationInput" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L26 | neighbors=[PortableNoClobberFilePublisher.ts]
- "security_portablenoclobberfilepublisher_portablepublishmode": "PortablePublishMode" | kind=code-symbol | source=src/lib/runtime/security/PortableNoClobberFilePublisher.ts:L5 | neighbors=[PortableNoClobberFilePublisher.ts]
- "security_runtimemutationerror_runtimemutationerrorcode": "RuntimeMutationErrorCode" | kind=code-symbol | source=src/lib/runtime/security/RuntimeMutationError.ts:L1 | neighbors=[RuntimeMutationError.ts]
- "security_runtimeprotectedroots_requiredroles": "requiredRoles" | kind=code-symbol | source=src/lib/runtime/security/RuntimeProtectedRoots.ts:L24 | neighbors=[RuntimeProtectedRoots.ts]
- "seo_route_post": "POST()" | kind=code-symbol | source=app/api/seo/route.ts:L8 | neighbors=[route.ts]
- "slug_page_emptystate": "EmptyState()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L474 | neighbors=[page.tsx]
- "slug_page_info": "Info()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L349 | neighbors=[page.tsx]
- "slug_page_listblock": "ListBlock()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L369 | neighbors=[page.tsx]
- "slug_page_projectstudiopageprops": "ProjectStudioPageProps" | kind=code-symbol | source=app/project/[slug]/page.tsx:L43 | neighbors=[page.tsx]
- "slug_page_researchpanel": "ResearchPanel()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L207 | neighbors=[page.tsx]
- "slug_page_scenepanel": "ScenePanel()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L269 | neighbors=[page.tsx]
- "slug_page_scriptpanel": "ScriptPanel()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L233 | neighbors=[page.tsx]
- "slug_page_textblock": "TextBlock()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L360 | neighbors=[page.tsx]
- "slug_page_visualpanel": "VisualPanel()" | kind=code-symbol | source=app/project/[slug]/page.tsx:L304 | neighbors=[page.tsx]
- "slug_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/production/health/[slug]/route.ts:L10 | neighbors=[route.ts]
- "sources_wikimediacommonsclient_wikimediacommonsclient_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L75 | neighbors=[WikimediaCommonsClient]
- "sources_wikimediacommonsclient_wikimediacommonsclienterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L46 | neighbors=[WikimediaCommonsClientError]
- "sources_wikimediacommonsclient_wikimediacommonsclientoptions": "WikimediaCommonsClientOptions" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L21 | neighbors=[WikimediaCommonsClient.ts]
- "sources_wikimediacommonsclient_wikimediacommonsratelimitederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L61 | neighbors=[WikimediaCommonsRateLimitedError]
- "sources_wikimediacommonsclient_wikimediaimageinfo": "WikimediaImageInfo" | kind=code-symbol | source=src/lib/assets/providers/sources/WikimediaCommonsClient.ts:L243 | neighbors=[WikimediaCommonsClient.ts]
- "steps_researchstep_researchstep": "researchStep()" | kind=code-symbol | source=src/lib/ai/steps/researchStep.ts:L1 | neighbors=[researchStep.ts]
- "steps_scenestep_legacyscenedata": "LegacySceneData" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L14 | neighbors=[sceneStep.ts]
- "steps_scenestep_legacyscenesfile": "LegacyScenesFile" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L36 | neighbors=[sceneStep.ts]
- "steps_scenestep_legacyscriptdata": "LegacyScriptData" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L8 | neighbors=[sceneStep.ts]
- "steps_scenestep_legacyscriptsection": "LegacyScriptSection" | kind=code-symbol | source=src/lib/ai/steps/sceneStep.ts:L3 | neighbors=[sceneStep.ts]
- "steps_scriptstep_scriptstep": "scriptStep()" | kind=code-symbol | source=src/lib/ai/steps/scriptStep.ts:L5 | neighbors=[scriptStep.ts]
- "storage_audiostorage_audiocompensationrecoveryresult": "AudioCompensationRecoveryResult" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L125 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_audiopublicationreceipt": "AudioPublicationReceipt" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L110 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_audioregistryhandoffresult": "AudioRegistryHandoffResult" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L78 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_audiowavvalidationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L103 | neighbors=[AudioWavValidationError]
- "storage_audiostorage_fileidentity": "FileIdentity" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L120 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_float_bits_per_sample": "FLOAT_BITS_PER_SAMPLE" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L95 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_pcm_bits_per_sample": "PCM_BITS_PER_SAMPLE" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L94 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_publicationcarrier": "PublicationCarrier" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L116 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_publicationownership": "publicationOwnership" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L97 | neighbors=[AudioStorage.ts]
- "storage_audiostorage_saveaudioinput": "SaveAudioInput" | kind=code-symbol | source=src/lib/assets/storage/AudioStorage.ts:L59 | neighbors=[AudioStorage.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-158.json

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
