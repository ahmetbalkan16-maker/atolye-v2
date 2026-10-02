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

## 15O.1 — the vault, its registry of record and path protection (implemented, not wired)

Files: `src/lib/ayas/golden/AyasGoldenVault.ts` (pure contract), `src/lib/ayas/golden/AyasGoldenVaultRegistry.ts` (versions of record, data only), `scripts/lib/AyasGoldenVaultFiles.ts` (reads and runs, never writes), `scripts/ayas-golden-vault.ts` (read-only operator script), four suites, and one rule block in `src/lib/brain/selfheal/BrainPatchSafety.ts`.

Vault version 1: 17 golden cases over seven domains. Each case is an existing deterministic offline suite, run with no arguments, with every file under `scripts/` it imports pinned by SHA-256 (22 files). Two declared gaps: revenue dry-run (no adapter before Stage 16) and whole historical-video projects (the two video cases cover the storytelling contracts and the quality gate, not a project).

| Domain | Cases |
|---|---|
| Conversation | conversation quality master, chat quality |
| Memory and retrieval correction | temporal correction, memory integrity, retrieval evaluation |
| Coding repair | historical repair vault (five frozen tasks), guided repair |
| Security and adversarial | action firewall, exact patch safety, access gate |
| Production recovery | production fault repair, workflow recovery, durable task runtime |
| Historical video | historical storytelling, production quality gate; whole projects declared missing |
| Revenue dry-run | none; declared gap |
| Brain UI | Brain Core UI, voice |

Decisions taken, with the measurement behind each:

- The decision rests on the candidate tree alone. A vault case that is red in the candidate tree stops promotion whether the change broke it or it was already red; a baseline run, when supplied, only says which. Reason: the live improvement cycle has 90 seconds in total, an experiment needs 60 of them, and the whole vault takes about 28 seconds on this workstation. Running it twice per experiment would make every experiment time out. That the vault passes at an accepted HEAD is proven by every declared baseline (suite `golden-vault-run`).
- Cases were chosen to be short. The two longest (retrieval evaluation 14 s, temporal memory 3 s) are already regression suites of the one registered strategy, so 15O.2 can reuse their result instead of running them twice.
- A gap is a field of the vault and of every decision. It is never counted as held.
- "Cannot silently rewrite" is three things: versions are append-only and chained by digest, with a case leaving only by name; the pinned bytes are verified wherever a decision is made; and the patch-safety table classes the vault modules, every file any version pins, the operator script, the suites, the eval manifest with its validator and runner as never-autonomous, in any spelling. The same block makes the Stage 15N governance module and constitution page never-autonomous (finding F23).
- A grader that starts importing a new fixture is reported as not fully pinned until a new version says so.

Not done in 15O.1, on purpose: no promotion path reads the vault yet (asserted by the suite), and `AyasResearchExperimentRegistry.ts` is untouched because it is the identity of a lifecycle entry.

Tests: contract suite 13 scenarios; operator and runner suite 3 scenarios in a TEMP copy; negative controls 39/39 caught in a TEMP copy; `golden-vault-run` runs all 17 cases (held, about 28 s). Eval manifest v23: 99 suites, 113 unique pins; v22 archived unchanged.

15O.1 source commit `143178caeef99ef778b44de0c7d135ecdf4c287d`; declared 99-suite baseline on v23 at that commit with no failure. Record: `15O1_RESULT.json`.

Found on the way (F24): `scripts/smoke-brain-selfheal-security.ts`, which is outside the declared baseline, was already failing at HEAD. It searched every self-heal file for the bare word `child_process`, and `AyasExactPatchSafety.ts` contains that word as data in the denylist of code a patch may not add. The check now looks for the module being loaded (import, dynamic import or require), which is what spawning needs. 14 scenarios pass.

## 15O.2 — the golden gate inside the existing improvement flow (implemented)

The flow is now baseline, candidate, held-out, golden regression, review, without a second runner, store or approval path.

Where the vault is asked: `runAyasRegisteredImprovementExperiment`, in the same sandbox, after the benchmark, the held-out comparison and the regression suites, and only when all of them together would say IMPROVED (`compareAyasExperimentBeforeGolden`). A change that was not going to be promoted is not measured against the vault and its verdict is what it was.

How it is asked (`runAyasGoldenVaultInSandbox` in the existing sandbox module):

- The pinned bytes are read from the sandbox tree first. With any drift no case runs.
- A case whose script already ran in this tree as a regression suite reuses that result.
- A case that cannot start inside the remaining time is left out; an incomplete run is never held.
- After the cases the tree is captured again: a golden case that wrote into it is `SANDBOX_ESCAPE`, as for a benchmark.
- Only when a case is red: the unchanged bytes are put back from the sandbox's own commit and the red cases alone are run again. That answer names the cause; it never rescues the candidate.

What the verdict becomes (`evaluateAyasExperiment`), when everything before the vault said IMPROVED:

| The vault says | Verdict | Reason |
|---|---|---|
| every case held | IMPROVED | as before |
| a case the change broke | REGRESSED | `GOLDEN_REGRESSION` |
| a case red, and red or unknown before the change | INCONCLUSIVE | `GOLDEN_NOT_HELD` |
| not measured, or no answer | INCONCLUSIVE | `GOLDEN_NOT_MEASURED` |
| the vault or a pinned file moved | INVALID_EXPERIMENT | `GOLDEN_VAULT_CHANGED` |

Because every promotion consumer already requires IMPROVED, all of them stop on anything but a held vault. Each one also asks the question itself (`ayasExperimentEvidenceGoldenHeld`: a well-formed block, decision held, every case of the vault asked, the digest of the vault as it is now), so evidence from before this stage or from an older vault version cannot be promoted either:

