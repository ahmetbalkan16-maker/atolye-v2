# AYAS CONVERSATION SESSION — FINAL REPORT

**Sprint:** AYAS Conversation Session Mode
**Branch:** `wip/ayas-graphify-final-execution` (off `7a158c8`) — NOT pushed, NOT merged, NOT deployed
**Date:** 2026-09-10
**Execution Gate:** CLOSED (unchanged)

Desired behaviour: `BEKLEME MODU → "AYAS" → WAKE → KONUŞMA OTURUMU AÇ → çok komut (wake yok) →
sessizlik zaman aşımı → BEKLEME MODU`. "AYAS" only *starts* the session.

---

## ROOT CAUSE

After every completed turn the pipeline returned to "waiting for the wake word" in **two**
independent places:

| Layer | Code | Effect after a turn |
|---|---|---|
| Engine | `ayasVoiceEngine.ts` `dispatchCommand()` | `this.woke = false` |
| Adapter | `wakeWordVoiceAdapter.ts` `ensureWakeReady()` | `this.phase = "wake"` + `this.detector.rearm()` |
| Engine | `ayasVoiceEngine.ts` `afterOutput()` (post-TTS) | `startRecognition()` → `platform.startListening()` → adapter re-arms to `wake` |

So the next utterance had to contain "AYAS" again — every single turn.

**Where the real state machine lives:** the engine is a *pass-through* on the wake-engine path
(`recognitionMode() === "wake-engine"`, not `single-shot`, so it treats re-arm like `"continuous"`).
The actual turn state machine is the adapter's `phase`
(`idle · starting · wake · capturing · processing · speaking · rearming · recovering · paused · fatal ·
disposed`). Per §2 the fix adds a session layer to *that* machine — **no second state machine, no
parallel voice system**.

There was **no existing session/timeout mechanism** — `AyasVoiceEngine.WAKE_TIMEOUT_MS` (12 s) only
governs how long a *bare* "AYAS" waits for its own follow-up command inside one turn; it does not
survive a completed turn.

---

## IMPLEMENTATION

**Adapter-centric. `ayasVoiceEngine.ts` was NOT modified** (§2 / §12 — smallest possible change).

### Files changed (8)

| File | Change |
|---|---|
| `src/components/brain/voice/wakeWordVoiceAdapter.ts` | the whole session layer (below) |
| `src/components/brain/useAyasVoice.ts` | expose `conversationActive`; call `endConversation()` on explicit stop |
| `src/components/brain/brainCore.ts` | `deriveAyasPresence` → "Konuşma aktif — AYAS dinliyor" voice row |
| `src/components/brain/BrainConsoleView.tsx` | `conversationActive` prop; "Konuşma aktif" pill in `ChatPanel` |
| `src/components/brain/BrainCoreConsole.tsx` | thread `voice.conversationActive` into the view |
| `src/components/brain/BrainCore.css` | `.bc-voice__session` pill style |
| `scripts/smoke-ayas-wake-adapter.ts` | +7 CONVERSATION scenarios; `turn()` helper now lapses the session between independent turns |
| `scripts/smoke-brain-core-ui.ts` | +2 scenarios (presence row + ChatPanel pill) |

### Session state (added to `WakeWordVoiceAdapter`)

```
conversationActive : boolean   // a wake fired; follow-ups skip the wake word
conversationArmed  : boolean   // an in-session capture is waiting for the user (no wake needed)
wokeThisTurn       : boolean   // this capture began from a REAL wake hit (vs. an in-session re-arm)
conversationTimer  : Timeout | null
CONVERSATION_IDLE_MS = 15_000  // + `conversationIdleMs` constructor option (test seam)
```

Core rule (§2): **wake event → `conversationActive = true`**; while `conversationActive === true` a new
capture never runs wake-word detection — the adapter re-arms straight into `phase = "capturing"`.

### Session state machine (adapter `phase` + the two flags)

```
                 "AYAS" (detector.observe → true)
   [wake] ─────────────────────────────────────────►  [capturing]  wokeThisTurn=true
     ▲                                                     │         conversationActive=true
     │ conversationActive=false                            │ command endpointed
     │ (idle timeout / stop / fatal)                       ▼
     │                                              [processing] → finishCommand
     │                                                     │  onFinalTranscript(text)         (real wake)
     │                                                     ▼
   [wake]                                             [idle]  (think + TTS; frames ignored)
     ▲                                                     │
     │  conversationActive == false                        │ afterOutput → startListening
     │                                                     ▼
     └──────────────  ensureWakeReady()  ◄─────────  [rearming]
                            │
              conversationActive == true
                            ▼
                     [capturing] conversationArmed=true      ← follow-up: NO wake word
                            │  user speaks (commandStarted)
                            ▼
                     [processing] → finishCommand
                            │  onFinalTranscript("AYAS " + stripLeadingWakeWord(text))   (synthetic prefix)
                            ▼   → engine's existing !woke path dispatches it, unchanged
                          (loop)
```

