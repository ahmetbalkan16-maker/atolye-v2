---
Document: ATOLYE_BRAIN.md
Status: Active — foundation + read-only adapters landed, not yet wired to execution
Owner: Atölye V2
Roadmap: PHASE 6 — Intelligence (AI Director + Production Memory + Knowledge Engine)
Last Updated: 2026-09-08
---

# Atölye Brain

## What it is

The **Brain** is the implementation of the roadmap's **PHASE 6 — Intelligence**
(`ATOLYE_MASTER_ROADMAP.md`): the *AI Director*, *Production Memory* and
*Knowledge Engine* named there as long-term systems. It is a thin, mostly
**deterministic** decision layer that sits *above* the existing pipeline
(`src/lib/pipeline`) and production execution layer (`src/lib/production`) and
manages a production end-to-end:

```
UNDERSTAND → RESEARCH → VERIFY → PLAN → FIND MEDIA → SELECT MEDIA → WRITE →
SCENE PLAN → PRODUCE → REVIEW → REPAIR → RE-REVIEW → FINALIZE → LEARN
```

It is **not** a second orchestrator, **not** one big LLM prompt, and **not** a
system that changes Atölye on its own. It *decides what and when*; the existing
services still *do the work*.

## Hard rules (baked into the code)

1. **No unbounded self-modification.** The Brain may analyse, research, plan,
   test in a temp workspace, diagnose, and *draft* improvement proposals. It may
   **not** change production behaviour, security policy, critical code, or delete
   / mutate data without an explicit user approval. Enforced by
   `BrainAutonomyPolicy` (a fixed table, not a judgement call) and the approval
   state machines in `BrainImprovementProposal` / `BrainSelfImprovementLoop`.
2. **Security is code-level, not model-level.** Allowlist / denylist / sandbox /
   path-containment / secret-redaction checks are deterministic functions
   (`BrainSecurityPolicy`, `BrainRedaction`). "The Brain protects itself" is
   never an excuse to hand a control to a model.
3. **No secrets in memory / logs / reports.** Every Brain-written string passes
   through `redactBrainText` first; a memory record that still contains a secret
   after redaction is rejected (`BRAIN_MEMORY_SECRET_LEAK`), never stored anyway.
4. **$0 by default.** Local models (Ollama `qwen2.5:3b`), free sources, CPU
   methods, existing assets. A paid provider needs a per-run user approval —
   the presence of `OPENAI_API_KEY` is **not** consent.
5. **Conservative hardware.** GPU work runs with a watchdog + cooldown +
   process-tree kill. `BrainSafetyGovernor` acts *before* the thermal ceiling
   (it never "waits for 80 °C"); `thermal-slowdown` / `driver-reset` / `tdr` /
   `bsod` / `fatal-whea` / `display-loss` → immediate abort. `qwen2.5:7b` is
   forbidden on a ≤ 5 GB card.
6. **Additive & reversible.** The Brain lives entirely in `src/lib/brain/` +
   `src/types/brain*.ts`. Nothing in `src/lib/pipeline` or `src/lib/production`
   imports it. Nothing here calls a model, a binary, or the network yet.

## Module map (`src/lib/brain/`)

