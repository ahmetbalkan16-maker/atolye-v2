# AUTONOMOUS BRAIN v2 — FINAL REPORT

_Branch `wip/ayas-graphify-final-execution` · commit `23ba767` (off `3da4096`) · 2026-09-11_
_NOT merged · NOT pushed · NOT deployed · Execution Gate CLOSED_

---

## Result

Self-Healing Brain **v1** stopped at `AWAITING_APPROVAL` for every fix. **v2** takes the same
detect → diagnose → sandbox-fix → test chain and, for a **narrowly defined SAFE class of change**,
carries it all the way through on its own:

```
DETECT → DIAGNOSE → PATCH → TEST → REGRESSION → VERIFY
       → AUTO-APPLY  (working tree, STAGED — never commit / push / merge / deploy)
       → WATCHDOG    (30 s / 2 min / 10 min observation)
       → HEALED  ─ or ─ HEAL_FAILED → AUTO-ROLLBACK → learn-as-failed
       → LEARN
```

Everything that is not in that SAFE class still stops at `AWAITING_APPROVAL`; anything touching a
FORBIDDEN area produces `REPORT + HALT`. Auto-apply is **OFF by default** and only turns on with an
explicit operator opt-in (`SELFHEAL_AUTO_APPLY=on`).

The full autonomous chain — including the failure path — is proven by a real git-worktree end-to-end
test, not asserted. See **Real Controlled Fault** below.

| Capability | Status |
|---|---|
| **AUTO-HEALING** | **READY** |
| **AUTO-OPTIMIZATION** | **READY** _(engine + loop pure & tested; live metric feed is an operator wire-up)_ |
| **SELF-LEARNING** | **READY** |
| **AUTONOMOUS_SAFE_APPLY** | **READY** _(opt-in `SELFHEAL_AUTO_APPLY=on`; default OFF)_ |
| **POST-APPLY_ROLLBACK** | **READY** |
| **SECURITY** | **PASS** |

---

## Architecture

Unchanged from v1 in shape — **pure decision kernel → durable stores → Node-only operator
adapters** — with v2 modules added at each layer. No second orchestrator, no new runtime authority,
no import into `src/lib/pipeline` / `src/lib/production` / `app/`.

```
src/lib/brain/selfheal/
  ── pure decision kernel (no I/O, deterministic) ──
  BrainIncident.ts            state machine  (+ MONITORING, + HEALED in v2)
  BrainAnomalyClassifier.ts   EXPECTED / TRANSIENT / USER_ACTION / KNOWN_BASELINE /
                              REAL_INCIDENT / UNKNOWN  — no proof ⇒ UNKNOWN, never a fabricated CRASH
  BrainRootCauseEngine.ts     timeline + commit + learned-pattern correlation
  BrainPatchSafety.ts         SAFE / REVIEW_REQUIRED / FORBIDDEN_AUTONOMOUS  (unknown path ⇒ REVIEW)
  BrainSelfHealLimits.ts      attempt / diff / file / runtime / signature-mute  + v2 rate caps
  BrainUntrustedInput.ts      runtime logs are DATA — instruction-quarantine + redaction
  BrainOptimizationBenchmark  measured before/after, guarded regression ⇒ REJECT
  BrainLearnedPattern.ts      learn only from VERIFIED; a failed fix is never a "win"
  SelfHealingBrain.ts         orchestrator — emits INTENTs, never executes

  ── v2 pure modules ──
  BrainRuntimeEvent.ts        BrainRuntimeEvent + BrainRuntimeEventBuffer (redacted, bounded ring),
                              eventsToTimeline(), runtimeIsBusy()
  BrainAutoApplyPolicy.ts     decideAutoApply() → AUTO_APPLY / AWAIT_APPROVAL / HALT  (+ checklist)
  BrainHealWatchdog.ts        runHealWatchdog() → HEALED / HEAL_FAILED / OBSERVING
  BrainSelfHealQueue.ts       decideQueueAdmission() (enqueue / dedupe / defer), P0→P3 ordering
  BrainConfidenceEvolution.ts evolvePatternConfidence() (low→moderate→high→trusted),
                              rankCandidateFixes() (negative learning)
  BrainPatchGeneration.ts     assemblePatchRequest() (redacted, no instructions),
                              validateGeneratedPatch() (stray file / FORBIDDEN / secret / injection)
  BrainOptimizationLoop.ts    OBSERVE→BASELINE→HYPOTHESIS→SANDBOX→BENCHMARK→REGRESSION→COMPARE→ACCEPT/REJECT
  BrainSelfHealScheduler.ts   decideHealthCheck() — never during a live voice turn / user interaction /
                              critical op / an in-flight self-heal

  ── durable stores (Node) ──
  BrainSelfHealStore.ts       data/brain/selfheal/  (gitignored) — atomic write, secret-leak REJECT
                              (never mask), corrupt / wrong-schema ⇒ loud throw.
                              v2: + optimizations/ + events.json + auto-applies.json

  ── operator adapters (Node only — never reached from a browser or the autonomous loop) ──
  BrainSelfHealSandbox.ts     git worktree lifecycle, fixed argv, execFile (no shell)
  BrainSelfHealRunner.ts      the loop + the 🧠 operator report; v2 step handlers
  BrainSelfHealGuards.ts      fail-closed kernel — push / remote / config / egress / secret-read /
                              FORBIDDEN-apply / self-modify are all refused
  BrainSelfHealObservability  BrainLifecycleTelemetry / BrainVoiceHealth → an incident draft

src/lib/brain/ui/BrainSelfHealConsoleSnapshot.ts   read-only view-model loader (fail-soft)
src/components/brain/BrainSelfHealingPanel.tsx     read-only "Self-Healing" Brain panel
scripts/selfheal.ts                                operator CLI
```

