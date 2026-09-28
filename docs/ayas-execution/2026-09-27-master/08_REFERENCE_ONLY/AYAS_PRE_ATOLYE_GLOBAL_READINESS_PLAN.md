# AYAS — Pre-Atölye Global Readiness & Independence Hardening Plan
Date: 2026-09-27
Scope: final AYAS hardening before shifting primary development focus to Atölye.

## Executive conclusion

AYAS is NOT ready to be declared "perfect / bug-free" — no autonomous software system can honestly be given that guarantee.

The correct closure target is:

**Self-developing, local-first, fail-closed, crash-recoverable, evidence-driven, bounded in blast radius, auditable, and capable of returning to a known-good state without requiring Codex/Claude Cloud for ordinary future development.**

The existing 2026-09-27 master plan remains valid, but the following gaps are mandatory additions before Stage 17 can grant `FOUNDATION_CLOSED`.

---

# New mandatory additions under Stage 15 — Independence Hardening

## Stage 15A — Local Coding Runtime & No-Cloud Developer Capability

### Why it is required
The repository currently has:
- developer workflows;
- guided repair;
- patch artifacts;
- sandbox experiments;
- owner approvals;
- execution recovery.

But:
- the production improvement strategy registry is intentionally empty;
- there is no live general local coding-agent runtime that can replace future Codex/Claude development work.

### Goal
Give AYAS a local coding capability that can:
1. inspect a bounded source scope;
2. plan a repair;
3. generate a patch in an isolated environment;
4. run deterministic validation;
5. produce an immutable patch artifact;
6. submit it through the existing owner approval path.

It must NOT directly merge/push/promote its own work.

### Architecture
Create a provider-neutral local coding adapter, for example:
- `AyasLocalCodingAgent`
- `AyasCodingTaskContract`
- `AyasCodingSandbox`
- `AyasCodingEvaluation`
- `AyasCodingProposalBridge`

Potential local backends may include reviewed/pinned OpenHands-, Qwen Code-, or equivalent-compatible local agents/models, but AYAS must own the boundary and must not depend on one vendor's cloud.

No backend becomes active merely because it is installed.

### Containment
Coding runs:
- in an ephemeral container/VM or equivalently hard sandbox;
- with only the intended repo/worktree mounted;
- without host credentials;
- network denied by default;
- no access to runtime/production/private-data roots;
- no package install unless separately approved;
- no arbitrary host shell.

### Model qualification
Do not choose the local coding model by reputation.

Build an AYAS-specific qualification suite:
- real historical bugs;
- held-out source changes;
- Graphify tasks;
- memory/retrieval bugs;
- security bugs;
- UI fixes;
- TypeScript refactors.

Track:
- pass@1
- repeated consistency / pass^k
- regression count
- test quality
- latency
- local compute cost
- tool misuse
- scope violations

If the available local hardware/model cannot meet the required quality threshold, local self-development remains `DEGRADED` rather than silently falling back to paid cloud.

---

## Stage 15B — Durable Long-Horizon Agent Runtime

### Why
AYAS has strong recovery primitives, but they are distributed across developer, production and autonomy paths.

For day-scale self-evolution and revenue tasks, AYAS needs one shared durable task contract.

### Goal
A generic durable task runtime that survives:
- process crash;
- Windows reboot;
- network loss;
- local model restart;
- owner waiting hours/days;
- tool timeout;
- duplicate daemon start.

### Model
Use an append-only/event-sourced task journal.

Separate:
- deterministic workflow/orchestration state;
- non-deterministic activities (model/tool/network calls).

Once a model/tool result has been durably recorded, crash recovery must NOT re-run it as if it never happened.

Every side effect has:
- idempotency key;
- current-state re-read;
- attempt identity;
- timeout;
- retry policy;
- terminal/uncertain state.

### Reuse
Generalize existing:
- `AyasWorkflowRecovery`
- execution journal
- reservation/recovery concepts
- Runtime Stability Guard