| Module | Purpose | Purity |
|---|---|---|
| `BrainContracts.ts` | Port interfaces; each delegates to an existing Atölye service | types only |
| `BrainRoles.ts` | The 7 logical roles + default single-model assignment | types + data |
| `BrainDecisionJournal.ts` | Explainable decision log (section-12 block), validate + render | pure |
| `BrainSafetyGovernor.ts` | Hardware profile + resource snapshot → go / hold / abort + constraints | pure |
| `BrainComputationPlanner.ts` | Split a heavy LLM call into quality-preserving sequential units | pure |
| `BrainQualityModel.ts` | Judge a finished render across 16 dimensions → release / repair / reject + minimal repair targets | pure |
| `BrainExperienceModel.ts` | Derive explainable insights from past productions → next-run strategy hint | pure |
| `BrainImprovementProposal.ts` | `# USER APPROVAL REQUIRED` proposal + approval state machine | pure |
| `BrainSelfImprovementLoop.ts` | OBSERVE→…→AUDIT loop; `apply` unreachable without `user-approve` | pure |
| `BrainMemoryModel.ts` | Build / validate / recall memory records; secret-leak rejection | pure |
| `BrainRedaction.ts` | Deterministic secret / sensitive-string scrubber | pure |
| `BrainOrchestrator.ts` | Non-executing run-planner: the ordered, safety-gated phase plan | pure |
| `worker/BrainAutonomyPolicy.ts` | Fixed table: which task kinds may run unattended | pure |
| `worker/BrainTaskQueue.ts` | Dependency-ordered queue; approval parking; cycle rejection | pure |
| `worker/BrainWorkerReport.ts` | The "overnight" morning report builder + renderer | pure |
| `security/BrainSecurityPolicy.ts` | Shell allowlist, path containment, request-risk classification | pure |
| `security/BrainSecurityCatalog.ts` | The 18-control reference rubric | data |
| `security/BrainSecurityAuditModel.ts` | Structured facts → security posture + prioritized backlog | pure |
| `store/BrainExperienceStore.ts` | Durable JSON-file store behind the `BrainExperienceStore` port — atomic writes, redaction, reject-on-leak, corrupt-shard-fails-loud, deterministic reads | fs (own `rootDir` only) |
| `worker/BrainTaskStore.ts` | Durable JSON-file persistence under `BrainTaskQueue` — `queue/tasks.json` + `queue/results/<cycle>.json`; atomic writes, reject-on-leak, payload caps, corrupt/schema-mismatch fails loud, idempotent enqueue + result save, every save re-validates the whole queue. Queue logic unchanged. | fs (own `rootDir` only) |
| `BrainDryRunExperience.ts` | `BrainRunPlan` → a `mode: "dry-run"` experience record (honest zeros, hidden from the learner) | pure |
| `probe/BrainResourceProbe.ts` | Read-only host probe: `nvidia-smi --query-gpu` + `os` → `BrainResourceSnapshot`; A2000 **60 °C hard stop** check | read-only spawn |
| `probe/BrainRenderProbe.ts` | Read-only `ffprobe -show_format -show_streams` → `BrainFinalRenderReport` for the quality judge | read-only spawn |

Types: `src/types/brain.ts`, `brainMemory.ts`, `brainWorker.ts`, `brainSecurity.ts`.
Smoke suites: `scripts/smoke-brain-foundation.ts`, `smoke-brain-worker.ts`,
`smoke-brain-security.ts`, `smoke-brain-plan-store.ts`, `smoke-brain-probes.ts`,
`smoke-brain-task-store.ts` (~103 scenarios, GPU-free, $0, deterministic; the
probe suite does two optional read-only live calls when `nvidia-smi` / `ffprobe`
+ an MP4 are present).

CLI: `npx tsx scripts/brain-plan.ts "<topic>"` — read-only dry run of the
14-phase plan (no pipeline, model, GPU, network, or file write).

## The 7 logical roles

They do **not** have to be separate physical models. The default free
single-machine arrangement (`DEFAULT_BRAIN_ROLE_ASSIGNMENT`):

| Role | Backing | Job |
|---|---|---|
| planner | `qwen2.5:3b` hat | goal → small ordered safety-gated steps |
| researcher | `qwen2.5:3b` hat | one narrow question at a time; cite; flag the unverifiable |
| critic / verifier | `qwen2.5:3b` hat | claim + evidence → supported / unsupported / contradicted / uncertain |
| executor | `qwen2.5:3b` hat | carry out only the current cleared step |
| **security-guard** | **deterministic** | allowlist / denylist / path / redaction — no model |
| **memory** | **deterministic** | redact + build + validate for storage; a model may only summarise on read |
| **approval-manager** | **deterministic** | state machine + pending list; renders proposals |

## How the Brain maps onto the existing pipeline

`BrainOrchestrator.planBrainRun()` produces a `BrainRunPlan` — for each of the
14 phases: the pipeline stage(s) it drives, the existing service it delegates
to, the safety constraints in force, and whether it needs user approval.
`produce` / `repair` run locally, $0, stage-bounded and reversible (assets are
append-only) — **no approval needed**. `finalize` can publish to YouTube →
**approval required** (package-only is the safe default).

## Server-side "Brain Worker" (PC-off) — design, not yet built

Goal: a task queue that keeps working while the director's PC is off, on our own
free / self-hosted deployment, using local models, sending nothing unnecessary
outside; in the morning it reports what it did.

- **Queue** (`BrainTaskQueue`, modelled now): dependency-ordered, deterministic.
  Tasks above the deployment's autonomy ceiling are parked `blocked-on-approval`
  and never executed.
