# AYAS — FULL MOBILE VOICE DIAGNOSTIC FINAL REPORT

_Branch `wip/ayas-graphify-final-execution` · fix commit `27a530f` (off `dd611b8`) · 2026-09-13_
_NOT merged · NOT pushed · NOT deployed · Execution Gate CLOSED · `writeActionsEnabled = false`_

---

## RESULT

The whole PC → PWA → iPhone → mobile-data → Voice Lab → Wake Engine → STT → chat/voice →
Brain → Report Center → Service Worker chain was inspected file-by-file. Two **code-level
root causes** for "iPhone hears nothing" were found, both proven (not guessed), and both
fixed with minimal, architecture-consistent changes. Desktop behaviour is unchanged.

The wake pipeline had been **UNCHANGED since `12e9126`** (the DİNLİYOR→HAZIR fix) — my
Report Center / Optimization Loop work never touched it. This fix restores the mobile
wake path.

| Chain link | Status |
|---|---|
| **MICROPHONE** | **PASS** (permission + `getUserMedia` reachable in a secure context) |
| **AUDIO_CAPTURE** | **UNKNOWN** — fixed at the code level (AudioContext now primed in-gesture); needs the operator's iPhone check |
| **WAKE_ENGINE** | **UNKNOWN** — assets were auth-gated (fixed, HTTP-verified); AudioContext fix applied; on-device recall still an operator tuning item |
| **STT** | **PASS** (`/api/ayas/stt` reachable, whisper wired, PC-verified in prior sprints) |
| **CHAT** | **PASS** (text + stream work on the phone today) |
| **TTS** | **PASS** (local `speechSynthesis`, unaffected) |
| **PWA** | **PASS** (`/sw.js`, `/manifest.webmanifest` 200; SW is not the cause) |
| **BRAIN_DETECTION** | **FAIL** — the voice-health failure is not observed server-side (see §BRAIN DETECTION) |
| **SECURITY** | **PASS** |
| **BUILD** | **PASS** (tsc 0 / eslint 0 err / next build 0) |
| **GRAPHIFY** | **CONSISTENT** (CONSISTENT-WITH-NOTES, 16 == 16, read-only) |
| **GIT** | **CLEAN** |

```
VOICE_PIPELINE_READY = NOT READY  (READY_WITH_OPERATOR_TEST)
```

The two root causes are fixed and the auth-gate one is fully HTTP-verified; the
AudioContext one is a code-level fix for a code-level cause and needs the operator's real
iPhone to confirm the symptom is gone. **"Fixed in code + tested" is NOT "worked on a real
iPhone" — that check is §REAL DEVICE TEST below.**

---

## ROOT CAUSE

### RC-1 — the wake-engine assets were AUTH-GATED (proven, HTTP-verified, FIXED)

`middleware.ts` → `isProtectedPath` → `OPEN_PREFIXES` in `src/lib/auth/accessGate.ts`.
That list had `/login`, `/api/auth/`, `/_next/`, `/__nextjs`, `/icons/` — **not** `/wake/`,
`/ort/`, `/worklets/`. So every wake-engine asset is a *protected* path:

```
$ curl -s -o /dev/null -w "%{http_code}  %{size_download}b  %{content_type}  %{url}\n" \
       http://127.0.0.1:3000/wake/ayas.onnx  ...
307  31b     /wake/ayas.onnx                       ← redirect to /login
307  41b     /wake/melspectrogram.onnx
307  53b     /ort/ort-wasm-simd-threaded.jsep.wasm
307  50b     /worklets/d2-wake-lab-processor.js
```

The wake engine loads these with `AudioWorklet.addModule("/worklets/…")` and
`WebAssembly.instantiateStreaming(fetch("/ort/….wasm"))` / `fetch("/wake/….onnx")`.
Those APIs **follow the 307 and receive the `/login` HTML page**:

- `addModule` rejects (an HTML body is not a valid module script) →
  `MediaStreamWorkletBackend.start()` throws.
- `instantiateStreaming` rejects (WASM magic-number mismatch) → `runner.init()` throws.
- `fetch("…onnx")` → protobuf parse error → `runner.init()` throws.

