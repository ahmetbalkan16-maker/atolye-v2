---
name: tests
description: How to find and run this repo's smoke-test corpus (150+ scripts/smoke-*.ts, node:assert-driven, no jest/vitest). Load before or after any src/lib/... change to find and run the matching regression set.
---

# AYAS Tests

## Convention

- `npx tsx scripts/smoke-<name>.ts` — prints `PASS (N scenarios)` and/or a JSON `{"status":"PASS",...}` line; a non-zero exit code is the authoritative pass/fail signal (don't rely on grepping stdout for a specific string — not every script emits the same shape).
- When changing a `src/lib/...` file: `grep` `scripts/` for the filename to find its smoke script(s) and anything that exercises it transitively. The matching sprint entry in `ATOLYE_CHECKPOINT.md` usually lists the exact regression set a prior sprint validated for that area.
- Select regressions from the change scope (direct importers, Graphify-affected dependents, the touched boundary's authority/security suites) and run them for real — not a token-saving subset, and not "every smoke" by default.
- **No mutating test run until its runtime/authority/legacy/brain roots are known.** `npx tsx scripts/ayas-developer-handoff.ts --task ... --baseline <rev> --scope ...` classifies each selected smoke (SAFE_ISOLATED / SAFE_READ_ONLY / REQUIRES_TEMP_ROOT / REQUIRES_OWNER_APPROVAL / UNSAFE_KNOWN / UNKNOWN); only the first two are auto-runnable. Timeout is never PASS.
- **DO NOT RUN `scripts/smoke-ayas-observer-autostart.ts`** — its fixture can unregister or replace the real owner Windows Scheduled Task (registered in `AYAS_KNOWN_UNSAFE_TESTS`).

## Known sharp edge

A `scripts/*.ts` file — and anything it transitively imports — may be invoked via plain `tsx` from an **arbitrary cwd** (some integration tests spawn it against an isolated temp fixture repo to prove staleness/reconciliation behavior in isolation). Such files must use relative imports only: a `@/`-aliased import resolves fine under Next.js's bundler but fails with `MODULE_NOT_FOUND` outside it. Confirmed live this session — a `@/` import pulled transitively into `scripts/ayas-discovery-daemon.ts`'s graph broke exactly this way.

## When NOT to load this

Tasks with no code change (pure research/reading).