- **Autonomy gate** (`BrainAutonomyPolicy`, done): `auto-safe` (read-only) /
  `auto-safe-reversible` (temp-workspace writes) run unattended;
  `requires-user-approval` (production / security / data / GPU / cost / push) is
  parked; `forbidden` (BIOS / power / fan / undervolt / HVCI / driver / model
  pull / stress test) never runs, even with approval.
- **Morning report** (`BrainWorkerReport`, done): "Overnight I analysed X, found
  problem Y, ran tests Z, proposed improvement W, found security risk V, did NOT
  do these without approval, I'm waiting on approval for these, next single step
  is …". Every line redacted.

**To actually deploy it** (all user-approved, separate work):
1. A durable JSON-file store behind `BrainTaskQueue` / `BrainExperienceStore`
   (sibling of `AIUsageManager`), under `data/brain/`.
2. A bounded runner (`BrainWorkerConfig`: max tasks/cycle, wall-clock budget,
   `allowGpuTasks`, `gpuHardStopCelsius`, cooldown) — a Node process or a small
   container on our own box; **no paid cloud service**.
3. A wake trigger: OS scheduler / systemd timer on the always-on box, or the
   PC's own scheduler when it *is* on.
4. Local Ollama on the worker box for the model-backed roles (or the roles
   degrade to deterministic-only when no model is reachable).
5. A `/api/brain/*` read surface (behind PHASE-7 auth) for the report.

## Security governance

`BrainSecurityCatalog` is the fixed 18-control rubric; `BrainSecurityAuditModel`
grades a structured set of repo facts against it. Today Atölye is a personal
local studio (`ADR-014`/`ADR-015`), so most web-perimeter controls are
`not-implemented` and that is expected — the catalog exists so the audit has a
rubric instead of improvising. `path-traversal` and `health-checks` are already
`enforced-in-code`; `secret-management`, `audit-log`, `injection`,
`command-execution-isolation`, `file-upload-safety`, `backup-recovery`,
`admin-access`, `xss` are `partial`.

Before any internet exposure: **authentication → authorization → rate-limiting →
brute-force → session/cookie → CSRF → audit-log → intrusion detection**
(the `evaluateBrainSecurityPosture` backlog order).

## Self-improvement loop

```
OBSERVE → ANALYZE → PROPOSE → TEST → VERIFY → REPORT   ← Brain may do all of this
        → USER APPROVAL                                  ← hard gate
        → APPLY → REGRESSION TEST → AUDIT → KEEP|ROLLBACK
```

`BrainSelfImprovementLoop.advanceBrainImprovementLoop` refuses to reach `apply`
(or anything past it) without a recorded `user-approve` event
(`BRAIN_LOOP_APPROVAL_REQUIRED`).

## Current status

**Done (Sprint 180):** the full domain model + contracts + every pure
decision/safety/quality/experience/memory/security/worker/self-improvement
module, 50 passing smoke scenarios, `tsc` + `eslint` clean.

**Done (Sprint 181) — still read-only, still not wired to execution:**
- `scripts/brain-plan.ts` — the read-only dry-run plan CLI.
- `store/BrainExperienceStore.ts` — durable JSON-file experience store
  (atomic, redacted, reject-on-leak, corrupt-shard-fails-loud, deterministic).
- `BrainDryRunExperience.ts` — dry-run plan → a clearly-marked experience record.
- `probe/BrainResourceProbe.ts` — read-only `nvidia-smi` + `os` host probe;
  A2000 60 °C hard-stop check.
- `probe/BrainRenderProbe.ts` — read-only `ffprobe` → `BrainFinalRenderReport`.
- Server / remote-access / proactive-comms / night-learning / security design:
  `docs/brain/ATOLYE_BRAIN_SERVER.md`.

**Done (Sprint 182) — persistence only, still not wired to execution:**
- `worker/BrainTaskStore.ts` — durable JSON-file store under `BrainTaskQueue`
  (`data/brain/queue/`). Restart-safe, deterministic, secret-safe (reject-on-leak),
  corruption-safe (loud fail), idempotent. `BrainTaskQueue.ts` unchanged; the
  queue gained **no** production / GPU authority.

**Not done (needs approval / later phases):**
- Wiring `planBrainRun` to real `PipelineRunner` execution.
- The role implementations (model calls).
- The security-fact gatherer feeding `BrainSecurityPostureInput`.
- The Brain Worker runner + deployment (Server Brain + Local Agent).
- Any `/api/brain/*` route; the Secure Gateway; any remote access.

See `ATOLYE_CHECKPOINT.md` for the sprint entries and `ATOLYE_BRAIN_SERVER.md`
for the phased remote-access plan.
