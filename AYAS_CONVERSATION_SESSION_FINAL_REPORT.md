# AYAS CONVERSATION SESSION — REAL DEVICE DEBUG

**Branch:** `wip/ayas-graphify-final-execution` — NOT pushed / NOT merged / NOT deployed
**Follows:** the first Conversation Session Mode attempt (`570b8c6`), which passed every smoke
suite but **still required "AYAS" before every command on the real iPhone.**

---

## ROOT CAUSE

### exact cause

`570b8c6` closed the conversation session on **routine iOS AudioContext recovery**. The
`resetConversation()` call it added inside `rebuildAudio()` (and `enterPaused()`) fired on the
**normal post-reply re-arm** on iOS — where `speechSynthesis` leaves the capture `AudioContext`
`suspended` (or ends the mic track), so `MediaStreamWorkletBackend.recover()` returns `false` and
`resumeOrRebuild()` rebuilds the audio graph. That rebuild is **normal churn on iOS, not a fatal mic
error** — but the code treated it as one and cleared `conversationActive`, so the very next re-arm
fell through to `phase = "wake"` and the next utterance needed the wake word again.

The session flag was **coupled to audio-pipeline health**. It must be **orthogonal**: the session is
a logical state ("the user is mid-conversation") and ends only on 15 s of user silence, an explicit
stop, the permanent `fatal` latch, or unmount — never on a resume/rebuild/transient pause.

### exact call chain (per turn, on the real iPhone)

```
finishCommand()  → onFinalTranscript(cmd) → engine dispatch → chat → reply
engine.speak(reply)
  adapter.speak(): phase "idle"  (TTS plays; frames ignored — OK)
speechSynthesis onend
  → engine finish() → afterOutput() → transition("speak-end") → startRecognition()
      → platform.startListening()
          → adapter: audioUp==true → phase="rearming" → ensureWakeReady()
              → await resumeOrRebuild("rearm")
                  → audio.recover()  ── iOS: ctx suspended, off-gesture resume() fails ──►  FALSE
                  → rebuildAudio("rearm")
                      → resetConversation()        ← ✗✗✗  conversationActive = false
                      → ensureAudio() → start()  (succeeds) → audioUp = true
              → back in ensureWakeReady():
                  if (this.conversationActive)  ← now FALSE
                      … skipped …
                  else  → detector.rearm(); phase = "wake"     ← next command needs "AYAS"
```

### why previous smoke tests passed

`scripts/smoke-ayas-wake-adapter.ts` drives a `FakeBackend` whose `recover()` returns
`recoverResult` (**default `true`**). So `resumeOrRebuild("rearm")` always took the cheap
resume-in-place path, `rebuildAudio()` was **never called on the happy path**, and
`resetConversation()` never ran. Even the "iOS suspends the context" scenarios set
`backend.suspended = true` but left `recoverResult = true`, so `recover()` still succeeded. The
tests never exercised the `recover() === false → rebuildAudio` path that iOS takes on **every**
post-TTS re-arm.

### why iPhone still requested "AYAS"

Because on iOS the post-TTS `recover()` genuinely fails (the capture `AudioContext` does not resume
off a user gesture after `speechSynthesis`), so `rebuildAudio()` ran on **every** turn, and its
`resetConversation()` closed the session before `ensureWakeReady()` could re-arm into the in-session
capture. Multi-turn *wake* worked (operator confirmed sprint 7) precisely because `rebuildAudio`
already re-armed to `phase = "wake"` — that path was fine; it was the **session flag** that got
wiped alongside it.

---

## CHANGES

### files

| File | Change |
|---|---|
| `src/components/brain/voice/wakeWordVoiceAdapter.ts` | the fix + `rearmAfterRecovery()` helper + `conversationClosedReason` telemetry |
| `src/components/brain/useAyasVoice.ts` | expose `conversationClosedReason`; fold `conversation*` into `VoiceHealthSnapshot` |
| `src/components/brain/useBrainLifecycle.ts` | `BrainVoiceHealth` += `conversationActive` / `conversationArmed` / `conversationClosedReason` |
| `src/components/brain/BrainCoreConsole.tsx` | pass the new fields into the lifecycle heartbeat + the view |
| `src/components/brain/BrainConsoleView.tsx` | `ChatPanel` shows `son oturum: <reason>` when a session has closed |
| `src/components/brain/brainCore.ts` | (unchanged from `570b8c6` — "Konuşma aktif" presence row) |
| `scripts/smoke-ayas-wake-adapter.ts` | +3 real-device scenarios; the "interruption closes the session" scenario **inverted** to assert survival |