→ the wake adapter goes `fatal` → `onUnavailable` → `useAyasVoice` falls back to
`BrowserVoiceAdapter` → on an **iOS installed PWA there is no `SpeechRecognition`** →
`capability.stt = false` → `enableListening()` no-ops → **total silence, no error.**

**When it bites:** the session cookie is 12 h TTL. It self-heals on the next full
navigation + re-login, but an installed PWA that iOS keeps alive for >12 h without a
navigation stays on `/brain` with a dead wake engine and no way back. It *also* bites the
very first cold load if the SW ever pre-cached one of these with a redirect (it does not
in v3 — checked) or on any transient auth hiccup.

**FIX** (`accessGate.ts`): `OPEN_PREFIXES` += `/wake/`, `/ort/`, `/worklets/`. Not
sensitive — the ONNX models only detect the word "AYAS", the WASM is the public
`onnxruntime-web` npm package, the worklet is a ~3 KB frame slicer. **Verified:** all now
`200` with the correct content-type, **no cookie**, on localhost and through the tunnel;
`/brain` still `307 → /login?next=%2Fbrain`; `/api/ayas/stt` still `401`.

### RC-2 — the capture AudioContext is created OFF-GESTURE (proven by code comparison, FIXED)

`WakeWordVoiceAdapter.startListening()` (called synchronously inside the mic-tap /
presence-card user gesture) does `void this.ensureAudio(handlers)` — fire-and-forget.
`ensureAudio` then:

```
await withTimeout(this.runner.init(), 12000, "runner-init");   // 3 ONNX models + WASM — SECONDS on cellular
this.runner.reset();
await withTimeout(this.audio.start(onFrame), 12000, "mic-start");   // ← only NOW: new AudioContext() + resume()
```

By the time `MediaStreamWorkletBackend.start()` runs `new AudioContext()` / `ctx.resume()`,
seconds have passed and the **user activation is gone**. On iOS Safari (and installed-PWA
WebKit) an AudioContext that is not created / resumed inside a user activation stays
`suspended`; `resume()` off-gesture does not move it to `running`. `start()` then hits
`if (this.ctx.state !== "running") throw new Error("audiocontext-not-running")`. After
`MAX_START_ATTEMPTS` (3, all off-gesture, all the same) the adapter went **`fatal`** →
`onUnavailable("start-blocked")` → the same dead fallback as RC-1.

**Proof it's the gesture, not the device:** the **Voice Lab wake page
(`/brain/voice-lab/wake`) works on the operator's iPhone** — and its `arm()` handler
creates + `resume()`s the AudioContext **synchronously as the first lines of the tap
handler, before any `await`**. Same device, same WebKit, same worklet — only the timing of
the AudioContext relative to the gesture differs.

**Why PC works:** desktop Chrome resumes an AudioContext after *any* prior page interaction
(sticky activation + a far more permissive autoplay policy). → exact PC-works /
iPhone-doesn't split.

**FIX** (`wakeWordVoiceAdapter.ts`):

- **`WakeAudioBackend.prime?()`** — a synchronous "create the AudioContext (or reuse a
  non-closed one) and kick off `resume()` **now**, without awaiting" hook.
  `MediaStreamWorkletBackend.prime()` implements it.
- `startListening()`, `retryNow()`, and the `visibilitychange`→visible handler call
  `this.audio.prime?.()` **while the gesture / foreground activation is still hot**, so the
  later off-gesture `start()` reuses a blessed context that iOS *will* resume.
- **A non-permission first-start failure no longer goes `fatal`.** `audiocontext-not-
  running` / a slow-load timeout → `enterPaused` — a visible "AYAS ses bağlantısını
  yeniden kuruyor — dokunarak sürdür" with a working retry (a tap re-runs `start()` in a
  fresh activation; the runner is already `ready`, so `audio.start()` runs synchronously
  in that tap). A genuine `NotAllowedError` still → `fatal` fallback, unchanged.
- **Safety valve:** a never-healthy engine still paused after
  `MAX_UNPAUSE_BEFORE_FALLBACK` (6) recovery attempts → falls back — a device that truly
  can't run the wake engine is not trapped in a pause loop.

---

## VOICE DATA FLOW

