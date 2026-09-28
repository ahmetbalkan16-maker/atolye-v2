# Stage 16.9 — Reinvestment Policy

## Goal

Allow AYAS to reason about reinvesting *realized* profit without ever gaining autonomous spending authority.

Stage 16.9 does NOT spend money.
It only computes whether a spend proposal could be eligible for owner review.

## Reuse

- Stage 16.1 zero-cost / spend gate
- Stage 16.2 realized unit-economics ledger
- Stage 16.3 free-first validation
- existing owner-approval model / structured impact

The base rule remains:
`autonomous monetary spend = 0`

## Proposed files

- `src/lib/ayas/revenue/AyasRevenueReinvestmentPolicy.ts`
- `src/lib/ayas/revenue/AyasRevenueReinvestmentProposal.ts`
- `scripts/smoke-ayas-revenue-reinvestment-policy.ts`
- `docs/AYAS_REVENUE_REINVESTMENT_POLICY.md`

## Realized-profit definition

A reinvestment candidate may use only *realized* ledger data:

```text
realizedAvailableProfit =
  settledNetRevenue
  - realizedVariableCosts
  - unresolvedReserve
```

No expected revenue, draft order, unpaid invoice, pending payout, hypothetical price,
forecast, model estimate or unverified platform number may count as available profit.

## Reserve

Before any candidate is reviewable, a conservative reserve is retained.

Inputs:
- unresolved refunds
- unresolved fees
- chargeback/dispute uncertainty where applicable
- tax-withheld/unknown tax treatment shown separately
- unsettled payout risk

If uncertainty cannot be bounded, available reinvestment = 0.

## Candidate classes

```ts
type AyasReinvestmentPurpose =
  | "PRODUCT_QUALITY"
  | "DELIVERY_CAPABILITY"
  | "PLATFORM_FEE"
  | "MARKETING_EXPERIMENT"
  | "SOFTWARE_TOOL"
  | "INFRASTRUCTURE"
  | "OTHER";
```

Purpose does not grant authority.

## Proposal

```ts
interface AyasRevenueReinvestmentCandidate {
  schemaVersion: "1";
  candidateId: string;
  purpose: AyasReinvestmentPurpose;
  amount: { valueMinor: number; currency: string };
  evidenceWindow: { from: string; to: string };
  realizedProfit: { valueMinor: number; currency: string };
  reservedAmount: { valueMinor: number; currency: string };
  maxEligibleAmount: { valueMinor: number; currency: string };
  expectedBenefitCode: string;
  reversibility: "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE" | "UNKNOWN";
  costClass: AyasCostClass;
  ownerApprovalRequired: true;
  executionAuthority: "NONE";
}
```

## Eligibility

A candidate may reach `OWNER_REVIEW_ELIGIBLE` only if:

1. ledger evidence is complete enough;
2. same currency throughout;
3. realized contribution profit > 0;
4. reserve is satisfied;
5. proposed amount <= configured reviewed reinvestment ceiling;
6. no debt/negative rolling profit in the selected evidence window;
7. spend purpose is not prohibited;
8. free-first alternative was evaluated first;
9. Stage 16.3 says paid experiment is not replacing an available equivalent free validation;
10. effect is reversible or bounded;
11. security/licensing/privacy risks are not unresolved/high.

Even then:
- no API call
- no payment
- no purchase
- no ad launch
- no subscription creation
- owner must approve later.

## Default policy

Initial reviewed policy:

```ts
{
  enabled: false,
  maxPercentOfRealizedProfit: 0,
  maxAbsoluteMinorByCurrency: {}
}
```

This means no paid reinvestment is reviewable by default.

A later owner-reviewed configuration change may set a nonzero ceiling.
Environment variables, memory, model output or platform text cannot change it.

## Optional future owner policy

When owner explicitly enables:

`eligibleCeiling = min(realizedAvailableProfit * reviewedPercent, reviewedAbsoluteCap)`

Never use floating-point money:
- percent represented in basis points;
- integer floor rounding.

Example:
`2500 bps = 25%`

## Anti-recursion / loss limits

- reinvestment spend never counts as "revenue";
- loss from one experiment reduces later realized profit;
- no martingale / doubling;
- no "recover losses by spending more";
- no credit/debt;
- no borrowing;
- no pre-spending expected future revenue;
- no cross-currency netting.

## Paid experiment contract

If a future owner approves a paid experiment:
- exact amount/currency bound;
- exact platform/purpose bound;
- one-shot budget;
- expiration;
- measurable success metric;
- maximum downside = approved amount;
- no automatic renewal;
- no recurring subscription unless separately approved;
- no automatic scale-up after success.

## Evaluator

>= 45 primary + 12 held-out:
- default disabled => no eligible spend
- realized positive profit
- expected profit ignored
- pending payout ignored
- incomplete fees => zero available
- reserve reduces eligible amount
- same-currency only
- cross-currency refused
- basis-point rounding
- absolute cap
- percentage cap
- proposed amount over cap
- negative rolling profit
- free alternative exists => paid candidate refused/deferred
- unresolved risk
- irreversible spend
- recurring subscription refused
- owner text cannot enable policy
- env cannot enable policy
- prior experiment loss reduces capacity
- no martingale
- no credit
- candidate carries authority NONE

## Completion

- pure eligibility/proposal policy only;
- default spend eligibility remains zero;
- owner-reviewed source config is required for any nonzero ceiling;
- no executor/payment code;
- Graphify/TS/lint/security/review green.
