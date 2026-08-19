# Node Description Batch 127 of 166

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

- "components_homeclient_homeclient": "HomeClient()" | kind=code-symbol | source=src/components/HomeClient.tsx:L23 | neighbors=[HomeClient.tsx]
- "components_homeclient_loadingmessages": "loadingMessages" | kind=code-symbol | source=src/components/HomeClient.tsx:L9 | neighbors=[HomeClient.tsx]
- "components_homeclient_pipelineresponse": "PipelineResponse" | kind=code-symbol | source=src/components/HomeClient.tsx:L16 | neighbors=[HomeClient.tsx]
- "components_sidebar_menuitems": "menuItems" | kind=code-symbol | source=src/components/Sidebar.tsx:L3 | neighbors=[Sidebar.tsx]
- "components_sidebar_sidebar": "Sidebar()" | kind=code-symbol | source=src/components/Sidebar.tsx:L15 | neighbors=[Sidebar.tsx]
- "components_styleselector_styleselector": "StyleSelector()" | kind=code-symbol | source=src/components/StyleSelector.tsx:L6 | neighbors=[StyleSelector.tsx]
- "components_styleselector_styleselectorprops": "StyleSelectorProps" | kind=code-symbol | source=src/components/StyleSelector.tsx:L1 | neighbors=[StyleSelector.tsx]
- "components_topicinput_topicinput": "TopicInput()" | kind=code-symbol | source=src/components/TopicInput.tsx:L8 | neighbors=[TopicInput.tsx]
- "components_topicinput_topicinputprops": "TopicInputProps" | kind=code-symbol | source=src/components/TopicInput.tsx:L1 | neighbors=[TopicInput.tsx]
- "dashboard_dashboardlayout_dashboardlayout": "DashboardLayout()" | kind=code-symbol | source=src/components/dashboard/DashboardLayout.tsx:L5 | neighbors=[DashboardLayout.tsx]
- "dashboard_dashboardlayout_dashboardlayoutprops": "DashboardLayoutProps" | kind=code-symbol | source=src/components/dashboard/DashboardLayout.tsx:L1 | neighbors=[DashboardLayout.tsx]
- "dashboard_dashboardstats_dashboardstats": "DashboardStats()" | kind=code-symbol | source=src/components/dashboard/DashboardStats.tsx:L10 | neighbors=[DashboardStats.tsx]
- "dashboard_dashboardstats_project": "Project" | kind=code-symbol | source=src/components/dashboard/DashboardStats.tsx:L5 | neighbors=[DashboardStats.tsx]
- "dashboard_projectlist_project": "Project" | kind=code-symbol | source=src/components/dashboard/ProjectList.tsx:L8 | neighbors=[ProjectList.tsx]
- "dashboard_projectlist_projectlist": "ProjectList()" | kind=code-symbol | source=src/components/dashboard/ProjectList.tsx:L34 | neighbors=[ProjectList.tsx]
- "dashboard_projectlist_projectprogressstagesummary": "ProjectProgressStageSummary" | kind=code-symbol | source=src/components/dashboard/ProjectList.tsx:L29 | neighbors=[ProjectList.tsx]
- "dashboard_projectlist_projectprogresssummary": "ProjectProgressSummary" | kind=code-symbol | source=src/components/dashboard/ProjectList.tsx:L17 | neighbors=[ProjectList.tsx]
- "docsarch_doc": "docs/Architecture.md" | kind=entity | source=docs/Architecture.md | neighbors=[docs/Roadmap.md]
- "docsroadmap_doc": "docs/Roadmap.md" | kind=entity | source=docs/Roadmap.md | neighbors=[docs/Architecture.md]
- "eslint_config_eslintconfig": "eslintConfig" | kind=code-symbol | source=eslint.config.mjs:L5 | neighbors=[eslint.config.mjs]
- "execsafety_doc": "docs/PRODUCTION_EXECUTION_SAFETY.md" | kind=entity | source=docs/PRODUCTION_EXECUTION_SAFETY.md | neighbors=[docs/PRODUCTION_EXECUTION_PHASE_REVIEW.…]
- "export_exportengine_exportengine_constructor": ".constructor()" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L19 | neighbors=[ExportEngine]
- "export_exportengine_generateexportpackageinput": "GenerateExportPackageInput" | kind=code-symbol | source=src/lib/export/ExportEngine.ts:L12 | neighbors=[ExportEngine.ts]
- "export_exportproviderrouter_exportproviderrouter_constructor": ".constructor()" | kind=code-symbol | source=src/lib/export/ExportProviderRouter.ts:L13 | neighbors=[ExportProviderRouter]
- "export_exportproviderrouter_exportproviderrouter_getprovider": ".getProvider()" | kind=code-symbol | source=src/lib/export/ExportProviderRouter.ts:L23 | neighbors=[ExportProviderRouter]
- "filename_route_root_dir": "ROOT_DIR" | kind=code-symbol | source=app/api/assets/images/[slug]/[fileName]/route.ts:L11 | neighbors=[route.ts]
- "filename_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/assets/videos/[slug]/[fileName]/route.ts:L5 | neighbors=[route.ts]
- "fixtures_sprint_129_33_path_race_child_racemutationcounters": "RaceMutationCounters" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L17 | neighbors=[sprint-129-33-path-race-child.ts]
- "fixtures_sprint_129_33_path_race_child_target": "Target" | kind=code-symbol | source=scripts/fixtures/sprint-129-33-path-race-child.ts:L14 | neighbors=[sprint-129-33-path-race-child.ts]
- "health_productionhealthcorerules_toplevelsources": "topLevelSources()" | kind=code-symbol | source=src/lib/production/health/ProductionHealthCoreRules.ts:L60 | neighbors=[ProductionHealthCoreRules.ts]
- "health_route_productiondependencies": "productionDependencies" | kind=code-symbol | source=app/api/runtime/health/route.ts:L15 | neighbors=[route.ts]
- "health_route_productionruntimehealthdependencies": "ProductionRuntimeHealthDependencies" | kind=code-symbol | source=app/api/runtime/health/route.ts:L10 | neighbors=[route.ts]
- "history_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/history/route.ts:L6 | neighbors=[route.ts]
- "instrumentation_register": "register()" | kind=code-symbol | source=instrumentation.ts:L1 | neighbors=[instrumentation.ts]
- "jobid_route_jobactionrequestbody": "JobActionRequestBody" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L15 | neighbors=[route.ts]
- "jobid_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/[jobId]/route.ts:L8 | neighbors=[route.ts]
- "jobs_route_routecontext": "RouteContext" | kind=code-symbol | source=app/api/projects/[slug]/pipeline/jobs/route.ts:L6 | neighbors=[route.ts]
- "lib_canonicalsmokeevidence_canonicalevidenceerror_constructor": ".constructor()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L29 | neighbors=[CanonicalEvidenceError]
- "lib_canonicalsmokeevidence_child": "child()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L32 | neighbors=[CanonicalSmokeEvidence.ts]
- "lib_canonicalsmokeevidence_compare": "compare()" | kind=code-symbol | source=scripts/lib/CanonicalSmokeEvidence.ts:L115 | neighbors=[CanonicalSmokeEvidence.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: C:\Users\Metod\atolye-v2\.graphify\description-instructions\batch-126.json

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
