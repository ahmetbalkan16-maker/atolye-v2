# Stage 16.0 — Revenue Platform Adapter Standard

Canonical sources: final execution order §10 (16.0); `04_STAGE16_REVENUE/16.0/` (adapter standard,
task, owner-PC validation). Started 2026-10-03 after the Stage 15 closure push was verified
(`ea11283`, local = origin, 0/0, clean, Graphify bound).

## Graphify-first

New module boundary `src/lib/ayas/revenue/` (no prior nodes). Reused read-only:
`evaluateAyasZeroCost` / `parseAyasCostClass` (fan-in 8; unchanged) and `containsBrainSecret` (fan-in 23;
unchanged). Modified shared file: `BrainPatchSafety` (bridge node) — one more FORBIDDEN_AUTONOMOUS rule
and three yardstick files, more restrictive only.

## What was built

- `AyasRevenuePlatformTypes.ts` — closed platforms (5), operations (24) with exactly one effect each
  (7 READ_ONLY, 5 LOCAL_DRAFT, 7 EXTERNAL_WRITE, 5 FINANCIAL_COMMITMENT), modes, transports, credential
  handling, statuses, limits, manifest/request/result types.
- `AyasRevenueRedaction.ts` — plain bounded JSON, identifiers, platform/operation-bound cursors,
  structured snapshot + deep freeze, sensitive-data refusal (Brain secret scanner + Luhn card numbers,
  IBAN, SSN, TCKN, credential/contact field names).
- `AyasRevenueActionPolicy.ts` — pure decision: ALLOW_READ / ALLOW_LOCAL_DRAFT / REQUIRE_OWNER / DENY;
  financial operations denied first; zero-cost policy as a decision input.
- `AyasRevenuePlatformAdapter.ts` — adapter = exactly `{ manifest, read, draft }`; manifest validation;
  `inspectRevenueAdapter`; result normalization.
- `AyasRevenuePlatformRegistry.ts` — closed registry (one adapter per platform, unique ids, frozen
  copies), production registry EMPTY, `planRevenueOperation`, `runAyasRevenueReadOrDraft`
  (read/draft only, BLOCKED without touching the adapter otherwise, 10 s timeout).
- Test-only fake adapter `scripts/fixtures/ayas-revenue-fake-adapter.ts`; evaluator
  `scripts/smoke-ayas-revenue-adapter-standard.ts` (54 primary + 10 frozen held-out); negative controls
  `scripts/smoke-ayas-revenue-adapter-standard-mutations.ts`; standard `docs/AYAS_REVENUE_ADAPTER_STANDARD.md`.

## Findings while building (fixed before the commit)

- The evaluator caught a lowercase `sk-proj-…` token passing the adapter-id slug pattern; adapter ids now
  also pass the sensitive-text check.
- An adapter-registry lookup guard was provably redundant (a Map has no prototype chain) and survived its
  mutant; it was removed, not recorded as an equivalent survivor.
- Review before commit (code-review skill, high): 10 findings, all addressed —
  (1) request time-of-check/time-of-use through a Proxy: plan and dispatch now share one structured,
  deep-frozen snapshot; (2) result read several times (array accessors): the answer is snapshotted once
  and what is scanned is what is returned; (3) numeric card/TCKN values: values are scanned on the
  serialized copy; (4) sensitive data in request payloads/cursors now REQUEST_INVALID; (5) lowercase IBAN
  and glued card numbers: case-insensitive IBAN, digit lookarounds; (6) suites registered in the eval
  manifest (v36); (7) NaN timeout keeps the default; (8) one scan per result instead of per string;
  (9) key matching suffix-only (`sessions`, `sessionCount`, `emailOptIn` no longer refused);
  (10) EMPTY always returns `data: null`. Each fix has a scenario (P35, P41, P51–P54) and mutants.

## Evidence (uncommitted overlay on `ea11283`)

- Evaluator: 54/54 primary, 10/10 held-out; negative controls 74/74 caught by an assertion of the named
  scenario.
- TypeScript PASS (`--incremental false`); changed-file ESLint 0/0; `git diff --check` PASS.
- Zero-cost policy smoke 8/8; firewall closure 12/12 (the revenue module is not effectful and has no entry
  point); BrainPatchSafety consumers outside the baseline (patch-detectors 37, brain-selfheal 41 / 14 / 3,
  adaptation-pipeline 7, autonomous-foundation-acceptance 42, brain-control-center, brain-core-ui 43)
  PASS in a TEMP clone.
- Manifest `15F.4-v36`: 120 suites (adds `revenue-adapter-standard`, `revenue-adapter-standard-mutations`),
  142 unique pins; v35 archived.

## Validation checklist (04_STAGE16_REVENUE/16.0/STAGE16_0_OWNER_PC_VALIDATION.md)

1. Graphify status before edits: bound to `ea11283`, stale=false. 2. Dedicated branch: DEVIATION — kept on
the canonical WIP branch `wip/ayas-graphify-final-execution` (the owner's order continues this branch and
the owner's live autonomy daemon runs in this worktree; a branch switch under it was judged riskier than
stage-scoped commits). 3. Production registry empty: P12. 4. No network imports/calls: P48. 5. No
secret/env reads: P48. 6. No approval/execution mutation call: P48 (imports limited to the zero-cost
policy and the Brain redaction scanner; nothing imports the revenue modules). 7. TypeScript, ESLint,
evaluator, zero-cost smoke, security regressions and Graphify regressions: above and the declared
baseline. 8. Graphify at final HEAD: after the commit. 9. Independent review before commit: done (above).

## Known limitations

- No live platform adapter, credential, network call, owner-authorized write bridge or financial
  executor exists (by design; 16.1+ and the platform stages).
- The generic result refusal is conservative (Luhn-valid numeric ids, IBAN-shaped SKUs, `…Token` fields);
  platform stages replace it with closed per-operation schemas. Phone numbers are not pattern-matched.
- The 10 s adapter timeout cannot cancel an adapter's own pending work; it only stops waiting.