---

## Continuous Observability

`BrainRuntimeEvent` is the single event shape the Brain reasons over:

- `buildRuntimeEvent({ at, component, event, severity?, metadata? })` — **`sanitizeMeta` redacts every
  string value** in `metadata`; a value that still matches a secret pattern becomes `"[redacted]"`.
- `BrainRuntimeEventBuffer` — a bounded ring (`Math.max(2, Math.min(5000, capacity))`); oldest events
  drop off. This is a rolling window, not a log file.
- `eventsToTimeline()` folds the buffer into the `BrainTimelineEvent[]` the root-cause engine and the
  classifier already consume — so continuous observation feeds the exact same diagnosis path as a
  manual `selfheal run`.
- `runtimeIsBusy(events)` — true while a voice turn / STT / critical op is in flight; the scheduler
  and the watchdog both consult it.

Flow: **event buffer → `observeForSelfHeal()` → anomaly classifier → (REAL_INCIDENT | UNKNOWN) →
incident draft**, automatic. `scripts/selfheal.ts observe <telemetry.json>` runs that path from a
captured telemetry snapshot; a live deployment feeds the buffer directly.

The durable side (`store.appendRuntimeEvents` / `loadRuntimeEvents`) goes through the same
secret-leak REJECT as every other store write — a hand-crafted event carrying a token is refused,
not stored masked (`smoke-brain-selfheal-store` scenario "a secret in a runtime event is REJECTED").

---

## Incident Detection

`classifyBrainAnomaly()` runs **voice-fault checks first** (fatal / paused-after-3 / stall /
early-endpoint / dropped-frames / paused / recovering), then user-action, then lifecycle. Outcomes:

| Classification | Opens an incident? |
|---|---|
| `EXPECTED`, `TRANSIENT`, `USER_ACTION`, `KNOWN_BASELINE` | no |
| `REAL_INCIDENT` | yes |
| `UNKNOWN` | **yes** — an unexplained anomaly is still tracked, just not mislabelled |

Reload reasons: `USER_INITIATED_RELOAD` / `USER_NAVIGATION` / `BROWSER_RELOAD` /
`PWA_LIFECYCLE_RESET` / `CRASH` / `UNEXPECTED_UNLOAD` / `UNKNOWN`.

**Hard rule (§8): no proof ⇒ `UNKNOWN`.** `CRASH` is only ever claimed when an actual error/crash/
rejection/fatal event was recorded immediately prior. A foreground voice-session death with no error
is `UNEXPECTED_UNLOAD`, and `UNEXPECTED_UNLOAD` + `evictionKind: "unknown"` resolves to `UNKNOWN` —
it opens an incident but never fabricates a crash story. The iPhone ~3-min reload, which the page
cannot instrument on iOS, lands here: tracked as a real recurring pattern, cause `UNKNOWN`, not
`CRASH`.