```
iPhone Safari / installed PWA
  → HTTPS via Cloudflare Quick Tunnel  (documents-lift-aquarium-unwrap.trycloudflare.com)
  → middleware.ts (access gate)         /brain → 307 → /login  (session cookie 12 h)
  → app/brain/page.tsx → BrainCoreConsole.tsx
  → useAyasVoice.ts
      selectAyasVoicePlatform({ optIn: NEXT_PUBLIC_ATOLYE_WAKE_ENGINE=on,
                                supported: isWakeEngineCapable(window) })  → "wake-engine"
      dynamic import("./voice/wakeWordVoiceAdapter")
  → mic tap  →  engine.enableListening()  →  platform.startListening()   [in the gesture]
      RC-2 FIX: this.audio.prime?.()      ← AudioContext blessed here
      void this.ensureAudio(handlers)     [async, off-gesture from here]
        await runner.init()   → fetch /wake/*.onnx  + /ort/*.wasm|mjs   ← RC-1 FIX: now 200
        await audio.start()   → MediaStreamWorkletBackend
             new AudioContext() | reuse primed ctx ; ctx.resume()
             getUserMedia({ echoCancellation:true, noiseSuppression:false, autoGainControl:false })
             ctx.audioWorklet.addModule("/worklets/d2-wake-lab-processor.js")   ← RC-1 FIX: now 200
             src → worklet(1280-sample 16 kHz frames) → gain(0) → destination
  → onFrame(frame)  →  OpenWakeWordRunner.accept()  (single-flight)
        melspectrogram.onnx → embedding_model.onnx → ayas.onnx → score [0,1]
        WakeScoreDetector (hard 0.70 / soft 0.60, 3-of-5)  → "capturing"
  → VAD: pre-roll (audio only) + postWakeSpeechMs + commandMs + EOS silence  → clip
  → POST /api/ayas/stt  (auth + rate-limit + type/size, whisper large-v3-turbo)  → transcript
  → stripLeadingWakeWord → onCommand(text)  →  runAyas (same path as a typed turn)
  → POST /api/ayas/chat/stream (SSE, qwen2.5:7b, Ollama)  → reply tokens
  → shouldAutoSpeakAyasReply → speechSynthesis (local TTS)  → re-arm (ensureWakeReady)
```

Per-stage INPUT / OUTPUT / ERROR / iOS limitation is in the code comments of each module;
the two failure points fixed here are `middleware` (RC-1) and `MediaStreamWorkletBackend
.start()` timing (RC-2).

---

## MICROPHONE

| | State |
|---|---|
| permission | GRANTED on the device (operator confirmed) |
| secure context | YES — `*.trycloudflare.com` is a real public Cloudflare HTTPS cert (no CA-trust needed, unlike the LAN Caddy path) |
| `navigator.mediaDevices.getUserMedia` | present; called with `echoCancellation:true, noiseSuppression:false, autoGainControl:false` (openWakeWord trained on unprocessed audio; EC on so AYAS's own TTS can't self-trigger) |
| stream / track | reused across turns (`liveTrack()`), re-acquired only when `readyState !== "live"` |
| the bug | **not the mic itself** — `getUserMedia` was almost certainly succeeding; the AudioContext feeding the worklet was `suspended` (RC-2), so the worklet emitted no frames → the wake detector saw silence |

---

## WAKE ENGINE

| Check | Finding |
|---|---|
| assets present | `public/wake/{ayas,melspectrogram,embedding_model}.onnx` (3.3 MB), `public/ort/*` (onnxruntime-web 1.29.0 WASM), `public/worklets/d2-wake-lab-processor.js` — all staged |
| assets served | **was 307→/login without a session (RC-1)** → now **200** with correct content-type |
| `isWakeEngineCapable` | requires `tts` + `AudioWorkletNode` + `getUserMedia` + `isSecureContext` — all true on the iPhone PWA, so `"wake-engine"` is selected (not the browser fallback) |
| initialised | `runner.init()` = `ort.InferenceSession.create` ×3 — depends on the assets loading (RC-1) |
| listening / frames | depended on `AudioContext.state === "running"` — **`suspended` off-gesture (RC-2)** → `start()` threw `audiocontext-not-running` → `fatal` |
| PC vs iPhone | PC: AudioContext resumes off-gesture → works. iPhone: does not → dead. Voice Lab page on the same iPhone: creates the context in-gesture → works. |
| on-device recall | separate known limitation — the model was trained on **one synthetic Piper voice**; a real human "AYAS" can score below 0.70. Operator: `/brain/voice-lab/wake` → say "AYAS" ×10, read the score distribution; if low, retrain with ~30 real clips (`scripts/wake/train_ayas_wake.py`). NOT changed here (threshold 0.70 untouched). |

