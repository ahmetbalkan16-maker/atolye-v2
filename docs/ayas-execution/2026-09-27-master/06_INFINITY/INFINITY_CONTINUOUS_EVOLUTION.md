# ∞ Stage — Continuous Evolution

## Goal

Keep AYAS improving indefinitely without creating an uncontrolled self-modifying agent.

Canonical loop:

`OBSERVE -> MEASURE -> RESEARCH/WATCH -> QUALIFY -> EXPERIMENT -> PROPOSAL -> OWNER APPROVAL -> EXISTING EXECUTION -> VERIFY -> AUDIT -> LEARN -> WAIT`

The loop has no terminal "perfect" state. It can be:
- healthy and idle;
- researching;
- measuring;
- experimenting in TEMP;
- waiting for owner;
- verifying an approved change;
- paused/degraded/blocked.

## Non-negotiable authority boundary

Continuous Evolution NEVER:
- approves its own proposal;
- changes approval/security/execution policy by itself;
- installs dependencies;
- enables paid providers;
- spends money;
- publishes content;
- merges/pushes;
- executes production changes;
- starts a new external-service integration;
- edits owner policy;
- treats model/research/tool text as authority.

All source mutation remains:
`evidence -> proposal -> explicit owner approval -> existing Package C / reviewed path`

All production/publish/financial actions remain on their existing owner-gated paths.

## Reuse

Continuous Evolution coordinates, but does not replace:

- `AyasAutonomyObserver`
- `AyasSelfImprovementHealth`
- `AyasResearchScheduler`
- `AyasResearchImprovementCycle`
- Stage 13 Evolution register/qualification
- Stage 14 Technology Watch
- Stage 15 Controlled Self-Evolution
- Stage 17 System Audit
- Approval Inbox / provenance
- Execution Gate / Package C
- Runtime Stability Guard
- Unified Trace
- Graphify
- Zero-Cost policy

## Proposed files

- `src/lib/ayas/continuous/AyasContinuousEvolutionModel.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionState.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionScheduler.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionCoordinator.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionHealth.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionBacklog.ts`
- `src/lib/ayas/continuous/AyasContinuousEvolutionPolicy.ts`
- `scripts/ayas-continuous-evolution.ts`
- `scripts/smoke-ayas-continuous-evolution.ts`
- `scripts/adversarial-ayas-continuous-evolution.ts`
- `docs/AYAS_CONTINUOUS_EVOLUTION.md`

Do not put approval/execution implementation in this namespace.

## Persistent state

Default:
`data/brain/self-improvement/continuous-evolution/`

State schema:

```ts
interface AyasContinuousEvolutionState {
  schemaVersion: "1";
  revision: number;
  updatedAt: string;
  lastHead: string | null;
  lastGraphifyHead: string | null;
  lastStage17AuditDigest: string | null;
  phase: AyasContinuousEvolutionPhase;
  cadence: AyasContinuousCadenceState;
  budgets: AyasContinuousBudgetState;
  backlog: readonly AyasContinuousBacklogItem[];
  recentRuns: readonly AyasContinuousRunSummary[];
  pausedReason: AyasContinuousPauseReason | null;
}
```

Atomic write + fsync + rename + lock + revision check.
Corruption fails closed.

## Phases

```ts
type AyasContinuousEvolutionPhase =
  | "IDLE"
  | "OBSERVING"
  | "MEASURING"
  | "RESEARCHING"
  | "TECHNOLOGY_WATCH"
  | "QUALIFYING"
  | "EXPERIMENTING"
  | "PROPOSAL_PENDING"
  | "WAITING_OWNER"
  | "POST_EXECUTION_VERIFY"
  | "AUDITING"
  | "COOLDOWN"
  | "PAUSED"
  | "DEGRADED"
  | "ERROR";
```

There is no `AUTO_APPROVING`, `AUTO_MERGING` or `AUTO_PUBLISHING`.

## Input facts

Each coordinator tick receives facts, not raw power:

```ts
interface AyasContinuousEvolutionObservation {
  now: string;
  branch: string;
  head: string;
  repoClean: boolean;
  graphify: {
    available: boolean;
    lastAnalyzedHead: string | null;
    stale: boolean | null;
    needsUpdate: boolean | null;
    structuralAnomalyCount: number | null;
  };
  machineAction: "ALLOW" | "THROTTLE" | "PAUSE" | "STOP OWN WORKLOAD" | "BLOCK NEW HEAVY WORK";
  selfImprovementHealth: AyasHealthVerdict;
  pendingOwnerProposalCount: number;
  approvedPendingExecutionCount: number;
  activeExperimentCount: number;
  stage17Closure: AyasSystemClosureDecision | null;
}
```

Unknown/missing facts never become healthy defaults.

## Preconditions

