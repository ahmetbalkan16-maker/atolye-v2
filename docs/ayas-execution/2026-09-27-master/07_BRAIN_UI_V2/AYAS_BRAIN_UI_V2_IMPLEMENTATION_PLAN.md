# AYAS Brain Control Center — Approved Visual Integration Plan

## Approved visual target

Reference image:
`ayas_yapay_zekâ_kontrol_merkezi.png`

Goal:
Rebuild the approved visual as a real, interactive `/brain` UI while preserving all existing AYAS safety, data and authority boundaries.

DO NOT ship the reference screenshot as the whole page.
Use it as the visual specification.

## Existing implementation to reuse

- `app/brain/page.tsx`
- `src/components/brain/BrainCoreConsole.tsx`
- `src/components/brain/BrainConsoleView.tsx`
- `src/components/brain/BrainCoreOrb.tsx`
- `src/components/brain/BrainCore.css`
- `src/components/brain/AyasControlCenter.tsx`
- `src/lib/brain/ui/AyasControlCenterModel.ts`
- `src/lib/brain/ui/AyasControlCenterCollector.ts`

Existing chat, voice, approvals, Control Center facts and safety logic remain authoritative.

## Architecture

### 1. Main shell

Desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Navigation / AYAS global state                           │
├───────────────┬─────────────────────────┬────────────────────┤
│ Left Status   │ Central Brain Core      │ Command Center     │
│ 300–360px     │ fluid hero              │ 380–450px          │
│               │                         │                    │
├───────────────┴─────────────────────────┴────────────────────┤
│ Bottom Domain Dock — Graphify / Memory / Retrieval / ...     │
└──────────────────────────────────────────────────────────────┘
```

Use CSS Grid, not absolute page positioning.

Suggested new structure inside `BrainConsoleView`:

- `AyasTopNavigation`
- `AyasSystemStatusRail`
- `AyasBrainHero`
- existing `CommandCenter`
- `AyasModuleDock`

All remain under `.bc-shell`.

## 2. Top navigation

New component:
`src/components/brain/AyasBrainTopNav.tsx`

Visual target:
- AYAS logo/title left
- compact nav tabs: Home / Systems / Knowledge / Research / Evolution / Analytics
- right: global search/command affordance, notification state, AYAS online state

Phase 1:
visual/navigation only.
Do not invent new backend functions.

## 3. Left status rail

New:
`src/components/brain/AyasBrainStatusRail.tsx`

Source:
existing `AyasControlCenterModel` / `AyasControlCenterServerFacts`.

Cards:
- System Health
- Memory
- Retrieval
- Autonomy
- Research
- Runtime
- Security

Important:
Do not fabricate percentages.

The reference image percentages are visual examples only.
Production UI must display:
- real metric when a measured numeric metric exists;
- otherwise a word state (`Healthy`, `Online`, `Current`, `Running`, `Unavailable`);
- optional progress visualization only when mathematically meaningful.

Never convert arbitrary status into a fake percentage.

## 4. Central AYAS brain hero

Reuse and enhance:
`BrainCoreOrb.tsx`

Recommended implementation:
- real DOM/CSS/SVG rings and state animations;
- one transparent visual asset for the detailed brain texture;
- CSS/SVG orbital labels;
- animated scan lines/particles already present in the current Orb implementation.

New visual asset:
`public/ayas/brain/ayas-brain-core-v2.webp` or `.png`
transparent background, brain only.

Layers:
1. atmospheric halo
2. orbit rings
3. transparent brain asset
4. AYAS mark/logo
5. scan layer
6. particles
7. state glow
8. pedestal/light projection

Orb state continues to come from current:
`idle / listening / thinking / speaking / warning / error / offline`

Do not let visual state grant any authority.

Suggested orbital labels:
- UNDERSTAND
- CREATE
- AMPLIFY
- SERVE HUMANITY
- PROTECT
- EVOLVE

These are decorative labels only.

## 5. Right Command Center

Reuse existing `BrainConsoleView` panels/chat.

Restyle:
- glass surface
- compact top tab strip
- current Chat panel stays real
- System/Tools/Agents/Tasks map to existing panels where they exist
- do not mark unavailable panels as live

Keep:
- streaming
- stop generation
- voice/mic
- existing chat persistence
- existing approval boundaries
- existing safety disclosures

The right panel must remain usable even if center visual fails.

## 6. Bottom module dock

New:
`src/components/brain/AyasModuleDock.tsx`

Map to real domains:
- Graphify
- Memory
- Retrieval
- Research
- Evolution
- Security
- Production
- Revenue
- Voice
- Mobile
- Audit

Data sources:
existing Control Center facts first.

For domains not yet implemented:
show `Planned`, `Not connected` or `Unavailable`.
Never show fake `100%`.

Each tile can open the corresponding existing panel / section.

## 7. New CSS layer

Continue in:
`src/components/brain/BrainCore.css`

Add design tokens:

```css
--bc-cyan
--bc-blue
--bc-violet
--bc-emerald
--bc-danger
--bc-glass
--bc-glass-border
--bc-panel-blur
--bc-neon-soft
--bc-neon-strong
```

Main desktop grid:
`300px minmax(460px, 1fr) 420px`

Large desktop:
center visual grows, sidebars stay bounded.

Tablet:
two rows:
- brain hero
- command center
status rail collapses to cards.

Phone:
- topbar
- compact orb
- owner attention
- command center
- horizontal/2-column module dock

No desktop screenshot scaling on mobile.

## 8. Background

Do not use the approved full screenshot as the background.

Recreate with CSS:
- deep navy/black radial gradients
- subtle world-grid/noise
- vignette
- low-opacity cyan/purple ambient glows
- curved top light line via pseudo-elements/SVG

This keeps text sharp and layout responsive.

## 9. Motion

Use current `prefers-reduced-motion` support.

Normal:
- brain breathing 5–7 s
- outer orbit 18–30 s
- counter orbit 24–36 s
- subtle particles
- thinking state increases pulse
- speaking state reacts to current audio/voice state only if data exists

Do not create constant aggressive motion.

## 10. Performance

Target:
- first meaningful UI does not wait for Control Center server facts
- center asset <= ~1 MB WebP preferred
- no full-screen canvas unless measured necessary
- no Three.js dependency in first implementation
- CSS/SVG first
- lazy/non-blocking decorative layers
- no background polling added

Existing streamed facts architecture stays.

## 11. Accessibility

- text labels remain real DOM
- contrast >= AA for functional text
- glow never replaces status text
- keyboard tabs retained
- reduced-motion supported
- command center focus order unchanged
- mobile min touch target 44px
- no information encoded only by color

## 12. Safety / authority

Pure visual redesign must not import or call:
- approval decision service
- execution gate
- production execution
- publication
- mutation registry
- payment/revenue write

Existing action callbacks remain unchanged.

## 13. Implementation commits

### Commit A — visual tokens and shell
- CSS variables
- 3-column shell
- responsive breakpoints
- no behavior change

### Commit B — top nav + left rail
- use existing Control Center view
- real statuses only

### Commit C — BrainCoreOrb v2
- transparent approved brain asset
- orbital labels
- richer rings/particles/pedestal
- state transitions preserved

### Commit D — Command Center skin
- current tabs/chat/voice restyled
- no behavior change

### Commit E — bottom module dock
- real domain mapping
- panel navigation

### Commit F — polish/accessibility/performance/tests
- screenshots
- mobile
- reduced motion
- contrast/focus
- no authority regressions

## 14. Visual regression targets

Capture at:
- 1920x1080
- 1440x900
- 1366x768
- 1024x768
- 390x844

Reference desktop:
approved AYAS visual.

Compare:
- layout geometry
- center focal balance
- glass/neon hierarchy
- panel density
- no clipping
- no horizontal overflow
- readable text
- mobile usable

Pixel-perfect equality is NOT the gate; interaction/data correctness and visual fidelity are.

## 15. Required tests

- existing `smoke-ayas-brain-control-center.ts`
- current chat/stream tests
- voice UI tests
- mobile brain UI tests
- new visual shell static assertions
- no fetch/poll/timer added to presentational layer
- no approval/execution imports
- no `dangerouslySetInnerHTML`
- no fake numeric metric constants in production UI
- TypeScript
- lint
- `git diff --check`
- Graphify current
- screenshot/manual review

## 16. Acceptance

The redesign is accepted when:
- visually recognisable as the approved concept;
- central brain is the dominant focal point;
- left rail shows real current AYAS facts;
- right Command Center is fully functional;
- bottom modules reflect truthful availability;
- mobile remains usable;
- existing safety/authority behavior is unchanged;
- no fabricated metrics;
- Graphify/test/review green.
