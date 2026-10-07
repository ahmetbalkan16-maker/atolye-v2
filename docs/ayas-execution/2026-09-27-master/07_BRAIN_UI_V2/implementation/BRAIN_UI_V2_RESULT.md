# Brain UI V2 — implementation and qualified evidence

Date: 2026-10-07. Session base: `9f8f591a13a85e99f849ccc7cc3a2ea66e39cfee`.
Branch: `wip/ayas-graphify-final-execution`. Final source/save commits are resolved from Git; the follow-up receipt binds the implementation commit without claiming its own self-referential hash.

Status: **IMPLEMENTED / ISOLATED VALIDATION PASS / LIVE OWNER VALIDATION NOT_RUN**. Foundation remains **BLOCKED**. This is not a new all166 qualification or a deployment receipt.

## Owner reference and authority

The direct owner's final image, [OWNER_FINAL_VISUAL_2026-10-07.png](../OWNER_FINAL_VISUAL_2026-10-07.png), supersedes all older alternatives. The supplied ZIP was absent at its named Downloads path. The three already-canonical Brain UI V2 planning/validation documents and supplied post-freeze addendum were used as supporting specifications; their historical stop boundaries were superseded only by the direct owner's explicit homepage instruction. No document content was treated as independent execution authority.

The homepage preserves the simple central cyan/gold brain, glass side surfaces, seven top destinations and six bottom destinations. No fabricated identity, clock, percentages, healthy-service values or simultaneous listening/thinking/speaking states were copied from the mockup. Decorative light is separate from real state.

## Implementation and compatibility

- `app/page.tsx`: real dynamic AYAS homepage. `app/studio/page.tsx`: original studio/dashboard entry, existing topic POST and project routing retained.
- `AyasConsolePage.tsx`: shared original server snapshot/action loader for `/` and `/brain`; no duplicate execution engine or data root.
- `BrainCoreConsole.tsx` / `BrainConsoleView.tsx`: opt-in homepage presentation around existing chat, stream cancellation, persistence, voice permission/disclosure, audio interruption, mute, replay, errors and task view. Full detail console remains `/brain`.
- `/brain?panel=` selects an existing known panel; unknown/repeated values safely select chat. All fixed destinations use existing pages or panels.
- `src/components/homepage/AyasHomepage.tsx` and its independent CSS: real Control Center facts under Suspense, existing refresh action, state-reducer-driven DOM/CSS brain, actual chat controls and accessible labels. No new fetch, polling, model calls or automatic capability enumeration.
- Idle/active breathing, listening orbit, thinking orbit, speaking breathing, work/tool/autonomy flow, amber warning/error and paused/desaturated offline states consume existing real signals. Reduced-motion CSS disables all animation.
- `HomeClient.tsx`: removed the elapsed-time-based invented production stage labels; pending text now describes the outstanding server response.
- `BrainPatchSafety.ts`, `AGENTS.md` and [homepage policy](../../../../AYAS_HOMEPAGE_POLICY.md): explicit owner homepage instruction required. Homepage surfaces, shared loader/console/view, policy, AGENTS and independent regression suite are FORBIDDEN_AUTONOMOUS before generic safe-UI/doc rules. New self-development functions belong on suitable subpages/tabs. Existing detail-console stylesheet classification stays compatible.

## Verification

TypeScript `tsc --noEmit --incremental false`: PASS. Full eslint: **0 errors / 13 inherited warnings**, no new warnings. `git diff --check`: PASS. Logs are adjacent to this report.

| Relevant suite | Scenarios |
| --- | ---: |
| brain-core-ui | 43 |
| ayas-brain-control-center | 39 |
| ayas-chat-stream | 31 |
| ayas-chat-stream-client | 11 |
| ayas-mobile-voice-regression | 36 |
| brain-conversation | 8 |
| brain-lifecycle | 16 |
| pipeline-start-outcome | 8 |
| brain-selfheal-security | 14 |
| brain-selfheal | 41 |
| ayas-exact-patch-safety | 23 |
| ayas-exact-proposal-safety | 28 |
| ayas-homepage-v2, new independent suite | 11 |
| Total, all PASS | 309 |

