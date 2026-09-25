# AYAS Open-Ended Evolution Architecture — Stage 13

Status: **✅ COMPLETED.** PR #2 was merged into `wip/ayas-graphify-final-execution` as `4a29c02ad71ee965686c75ef65c6f9f8d6f6ea52`, and the post-merge closure passed (§23).

- Local validation of the first cloud head (`80b15eb`) found 4 MAJOR and 2 related MINOR fail-open defects. All were fixed in the fix round (§21).
- The second local validation, of `351de917`, found present-but-malformed containers silently dropped. This was fixed in the second fix round (§22).
- The owner-side pre-merge validation of the second fix round passed (BLOCKER 0, unresolved MAJOR 0, Runtime/Test Mutation NONE). The local Graphify revalidation and the post-merge sanity and authority checks then passed on `4a29c02` (§23).

Stage 13 lets AYAS represent and reason about improvements and capabilities that were not hardcoded when it was built, under governance. **Open-ended does not mean unbounded autonomy.** Stage 13 represents and plans evolution. It cannot modify source, install anything, call a service, spend money, execute a discovered capability, approve its own proposals, publish, promote experiments, or alter security or execution policy. Owner approval and execution authority stay in the existing inbox, gate and policy modules.

Code (all pure, no I/O except the CLI's single file read):

- `src/lib/ayas/evolution/AyasEvolutionOpportunity.ts`: the canonical opportunity model, normalization, lifecycle transitions, append-only register, supersession, serialization.
- `src/lib/ayas/evolution/AyasEvolutionQualification.ts`: the bounded decision engine (prerequisite graph, conflicts, duplicates, risk/cost/authority derivation, readiness, Stage 8 gap mapping, gated lifecycle).
- `src/lib/ayas/evolution/AyasEvolutionIntegration.ts`: translation into the existing Stage 8 proposal/experiment path, a Stage 10 hand-off draft, and a reader of the existing inbox decision.
- `scripts/ayas-evolution-qualify.ts`: a read-only operator CLI over an explicit JSON file.
- `scripts/smoke-ayas-open-ended-evolution.ts`: the deterministic evaluator.

```
npx tsx scripts/ayas-evolution-qualify.ts --input <register.json> [--json]
npx tsx scripts/smoke-ayas-open-ended-evolution.ts
```

## 1. Existing architecture reused (Phase 1)

| Existing piece | Stage | How Stage 13 uses it | Duplicate avoided |
|---|---|---|---|
| `inventoryAyasCapabilities` / `AyasCapability` | 7 | Tool/skill/model/agent prerequisites resolve against this inventory; its `costClass` and `locality` feed cost and external-service authority | capability registry |
| `AyasCapabilityTaxonomy` | 8 | Optional `knownCategory` link; unknown domains stay `null` | domain enum |
| `AyasResearchExperimentRegistry` (benchmarks, capability map, `selectAyasImprovementStrategy`) | 8 | Decides whether a measured gap has a registered strategy | experiment system |
| `AyasLocalGapSnapshot`, `buildAyasImprovementHypothesis` | 8 | EXPERIMENT_READY carries a real Stage 8 hypothesis object | hypothesis model |
| `detectAyasResearchInstructionSignals`, `neutralizeAyasUntrustedText`, claim token hashes and Jaccard | 8 | Instruction detection, text neutralization, hashed wording similarity | injection filter, similarity |
| `AyasDaemonCandidate` → `AyasAutonomyDaemon.discover()` → `AyasApprovalInboxStore` | M16/8 | PROPOSAL_READY becomes an ordinary candidate with an unregistered mutation kind | proposal system, approval |
| `AyasProposalStructuredImpact` | M-series | Candidate carries structured impact; unmodeled fields stay `unresolved` | impact model |
| `AyasZeroCostPolicy` (`AyasCostClass`, `evaluateAyasZeroCost`) | M-series | Resource cost classes and the aggregate cost decision | cost policy |
| `classifyPatchSet` (`BrainPatchSafety`) | self-heal | Patch-safety level of affected modules | risk classifier |
| `collectAyasChangeAreas`, `describeAyasDeveloperTask`, `redactAyasHandoffText`, `compileAyasTaskPacket` | 10 | Change areas, hand-off task draft, redaction; the evaluator compiles a real packet | task planning |
| `AyasMutationRegistry` | M16 | Not imported by production code; the evaluator proves the new kind is unregistered | execution system |

Not reused because no fit exists: no current store can represent a pre-qualification opportunity (see §12). The inbox holds owner decisions on proposals; the experiment store holds hypotheses and experiment evidence; the external research store holds findings; the goal store holds owner goals. None of them has prerequisites, conflicts, supersession or a pre-proposal lifecycle.

## 2. Opportunity model (Phase 2)

One record, `AyasEvolutionOpportunity` (schema `"1"`), covers gaps, improvements, new capabilities, extensions, replacements and retirements (`kind`).

| Group | Fields |
|---|---|
| Identity | `opportunityId` (`ayas-evo-<hex>`; derived deterministically when absent), `schemaVersion`, `createdAt`, `origin` (producer code path) |
| Need | neutralized `summary`, `affectedCapabilityKeys`, `consequences`; hashed need tokens |
| Evidence | bounded list of typed evidence items (§3) |
| Target | capability descriptor (§4), `intendedOutcome`, `nonGoals` |
| Prerequisites | typed prerequisites (§5) |
| Constraints | closed constraint kinds (§6) |
| Impact | `affectedModules` (repo-relative `src/`, `app/`, `scripts/`, `docs/`), `affectedFlows`, `compatibility` |
| Risk | eight declared dimensions: security, privacy, dataMutation, execution, externalDependency, cost, irreversibility, authorityWidening. Undeclared dimensions are UNKNOWN |
| Evaluation | baseline strategy, Stage 8 benchmark id, acceptance, held-out, regression suites |
| Authority | declared authority classes (can only add) |
| Relations | `supersedes`, `supersededBy`, `replacesCapabilities`, `retiresCapabilities`, `migratesFrom` |
| Lifecycle | state, append-only history, reopen count, `deferredUntil` |
| Safety | detected `instructionSignals`, `normalizationIssues`, constant `authority: "NONE"` |

Normalization fails closed on an invalid id, time, origin, kind, target or schema version, and on a present but malformed lifecycle or carried list. A malformed or over-limit entry is never silently dropped from a safety-relevant list.

**PRESENT + MALFORMED is never ABSENT** (second fix round, §22). An absent field takes its documented default. A present container, text or closed-vocabulary value of the wrong shape — `null` included, an array where an object map belongs, a scalar where a list belongs — is never read as absent. So is a present field this schema does not know (`UNKNOWN_FIELD`), which could be a misspelled safety declaration.

Normalization issues form a **closed vocabulary with a fixed severity** (`AYAS_EVOLUTION_ISSUE_SEVERITY`, 61 codes). A BLOCKING issue means something safety-relevant may have been discarded, truncated or invalidated, and qualification then BLOCKS with `INVALID_SAFETY_DECLARATION` (reference = the issue). The BLOCKING issues cover:

- evidence: an unrecognized source, evidence over its limit, or an evidence list that is not a list;
- safety declarations: prerequisites, constraints, affected modules, replaced or retired capability keys, and authority classes that are invalid or over their limit, and any of their containers in the wrong shape;
- descriptors: an unrecognized capability class, side effect, resource kind, resource cost class or key, or trust level; resources over their limit;
- containers and text: `need`, `target` lists, `impact`, `risk`, `evaluation` and `relations` in the wrong shape, or with an unrecognized compatibility, risk level or baseline strategy; non-string text; a malformed successor id; an unknown field;
- carried state: an unrecognized carried issue code or instruction signal.

An issue code outside the vocabulary also counts as BLOCKING (`isAyasEvolutionBlockingIssue`). An unrecognized class, side effect or resource kind is recorded as the explicit `UNKNOWN` value, never a harmless substitute. A record with any BLOCKING issue lists every authority class as required; none is granted. History longer than its limit is refused, never truncated.

## 3. Evidence and provenance (Phase 3)

Each item carries `source`, a local `reference` identifier (for example `benchmark:<id>#<case>` or `finding:<id>`; never resolved as a path or command), `observedAt`, a neutralized statement, an optional complete benchmark measurement, an optional occurrence count and an optional research finding id.

The epistemic class is **derived**, never declared:

| Source | Class |
|---|---|
| `RESEARCH_RESULT` | always `RESEARCH_CLAIM`, trust `UNTRUSTED_EXTERNAL` |
| `AYAS_SUGGESTION` | always `HYPOTHESIS` ("AYAS thinks this would be useful" is never enough) |
| `OWNER_REQUEST` | `OWNER_REQUEST` only on an `OWNER`-origin record; otherwise `HYPOTHESIS` + `OWNER_REQUEST_NOT_FROM_OWNER` |
| `EVALUATION_FAILURE`, `BENCHMARK_REGRESSION` | `OBSERVED_FACT` only with a complete measurement (benchmark id, dimension, case ids, 40-hex HEAD, 64-hex evaluator digest); else `INFERENCE` |
| `REPEATED_TASK_FAILURE` | `OBSERVED_FACT` needs at least two occurrences and a reference |
| developer, security, user-correction, capability-absence, runtime and production-quality findings | `OBSERVED_FACT` only with a reference on a locally originated record; otherwise `INFERENCE` |

A `RESEARCH_LOOP` record cannot promote its own statements to facts, and neither can an `AYAS_REFLECTION` record. Only a complete local measurement counts. Evidence is sufficient when at least one current `OBSERVED_FACT` or `OWNER_REQUEST` exists. Current means: an observation dated within 180 days (the Stage 8 stale limit) and not in the future, or a measurement taken at the **current HEAD**. Research-only evidence yields `RESEARCH_REQUIRED` (local corroboration needed). Capability-absence evidence that the Stage 7 inventory contradicts does not count.

## 4. Capability representation (Phase 4)

A capability is a descriptor, not an enum entry. It has a bounded dotted `key` and namespaced `domain` (both validated machine keys), an optional closed-taxonomy `knownCategory`, and closed vocabularies:

- `capabilityClass`: TOOL, SKILL, MODEL, AGENT, STORAGE_ADAPTER, EVALUATOR, PIPELINE_EXTENSION, LIBRARY, SERVICE_INTEGRATION, UI_SURFACE, POLICY, OTHER, UNKNOWN. An absent class is `UNKNOWN` (recorded). An unrecognized one, such as a misspelling, the wrong case or `null`, is `UNKNOWN` plus the BLOCKING `CAPABILITY_CLASS_INVALID`. It is never `OTHER`.
- `inputs` / `outputs`: IO kinds (TEXT, AUDIO, VIDEO, IMAGE, STRUCTURED_DATA, SOURCE_CODE, PROJECT_MANIFEST, MEDIA_METADATA, METRIC, DOCUMENT, OTHER)
- `sideEffects`: NONE, READS_LOCAL_FILES, WRITES_LOCAL_FILES, WRITES_RUNTIME_STORAGE, WRITES_SOURCE, NETWORK_READ, NETWORK_WRITE, SPAWNS_PROCESS, INSTALLS_DEPENDENCY, SPENDS_MONEY, PUBLISHES, MODIFIES_POLICY, UNKNOWN (an empty declaration is `UNKNOWN`)
- `resources` with a cost class (§8)
- `trustLevel`: FIRST_PARTY_REVIEWED, LOCAL_UNREVIEWED, THIRD_PARTY, UNKNOWN (absent is `UNKNOWN`; an unrecognized value is `UNKNOWN` plus the BLOCKING `TRUST_LEVEL_INVALID`)

Authority and risk are derived from these structured facts. No free-text field is read as authority. The evaluator exercises domains that appear nowhere in production code: accessibility audio description, a flame-graph developer tool, a local vision model, a storage archive adapter, an evaluation framework, sign-language avatars, and camera-path motion.

## 5. Prerequisite graph (Phase 5)

Kinds: CAPABILITY, TOOL, SKILL, MODEL, AGENT, HOST_BINARY, DATA, PROVIDER_CAPABILITY, EXTERNAL_SERVICE, EXTERNAL_ACCOUNT, OWNER_PERMISSION, OPPORTUNITY. Resolution uses only supplied facts:

- TOOL/SKILL/MODEL/AGENT: the Stage 7 inventory. Not found → `MISSING`; not available → `UNAVAILABLE`.
- HOST_BINARY, DATA, PROVIDER_CAPABILITY, EXTERNAL_SERVICE, EXTERNAL_ACCOUNT: an absent environment entry is `UNKNOWN`, never available. Lookups use own properties only, so `constructor` and `toString` are never inherited.
- CAPABILITY: known key `AVAILABLE` → satisfied; `RETIRED` → retired; provided by an active opportunity → `PENDING_OPPORTUNITY`.
- OPPORTUNITY: follows supersession to the active successor. A rejected dependency is unavailable; a retired one is retired.
- OWNER_PERMISSION: always `OWNER_DECISION_REQUIRED`; the engine never grants it.

Cycles are found with Tarjan SCC over active opportunities (CAPABILITY providers and OPPORTUNITY links, self-loops included) and are BLOCKED. Incompatible prerequisites are BLOCKED:

- requiring a capability the same record replaces or retires;
- requiring a key it declares mutually exclusive;
- requiring a retired capability;
- requiring two capabilities whose providers conflict.

Nothing is installed; a missing installable prerequisite adds `DEPENDENCY_INSTALL_APPROVAL` to the required authorities.

## 6. Compatibility and conflicts (Phase 6)

The constraint kinds are:

- REQUIRES_STORAGE_MIGRATION
- INCOMPATIBLE_WITH_STORAGE_SCHEMA
- CONFLICTS_WITH_APPROVAL_POLICY / EXECUTION_POLICY / SECURITY_POLICY
- INVALID_OFFLINE
- MUTUALLY_EXCLUSIVE_WITH (key or opportunity id)
- BREAKS_BACKWARD_COMPATIBILITY

Replacement is a relation (`replacesCapabilities`). Policy conflicts are BLOCKED (Stage 13 cannot alter policy). Mutual exclusion is symmetric: both opportunities report the conflict and need an owner decision. A conflict with an existing available capability needs one too, unless this record replaces it. Two records replacing the same capability with different targets conflict. Migration or breaking compatibility needs an owner decision and raises data-mutation and irreversibility risk to HIGH. Network need under `OFFLINE` mode is BLOCKED. `INVALID_OFFLINE` under an unknown mode needs an owner decision.

## 7. Risk and derived severity

Declared risk can only be raised. Unknown dominates every known level below HIGH, so derivation never makes a risk look known. Facts that raise risk include:

- side effects: UNKNOWN, source writes and processes, installs, network read/write, runtime-storage writes, publish, policy change, spending;
- unknown or non-zero cost;
- external prerequisites;
- sensitive change areas (authority, execution gate, security, secret);
- `FORBIDDEN_AUTONOMOUS` targets;
- storage/data areas, migration, policy conflicts;
- third-party or unknown trust with real side effects.

## 8. Cost and external resources (Phase 13)

Resource kinds are FREE_LOCAL, PAID_MODEL, PAID_API, EXTERNAL_ACCOUNT, GPU_REQUIRED, HOST_BINARY, NETWORK_REQUIRED, LOCAL_MODEL_WEIGHTS, DISK_SPACE and UNKNOWN. Each carries an `AyasCostClass`; an absent class is `unknown-cost`.

- A paid kind declared free is forced to `paid` and recorded.
- An `UNKNOWN` kind always keeps `unknown-cost`, whatever cost class the producer claims (`UNKNOWN_RESOURCE_COST_DECLARED` is recorded). There is no free or paid assumption without evidence.
- No declared resource means `unknown-cost`; availability never implies free.
- The aggregate is the worst non-zero class, else `unknown-cost` if anything is unknown, else the worst zero class.
- `evaluateAyasZeroCost` decides. Anything but `local-zero-cost`/`free-public` needs an owner cost decision (`COST_UNKNOWN` or `COST_AUTHORIZATION_REQUIRED`).
- No paid call is made anywhere.

## 9. Authority (Phase 14)

Each required authority class maps to an existing owner or policy path (`AYAS_EVOLUTION_AUTHORITY_PATHS`). There are no new approval semantics, and every result carries `authority.granted: "NONE"`, `executionAuthority: "NONE"` and `mayExecute`/`mayInstall`/`maySpend`/`mayPublish: false`.

| Class | Derived from | Existing path |
|---|---|---|
| READ_ONLY | always | the qualification itself |
| SOURCE_MUTATION_APPROVAL | always (implementing any evolution changes the system) | owner inbox + execution gate + a registered mutation kind |
| EXPERIMENT_APPROVAL | existing-benchmark or new-evaluator baseline | Stage 8 strategy registration by a reviewed commit + experiment admission |
| DEPENDENCY_INSTALL_APPROVAL | installs, LIBRARY class, local model weights, uncovered host binary, missing installable prerequisite, any UNKNOWN class/side effect/resource | no AYAS path; owner-controlled install (Stage 9 rules) |
| EXTERNAL_SERVICE_APPROVAL | network effects/resources, external accounts, paid APIs, service integrations, external prerequisites, any UNKNOWN class/side effect/resource | no AYAS path |
| PAID_PROVIDER_APPROVAL | cost not allowed (including unknown) | `AyasZeroCostPolicy` denies; only an owner policy change outside AYAS |
| PRODUCTION_APPROVAL | runtime-storage writes, production-pipeline area, UNKNOWN side effect | production acceptance gate |
| PUBLISH_APPROVAL | PUBLISHES, UNKNOWN side effect | owner-driven publish path |
| SECURITY_POLICY_APPROVAL | policy change/class/conflict, authority or execution-gate area, UNKNOWN class or side effect | reviewed owner commit to the policy module |

The class, side-effect and resource derivations are exhaustive typed tables. An explicit `UNKNOWN` value implies the **union** of every requirement in its vocabulary, so an unknown descriptor can never look less demanding than a real value it might stand for. The one exemption is a HOST_BINARY resource covered by a satisfied host-binary prerequisite.

Every required authority other than READ_ONLY, SOURCE_MUTATION_APPROVAL and EXPERIMENT_APPROVAL blocks PROPOSAL_READY:

- DEPENDENCY_INSTALL, EXTERNAL_SERVICE, PAID_PROVIDER, PRODUCTION and PUBLISH block at OWNER_DECISION_REQUIRED;
- SECURITY_POLICY_APPROVAL blocks at SECURITY_REVIEW_REQUIRED (`SECURITY_POLICY_APPROVAL_REQUIRED`), because a design-review proposal cannot stand in for its reviewed-commit path.

No authority class was added.

## 10. Lifecycle, supersession and retirement (Phase 7)

The states are OBSERVED, INVESTIGATING, QUALIFIED, EXPERIMENT_READY, PROPOSAL_READY, HANDED_OFF, DEFERRED, REJECTED, SUPERSEDED and RETIRED. There is deliberately **no APPROVED or EXECUTED state**. The evaluator checks that terminal states (REJECTED, SUPERSEDED, RETIRED) have no outgoing edge and that every other state can reach one.

Every lifecycle loop passes through a reopen (a return to INVESTIGATING), and reopens are capped at 8. History is append-only and capped at 64, so no loop is unbounded. Gated transitions:

- QUALIFIED needs a current readiness past blocked, duplicate and evidence gates.
- EXPERIMENT_READY and PROPOSAL_READY need the current readiness to say so.
- HANDED_OFF needs the exact Stage 8 hypothesis id or an inbox proposal id, and the readiness must not have drifted.
- SUPERSEDED happens only through `supersedeAyasEvolutionOpportunity`.

Supersession keeps both records, with a two-way link. The register refuses dangling, one-sided or cyclic supersession. Dependents follow the link to the successor. Retirement is its own kind, and it and replacement need an owner decision. A retired capability blocks dependents, and reintroducing it needs an owner decision.

Updates may only advance the lifecycle and append evidence, instruction signals or issues. Declarations are immutable; a changed declaration is a new opportunity that supersedes the old one. Nothing is deleted.

**Lifecycle invariants (`assertAyasEvolutionLifecycle`).** They hold for every record in every register, whether built, updated or parsed. There is no repair: a violating record is refused.

- The history starts with one initial `OBSERVED` entry.
- Each later entry chains from the previous state and is a legal transition in the table, so nothing follows a terminal state.
- Timestamps never go backwards and never precede `createdAt`.
- Each entry has a valid time, reason code and actor (`OWNER`/`AYAS`); a malformed `from`, actor or reference is refused, not coerced.
- The reopen count equals the reopens actually recorded, and stays within its limit. An absent count is derived from the history; a present one is never clamped or reset.
- A HANDED_OFF entry carries its Stage 8 reference: `hypothesis:` from EXPERIMENT_READY, `proposal:` from PROPOSAL_READY. `applyAyasEvolutionTransition` enforces the same shape.
- A SUPERSEDED entry names the recorded successor.
- The state equals the last entry, and only a DEFERRED record carries a deferral date.
- An unknown state value is refused rather than defaulting to OBSERVED.

**Serialization never reduces safety.** Issues and instruction signals are carried across a round trip. Both are closed vocabularies, so a record this module produced never carries more entries than the vocabulary has. A longer carried list is refused (`...never truncated`), and an unrecognized carried entry becomes a BLOCKING issue instead of vanishing. An unrecognized carried signal also keeps `UNTRUSTED_INSTRUCTION_CONTENT`. The proposal-candidate and hand-off builders additionally refuse any record carrying a BLOCKING issue, whatever qualification object they are given.

## 11. Duplicate and overlap detection (Phase 8)

Structural features: target key, domain, kind group (gap and new capability are one group), evidence references, required-prerequisite signature, affected-module set, dependency and succession links. Wording similarity uses Stage 8's hashed token Jaccard and is a reason only.

- **DUPLICATE**: same target, domain and kind group **and** a shared evidence reference, equal prerequisite signature or equal module set.
- **OVERLAPPING**: same target, or same domain with a shared module and a shared evidence reference. Reported, not merged, and does not block.
- **RELATED**: any shared domain, module, reference, dependency or succession link.
- **INDEPENDENT**: otherwise. Similar wording alone gives `TEXT_SIMILAR_ONLY`.

Duplicate clusters use union-find. The canonical record is the strongest by evidence (a measurement at the current HEAD, then any current fact or owner request, then research), then the earliest, then the lowest id. A weak early record can never suppress a strong later one. A duplicate of a REJECTED or RETIRED record needs an owner decision.

## 12. Readiness and the decision engine (Phases 9 and 15)

Readiness is the first level among all blockers, in this order:

1. CLOSED
2. DEFERRED
3. BLOCKED
4. DUPLICATE
5. INSUFFICIENT_EVIDENCE
6. RESEARCH_REQUIRED
7. NEEDS_INVESTIGATION
8. PREREQUISITES_MISSING
9. SECURITY_REVIEW_REQUIRED
10. OWNER_DECISION_REQUIRED
11. EXPERIMENT_READY (no blocker, and a Stage 8 hypothesis exists)
12. PROPOSAL_READY (no blocker)

Every blocker is listed with a closed code and reference, so "interesting" is never conflated with "ready":

- NEEDS_INVESTIGATION covers an inadequate evaluation plan (baseline, acceptance, held-out and regression suites are all required), undeclared modules, unknown compatibility, unknown execution/dependency risk, an unregistered benchmark, a missing measurement at HEAD, and a gap not reproduced at HEAD.
- SECURITY_REVIEW_REQUIRED covers security findings, HIGH or UNKNOWN security/privacy/authority risk (an UNKNOWN capability class raises security risk to UNKNOWN), forbidden targets, sensitive areas, policy modification, process execution and a required SECURITY_POLICY_APPROVAL.
- The engine cannot decide "approved for execution".

## 13. Stage 8 integration (Phase 10)

The chain is: observed gap → opportunity → qualification → **existing** Stage 8 path → owner approval → existing execution system.

- `mapAyasEvolutionToStage8` applies Stage 8's own rule: a registered benchmark, a capability-map entry from the closed taxonomy, and a snapshot at the current HEAD with the same evaluator digest. The failing target cases must be non-held-out ones the opportunity's evidence names. A registered strategy yields a real `AyasImprovementHypothesis` (EXPERIMENT_READY); only Stage 8 admission can run it. Without a strategy, the outcome is Stage 8's `NEEDS_EXPERIMENT_DESIGN`, which is the design-review path (PROPOSAL_READY). The production strategy registry stays empty.
- `buildAyasEvolutionProposalCandidate` produces an ordinary `AyasDaemonCandidate`, for PROPOSAL_READY only, for the existing `AyasAutonomyDaemon.discover()` flow:
  - mutation kind `evolution-opportunity-plan:v1`, **unregistered** (Stage 8's `research-adaptation-plan:v1` posture);
  - a single planning file under `docs/brain/proposals/`;
  - structured impact with licensing `unresolved`;
  - `sourceReference` = the opportunity id.

  The evaluator writes it through the real inbox in OS TEMP. It stays PENDING, `resolveAyasMutation` refuses the kind, and the impact policy keeps it non-executable.
- `readAyasEvolutionOwnerDecision` reads the existing inbox decision bound to the opportunity. `APPROVED_EXTERNALLY` grants Stage 13 nothing.

## 14. Stage 10 integration (Phase 11)

`buildAyasEvolutionDeveloperHandoff` returns an IMPLEMENTATION draft for PROPOSAL_READY/EXPERIMENT_READY, gated on the recorded owner approval. It returns a read-only ANALYSIS draft for NEEDS_INVESTIGATION, RESEARCH_REQUIRED and PREREQUISITES_MISSING, and nothing for anything else.

The mission names only the opportunity id, so external wording cannot steer the Stage 10 classifier. Target, criteria, regression suites, required authority and blockers travel as data lines. The draft gives the arguments for the existing `scripts/ayas-developer-handoff.ts`, with delivery `MANUAL_OWNER_PASTE`, dispatch `NONE` and `startsMutation: false`. The evaluator compiles it into a real Stage 10 task packet (MUST NOT DO section present) without dispatch. No task planning was duplicated.

## 15. Security (Phase 12)

Research-derived candidates are data, not authority. Instruction signals (Stage 8's detector) are scanned on raw text before neutralization. A local-origin text may name a module path; every directive signal still applies. Any signal BLOCKS: no proposal candidate and no hand-off are produced.

Text is neutralized and bounded. References and keys are pattern-bounded identifiers. Origin is set by the producing code path; the CLI's operator is the owner.

The runtime import closure of the three modules is 14 files with only `node:crypto`, `node:fs` and `node:path`. It contains no `child_process`, HTTP/fetch, approval store, execution gate, mutation registry or publication module. The daemon and inbox are imported as types only. `node:fs` arrives transitively through Stage 8's `AyasResearchImprovementLoop` (its `AyasResearchNoveltyStore` URL helper and `AyasDeepAnalysis`); those modules have no import-time side effects, and Stage 13 calls none of their filesystem functions. The evaluator statically checks production files for fixture text, and Stage 10's own test-safety classifier rates the evaluator `SAFE_ISOLATED`.

## 16. Persistence (Phase 17)

**No new store.** Existing stores cannot represent pre-qualification opportunity state (§1), but Stage 13 also has no autonomous producer that would write one: continuous discovery is Stage 14. A store without a writer would be dead weight and an extra root. The register is an immutable value with a versioned, bounded, fail-closed `parseAyasEvolutionRegister`/`serializeAyasEvolutionRegister`, so a later stage can persist it through the existing atomic-write utilities under an explicit root. The CLI reads one explicit operator file and writes nothing.

A record that carries a `lifecycle` is in persisted form. Its lifecycle must be a lifecycle object with its state and a non-empty history. It must also carry its `normalizationIssues` and `instructionSignals`, which are the only memory of losses that cannot be re-detected. Only a fresh producer input omits all three. The register refuses unknown register-level fields. At the register boundary (`createAyasEvolutionRegister`, and again in `qualifyAyasEvolutionRegister`), every in-memory record must have exactly the shape normalization produces (`assertAyasEvolutionRecordShape`), or it is refused (§22).

## 17. Evaluation

Final evaluator SHA-256: `353ce564706eb9b2ec8af102b373931a5eda87454eed0669fd4c3adbcbb00cd2`.

| Run | Primary | Held-out |
|---|---|---|
| Clean `git archive 43a2a17` in OS TEMP (evaluator overlaid, `node_modules` symlink, copy deleted; main worktree never reset) | 54 MISSING | 8 MISSING |
| Final source | 54/54 | 8/8 |

MISSING at baseline is expected: the capability did not exist. The primary set covers:

- all 32 required roadmap scenarios;
- unknown-stays-unknown and prototype-key facts;
- lifecycle graph and gates, append-only history, round-trip serialization, bounds;
- paid-declared-free, offline mode, incompatible prerequisites, stale/undated evidence, contradicted capability absence;
- the TEMP CLI (byte-identical input, `executionAuthority: NONE`, bad input rejected);
- five-way deduplication, determinism and order-independence;
- sensitive areas, duplicate of a rejected record, Stage 8 HEAD/evaluator binding, invalid identity;
- the anti-hardcoding scan.

The eight held-out scenarios were written down before the production code existed and passed on the first run without tuning:

- a new domain with a missing external service;
- supersede-one/conflict-with-another;
- an owner request with an inadequate plan;
- an unavailable host binary;
- malicious research text;
- an evaluator with an undeclared cost;
- a weak earliest duplicate;
- similar wording across unrelated problems.

Count history: 52 primary at first run. Three test-design errors were corrected, not production logic: a register fixture that really was a duplicate, a history-bound test that the reopen cap reaches first, and a doc-comment example matching a fixture domain. Review then changed the tool scenario and added two primary regression cases (54), each of which could not pass on the pre-fix source. The pure qualification of the 500-record register limit takes about 0.36 s.

Regressions (no existing source file changed; reused contracts pinned), with Stage 10 safety classes:

| Suite | Result | Safety class |
|---|---|---|
| Stage 8 research-improvement loop | 36 decision + 55 integration | SAFE_ISOLATED |
| Stage 7 agentic routing | 41/41, held-out 5/5 | SAFE_READ_ONLY |
| Stage 10 developer intelligence | 39 flow + 61 component + 14 integration; the documented pre-existing held-out miss unchanged | SAFE_ISOLATED |
| zero-cost policy | 8 | manually reviewed pure |
| proposal impact policy | 27 | SAFE_ISOLATED |
| Stage 12 director readiness | 53 + 8 | SAFE_ISOLATED |
| proposal terminal-state dedup | 19 | SAFE_ISOLATED |

TypeScript `--noEmit --incremental false`, changed-file ESLint `--max-warnings 0` and `git diff --check` pass. The repository `data/` fingerprint was identical before and after. There was no network, paid provider, live runtime or deployment. `smoke-ayas-observer-autostart.ts` was not run.

## 18. Review

- **Pass 1** fixed the following:
  - two MAJOR fail-open paths: malformed or over-limit prerequisites, constraints or modules were silently dropped, and over-limit history was truncated;
  - unknown side effects and resources were dropped instead of becoming UNKNOWN;
  - an old-HEAD measurement or a future-dated observation counted as current;
  - a host-binary resource forced install approval even when available, while process execution got no security review;
  - the choice of closed duplicate depended on register order.
- **Pass 2** fixed two more MAJOR fail-open paths: serialization dropped normalization issues, and `update` could rewrite declarations or clear instruction signals.
- No remaining BLOCKER or MAJOR.

## 19. Graphify: cloud vs local

The cloud container has no Graphify CLI, and `.graphify/` is gitignored, so there is no graph here. Graphify was **not** run and no Graphify validation is claimed. Discovery used committed docs and bounded direct source inspection. **LOCAL_GRAPHIFY_REVALIDATION_REQUIRED** before promotion:

```
graphify update --scope all --no-description --no-label .
npx tsx scripts/ayas-graphify-status.ts
graphify review-analysis --files src/lib/ayas/evolution/AyasEvolutionOpportunity.ts src/lib/ayas/evolution/AyasEvolutionQualification.ts src/lib/ayas/evolution/AyasEvolutionIntegration.ts scripts/ayas-evolution-qualify.ts scripts/smoke-ayas-open-ended-evolution.ts --graph .graphify/graph.json
```

Expected: no edge from the evolution modules to approval, execution-gate, mutation-registry, publication, process or network modules.

**Resolved locally after the merge; see §23.**

## 20. Boundaries and limitations

- **Stage 14 boundary.** No technology watch, fetch, scheduler or discovery daemon. Stage 13 can say `RESEARCH_REQUIRED`; it never researches.
- **Stage 15 boundary.** No self-modification, source write, automatic PR, mutation or self-approval. EXPERIMENT_READY and PROPOSAL_READY are the ceiling.
- **Brain.** Stage 11 is unchanged. There is no persisted register to read, so a Brain tile would advertise an unmeasured value.
- **Limits:**
  - environment facts come from the caller;
  - duplicate detection is structural and lexical-hash based, not semantic understanding;
  - licensing is not modeled (always `unresolved` in structured impact);
  - `origin` trust assumes the producer sets it honestly; a future Stage 14 producer must hardcode `RESEARCH_LOOP`;
  - owner-written text containing directive wording also blocks (fail-closed);
  - the CLI is the only operator surface.

## 21. Local-validation fix round (PR #2)

Owner-side local validation of cloud head `80b15ebec7661c388dff04463372761f620224fe` failed with **4 MAJOR** fail-open defects. All four, plus the two related MINORs, are fixed on the same branch. Development and every pre-fix run used isolated scratch `git worktree`s (one detached at `80b15eb` for the pre-fix runs, one for the fix). The canonical checkout was never switched and the observer/daemon was never started.

| Defect | Pre-fix behavior (80b15eb) | Fix |
|---|---|---|
| MAJOR 1: security evidence silently dropped | security evidence at index 24, or a source spelled `SECURITY_FINDNG`, left only a non-blocking issue → PROPOSAL_READY; `addAyasEvolutionEvidence` with a bad source returned the record unchanged | `EVIDENCE_TRUNCATED`/`EVIDENCE_SOURCE_INVALID` are BLOCKING; append records the loss; builders refuse any record with a BLOCKING issue |
| MAJOR 2: round trip clears a block | 64 carried codes + `PREREQUISITE_INVALID`: BLOCKED → serialize → parse → PROPOSAL_READY (reload kept the first 64 sorted codes) | closed issue/signal vocabularies; over-long carried lists refused, unknown entries BLOCKING; no truncation anywhere in the round trip |
| MAJOR 3: load accepts invalid history | REJECTED→OBSERVED, direct HANDED_OFF, backwards time, reset/clamped reopen count, misspelled state → loaded as active (PROPOSAL_READY) | `assertAyasEvolutionLifecycle` on parse and on every register build/update; strict entry parsing |
| MAJOR 4: bad capability class → OTHER | `library`, `SERVICE_INTEGRATON`, `POLICIES` → OTHER → authority dropped → PROPOSAL_READY | explicit `UNKNOWN` + BLOCKING `CAPABILITY_CLASS_INVALID`; UNKNOWN class/side effect/resource derives the union of its vocabulary's authorities; misspelled side effect/resource kind also BLOCKING |
| MINOR: SECURITY_POLICY_APPROVAL | POLICY class alone → PROPOSAL_READY | blocks at SECURITY_REVIEW_REQUIRED; no new authority |
| MINOR: UNKNOWN resource zero-cost | `{kind: UNKNOWN, costClass: local-zero-cost}` → aggregate local-zero-cost → PROPOSAL_READY | UNKNOWN kind keeps `unknown-cost` |

A PASS 1 finding in the same class was also fixed: invalid or over-limit `replacesCapabilities`/`retiresCapabilities` keys silently removed the retirement owner decision and replacement conflicts. They are now BLOCKING. A PASS 2 finding was fixed as well: an unrecognized carried signal kept the record BLOCKED but lost `UNTRUSTED_INSTRUCTION_CONTENT`.

**Evaluator.** `scripts/smoke-ayas-open-ended-evolution.ts` was extended, not duplicated. It keeps the 54 original primary and 8 original held-out scenarios (held-out unchanged) and adds a separate `regression` group of 20 scenarios (R01–R20), for **82 total**:

- MAJOR 1: R01–R03
- MAJOR 2: R04–R06
- MAJOR 3: R07–R12
- MAJOR 4: R13–R16
- MINOR 1: R17
- MINOR 2: R18
- PASS 2 combinations: R19–R20 (invalid class + unknown paid resource + truncated/misspelled security evidence + reload, over all 15 perturbation subsets)

Two original primary scenarios changed, both made stricter:

- Scenario 38's third assertion seeded a history (63 × `null→OBSERVED`, then an unchained DEFERRED) that is not a legal lifecycle. It now asserts that load **refuses** it, and still checks the transition-level history limit on the same history held in memory.
- Scenario 52's anti-hardcoding needle list now also includes every malformed value the regression group feeds in.

| Run (isolated worktrees) | Primary | Held-out | Regression |
|---|---|---|---|
| pre-fix `80b15eb` sources + fix-round evaluator | 53/54 (38 fails on its new load-refusal assertion) | 8/8 | **0/20** (every scenario fails) |
| fixed sources | 54/54 | 8/8 | 20/20 |

A seeded pass-2 fuzz (scratch only, not committed) ran 3 seeds × 4,000 random records with injected misspelled sources, classes, side effects and resource kinds, over-limit evidence, random cost claims and declared authorities. Every injected malformed value blocked. No record with an UNKNOWN descriptor, a non-baseline required authority, disallowed cost or security evidence reached PROPOSAL_READY. Every round trip was equal or stricter and idempotent.

Fix-round evaluator SHA-256: `349eb542cf5b0e7eddeca4927bbafc2315dbef02e9421ddfdc92dfa758e2cd12`.

Regressions, re-run on the fixed sources in the isolated worktree:

| Suite | Result |
|---|---|
| Stage 13 evaluator | 54/54 + 8/8 + 20/20 |
| Stage 8 research-improvement loop | 36 decision + 55 integration |
| Stage 7 agentic routing | 41/41, held-out 5/5 |
| Stage 10 developer intelligence | 39/39 flow, 14/14 integration; the documented pre-existing held-out miss `heldout-closure-written` unchanged |
| zero-cost policy | 8 |
| proposal impact policy | 27 |
| proposal terminal-state dedup | 19 |
| Stage 12 director readiness | 53 + 8 |

The Stage 8 loop exited 1 once during a sequential batch run; its output was not captured. It then passed twice in isolation. Nothing outside `src/lib/ayas/evolution/` and its two scripts imports the changed modules, so that run is reported, not attributed. TypeScript, changed-file ESLint `--max-warnings 0` and `git diff --check` pass. `smoke-ayas-observer-autostart.ts` was not run.

**Still deferred (documented, not widened):** research-loop benchmark evidence cross-check hardening, one-sided `supersedes` relationship, proposal-candidate display provenance label, semantic verification of HANDED_OFF proposal references (only the reference shape is checked), and IO/criteria truncation issue reporting.

**LOCAL_GRAPHIFY_REVALIDATION_REQUIRED** still applies (§19); the cloud container has no Graphify.

## 22. Second fix round (PR #2): malformed containers fail closed

The owner's second local validation of fix-round head `351de917f7064c6eef0a117a31b3d2579abea671` failed with one unresolved MAJOR class: **present but malformed containers were silently dropped**. The defect was already in the original `80b15eb`. It is fixed on the same branch, and no authority was added.

Pre-fix runs used an isolated TEMP `git worktree` detached at `351de917`, and regressions ran in a second TEMP worktree. The canonical `wip/ayas-graphify-final-execution` branch was not touched, and `smoke-ayas-observer-autostart.ts` was not run.

**Root cause.** The normalizer read containers with truthy or shape coercion instead of schema validation: `input.lifecycle ?? {}`, `Array.isArray(value) ? … : []`, `value ?? {}`, `oneOf(…) ? value : default`. A present value of the wrong shape (a string, number, boolean, `null`, an array where an object belongs, or an object where a list belongs) read exactly like an absent one, and nothing was recorded. The result was a fresh `OBSERVED` lifecycle, an empty list or a default enum. `lifecycle: "REJECTED"` revived an owner-rejected record as a fresh OBSERVED record, which could then reach PROPOSAL_READY.

The same coercion existed in four more places:

- the register boundary: in-memory records were only lifecycle-checked, so a string `declaredAuthority` was spread into characters and the authority was lost;
- the environment facts: a malformed fact map read as "no facts";
- the operator CLI: malformed facts were filtered out and unknown fields were ignored;
- text fields: a non-string summary or statement escaped the instruction scan entirely.

**The rule now.**

| The field is | Result |
|---|---|
| absent | its documented default (fresh OBSERVED lifecycle, empty list, UNKNOWN or NONE value) |
| present and valid | normalized |
| present, wrong shape, `null` included, for the lifecycle, a carried list, the target or the register | **refused**; nothing is rebuilt |
| present, wrong shape or unrecognized value, anywhere else | a **BLOCKING** issue that names the field |
| present under a field name the schema does not know | BLOCKING `UNKNOWN_FIELD` (it could be a misspelled safety declaration) |

`null` is never read as absent for a container or a text field. For nullable scalars (reference, observed time, benchmark, occurrences, finding id, known category, IO/resource/constraint keys, benchmark id, successor, deferral date, history `from`/`reference`) it means "none". Malformed provenance scalars (observed time, occurrence count, finding id) and IO keys are RECORDED; they can only make evidence weaker or drop a descriptive key.

**Fields audited** (PASS 1). The container fields are listed first, then the scalars found by the systematic audit.

| Field | On `351de917` | Now |
|---|---|---|
| `lifecycle` as string, array, number, boolean, `null`, `{}`, or without state/history | fresh OBSERVED record; a REJECTED record came back as PROPOSAL_READY | refused |
| `normalizationIssues` / `instructionSignals` as `null` | read as `[]`; a carried block or directive was cleared | refused. A persisted record (one with a lifecycle) must carry both |
| `evidence` not a list | `[]`; a security finding vanished (INSUFFICIENT_EVIDENCE, then PROPOSAL_READY after one appended item) | `EVIDENCE_MALFORMED` |
| `prerequisites`, `constraints`, `requiredAuthority` not lists | `[]` → PROPOSAL_READY | `PREREQUISITES_` / `CONSTRAINTS_` / `AUTHORITY_MALFORMED` |
| `relations` not an object, or any of its five lists not a list | defaults; retirement and replacement restrictions lost | `RELATIONS_MALFORMED` |
| `relations.supersededBy` malformed | RECORDED, PROPOSAL_READY (a well-formed one on a non-SUPERSEDED record is refused) | `SUPERSEDED_BY_INVALID` is now BLOCKING |
| `need` not an object; `summary`, `consequences`, `affectedCapabilityKeys` malformed | defaults; text escaped the scan | `NEED_MALFORMED` / `TEXT_MALFORMED` |
| `target` / `target.capability` not objects | refused (by the key check) | refused (explicit) |
| `target.nonGoals`, `capability.inputs`/`outputs` not lists; `knownCategory` not a string | `[]` / `null` | `TARGET_MALFORMED` |
| `capability.sideEffects` not a list | UNKNOWN, recorded only as undeclared | UNKNOWN + `SIDE_EFFECTS_MALFORMED` |
| `capability.resources` not a list | `[]`: resource authorities and the offline need were lost | one explicit UNKNOWN resource + `RESOURCES_MALFORMED` |
| resource `costClass` / `key` malformed | `unknown-cost` / `null` | `RESOURCE_FIELD_INVALID` |
| `trustLevel` unrecognized; `capabilityClass: null` | UNKNOWN / undeclared | `TRUST_LEVEL_INVALID` / `CAPABILITY_CLASS_INVALID` |
| `impact` not an object; its lists not lists; `compatibility` unrecognized | defaults; a sensitive module read as "undeclared" | `IMPACT_MALFORMED` |
| `risk` not an object, or a level unrecognized | UNKNOWN | UNKNOWN + `RISK_MALFORMED` |
| `evaluation` not an object; lists not lists; `baselineStrategy` unrecognized | defaults (`EXPERIMENT_APPROVAL` dropped) | `EVALUATION_MALFORMED` |
| any text field or text-list item that is not a string | `""`, not scanned | `TEXT_MALFORMED`, and the value is scanned as untrusted JSON text |
| prerequisite `optional` not a boolean | required | still required + `PREREQUISITE_INVALID` |
| constraint `key` malformed (non-exclusive kind) | `null` | constraint kept + `CONSTRAINT_INVALID` |
| benchmark with a malformed case id | the id was dropped and it was still a fact | incomplete measurement (INFERENCE) |
| evidence `observedAt` / `occurrences` / `researchFindingId`; IO `key` | `null` | `EVIDENCE_FIELD_INVALID` / `IO_KEY_INVALID` (RECORDED) |
| unknown or misspelled field at any level, including a register written with `JSON.stringify` instead of the serializer (`declaredAuthority` in place of `requiredAuthority`) | ignored; the authority requirement was lost | `UNKNOWN_FIELD` |
| unknown register-level field | ignored | refused |
| in-memory record at `createAyasEvolutionRegister` / `qualifyAyasEvolutionRegister` | only its lifecycle was checked; a register literal skipped even that | full shape and vocabulary check (`assertAyasEvolutionRecordShape`), refused |
| transition request `actor` / `deferredUntil` malformed | `AYAS` / `null` | refused |
| environment: fact maps, capabilities (`available`, `locality`), operating mode, HEAD, registry, gap snapshots | a malformed map read as "no facts" (a RETIRED, AVAILABLE or OFFLINE fact was lost) | refused (`AYAS_EVOLUTION_ENVIRONMENT_INVALID`) |
| CLI input and environment | malformed facts filtered, unknown fields ignored, over-long lists truncated | exit 2 |

**Lifecycle fix.** `normalizeLifecycle` builds the fresh OBSERVED lifecycle only when `lifecycle` is absent. A present one must be a plain object with a recognized state and a non-empty, valid history, or the record is refused. It is never rebuilt. `REJECTED`, `DEFERRED`, `HANDED_OFF`, `SUPERSEDED`, `RETIRED`, the reopen count and the history can therefore not be reset by a malformed lifecycle. `assertAyasEvolutionLifecycle` still validates the whole chain.

**Structured field fix.** The normalizer now reads fields only through shape-checked helpers (`objectField`, `arrayField`, `enumField`, `nullableField`, `textField`, `closedFields`); none uses truthy/falsy coercion. `isAyasEvolutionPlainObject` accepts only a JSON-style object map, so arrays, `null`, `Map`s and class instances do not count.

**Restrictions are kept, not just blocked.**

- A record with any BLOCKING issue lists **every authority class as required**. This is the UNKNOWN union applied to the whole record, so a malformed declaration can never show a smaller authority set than any well-formed one. `granted` stays `NONE`, `mayExecute`/`mayInstall`/`maySpend`/`mayPublish` stay `false`, and no authority class was added.
- A malformed resource list becomes one UNKNOWN resource, and an unreadable side-effect list becomes UNKNOWN.
- A malformed `optional` flag keeps its prerequisite required, and a malformed constraint key keeps its constraint.
- A directive stays detectable when it is hidden in a malformed text shape, under an unknown field, or in an evidence item refused for its source. The instruction scan reads such values as untrusted JSON.
- **Cross-record:** a record with a BLOCKING issue cannot prove it is structurally different. The same target, domain and kind group is enough for DUPLICATE, so a garbled REJECTED record still stops its own revival (`PREVIOUSLY_REJECTED`).
- An EXISTING_BENCHMARK plan whose category Stage 8 cannot map (absent, future or misspelled) is NEEDS_INVESTIGATION (`BENCHMARK_NOT_MAPPED_TO_TARGET`). A misspelled category can no longer skip the current-HEAD measurement gate. An unrecognized category name on its own stays RECORDED, so scenario 22's future domain is unchanged.

**Evaluator.** `scripts/smoke-ayas-open-ended-evolution.ts` was extended, not duplicated, with a separate `container` group C01–C27, bringing the total to **54 primary + 8 held-out + 20 regression + 27 container = 109**. The held-out scenarios are unchanged. The only change to an existing scenario is that scenario 52's anti-hardcoding needles now also include every malformed name and value the container group feeds in, which makes it stricter.

- C01–C13: the required cases (lifecycle as string, array, number; constraints as object and string; prerequisites; required authority; replaced and retired capabilities; instruction signals; evidence; resources; affected modules). Each case asserts the malformed form is never weaker than the well-formed declaration it garbles.
- C14–C23: the other shapes found by the audit (object containers, remaining lists, text, closed-vocabulary scalars, unknown fields, carried state, the in-memory register boundary, environment facts, the CLI, the category and benchmark gate).
- C24: bounded shape matrix. 47 fields × {string, number, boolean, object, array, null} minus the accepted shapes, in fresh and persisted form, for 443 cases. Each must be refused, or BLOCKED with every authority required, release nothing and reload no weaker.
- C25: round trip. Twelve blocked records keep their issues exactly across serialize → parse, and a second trip is a fixed point. REJECTED, DEFERRED, RETIRED, HANDED_OFF, SUPERSEDED and reopened records with a malformed lifecycle are refused.
- C26: adversarial combinations. All 32 subsets of {malformed lifecycle, malformed constraints, unknown resource, malformed capability class, truncated security evidence} are loaded and reloaded. Every non-empty subset is refused (exactly when it includes the lifecycle) or BLOCKED. Adding one more corruption never loosens the result.
- C27: a garbled REJECTED record still stops its revival.

| Run (TEMP worktrees, same evaluator, SHA-256 `5acb6303690d099a6c0fafd41c71abd4159973b6069808a38a298192ab31e47b`) | Primary | Held-out | Regression | Container |
|---|---|---|---|---|
| `351de917` sources | 54/54 | 8/8 | 20/20 | **0/27**: every scenario fails with the fail-open outcome (PROPOSAL_READY, a fresh-load lifecycle, CLI exit 0) |
| fixed sources | 54/54 | 8/8 | 20/20 | 27/27 |

The 14 required cases on `351de917` behaved as follows:

- **PROPOSAL_READY:** lifecycle as string, array or number (a REJECTED record came back as OBSERVED), constraints as object or string, prerequisites as object, required authority as object or string, replaced or retired capabilities as a string, and instruction signals as `null`.
- **INSUFFICIENT_EVIDENCE:** evidence as an object (the security finding vanished).
- **OWNER_DECISION_REQUIRED:** resources as an object (paid API dropped).
- **NEEDS_INVESTIGATION:** affected modules as a string (the sensitive module vanished).
- **Already refused:** instruction signals as an object or a string.

On the fixed sources, all 14 are refused or BLOCKED with the field's issue.

**Fuzz** (scratch only, not committed). Three seeds × 3,000 records, each with 1–4 corruptions drawn from a 248-entry catalogue (the matrix plus misspelled fields and values), in fresh and persisted form over four base shapes, gave 8,883 corrupted records:

- **Fixed sources:** 2,027 refused, 6,856 BLOCKED, **0 violations**. The checks were: never above BLOCKED, `INVALID_SAFETY_DECLARATION` present, every authority required, no candidate or hand-off even with a forged PROPOSAL_READY, never laxer or with fewer authorities than the uncorrupted base, reload no weaker, reload a fixed point.
- **`351de917` sources:** 7,281 violating records; 728 reached PROPOSAL_READY outright.

**Regressions** (fixed sources, isolated worktree; `data/` fingerprint identical before and after):

| Suite | Result |
|---|---|
| Stage 13 evaluator | 54/54 + 8/8 + 20/20 + 27/27 |
| Stage 8 research-improvement loop | 36 decision + 55 integration |
| Stage 7 agentic routing | 41/41, held-out 5/5 |
| Stage 10 developer intelligence | 39/39 flow, 61/61 component, 14/14 integration; the documented pre-existing held-out miss `heldout-closure-written` is unchanged |
| zero-cost policy | 8 |
| proposal impact policy | 27 |
| proposal terminal-state dedup | 19 |
| Stage 12 director readiness | 53 + 8 |

TypeScript `--noEmit --incremental false`, changed-file ESLint `--max-warnings 0` and `git diff --check` pass.

**Review.**

- **PASS 1** audited every normalization and deserialization path for "present malformed → silently omitted or defaulted": the record normalizer, evidence, benchmark, IO, resources, prerequisites, constraints, risk, evaluation, relations, lifecycle and history, carried lists, the register parse and boundary, transitions, evidence append, the environment and the CLI. Every coercion found is now refused or BLOCKING, or it is RECORDED and only weakens evidence (table above).
- **PASS 2** checked that malformed data can only block, reject, or stay unknown and review-required:
  - C24–C27 and the fuzz found no path to a laxer readiness, fewer required authorities, a released candidate or hand-off, or a reload that loosens.
  - Cross-record effects were reviewed:
    - A garbled record's lost exclusions or replacements cannot restrict another record, but the garbled record itself cannot proceed.
    - Its lost prerequisite edges leave its dependents PREREQUISITES_MISSING.
    - A garbled successor's `supersedes` makes the register refuse the one-sided link.
    - A garbled closed record still blocks its duplicate (C27).

**Still deferred (documented, not widened):**

- **Key deletion in persisted form.** A persisted record whose lifecycle *and* carried lists are all deleted is indistinguishable from a fresh producer input. So is a valid-looking edit, such as `constraints: []`. Tamper evidence for persisted records needs the Stage 14 persisted store, with its own integrity. Deleting only the carried lists from a record that keeps its lifecycle is refused.
- IO, criteria and benchmark case-id truncation reporting (descriptive and not safety-bearing; the raw instruction scan already reads every item).
- Carried over from the first round: the research-loop benchmark cross-check, the one-sided `supersedes`, the candidate provenance label, and semantic HANDED_OFF verification.
- Out of Stage 13's scope: inbox proposal status parsing (`readAyasEvolutionOwnerDecision`) and Stage 8's own snapshot and registry typing (Stage 13 now refuses a malformed snapshot or registry container at its own boundary).

**LOCAL_GRAPHIFY_REVALIDATION_REQUIRED** still applies (§19). The cloud container has no Graphify CLI or module, and `.graphify/` is absent (gitignored), so no Graphify result is claimed. *(Resolved after the merge; see §23.)*

## 23. Post-merge closure

**Result: Stage 13 ✅ COMPLETED.** Stage 14 has not started.

**Merged head.** PR #2 (`cloud/stage13-open-ended-evolution`, head `c1cea1103c77d1b105674f7996b42effb6b3f21e`) was merged into `wip/ayas-graphify-final-execution` as `4a29c02ad71ee965686c75ef65c6f9f8d6f6ea52`, with parents `43a2a17` and `c1cea11`. At the start of the closure:

- the checkout was on that branch at that head;
- local HEAD, the tracking branch and the real remote were all equal (ahead/behind 0/0);
- the worktree was clean.

The owner-side pre-merge validation had already passed (BLOCKER 0, unresolved MAJOR 0, Runtime/Test Mutation NONE).

**Graphify.** The graph was refreshed with `graphify update --scope all --no-description --no-label .` (Graphify 0.17.1, 1,370 included files, no scope warnings). `scripts/ayas-graphify-status.ts` and a direct read of `graph.json` then gave:

| Check | Result |
|---|---|
| `lastAnalyzedHead` / `graph.built_from_commit` / provenance `source_hash` | all `4a29c02` |
| `stale` | `false` |
| Worktree | CLEAN |
| Nodes / edges / communities | 15,158 / 43,875 / 317 |
| Duplicate node IDs / duplicate edges / dangling edges / self-loops | 0 / 0 / 0 / 0 |
| Classification | `GRAPH_PARTIAL`, unchanged. It still covers only the documented 7 `.ps1` files (`tree-sitter-powershell` is not installed) plus `app/api/assets/thumbnails/[slug]/[fileName]/route.ts` |
| Semantic marker | PENDING (pre-existing; no paid semantic run) |

Every Stage 13 file has nodes: 130 in `AyasEvolutionOpportunity.ts`, 53 in `AyasEvolutionQualification.ts`, 12 in `AyasEvolutionIntegration.ts`, 15 in the CLI and 4 in the evaluator.

**`review-analysis`** (§19 command) rates the blast radius "high" (score 128), but that rating comes from community spread:

- The only impacted files are the five Stage 13 files.
- All eight bridge nodes are inside `AyasEvolutionOpportunity.ts`.
- The three impacted communities (111, 36, 66) are 90–99% Stage 13 nodes. Their names ("Audio Compensation & Publication Storage", "Export Package Engine", "Portable No-Clobber File Publisher") are stale semantic labels left over from older community IDs, not coupling.
- Its test-gap hints miss the evaluator, which is itself a smoke script.

**Authority, rechecked after the merge.**

- **Graph edges.** Graph edges from Stage 13 nodes reach 15 files. The only ones in approval or daemon modules are the `import type` of `AyasInboxProposal` (`AyasApprovalInboxStore.ts`) and of `AyasDaemonCandidate` (`AyasAutonomyDaemon.ts`), which are erased at runtime.
- **Runtime imports.** The runtime (non-type) import closure of the three library modules is 14 files. Its only externals are `node:crypto`, `node:fs` and `node:path`. It contains no approval, execution-gate, mutation-registry, publication, pipeline, production, daemon, process or network module.
- **Importers.** Only `scripts/ayas-evolution-qualify.ts` and the evaluator import `src/lib/ayas/evolution/`. No app route, daemon or gate does.
- **Mutation kind.** `evolution-opportunity-plan:v1` appears only in `AyasEvolutionIntegration.ts`. It is unregistered, so the existing gate refuses to execute it.
- **Typed results.** Results are typed `executionAuthority: "NONE"`, `authority.granted: "NONE"`, and `mayExecute`/`mayInstall`/`maySpend`/`mayPublish: false`. No source file sets any of these to another value.
- **Lifecycle and owner decision.** There is no APPROVED or EXECUTED lifecycle state. `readAyasEvolutionOwnerDecision` is a pure reader, and even `APPROVED_EXTERNALLY` grants nothing.
- **Side effects.** The three library modules and the CLI contain no file write, spawn or network call. Besides reading its explicit input file and printing, the CLI's only side effect is `process.exit(2)` on malformed input.

So Stage 13 has **no** authority to execute, install, spend or publish, and it cannot bypass owner approval or the execution gate.

**Sanity on `4a29c02`.** Every suite was classified SAFE_ISOLATED before it ran (pure or static, or OS-TEMP roots only). `scripts/smoke-ayas-observer-autostart.ts` was not run.

| Suite | Result |
|---|---|
| Stage 13 evaluator (SHA-256 `5acb6303690d099a6c0fafd41c71abd4159973b6069808a38a298192ab31e47b`, unchanged) | **109/109**: 54 primary + 8 held-out + 20 regression + 27 container |
| TypeScript `--noEmit --incremental false` | PASS |
| `git diff --check` | PASS |
| Stage 8 research-improvement loop | 36 decision (held-out 8/8) + 55 integration (held-out 5/5) |
| zero-cost policy | 8 |
| proposal impact policy | 27 |
| execution gate | 16 |
| execution authority | 29 |
| daemon authority boundary | 23 |
| autonomous execution gate | 26 |

**Runtime/Test Mutation: NONE.** Path/size/mtime/SHA-256 inventories were taken before and after the suites:

- The live runtime (2,374 files), authority (4) and legacy `data/projects` (2,399) were byte-identical.
- `data/` outside `data/projects` went from 1,996 to 2,001 files. All ten changes came from the already-running autonomy daemon and `next start` server, not from a test:
  - Five files were added: two micro-items and three patch artifacts. They came from the daemon's discovery run `ayas-local-discovery-b6840175-7493-471b-b65f-7f85a4bc34f9` (13:21:47.751Z–13:22:15.314Z, base `4a29c02`), from generators `ayas-detector:diagnostic-quality-gap-v1` and `ayas-detector:error-code-contract-gap-v1`. The fresh graph had reopened the proposal lanes, as after Stage 10A.
  - Five files were updated: daemon state, micro-batch inbox, discovery ledger, research scheduler heartbeat, and the phone-access heartbeat. These are cadence and inbox files.
- The resulting micro-batch is bound to `4a29c02` and goes STALE by design once the closure commit moves HEAD. None of these files is tracked or committed.

**Review.** BLOCKER 0, unresolved MAJOR 0. No new finding after the merge.

**Pre-existing findings** (unchanged; not Stage 13):

- `GRAPH_PARTIAL` for the 7 `.ps1` files plus the thumbnails route, and the semantic PENDING marker.
- `.vscode/mcp.json` is a LIMITED remote-MCP consumer (Stage 10A deferred).
- Two hook guards in the gitignored, machine-local `.claude/settings.local.json` point at a Python `graphify.EXE` that is no longer installed (`HOOK_BINARY_MISSING`). The status is the same before and after the refresh. The file was left untouched and is an owner decision.
- Stage 10's documented held-out miss `heldout-closure-written`.

**Deferred findings** (unchanged):

- Persisted-record tamper evidence against multi-key deletion or valid-looking edits (needs the Stage 14 persisted store).
- IO, criteria and benchmark case-id truncation reporting.
- The first-round minors: research-loop benchmark cross-check, one-sided `supersedes`, candidate provenance label, and semantic HANDED_OFF verification.
- Inbox proposal status parsing and Stage 8 snapshot and registry typing (outside Stage 13).
- The persisted register (Stage 14 producer), a Brain tile, and licensing modeling.

This closure is a single docs-only commit. Use `git log -1` and `.graphify/branch.json` for its final HEAD and graph parity.
