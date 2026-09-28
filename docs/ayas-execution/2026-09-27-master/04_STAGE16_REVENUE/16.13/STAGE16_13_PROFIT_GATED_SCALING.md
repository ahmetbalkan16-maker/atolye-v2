# Stage 16.13 — Profit-Gated Scaling

## Goal

Scale only what has proven itself with realized evidence.

Scaling is not:
- spending more because a pilot failed;
- chasing losses;
- extrapolating from clicks/views;
- using expected revenue as cash;
- opening multiple platforms at once without evidence.

Scaling remains advisory until explicit owner approval.

## Reuse

- Stage 16.2 realized ledger
- Stage 16.9 reinvestment policy
- Stage 16.10 revenue intelligence
- Stage 16.11 security/fraud
- Stage 16.12 pilot verdict

## Proposed files

- `src/lib/ayas/revenue/scaling/AyasRevenueScaling.ts`
- `src/lib/ayas/revenue/scaling/AyasRevenueScalingPolicy.ts`
- `src/lib/ayas/revenue/scaling/AyasRevenueScalingPlan.ts`
- `scripts/smoke-ayas-revenue-profit-gated-scaling.ts`
- `docs/AYAS_REVENUE_PROFIT_GATED_SCALING.md`

## Scaling readiness

```ts
type AyasRevenueScalingStatus =
  | "NOT_ELIGIBLE"
  | "MORE_EVIDENCE_REQUIRED"
  | "CAPACITY_BLOCKED"
  | "SECURITY_BLOCKED"
  | "ECONOMICS_BLOCKED"
  | "OWNER_REVIEW_ELIGIBLE";
```

Never `AUTO_SCALE`.

## Required evidence

All required:
1. completed Stage 16.12 pilot;
2. pilot verdict PROMISING;
3. primary metric met without changing metric mid-run;
4. realized contribution profit > 0 in same currency;
5. no unresolved refunds/fees that could erase profit;
6. no security/fraud high/blocking finding;
7. delivery quality acceptable;
8. support burden/capacity measured;
9. free-first opportunities exhausted/reviewed;
10. Stage 16.9 reinvestment policy explicitly enabled for nonzero spend;
11. owner-reviewed ceiling exists if scaling needs money.

## Repeatability

One lucky result is not enough for aggressive scaling.

Evidence levels:
- `SINGLE_PILOT`
- `REPEATED_RESULT`
- `MULTI_WINDOW_STABLE`

Default:
- single pilot may justify only a next bounded pilot/repetition;
- paid/material scale requires repeated result;
- broader channel scale requires multi-window stability.

No statistical certainty claim beyond observed evidence.

## Scaling dimensions

A plan may change one primary dimension at a time:
- volume
- number of listings/offers
- number of proposals
- production frequency
- geographic/language scope
- price experiment
- paid acquisition budget
- platform expansion

Changing multiple dimensions simultaneously is blocked unless owner explicitly approves an experimental design.

## Scaling plan

```ts
interface AyasRevenueScalingPlan {
  schemaVersion: "1";
  planId: string;
  sourcePilotIds: readonly string[];
  platform: AyasRevenuePlatform;
  offerDigest: string;
  scalingDimension: AyasScalingDimension;
  currentLevel: number;
  proposedLevel: number;
  realizedProfitEvidence: {
    currency: string;
    valueMinor: number;
    windowFrom: string;
    windowTo: string;
  };
  requiredBudget: { valueMinor: number; currency: string } | null;
  maxDownside: { valueMinor: number; currency: string } | null;
  rollbackConditionCodes: readonly string[];
  ownerApprovalRequired: true;
  executionAuthority: "NONE";
}
```

## Growth ceilings

Code-level safety ceiling:
- one step cannot increase a bounded numeric scale dimension by more than 2x;
- a 2x ceiling is NOT a recommendation; it is a maximum technical bound.

Paid budget additionally limited by Stage 16.9.
If 16.9 says 0, paid scale plan is blocked.

## Stop / rollback signals

A scaling plan includes exact rollback/stop criteria:
- contribution profit turns negative
- refund rate exceeds pilot baseline beyond reviewed threshold
- security/fraud finding
- delivery SLA/quality breach
- support backlog exceeds capacity
- platform warning/restriction
- rights/licensing issue
- unexpected fee/cost
- metric deterioration beyond declared bound

AYAS may recommend stopping; destructive external rollback actions remain owner-controlled.

## Loss discipline

Explicitly prohibited:
- doubling budget after loss
- "recover losses" scaling
- borrowing/credit
- using future revenue
- moving money between currencies as if equal
- hiding refunds
- excluding failed periods
- restarting pilot clock to discard bad data

## Platform expansion

Adding a new platform is treated as a new validation/pilot, not "scale" of an existing platform.

Cross-platform success does not transfer automatically because:
- fee model differs
- audience differs
- policy differs
- conversion mechanics differ

## Pricing scale

Price changes are experiments:
- current price fact and exact new price bound;
- currency same;
- owner approval for external write;
- no false claim that higher price = higher profit;
- after-change results separately measured.

## Evaluator

>= 55 primary + 15 held-out:
- positive realized profit
- expected profit rejected
- unresolved refund blocks
- security blocks
- single pilot only => repeat, not material scale
- repeated result eligible
- paid scaling 16.9 disabled => blocked
- one dimension only
- >2x step refused
- loss-recovery doubling refused
- future revenue refused
- cross-currency refused
- new platform becomes new pilot
- rollback conditions required
- owner approval required
- plan authority NONE
- price experiment separation
- failed windows retained
- support capacity block
- delivery quality block
- fee increase blocks
- profit calculation uses ledger only

## Completion

- realized-profit-only scaling policy;
- repeatability gate;
- capacity/security/economics gates;
- no martingale/loss chasing;
- no autonomous spend/write;
- owner review plan only;
- Graphify/TS/lint/security/review green.
