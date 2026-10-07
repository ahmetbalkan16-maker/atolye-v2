# Brain UI V2 — canonical live rollout

Date: 2026-10-07. Deployed source: **d931a189ec6813c86ddbb480ca4075951b1a0dd3**.
Branch: `wip/ayas-graphify-final-execution`. Session started CLEAN, origin0/0, Graphify current/PARTIAL9/semantic PENDING. The following session-save commit changes evidence/documentation only; production remains bound to d931a18 with identical application source.

Status: **DEPLOYED / PUBLIC ARTIFACTS AND MACHINE ACCESS VERIFIED / AUTHENTICATED PHONE OWNER ACTION**. Foundation remains **BLOCKED**.

## Root cause and alternatives

Port3000 had one canonical Next production listener, PID3416, started09:27 local time. Its on-disk `.next/ayas-build-stamp.json` identified CLEAN **34ecb66**, build ID `J9KXmeFgSmXyyFBnusnXZ`. The old root client manifest referenced HomeClient, contained no AyasHomepage, and had no compiled `/studio` route. This explains the old homepage independently of phone caching.

The working directory was the correct checkout. Named cloudflared PID30200 used the existing config for `ayas.atolyeayas.com → http://127.0.0.1:3000`. There was no duplicate target listener or wrong origin mapping. No separate stale-Next-cache failure was demonstrated: the build itself predated the redesign. Phone cache was not inspected and is not claimed as the original cause. Cloudflare responses are DYNAMIC/BYPASS, and the existing service worker never caches homepage HTML.

## Canonical rollout

The existing **AYAS Access Online** scheduled task starts its hidden VBS wrapper and `scripts/ayas-access-daemon.ps1 -Continuous -IntervalSeconds 60`. The unchanged daemon owns `Start-Origin`, which runs `npm run build` followed by `npm run start -- -p 3000` when the origin is down. The canonical identity checks confirmed exactly one expected origin/tunnel before acting.

The old `.next` was copied to `C:/Users/Metod/AppData/Local/Temp/ayas-brain-v2-rollout-20261007/previous-next` for rollback. Only verified origin PID3416 was stopped under the direct owner restart instruction. The same running Access daemon then rebuilt/restarted successfully. No manual second server, new task, config change, dependency install, port/domain change, tunnel restart, credential request or auth bypass was used. A brief origin interruption occurred during the canonical recovery/build; the tunnel remained connected. Rollback was unnecessary.

Production build: standard Turbopack on the existing installed **Next16.2.10**, compilation and TypeScript PASS. Postbuild stamped **d931a18 CLEAN**, same lockfile digest. New build ID: `U2nNI8e-5Yn3t1fi7A5dQ`. There are104 dynamic filesystem-tracing warnings from existing runtime modules, plus middleware deprecation. Existing installed16.2.10 versus lock16.3.8 mismatch remains OPEN; this rollout did not silently migrate it.

## Machine and public verification

| Check | Local | Public |
| --- | --- | --- |
| `/login` | 200 | 200 |
| `/`, `/studio`, `/brain` | expected307 login redirect, gate enforced | same307/gate |
| system/development/autonomous panel links | expected307 with preserved next path | same |
| `/api/runtime/health`, `/api/ayas/chat/stream` | 401 without credentials | same401 |
| `/sw.js` | 200/no-store | 200/no-store/BYPASS |
| homepage client JS and CSS | 200/matching build bytes | 200/matching build bytes |

Twelve local/public artifact responses matched deployed disk SHA-256 hashes. The public JS contains the new homepage, fixed dock and brain-asset markers; the public CSS contains mobile640px and reduced-motion rules. The actual root client manifest points to BrainCoreConsole with the new shell, and the live build includes `/`, `/studio` and `/brain` routes. See [artifact receipt](public-artifacts.json) and [HTTP receipt](after-http.json).

The brain WebP exists at233,150 bytes with the implementation digest unchanged. It is itself auth-gated and returns307 without a cookie. This is **not a404**; its authenticated200/image appearance remains an owner check. No authentication boundary was weakened to obtain a screenshot.

One new canonical origin PID11472 serves3000. Cloudflared30200, Access supervisor2496 and autonomy observer31556 keep their original process-start identities. Both scheduled tasks are Running. Before/after exported task XML digests and tunnel config digest match. Existing cloudflared `/ready` returns200. Restarted origin stderr is empty; observed runtime/tunnel logs contain no fatal error. See [preservation receipt](preservation.json) and before/after process files.

No application source changed. Relevant regression suites were rerun: access-gate19, phone-access-health13, homepage11, chat-stream31, chat-stream-client11 — **85 scenarios, all PASS**. The actual canonical build includes fresh TypeScript. The prior same-source lint0errors/13inherited warnings and309 UI/runtime scenarios remain documented in the implementation report; they are not presented as newly rerun here. `git diff --check` passes. Frozen Stage17 evidence/graders/pins remain untouched and Foundation is not advanced.

## What the public proof does and does not qualify

The deployed build and **new Brain UI V2 public JS/CSS bytes are verified**. Login and protection are verified with no credentials/cookies. The authenticated homepage DOM, live chat response, authenticated asset200 and actual voice UI were not opened by the agent; they remain owner/device qualification. Serving matching public bundles is not described as a completed authenticated visual or real-phone voice test.

## Owner phone validation

Open **https://ayas.atolyeayas.com/** directly. The public manifest still has `/brain?source=pwa` as its start_url: a home-screen PWA shortcut opens the intentionally preserved detail console, which is a different route and is not proof of stale homepage deployment. No manifest change was authorized or made.

1. Homepage: central brain and six-area dock.
2. Menu navigation, including studio, detail console and health/approval/autonomy destinations.
3. Listening state after the normal mic permission/disclosure flow.
4. Thinking state during a real response.
5. Speaking state during actual TTS.
6. Wake, TTS, interrupt/barge-in and foreground/background continuity.
7. Responsive layout and no horizontal overflow on the actual phone.

Reload an already-open root tab first. If the exact `/` still shows the old page after reopening/reloading, use a hard refresh/site-specific cache clear and retest; do not label this a deployment failure while current build/public bytes remain verified. Service-worker/version/config changes were unnecessary. Do not mistake `/brain` or the PWA's start route for `/`.

These seven physical-device checks are **OWNER ACTION / NOT_RUN**. All prior Foundation blockers remain open. No credential, execution-gate, autonomy authority or financial action was changed. Canonical raw build logs and rollback build are retained in the named TEMP directory; portable non-secret receipts are adjacent to this report. Final Git/Graphify observations are recorded after the evidence-save commit in local `.graphify/2026-10-07/BRAIN_UI_V2_ROLLOUT_FINAL_HEAD.json`; resolve the session HEAD from Git.