Incident state machine (v2 additions in **bold**):

```
OBSERVED → DIAGNOSED → PATCHING_SANDBOX → TESTING → VERIFIED
         → AWAITING_APPROVAL → APPLIED → **MONITORING → HEALED**
         ↘ ROLLED_BACK / FAILED
VERIFIED  ── auto-apply ──▶ APPLIED            (v2, when policy says AUTO_APPLY)
APPLIED   ── monitor    ──▶ MONITORING
MONITORING── healed     ──▶ HEALED
MONITORING── heal-failed──▶ ROLLED_BACK
```

`BRAIN_INCIDENT_TERMINAL = ["HEALED", "FAILED"]` · autonomous ceiling `HEALED` ·
review ceiling `AWAITING_APPROVAL`.

---

## Root Cause

`diagnoseRootCause()` correlates the incident timeline, recent commits, and matched learned patterns
into ranked `hypotheses[]` each with `confidence`, `evidence[]`, `counterEvidence[]`, and a
`suspectAreas[]`. The orchestrator's `DIAGNOSED` step **prefers `incident.hypotheses` when they were
already recorded** (so a security-sensitive suspect area is not silently re-derived away) and only
falls back to a fresh `diagnoseRootCause` when none exist.

Autonomy is bounded by the suspect area: if a hypothesis points at a FORBIDDEN or REVIEW area the
patch path is `draft-but-await` / `HALT`, never `auto-apply`, regardless of confidence.

---

## Autonomous Patch Generation

v2 defines the **generator seam** — it does not ship an LLM call.

- `assemblePatchRequest(incident, opts)` builds a `BrainPatchRequest` that is **fully redacted**
  (`redactBrainText` over every field), carries a fixed `RULES` array, the `avoidFixes` list (from
  negative learning), a static `testPlan`, and a **static `expectedBehaviour` template** — never the
  raw `incident.symptom`, so an attacker-influenced log line cannot become a generator instruction.
- A `BrainPatchGenerator` implementation (operator-provided, or an LLM in a future sprint) returns a
  `BrainGeneratedPatch`.
- `validateGeneratedPatch()` rejects the result if it: touches a file outside the request scope,
  hits a FORBIDDEN target, contains a secret, or its "reasoning" is instruction-shaped.
- In tests and the CLI the patch is supplied by a fixture or `heal <id> --patch` — the seam is
  exercised, the model is not.

Runtime logs remain **DATA** throughout (`BrainUntrustedInput`): instruction-shaped content is
quarantined with `[quarantined-instruction]`, control/invisible characters are stripped, and
redaction runs first.

---

## Sandbox

Unchanged from v1 and still the only place a patch is ever materialised:

- `createBrainSelfHealSandbox()` → a **git worktree** off the current HEAD, in a temp dir.
- All git invoked via `execFile` with **fixed argv, no shell**; every call passes through
  `BrainSelfHealGuards.assertSelfHealActionAllowed()`.
- `pruneBrainSelfHealSandboxes()` removes stale worktrees.
- The browser path and the autonomous loop **never** run the sandbox — only the Node operator
  adapter does.

v2 guard hardening: `FORBIDDEN_ARGV_TOKENS` (`push`, `--force`, `-f`, `--force-with-lease`, `clean`)
is now an **exact-token match**, not a substring — a file called `smoke-selfheal-fixture-lib.js` no
longer trips the `-f` rule — while `git -C <dir> <sub>` is still fully parsed and
`FORBIDDEN_ARGV_SUBSTRINGS` (`reset --hard`, `rm -rf`, `> /dev`, `git push`, `--no-verify`) still
matches anywhere. `npm run deploy` / publish / release and any network-egress command are refused.

---

## Auto-Apply Policy

`decideAutoApply()` — pure, deterministic, returns `AUTO_APPLY` / `AWAIT_APPROVAL` / `HALT` plus a
full checklist. **Every one of these must hold for `AUTO_APPLY`:**

1. `config.enabled` — operator opt-in (`DEFAULT_AUTO_APPLY_CONFIG.enabled = false`).
2. Every changed file is `SAFE` (`classifyPatchSet`). One `REVIEW_REQUIRED` ⇒ `AWAIT_APPROVAL`; one
   `FORBIDDEN` ⇒ `HALT`.
