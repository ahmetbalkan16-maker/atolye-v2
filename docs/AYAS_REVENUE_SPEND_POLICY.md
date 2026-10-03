# AYAS Revenue Spend Policy (Stage 16.1)

The free-first rule as a machine-enforced revenue invariant. Policy only: it moves no money and adds no
payment, account or platform executor. Code: `src/lib/ayas/revenue/AyasRevenueSpendPolicy.ts`.
Evaluator: `scripts/smoke-ayas-revenue-spend-policy.ts` (40 primary + 10 frozen held-out) and its
negative controls. The global `AyasZeroCostPolicy` is unchanged; this is a stricter revenue wrapper.

## Constants

`AYAS_REVENUE_UPFRONT_BUDGET_USD = 0` and `AYAS_REVENUE_AUTONOMOUS_SPEND_USD = 0` are literal constants.
Nothing reads the environment; no variable, payload, model, research or platform text can raise them.

## Intent

`{ schemaVersion, platform, operation, event, amount, costClass, source, requestedAt }`, exact keys.
`amount` is `null` or `{ valueMinor, currency }`: a non-negative safe integer of minor units up to 10^12
and an ISO 4217 code from a closed list. No floating-point money, no exchange-rate conversion. There is
no field for a budget, a balance, expected revenue or profit, so none of them can offset spend.

Money events: `NONE`, `PASSIVE_PLATFORM_FEE_OBSERVED`, `ACTIVE_FEE_COMMITMENT`, `AD_SPEND`,
`SUBSCRIPTION`, `PURCHASE`, `PAID_CREDIT_OR_BID`, `REFUND`, `TRANSFER_OR_WITHDRAWAL`, `UNKNOWN`.

## Decision order (`decideAyasRevenueSpend`, one input)

1. Malformed intent → `INVALID_MONEY_INTENT`
2. FINANCIAL_COMMITMENT operation → `FINANCIAL_OPERATION_OWNER_REQUIRED`
3. `UNKNOWN` event → `UNKNOWN_COST_DENIED`
4. Active monetary event: no amount → `UNKNOWN_COST_DENIED`; amount > 0 → `UPFRONT_SPEND_DENIED`;
   amount 0 → `MONETARY_COMMITMENT_DENIED` (a free trial that can renew is a subscription)
5. Cost class `unknown-cost` → `UNKNOWN_COST_DENIED`; `paid`, `subscription`, `metered-free-tier`
   (free credits that can overrun) → `MONETARY_COMMITMENT_DENIED`
6. `PASSIVE_PLATFORM_FEE_OBSERVED`: only on a READ_ONLY operation (next to a write or a draft it is a
   fee-bearing action → `MONETARY_COMMITMENT_DENIED`), only as a `PLATFORM_FACT` with an amount
   (otherwise `INVALID_MONEY_INTENT`) → `PASSIVE_FEE_OBSERVATION`: an accounting fact, never authorization
7. `NONE` with a non-zero amount → `INVALID_MONEY_INTENT`; a local draft not at `local-zero-cost` →
   `INVALID_MONEY_INTENT`
8. Otherwise → `ZERO_COST_OPERATION`

An allowed decision always has `monetaryMutation: false`, `budgetUsd: 0` and `grantsActionAuthority:
false`: a zero-cost external write is spend-neutral but still `REQUIRE_OWNER` under the Stage 16.0 action
policy. An `OWNER_POLICY` source changes nothing in Stage 16.1; a later reviewed reinvestment policy
(Stage 16.9) must be additive and explicit — without it, spend is 0.

The intent and nested amount descriptors are validated before copying; getters are not executed and a hostile Proxy exception becomes INVALID_MONEY_INTENT. Reads accept both globally allowed zero-cost classes (including offline/local adapters). The read/draft runner applies the spend gate before dispatch.