**Synthetic wake prefix** (`withSessionWakePrefix`): an in-session command reaches STT without a real
wake hit, so `finishCommand` sends `"AYAS " + stripLeadingWakeWord(text)` instead of `text`. The
engine's existing `handleTranscript` `!woke` branch runs `detectAyasWakeWord`, sets `woke = true`, and
calls `dispatchCommand(command)` — **identical to a spoken "AYAS <command>"**. Zero engine change;
`detectAyasReportIntent` / "AYAS raporlarını aç" still work in-session (§7).

### Timeout (§3)

`CONVERSATION_IDLE_TIMEOUT = 15 seconds` (`CONVERSATION_IDLE_MS`, using the existing option/const
structure). The timer is **re-armed** on:

* the wake hit,
* command onset (`commandStarted` flips — "the user is speaking"),
* command completion (`finishCommand` `finally`),
* the in-session re-arm after TTS (`ensureWakeReady`).

On fire (`onConversationIdle`): `conversationActive = false`; if the adapter is idling in an
in-session capture (`phase === "capturing" && !commandStarted`) it drops back to `phase = "wake"` +
`detector.rearm()` **without an STT call on dead air**. A capture already in progress is left to
finish.

### TTS behaviour (§4 — most critical)

* During think + TTS the adapter phase is `idle` / `speaking` — neither runs wake detection or VAD, so
  AYAS's own TTS is never captured. `echoCancellation: true` and a `rearmCooldownMs` echo-tail guard
  on the in-session re-arm add defence in depth.
* `speak()` now also transitions `capturing → speaking` (previously only `wake`/`rearming → speaking`)
  so a **typed turn while a voice session is open** cannot feed its TTS into the waiting in-session
  capture.
* After TTS ends: `afterOutput → startListening → ensureWakeReady` → `conversationActive ? phase =
  "capturing" (resume listening) : phase = "wake" (WAITING_FOR_WAKE)`.

### Session close (§6)

| Trigger | Path |
|---|---|
| (A) 15 s silence | `onConversationIdle()` |
| (B) explicit stop / disable listening | `useAyasVoice.stopListening()` + `toggleListening` disable branch → `adapter.endConversation()` **before** `engine.disableListening()` |
| (C) fatal voice / mic error | `enterPaused()`, `rebuildAudio()`, first-start permission-fatal, unpause safety-valve → `resetConversation()` |
| (—) normal AYAS reply | **does NOT close** — session survives think + TTS + re-arm |
| unmount | `dispose()` clears the timer + flags |

### UI (§8)

* `AyasPresenceCard` voice row → **"Konuşma aktif — AYAS dinliyor"** while the session is open;
  reverts to **"\"AYAS\" bekleniyor"** on timeout.
* `ChatPanel` shows a small **"Konuşma aktif"** pill (`data-testid="bc-voice-session"`,
  `.bc-voice__session`) next to the `Ses:` line. No large new UI.
* `recovering` / `paused` still take precedence over the session label (honest state first).

### Mobile / PWA (§9)

Not touched: hard/soft threshold, wake model, ONNX model, `AudioWorklet`, `AudioContext`,
`softWindow = 7` + near-hard fast-path, `prime()`, mic-permission flow, wake-adapter retry/fallback.
No new `AudioContext` is created. All timers `unref()`'d and cleared in `dispose()`; the
`visibilitychange` listener is still removed in `dispose()`.

---

## TESTS

| Suite | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** (0 errors) |
| `npm run lint` (full repo) | **0 errors**, 22 warnings — all pre-existing in `src/lib/production/**` + `src/lib/runtime/backup/**` (verified identical on the clean tree; none in touched files) |
| `npm run build` (Turbopack production) | **PASS** — compiled successfully, 27/27 static pages; 7 pre-existing Turbopack warnings (`src/lib/audio/music/MusicLibrary.ts`) |
| `smoke-ayas-wake-adapter` | **PASS 49** (was 42) |
| `smoke-ayas-voice` (engine) | **PASS 54** (engine unchanged) |
| `smoke-brain-core-ui` | **PASS 40** (was 38) |
| `smoke-ayas-wake-runner` | PASS 17 |
| `smoke-brain-lifecycle` | PASS 16 |
| `smoke-brain-report-{center,e2e,security,store,voice-command,approval}` | PASS 14 / 5 / 9 / 7 / 9 / 9 |
| `smoke-brain-selfheal` / `-v2` / `-security` / `-observe-ui` | PASS 40 / 26 / 14 / 13 |
| `smoke-brain-optimization-live` / `-watchdog` / `-voice-latency` | PASS 7 / 7 / 17 |
| `smoke-ayas-chat` / `-chat-stream` / `-studio-context` | PASS 12 / 11 / 16 |
| `graphify update .` | 10901 nodes / 33389 edges (AST-only, gitignored) |

### New regression scenarios (§10) — `smoke-ayas-wake-adapter.ts`

1. **wake→session opens** — `conversationActive` false before "AYAS", true after.
2. **session active → 2nd/3rd command need no wake** — one real "AYAS" in `finals`, three commands
   dispatched, in-session ones carry the `"AYAS "` prefix; mic acquired once.