3. **`NEVER_AUTO_APPLY` second denylist** — even a SAFE-classified change is held for a human if its
   path matches voice / `wakeWordVoiceAdapter` / `useAyasVoice` / `openWakeWordRunner` /
   `AyasSttService` / `app/api/` / `public/sw.js` / `PwaRegister` / `app/manifest` / `accessGate` /
   `Csrf` / `session` / `auth/` / `GraphifyConsistency` / `AyasStudioContext` / `ProjectWriter` /
   `src/lib/(production|pipeline|runtime|storage)/` / `src/lib/ayas/execution/` /
   `BrainAutonomyPolicy` / `BrainSafetyGovernor` / `BrainRedaction` / `BrainSecurityPolicy` / the
   self-heal security kernel files.
4. Root-cause confidence ≥ `confidenceThreshold` (default `0.8`).
5. All required checks (`typecheck`, `lint`, `build`, `smoke`) ran, no real (`!baseline`) failures,
   `regression` PASS, `security` PASS.
6. `diffLines ≤ min(config.maxDiffLines=120, LIMITS.maxDiffLines)` and
   `files ≤ min(config.maxFilesChanged=4, LIMITS.maxFilesChanged)`.
7. `incidentSignature` is not in `recentlyFailedSignatures` (no auto-retry of a fix that just
   failed).
8. `checkAutonomousApplyRate()` — ≤ `maxAutonomousAppliesPerHour` (4).
9. Not in a self-heal loop (`incident.causedIncidentIds` empty).

`SelfHealingBrain`'s `VERIFIED` case runs `checkAutonomousApplyRate` then `decideAutoApply`; on
`AUTO_APPLY` it emits the `auto-apply-to-working-tree` step, otherwise `await-approval`. The apply
itself is `git apply --index` in the operator adapter — **STAGED in the working tree, never
committed, never pushed** — guarded with an `autonomous-safe:${incident.id}` action id.

Default areas that are always `REVIEW_REQUIRED`: voice / STT / TTS / PWA / SW / storage /
Graphify-write / auth / security / execution.

---

## Watchdog

`runHealWatchdog()` — `"build PASS" ≠ healed`. After an apply the Brain observes the live runtime
over `checkpointsMs = [30 s, 2 min, 10 min]` and only then decides:

| Verdict | Trigger |
|---|---|
| `HEAL_FAILED` → **rollback** | signature recurred (> `maxSignatureRecurrences` = 0), OR a post-apply regression/smoke check FAILs on the live tree, OR `> maxNewErrors` (3) error/fatal events in the window, OR a guarded perf metric `REJECT` |
| `OBSERVING` | window not yet complete, clean so far |
| `HEALED` | window complete AND signature did not recur AND no error spike AND post-apply checks green AND performance not worse |

Failure signals are **immediate** — the watchdog does not wait out the full 10 min to roll back a
recurrence. Evidence is accumulated on the incident (`healEvidence`) either way.

---

## Rollback

`MONITORING` + `heal-failed` → `ROLLED_BACK`. The operator adapter's `rollbackWorkingTree` reverts
the staged patch (`git apply --index --reverse` / `git checkout` of the touched paths) so the
working tree returns to exactly its pre-apply state. Then one **learn-as-failed** pass records the
signature so `recentlyFailedSignatures` blocks an automatic retry of the same fix.

`checkRollbackAttempts()` caps rollback retries at `maxRollbackAttempts` (2); beyond that the
incident goes `FAILED` / `NEEDS_HUMAN`.

Proven end-to-end: **Real Controlled Fault scenario 2** applies a bad SAFE patch, the watchdog sees
the incident signature recur, auto-rollback fires, the worktree is asserted byte-identical to
pre-apply, and the pattern is stored as failed — **no false "healed"**.

---

## Self-Optimization

`BrainOptimizationLoop` — `buildOptimizationRun()` / `advanceOptimizationRun()` / `decideOptimization()`:

```
OBSERVE → BASELINE → HYPOTHESIS → SANDBOX → BENCHMARK → REGRESSION → COMPARE → ACCEPT | REJECT
```

Safety (§17): an improvement below **5 %** is `NEUTRAL` and lands in the **`rejected`** stage (not
accepted — an unmeasurable change is not applied); any guarded regression ⇒ `REJECT`; no unmeasured
change is ever accepted. `compareBenchmark()` supplies the measured before/after with explicit
`regressions[]`.

