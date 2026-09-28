# Stage 17 — Full AYAS System Audit + Final Foundation Closure

## Goal

Create one canonical, read-only audit and closure system for the whole AYAS/Atölye foundation.

Stage 17 does not fix findings and does not create new execution authority.
It answers, with evidence bound to one Git HEAD:

- what is implemented?
- what is actually tested?
- what is only statically reviewed?
- what still requires live owner-PC validation?
- what is blocked?
- what known limitations remain?
- is the foundation eligible to be called CLOSED?

## Core rule

`STATIC REVIEW != TEST PASS != LIVE PASS`

No module may be marked fully healthy merely because its source exists.

## Proposed files

- `src/lib/ayas/audit/AyasSystemAuditModel.ts`
- `src/lib/ayas/audit/AyasSystemAuditRegistry.ts`
- `src/lib/ayas/audit/AyasSystemAuditCollector.ts`
- `src/lib/ayas/audit/AyasSystemAuditPolicy.ts`
- `src/lib/ayas/audit/AyasSystemAuditReport.ts`
- `src/lib/ayas/audit/AyasSystemClosureGate.ts`
- `scripts/ayas-system-audit.ts`
- `scripts/smoke-ayas-system-audit.ts`
- `scripts/adversarial-ayas-system-audit.ts`
- `docs/AYAS_FULL_SYSTEM_AUDIT.md`

The audit runner is read-only. A report may be emitted to stdout or to an explicitly supplied TEMP/output path.
It must not write `data/brain`, runtime authority, production data, approval inboxes, memory, or platform stores.

## Evidence classes

```ts
type AyasAuditEvidenceClass =
  | "STATIC_SOURCE"
  | "DETERMINISTIC_TEST"
  | "LIVE_READ_ONLY"
  | "EXTERNAL_OFFICIAL"
  | "OWNER_DECISION";

type AyasAuditEvidenceState =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "NOT_RUN"
  | "STALE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";
```

Every evidence item carries:
- domain
- check id/version
- evidence class
- Git HEAD when relevant
- observedAt
- source reference/digest
- state
- severity if failed
- exact limitation/finding code
- whether live validation is required

`OWNER_DECISION` can resolve a product/policy choice but cannot turn a failed technical test into PASS.

## Severity

```ts
type AyasAuditSeverity =
  | "INFO"
  | "MINOR"
  | "MAJOR"
  | "BLOCKER";
```

Closure requires:
- BLOCKER = 0
- unresolved verified MAJOR = 0

Known limitations may remain only when:
- they are explicitly bounded;
- not authority/security/data-loss/production blockers;
- evaluator continues to expose them;
- roadmap/documentation names them truthfully.

## Audit domains

### A. Repository / Build / CI

Checks:
- current branch + full HEAD
- local/remote ahead-behind
- clean worktree
- TypeScript
- lint
- `git diff --check`
- package-lock/package consistency
- CI presence/status
- untracked source/test files
- stale generated docs/reports

Static GitHub evidence cannot establish local worktree cleanliness.

### B. Graphify / Architecture

Checks:
- graph exists
- analyzed HEAD == current HEAD
- `stale=false`
- `.graphify/needs_update` absent
- duplicate node IDs / duplicate edges / dangling edges / self-loops = 0
- current structural extraction after source changes
- known parser coverage gaps (including PowerShell)
- phantom edge/node risk classification
- high-impact bridge review
- forbidden authority paths
- critical changed-file scope review

Graphify parser limitations are reported separately from repository defects.

### C. Conversation / Intent / Context

Checks:
- intent routing
- reference resolution
- long-session compression
- clarification behavior
- Turkish nuance fixtures
- answer relevance/completeness
- verbosity/instruction following
- live Ollama comparison status
- remaining cognitive known limits

Do not claim ChatGPT-equivalent quality without matched live benchmark evidence.

### D. Memory / Retrieval / Temporal

Checks:
- store integrity
- current/history/as-of behavior
- supersession
- stale/future quarantine
- conflict behavior
- retrieval metrics
- chat delivery gate
- known limitation map
- free-text decision correction
- privacy/memory governance

An unexpectedly passing known-limit test must force review/update rather than silently disappear.

### E. Model / Provider / Voice / Mobile

Checks:
- Ollama health/current selected model
- no unexpected paid cloud fallback
- model-routing docs match code
- STT path/config
- phone local-LLM model artifact revision/digest pinning
- phone access health
- wake/session continuity
- voice/TTS path
- current runtime evidence versus historical reports

