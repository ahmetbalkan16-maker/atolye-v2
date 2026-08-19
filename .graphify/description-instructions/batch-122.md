# Node Description Batch 123 of 166

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

- "ai_audioaiconfig_audioaiconfigerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/AudioAIConfig.ts:L11 | neighbors=[AudioAIConfigError]
- "ai_canonicaltimestamp_applicationtimestamperror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/CanonicalTimestamp.ts:L4 | neighbors=[ApplicationTimestampError]
- "ai_client_chatcompletioncreateparams": "ChatCompletionCreateParams" | kind=code-symbol | source=src/lib/ai/client.ts:L6 | neighbors=[client.ts]
- "ai_client_chatcompletionmessage": "ChatCompletionMessage" | kind=code-symbol | source=src/lib/ai/client.ts:L1 | neighbors=[client.ts]
- "ai_client_chatcompletionresponse": "ChatCompletionResponse" | kind=code-symbol | source=src/lib/ai/client.ts:L13 | neighbors=[client.ts]
- "ai_client_createchatcompletion": "createChatCompletion()" | kind=code-symbol | source=src/lib/ai/client.ts:L28 | neighbors=[client.ts]
- "ai_generationexecutionpolicy_generationfallbackblockederror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/GenerationExecutionPolicy.ts:L11 | neighbors=[GenerationFallbackBlockedError]
- "ai_pipeline_defaultprovider": "defaultProvider" | kind=code-symbol | source=src/lib/ai/pipeline.ts:L8 | neighbors=[pipeline.ts]
- "ai_pipeline_router": "router" | kind=code-symbol | source=src/lib/ai/pipeline.ts:L6 | neighbors=[pipeline.ts]
- "ai_pipeline_runpipeline": "runPipeline()" | kind=code-symbol | source=src/lib/ai/pipeline.ts:L10 | neighbors=[pipeline.ts]
- "ai_researchaiconfig_researchaiconfigerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/ResearchAIConfig.ts:L11 | neighbors=[ResearchAIConfigError]
- "ai_researchstructuredoutput_arrayfields": "arrayFields" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L38 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_arrayfieldschema": "arrayFieldSchema" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L18 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_canonicalresearchproviderschema": "canonicalResearchProviderSchema" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L41 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_issafeabsolutehttpurl": "isSafeAbsoluteHttpUrl()" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L185 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_providerfields": "providerFields" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L39 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_stringfields": "stringFields" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L37 | neighbors=[ResearchStructuredOutput.ts]
- "ai_researchstructuredoutput_stringfieldschema": "stringFieldSchema" | kind=code-symbol | source=src/lib/ai/ResearchStructuredOutput.ts:L12 | neighbors=[ResearchStructuredOutput.ts]
- "ai_runobservedairequest_observedairequestinput": "ObservedAIRequestInput" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L12 | neighbors=[runObservedAIRequest.ts]
- "ai_runobservedairequest_observedairequestresult": "ObservedAIRequestResult" | kind=code-symbol | source=src/lib/ai/runObservedAIRequest.ts:L19 | neighbors=[runObservedAIRequest.ts]
- "ai_scenestructuredoutput_canonicalsceneproviderschema": "canonicalSceneProviderSchema" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L23 | neighbors=[SceneStructuredOutput.ts]
- "ai_scenestructuredoutput_scenefields": "sceneFields" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L14 | neighbors=[SceneStructuredOutput.ts]
- "ai_scenestructuredoutput_stringfields": "stringFields" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L17 | neighbors=[SceneStructuredOutput.ts]
- "ai_scenestructuredoutput_toplevelfields": "topLevelFields" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L13 | neighbors=[SceneStructuredOutput.ts]
- "ai_scenestructuredoutput_validduration": "validDuration()" | kind=code-symbol | source=src/lib/ai/SceneStructuredOutput.ts:L194 | neighbors=[SceneStructuredOutput.ts]
- "ai_schema_scriptsection": "ScriptSection" | kind=code-symbol | source=src/lib/ai/schema.ts:L1 | neighbors=[schema.ts]
- "ai_scriptaiconfig_scriptaiconfigerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/ScriptAIConfig.ts:L11 | neighbors=[ScriptAIConfigError]
- "ai_scriptstructuredoutput_canonicalscriptproviderschema": "canonicalScriptProviderSchema" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L29 | neighbors=[ScriptStructuredOutput.ts]
- "ai_scriptstructuredoutput_chapterfields": "chapterFields" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L17 | neighbors=[ScriptStructuredOutput.ts]
- "ai_scriptstructuredoutput_chapterstringlimits": "chapterStringLimits" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L25 | neighbors=[ScriptStructuredOutput.ts]
- "ai_scriptstructuredoutput_stringlimits": "stringLimits" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L20 | neighbors=[ScriptStructuredOutput.ts]
- "ai_scriptstructuredoutput_toplevelfields": "topLevelFields" | kind=code-symbol | source=src/lib/ai/ScriptStructuredOutput.ts:L11 | neighbors=[ScriptStructuredOutput.ts]
- "ai_usage_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/ai-usage/route.ts:L5 | neighbors=[route.ts]
- "ai_validator_validatescript": "validateScript()" | kind=code-symbol | source=src/lib/ai/validator.ts:L3 | neighbors=[validator.ts]
- "ai_visualengine_createvisualprompt": "createVisualPrompt()" | kind=code-symbol | source=src/lib/ai/visualEngine.ts:L14 | neighbors=[visualEngine.ts]
- "ai_visualengine_generatevisualprompts": "generateVisualPrompts()" | kind=code-symbol | source=src/lib/ai/visualEngine.ts:L45 | neighbors=[visualEngine.ts]
- "ai_visualengine_scenedatainput": "SceneDataInput" | kind=code-symbol | source=src/lib/ai/visualEngine.ts:L10 | neighbors=[visualEngine.ts]
- "ai_visualengine_sceneitem": "SceneItem" | kind=code-symbol | source=src/lib/ai/visualEngine.ts:L3 | neighbors=[visualEngine.ts]
- "ai_visualsaiconfig_visualsaiconfigerror_constructor": ".constructor()" | kind=code-symbol | source=src/lib/ai/VisualsAIConfig.ts:L11 | neighbors=[VisualsAIConfigError]
- "ai_visualstructuredoutput_canonicalvisualplan": "CanonicalVisualPlan" | kind=code-symbol | source=src/lib/ai/VisualStructuredOutput.ts:L43 | neighbors=[VisualStructuredOutput.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-122.json

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