---

## STT

- `POST /api/ayas/stt` — reachable (`401` without auth, as expected), whisper.cpp
  `large-v3-turbo` via the sidecar, anti-hallucination argv + per-token confidence
  (Sprint forensic). PC-verified end-to-end in prior sprints.
- **Not exercised on this device** because the wake step never handed it a clip (RC-2).
- Once wake fires, STT is a straight authenticated `fetch` — the `/api/` path is never
  cached by the SW and never gated differently.

---

## CHAT

Works on the phone **today** — text in, streamed tokens out (`/api/ayas/chat/stream` SSE,
qwen2.5:7b). This is the control: it proves `/brain`, auth, session, the chat route, the
Brain, and Ollama are all healthy. The failure is **isolated to the voice-input branch**
(`useAyasVoice` → `WakeWordVoiceAdapter`), which is exactly what the two fixes target.

---

## TTS

Local `speechSynthesis` — unaffected, works. Deep "tok" profile (`pitch 0.82`), male /
Turkish voice selection, spoken-Turkish text prep. A blocked autoplay surfaces a manual
"▶ Sesli yanıtı başlat" button (existing).

---

## PWA / SERVICE WORKER

- `NEXT_PUBLIC_ATOLYE_PWA_SW=on`, `NEXT_PUBLIC_ATOLYE_WAKE_ENGINE=on` (both set;
  `NEXT_PUBLIC_*` are public-by-design build vars).
- `public/sw.js` v3: non-GET passthrough; `/api/` passthrough; navigations network-only
  with an `/offline` fallback; `/_next/static/` cache-first; a short PRECACHE list.
  **`/wake/`, `/ort/`, `/worklets/` fall through to the browser's default fetch** — the SW
  does not touch them, cache them, or redirect them. **Not the cause.**
- `/sw.js` → `200`, `Cache-Control: no-cache, no-store, must-revalidate` (from
  `next.config.ts`) — unchanged, not touched.
- `/manifest.webmanifest` → `200`.

---

## CLOUDFLARE

- Quick Tunnel (`cloudflared tunnel --url http://localhost:3000`, PID 26852) — **not
  touched**. Edge `ist05`, `ha_connections 1`, `request_errors 0`.
- URL **unchanged**: `https://documents-lift-aquarium-unwrap.trycloudflare.com`.
- SSE / fetch / streaming through the tunnel: verified — `/api/ayas/chat/stream` streams,
  the wake assets transfer (380–540 ms each from this machine), `application/wasm` and
  `application/javascript` content-types pass through intact.
- **Not the cause.** No Caddy / proxy added for diagnosis.

---

## BRAIN DETECTION

**FAIL — the Brain does not notice "I speak and AYAS doesn't hear."**

- `WakeWordVoiceAdapter.getStatus()` produces the right signal (`phase`,
  `audioContextState`, `frameAgeMs`, `droppedFrames`, `lastError`, latency marks) and
  `useAyasVoice` folds it into `BrainCoreConsole` → `useBrainLifecycle` → a
  **sessionStorage** heartbeat for the Voice Lab.
- It **never reaches the server**. `BrainSelfHealObservability.observeForSelfHeal()` can
  consume a `BrainVoiceHealthLike`, but only when the operator hand-copies a Voice Lab
  report and runs `npm run selfheal -- observe <telemetry.json>`. There is no automatic
  path, so no incident is ever opened for a silent-wake failure.
- With **RC-2's fix**, a failed start now becomes a **visible `paused` state** on the
  presence card ("AYAS ses bağlantısını yeniden kuruyor — dokunarak sürdür" + a working
  "Sesli oturumu sürdür" CTA) instead of silence — so the *user* can at least see and act.
- A **minimum safe server-side telemetry seam** (an auth-gated `POST /api/brain/voice-
  health` beacon → the existing runtime-event buffer → `observeForSelfHeal`, NEVER wired
  to auto-apply) is the right next step and is deliberately **out of scope for this
  diagnostic sprint** — it is a new surface and the immediate goal was to make AYAS hear.
  See §NEXT ACTION.