Do not introduce a paid orchestration dependency just to obtain this behavior.
External engines such as Temporal are reference architectures, not mandatory dependencies.

---

## Stage 15C — Memory Integrity & Context-Poisoning Firewall

### Why
Current memory has:
- governance;
- secret rejection;
- schema validation;
- revision/CAS;
- atomic writes;
- temporal supersession.

It does NOT yet provide a dedicated memory-poisoning/integrity control plane.

### Required controls
For every durable memory:
- provenance/trust class;
- content digest;
- producer identity;
- source evidence reference;
- write policy result;
- security-screen result.

Add:
- suspicious-memory quarantine;
- external-content instruction detection;
- protected memory keys;
- rapid-change/anomaly detection;
- integrity snapshot/manifest;
- known-good rollback;
- read-time trust filtering.

External/web/platform/repository content must never become privileged future instructions merely because it was remembered.

Memory security must be tested after context resets.

---

## Stage 15D — Agent Identity, Capability Leases & Runtime Action Firewall

### Why
AYAS has multiple strong policies, but future live coding agents, MCPs and revenue adapters will increase the number of action surfaces.

### Goal
Every active agent/run receives:
- agent identity;
- owner/delegation identity;
- task identity;
- exact capability set;
- exact resource scope;
- TTL/expiry;
- cost class;
- read/write/financial/production classification.

### Capability lease
A short-lived capability lease is required around sensitive tool/action calls.

A lease:
- cannot be created by model text;
- cannot be widened by tool output;
- expires;
- binds platform/repository/resource;
- can be revoked;
- is logged.

### Global action firewall
All future tools/adapters pass a central pre/post action guard.

Inputs:
- agent identity
- delegated owner identity
- operation
- target resource
- risk
- cost
- current task
- current approval binding

Outputs:
- ALLOW_READ
- ALLOW_BOUNDED_LOCAL
- REQUIRE_OWNER
- DENY

No `ALLOW_AUTONOMOUS_FINANCIAL` state.

---

## Stage 15E — Model / Strategy Lifecycle Manager

### Why
A self-improving AYAS must be able to adopt new local models and strategies without silently degrading.

### Required lifecycle
`DISCOVERED -> PINNED -> QUALIFIED -> SHADOW -> CANARY -> ACTIVE -> DEGRADED -> RETIRED`

For models, prompts, strategies and evaluator versions:
- immutable identity/digest;
- compatibility matrix;
- benchmark version;
- quality score;
- held-out score;
- resource usage;
- security/provenance status;
- rollback target.

### Promotion
A new model/strategy cannot become ACTIVE solely because it is newer.

Required:
- capability eval
- regression eval
- security eval
- local hardware fit
- repeated consistency
- no critical held-out regression

### Canary
First run only on bounded internal tasks.
No production/revenue external write.

If quality/error thresholds regress:
- stop promotion;
- return to last known-good version;
- create finding/proposal.

Phone/local model mutable `main` revisions must be replaced with immutable version/digest binding.

---

## Stage 15F — Durable Observability, Eval Governance & Reliability SLOs

### Why
Current Unified Trace is rich but process-local and bounded/short-lived.

Long-running self-development needs durable, privacy-bounded evidence.

### Durable trace
Persist redacted:
- task
- agent
- model version
- tool/action
- approval binding
- retry
- duration
- outcome
- error code
- relevant evidence digest

Do NOT persist secret/private bodies.

Adopt a stable internal semantic convention compatible in spirit with OpenTelemetry:
- low-cardinality operation names;
- explicit error types;
- end-to-end parent/child correlation.

### Eval governance
Every agent capability uses:
- deterministic graders where possible;
- outcome checks;
- transcript checks where useful;
- model graders only where required;
- periodic owner/human calibration.

Track multiple trials:
- pass@1
- consistency/pass^k
- latency
- failure rate
- retries
- scope violations.