Historical mobile reports are never treated as current live PASS.

### F. Autonomy / Approval / Execution

Checks:
- proposal discovery authority = none
- approval provenance
- exact proposal hash binding
- patch artifact hash binding
- stale-head reconciliation
- execution gate
- execution journal recovery
- Runtime Stability Guard
- no direct mutation bypass
- owner approval required
- observer/discovery daemon isolation
- autostart smoke safety
- controlled self-evolution Stage 15 status

### G. Security / Supply Chain

Checks:
- safe public fetch / SSRF
- secret leakage
- bounded body/file writes
- symlink/junction boundaries
- command/process fixed-argument paths
- package install scripts risk
- current advisory scan status
- model artifact pinning
- dependency drift
- MCP/plugin/tool authority boundaries
- prompt injection
- archive/file safety
- revenue security if Stage 16 exists

An offline npm audit cannot prove "no current vulnerabilities".

### H. Data Governance / Privacy

Checks:
- memory data classification
- retention/deletion semantics
- secrets separation
- personal/private data minimization
- raw provider/platform payload persistence
- redaction
- trace privacy
- revenue PII boundaries
- backup contents/policy
- connected-app data boundaries

### I. Backup / Disaster Recovery

Checks:
- current runtime backup inventory
- manifest verification
- restore/candidate verification
- path policy
- durable recovery
- crash/interruption handling
- recovery test freshness
- authority generation binding
- old-root/quarantine/rollback semantics where applicable
- restore test, not merely backup creation

A backup without a verified restore path is not a recovery PASS.

### J. Runtime / Remote Access / Operability

Checks:
- runtime composition root
- health endpoint identity
- runtime authority root
- scheduled tasks/autostart status
- observer heartbeat
- access daemon
- Cloudflare/remote access health where owner chooses to test
- background process mutation accounting
- logs/recovery state
- single-instance/process ownership
- no hidden duplicate runtime

The known `/api/runtime/health` bundled-instance issue remains OPEN until live proof/fix.

### K. Production Pipeline / Storage / Media

Checks:
- production authority generation
- execution gate
- durable recovery
- storage relocation/cutover state
- ffmpeg/ffprobe
- scene-video/assembly/audio gates
- real-media source selection
- media rights audit
- visual depiction/classification
- director readiness
- pixel-level evaluation status
- audio-level evaluation status
- Wikimedia/stock-video known limitations
- production E2E readiness and current smoke

Never infer production readiness from old Sprint reports.

### L. Research / Evolution / Technology Watch

Checks:
- PC-off research recovery
- source resilience
- research improvement loop
- Stage 13 opportunity lifecycle
- Stage 14 technology watch persistence/daemon state
- Stage 15 controlled self-evolution status
- production strategy registry
- bounded experiment policy
- owner authority remains external to research/evolution

### M. Developer Intelligence / Skills / Agents

Checks:
- task classifier
- Graphify evidence
- skill registry
- Claude/Codex descriptive vs live adapter status
- manual handoff vs live dispatch
- no model-selected executable adapter
- developer held-out evaluator
- repository recovery behavior

### N. Revenue Center

Checks all Stage 16.0–16.14 closure invariants:
- default spend = 0
- adapter transport truth
- ledger integrity
- free-first validation
- platform live validation levels
- reinvestment disabled/default
- privacy/security
- pilot/scaling authority
- no unapproved financial/external write

### O. Documentation / Roadmap Consistency

Checks:
- ROADMAP status matches code/evidence
- docs do not claim a cloud fallback that code denies
- historical reports clearly labeled historical
- completed stages have closure evidence
- deferred work is still represented
- no "PASS" or "complete" claim is based only on design files

## Collector architecture

Collectors are read-only and dependency injected.

```ts
interface AyasAuditCollector {
  readonly domain: AyasAuditDomain;
  collect(ctx: AyasAuditContext): Promise<readonly AyasAuditEvidence[]>;
}
```

Rules:
- audit core does not import execution services;
- live collectors use read-only status/query APIs only;
- no collector can start a daemon, mutate a store, approve, execute, publish, install or repair;
- test collectors use TEMP fixtures;
- missing capability => `BLOCKED/NOT_RUN`, not synthesized PASS.

## Snapshot binding

One audit run has:

```ts
interface AyasSystemAuditSnapshot {
  schemaVersion: "1";
  auditId: string;
  branch: string;
  head: string;
  startedAt: string;
  completedAt: string;
  machineEvidenceAt: string | null;
  graphifyHead: string | null;
  evidence: readonly AyasAuditEvidence[];
  findings: readonly AyasAuditFinding[];
  domainSummaries: readonly AyasAuditDomainSummary[];
  closure: AyasSystemClosureDecision;
}
```

