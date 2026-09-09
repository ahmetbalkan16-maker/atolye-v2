# AYAS Activation

**Status: AYAS ACTIVATION = BLOCKED (operator + device gated). The Execution Gate
stays `CLOSED`.**

Rounds of work:

- **Sprint 208** — INSPECT + AUDIT; shipped the studio-context wiring + a reply
  safety guard; found the activation blocker (§ Activation blocker).
- **AYAS MASTER FULL ACTIVATION** — built the safety-critical execution control
  plane (gate state machine + policy + authorization + bridge), the AYAS chat
  model profile, the PWA manifest.
- **AYAS CONTINUOUS FINALIZATION** — token streaming (SSE route + client + UI
  wiring, §4b), one real read-only `PipelineRunner`-family action
  (`pipeline-recovery-plan`, §12), §16 crash/restart tests, expanded §17 slug
  fuzz, the per-host Brain hardware profile (§19), and a real 3b-vs-7b model
  benchmark.
- **AYAS FINALIZATION CONTINUOUS MASTER v2** — the first WRITE action
  (`resume-stage`) fully designed + tested + kept DISABLED (§4c), and a
  conservative PWA service worker + offline shell, OFF by default (§6b).

Activation still not performed: no command carried `AYAS AKTİVASYON ONAY`, and
HTTPS / `AYAS_ACCESS_KEY` / real-device / browser-render tests are
operator/hardware gated (§ 7).

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
`smoke-ayas-execution-gate` (16) + `smoke-ayas-execution-bridge` (23, incl. §16
crash-mid-execution + concurrent-transition).

### AYAS → PipelineRunner — one real read-only action (spec §12, §13)

`pipeline-recovery-plan` is allowlisted (`write: false`, `destructive: false`):
it routes to `PipelineRecoveryPlanner` (`src/lib/pipeline/`) — `createResumePlan`
+ `getFailedStages` + `getNextIncompleteStage` — which reads the project manifest
and *computes* a resume plan + failed / next-incomplete stages. It runs **no
stage** and writes nothing. Verified end to end against `D:\AtolyeRuntime` through
a test-scoped opened gate; the real gate stays `CLOSED`. Every actual write id
(`run-pipeline-stage`, `resume-stage`, `retry-stage`, `regenerate-stage`,
`publish-youtube`) is on the reserved list → DENY; enabling one is its own gated
sprint. The slug policy also now rejects UNC paths (`\\host\share`), `%`-encoded
traversal, and Windows reserved device names (`CON`, `NUL`, `COM1`…).

---

## 4b. Token streaming (spec §4) — CODE READY, browser render NOT VERIFIED

| Piece | What it is |
|---|---|
| `src/lib/ayas/AyasChatStream.ts` | `streamAyasChat()` — talks to Ollama `/api/chat` `stream: true`, parses the NDJSON line stream, yields `delta` events then one `done`. Reuses the deterministic prompt (`buildAyasChatPrompt` `format: "text"` — a direct answer, no `{ reply }` envelope) and the SAME backstops as `askAyas`: on completion the full text runs `isUsableAyasReply` + `ayasReplyClaimsExecution`; unusable / execution-claim → `corrected: true` + deterministic fallback. Thrown fetch / abort / non-200 / empty → fallback `done`. Hard-pinned to the local Ollama model. |
| `app/api/ayas/chat/stream/route.ts` | `POST` SSE. Auth-gated (same as `/api/ayas/intake`) + same-origin CSRF backstop, bounded body/text/history. `ReadableStream` of `data: {…}` frames. |
| `src/components/brain/ayasChatStreamClient.ts` | `runAyasChatStream()` — client SSE consumer. Never throws for a transport problem → returns `{ ok: false }` so the caller falls back to the `askAyas` Server Action. |
| `BrainCoreConsole` | Tries the stream first (`streaming` prop, default on); renders deltas into a live message; **any** failure falls back to `askAyas`. |

Real Ollama: incremental deltas confirmed (37 deltas, first token 2.3 s, last run;
41–65 ms first token when the model is warm). Browser incremental *rendering*
cannot be verified from this environment. Coverage:
`scripts/smoke-ayas-chat-stream.ts` (10) + `scripts/smoke-ayas-chat-stream-client.ts` (8).

---

## 4c. First WRITE action — `resume-stage` — DESIGNED + TESTED, DISABLED (spec §12–§16, §23)

`AyasExecutionBridge` gains `writeActionsEnabled` (default `false`). Until a
future operator + activation step sets it, every `resume-stage` request is denied
`write-execution-disabled` before the gate is touched. `AYAS = ACTIVE, WRITE
EXECUTION = DISABLED` is a valid final state (§23).

