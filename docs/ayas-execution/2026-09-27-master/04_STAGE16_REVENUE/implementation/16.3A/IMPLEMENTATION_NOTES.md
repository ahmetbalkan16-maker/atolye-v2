# Stage 16.3A — offer / product factory

Canonical source: master order section 10, "16.3A Offer / Product Factory" (value proposition, target customer, deliverables, capability requirements, rights, price scenario, revision/support, delivery-time scenario, portfolio evidence, platform mapping; cannot sell if fulfillment capability is not proven). No separate 16.3A pack exists under `04_STAGE16_REVENUE/`.

Post-freeze addendum: no section applies. The factory is a pure function. It sends no prompt to a model (section 2), adds no tool or operation (section 3) and raises no alert (section 7).

## Handover

Codex left an uncommitted draft at `60153e3` (source, digest helper, 50+10 smoke, fixture, adapter-standard import exception, patch-safety entries) with a passing focused run and no mutation suite, document, manifest entry or regression run. This session resumed it in place; nothing was reset or rewritten.

## What this session changed

- F57: deliverable and rights evidence must not be scoped to a different capability (`P51`).
- F58: the draft did not type-check (JSON depth 12 against the literal 8 type). It now uses the canonical revenue depth.
- Primary cases P52-P59 isolate guards that were only covered transitively, so each guard has its own negative control.
- `scripts/smoke-ayas-revenue-offer-factory-mutations.ts`: 64 negative controls, all caught by an assertion in an owned gitless TEMP copy.
- `docs/AYAS_REVENUE_OFFER_FACTORY.md` (forbidden autonomous patch target, as the draft already declared).
- Eval manifest `15F.4-v41`: two new declared suites (130 suites, 156 pins); the adapter-standard pins were refreshed for its one-line import exception. `v40` is frozen byte-for-byte as `EVAL_MANIFEST_V40.json`.

## Evidence

| Check | Result | File |
|---|---|---|
| Focused | 59/59 primary, 10/10 held-out | `16.3A_FOCUSED.json` |
| Negative controls | 64/64 caught, 0 equivalents | `16.3A_MUTATIONS.json` |
| Selected declared suites (TEMP runner, overlay) | 16/16 PASS, one worktree digest throughout | `16.3A_REGRESSIONS.json` |
| Extra undeclared suites (scrubbed TEMP copy) | 6/6 PASS | `16.3A_EXTRA_REGRESSIONS.json` |
| TypeScript, changed lint, whole lint, diff | PASS; whole lint 0 errors, 13 inherited warnings | `16.3A_STATIC_CHECKS.json` |
| Review | 2 findings fixed; same-session review, not a separate agent | `16.3A_REVIEW.json` |

Earlier runs are kept: `16.3A_PRE_REPAIR_FOCUSED.json` (Codex, 48/50) and `16.3A_PRE_REVIEW_FOCUSED.json` (Codex, 50/50 before review).

No full declared baseline was run for v41. The last complete baseline remains `5cbb217` / v38. No account, listing, money, network, model or host action took place.