The loop and the benchmark comparator are pure and covered by `smoke-brain-selfheal-v2`. They are
**not yet wired to a live wake/STT/TTS latency feed** — that hook-up is the one operator step for
AUTO-OPTIMIZATION to run unattended.

---

## Self-Learning

- `buildLearnedPattern()` learns **only from a `VERIFIED` (v2: `HEALED`) incident**; a failed fix is
  recorded as `avoidFixes` data, never as a successful pattern.
- `evolvePatternConfidence()` — a pattern moves `low → moderate → high → trusted` on clean
  verifications and **drops** on a later failure, a contradiction, or staleness. `reuseDirectly` is
  only true in the `trusted` band.
- `rankCandidateFixes()` — **negative learning**: a candidate fix that resembles a previously failed
  fix is pushed to priority 5 (last).
- `matchLearnedPattern()` short-circuits diagnosis when a known signature recurs.

Proven: **Real Controlled Fault scenario 3** — after the first incident is healed and learned, a
second occurrence of the same signature arrives with the fix already attached to its diagnosis.

Memory lives in `data/brain/selfheal/` (gitignored, atomic, secret-leak REJECT, corrupt ⇒ fail
closed).

---

## iPhone Lifecycle

The reload problem is modelled as a **real, trackable pattern**, not guessed:

- `classifyReloadReason()` distinguishes `USER_INITIATED_RELOAD` / `USER_NAVIGATION` /
  `BROWSER_RELOAD` / `PWA_LIFECYCLE_RESET` / `CRASH` / `UNEXPECTED_UNLOAD` / `UNKNOWN`.
- With no error recorded and no `pagehide`, an iOS foreground eviction is `UNEXPECTED_UNLOAD` →
  `UNKNOWN`. It **opens an incident** (so the frequency is tracked) but is **never reported as
  `CRASH`**.
- `BrainSelfHealObservability` folds `BrainLifecycleTelemetry` (boot record, heartbeat,
  `evictionKind`) and `BrainVoiceHealth` into that draft.
- The Brain does not attempt an autonomous "fix" for an `UNKNOWN` iOS-platform reload — voice / PWA /
  SW are all in `NEVER_AUTO_APPLY`, so any candidate patch there is `AWAIT_APPROVAL` at most.

---

## Graphify

**READ ONLY.** No self-heal path writes to `graphify-out/`, a manifest, or `project.json`.
`GraphifyConsistency` / `AyasStudioContext` / `ProjectWriter` / `ProjectManager` are all in
`NEVER_AUTO_APPLY`.

Read-only health check against the active production authority (`D:\AtolyeRuntime`):

```
verdict          CONSISTENT-WITH-NOTES
folders          17    with project.json 16    with manifest 16
UNRESOLVABLE     0     missingManifests 0
Brain ↔ Graphify 16 == 16   (studio total === folders w/ project.json)
notes            1 orphan folder (ai-usage only) + 2 id≠folder-name (post-cutover, read resolves both)
```

Identical to the pre-sprint baseline. (Running the same script through a bare `tsx` process without
`.env.local` resolves the legacy in-repo `data/projects` and reports its 14 known id-mismatches —
that is the environment, not a regression; `brainGraphifyConsistent` is `true` and
`unresolvableProjects` is `0` in both roots.)

---

## Security

`ayasExecutionGate = "CLOSED" as const` and `writeActionsEnabled = false` — **unchanged, re-verified.**

The self-heal subsystem **cannot**: open the Execution Gate · use `ExecutionBridge` / `ProjectWriter`
/ `PipelineRunner` · change production authority · change `D:\AtolyeRuntime` / `D:\AtolyeAuthority` ·
move storage authority · read `.env.local` · expose a secret · change firewall / network security ·
deploy · `git push` / merge / release · modify its own security kernel.

Enforcement:

- `BrainSelfHealGuards` — fail-closed: `push`, remote ops, config edits, network egress,
  secret-path reads, FORBIDDEN-target applies, and kernel self-modification are all refused before
  any process spawns.
- `BrainPatchSafety` — Execution Gate, `.env*`, deploy config, authority config, CI security
  controls, and the security-kernel files are `FORBIDDEN_AUTONOMOUS`. Unknown path ⇒
  `REVIEW_REQUIRED` (fail safe).
