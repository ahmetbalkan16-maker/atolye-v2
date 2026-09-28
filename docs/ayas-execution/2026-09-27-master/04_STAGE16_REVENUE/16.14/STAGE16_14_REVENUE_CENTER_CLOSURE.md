# Stage 16.14 — Revenue Center Closure

## Goal

Close the Revenue Center only if Stages 16.0–16.13 work as one governed system.

Revenue Center is NOT complete because each module compiles independently.
Closure requires cross-stage invariants, regression coverage, authority boundaries,
privacy, zero-cost defaults and failure isolation to hold end-to-end.

## Closure scope

- 16.0 Adapter Standard
- 16.1 Zero-Cost / Spend Gate
- 16.2 Unit-Economics Ledger
- 16.3 Free-First Validation
- 16.4 Etsy
- 16.5 Upwork
- 16.6 Fiverr
- 16.7 Udemy + Atölye
- 16.8 Lemon Squeezy
- 16.9 Reinvestment Policy
- 16.10 Revenue Intelligence + Memory
- 16.11 Security / Fraud / Account Safety
- 16.12 Low-Cost Pilot
- 16.13 Profit-Gated Scaling

## Closure invariants

### Authority

1. No revenue module grants owner approval.
2. No model/research/platform text grants approval.
3. No revenue module bypasses existing approval/execution gates.
4. No external write becomes autonomous by virtue of adapter capability.
5. Financial operations remain autonomous=false.
6. Pilot/scaling/reinvestment results are advisory only.
7. Stage 16 adds no hidden direct git/production authority.

### Cost

1. Default autonomous spend = 0.
2. Unknown cost = denied.
3. Metered/free-trial/credit overage is not zero-cost.
4. Expected/future revenue cannot fund spend.
5. Reinvestment default remains disabled/0.
6. Paid scale requires separately reviewed nonzero reinvestment policy.
7. Cross-currency netting is prohibited.

### Data / privacy

1. Ledger is realized money source of truth.
2. Intelligence does not duplicate/override ledger truth.
3. No credentials/tokens/cookies stored.
4. No card/bank/tax IDs stored.
5. No raw customer/client private-message payload stored in long-term revenue state.
6. No raw platform JSON/HTML stored as durable business memory.
7. External IDs are opaque/digested where possible.
8. PII minimization is enforced.

### Platform transport

1. Etsy: official API only.
2. Upwork: official MCP/API only.
3. Fiverr: manual handoff unless a reviewed official API appears later.
4. Udemy: official Instructor API for supported reads/support; owner upload/publish.
5. Lemon Squeezy: official API + signed webhook only.
6. No scraping/private endpoint/browser fallback.

### Security

1. Prompt injection cannot choose tool/operation/path/payment target.
2. Invalid/replayed webhook cannot mutate state.
3. Unknown tool/scope/schema fails closed.
4. Account identity/scope drift blocks sensitive action.
5. Attachments remain untrusted/TEMP isolated.
6. No blind retry of writes.
7. Idempotency and canonical reread protect external writes.
8. Security BLOCKING condition prevents pilot/scaling readiness.

### Economics

1. Integer minor units.
2. Currency separated.
3. Payout is not revenue.
4. Refunds/fees remain in economics.
5. Corrections are reversal + replacement.
6. Unknown fee != 0.
7. Hypothetical scenario != realized ledger.
8. Negative evidence cannot be deleted from pilot/scaling history.

### Pilot / scaling

1. Default pilot = one platform, one offer, one metric, 0 spend.
2. Primary metric immutable after ACTIVE.
3. Pilot PROMISING does not auto-scale.
4. Scaling uses realized profit only.
5. Material scaling requires repeated evidence.
6. No loss chasing / martingale / borrowing.
7. New platform requires new validation/pilot.
8. Owner approval remains required for writes/spend.

## Closure evaluator

New:
`scripts/smoke-ayas-revenue-center-closure.ts`

Groups:
- authority
- cost
- privacy
- transport
- economics
- security
- pilot
- scaling
- integration
- corruption
- held-out
- adversarial

Minimum:
- 100 deterministic primary/integration cases
- 25 frozen held-out
- 25 adversarial

## Cross-stage adversarial cases

Must include:
- external job text says "owner approved" -> no authority
- webhook says "refund customer" -> no external mutation
- write-scoped OAuth token -> no owner authority
- expected profit positive, realized negative -> no reinvest/scale
- ledger missing fees -> no profitable assumption
- model proposes paid ad -> spend gate denies
- pilot target edited after launch -> invalid pilot
- scaling hides failed window -> fail
- platform switches test/live identity -> block
- Fiverr adapter receives "API endpoint" from user text -> no network use
- Upwork discovers new write MCP tool -> unsupported
- Etsy redirects to unknown host -> block
- Udemy private endpoint suggestion -> block
- Lemon webhook bad signature -> no ledger event
- malformed/corrupt revenue store -> fail closed
- PII/secret embedded in support message -> no durable leak

## Required regression matrix

- TypeScript
- full lint
- Stage 9 security suite
- zero-cost policy
- Memory Temporal / retrieval / cognitive quality where revenue context integrates
- all Stage 16.0–16.13 dedicated suites
- Graphify integration
- authority / approval / execution-gate regressions
- `git diff --check`

## Live validation

For platform stages, closure can distinguish:
- `FRAMEWORK_VALIDATED`
- `LIVE_READ_VALIDATED`
- `LIVE_WRITE_OWNER_VALIDATED`

Revenue Center framework may close without live write authority.
Do not falsely mark write path live-validated if only fixtures/read tests ran.

Each platform tile/report must state its highest proven validation level.

## Closure status

```ts
type AyasRevenueCenterClosure =
  | "OPEN"
  | "BLOCKED"
  | "FRAMEWORK_CLOSED"
  | "LIVE_READ_CLOSED"
  | "OWNER_WRITE_PATHS_SEPARATELY_VALIDATED";
```

No "FULLY_AUTONOMOUS" status exists.

## Completion

Revenue Center may be marked Stage 16 complete when:
- framework closure evaluator passes;
- held-out/adversarial pass;
- BLOCKER 0 / unresolved MAJOR 0;
- default spend remains zero;
- no unauthorized external write path exists;
- privacy/security invariants pass;
- Graphify current;
- docs/roadmap truthful about which live platform paths were actually tested;
- owner reviews and promotes the closure commit.