| Piece | What it is |
|---|---|
| `AyasWriteActionPolicy.ts` | `validateAyasResumeStageRequest` — exactly ONE plain project slug (no `*` / `all` / list), exactly ONE known `ProductionStepKey` (no wildcard), the stage must be in the project's resume plan, no unexpected keys, no shell/traversal content, a well-formed `authorizationId`. Pure. |
| `AyasWriteExecutor.ts` | `createAyasResumeStageExecutor` — calls `PipelineRunner.resume(slug, { stopAfterStage: stage })` (the bounded, non-recursive one-stage resume). The `PipelineRunner` is **injected** — tests use a mock, never `D:\AtolyeRuntime`. A run that overshoots its bound → throw (fail closed). Optional execution-time plan re-check. |
| `AyasExecutionAuthorization` | `grant` / `consume` accept a canonical-string descriptor, so the write path binds via `canonicalAyasResumeStageRequest`. Read-only path unchanged. |
| `AyasExecutionBridge` | refactored to a shared `runFromOpenGate` core. Write branch: disabled → DENY; enabled → validate → `resumePlanStages` check → authz (the request's `authorizationId` must match the supplied one) → gate → executor → settle → READY; crash → fault CLOSED + authz `failed`; single-use → no replay. |

Coverage: `scripts/smoke-ayas-write-action.ts` (16) — the validator negative
matrix, the bounded executor, plan re-check, overshoot, `write-disabled` DENY,
end-to-end via a mock runner + a test-scoped gate, authz-id mismatch, crash →
CLOSED + replay denied, `stage-not-in-plan`.

---

## 6b. PWA service worker + offline shell (spec §7) — OFF BY DEFAULT

`public/sw.js` — conservative: **never** intercepts a non-GET request; `/api/**`
is **always** the network (execution / auth / stream / snapshot stay online-only,
never cached); navigations are network-first with an `/offline` fallback; static
assets cache-first; everything else passthrough. No `eval` / `importScripts` /
`WebSocket` / `indexedDB`. `app/offline/page.tsx` is a static shell (no data, no
execution). `src/components/PwaRegister.tsx` registers `/sw.js` **only** when
`NEXT_PUBLIC_ATOLYE_PWA_SW === "on"` — off by default, and it unregisters a stale
worker when the flag is off, so toggling it off is a clean revert. The operator
enables it after verifying offline behaviour in a real browser. Coverage:
`scripts/smoke-ayas-pwa-sw.ts` (7 — the SW is parsed + evaluated in a mock worker
scope; the `/api` bypass precedes any `respondWith`).

---

## 5. AYAS chat model profile (spec §3)

`src/lib/ayas/AyasModelProfile.ts` — an **optional** `AYAS_OLLAMA_MODEL` env
override that applies to the `askAyas` chat path ONLY. Set it to `qwen2.5:7b`
(already pulled; fits the A2000 12 GB) for cleaner AYAS replies without moving
`OLLAMA_MODEL` and every `AI_PROVIDER=ollama` pipeline stage. Unset → AYAS uses
the pipeline model. Invalid value → ignored (AYAS chat never hard-fails on
config). `askAyas` now calls `createAyasChatProvider()` — the same `OllamaProvider`
class the router uses, still hard-pinned, never resolved from `AI_PROVIDER`.
Coverage: `scripts/smoke-ayas-model-profile.ts` (6). **Benchmark (real, live
Ollama, A2000 12 GB):** on factual / count / refusal / plan prompts, `qwen2.5:7b`
is clearly better on Turkish quality + instruction-following + refusal
correctness than `qwen2.5:3b` (which garbles the refusal and, without the JSON
envelope, echoes context); latency 0.5–4 s vs 0.3–1.5 s, streaming first-token
~50 ms for both. **Recommendation: `AYAS_OLLAMA_MODEL=qwen2.5:7b`** — operator
opt-in (it is the operator's local env; the profile mechanism is ready).

## 5b. Brain hardware profile (spec §19)

`loadBrainConsoleSnapshot` resolves the profile from
`ATOLYE_BRAIN_HARDWARE_PROFILE` when set to a known id — `rtx-a2000-12gb` on this
workstation — falling back to the more constrained `gtx-1650-4gb` on an unknown
host (the project runs on two machines). The `rtx-a2000-12gb` profile already
existed in `DEFAULT_BRAIN_HARDWARE_PROFILES`; it just wasn't reachable. Never a
hard-coded single value. Coverage: `smoke-brain-core-ui` (+2 → 25).

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
| **`AYAS_ACCESS_KEY`** | It is a secret — setting it is an operator action; it must not be authored here or logged. Until set, `resolveAccessGate` → `disabled-dev` (open). The `/api/ayas/chat/stream` + `/api/ayas/intake` routes are auth-gated but the gate only *enforces* once the key is set. | Operator sets `AYAS_ACCESS_KEY` (≥ 12 chars) in `.env.local`. |
| **Streaming — browser incremental render** | The SSE route + stream helper + client consumer are CLI-verified against live Ollama; incremental *rendering* in a real browser is not verifiable here. | Operator opens `/brain`, sends a turn, watches tokens append. |
| **Real phone / mic / TTS / install** | No physical device in this environment. | Operator opens `/brain` on the phone over the HTTPS origin, logs in, sends a turn, enables voice + accepts the disclosure, installs the PWA. |
| **PWA service worker + offline** | Built (`public/sw.js`), OFF by default (`NEXT_PUBLIC_ATOLYE_PWA_SW`). Offline behaviour + install can only be verified in a real browser. | Operator sets `NEXT_PUBLIC_ATOLYE_PWA_SW=on`, verifies offline + install on a device. |
| **`resume-stage` write execution** | Designed + tested, DISABLED (`writeActionsEnabled` default `false`). Enabling it means AYAS can trigger a real pipeline stage (generation, writes to `D:\AtolyeRuntime`). | Its own gated sprint, behind the activated gate + an explicit operator write-enable — one project, one stage, one authorization. |

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