The new suite covers fixed navigation, every real brain state, mutually exclusive activity, unknown sources, reducer precedence, stream stop/error, voice opt-in/mute/replay/interruption/text, tasks, protected path case/slash handling, no authority/polling/registry enumeration, preserved production routing and non-blocking facts streaming. No frozen historical evaluator was edited.

Standard lock-based Next16.3.8 production build ran in the isolated TEMP candidate with fresh `npm ci --ignore-scripts`, not the main checkout's running `.next`. The build passed; known filesystem-tracing warnings originate from existing runtime modules, and middleware deprecation is disclosed. Build provenance belongs to the isolated fixture, never the live release. Candidate copied the exact unchanged evaluator manifest/cloudflare sources required by TypeScript. No main dependency migration occurred.

Browser checks use CUA against a loopback-only isolated preview with a synthetic Git identity and no owner credentials/runtime stores. [Responsive receipt](screenshots/responsive-check.json) and full-page screenshots: [1920×1080](screenshots/1920x1080.png), [1440×900](screenshots/1440x900.png), [1366×768](screenshots/1366x768.png), [1024×768](screenshots/1024x768.png), [390×844](screenshots/390x844.png). All five and an extra 320px check have zero horizontal overflow; smaller screens deliberately scroll vertically. 1920×1080 fits one screen. Actual tasks switch showed an empty real queue; typing/clearing changed active→idle; keyboard Tab gave Send a visible solid focus outline; Memory dock navigation selected the existing Memory panel. Homepage console error/warn inspection was empty. The old full `/brain` executive briefing cannot authenticate in this credential-free fixture and reports OWNER_SESSION_REQUIRED; this is not a successful authenticated runtime test.

Accessibility checks: semantic landmarks/labels, decorative SVG/image hidden from assistive technology, live status text independent of animation, 16px text input, visible keyboard outline, safe-area padding and minimum 44px principal controls. Reduced motion is statically verified in loaded source, not an OS preference-toggle test. Physical phone touch, real microphone/audio/barge-in and actual runtime identity remain NOT_RUN.

## Graphify and preserved foundation

Pre-change graph matched the clean base HEAD: not stale, worktree covered; structural PARTIAL9 and semantic PENDING disclosed; 19,244 nodes / 55,163 links. Integrity: duplicate node IDs, duplicate edges, dangling edges and self-loops all zero. Graphify-first explain/review identified the shared Console/View/patch classifier as bridges; relevant 309 regressions cover those boundaries. Post-change and exact final-HEAD observations are in the Graphify receipts adjacent to this report; PARTIAL parser coverage is never labeled complete semantic coverage.

Stage17 graders, fixtures, pins, raw reports and closure registers are unchanged. Historical `fde898f` full166 is still 163PASS/3 preserved raw FAIL; it is not rebound to this modified source. Foundation BLOCKED, six owner actions and technical closure gaps remain open. Current checkpoint distinguishes completed homepage implementation from incomplete live owner validation.

## Asset provenance

The original owner reference is retained above. ImageGen generated the transparent decorative brain only from that image, using extraction instructions: preserve a detailed luminous cyan neural brain with sparse warm gold intersections; omit all UI/text, labels, rings/platform, background and environment; transparent background. Generated source: `C:/Users/Metod/.codex/generated_images/01a11689-97fa-7bd1-a24d-ab7045622f71/exec-3914881b-feee-4a70-a15f-f48b1afe33fa.png`. Sharp encoded its 1000×1000 alpha WebP as `public/ayas/brain/ayas-brain-core-v2.webp` (233,150 bytes). Rings and state behavior are native CSS/DOM. No image contains functional controls.

## Remaining qualification

Runtime deployment/restart and installed Next16.2.10 versus lock16.3.8 alignment stay with the existing Stage17 coordination process. No actual release, owner-device acceptance, microphone permission grant, Foundation closure or autonomous execution authority was produced by this sprint. Isolated preview is stopped after screenshots. Continue with coordinated rollout and authenticated desktop/physical phone voice-continuity checks, preserving all original blockers.