Maintain separate:
- capability suites;
- near-100% regression suites.

Eval definitions themselves are versioned reviewed artifacts.
An agent may not rewrite its grader/benchmark to make itself pass.

### Reliability SLOs
Define SLOs for:
- chat
- memory/retrieval
- coding
- research
- autonomy
- revenue
- runtime

Examples:
- maximum unexplained task loss = 0
- duplicated external writes = 0
- unauthorized writes = 0
- stale-HEAD mutations = 0
- regression gate bypasses = 0

---

## Stage 15G — Software Supply-Chain Provenance & Release Trust

### Why
Stage 9 covers many supply-chain attack paths, but there is no full machine-readable SBOM/provenance/release trust layer.

### Required
Generate a CycloneDX-compatible SBOM for the shipped dependency graph.

For every dependency/model/binary:
- exact version;
- source/provenance;
- integrity digest where available;
- license;
- lifecycle/postinstall script classification;
- known advisory state;
- owner-approved exception if needed.

For every AYAS release/closure:
- Git HEAD;
- lockfile digest;
- SBOM digest;
- model artifact digests;
- Graphify head;
- test matrix digest/report;
- build artifact digest;
- provenance manifest.

Optional online signing (e.g. Sigstore) may be used only when owner-approved and suitable.
Local/offline hash manifests remain mandatory.

No dependency auto-upgrade in the self-improvement loop.

---

## Stage 15H — Autonomy Burn-In & No-Cloud Independence Certification

### Purpose
Prove AYAS can operate safely over long periods before Atölye becomes the main focus.

### Mandatory fault matrix
Test:
- process kill mid-task;
- reboot;
- model process death;
- network unavailable;
- DNS failure;
- API 429/500;
- disk-space exhaustion fixture;
- corrupted state;
- backward/future clock;
- duplicate daemon;
- Graphify stale;
- `.graphify/needs_update`;
- owner decision delayed;
- rejected proposal;
- stale proposal after new HEAD;
- failed regression after patch;
- memory poisoning attempt;
- malicious repo content;
- dependency-install request;
- invalid MCP/tool schema;
- external adapter auth expiry.

### Independence qualification
Run a bank of representative maintenance/development tasks using ONLY approved local resources.

Must prove:
- identify defect;
- local plan;
- safe patch generation;
- tests;
- Graphify;
- proposal;
- owner approval path;
- execution;
- post-execution audit;
- rollback/recovery.

Cloud/Codex/Claude must be disabled for this certification.

### Outcome
`LOCAL_INDEPENDENCE_READY`
only if thresholds pass.

Otherwise:
`LOCAL_INDEPENDENCE_DEGRADED`
with exact missing capability/hardware/model reason.

No fake pass.

---

# Revenue Center additions

## Stage 16.0A — External Account Connection & Credential Boundary

Add before live platform adapters.

Store only connection metadata:
- platform
- account opaque id/digest
- granted scopes
- expiresAt
- last reauth
- connection health

Secrets/tokens:
- OS/server/connector managed;
- never in AYAS memory/revenue ledger/logs;
- revocable;
- minimum scope;
- expiry and scope drift detected.

---

## Stage 16.3A — Offer / Product Factory

A platform-independent sellable-offer object.

Offer types:
- freelance service
- digital product
- course
- media/content asset
- packaged workflow/service

Contains:
- value proposition
- target customer
- exact deliverables
- capability requirements
- rights/licensing
- price scenario
- revision/support policy
- delivery-time scenario
- portfolio evidence
- platform mappings

No offer becomes sellable if AYAS cannot prove it can fulfill the deliverable.

---

## Stage 16.3B — Fulfillment & Delivery Quality Gate

Normalize incoming approved work/order into a bounded fulfillment task.

Flow:
`order/job -> requirements -> plan -> produce -> QA -> delivery manifest -> owner/platform handoff -> observed completion -> ledger`

