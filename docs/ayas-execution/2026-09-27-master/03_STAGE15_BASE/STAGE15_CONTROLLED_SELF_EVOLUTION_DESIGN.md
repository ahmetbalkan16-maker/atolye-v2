# Stage 15 — Controlled Self-Evolution Pipeline
Prepared against `wip/ayas-graphify-final-execution` @ `035b4076faa1100224c64f4d1ffa3e8346ffc058`

## Goal

Close the missing link:

`Stage 13 opportunity -> current qualification -> registered Stage 8 strategy -> TEMP matched experiment -> verified IMPROVED evidence -> immutable patch-artifact -> ordinary proposal -> owner approval -> existing Package C`

Stage 15 MUST NOT introduce a second approval system, a second mutation engine, direct commit/push authority, paid provider use, production mutation, or bypass Graphify.

## Existing primitives to reuse

- `AyasEvolutionOpportunity` / `AyasEvolutionQualification`
- `mapAyasEvolutionToStage8` / `ayasEvolutionExperimentHypothesis`
- `AyasResearchExperimentRegistry`
- `AyasResearchExperimentSandbox`
- `AyasResearchExperimentEvaluation`
- `AyasResearchExperimentStore`
- `AyasPatchArtifact`
- `AYAS_PATCH_ARTIFACT_MUTATION_KIND`
- `AyasApprovalInboxStore`
- `AyasProposalApprovalService`
- `AyasProposalExecutionService`
- Runtime Stability Guard / Graphify evidence / post-publication closure

## Authority invariants

1. Stage 15 itself has `executionAuthority: NONE`.
2. Only a reviewed, registered strategy may generate a source change.
3. Every experiment runs in the existing OS-TEMP shared clone with origin removed and provider credentials stripped.
4. A patch becomes executable only after:
   - matched baseline reproduced;
   - target improvement >= 1;
   - no newly failing baseline-pass case;
   - held-out pass count does not drop;
   - all declared regression suites pass;
   - exact file/line limits hold;
   - live workspace HEAD and cleanliness are unchanged;
   - sandbox is destroyed;
   - evidence hash verifies;
   - patch artifact is immutable and SAFE;
   - Graphify structural expectations are bound to the artifact;
   - the owner explicitly approves the exact proposal hash / patch hash.
5. No experiment may modify approval, execution-gate, mutation registry, publication, production, secrets, `.graphify`, `.git`, `.env*`, `data/**`, or other protected paths.
6. No auto-approval, no auto-push, no direct production execution.

## Stage 15 sub-stages

### 15.1 Generic experiment execution primitive

Refactor the experiment-specific part currently private inside
`AyasResearchImprovementCycle.ts` into a reusable module:

`src/lib/brain/autonomy/AyasRegisteredImprovementExperiment.ts`

Exports:
- `AyasRegisteredExperimentObservation`
- `AyasRegisteredExperimentSourceBinding`
- `AyasRegisteredExperimentDeps`
- `AyasRegisteredExperimentResult`
- `runAyasRegisteredImprovementExperiment(...)`

Input:
- current full HEAD
- repo clean + Graphify fresh + machine health ALLOW
- already-built `AyasImprovementHypothesis`
- exact registered `AyasImprovementStrategy`
- exact registered `AyasImprovementBenchmark`
- source binding (`RESEARCH_FINDING` or `EVOLUTION_OPPORTUNITY`)
- existing Stage 8 store/budget

It reuses the existing admission, sandbox, matched-baseline, regression, evidence and crash-recovery logic.
`AyasResearchImprovementCycle` becomes a caller of this generic primitive, preserving existing behavior.

### 15.2 Backward-compatible experiment evidence source binding

Extend `AyasExperimentEvidence` additively:

```ts
readonly sourceBindings?: readonly {
  readonly kind: "RESEARCH_FINDING" | "EVOLUTION_OPPORTUNITY";
  readonly id: string;
}[];
```

Rules:
- Existing evidence without `sourceBindings` remains valid.
- Stage 8 writes `RESEARCH_FINDING` bindings in addition to legacy `findingIds/sourceIds`.
- Stage 15 writes exactly one `EVOLUTION_OPPORTUNITY` binding for the opportunity under test, plus any real research findings already present on the hypothesis.
- Evidence hash covers `sourceBindings`.
- Unknown kinds/invalid ids fail verification.
- Never synthesize a research-finding id for a non-research opportunity.

### 15.3 Stage 15 planner/coordinator

New pure/current-truth module:

`src/lib/ayas/evolution/AyasControlledSelfEvolution.ts`

Responsibilities:
- accept a validated Stage 13 register + current `AyasEvolutionEnvironment`;
- re-run `qualifyAyasEvolutionRegister`, never trust a caller-held qualification;
- select only `EXPERIMENT_READY` opportunities;
- require `executionAuthority === "NONE"`;
- require current full HEAD and current gap snapshot;
- require registered strategy and benchmark identities to match the frozen hypothesis;
- deny HIGH/UNKNOWN authority-widening, security, data-mutation, cost or irreversibility;
- deny dependency installs, external service/account, paid resource, production/publish/policy effects;
- deny blocking normalization/instruction signals;
- dedupe by `(opportunityId, hypothesisId, baseHead, registryDigest)`;
- return at most ONE experiment candidate per cycle.

This module is planning only and performs no I/O.

### 15.4 Immutable patch-artifact promotion

The generic experiment runner must retain the exact final contents of changed files in memory before the sandbox is destroyed.

