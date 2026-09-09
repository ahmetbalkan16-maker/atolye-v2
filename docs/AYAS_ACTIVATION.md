# AYAS Activation

**Status: AYAS ACTIVATION = BLOCKED (operator + device gated). The Execution Gate
stays `CLOSED`.**

Two rounds of work:

- **Sprint 208** — INSPECT + AUDIT; shipped the studio-context wiring + a reply
  safety guard; found the activation blocker (§ Activation blocker).
- **AYAS MASTER FULL ACTIVATION** — built the safety-critical execution control
  plane (gate state machine + policy + authorization + bridge), the AYAS chat
  model profile, and the PWA manifest. Activation still not performed: the
  command carried no `AYAS AKTİVASYON ONAY`, and HTTPS / `AYAS_ACCESS_KEY` /
  real-device tests are operator/hardware gated (§ Control plane, § Remaining).

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
STOP ve aktivasyonu yapma"), Sprint 208 stopped here. The **AYAS MASTER FULL
ACTIVATION** round then built the designed control plane (§ 4) — as a *separate*
plane, so the assertions in the table above are all still intact and the autonomy
loop still can never execute anything.

---

## 4. Execution control plane (AYAS MASTER FULL ACTIVATION)

`src/lib/ayas/execution/` — the safety-critical foundation for a *future*
activation. Every piece is fail-closed; the gate DEFAULTS to `CLOSED`; nothing
built here can open it (an operator activation flow, not built, does that). It is
a **separate control plane** from the Brain autonomy layer — `AyasAutonomousStore`
/ `AyasAutonomousLoop` / `AyasIntentPipeline` / the `ayasExecutionGate = "CLOSED"
as const` constant are untouched.

| Module | What it is |
|---|---|
| `AyasExecutionGate.ts` | Pure state machine: `CLOSED → ARMED → READY → OPEN → EXECUTING → COMPLETED → READY`. `open` requires an operator activation authorization id (an LLM can never supply it); any disallowed `(state,event)` **faults to `CLOSED`**; `fault` / `close` always land `CLOSED`. |
| `AyasExecutionGateStore.ts` | Durable: absent `gate.json` → `CLOSED`; monotonic `sequence`; append-only `gate-log/<seq>.json` written with an exclusive open (replay / concurrent writer → `AYAS_EXECUTION_GATE_LOG_CONFLICT`); CAS on `expectedSequence`; atomic temp→fsync→rename; corrupt → loud on `read()` **and** fail-closed `CLOSED` for a decision, file never overwritten; restart reload. |
| `AyasExecutionPolicy.ts` | Deterministic allowlist — one enabled action, read-only `inspect-project`; `run-pipeline-stage` etc. are *reserved, not enabled*. Rejects unknown/reserved action, malformed plan, unsafe project slug (traversal / absolute / drive / separator), shell-like or injection content anywhere in the request, oversize. The LLM only ever produces a *plan* — this deterministic layer decides. |
| `AyasExecutionAuthorization.ts` | Durable single-use grants bound to the canonical request digest, hard TTL (5 min). Replay / expiry / binding-mismatch / unknown → fail closed. Carries the full audit identity (spec §6): `executionId`, `authorizationId`, `action`, `plan`, `intent`, `state`, timestamps, `resultDigest`. |
| `AyasSafeExecutors.ts` | Read-only executors only. `inspect-project` reads `project.json` via `ProjectReader` (→ runtime authority → `D:\AtolyeRuntime`, never repo-local). No `PipelineRunner`, no shell, no writes. |
| `AyasExecutionBridge.ts` | The one path: policy → gate (`CLOSED` → DENY) → `authorization.consume` → gate `begin-execution` → executor (typed args, timeout budget) → `complete-execution` → `settle` → `READY`. Any failure after `begin-execution` → gate `fault` → `CLOSED` + authorization `failed`. Raw model text never leaves the request object; nothing is shelled out. |

