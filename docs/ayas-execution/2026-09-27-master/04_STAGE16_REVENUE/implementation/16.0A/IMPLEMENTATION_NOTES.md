# Stage 16.0A — External Account Connection / Credential Boundary

Canonical sources: final execution order §10 (16.0A: framework now, real onboarding later and only on the
owner's decision; connection metadata = platform, opaque account id, scopes, expiry, reauth, health;
secrets connector/server managed, never memory/ledger/log; minimum scope; expiry/scope drift detected);
master sprint V3 pre-Atölye ("16.0A Account/Credential Boundary"). Executed with 16.0 as one canonical
step ("Stage 16.0 + 16.0A"); 16.0 packet `be25d72`.

## Graphify-first

Graph refreshed to `be25d72`. New file in the revenue module; reuses `isAyasRevenueRequestShape`
(fan-in 2, local) and the 16.0 redaction helpers. `BrainPatchSafety`: two yardstick entries only (the
revenue prefix rule already covers the module).

## What was built

`src/lib/ayas/revenue/AyasRevenueAccountConnection.ts`:
- `isAyasRevenueAccountConnection` — metadata only, exact keys, holder NAME `connector:<id>` or
  `vault:<name>` bound to the credential handling (no `NONE` connection), privacy-safe label, bounded
  unique scopes, ordered strict times; any credential-shaped value is refused.
- `requiredAyasRevenueScopes` — least privilege from a code-owned scope map: reads and owner-gated
  writes; local drafts need none; financial operations never justify a scope.
- `assessAyasRevenueConnection` — REAUTH_REQUIRED, EXPIRED, UNVERIFIED (incomplete map), SCOPE_MISSING,
  SCOPE_EXCESS, UNVERIFIED (never or > 24 h verified), SCOPE_DRIFT, EXPIRING (< 7 days, usable), HEALTHY.
- `gateAyasRevenueRequestConnection` — platform, account, usable health computed internally (never taken
  from the caller), operation scope granted; drafts need no connection; financial requests refused.
Evaluator `scripts/smoke-ayas-revenue-account-boundary.ts` (24 primary + 6 frozen held-out) and negative
controls `…-mutations.ts`; standard section in `docs/AYAS_REVENUE_ADAPTER_STANDARD.md`.

## Findings while building

- The Brain secret scanner reads `secret:<name>` as a `SECRET:value` assignment; the server-secret
  holder prefix is `vault:` so a holder NAME never looks like a credential (the scanner was not changed).
- Two negative controls first survived because the tests did not exercise the guard: a `NONE` handling
  with a `null:<x>` holder, and a scope that matches the scope pattern but is a credential (`sk-proj-…`).
  Both cases were added; nothing was removed or weakened.
- The 16.0 evaluator's P48 listed the revenue folder exactly; it now requires the core files and holds
  every present file to the import/network rules (the mutation TEMP closure copies only imported files).

## Evidence (uncommitted overlay on `be25d72`)

- 16.0A evaluator 24/24 + 6/6; negative controls 35/35. 16.0 evaluator 54/54 + 10/10; its negative
  controls 74/74 after the P48 change.
- TypeScript PASS; changed-file ESLint 0/0; diff check PASS; firewall closure 12/12.
- Manifest `15F.4-v37`: 122 suites (adds `revenue-account-boundary`, `revenue-account-boundary-mutations`),
  144 unique pins; repinned `scripts/smoke-ayas-revenue-adapter-standard.ts`; v36 archived.

## Known limitations

- No onboarding, OAuth flow, connector, vault access, connection store or live verification exists; scope
  maps per platform arrive with the platform stages (16.4+), which also wire the gate before dispatch.
- Observed scopes are an input; nothing here reads them from a platform.