All HEAD-bound evidence must refer to the same full 40-char HEAD.

Evidence from another HEAD is `STALE` unless explicitly HEAD-independent.

## Closure states

```ts
type AyasSystemClosureDecision =
  | "OPEN"
  | "BLOCKED"
  | "STATIC_AUDIT_COMPLETE"
  | "LOCAL_VALIDATION_COMPLETE"
  | "FOUNDATION_CLOSED";
```

Meaning:
- `STATIC_AUDIT_COMPLETE`: source/docs reviewed, but live/local proof incomplete.
- `LOCAL_VALIDATION_COMPLETE`: required local deterministic/live-read evidence current.
- `FOUNDATION_CLOSED`: all mandatory domains satisfied at same HEAD, BLOCKER 0, unresolved verified MAJOR 0, owner reviews final report.

No `PERFECT`, `BUG_FREE`, or `FULLY_AUTONOMOUS` state exists.

## Mandatory current known/open findings to seed into Stage 17 audit

The audit must actively check, not hide, these currently identified items:
- Graphify `needs_update` discovery freshness gap until remediation verified
- Graphify PowerShell parser coverage / phantom-edge limitation
- memory/retrieval known-limit map, including free-text decision supersession until patch verified
- observer-autostart smoke isolation until Windows proof
- phone LLM mutable `main` artifacts until immutable revision/digest pinning
- `/api/runtime/health` instance identity issue until live proof/fix
- no GitHub CI until workflow is actually committed and green
- Stage 14 persisted register/daemon follow-up until implemented
- production improvement strategy registry empty until a reviewed strategy exists
- live Claude/Codex dispatch absent until implemented
- Director pixel/audio evaluation follow-ups
- real-media source/stock-video and selection-quality follow-ups
- current online dependency advisory status unknown unless owner-approved live scan is performed

If a remediation patch is applied, the finding is closed only by its designated regression/live evidence.

## Mutation accounting

Before and after every audit suite:
- hash/inventory protected roots
- distinguish audit test writes in TEMP from pre-existing background daemon writes
- report background writes separately
- never attribute unrelated daemon mutations to the audit

Mandatory protected roots include runtime, authority, production project state, memory, approval inboxes and revenue stores.

## Test matrix

New Stage 17 evaluator:
- >= 120 primary integration/audit cases
- >= 30 frozen held-out
- >= 30 adversarial/corruption cases

Adversarial examples:
- stale Graphify claims fresh
- `needs_update` present
- test result from old HEAD
- docs claim completed while code missing
- historical report passed but live collector unavailable
- owner statement tries to override technical failure
- corrupt audit evidence
- duplicate check IDs
- unknown domain/severity/state
- forged current HEAD
- partial test suite presented as full closure
- backup exists but restore unverified
- runtime health from wrong instance
- cloud/provider unavailable
- revenue design pack exists but implementation absent
- background daemon modifies store during audit
- known limitation unexpectedly passes without review
- secret/PII embedded in evidence
- audit collector attempts mutation
- malformed live status endpoint

## Monday / owner-PC closure sequence

1. Establish exact local/remote HEAD and dirty state.
2. Graphify-first; resolve freshness/needs_update.
3. Apply/re-review prepared remediation patches on dedicated branches.
4. Run deterministic source tests.
5. Run safe live read-only checks.
6. Run recovery/backup restore verification.
7. Run runtime/observer/remote-access validation.
8. Run live Ollama/voice/mobile tests.
9. Run production/media readiness/E2E only under existing production gates.
10. Run Stage 16 platform live-read validations only for connected platforms.
11. Generate Stage 17 audit snapshot.
12. Fix findings in separate reviewed changes; regenerate audit.
13. Final independent review.
14. Owner approves foundation closure.
15. Commit/push closure docs only after evidence is current at final HEAD.

## Completion

Stage 17 is complete only when:
- audit framework itself passes primary/held-out/adversarial tests;
- all mandatory domains have current evidence or explicit non-applicable status;
- BLOCKER 0;
- unresolved verified MAJOR 0;
- Graphify current;
- current known findings are either verified closed or truthfully deferred without being incompatible with foundation closure;
- no audit-induced production/runtime/private-data mutation;
- final report is owner reviewed;
- ROADMAP is updated truthfully.