---

## FIXES

| # | File | Change |
|---|---|---|
| RC-1 | `src/lib/auth/accessGate.ts` | `OPEN_PREFIXES` += `/wake/`, `/ort/`, `/worklets/` (static, non-sensitive ML assets + the audio worklet) |
| RC-2 | `src/components/brain/voice/wakeWordVoiceAdapter.ts` | `WakeAudioBackend.prime?()` + `MediaStreamWorkletBackend.prime()`; `startListening` / `retryNow` / `onVisibility` call it in-gesture; a non-permission first-start failure → `enterPaused` not `fatal`; `MAX_UNPAUSE_BEFORE_FALLBACK` safety valve |
| tests | `scripts/smoke-ayas-wake-adapter.ts` | TEST G rewritten, TEST G2 added, prime-in-`startListening` synchronous check |
| tests | `scripts/smoke-ayas-access-gate.ts` | `/wake/` `/ort/` `/worklets/` OPEN; `/wakeup` + `/api/ayas/stt` stay protected |

`27a530f` — 4 files, +175 / −25. No new dependency. No route added. No `.env` change.

---

## FILES CHANGED

```
src/components/brain/voice/wakeWordVoiceAdapter.ts   | 99 ++++++++++++++++++----
src/lib/auth/accessGate.ts                           | 11 +++
scripts/smoke-ayas-wake-adapter.ts                   | 73 +++++++++++++---
scripts/smoke-ayas-access-gate.ts                    | 17 ++++
```

---

## TEST RESULTS

`npx tsc --noEmit` → **0** · `npm run lint` → **0 errors** (22 pre-existing warnings) ·
`npm run build` → **exit 0**.

| Suite | Scenarios |
|---|---|
| `smoke-ayas-wake-adapter` | 39 → **41** (TEST G rewrite: transient first-start → PAUSED + tap recovers; TEST G2: safety-valve fallback; prime-sync check) |
| `smoke-ayas-access-gate` | 16 → **17** (wake assets OPEN) |
| `smoke-ayas-voice` | 54 |
| `smoke-ayas-wake-runner` | 17 |
| `smoke-ayas-stt` / `-stt-security` | 17 / 7 |
| `smoke-ayas-chat-stream` | 11 |
| `smoke-ayas-pwa-sw` / `-pwa-manifest` | 8 / 8 |
| `smoke-brain-core-ui` / `-lifecycle` / `-conversation` | 38 / 16 / 8 |
| `smoke-brain-selfheal` (+ `-store` / `-e2e` / `-security` / `-observe-ui` / `-v2` / `-e2e-v2`) | 40 / 10 / 3 / 14 / 13 / 26 / 3 |
| `smoke-brain-report-*` (center / e2e / store / voice-command / approval / security) | 14 / 5 / 7 / 9 / 9 / 9 |
| `smoke-brain-watchdog` / `-optimization-live` / `-latency-e2e` | 7 / 7 / 6 |
| `smoke-brain-security` / `-worker-cycle` | 11 / 15 |
| `smoke-ayas-studio-context` / `-execution-gate` / `-execution-bridge` | 16 / 16 / 23 |
| `smoke-graphify-consistency` | 9 |

- **NEW FAILURES:** none.
- **PRE-EXISTING FAILURES:** `smoke-production-snapshot-builder`, `129-25c-2a`,
  `129-25c-2b-4` — fail on `main` too, not run.
- **PASS:** everything above.

### Live HTTP re-verify (after the rebuild + restart)

```
localhost:3000  /wake/ayas.onnx                  200  application/octet-stream       (was 307)
                /wake/melspectrogram.onnx        200  application/octet-stream       (was 307)
                /ort/ort-wasm-simd-threaded.wasm 200  application/wasm               (was 307)
                /worklets/d2-wake-lab-processor  200  application/javascript         (was 307)
                /brain                           307  → /login?next=%2Fbrain         (unchanged)
                /api/ayas/stt                    401                                 (unchanged)
tunnel (no cookie) /wake/ayas.onnx               200 ; /brain 307 ; /login 200 ; /sw.js 200 no-cache
cloudflared PID 26852                            ha_connections 1, request_errors 0, URL unchanged
running BUILD_ID                                 oc6KaPslD2NM1iJTgfP7K
```

