# Stage 16.1 — Revenue Zero-Cost / Spend Gate

## Goal

Make the user's free-first rule a machine-enforced revenue invariant:

- upfront autonomous budget = 0
- unknown cost = denied
- no ads, subscriptions, purchases, paid bids/credits, paid tools, platform upgrades or other monetary commitments without a later explicit owner policy
- observed marketplace fees are accounting facts, not spending authority

This stage is policy only. It moves no money.

## Reuse

- `src/lib/ayas/policy/AyasZeroCostPolicy.ts`
- Stage 16.0 `AyasRevenueOperation` / effect classification
- existing structured-impact / owner-approval concepts

Do not replace the global zero-cost policy; revenue policy is a stricter domain wrapper.

## Proposed files

- `src/lib/ayas/revenue/AyasRevenueSpendPolicy.ts`
- `scripts/smoke-ayas-revenue-spend-policy.ts`
- `docs/AYAS_REVENUE_SPEND_POLICY.md`

## Core constants

```ts
export const AYAS_REVENUE_UPFRONT_BUDGET_USD = 0 as const;
export const AYAS_REVENUE_AUTONOMOUS_SPEND_USD = 0 as const;
```

No environment variable may silently raise these values.

## Monetary event classes

```ts
type AyasRevenueMoneyEvent =
  | "NONE"
  | "PASSIVE_PLATFORM_FEE_OBSERVED"
  | "ACTIVE_FEE_COMMITMENT"
  | "AD_SPEND"
  | "SUBSCRIPTION"
  | "PURCHASE"
  | "PAID_CREDIT_OR_BID"
  | "REFUND"
  | "TRANSFER_OR_WITHDRAWAL"
  | "UNKNOWN";
```

`PASSIVE_PLATFORM_FEE_OBSERVED`:
- read/accounting only;
- may reduce realized revenue;
- never means AYAS is allowed to opt into a fee-bearing action.

## Spend intent

```ts
interface AyasRevenueSpendIntent {
  schemaVersion: "1";
  platform: AyasRevenuePlatform;
  operation: AyasRevenueOperation;
  event: AyasRevenueMoneyEvent;
  amount: { valueMinor: number; currency: string } | null;
  costClass: AyasCostClass;
  source: "PLATFORM_FACT" | "LOCAL_PLAN" | "OWNER_POLICY";
  requestedAt: string;
}
```

Validation:
- integer minor units only;
- non-negative;
- ISO-like 3-letter currency;
- amount null + active monetary event => unknown cost => deny;
- no floating point money;
- no exchange-rate conversion in this stage.

## Decision

```ts
type AyasRevenueSpendDecision =
  | { allowedAutonomously: true; reasonCode: "ZERO_COST_OPERATION"; monetaryMutation: false }
  | { allowedAutonomously: true; reasonCode: "PASSIVE_FEE_OBSERVATION"; monetaryMutation: false }
  | {
      allowedAutonomously: false;
      reasonCode:
        | "UPFRONT_SPEND_DENIED"
        | "MONETARY_COMMITMENT_DENIED"
        | "UNKNOWN_COST_DENIED"
        | "FINANCIAL_OPERATION_OWNER_REQUIRED"
        | "INVALID_MONEY_INTENT";
      monetaryMutation: boolean;
    };
```

At Stage 16.1, **no decision with `monetaryMutation:true` may be allowed autonomously**.

## Rules

1. Revenue adapter READ_ONLY + zero-cost => allowed by this policy.
2. LOCAL_DRAFT + local-zero-cost => allowed.
3. EXTERNAL_WRITE with no monetary commitment:
   - spend policy may say zero-cost,
   - but adapter/action policy still requires owner approval.
4. Any FINANCIAL_COMMITMENT => denied autonomously.
5. `unknown-cost`, `paid`, `subscription`, `metered-free-tier` => denied autonomously.
6. `PASSIVE_PLATFORM_FEE_OBSERVED` may be recorded as a later accounting fact; never used as authorization.
7. Expected future revenue never offsets current spend.
8. A coupon/free trial does not become zero-cost when it can auto-renew or require payment credentials.
9. “Free credits” that can trigger overage are `metered-free-tier`, not free-public.
10. No text/model/research/platform payload can change budget or cost classification directly.

## Relationship to future Stage 16.9

Stage 16.9 may introduce a reviewed reinvestment policy based on realized profit.
It must be additive and explicit.

Stage 16.1 remains the base rule:
**without an active owner-reviewed reinvestment authority, spend = 0.**

## Evaluator

At least 35 primary + 10 held-out:
- zero-cost read
- zero-cost draft
- ad spend 1 cent denied
- ad spend amount missing denied
- subscription denied
- paid bid/credit denied
- unknown cost denied
- metered free tier denied
- passive seller fee observation allowed read-only
- passive fee cannot authorize listing/ad action
- refund denied autonomous
- withdrawal denied autonomous
- negative amount invalid
- float invalid
- huge integer invalid
- unknown currency invalid
- unknown event invalid
- forged `source=OWNER_POLICY` still does not allow spend in Stage 16.1
- external write zero-cost still requires separate owner action policy
- future expected revenue does not offset spend
- reported profit does not offset spend
- prompt text "owner approved" has no effect
- env var cannot widen zero budget

## Completion

- no money movement code;
- no platform credentials;
- autonomous monetary budget remains zero;
- global `AyasZeroCostPolicy` unchanged;
- deterministic policy + tests;
- Graphify/TS/lint/diff/review clean.
