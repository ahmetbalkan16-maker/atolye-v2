# AYAS Activation — Sprint 208 audit

**Status: AYAS ACTIVATION = BLOCKED. The Execution Gate stays `CLOSED`.**

Sprint 208 is *not* storage migration (that finished in Sprint 207). Its goal was
to make the AYAS / Brain Core PC + mobile experience actually work on the real
backend, real runtime authority, real voice pipeline and real project access —
and then, if every gate passed, activate it.

What shipped: the studio-context wiring + a reply safety guard (below). What is
blocked and why: the activation itself (§ Activation blocker).

---

## 1. Component audit (INSPECT)

| Component | Status | Notes |
|---|---|---|
| Brain Core UI (`/brain`, orb, console, 8 panels) | **WORKING** | `smoke-brain-core-ui` 23 scenarios; renders real `loadBrainConsoleSnapshot()` |
| AYAS chat (UI → Server Action → `AIRouter` → Ollama) | **WORKING** (after Sprint 208 fix) | was mechanically fine but answered from the task queue only — see § 2 |
| Streaming | **MISSING** | `askAyas` is a Server Action returning one blob; no token streaming |
| LLM provider / Ollama | **WORKING** | live at `127.0.0.1:11434`; `qwen2.5:3b` + `qwen2.5:7b` pulled |
| OpenAI | **WORKING** | used for TTS only (`AUDIO_PROVIDER=openai`); AYAS chat never calls it (hard-pinned to `ollama`) |
| STT (speech-to-text) | **WORKING** | browser Web Speech (`webkitSpeechRecognition`), cloud-backed, disclosed + opt-in; denied → clean degrade |
| TTS (text-to-speech) | **WORKING** | browser `speechSynthesis`, local, male/Turkish voice selection, auto-speak + replay-on-block |
| Microphone permission handling | **WORKING** | denied → `"Mikrofon izni reddedildi. Sesli mod kapatıldı; metin sohbeti çalışıyor."` + text chat continues; no app crash |
| Mobile UI | **PARTIAL** | responsive CSS (`@media (max-width: 640px)`) exists; **no PWA** (`manifest.webmanifest` referenced in `accessGate.ts` but the file does not exist), no service worker, not installable |
| Remote access | **PARTIAL / not phone-ready** | access gate + HMAC session + CSRF backstop are solid; but no HTTPS, no `-H` binding, no documented LAN method, and `AYAS_ACCESS_KEY` is **not set** → gate resolves `disabled-dev` (open) |
| Authentication | **WORKING but INACTIVE** | `src/lib/auth/accessGate.ts` + `middleware.ts`; enforced only once `AYAS_ACCESS_KEY` (≥12 chars) is set |
| Project access | **WORKING** | `ProjectReader.listProjects()` → `resolveRuntimeStorageContext` → `D:\AtolyeRuntime\projects` (16 readable `project.json`, 1 folder without one) |
| Runtime authority | **WORKING** | `classification: explicit-external`, `projectsRoot: D:\AtolyeRuntime\projects`, `authorityRoot: D:\AtolyeAuthority` |
| Execution Gate | **CLOSED** | `ayasExecutionGate = "CLOSED" as const` — a compile-time literal asserted at ~8 layers (see § 3) |

### Blocker classification

- **P0** — no activation mechanism for the Execution Gate (§ 3); no wired
  execution path from AYAS to `PipelineRunner` (safe stub only); before Sprint
  208, AYAS gave false answers (wrong project count; a reply that literally said
  *"yürütme kapısını açıyorum"*).
- **P1** — mobile voice needs an HTTPS origin (Web Speech + mic are blocked on a
  plain-HTTP LAN IP); `AYAS_ACCESS_KEY` unset, so remote access would be
  unauthenticated; no PWA/service worker; no token streaming.
- **P2** — `BrainConsoleSnapshot` hardware profile defaults to `gtx-1650-4gb`
  (this machine is an RTX A2000 12 GB); `OLLAMA_MODEL=qwen2.5:3b` +
  `OLLAMA_NUM_CTX=8192` comments still cite the retired GTX 1650.

---

## 2. What Sprint 208 fixed — AYAS studio context + reply guard

**Problem.** `buildAyasChatPrompt` carried only the Brain snapshot (task queue /
worker cycles / safety). So `"Atölye'de kaç proje var?"` → *"hiç proje yok"*
(wrong — it conflated 0 tasks with 0 projects) and `"aktif runtime authority
neresi?"` → the model could not say `D:\AtolyeRuntime`.

**Fix (read-only, additive).**

- `src/lib/ayas/AyasStudioContext.ts` — `loadAyasStudioContext()` resolves the
  active runtime storage context the same way every read path does and lists
  projects through `ProjectReader.listProjects()`. Returns the runtime-authority
  paths + a `total` / `byStatus` / `sample` project projection + non-fatal
  `notes`. Never throws (fail-soft → `available: false`). Writes nothing.
- `brainCore.ts` — `buildAyasChatPrompt` gains an optional `studio` field that
  renders an *"Atölye stüdyo bağlamı (salt-okunur)"* block: the active runtime
  authority path, project count, status breakdown, a short sample, and a
  *"answer these questions only from this block — don't invent"* instruction.
  No `studio` arg → block absent (back-compat; `smoke-ayas-chat` unchanged).