---

## SECURITY

- `ayasExecutionGate = "CLOSED" as const`, `writeActionsEnabled = false` — **unchanged,
  re-verified.**
- RC-1 opens **static, non-sensitive** paths only: the wake ONNX models (detect the word
  "AYAS"), the public `onnxruntime-web` WASM, a ~3 KB frame-slicer worklet. The app
  (`/`, `/brain`, all `/api/**`) stays gated — `/brain` still `307 → /login`,
  `/api/ayas/stt` + `/api/ayas/chat/stream` still `401`. `/wakeup` (not `/wake/`) stays
  protected (exact-prefix match — asserted).
- RC-2 is client-only voice-adapter timing / state — no new capability, no `fetch` of
  anything new, no `git` / sandbox / apply, browser never touches the working tree.
- Self-Heal v1/v2 + Report Center + Optimization Loop security model — untouched.
- `D:\AtolyeRuntime` / `D:\AtolyeAuthority` / Caddy / firewall / Tailscale / `.env` /
  the Cloudflare tunnel — **not touched.**
- Prompt-injection / secret-detection suites (`smoke-brain-selfheal-security` 14,
  `smoke-ayas-stt-security` 7) — green.

**SECURITY: PASS.**

---

## GRAPHIFY

READ ONLY. `CONSISTENT-WITH-NOTES` · 17 folders / 16 valid / 16 manifests / 0 unresolvable
/ Brain ↔ Graphify 16 == 16. Identical to the pre-sprint baseline. No writes, authority
model unchanged.

---

## GIT

```
$ git branch --show-current
wip/ayas-graphify-final-execution

$ git log --oneline -4
27a530f fix(ayas): iPhone voice — wake engine dead on mobile (auth-gated assets + AudioContext created off-gesture)
dd611b8 docs(checkpoint): AYAS Optimization Loop — OPTIMIZATION_LOOP_READY (real latency feed + live CLI walkthrough)
331070e feat(brain): optimization loop → Voice Lab latency feed; a confident regression → a Report Center observation
089789b docs(checkpoint): AYAS Report Center — REPORT_CENTER_READY (real-store chain + live CLI walkthrough)

$ git show --stat 27a530f | tail -1
 4 files changed, 175 insertions(+), 25 deletions(-)

$ git status --short   →  (clean)
$ git diff --check      →  (clean)
$ git ls-remote --heads origin wip/ayas-graphify-final-execution   →  (empty — never pushed)
```

No runtime data / secrets / generated artifacts staged. Working tree carries only the doc
updates (this report + the checkpoint entry), committed as a `docs(checkpoint):` follow-up.

**NOT pushed · NOT merged · NOT deployed. Branch preserved.**

---

## REAL DEVICE TEST

**NOT performed.** This environment has no access to a physical iPhone microphone,
AudioContext, or Safari runtime.

- **RC-1 (auth gate)** — *fully verified by HTTP*: the wake assets were `307 → /login`
  without a session and are now `200` with the correct content-type, on localhost and
  through the live tunnel, with no cookie.
- **RC-2 (AudioContext off-gesture)** — a *code-level fix for a code-level cause*: proven
  by comparing the working `/brain/voice-lab/wake` `arm()` handler (creates + resumes the
  AudioContext synchronously in the tap) with the broken `WakeWordVoiceAdapter` path
  (creates it from `ensureAudio`, after `await runner.init()`), plus the exact PC-works /
  iPhone-doesn't split. Whether the `prime()` + `paused`-not-`fatal` changes fully clear
  the device symptom **requires the operator's on-device check.**

### Operator steps (real iPhone, installed PWA, mobile data — Wi-Fi OFF)

The server + tunnel are live now: **`https://documents-lift-aquarium-unwrap.trycloudflare.com/brain`**
(if `cloudflared` PID 26852 restarts the URL changes — `curl -s http://127.0.0.1:20241/quicktunnel`).

1. Delete the old PWA + clear the site's website data (Safari ▸ Advanced ▸ Website Data)
   — the client JS must be the new build (`BUILD_ID oc6KaPslD2NM1iJTgfP7K`).
