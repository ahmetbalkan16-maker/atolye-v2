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

## Atölye brain council (2026-11-03)

Explicit owner instruction about the homepage, 2026-11-03: "yardımcı beyinler ayasın ana ekranında gözükebilir; sürekli kendi aralarında konuşacak, geliştirecek ve tartışacaklar; bir video yapılırken iş bölümü yapacak" (with a reference picture of agent cards around a central brain).

- The hero shows Atölye V3's brains around the central brain (`src/components/homepage/AyasBrainCouncil.tsx`): each brain with what it does now, and below the brain the council's latest five words. On narrow screens the brains become horizontal strips under the brain. The central brain, its states, the rail, the command panel, both navigations and the dock are unchanged.
- Truth: everything comes from the records the brains write, read by `src/lib/v3/council/BrainCouncilFeed.ts` through the existing read-only `loadAtolyeBrainsView` (the Gelişim Merkezi's own loader): a running production's step decides who works (the division of labour) and its log's latest lines are their words; the latest report's debates, the director's council, the idle loop's results and the developer brain's notes fill the rest. A brain without a record says "henüz kaydı yok"; an unreadable store says so; a brain is shown speaking only when its words are under 15 minutes old. No activity is invented.
- Refresh: while the page is visible the council calls the existing read-only `refreshAtolyeBrains` server action every 30 seconds — the homepage's only refresh, added by this instruction. The shell (`AyasHomepage.tsx`) still does not poll. The council has no decide, approve or execute path.
- `BrainCouncilFeed.ts` is `FORBIDDEN_AUTONOMOUS` in `BrainPatchSafety` and outside the V3 developer's allowed files (`DevQueue.forbiddenChanges`): no automatic process changes what the homepage says.
- `scripts/smoke-ayas-owner-ui-v2.ts` still pins `AyasHomepage.tsx` to 98c36b2, now plus exactly this addition (the council's import and its wrapper around the hero's unchanged content); any other difference fails.

## Shared owner workspace (2026-10-07)

The owner-approved shared `src/components/workspace/` frame applies only to subpages; `/` returns the existing central-brain composition. Explicit navigation is never generated from capabilities. The entire shared workspace directory and `scripts/smoke-ayas-owner-ui-v2.ts` are also FORBIDDEN_AUTONOMOUS, since the root layout imports its stylesheet. Automatic development cannot add homepage features through shared code.
