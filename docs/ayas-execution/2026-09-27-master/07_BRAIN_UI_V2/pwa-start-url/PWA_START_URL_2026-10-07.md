# AYAS PWA homepage launch — 2026-10-07

Owner explicitly requested that the installed AYAS icon open Brain UI V2 at https://ayas.atolyeayas.com/. Source candidate is ready; canonical production rollout is pending at this commit.

Both local and public manifests served start_url=/brain?source=pwa from the CLEAN d931a18 production build, origin11472. This is a launch-metadata defect, not an old Brain UI deployment. scope=/ was already correct. Layout links /manifest.webmanifest; no launch redirect replaces the /brain console. The existing worker also cache-first served precached manifest metadata, which could delay discovery of a corrected start_url. Device-side manifest/worker state was not inspected.

Changed start_url to exactly /; preserved explicit id=/brain to retain the installed application identity, scope=/, all icons and install metadata. The worker now fetches manifest from the network first, with its existing cache as fallback only on genuine network failure. Both new / and legacy /brain launch entries retain the cached phone-LLM lab offline fallback. Online 200/307 responses stay untouched; no gated page HTML is cached. Cache name, registration flag, deferred reload, API bypass, voice/chat/routes/access runtime are preserved. No dependency/framework added.

TypeScript PASS, whole lint0 errors/13 inherited warnings, focused lint PASS,145 scenarios in8 relevant suites PASS, git diff --check PASS. Narrow PWA graders are not pinned in frozen EVAL_MANIFEST v57; no frozen grader/fixture/pin/evidence changed. See tests.json for the initial limited-sandbox chat failure and successful unchanged elevated rerun. Graphify base was current at afbac2c with PARTIAL9/semanticPENDING; its review expanded to6 files/8 bridges; direct PWA tests cover its generic test-gap hints. Final refresh/integrity pending.

Canonical rollout will stop only the identity-verified origin and let the already-running unchanged Access daemon build/start. Current .next is backed up in the distinct TEMP directory recorded by before-runtime.json. Tunnel30200, supervisor2496, observer31556 and both Running task definitions must stay unchanged. Foundation remains BLOCKED.

Existing installed PWAs can retain earlier start_url metadata until the browser applies a manifest update. Changing server metadata does not force an immediate OS launcher update. After public verification, close/reopen AYAS; if the installed icon still starts /brain, reinstall its shortcut/app from https://ayas.atolyeayas.com/. Clearing all site data is not the default instruction, because phone-local model caches may be present. Phone install, authenticated UI, microphone/TTS/interrupt/continuity remain owner actions, NOT_RUN by this agent.

References: [Chrome manifest updates](https://web.dev/articles/manifest-updates), [manifest identity](https://www.w3.org/TR/appmanifest/#id-member).