- `BrainAutoApplyPolicy.NEVER_AUTO_APPLY` — a redundant second denylist over the same areas.
- `BrainUntrustedInput` — runtime logs are DATA; instruction quarantine + redaction (now runs
  `redactBrainText` too).
- `BrainSelfHealStore` — a value that still matches a secret pattern after redaction is **REJECTED,
  not masked**; corrupt / wrong-schema ⇒ loud throw, never a silent fresh start.
- Kernel files forbidden from self-modification: `BrainPatchSafety.ts`, `BrainSelfHealLimits.ts`,
  `BrainUntrustedInput.ts`, `BrainSelfHealGuards.ts`, `BrainSelfHealSandbox.ts`,
  `BrainSelfHealRunner.ts`, `BrainAutoApplyPolicy.ts`, `BrainPatchGeneration.ts`,
  `BrainSelfHealScheduler.ts`.

v2 rate / loop caps (`BrainSelfHealLimits`): `maxAutonomousAppliesPerHour = 4`,
`maxRollbackAttempts = 2`, `maxCauseChainDepth = 3`, plus A→B→C→A self-heal loop detection via
`checkCauseChain()`.

`D:\AtolyeRuntime` / `D:\AtolyeAuthority` / Caddy / firewall / Tailscale / `.env.local` — **not
touched.**

**SECURITY: PASS** — `smoke-brain-selfheal-security` 14 scenarios + a static import/term scan of the
committed source.

---

## Tests

All green. `npx tsc --noEmit` → **0 errors**. `npm run lint` → **0 errors** (22 pre-existing
warnings, none in touched files). `npm run build` → **exit 0**.

| Suite | Scenarios |
|---|---|
| `smoke-brain-selfheal` (v1 pure core) | 40 |
| `smoke-brain-selfheal-store` | 9 |
| `smoke-brain-selfheal-e2e` (v1, real worktree) | 3 |
| `smoke-brain-selfheal-security` | 14 |
| `smoke-brain-selfheal-observe-ui` | 10 |
| **`smoke-brain-selfheal-v2`** | **26** |
| **`smoke-brain-selfheal-e2e-v2`** (v2, real worktree) | **3** |
| `smoke-brain-core-ui` | 37 |
| `smoke-brain-lifecycle` | 16 |
| `smoke-brain-conversation` | 8 |
| `smoke-brain-security` | 11 |
| `smoke-brain-worker-cycle` | 15 |
| `smoke-ayas-voice` | 54 |
| `smoke-ayas-wake-adapter` | 39 |
| `smoke-ayas-wake-runner` | 17 |
| `smoke-ayas-stt` | 18 |
| `smoke-ayas-stt-security` | 7 |
| `smoke-ayas-graphify-consistency` | 9 |

`smoke-brain-selfheal-v2` covers: event buffer capacity/redaction, auto-apply policy (all-SAFE +
never-auto-apply + confidence + checks + caps + loop + opt-in gate), watchdog (recurrence / error
spike / post-apply fail / perf reject / HEALED), queue admission & P0 ordering, v2 limits
(rate / rollback / cause-chain), confidence evolution bands, negative-learning ranking, patch-gen
contract (redaction, stray-file / FORBIDDEN / secret / injection rejection), optimization loop
(NEUTRAL is rejected), scheduler (never during a live voice turn), and the extended state machine.

### Baseline (pre-existing, NOT caused by this sprint — not reported as new)

`smoke-production-snapshot-builder`, `129-25c-2a`, `129-25c-2b-4` — documented pre-existing env
failures on `main` as well.

---

## Synthetic Fault

`smoke-brain-selfheal-v2` (26) exercises every v2 decision module in isolation with crafted inputs —
the pure-logic proof that each gate behaves at its boundary (confidence just below threshold, one
REVIEW file in an otherwise-SAFE set, exactly `maxNewErrors + 1` error events, a signature in
`recentlyFailedSignatures`, a cause chain at depth 3, a <5 % optimization, a health check requested
mid-voice-turn, …).

---

## Real Controlled Fault

`smoke-brain-selfheal-e2e-v2` — **3 scenarios, real `git worktree` sandbox, real orchestrator loop**,
in a throwaway repo (no new commit is ever made in it):