### exact fix

1. **`resetConversation()` removed from `rebuildAudio()` and `enterPaused()`.** A rebuild / a
   recoverable `paused` is pipeline churn, not a session-ender.
2. **New `rearmAfterRecovery()`** — one shared re-arm used by `ensureWakeReady()`, `rebuildAudio()`
   and `attemptUnpause()`: `conversationActive` → straight into an in-session `phase = "capturing"`
   (+ `conversationArmed`, echo cooldown, idle timer); otherwise → `phase = "wake"`. So a rebuild on
   *any* path carries an open session forward.
3. **The 15 s idle timer keeps running while `paused`** (no longer cleared by `enterPaused`), so a
   genuinely long disconnection (> 15 s) still lapses the session on its own — via the timer, the
   legitimate ender, not the pause.
4. **`conversationActive` is now cleared in exactly 5 places**, all legitimate:
   `onConversationIdle` (`idle-timeout`), `endConversation` (`explicit-stop`), the two `fatal`
   latch points (`fatal`), `dispose` (`disposed`). Every one records a
   `conversationClosedReason` — surfaced in `getStatus()`, `VoiceHealthSnapshot`, the lifecycle
   heartbeat and a small `ChatPanel` note, so "why did I have to say AYAS again" is answerable from
   the device.

`ayasVoiceEngine.ts` still **untouched** — the synthetic `"AYAS " + stripLeadingWakeWord(text)`
prefix in `finishCommand` remains the mechanism (the engine's `!woke → detectAyasWakeWord →
dispatchCommand` path runs unchanged). It was re-evaluated (§4): doing it purely in the adapter with
the engine's existing public API is the smallest safe change; making the engine bypass
`detectAyasWakeWord` would mean touching its state machine for no behavioural gain.

---

## LIFECYCLE (verified against the code path, not just the fakes)

| Stage | State |
|---|---|
| **wake** | `onFrame` phase `wake` → `detector.observe` true → `phase = "capturing"`, `conversationActive = true`, `conversationClosedReason = null`, idle timer armed, `wokeThisTurn = true` |
| **conversationActive** | set `true` at the wake hit; **survives** resume / rebuild / transient `paused`; cleared only by idle-timeout / explicit-stop / fatal / dispose |
| **capture** | in-session re-arm → `phase = "capturing"` + `conversationArmed = true` (no wake word); `commandStarted` flips on real speech → `conversationArmed = false`, idle timer reset; a 350 ms echo-tail cooldown gates the first frames |
| **STT** | `finishCommand` → `transcribe()` → `onFinalTranscript(wokeThisTurn ? text : "AYAS " + stripLeadingWakeWord(text))` |
| **TTS** | adapter phase is `idle` / `speaking` during playback — wake detection & VAD are both off; `speak()` also guards `phase === "capturing"` for a typed turn mid-session; `echoCancellation: true` |
| **re-arm** | TTS `onend` → `afterOutput → startRecognition → startListening → ensureWakeReady → resumeOrRebuild("rearm")` → (resume **or rebuild**) → `rearmAfterRecovery()` → `conversationActive ? "capturing" : "wake"` |
| **timeout** | `CONVERSATION_IDLE_MS = 15_000` (production default — `useAyasVoice` passes no override; the `conversationIdleMs` seam is test-only). Re-armed on: wake hit, command onset, command completion, in-session re-arm. Runs even while `paused`. On fire → `conversationActive = false`, `conversationClosedReason = "idle-timeout"`, drop to `phase = "wake"` |

---

## TESTS

| Check | Result |
|---|---|
| unit — `smoke-ayas-wake-adapter` | **PASS 51** (was 49). +3 real-device scenarios: `recover() === false → rebuildAudio → session SURVIVES`; a recoverable `paused` keeps the session & self-heals into the in-session capture; a `paused` that outlasts the idle timeout lapses via the timer (`closedReason: "idle-timeout"`). The old "interruption closes the session" scenario was **inverted** to assert survival. |
| unit — `smoke-ayas-voice` (engine) | PASS 54 — engine untouched |
| unit — `smoke-brain-core-ui` | PASS 40 |
| integration — brain/report/selfheal/optimization/watchdog/latency/chat/studio-context | PASS (`brain-lifecycle` 16, `ayas-wake-runner` 17, `brain-report-*` 14/5/9/7/9/9, `brain-selfheal*` 40/26/14/13, `brain-optimization-live` 7, `brain-watchdog` 7, `brain-voice-latency` 17, `ayas-chat` 12 / `-stream` 11, `ayas-studio-context` 16) |
| tsc (`npx tsc --noEmit`) | **PASS** (0 errors) |
| lint (`npm run lint`, full repo) | **0 errors**, 22 warnings — all pre-existing in `src/lib/production/**` + `src/lib/runtime/backup/**`, verified identical on the clean tree |
| build (`npm run build`, Turbopack prod) | **PASS** — compiled successfully, 27/27 static pages |
| graphify (`graphify update .`) | 10903 nodes / 33406 edges (AST-only, gitignored) |

---

## REAL DEVICE

**Physical iPhone access from this environment: NO.** No device test was run; nothing below is
claimed as "passed on a real iPhone". The three failure modes the previous smoke suite could not
see are now covered by scenarios that model `recover() === false`.

Operator test (§11) and the value to fill in:

| Check | How it should behave | Fill in |
|---|---|---|
| second command without "AYAS" | dispatched; UI shows **"Konuşma aktif"** | `PASS / FAIL` |
| third command without "AYAS" | dispatched | `PASS / FAIL` |
| timeout (15 s silence) | UI reverts to **"AYAS bekleniyor"**; next command ignored | `PASS / FAIL` |
| re-wake ("AYAS" again) | conversation restarts | `PASS / FAIL` |

If it still fails: the `ChatPanel` now prints **`son oturum: <reason>`** after a session closes —
`idle-timeout` / `explicit-stop` / `fatal` / `disposed`. Any *other* value, or the note appearing
right after a normal reply, points at the next cause. The lifecycle heartbeat
(`sessionStorage`, read by `/brain/voice-lab`) also carries `conversationActive` / `conversationArmed`
/ `conversationClosedReason` per beat.

---

## SECURITY

| Item | State |
|---|---|
| gate (`ayasExecutionGate`) | **CLOSED** — unchanged |
| auto apply (`writeActionsEnabled` / `NEVER_AUTO_APPLY`) | **false / unchanged** |
| browser / PWA authority | none — session layer is `voice → intent → response` only; no git / patch / sandbox / apply |
| wake model / thresholds / ONNX / AudioWorklet / AudioContext | **not touched**; `softWindow = 7` + near-hard fast-path kept; `prime()` / mic-permission / retry-fallback untouched |
| access gate / `D:` / Caddy / firewall / Cloudflare tunnel | not touched |

---

## GIT

| | |
|---|---|
| status | working tree clean after commit; `git diff --check` clean |
| commit | `fix(ayas): conversation session survives iOS post-TTS AudioContext rebuild` (local) — on top of `570b8c6` |
| push | **NO** |
| merge | **NO** |
| deploy | **NO** |

---

## FINAL STATUS

`ROOT CAUSE = FOUND` — `resetConversation()` in `rebuildAudio()`/`enterPaused()` coupled the session
to iOS AudioContext churn; the fake backend's `recover()` never fails so smoke never saw it ·
`FIX = session flag decoupled from pipeline health; shared rearmAfterRecovery() carries an open
session through any resume/rebuild; session ends only on idle-timeout / explicit-stop / fatal /
dispose, each recording a reason` · `2nd/3rd COMMAND WITHOUT AYAS = expected PASS (covered by the
recover()===false scenario)` · `SESSION TIMEOUT = 15 s, runs even while paused` · `POST-TIMEOUT =
requires "AYAS"` · `RE-WAKE = works` · `TTS SELF-HEARING = prevented` · `TESTS = all green (+3
real-device scenarios)` · `TSC / LINT / BUILD = PASS` · `GRAPHIFY = updated` · `SECURITY = PASS` ·
`REAL DEVICE = OPERATOR_REQUIRED (no PASS claimed)` · `GIT = local commit; PUSH / MERGE / DEPLOY =
NO`.

**PUSH YAPILMADI · MERGE YAPILMADI · DEPLOY YAPILMADI.**
