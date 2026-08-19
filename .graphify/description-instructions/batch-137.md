# Node Description Batch 138 of 166

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

- "projects_projectmanager_scenesartifactconflicterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L41 | neighbors=[ScenesArtifactConflictError]
- "projects_projectmanager_scriptartifactconflicterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L31 | neighbors=[ScriptArtifactConflictError]
- "projects_projectmanager_updatepackagestatusoptions": "UpdatePackageStatusOptions" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L23 | neighbors=[ProjectManager.ts]
- "projects_projectmanager_visualsartifactconflicterror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L51 | neighbors=[VisualsArtifactConflictError]
- "projects_projectprogress_manifestprojectprogress": "ManifestProjectProgress" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L57 | neighbors=[projectProgress.ts]
- "projects_projectprogress_productionprogressinput": "ProductionProgressInput" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L17 | neighbors=[projectProgress.ts]
- "projects_projectprogress_projectprogresscurrentstage": "ProjectProgressCurrentStage" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L55 | neighbors=[projectProgress.ts]
- "projects_projectprogress_projectprogressstages": "projectProgressStages" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L63 | neighbors=[projectProgress.ts]
- "projects_projectprogress_steplabels": "stepLabels" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L80 | neighbors=[projectProgress.ts]
- "projects_projectprogresscard_progressbadge": "ProgressBadge()" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L75 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectprogresscard_progressbar": "ProgressBar()" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L83 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectprogresscard_progressstagesummary": "ProgressStageSummary" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L15 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectprogresscard_projectprogresscard": "ProjectProgressCard()" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L20 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectprogresscard_projectprogresscardprops": "ProjectProgressCardProps" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L3 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectprogresscard_stagelabel": "StageLabel()" | kind=code-symbol | source=src/components/projects/ProjectProgressCard.tsx:L94 | neighbors=[ProjectProgressCard.tsx]
- "projects_projectreader_projectjsonreadresult": "ProjectJSONReadResult" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L109 | neighbors=[ProjectReader.ts]
- "projects_route_get": "GET()" | kind=code-symbol | source=app/api/projects/route.ts:L30 | neighbors=[route.ts]
- "projects_route_projectlistitem": "ProjectListItem" | kind=code-symbol | source=app/api/projects/route.ts:L26 | neighbors=[route.ts]
- "projects_route_projectprogressstagesummary": "ProjectProgressStageSummary" | kind=code-symbol | source=app/api/projects/route.ts:L21 | neighbors=[route.ts]
- "projects_route_projectprogresssummary": "ProjectProgressSummary" | kind=code-symbol | source=app/api/projects/route.ts:L9 | neighbors=[route.ts]
- "projects_visualmanager_data_dir": "DATA_DIR" | kind=code-symbol | source=src/lib/projects/VisualManager.ts:L5 | neighbors=[VisualManager.ts]
- "prompts_animationprompt_buildanimationpromptinput": "BuildAnimationPromptInput" | kind=code-symbol | source=src/lib/animation/prompts/animationPrompt.ts:L4 | neighbors=[animationPrompt.ts]
- "prompts_animationpromptgenerator_animationpromptgeneratorinput": "AnimationPromptGeneratorInput" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L14 | neighbors=[AnimationPromptGenerator.ts]
- "prompts_animationpromptgenerator_animationpromptresponse": "AnimationPromptResponse" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L25 | neighbors=[AnimationPromptGenerator.ts]
- "prompts_animationpromptgenerator_generateanimationdata": "generateAnimationData()" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L191 | neighbors=[AnimationPromptGenerator.ts]
- "prompts_researchprompt_researchprompt": "researchPrompt()" | kind=code-symbol | source=src/lib/ai/prompts/researchPrompt.ts:L1 | neighbors=[researchPrompt.ts]
- "prompts_visualprompt_createvisualprompt": "createVisualPrompt()" | kind=code-symbol | source=src/lib/visuals/prompts/visualPrompt.ts:L3 | neighbors=[visualPrompt.ts]
- "providers_animationprovider_animationgenerationfailure": "AnimationGenerationFailure" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L42 | neighbors=[AnimationProvider.ts]
- "providers_animationprovider_animationgenerationresultbase": "AnimationGenerationResultBase" | kind=code-symbol | source=src/lib/animation/providers/AnimationProvider.ts:L20 | neighbors=[AnimationProvider.ts]
- "providers_animationproviderconfig_animationproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L7 | neighbors=[AnimationProviderConfigurationError]
- "providers_animationproviderrouter_animationproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderRouter.ts:L7 | neighbors=[AnimationProviderRouter]
- "providers_audioproviderconfig_audioproviderconfigurationerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L14 | neighbors=[AudioProviderConfigurationError]
- "providers_audioproviderconfig_openaiaudioproviderconfig": "OpenAIAudioProviderConfig" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderConfig.ts:L21 | neighbors=[AudioProviderConfig.ts]
- "providers_audioproviderrouter_audioproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderRouter.ts:L7 | neighbors=[AudioProviderRouter]
- "providers_audioproviderrouter_getdefaultprovider": "getDefaultProvider()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderRouter.ts:L17 | neighbors=[AudioProviderRouter.ts]
- "providers_audioproviderrouter_getprovider": "getProvider()" | kind=code-symbol | source=src/lib/audio/providers/AudioProviderRouter.ts:L21 | neighbors=[AudioProviderRouter.ts]
- "providers_claude": "claude.ts" | kind=code-symbol | source=src/lib/ai/providers/claude.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…]
- "providers_claudeprovider_aiprovider": "AIProvider" | kind=code-symbol | neighbors=[ClaudeProvider]
- "providers_claudeprovider_claudeprovider_generate": ".generate()" | kind=code-symbol | source=src/lib/ai/providers/ClaudeProvider.ts:L4 | neighbors=[ClaudeProvider]
- "providers_ffmpegscenevideoprovider_configuredvideoprovider": "ConfiguredVideoProvider" | kind=code-symbol | neighbors=[FFmpegSceneVideoProvider]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-137.json

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
