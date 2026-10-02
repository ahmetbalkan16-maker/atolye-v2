# Stage 15O — Golden Benchmark and Regression Vault

Opened after the Stage 15N source commit `9cdf5dbdede418dd35c6a9a1c5057299c20af693`.

Canonical text read: `00_COMMAND/AYAS_FINAL_CODEX_MASTER_EXECUTION_ORDER.md`, STAGE 15O, and `01_CANONICAL_SPECS/AYAS_MASTER_SPRINT_V3_1_FINAL_FREEZE_ADDENDUM.md`, 15O. The post-freeze addendum has no section for 15O; its sections 0 and 9 apply (unknown and unmeasured are never PASS, no heavy runtime, owner boundaries unchanged).

Requirement: a permanent, versioned reference suite that AYAS cannot silently rewrite, over eight domains (conversation, memory and retrieval correction, coding repair, security and adversarial, production recovery, two or three historical-video golden projects, revenue dry-run, Brain UI functional regressions). For every improvement: baseline, candidate, held-out, golden regression, review. A change that improves one metric and damages a golden case does not go forward.

## 15O.0 existing-seam inspection (read-only, done)

What already exists and is reused:

- `AyasEvalGovernance` and the eval manifest: every declared suite has hash-pinned graders and fixtures, and the baseline runner refuses on pin drift. It declares suites; it has no notion of a golden set, and its manifest lives under `docs/`, which the patch-safety table classes SAFE.
- `AyasResearchExperimentEvaluation.evaluateAyasExperiment`: baseline against candidate on one evaluator digest, with held-out cases and a "no case that passed at baseline may fail" rule. A failed regression suite already gives `REGRESSED`.
- `AyasRegisteredImprovementExperiment`: runs the benchmark and the hypothesis's regression suites in a TEMP sandbox clone, before and after the change, and writes one content-hashed evidence package. The package already carries optional blocks that older evidence lacks (`sourceBindings`, `replacementDigest`).
- Three promotion consumers read that package and require the verdict `IMPROVED`: `freezeAyasControlledEvolutionArtifact`, the controlled self-evolution bridge and `AyasResearchProposalBridge`.
- `AyasLifecycle`: promotion needs six evidence checks, among them `regression` and `heldOut`, each with a reference and the evaluator that measured it.
- `BrainPatchSafety`: the static table that decides whether a path may ever be changed autonomously.

What is missing, measured against the requirement:

1. The regression suites of an experiment are chosen per strategy. Nothing makes a fixed, cross-domain set run for every improvement.
2. `scripts/smoke-*` and `docs/` are classed SAFE by the patch-safety table. A grader or a fixture is therefore not protected from an autonomous patch by that table (the experiment registry protects `scripts/` for experiments only).
3. There is no versioned record of which cases are golden, so a removed or weakened case would leave no trace beyond the diff.
4. No frozen golden project exists for historical video; Stage 15J has one fixture topic inside its own suite.
5. No revenue adapter exists before Stage 16, so there is nothing to dry-run.
6. Found while inspecting: the Stage 15N governance module and constitution page are review-required, not never-autonomous, in the patch-safety table.

A constraint found in the lifecycle registry: `AyasResearchExperimentRegistry.ts` and `scripts/smoke-ayas-research-improvement-loop.ts` are identities of registered lifecycle entries. Changing either needs a new registry entry with the old identity kept as the rollback target. The plan avoids changing the first one.

## Bounded plan

15O.1 — the vault, not wired:

- `src/lib/ayas/golden/AyasGoldenVault.ts`, pure: the eight domains, a vault version (cases with pinned files, declared gaps), a digest, an append-only chain audit (a case leaves only by name), pin verification, and `evaluateAyasGoldenRegression` (moved yardstick, missing measurement, baseline not golden, regression, held; in that order).
- `AyasGoldenVaultRegistry.ts`: the versions of record. Version 1 uses existing deterministic offline suites. Revenue dry-run is a declared gap until Stage 16. Rendered video projects are a declared gap; deterministic golden projects are packet 15O.3.
- `BrainPatchSafety`: the vault modules, every file the vault pins, the governance module and the constitution page become never-autonomous.
- A read-only operator script and a suite with negative controls. No promotion path reads the vault yet.

15O.2 — the gate in the improvement flow:

- The experiment runner runs the vault before and after the change in the same sandbox and adds a `golden` block to the evidence package.
- `evaluateAyasExperiment` turns a golden regression into `REGRESSED` and an unmeasured or moved vault into a non-improving verdict, so all three consumers stop without new code paths. The consumers additionally require the block and the current vault digest, so evidence from before this stage cannot be promoted.
- Lifecycle: a new evaluator entry for the changed Stage 8 evaluator, old identity kept as rollback target.

15O.3 — two or three deterministic historical-video golden projects from the Stage 15J contracts (fact pack, narrative review, character scenes and their rendered bytes), added as vault version 2.

Nothing in this stage runs a model, a provider, a container or a live production. No owner gate is expected; reference projects rendered by a real production stay a declared gap that only the owner can close.
