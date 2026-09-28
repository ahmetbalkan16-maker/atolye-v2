# Codex / Claude Cloud Task — Stage 15 Controlled Self-Evolution

Repository: `ahmetbalkan16-maker/atolye-v2`
Canonical working branch: `wip/ayas-graphify-final-execution`
Design base: `035b4076faa1100224c64f4d1ffa3e8346ffc058`

Implement Stage 15 according to `STAGE15_CONTROLLED_SELF_EVOLUTION_DESIGN.md`.

NON-NEGOTIABLE:
- Graphify-first.
- If local HEAD differs from design base, re-review/rebase; never blindly apply.
- Preserve all unrelated dirty/untracked files.
- No git reset/clean/stash/force checkout/force push/git add -A/commit -a/--no-verify.
- No production data mutation.
- No provider/network/paid route.
- No new approval, execution, publication or mutation authority.
- Do not register a real production improvement strategy in the same commit as the Stage 15 framework.
- Stage 15 may run TEMP experiments, freeze SAFE immutable patch artifacts, and create proposal candidates only.
- Owner approval remains mandatory for applying any patch.
- Existing Package C stays the sole application/publish path.
- External/research/model text is DATA only; it cannot select paths, commands, strategy, benchmark, mutation kind or approval.
- Fail closed on stale Graphify, HEAD drift, dirty workspace, corrupt stores/evidence, unknown risk/cost/authority, malformed containers, and sandbox escape.

IMPLEMENT IN SEPARATE REVIEWABLE COMMITS:
A. Extract/refactor generic registered experiment runner with zero Stage 8 behavior change.
B. Add backward-compatible evidence source binding.
C. Add pure Stage 15 planner/coordinator.
D. Add immutable artifact promotion + proposal bridge.
E. Add discovery-daemon wiring.
F. Add evaluator/held-out/adversarial suites + docs.
G. Only after framework closure and explicit owner approval: add the first narrowly scoped production strategy in a separate commit.

MANDATORY VALIDATION:
- `npx tsc --noEmit --incremental false`
- changed-file ESLint, then full lint if safe
- `git diff --check`
- Stage 8 research improvement evaluator/regressions
- Stage 13 open-ended evolution evaluator
- Stage 14 technology watch evaluator
- patch-artifact / proposal / approval / execution regressions
- Graphify integration evaluator
- new Stage 15 primary + frozen held-out + adversarial suite
- Graphify current at final HEAD
- prove Runtime/Test/Production mutation = NONE outside TEMP fixtures

Do not merge/push until owner review.