1. **`controlled fault → … → AUTO-APPLY (SAFE) → WATCHDOG clean → HEALED → LEARN`**
   A fault is injected into a SAFE-classified fixture file; the Brain detects → diagnoses →
   sandboxes a fix → runs checks + regression + security (all PASS) → `decideAutoApply` returns
   `AUTO_APPLY` → the patch is `git apply --index`-staged in the working tree → the watchdog observes
   a clean window (no signature recurrence, no error spike) → `HEALED` → the fix is learned as a
   verified pattern. **PASS.**

2. **`AUTO-APPLY → WATCHDOG sees the signature recur → AUTO-ROLLBACK → tree restored → learn-failed`**
   Same path, but the applied patch does not actually fix the fault; the watchdog sees the incident
   signature recur → `HEAL_FAILED` → `rollbackWorkingTree` reverts the staged patch → the worktree
   is asserted identical to its pre-apply state → the pattern is stored as **failed** (so
   `recentlyFailedSignatures` blocks an auto-retry). **No false "healed" is ever emitted.** **PASS.**

3. **`learning speeds the next occurrence`**
   After scenario 1's pattern is learned, a second incident with the same signature is created; its
   diagnosis already carries the fix (`matchLearnedPattern`), skipping re-derivation. **PASS.**

---

## Known Limitations

1. **Autonomous `draftPatch` (hypothesis → diff) is a seam, not a live LLM call.** v2 ships
   `BrainPatchGeneration` (redacted request assembly + output validation); the model itself is a
   future sprint. In tests and the CLI the patch is fixture- or operator-fed (`heal <id> --patch`).
2. **`observePostApply` in the CLI re-runs the relevant check** as the post-apply signal. A real
   deployment feeds the live event buffer to the watchdog instead.
3. **`BrainOptimizationLoop` is not wired to a live wake/STT/TTS latency feed.** The loop and the
   benchmark comparator are pure and tested; connecting the telemetry source is the operator step
   for unattended AUTO-OPTIMIZATION.
4. **The iPhone ~3-min reload stays `UNKNOWN`.** iOS exposes neither a memory-eviction nor a
   render-crash signal to the page; the Brain tracks the pattern honestly rather than fabricating a
   cause, and cannot autonomously patch it (voice/PWA/SW are `NEVER_AUTO_APPLY`).

---

## Git Status

```
$ git branch --show-current
wip/ayas-graphify-final-execution

$ git log --oneline -3
23ba767 feat(brain): Autonomous Brain v2 — continuous observe, SAFE auto-apply, post-apply watchdog, optimization loop
3da4096 docs(checkpoint): Self-Healing Brain v1 — SELF_HEALING_READY (synthetic chain PASS)
06b134e feat(brain): Self-Healing Brain v1 — detect → diagnose → sandbox-fix → test → verify → learn

$ git show --stat 23ba767 | tail -1
 25 files changed, 2389 insertions(+), 53 deletions(-)

$ git diff --check
(clean)

$ git ls-remote --heads origin wip/ayas-graphify-final-execution
(empty — never pushed)
```

Working tree carries only the `ATOLYE_CHECKPOINT.md` v2 entry + this report (about to be committed
as a `docs(checkpoint):` follow-up, matching the v1 `3da4096` pattern).

**NOT pushed · NOT merged · NOT deployed. Branch `wip/ayas-graphify-final-execution` preserved.**

---

## Commit

```
23ba767  feat(brain): Autonomous Brain v2 — continuous observe, SAFE auto-apply,
         post-apply watchdog, optimization loop
```

---

## Final Status

```
AUTO-HEALING:          READY
AUTO-OPTIMIZATION:     READY   (engine + loop pure & tested; live metric feed = operator wire-up)
SELF-LEARNING:         READY
AUTONOMOUS_SAFE_APPLY: READY   (opt-in SELFHEAL_AUTO_APPLY=on; default OFF; staged-only, SAFE-only,
                                watchdog-guarded, rate-limited)
POST-APPLY_ROLLBACK:   READY
SECURITY:              PASS
```

Proven — not asserted — by `smoke-brain-selfheal-e2e-v2` (real worktree, real loop, both the
success and the auto-rollback path), `smoke-brain-selfheal-v2` (26), `smoke-brain-selfheal-security`
(14), and a clean tsc / lint / build / full neighbouring regression.

`AUTONOMOUS_BRAIN_READY` — with the four Known Limitations above explicitly on the record.
