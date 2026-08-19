# Node Description Batch 101 of 166

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

- "projects_projectmanager_projectmanager_saveresearch": ".saveResearch()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L280 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_saveseo": ".saveSEO()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L372 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_savethumbnail": ".saveThumbnail()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L365 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_savevideo": ".saveVideo()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L352 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_saveyoutube": ".saveYouTube()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L379 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_updateattemptmetadata": ".updateAttemptMetadata()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L793 | neighbors=[ProjectManager, .updatePackageStatus()]
- "projects_projectmanager_projectmanager_updatestatus": ".updateStatus()" | kind=code-symbol | source=src/lib/projects/ProjectManager.ts:L552 | neighbors=[ProjectManager, .getProject()]
- "projects_projectprogress_createproductionsteps": "createProductionSteps()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L95 | neighbors=[projectProgress.ts, page.tsx]
- "projects_projectprogress_getnextstage": "getNextStage()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L231 | neighbors=[projectProgress.ts, getProjectProgressBySlug()]
- "projects_projectprogress_getnexttasksuggestion": "getNextTaskSuggestion()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L378 | neighbors=[projectProgress.ts, createProgressSummary()]
- "projects_projectprogress_getstatusdescription": "getStatusDescription()" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L351 | neighbors=[projectProgress.ts, createProgressSummary()]
- "projects_projectprogress_projectprogress": "ProjectProgress" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L34 | neighbors=[projectProgress.ts, PipelineResumeAction.tsx]
- "projects_projectprogress_projectprogresssummary": "ProjectProgressSummary" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L45 | neighbors=[projectProgress.ts, PipelineStatus.tsx]
- "projects_projectprogress_projectstageprogress": "ProjectStageProgress" | kind=code-symbol | source=src/lib/projects/projectProgress.ts:L19 | neighbors=[projectProgress.ts, PipelineStatus.tsx]
- "projects_projectreader_projectreader_getprojectsroot": ".getProjectsRoot()" | kind=code-symbol | source=src/lib/projects/ProjectReader.ts:L11 | neighbors=[ProjectReader, .listProjects()]
- "projects_projecttypes": "projectTypes.ts" | kind=code-symbol | source=src/lib/projects/projectTypes.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, a319525 Setup ProjectManager V2 archite…]
- "projects_projectwriter_projectwriter_ensureprojectfolder": ".ensureProjectFolder()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L14 | neighbors=[ProjectWriter, .ensureSafeProjectFolder()]
- "projects_projectwriter_projectwriter_writejson": ".writeJSON()" | kind=code-symbol | source=src/lib/projects/ProjectWriter.ts:L24 | neighbors=[ProjectWriter, .writeJSONAtomically()]
- "projects_route_getprogresssummary": "getProgressSummary()" | kind=code-symbol | source=app/api/projects/route.ts:L46 | neighbors=[route.ts, getStageSummary()]
- "projects_route_getstagesummary": "getStageSummary()" | kind=code-symbol | source=app/api/projects/route.ts:L74 | neighbors=[route.ts, getProgressSummary()]
- "prompts_animationprompt_buildanimationprompt": "buildAnimationPrompt()" | kind=code-symbol | source=src/lib/animation/prompts/animationPrompt.ts:L10 | neighbors=[animationPrompt.ts, AnimationPromptGenerator.ts]
- "prompts_animationpromptgenerator_animationpromptgenerator_createfallbackanimationscene": ".createFallbackAnimationScene()" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L170 | neighbors=[AnimationPromptGenerator, .generateAnimationScene()]
- "prompts_animationpromptgenerator_animationpromptgenerator_generateanimationdata": ".generateAnimationData()" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L32 | neighbors=[AnimationPromptGenerator, .generateAnimationScene()]
- "prompts_animationpromptgenerator_animationpromptgenerator_generateanimationscenedata": ".generateAnimationSceneData()" | kind=code-symbol | source=src/lib/animation/prompts/AnimationPromptGenerator.ts:L66 | neighbors=[AnimationPromptGenerator, .generateAnimationScene()]
- "prompts_assemblyprompt_createassemblyprompt": "createAssemblyPrompt()" | kind=code-symbol | source=src/lib/assembly/prompts/assemblyPrompt.ts:L7 | neighbors=[AssemblyManager.ts, assemblyPrompt.ts]
- "prompts_audioprompt_createaudioprompt": "createAudioPrompt()" | kind=code-symbol | source=src/lib/audio/prompts/audioPrompt.ts:L3 | neighbors=[AudioManager.ts, audioPrompt.ts]
- "prompts_researchprompt": "researchPrompt.ts" | kind=code-symbol | source=src/lib/ai/prompts/researchPrompt.ts:L1 | neighbors=[91ba270 Atölye V2 checkpoint - pipeline…, researchPrompt()]
- "prompts_script_createscriptprompt": "createScriptPrompt()" | kind=code-symbol | source=src/lib/ai/prompts/script.ts:L1 | neighbors=[script.ts, scriptStep.ts]
- "prompts_seoprompt_createseoprompt": "createSEOPrompt()" | kind=code-symbol | source=src/lib/seo/prompts/seoPrompt.ts:L4 | neighbors=[seoPrompt.ts, SEOManager.ts]
- "prompts_thumbnailprompt_createthumbnailprompt": "createThumbnailPrompt()" | kind=code-symbol | source=src/lib/thumbnail/prompts/thumbnailPrompt.ts:L4 | neighbors=[thumbnailPrompt.ts, ThumbnailManager.ts]
- "prompts_youtubepackageprompt_createyoutubepackageprompt": "createYouTubePackagePrompt()" | kind=code-symbol | source=src/lib/youtube/prompts/youtubePackagePrompt.ts:L3 | neighbors=[youtubePackagePrompt.ts, OpenAIYouTubeProvider.ts]
- "providers_aiprovider_aiprovideroutput": "AIProviderOutput" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L20 | neighbors=[AIProvider.ts, index.ts]
- "providers_aiprovider_aiproviderusage": "AIProviderUsage" | kind=code-symbol | source=src/lib/ai/providers/AIProvider.ts:L5 | neighbors=[AIProvider.ts, index.ts]
- "providers_animationproviderconfig_validopenaiendpoint": "validOpenAIEndpoint()" | kind=code-symbol | source=src/lib/animation/providers/AnimationProviderConfig.ts:L57 | neighbors=[AnimationProviderConfig.ts, getOpenAIAnimationProviderConfig()]
- "providers_exportprovider_exportgenerationresult": "ExportGenerationResult" | kind=code-symbol | source=src/lib/export/providers/ExportProvider.ts:L29 | neighbors=[ExportProvider.ts, MockExportProvider.ts]
- "providers_ffmpegscenevideoprovider_absoluteinput": "absoluteInput()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L357 | neighbors=[FFmpegSceneVideoProvider.ts, buildSceneFFmpegArgs()]
- "providers_ffmpegscenevideoprovider_buildsceneffprobeargs": "buildSceneFFprobeArgs()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L298 | neighbors=[FFmpegSceneVideoProvider.ts, .generateVideo()]
- "providers_ffmpegscenevideoprovider_interpolate": "interpolate()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L294 | neighbors=[FFmpegSceneVideoProvider.ts, buildMotionFilter()]
- "providers_ffmpegscenevideoprovider_requiresuccessfulprocess": "requireSuccessfulProcess()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L340 | neighbors=[FFmpegSceneVideoProvider.ts, .generateVideo()]
- "providers_ffmpegscenevideoprovider_validateexecutable": "validateExecutable()" | kind=code-symbol | source=src/lib/video/providers/FFmpegSceneVideoProvider.ts:L351 | neighbors=[FFmpegSceneVideoProvider.ts, .generateVideo()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-100.json

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