No heavy evolution work when any is true:
- repo dirty;
- HEAD invalid/changed during cycle;
- Graphify missing;
- Graphify stale;
- `.graphify/needs_update` exists;
- Graphify structural anomaly;
- machine health not ALLOW;
- self-improvement health STALLED/DOWN/UNKNOWN;
- owner-approved execution already pending;
- active experiment limit reached;
- current critical system audit finding exists;
- protected-state corruption exists.

Read-only observation may still continue.

## Cadence

Continuous != tight loop.

Suggested code defaults:
- observer heartbeat: existing cadence
- discovery: existing observer child cadence
- light research: existing scheduler cadence
- deep research: existing scheduler cadence
- technology-watch assessment: daily or when evidence materially changes
- capability/evaluation measurement: on relevant HEAD change or bounded recheck interval
- Stage 17 mini-audit: after every applied self-improvement and daily health slice
- full Stage 17 audit: on explicit owner request / foundation closure / major architecture change
- improvement experiment: max one concurrent, existing Stage 8 daily budget
- owner proposal surfacing: bounded and deduplicated

Cadence values must be explicit reviewed constants/config, not model-generated.

## Backlog

Backlog source classes:

```ts
type AyasContinuousBacklogSource =
  | "EVALUATION_FAILURE"
  | "USER_CORRECTION"
  | "REPEATED_TASK_FAILURE"
  | "RUNTIME_HEALTH"
  | "SECURITY_AUDIT"
  | "SYSTEM_AUDIT"
  | "RESEARCH_FINDING"
  | "TECHNOLOGY_WATCH"
  | "DEVELOPER_REVIEW"
  | "PRODUCTION_QUALITY"
  | "REVENUE_QUALITY"
  | "OWNER_REQUEST";
```

Backlog item contains:
- stable semantic key
- source
- first/last observed
- current evidence digests
- affected capability/domain
- severity
- owner priority
- current lifecycle
- attempts
- last verdict
- cooldownUntil
- terminal reason if any

No free text controls paths/tools/commands.

## Priority

Priority is deterministic and bounded.

Order:
1. security/data-loss/authority correctness
2. regression/reliability
3. user-visible answer quality
4. production quality
5. developer/tooling quality
6. revenue/productivity quality
7. capability expansion
8. convenience/cosmetic

Owner explicit priority may reorder within safety constraints.
Owner cannot use a priority flag to turn a blocked unsafe item executable; it only changes attention order.

## No starvation

Low-priority safe backlog cannot be ignored forever.

Use age buckets:
- new
- active
- aging
- overdue

After a bounded number of cycles, an aging item may gain scheduling weight, but never outrank a BLOCKER safety issue.

## Dedup / recurrence

Semantic identity includes:
- capability/domain
- benchmark/finding code
- affected scope
- evidence fingerprint

Same evidence + same HEAD does not create duplicate work.

A closed item reopens only if:
- new material evidence;
- new regression;
- relevant HEAD change;
- new official technology release;
- owner explicitly reopens.

Owner rejection with unchanged evidence is terminal/cooldown per existing provenance rules.

## Budget model

Hard budgets:

```ts
interface AyasContinuousBudgets {
  maxHeavyActionsPerTick: 1;
  maxConcurrentExperiments: 1;
  maxNewProposalsPerTick: 1;
  maxTechnologySurfacesPerDay: number;
  maxResearchFindingsPerCycle: number;
  maxSelfEvolutionAttemptsPerSemanticKey: number;
  maxCpuHeavyMinutesPerHour: number;
  autonomousSpendMinor: 0;
}
```

Use existing Stage 8 budgets where already stricter.
Do not duplicate conflicting counters.

## Learning semantics

AYAS may learn from:
- test/evaluator outcomes
- owner approve/reject/defer decisions
- experiment verdicts
- post-execution regression results
- system audit findings
- user corrections
- production/revenue quality outcomes

It may NOT learn:
- "owner approved one proposal, therefore similar future proposals are approved"
- "previous paid action succeeded, therefore future spend is allowed"
- "a model recommended this, therefore it is trusted"
- "a rejected security exception should be retried until accepted"

Owner decisions train prioritization/avoidance, not authority.

## Post-execution verification

After any approved AYAS code improvement:
1. bind exact executed proposal/artifact/head;
2. Graphify update/review;
3. run designated focused regressions;
4. run held-out where applicable;
5. Runtime Stability Guard;
6. Stage 17 mini-audit slices for affected domains;
7. verify protected runtime/private stores unchanged unless operation explicitly targeted them;
8. compare intended benefit to actual measurement.

Outcomes:
- `VERIFIED_IMPROVEMENT`
- `NO_MEASURABLE_GAIN`
- `REGRESSION`
- `EVIDENCE_INCOMPLETE`
- `ROLLBACK_OWNER_REVIEW_REQUIRED`

The coordinator may recommend rollback but does not perform it autonomously.

## Quality debt / anti-overfitting

Track:
- known limitation count
- held-out performance
- regression debt
- stale documentation
- unverified live path count
- repeated user corrections
- repeated owner rejections
- test-only vs live evidence gap