Required:
- requirement completeness;
- source/licensing checks;
- deterministic/visual/audio quality checks as applicable;
- file hash manifest;
- no unsupported promise;
- revision handling;
- deadline state;
- delivery proof.

AYAS must never sell faster than it can reliably deliver.

---

## Stage 16.11A — Revenue Terms / Compliance Boundary

Before a real platform pilot:
- current platform terms/policies must be checked;
- account standing must be healthy;
- activity must not violate automation restrictions;
- applicable tax/legal obligations are surfaced, not hallucinated.

AYAS does NOT act as tax/legal authority.

Unknown jurisdictional requirement:
`OWNER/PROFESSIONAL_REVIEW_REQUIRED`

This gate prevents “technically possible” automation from being treated as “permitted”.

---

# Optional post-closure revenue expansion

## Stage 16.X — Agentic Commerce Distribution Watch

Monitor:
- OpenAI Agentic Commerce Protocol (ACP)
- Google/industry UCP
- FIDO/AP2 / Verifiable Intent

Purpose:
make AYAS-created digital products discoverable through emerging agentic commerce channels when:
- seller/merchant eligibility exists;
- zero-cost policy allows;
- security/compliance reviewed.

This is an expansion opportunity, NOT a prerequisite for AYAS foundation closure.

---

# Stage 17 closure changes

`FOUNDATION_CLOSED` is prohibited until mandatory Stage 15A–15H additions are implemented and validated.

Stage 17 must explicitly audit:
- local coding independence;
- durable task recovery;
- memory poisoning/integrity;
- agent identity/capability leases;
- action firewall;
- model/strategy lifecycle;
- durable traces/eval governance;
- SBOM/provenance;
- burn-in/fault certification.

Revenue closure must also cover:
- account connection boundary;
- offer factory;
- fulfillment;
- terms/compliance gate.

---

# Brain UI V2 priority

Brain UI V2 remains separate.

It is important for usability, but visual completion must NOT be allowed to hide or delay critical independence/security closure.

Recommended priority:
- implement core hardening first;
- UI branch can proceed in parallel;
- promote UI only after existing functional regression suites remain green.

---

# Final pre-Atölye gate

AYAS is ready to shift primary focus to Atölye only when all are true:

1. Remediation bundle validated.
2. Stage 15 + 15A–15H REVIEW_READY.
3. At least one real narrow improvement strategy is safely registered and demonstrated.
4. Local coding capability passes its qualification threshold or is explicitly marked DEGRADED with no silent cloud fallback.
5. Memory poisoning/integrity suite passes.
6. Generic durable task recovery survives reboot/crash fixtures.
7. Agent identity/action firewall is enforced on every live tool/adapter path.
8. Model/strategy promotion has canary + rollback.
9. Durable observability/eval reports are available.
10. SBOM/provenance manifest generated and verified.
11. Stage 16 Revenue Center + 16.0A + 16.3A + 16.3B + 16.11A framework passes.
12. Stage 17 full audit: BLOCKER 0, unresolved verified MAJOR 0.
13. ∞ Continuous Evolution dry-run passes with cloud providers disabled.
14. Autonomy burn-in/no-cloud independence certification passes.
15. Owner explicitly approves activation.

Only then:
`AYAS FOUNDATION -> CLOSED / CONTINUOUS EVOLUTION ACTIVE`
and main development focus moves to Atölye.

---

# What "no more Codex Cloud" realistically means

Target:
- normal bug fixes, bounded features, refactors, tests, docs and self-improvement can be handled locally by AYAS.

Not a promise:
- every future problem can be solved at frontier-cloud quality with any local model/hardware;
- zero defects forever.

When AYAS cannot meet its own quality threshold, the correct behavior is:
`BLOCKED / NEEDS OWNER OR STRONGER LOCAL MODEL`
—not silently producing lower-quality code and not silently buying cloud compute.

This is a safety feature, not a failure.
