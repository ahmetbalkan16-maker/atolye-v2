# Stage 15I — AYAS ↔ Atölye Live Production Director

Opened 2026-10-02 at `930b537`. Canonical section: master order STAGE 15I; `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_PRE_ATOLYE.md` STAGE 15I; directive V3.2 section 11 (implement the designed behaviour on the existing media architecture). Post-freeze addendum: section 0 (unknown state fails closed; unmeasured is never a pass; no autonomous spend, publish or authority widening) was applied. Section 3 (an added tool or operation records evidence) does not apply yet: this stage adds no tool to an AYAS surface.

## What the stage asks for, and where each item is

| Canonical item | Where |
|---|---|
| Director Session binding sixteen things | `AYAS_DIRECTOR_BINDINGS` and `bindAyasDirectorSession` in `src/lib/ayas/director/AyasProductionDirectorSession.ts`; a test reads the list out of the canonical spec and compares |
| Watch every stage through read/status evidence | `collectAyasProductionDirectorSession` in `AyasProductionDirectorCollector.ts`: the project record, manifest, stage files, job list, usage log, asset registry and publish record, through the pipeline's own readers |
| Autonomous SAFE operations only, four classes | `AYAS_DIRECTOR_SAFE_OPERATIONS` and `decideAyasDirectorActions`: bounded transient retry, zero-cost provider fallback, regenerate a missing or corrupt local artifact, resume an already-authorized stage |
| May not: hot-patch source, raise a budget cap, bypass a rights classification, publish, bypass a production gate | None of these is a value of any decision. The two publication stages, a rights or quality block, and any spend go to the owner |
| CODE_DEFECT goes to controlled self-evolution; production pauses at a safe checkpoint | Decision `ROUTE_CODE_DEFECT` with the stage the production holds after, and the hold `CODE_DEFECT_PENDING_REPAIR`: no safe operation anywhere in that production |

## 15I.0 — what already existed

- A read-only Stage 12 director review (`AyasDirectorReadiness`, `AyasDirectorProjectAdapter`): thirteen quality dimensions, a rights gate, authority `ADVISORY_ONLY`. Reused as the quality binding.
- Context-bound read methods: `ProjectReader.readJSONState`, `ProjectManager.getManifest`, `PipelineJobManager.listJobsReadOnly`. None writes.
- Structured failure evidence per stage (`PipelineErrorEvidence`: schema, animation, audio and thumbnail errors with codes, phases and HTTP status), the pipeline's stage order and dependency table, and its retry bound of three.
- The production path's own provider resolution (`resolveProductionProviderName`): an unset text, speech, thumbnail or package provider is the paid default, never the mock.
- The cost summary over the usage log (`summarizeObservedCost`) and the pipeline's technical ceiling (1 USD by default).
- AYAS's own money authority: `AYAS_AUTONOMOUS_MONETARY_BUDGET_USD = 0`.
- One AYAS write action, `resume-stage`, switched off and owner-gated (Stage 15D). No AYAS action retries or regenerates a stage; the operator's command line does.

No per-project record of what the owner asked for exists: no target duration, format or approved cap is stored with a project.

## Design

**Session** (`buildAyasProductionDirectorSession`, pure). The same facts always give the same session and digest. Each of the sixteen bindings is in one of four states: `BOUND`, `NOT_PROVIDED` (the owner did not say), `NOT_PRODUCED_YET` (the pipeline has not made it), `UNREADABLE` (it is there and could not be read). Nothing is inferred: the topic falls back to the project's title and says that it did; the technical ceiling is recorded beside the budget approval and is never read as one. The session's authority is `NONE`.

**Fault classes** (`classifyAyasDirectorFault`). From the stage's status, its file and the pipeline's structured evidence: transient provider failure, rate limiting, refused credential or configuration, provider refusal, rejected request, invalid model output, lost or corrupt local file, local storage failure, a failure of the pipeline's own contract, a stage recorded as running, and a failure the evidence does not explain. A code that names the cause decides before the phase does. A failure without evidence is never guessed into a retryable class. The manifest's own `missing` status means "not produced yet" and is not a fault.

**Decisions** (`decideAyasDirectorActions`). One of five kinds per stage: `NONE`, `WAIT`, `SAFE_OPERATION`, `REQUIRE_OWNER`, `ROUTE_CODE_DEFECT`.

- Holds come first. Without a bound owner request, a readable project record and a known commit, or with a code defect pending, no safe operation is returned for the production.
- A safe operation needs a zero-cost provider for its stage (the existing zero-cost policy decides), a known cost state, no rights or quality block from assembly on, and a stage that is not a publication stage. A retry also needs a recorded attempt count below the pipeline's bound.
- A paid stage is always the owner's, even under an approved cap: the decision carries what was spent, the approved cap and the technical ceiling, so the owner can answer in one step.
- A running stage is reported and never taken over. While a stage is in a fault the pipeline is not moved past it.
- Every `REQUIRE_OWNER` decision names the exact question and carries the few facts that matter.

**A safe operation is a plan.** Each names the existing action that would run it and whether AYAS can start that today. None can: `resume-stage` is the one AYAS write action and it is switched off; retry, regeneration and provider selection have no AYAS action. `executableByAyas` is `false` on every plan. This stage opens none of those paths.

**Collector.** Read-only, bound to an explicit storage context. It starts no stage, calls no provider and probes no tool. A read that fails transiently is read again, at most twice: that is the one safe class it performs itself. A file that still cannot be read is reported as unreadable, never as absent. The provider of a stage is resolved the way the production path resolves it; a stage with two providers is as costly as the costlier one.

**Operator script** (`scripts/ayas-production-director.ts`). Prints the session or its JSON for one project, with an optional owner request file. It writes nothing.

## What is not built, and why

- **No live binding.** Nothing calls the collector on a schedule. Binding a read-only director watch to the observer tick is the same kind of step as the Stage 15B live binding and needs the owner's approval.
- **No dispatch.** The write path stays closed. Opening it is the owner's activation, recorded since Stage 15D.
- **No stored owner request.** The request is given per call. A durable record is a write to project state made by the owner's own action; it belongs with the Director Session tile of Brain UI V2 (master order section 14).
- **No chat tool.** Adding one changes tool routing on the chat path, which the cognitive evaluations pin. It belongs with the same UI stage.
- **The code-defect route is a report.** Controlled self-evolution accepts registered strategies only, and a production defect has none. The decision names the defect, the commit and where production holds; the repair is a governed proposal like any other.
- **No per-run provider override exists in the pipeline.** A zero-cost fallback is advice until one does.

## Verification

- `scripts/smoke-ayas-production-director.ts`: 17 scenarios on fixture facts and a TEMP runtime root.
- `scripts/smoke-ayas-production-director-mutations.ts`: 45 of 45 negative controls caught, in a TEMP overlay.
- One read-only run against a real project of this workstation's runtime root (no owner request bound): eight of sixteen bindings bound, one failed stage classed as unexplained and sent to the owner, nothing planned, nothing written.
- Eval manifest `15F.4-v12`: 80 suites (two added in v11); v10 and v11 kept.

## Found by the baseline

The first baseline of this stage, at `10367e8`, failed one suite of 80: `durable-task-recovery`. The Stage 15B wiring guard lets no file other than the observer name the durable recovery script, and the new director suite named it in its list of things that must not start the director. The source packet had been committed without running that suite.

The fix is in the new suite only: the name is gone from its list (the observer, which is the sweep's one starter, is still checked). The guard is unchanged. The failed report is kept as `15I_BASELINE_10367e8_FAILED.json`; the stage's baseline is the one at the fix commit.