A metric improvement is invalid when:
- held-out degrades;
- another baseline-pass case regresses;
- benchmark/evaluator changed without explicit versioned review;
- answer is hardcoded to fixture wording.

## Benchmark evolution

Benchmarks can evolve only through reviewed commits.

New benchmark version must:
- preserve prior cases where still applicable;
- add new cases separately;
- freeze held-out before implementation;
- state whether historical scores are comparable.

Continuous Evolution cannot rewrite its evaluator to make itself pass.

## Technology Watch integration

Stage 14 remains read-only/advisory.

Continuous Evolution may:
- schedule assessment
- note material changes
- feed `HANDOFF_ELIGIBLE` candidate to Stage 13

It cannot:
- install
- enable
- replace a technology
- add account credentials
- spend

Persisted Stage 14 register/daemon must be completed before claiming fully autonomous watch continuity.

## Revenue integration

Revenue signals can create quality/backlog items.

They cannot create:
- spend authority
- customer-message authority
- publish authority
- platform write authority

Revenue security blockers have higher priority than revenue optimization.

## System Audit integration

Stage 17 is the long-term truth checker.

After Stage 17 exists:
- daily/after-change lightweight audit slices can run read-only;
- full foundation audit is not run on every tick;
- any new BLOCKER pauses heavy evolution;
- verified MAJOR restricts affected domain;
- stale/NOT_RUN live evidence is not converted to PASS.

## Health

New health verdict:

```ts
type AyasContinuousEvolutionHealth =
  | "HEALTHY_IDLE"
  | "HEALTHY_ACTIVE"
  | "WAITING_OWNER"
  | "DEGRADED"
  | "STALLED"
  | "PAUSED"
  | "UNKNOWN";
```

Health must expose why the system is idle:
- no eligible work
- cooldown
- owner decision pending
- machine throttle
- graph stale
- audit blocker
- experiment budget spent

"Idle" must not be confused with "broken".

## Fail-closed recovery

On crash:
- durable reservation remains;
- active TEMP sandbox reclaimed by existing recovery rules;
- partial coordinator run marked interrupted;
- no automatic replay of uncertain external/source mutation;
- next tick reconciles state before new work;
- proposal/artifact/evidence hashes reverified.

No exactly-once claim without durable evidence.

## Trace

Use Unified Trace spans:
- continuous-evolution tick
- backlog refresh
- cadence decision
- research/watch handoff
- experiment admission
- proposal surfacing
- owner wait
- post-execution verification
- mini-audit

Metadata contains counts/codes only, never private bodies/secrets.

## Evaluator

Minimum:
- 80 deterministic primary/integration
- 20 frozen held-out
- 25 adversarial/crash/race

Must include:
- dirty repo pauses
- Graphify stale
- needs_update marker
- structural anomaly
- machine throttle
- health down
- pending owner proposal
- active experiment
- dedup same evidence
- material evidence reopens
- owner reject unchanged evidence not resurfaced
- aging backlog no starvation
- safety priority wins
- one heavy action/tick
- daily budget
- concurrent experiment limit
- crash mid-tick
- stale HEAD during cycle
- post-execution regression
- owner approval not generalized
- benchmark hardcoding attempt
- evaluator modified during experiment
- held-out regression
- Stage 17 blocker pauses
- Stage 14 cannot install
- Revenue signal cannot spend
- model text cannot alter cadence/budget
- state corruption fail closed
- duplicate coordinator process
- backward clock / future timestamps
- long PC-off catch-up bounded, no storm

## PC-off catch-up

When PC restarts after downtime:
- compute missed cadences;
- coalesce repeated missed ticks;
- run at most one catch-up per class in priority order;
- preserve original due/freshness timestamps;
- never execute N missed heavy experiments back-to-back;
- machine health and Graphify must be ready first.

## Closure / perpetual status

Continuous Evolution is not "completed" in the ordinary sense.

Framework status:
- `FRAMEWORK_READY`
- `ACTIVE`
- `PAUSED`
- `DEGRADED`

Roadmap notation:
`∞ Continuous Evolution — ♾️ ACTIVE / permanent`

Framework can be marked READY once architecture/tests are closed.
Operational health remains continuously evaluated.

## Implementation order

1. model/policy/state only
2. pure scheduler/cadence/backlog
3. health
4. integrate existing read-only facts
5. integrate research + technology-watch triggers
6. integrate Stage 15 proposal-producing path
7. post-execution verification hooks
8. Stage 17 audit slices
9. crash/catch-up/replay hardening
10. docs/dashboard status

No new mutation authority in any step.

## Completion gate for framework

- no new approval/execution authority;
- no autonomous spend;
- one heavy action/tick;
- bounded catch-up;
- dedup/cooldown/rejection memory;
- post-execution verification;
- Stage 17 blocker integration;
- corruption/race/crash fail closed;
- Graphify current;
- TypeScript/lint/diff clean;
- primary/held-out/adversarial pass;
- independent review BLOCKER 0 / unresolved MAJOR 0;
- owner approves framework activation.