- `freezeAyasControlledEvolutionArtifact` and `buildAyasControlledEvolutionProposalCandidate` (controlled self-evolution);
- the research improvement cycle's proposal evidence and `discoverAyasResearchExperimentProposalCandidates`;
- `verifyAyasExactProposalSafety`, which every approval and execution path of an exact proposal calls.

Evidence: an optional `golden` block in the existing content-hashed package (vault version and digest, decision, reasons, one row per case with `reused`, failing and regressed ids, declared gap domains). Evidence without it still verifies as what it is. A block that is malformed, disagrees with itself or sits next to an IMPROVED verdict without being held does not verify.

The vault is injectable (`goldenVault` on the cycle and controlled-evolution inputs) so a fixture repository can be measured against its own vault. Production callers pass nothing and get the vault of record.

Measured, not assumed:

- A real experiment sandbox of this repository at HEAD: no pin drift, all 17 cases pass in the sandbox's stripped environment, the tree is untouched, 31 to 33 s for the whole vault. Suite `golden-sandbox-run` repeats this in every baseline.
- With the one registered strategy the two longest cases are reused, which leaves about 15 s of vault time inside the 90 s cycle. No real strategy can run at this HEAD (its source was already applied in Stage 15.7), so the whole real cycle with the vault was not timed end to end; if the budget is too small the result is INCONCLUSIVE, never IMPROVED.
- Finding F25: a fixture repository without a line-ending policy is checked out with CRLF by this machine's Git, so a vault pinned to its committed bytes read as changed in the sandbox. The real repository has the policy; the fixture repositories now have the same one. The gate failed closed.

Lifecycle: the Stage 8 evaluator changed by one harness line (it passes the fixture vault). New entry `evaluator.research-improvement.15o-v3`; `15f4-v2` is kept as a revision-pinned rollback target. 18 registry entries.

Tests: gate suite 11 scenarios (real experiments in TEMP fixture repositories); negative controls 35/35 in a TEMP copy; `golden-sandbox-run`; vault contract 13 with a partial-baseline scenario and 40/40 negative controls; controlled-evolution artifact and cycle, exact proposal safety and the Stage 8 suite updated. Eval manifest v24: 102 suites, 118 unique pins; v23 archived unchanged.

Limits:

- The golden cases are deterministic suites. They say whether a source change broke what the vault covers; they do not grade a model. A model promotion still rests on the lifecycle checks, and nothing is promoted there today.
- The per-experiment time budget was not widened. A vault that grows needs either short cases or an owner decision about the cycle budget.
- The red-case question is asked in the same sandbox after restoring the changed files from its commit; it relies on the strategy having written only its declared files, which the runner has already verified at that point.

15O.2 source commit `9cbe62d3eb62ce9748a3776dcd5dddbc5b662d74`; declared 102-suite baseline on v24 at that commit with no failure. Record: `15O2_RESULT.json`.

## 15O.3 — three golden historical-video projects; vault version 2 (implemented)

The design asks for two or three representative historical-video golden projects. A golden project here is everything the deterministic part of a historical video is made from, frozen: a fact pack with real sources, eight narrative units (one per beat), and one character scene per unit. What the Stage 15J engines make of it is frozen next to it.

| Project | Fact pack | Disputed claim, narrated as uncertain |
|---|---|---|
| `istanbul-1453` | 9 claims, 4 sources (Kritovulos, Dukas, Runciman, İnalcık) | the Kerkoporta gate, told by Dukas alone |
| `malazgirt-1071` | 10 claims, 4 sources (Attaleiates, İbnü'l-Esîr, Hillenbrand, Cahen) | the size of the armies |
| `preveze-1538` | 10 claims, 4 sources (Gazavât-ı Hayreddin Paşa, Kâtib Çelebi, Bostan, Guilmartin) | the number of ships |

Each project passes both reviews with no finding (narration evidence gate PASS; narrative contract gate PASS; 720 s; eight beats in order; a question opened in the cold open and answered at the turning point or payoff), and every scene builds and verifies as a labelled, local, zero-cost reenactment that is evidence of nothing. The 24 scenes were rasterized once into a scratch directory and looked at before their bytes were frozen; movement arrows that struck through the figures were moved to the ground line first.

Frozen per project (`scripts/fixtures/ayas-golden-video-projects-expected.ts`): the digest of the project itself, the SHA-256 of each scene's SVG, and a digest over both reviews and every scene manifest. A change to the renderer, the rig, a review rule or a project shows as a named difference; the suite compares scene by scene first so a renderer change names the scene it moved.

The golden data is also used the other way round: on the same three projects, a disputed claim told as fact, a year no claim carries, an unknown name, a claim without sources, beats out of order, an unanswered question, an unsupported superlative, a scene that calls itself evidence and an unlabelled documentary scene each produce the finding they should.

Vault version 2 (digest `5f2fbf0b…2024a3f`): every case of version 1 with the same pinned bytes, plus `golden.video.historical-projects`. Version 1 stays in the chain unedited; the contract suite now also freezes the digests of the published versions, because the chain alone would accept a version edited in place together with a re-linked successor. The historical-video gap narrows to what only a real production can supply: narration audio, assembled video and measured quality.

What these projects are not: productions. No audio, no video, no provider, no cost; the SVG is not rasterized by the suite (pixel output depends on the installed image library). The historical statements are well-established and the sources are real works, but the fixtures were written for regression, not reviewed by a historian; an edition detail could be wrong. They enter no production.

Tests: project suite 6 scenarios; negative controls 17/17 in a TEMP copy; vault contract 13 with published-digest and version-2 checks; all 18 cases held in this tree and inside a real experiment sandbox (34 s). Eval manifest v25: 104 suites, 122 unique pins; v24 archived unchanged.
