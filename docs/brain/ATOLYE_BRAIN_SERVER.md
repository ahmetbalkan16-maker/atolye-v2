---
Document: ATOLYE_BRAIN_SERVER.md
Status: DESIGN ONLY — nothing here is deployed, exposed, or wired to execution
Owner: Atölye V2
Roadmap: PHASE 6 (Intelligence) → PHASE 7 (secure remote access)
Last Updated: 2026-09-08
Sprint: 181
---

# Atölye Brain — Server / Remote-Access Architecture (design)

> **Read this first.** This document is a *contract sketch*, not a runbook.
> Sprint 181 delivered the read-only foundations (plan CLI, experience store,
> resource/render probes). It did **not**:
>
> - open a public server, a domain, or a port;
> - put Ollama, the Windows PC, or `data/` on the internet;
> - install Tailscale / a tunnel / a reverse proxy;
> - wire `BrainOrchestrator` to `PipelineRunner`;
> - start any real LLM inference or GPU work.
>
> Every one of those is a separate, explicitly user-approved step. The security
> layer (PHASE 7) must land **before** any remote access is switched on.

---

## 1. Why a server at all

Today the Brain only exists while a `tsx` process is running on the director's
PC. The goal (`VISION.md`, `ATOLYE_CONTEXT.md` — "Secure Remote Personal
Studio") is a **Beyin Merkezi** ("Brain Centre") the director can reach from a
phone, tablet, or another PC, that:

- answers questions (text now, voice later);
- **reaches out on its own** when something needs attention — a finished
  production, a failed task, a security alert, an overnight-learning report, an
  approval request;
- shows task status, Brain decisions, and experience history;
- keeps working (analysis / research / drafting only) while the PC is off.

Example proactive message:

> "Günaydın. Gece 7 görev analiz ettim. 2 sorun buldum. 1 geliştirme önerisi
> hazırladım. 1 işlem senden onay bekliyor."

## 2. Components

```
                         ┌─────────────────────────────────────────────┐
   phone / tablet / PC   │              BEYİN MERKEZİ (UI)             │
   (browser, later app)  │  chat · task board · decisions · history ·  │
                         │  approvals · alerts · night reports         │
                         └───────────────┬─────────────────────────────┘
                                         │  HTTPS + auth (PHASE 7)
                         ┌───────────────▼─────────────────────────────┐
                         │            SECURE GATEWAY                    │
                         │  TLS · authN · authZ · rate-limit · CSRF ·  │
                         │  brute-force lockout · audit log · WAF-lite  │
                         └───────────────┬─────────────────────────────┘
                                         │  internal only
                         ┌───────────────▼─────────────────────────────┐
                         │              BRAIN API                      │
                         │  /brain/plan  /brain/tasks  /brain/approvals│
                         │  /brain/experience  /brain/notifications    │
                         │  /brain/health   (all read-mostly)          │
                         └───┬───────────────┬───────────────┬─────────┘
                             │               │               │
              ┌──────────────▼──┐  ┌─────────▼────────┐  ┌───▼──────────────┐
              │   SERVER BRAIN  │  │  TASK QUEUE       │  │ MEMORY / EXPERI- │
              │  (always-on box)│  │ (BrainTaskQueue + │  │ ENCE STORE       │
              │  deterministic  │  │  durable store)   │  │ (data/brain/)    │
              │  + local models │  └─────────┬────────┘  └──────────────────┘
              └───────┬─────────┘            │
                      │  sync when PC online │
              ┌───────▼─────────────────────▼───────────────────────────┐
              │            LOCAL ATÖLYE AGENT (on the PC)                │
              │  the only component that may touch: GPU · Ollama ·       │
              │  PipelineRunner · data/projects · Windows files          │
              └─────────────────────────────────────────────────────────┘
                      ▲
              ┌───────┴──────────┐
              │ APPROVAL MANAGER │  state machine + pending list (deterministic)
              └──────────────────┘
              ┌──────────────────┐
              │ NOTIFICATION /   │  Event → Decision → Notification (see §4)
              │ EVENT LAYER      │
              └──────────────────┘
```

### Component responsibilities

| Component | May do | May **never** do |
|---|---|---|
| **Beyin Merkezi (UI)** | render state, collect a chat message, show/accept an approval | hold a secret; call a model directly |
| **Secure Gateway** | terminate TLS, authenticate, authorize, rate-limit, audit | business logic; bypass authZ for "trusted" IPs |
| **Brain API** | read stores, enqueue a task, record an approval decision | run a pipeline stage; shell out; touch `data/projects` |
| **Server Brain** | analysis, research, diagnosis, draft proposals/tests, night learning | GPU work; run the PC; open Windows files; apply code |
| **Task Queue** | order tasks by dependency, park approval-gated tasks | execute a `forbidden` task even with approval |
| **Memory / Experience Store** | append/read redacted records | store a secret (reject-on-leak) |
| **Local Atölye Agent** | GPU, Ollama, `PipelineRunner`, `data/projects` — under the autonomy gate | run a task above `maxAutonomy` without a human |
| **Approval Manager** | advance the approval state machine, list pending | approve on the Brain's behalf |
| **Notification / Event layer** | classify events, emit notifications under a rate limit | spam; page for `INFO`-level events |

## 3. Trust boundaries & the "two brains" split

- **Server Brain** runs on the always-on box. It has **no** path to the GPU, the
  pipeline, or the Windows filesystem. It can research the web, read the
  experience store, analyse history, and *draft* proposals/tests. Its output is
  always a queued task or a proposal — never an action.
- **Local Atölye Agent** runs on the PC. It is the *only* component wired to
  `PipelineRunner`, Ollama, the GPU, and `data/projects`. It pulls cleared tasks
  from the queue when the PC is online and reports results back.
- The two synchronise through the **durable task queue + experience store**
  under `data/brain/` (already the store's home). Sync is one queue, two
  readers; conflicts resolve by `taskId` / `recordId` (the store is already
  idempotent on id).

Minimum privilege, always: the Brain never holds "root". Each component gets the
narrowest capability set that lets it do its job.

## 4. Proactive communication — Event → Decision → Notification

The Brain is **not** a reply-only chatbot. It observes events, decides whether
the director needs to know, and notifies — under a rate limit.

```
   EVENT                         DECISION                     NOTIFICATION
   (something happened)   →   (does the human need this?   →  (deliver at the
                              at what urgency?)               right priority)
```

### Priority levels

| Level | Meaning | Example | Delivery |
|---|---|---|---|
| `CRITICAL` | safety / security / data at risk — act now | GPU hard-stop tripped; intrusion signal; disk almost full mid-render | push immediately, bypass quiet hours, repeat until acked |
| `IMPORTANT` | something failed or a decision has consequences | a production failed; a stage exhausted its retry budget | push once; visible on the board |
| `APPROVAL_REQUIRED` | the Brain is parked waiting on a human | "apply improvement proposal #12?"; "publish to YouTube?" | push once; persistent until answered |
| `INFO` | FYI, no action | "overnight I analysed 7 tasks"; "graph refreshed" | batched into the next digest (e.g. the morning report) |

### Event sources the Brain watches

- Safety: `evaluateBrainSafety` verdict change; `evaluateBrainResourceHardStop`
  trip; an abnormal signal (`tdr` / `fatal-whea` / `display-loss` / …).
- Production: a stage failed / recovered / exhausted retries; a final render
  passed or failed `evaluateBrainQuality`.
- Learning: an overnight cycle finished; a new insight crossed a confidence
  threshold; a proposal is ready for review.
- Security: `evaluateBrainSecurityPosture` regressed; a repeated auth failure
  pattern; a request classified `high` risk.
- Housekeeping: graph went stale; a backup is overdue.

### Anti-spam rules (mandatory, deterministic)

- A per-level token bucket (e.g. `CRITICAL` unlimited, `IMPORTANT` ≤ N/hour,
  `INFO` digest-only).
- De-duplication by event fingerprint within a window (don't send the same
  "stage X failed" twice).
- Escalation, not repetition: an unacked `CRITICAL` escalates channel, it does
  not re-fire every minute.
- Quiet hours for everything below `CRITICAL`.

## 5. Night Learning (server-side, PC off)

While the PC is off the **Server Brain** may:

- research topics and sources (web read-only);
- analyse the experience store for patterns (`deriveBrainExperienceInsights`);
- draft improvement proposals (`buildBrainImprovementProposal`);
- draft test plans;
- prepare a morning report (`buildBrainWorkerCycleReport`).

While the PC is off the Server Brain may **not**:

- run the PC or wake it for compute;
- use a GPU;
- read Windows / `data/projects` files;
- run the production pipeline;
- apply any code or config change.

When the PC comes back online, **Server Brain → Local Agent** sync runs:

1. The Local Agent pulls the queue.
2. Pending items are bucketed: `security` · `approval` · `production` ·
   `code-change`. Nothing in `approval` / `code-change` runs without the
   director; `production` runs only under the autonomy gate + Safety Governor +
   (on the A2000) the 60 °C hard stop; `security` deterministic checks run,
   Brain "security intelligence" only *recommends*.
3. Results flow back into the experience store; the morning report is delivered
   as an `INFO` digest (or `APPROVAL_REQUIRED` if something is parked).

## 6. Security (PHASE 7 backlog — must precede any exposure)

Grounded in the existing `BrainSecurityCatalog` (18 controls) and
`evaluateBrainSecurityPosture`. Priority order before the gateway is reachable
from anything but localhost:

1. **authentication** — single-director credential, hashed + salted; no default
   account.
2. **authorization** — every Brain API route checks a capability, deny by
   default.
3. **rate limiting** — per-route + per-IP token buckets.
4. **brute-force protection** — progressive lockout on repeated auth failure.
5. **secure session / cookie** — `HttpOnly`, `Secure`, `SameSite=Strict`, short
   TTL, server-side revocation.
6. **CSRF** — token on every state-changing request.
7. **audit logging** — every auth event, every approval, every task dispatch
   (redacted).
8. **intrusion / anomaly detection** — deterministic rules first (impossible
   travel, auth-failure spikes, unexpected route mix); Brain "security
   intelligence" proposes additional rules but never *is* the control.

**Hard rule:** the deterministic security layer and the Brain's security
intelligence run **together**. Authentication, authorization, rate limiting,
lockout, CSRF, session handling are code — never delegated to an LLM. The Brain
may analyse threats and *propose / prepare* automated defensive actions; a human
approves anything that changes a policy or a boundary.

The Brain may **not** grant itself capability. `BrainAutonomyPolicy` is a fixed
table; `BrainSelfImprovementLoop` / `BrainImprovementProposal` cannot reach
`apply` without a recorded `user-approve`. Sprint 181 keeps that invariant —
none of the new modules can widen the Brain's own authority.

## 7. Self-improvement loop (unchanged, preserved)

```
OBSERVE → ANALYZE → PROPOSE → TEST → VERIFY → REPORT
        → USER APPROVAL            ← hard gate
        → APPLY → REGRESSION TEST → AUDIT → KEEP | ROLLBACK
```

The Brain may do everything up to and including `REPORT` autonomously (in a temp
workspace, $0, read-only against production). It may **not**:

- change its own security limits, capabilities, or the approval mechanism;
- reach `APPLY` (or anything past it) without a recorded `user-approve`.

`buildBrainDryRunExperienceRecord` feeds the loop's `OBSERVE`/`RECORD` steps with
plan-level data that is explicitly marked `dry-run` and never counted as a real
outcome.

## 8. What Sprint 181 actually shipped toward this

| This doc's component | Sprint 181 artifact |
|---|---|
| Brain API `/brain/plan` (read) | `scripts/brain-plan.ts` — the read-only dry-run planner, CLI form |
| Memory / Experience Store | `src/lib/brain/store/BrainExperienceStore.ts` — durable, atomic, redacted, `data/brain/experience/<yyyy-mm>.json` |
| Local Agent resource guard | `src/lib/brain/probe/BrainResourceProbe.ts` — read-only `nvidia-smi` + `os`; A2000 60 °C hard stop |
| Quality feed | `src/lib/brain/probe/BrainRenderProbe.ts` — read-only `ffprobe` → `BrainFinalRenderReport` |
| Night-learning `OBSERVE` input | `buildBrainDryRunExperienceRecord` (marked `dry-run`) |

Everything else in this document is still design.

## 9. Explicitly NOT done (needs user approval, in this order)

1. `BrainOrchestrator` → `PipelineRunner` wiring (one stage, behind a flag).
2. The role model-call implementations (local Ollama only, $0).
3. Durable store behind `BrainTaskQueue` (mirror of the experience store).
4. The Local Atölye Agent process (pull queue, run under autonomy gate).
5. The Server Brain process (analysis / research / night learning only).
6. The Brain API (`/api/brain/*`) — localhost only at first.
7. The Secure Gateway + the PHASE 7 security backlog above.
8. Any remote access (phone / tablet / other PC) — only after 7.