Coverage: `scripts/smoke-ayas-execution-gate.ts` (16 — SM, durability, restart,
replay/CAS, log conflict, fault→CLOSED, corrupt→loud + fail-closed) +
`scripts/smoke-ayas-execution-bridge.ts` (18 — the full §17 negative matrix,
authorization single-use / expiry / binding, DENY while the real gate is CLOSED,
and one real end-to-end `inspect-project` via a *test-scoped* opened gate — the
real gate stays `CLOSED`).

### Security matrix (spec §17) — all PASS

`authenticated / unauthenticated / invalid session / invalid CSRF` — existing
`accessGate` + `middleware` (`smoke-ayas-access-gate`, 14). `malformed execution
request / unknown action / arbitrary shell / path traversal / repo-local storage
bypass / wrong runtime authority / closed gate / expired authorization / replay /
corrupt state fails closed / restart preserves safe state / PipelineRunner
receives typed request only (no write action enabled) / secrets never logged` —
`smoke-ayas-execution-gate` + `smoke-ayas-execution-bridge` (34).

---

## 5. AYAS chat model profile (spec §3)

`src/lib/ayas/AyasModelProfile.ts` — an **optional** `AYAS_OLLAMA_MODEL` env
override that applies to the `askAyas` chat path ONLY. Set it to `qwen2.5:7b`
(already pulled; fits the A2000 12 GB) for cleaner AYAS replies without moving
`OLLAMA_MODEL` and every `AI_PROVIDER=ollama` pipeline stage. Unset → AYAS uses
the pipeline model. Invalid value → ignored (AYAS chat never hard-fails on
config). `askAyas` now calls `createAyasChatProvider()` — the same `OllamaProvider`
class the router uses, still hard-pinned, never resolved from `AI_PROVIDER`.
Coverage: `scripts/smoke-ayas-model-profile.ts` (6).

## 6. PWA manifest (spec §12)

`app/manifest.ts` → `/manifest.webmanifest` (the path `accessGate.ts` already
lists open): name "Atölye AYAS", `start_url: /brain`, `display: standalone`,
colors from `BrainCore.css`, SVG icons. `app/layout.tsx`: `lang` `en`→`tr`, real
Turkish title/description, `viewport` (`device-width`, `viewport-fit: cover`),
apple-web-app meta. A **service worker / offline shell is a scoped follow-up**;
install + offline behaviour still need real-device testing.

---

## 7. Remaining blockers (operator / hardware — not code)

| Blocker | Why it is not doable here | Unblock step |
|---|---|---|
| **Activation authorization** | No `AYAS AKTİVASYON ONAY` was given. The gate stays `CLOSED`. | Operator issues `AYAS AKTİVASYON ONAY` in a sprint command → then the designed operator activation flow drives the gate `CLOSED → ARMED → READY → OPEN`. |
| **HTTPS / remote access** | This environment cannot terminate TLS or expose a LAN origin. Mobile Web Speech + mic require a secure context. | Operator runs the studio behind an HTTPS reverse proxy / local TLS terminator. **No auto-Tailscale.** |
| **`AYAS_ACCESS_KEY`** | It is a secret — setting it is an operator action; it must not be authored here or logged. Until set, `resolveAccessGate` → `disabled-dev` (open). | Operator sets `AYAS_ACCESS_KEY` (≥ 12 chars) in `.env.local`. |
| **Real phone / mic / TTS / install** | No physical device in this environment. | Operator opens `/brain` on the phone over the HTTPS origin, logs in, sends a turn, enables voice + accepts the disclosure, installs the PWA. |
| **Streaming (token-by-token)** | The chat is a Server Action (one blob). A streaming route + a client `fetch` reader is a real UI-architecture change whose incremental rendering can only be verified in a browser. | Its own sprint: an SSE / RSC-stream `askAyas` path + client reader + browser verification. |
| **Real write execution via `PipelineRunner`** | The first real action must be `WRITE=FALSE` (spec §9); `PipelineRunner.run()` creates a project and runs the full generation pipeline. | Its own gated sprint: enable one reserved action (`run-pipeline-stage`) behind the activated gate, `mock`-provider stage first. |
| **`BrainConsoleSnapshot` hardware profile** | `gtx-1650-4gb` default vs the real A2000 12 GB — cosmetic, out of this scope. | A one-line default change + a hardware-profile entry. |

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