2. Open the tunnel URL in Safari → log in (`AYAS_ACCESS_KEY`) → `/brain` → Share ▸ Add to
   Home Screen.
3. Open the installed PWA. Confirm a **text** turn still streams.
4. Tap the mic. Expected: within a few seconds the presence card shows
   `"AYAS" bekleniyor (eller serbest)` — **not** "Mikrofon yeniden başlatılamadı" and
   **not** silence.
   - If it shows **"AYAS ses bağlantısını yeniden kuruyor — dokunarak sürdür"**, tap it
     once more (that tap is a fresh activation — the retry now works because the runner is
     already loaded). This is the RC-2 recovery path; report if a 2nd tap still fails.
5. Say **"AYAS"** clearly, then the command in the same breath: *"AYAS Atölye'de kaç proje
   var"*. Expected: state → `Dinliyor` → `Düşünüyor` → AYAS speaks "…16 proje…".
   - If wake never fires even with the AudioContext running: open
     `/brain/voice-lab/wake`, say "AYAS" ×10, copy the report JSON `pipeline.scoreDistribution`
     + `detection` block. A max score < 0.70 = the model-recall limitation (retrain), not
     this bug.
6. `/brain/voice-lab/wake` diagnostics to read after step 5: `audioContextState` should be
   `running` (was the tell — `suspended` before), `phase` should reach `wake` /
   `capturing`, `frameAgeMs` should be small (frames flowing), `lastError` should be null.

---

## KNOWN LIMITATIONS

1. **RC-2 not device-confirmed** — the AudioContext fix is code-level; the operator's
   iPhone check (above) is the proof.
2. **Wake recall** — the "AYAS" model was trained on one synthetic Piper voice; a real
   human may need to repeat "AYAS" or the model needs a ~30-clip retrain. Threshold 0.70
   is untouched. Operator-gated.
3. **Brain does not observe voice-health server-side** — a silent-wake failure opens no
   incident today. RC-2 at least makes it *visible* to the user (`paused` card). A safe
   `POST /api/brain/voice-health` beacon → `observeForSelfHeal` is the next increment.
4. **Quick-tunnel URL is ephemeral** — lives only while `cloudflared` PID 26852 runs; a
   restart rotates it.
5. **The running server is a session-bound background task** — for durable use the
   operator should run `npm start` in their own terminal (the tunnel URL stays the same).

---

## NEXT ACTION

1. **Operator: run the §REAL DEVICE TEST** on the physical iPhone over mobile data. That
   is the only thing between this and `VOICE_PIPELINE_READY`.
2. If wake still doesn't fire with `audioContextState: running` → the model-recall retrain
   (`scripts/wake/train_ayas_wake.py` with ~30 real "AYAS" clips) — a separate operator task.
3. **Small follow-up sprint:** the `POST /api/brain/voice-health` telemetry seam
   (auth-gated, redacted, numeric-only) → the runtime-event buffer → `observeForSelfHeal`
   opens a `voice` incident when the wake pipeline is unhealthy — so the Brain *notices*
   next time. NEVER wired to auto-apply.

---

## FINAL STATUS

```
MICROPHONE       = PASS
AUDIO_CAPTURE    = UNKNOWN   (code fix applied — AudioContext primed in-gesture; needs iPhone check)
WAKE_ENGINE      = UNKNOWN   (assets un-gated + verified; AudioContext fix applied; recall = operator tuning)
STT              = PASS      (route + whisper healthy; not exercised on-device — wake never handed it a clip)
CHAT             = PASS
TTS              = PASS
PWA              = PASS
BRAIN_DETECTION  = FAIL      (voice-health not observed server-side; now at least visible to the user)
SECURITY         = PASS
BUILD            = PASS
GRAPHIFY         = CONSISTENT
GIT              = CLEAN

VOICE_PIPELINE_READY = NOT READY   (READY_WITH_OPERATOR_TEST)
```

Two real, code-level root causes found with evidence and fixed. RC-1 (auth-gated wake
assets) is fully HTTP-verified. RC-2 (AudioContext off-gesture) is fixed the way the
working Voice Lab path already does it, with a visible "tap to resume" instead of a silent
dead fallback — the operator's iPhone test is the last step. Nothing was guessed; nothing
was reported as "worked on a real iPhone" that wasn't.
