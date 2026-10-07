# AYAS homepage — owner authority

Effective: 2026-10-07. Direct owner instruction in the Brain UI V2 request.

The final visual is `ayas-execution/2026-09-27-master/07_BRAIN_UI_V2/OWNER_FINAL_VISUAL_2026-10-07.png`. It supersedes all previous visual alternatives, including the older image retained in the design pack. The transparent brain is decorative; all navigation, conversation and status are working DOM components backed by existing AYAS state.

Once Brain UI V2 is implemented, AYAS self-development / Gelişim Merkezi processes must never automatically add or change homepage cards, text, buttons, panels, widgets or features. New functions belong on an appropriate existing or new subpage/tab. A homepage change requires an **explicit owner instruction about the homepage**. General autonomy, proposal approval, or a feature-development request is not homepage authorization.

## Implementation boundary

- `/` renders the owner-fixed `src/components/homepage/` shell, explicit seven-item top navigation and six-item bottom dock. Neither navigation is generated from capabilities, proposals, domains or plugins.
- `/brain` retains all existing detail panels. Deep links select only a known `BRAIN_PANELS` id; unknown or repeated query values select chat.
- `/studio` retains the original project dashboard, topic entry, pipeline POST and project outcome routing. Its pending text describes only the actual outstanding server request.
- The same `AyasConsolePage` server loader, `BrainCoreConsole` conversation/voice owner and existing Chat/Tasks panels serve the homepage. No second router, model, voice engine, data root, execution gate or approval path exists.
- The homepage has its own CSS. The evolving `/brain` stylesheet is not imported on `/`. Its old automatic patch classification is unchanged.
- `BrainPatchSafety` classifies the homepage directory, decorative assets, root route/layout/global CSS, shared console/view/loader this policy, AGENTS.md and the independent homepage regression suite as `FORBIDDEN_AUTONOMOUS`, before generic presentational-UI/doc rules. Automated patch sets containing these files cannot be auto-applicable. This prevents even an ordinary proposal approval from authorizing AYAS to rewrite the homepage. An explicitly instructed human development session can review and implement an owner-requested change.
- Labels/counts/errors in the fixed status slots may reflect new real observations. This does not create a new UI feature or surface. New detail items remain in the existing Control Center.

## Truth and authority

Brain animation consumes the existing live-state reducer. Listening, thinking and speaking indicators are mutually exclusive and active only for their real state. Work/tool state comes from the existing worker/stream signals. Unknown, absent, failed and loading sources remain visible; no numeric percentage, demo health or simultaneous invented activity is rendered. The status rail uses the existing Control Center model and streams its facts without adding polling.

Voice permission/disclosure, conversation persistence, streaming abort, audio interruption, mute/replay and text fallback keep the existing contracts. A visual state never grants execution or approval authority. Foundation remains BLOCKED; Stage17 frozen graders, fixtures, pins and historical raw evidence are unchanged.

Regression: `scripts/smoke-ayas-homepage-v2.ts` is an independent new suite. Do not modify frozen historical evaluators to make this design appear accepted.

## Shared owner workspace (2026-10-07)

The owner-approved shared `src/components/workspace/` frame applies only to subpages; `/` returns the existing central-brain composition. Explicit navigation is never generated from capabilities. The entire shared workspace directory and `scripts/smoke-ayas-owner-ui-v2.ts` are also FORBIDDEN_AUTONOMOUS, since the root layout imports its stylesheet. Automatic development cannot add homepage features through shared code.