Only after the verdict is verified `IMPROVED`:
- read each changed file from the sandbox;
- build replacements with `expectedHash` derived from the base-HEAD blob;
- destroy sandbox;
- prove live workspace unchanged;
- persist experiment evidence;
- measure/bind Graphify import counts through the same reviewed helper used by patch-artifact proposals;
- freeze ONE `AyasPatchArtifact`.

Artifact identity:
- `candidateId = controlled-evolution:<opportunityId>:<hypothesisId>`
- `generatorIdentity = controlled-self-evolution:v1:<strategyId>@<version>`
- `baseHead = current HEAD`
- `exactFiles = strategy.exactFiles`
- `allowedRoots` derived from exact files, never caller supplied
- `validatorScripts = benchmark + declared regression suites through a reviewed validator mapping`
- `safetyClassification` must be `SAFE`
- `sandboxValidationSummary` records matched baseline, target gain, held-out delta, regressions, evidence hash
- artifact carries no approval.

If artifact freeze fails, there is no proposal.

### 15.5 Proposal bridge

New module:

`src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge.ts`

Only a verified current-HEAD `IMPROVED` evidence + verified SAFE artifact pair can produce a candidate.

Candidate MUST use:
`mutationKind: AYAS_PATCH_ARTIFACT_MUTATION_KIND`

And bind:
- `patchArtifactId`
- `patchHash`
- `sourceReference: opportunityId`
- experiment id/hash
- hypothesis id
- strategy id/version
- current HEAD
- exact files
- target gain / held-out delta / regression proof

The candidate then enters the existing:
`AyasAutonomyDaemon.discover -> ApprovalInbox -> internal review -> owner approval`

Stage 15 never calls `decide`, `reserveApproval`, `executeApproved`,
`approveAndExecuteAyasProposal`, `git commit`, or `git push`.

### 15.6 Discovery daemon wiring

In `scripts/ayas-discovery-daemon.ts`, after Graphify freshness and machine-health observation:
- run Stage 8 research cycle as today;
- load/derive current Stage 13 register through its approved producer/read path;
- run one Stage 15 cycle only when repo clean + Graphify fresh;
- add only resulting proposal candidates to the existing `candidates` list;
- never execute them.

Failure isolation:
- Stage 15 errors add a bounded gap message;
- research, stale reconciliation, static discovery and owner-review continue;
- no partial artifact/proposal may survive a failed bind.

### 15.7 First real strategy

Do NOT begin Stage 15 by registering a broad rewrite strategy.

First strategy should target a currently measured, narrow conversation defect and:
- exactFiles <= 2
- maxChangedLines <= 80
- no new dependency
- no network/provider
- no runtime/production/data paths
- deterministic generator
- deterministic benchmark and regressions
- baseline failing target already exists

Recommended first candidate after Monday validation:
a narrow MEMORY_CONTEXT strategy only if the free-text correction remediation leaves a deterministic, non-held-out failing case.

Registering the first strategy is a separate owner-reviewed commit.

## Files expected to change

Core:
- `src/lib/brain/autonomy/AyasResearchImprovementCycle.ts`
- `src/lib/brain/autonomy/AyasResearchExperimentEvaluation.ts`
- `src/lib/brain/autonomy/AyasResearchExperimentRegistry.ts` (only when first strategy is separately approved)
- `src/lib/brain/autonomy/AyasRegisteredImprovementExperiment.ts` (new)
- `src/lib/ayas/evolution/AyasControlledSelfEvolution.ts` (new)
- `src/lib/ayas/evolution/AyasControlledSelfEvolutionBridge.ts` (new)
- `scripts/ayas-discovery-daemon.ts`

Tests:
- `scripts/smoke-ayas-controlled-self-evolution.ts` (new)
- existing Stage 8, Stage 13, approval, patch-artifact, execution and Graphify regressions

Docs:
- `docs/AYAS_CONTROLLED_SELF_EVOLUTION.md`
- `ROADMAP.md`
- closure checkpoint/changelog as appropriate

## Required evaluator groups

At minimum 60 deterministic cases:

1. qualification/current-truth (10)
2. authority/risk refusal (10)
3. generic experiment compatibility with Stage 8 (8)
4. evidence source binding + tamper (8)
5. artifact exact-content binding (8)
6. proposal/owner authority (8)
7. crash/stale/concurrency/replay (8)

Held-out: >= 10 additional cases frozen before implementation.

Adversarial cases must include:
- forged EXPERIMENT_READY qualification;
- stale Stage 13 register;
- stale gap snapshot;
- strategy version changed after qualification;
- benchmark digest changed;
- sparse/malformed containers;
- sandbox tries to touch `.env`, `.graphify`, data, approval or execution code;
- generated diff contains a secret-like value;
- HEAD changes after experiment;
- worktree becomes dirty after experiment;
- artifact content changed after freeze;
- evidence hash changed;
- proposal patchHash mismatch;
- owner rejects then same attempt is not re-promoted;
- owner approval never inferred from text/log/model output;
- paid/external/production opportunity never reaches executable artifact;
- two daemon ticks do not create duplicate proposals;
- crash after evidence but before artifact;
- crash after artifact but before proposal;
- interrupted experiment reconciliation.

## Closure conditions

Stage 15 can be marked complete only when:
- Stage 8 behavior is regression-identical for research findings;
- Stage 13/14 have no new authority;
- controlled evolution produces no executable proposal without a real registered strategy + IMPROVED evidence + SAFE immutable artifact;
- owner approval remains necessary;
- Graphify is current at final HEAD;
- TypeScript/lint/diff checks pass;
- focused + held-out + adversarial suites pass;
- production/provider/network mutation is zero;
- independent review has BLOCKER 0 / unresolved MAJOR 0.