- `brainCore.ts` — `ayasReplyClaimsExecution(text)`: a deterministic,
  Turkish-aware guard that catches a reply *claiming or offering* to open the
  gate / run a pipeline / render / push / apply. `resolveAyasReply` drops such a
  reply to the honest deterministic fallback. Negated / refusing forms
  (`açamam`, `açamazsın`, `açık değil`) are deliberately not matched.
- `app/brain/actions.ts` — `askAyas` loads the studio context (in parallel with
  the snapshot) and passes it through.
- `scripts/smoke-ayas-studio-context.ts` — 12 scenarios (env-scoped temp root,
  count / status / sample / no-`project.json` note / fail-soft; prompt
  injection; the reply guard incl. negation cases).

**Live result (real Ollama, `D:\AtolyeRuntime`):**

| Question | `qwen2.5:3b` (`.env.local` default) | `qwen2.5:7b` (recommended) |
|---|---|---|
| "aktif runtime authority neresi?" | *"…D:\AtolyeRuntimeir yerde olabilir…"* (garbled but names it) | **"Aktif runtime authority D:\AtolyeRuntime'de bulunuyor."** ✓ |
| "kaç proje var?" | **"16 proje var."** ✓ | **"toplam 16 proje var."** ✓ |
| "pipeline'ı çalıştır" | broken grammar; guard catches the worst | **"Yürütme kapısım kapalı olduğundan, pipeline'ı çalıştıramam."** ✓ |

The wiring is correct; `qwen2.5:3b` is simply a weak instruction-follower.
**Recommended (user config decision, not applied):** set `OLLAMA_MODEL=qwen2.5:7b`
in `.env.local` (already pulled; fits the A2000 12 GB). This affects every
`AI_PROVIDER=ollama` pipeline stage too, which is why Sprint 208 left it to the
operator.

---

## 3. Activation blocker — there is no gate to open

`ayasExecutionGate` is `"CLOSED" as const` and `AyasExecutionGate = typeof
ayasExecutionGate` — a type whose only inhabitant is the string `"CLOSED"`. It is
asserted, not merely displayed, at every layer:

| Layer | Assertion |
|---|---|
| `src/lib/ayas/intake/AyasIntentPipeline.ts` | `ayasExecutionGate = "CLOSED" as const`; every `execution`/`forbidden` intent denied at this constant |
| `src/lib/brain/autonomy/AyasAutonomousLoop.ts` | `executionGate: "CLOSED"` in the state type; `ayasLoopRespectsGate` fails if `!== "CLOSED"` |
| `src/lib/brain/autonomy/AyasAutonomousStore.ts` | **refuses to load or persist** any state whose `executionGate !== "CLOSED"` (`AYAS_STORE_INVALID`) |
| `src/lib/brain/ui/BrainConsoleSnapshot.ts` / `AyasAutonomousView.ts` | `executionGate: "CLOSED"` hard-coded in the snapshot |
| `app/api/ayas/intake/route.ts` | responds `executionGate: "CLOSED"` |

There is **no state machine, flag, env var, or CLI** that transitions this to
`OPEN`. Opening it would require one of:

1. hard-coding the constant to `"OPEN"` — **forbidden** by the sprint ("yeni
   bypass / manuel flag / hard-coded `OPEN` oluşturma"); it would also make the
   gate meaningless (always open, no per-action gating);
2. building a new gate state machine — a **new feature**, not a
   missing/broken-piece fix, and it would mean removing the `AyasAutonomousStore`
   fail-closed assertion, which is a STOP condition ("disable-security-control");
3. wiring a real AYAS → `PipelineRunner` execution path — none exists;
   `BrainWorkerCycle` runs a deterministic safe stub only. Even an open gate
   would have nothing to activate.

Per the sprint's own STOP CONDITIONS ("herhangi bir P0 … mimari blocker çıkarsa:
STOP ve aktivasyonu yapma"), Sprint 208 stops here. Activation needs its own
designed sprint — items 4–9 of `docs/brain/ATOLYE_BRAIN_SERVER.md` § 9, in order.

---

## 4. Path forward (each its own approved sprint)

1. **Model + profile** (config only): `OLLAMA_MODEL=qwen2.5:7b`; fix the
   `BrainConsoleSnapshot` hardware profile to the A2000.
2. **Remote access**: set `AYAS_ACCESS_KEY`; run behind an HTTPS reverse proxy
   (or `next start` + a local TLS terminator) so mobile Web Speech + mic work;
   document the LAN/again method. **Do not** auto-install Tailscale.
3. **PWA**: add `app/manifest.webmanifest` + a minimal offline shell + icons so
   AYAS is installable on the phone.
4. **Streaming**: a streaming `askAyas` path (Server-Sent Events / RSC stream)
   for token-by-token replies.
5. **The gate**: a designed, reversible activation state machine that mirrors the
   `RuntimeAuthorityTransition` control-plane discipline (explicit approval,
   durable record, one-step-at-a-time, fail-closed) — replacing the constant
   without weakening any current assertion.
6. **A real processor + `PipelineRunner` wiring** behind that gate — one
   GPU-free `mock`-provider stage first (§ 9 items 4–5 of the server doc).

## Device-side validation

The following need a real phone / browser and cannot be verified from this
environment:

```
PHONE REAL-HARDWARE TEST  = PENDING USER DEVICE TEST
DEVICE-SIDE VOICE (STT/TTS/mic permission) = PENDING
```

User step to unblock the phone test: run the studio on an HTTPS origin reachable
from the phone (reverse proxy or tunnel), set `AYAS_ACCESS_KEY`, open `/brain` on
the phone, log in, send a text turn, then enable voice and accept the disclosure.