3. **successful command → timeout resets** — a 2nd command inside the window keeps the session alive
   past the first arm's deadline.
4. **15 s inactivity → session closes** — `conversationActive` false, `phase === "wake"`; a
   wake-less command is then NOT dispatched; **re-wake reopens** the session.
5. **session closed → next command requires wake** — covered by (4) + the `endConversation` scenario.
6. **TTS speaking → user voice not treated as input** — `speak()` during an open in-session capture →
   `phase === "speaking"`, TTS echo frames produce nothing; a real follow-up is captured once TTS ends.
7. **TTS end → active session resumes listening** — covered by (6) + `TEST D` (now asserts the
   in-session follow-up).
8. **fatal voice error → session closes safely** — a mid-session mic interruption → `mic === "paused"`
   **and** `conversationActive === false`.
9. **endConversation() closes immediately** — `conversationActive` false, `phase === "idle"`, the
   re-arm then needs the wake word.
10. **dispose() clears the idle timer** — no status emit after `dispose()`.

Existing multi-turn lifecycle scenarios (`turn()` × 50, the E100 long-run, interruption-every-5th,
`paused`/`retryNow` recovery) were preserved by having `turn()` call `endConversation()` between
*independent* turns — the resource invariants they guard (mic acquired **once**, 0 leak, 0 rebuild in a
healthy session, bounded recovery) are unchanged.

---

## SECURITY

| Invariant | State |
|---|---|
| `ayasExecutionGate` | **CLOSED** — unchanged |
| `writeActionsEnabled` | **false** — unchanged |
| `NEVER_AUTO_APPLY` | unchanged |
| Browser / PWA authority | **none** — the session layer only manages `voice → intent → response`; no git / patch / sandbox / apply / execution authority anywhere in it |
| Report Center | still **read-only**; "AYAS raporlarını aç" works in-session via the same `detectAyasReportIntent` path |
| Wake model / thresholds / ONNX / AudioWorklet / AudioContext | **not touched**; `softWindow = 7` + near-hard fast-path kept |
| `prime()` / mic-permission / retry-fallback | **not touched** |
| Access gate / `D:\AtolyeRuntime` / `D:\AtolyeAuthority` / Caddy / firewall / Cloudflare tunnel | **not touched** |
| No secret in this report | confirmed |

---

## REAL DEVICE

**Physical iPhone access from this environment: NO.**

No device test was run and **nothing is reported as "worked on a real iPhone."** The logic is verified
by deterministic smoke tests driving the adapter's state machine with a synchronous fake audio backend
+ fake runner + fake STT.

### Operator test steps (unchanged from the sprint brief)

Phone URL: `https://<current trycloudflare host>/brain` (or `https://192.168.2.74/brain` on LAN).
`NEXT_PUBLIC_ATOLYE_WAKE_ENGINE=on` must be set and the app rebuilt/restarted.

1. "AYAS"
2. "Atölyede kaç proje var?" → AYAS answers
3. "Peki son değişiklik neydi?" → AYAS answers **(no "AYAS")**
4. a third question **without** "AYAS" → AYAS answers
5. stay silent 15+ seconds
6. ask again → AYAS should **not** answer (needs "AYAS")
7. "AYAS" → conversation restarts

Expected: `FIRST WAKE = 1 kez AYAS` · `SECOND/THIRD COMMAND = wake gerektirmez` · `TTS = çalışır` ·
`SESSION TIMEOUT = çalışır` · `POST-TIMEOUT COMMAND = wake gerektirir` · `RE-WAKE = çalışır`.

The UI should read **"Konuşma aktif"** during steps 2–4 and revert to **"AYAS bekleniyor"** after step 5.

---

## GIT

```
Branch: wip/ayas-graphify-final-execution   (off 7a158c8)
Status: 8 files changed, committed locally
        (6 src + 2 smoke) + ATOLYE_CHECKPOINT.md + this report + memory
git diff --check: clean
Push:   NO
Merge:  NO
Deploy: NO
```

---

## FINAL STATUS

| Item | Result |
|---|---|
| ROOT CAUSE | **FOUND** — engine + adapter both re-armed to "waiting for AYAS" after every turn |
| IMPLEMENTATION | **DONE** — adapter session layer, engine untouched |
| First wake | 1× "AYAS" |
| 2nd / 3rd command | **no wake word** (code + smoke verified) |
| Session timeout | 15 s of silence; reset on every activity |
| Post-timeout command | requires "AYAS" |
| Re-wake | works |
| TTS self-hearing | prevented (phase machine + `speak()` guard + echo cooldown) |
| SECURITY | **PASS** (gate CLOSED, no auto-apply, no browser authority) |
| BUILD | **PASS** |
| GRAPHIFY | updated (AST-only) |
| TESTS | **all green**, +11 new scenarios |
| REAL DEVICE | **OPERATOR_REQUIRED** — no physical iPhone access; no PASS claimed |
| GIT | committed locally; **PUSH / MERGE / DEPLOY = NO** |

**PUSH YAPILMADI · MERGE YAPILMADI · DEPLOY YAPILMADI.**
