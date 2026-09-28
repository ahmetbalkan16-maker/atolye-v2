# Codex / Claude Task — AYAS Brain Control Center Visual V2

Use `ayas_yapay_zekâ_kontrol_merkezi.png` as the approved VISUAL REFERENCE.

Do NOT implement it as one screenshot background.

Rebuild it as real responsive React/CSS components on top of the existing `/brain` architecture.

Existing authoritative code:
- BrainCoreConsole
- BrainConsoleView
- BrainCoreOrb
- AyasControlCenter
- AyasControlCenterModel/Collector
- current chat/voice/approval flows

Implement:
1. 3-column desktop shell
2. top navigation
3. real-data left system rail
4. BrainCoreOrb V2
5. existing Command Center restyle
6. bottom module dock
7. responsive tablet/mobile layouts
8. accessibility/performance polish

Critical:
- visual-only change must not widen authority
- no fake percentages
- no new polling
- no Three.js dependency initially
- no screenshot-as-UI
- central brain image may be a transparent decorative asset; all functional UI is DOM
- existing panel behavior and safety gates stay unchanged
- unavailable modules remain visibly unavailable

Graphify-first.
Implement in small commits.
Run existing brain/control-center/chat/voice/mobile regression suites.
