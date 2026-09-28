# Stage 16.3 — Free-First Revenue Validation

## Goal

Before AYAS invests money or performs external revenue writes, validate a revenue idea using only:
- local capabilities
- read-only evidence
- free-public or local-zero-cost sources
- local drafts/simulations

No listing publish, proposal submit, paid bid, ad spend, subscription or purchase.

## Proposed files

- `src/lib/ayas/revenue/AyasRevenueOpportunity.ts`
- `src/lib/ayas/revenue/AyasRevenueValidation.ts`
- `src/lib/ayas/revenue/AyasRevenueScenarioEconomics.ts`
- `scripts/smoke-ayas-revenue-free-first-validation.ts`
- `docs/AYAS_REVENUE_FREE_FIRST_VALIDATION.md`

## Revenue opportunity model

```ts
type AyasRevenueOfferType =
  | "DIGITAL_PRODUCT"
  | "FREELANCE_SERVICE"
  | "COURSE"
  | "CONTENT_ASSET"
  | "OTHER";

interface AyasRevenueOpportunity {
  schemaVersion: "1";
  opportunityId: string;
  platform: AyasRevenuePlatform | "MULTI";
  offerType: AyasRevenueOfferType;
  capabilityKeys: readonly string[];
  deliverableClass: string;
  targetMarketCode: string | null;
  hypothesis: {
    problemCode: string;
    valuePropositionCode: string;
    priceScenario: { valueMinor: number; currency: string } | null;
  };
  observedAt: string;
  authority: "NONE";
}
```

Free text from web/model never becomes a platform action/path/command.
Descriptive prose, if retained, is bounded neutralized evidence only.

## Evidence classes

```ts
type AyasRevenueValidationEvidenceKind =
  | "LOCAL_CAPABILITY"
  | "LOCAL_DELIVERABLE_PROOF"
  | "PUBLIC_DEMAND_SIGNAL"
  | "PUBLIC_COMPETITION_SIGNAL"
  | "PLATFORM_READ_ONLY_SIGNAL"
  | "OWNER_INTEREST_SIGNAL"
  | "REALIZED_LEDGER_SIGNAL";
```

Every evidence record carries:
- source class
- observedAt
- freshness
- costClass
- confidence
- digest/reference
- facts, never executable instructions

Paid/unknown-cost evidence cannot satisfy free-first validation.

## Validation dimensions

1. capability readiness
2. deliverable readiness
3. demand evidence
4. competition saturation
5. differentiation
6. zero-cost launch feasibility
7. estimated unit economics
8. platform/account prerequisites
9. legal/licensing/rights uncertainty
10. evidence freshness

## Status

```ts
type AyasRevenueValidationStatus =
  | "BLOCKED"
  | "INSUFFICIENT_EVIDENCE"
  | "RESEARCH_REQUIRED"
  | "FREE_VALIDATION_READY"
  | "PILOT_CANDIDATE"
  | "DO_NOT_PURSUE"
  | "OWNER_REVIEW_REQUIRED";
```

No status means publish/submit/spend authority.

## Conservative rules

`PILOT_CANDIDATE` requires:
- local deliverable capability AVAILABLE;
- no paid/unknown prerequisite;
- at least one current demand signal;
- at least one competition/differentiation signal;
- no unresolved security/licensing/rights blocker;
- price scenario is explicitly hypothetical;
- estimated contribution result is not negative under known costs;
- evidence is fresh enough for the platform category.

If fees are unknown, status cannot exceed `OWNER_REVIEW_REQUIRED` or `RESEARCH_REQUIRED`.

## Scenario economics

Hypothetical economics are separate from realized Stage 16.2 ledger.

`AyasRevenueScenarioEconomics` may compute:
- hypothetical price
- known platform fee scenario
- known delivery cost
- gross/net/contribution per unit

It MUST label every value:
- `OBSERVED`
- `ASSUMED`
- `UNKNOWN`

No assumed value enters the realized ledger.

## Free validation actions

Allowed at 16.3:
- read local portfolio/capabilities
- read public/free evidence through an already-approved read adapter
- produce local listing/proposal/course drafts
- compare scenarios
- recommend owner review

Not allowed:
- create account
- connect payment account
- publish listing/course
- submit proposal
- message customer
- accept order
- purchase credits
- ads
- paid tools
- any financial commitment

## Anti-self-deception rules

- no single evidence source can prove demand;
- absence of competition is not automatically positive;
- high listing count is not demand by itself;
- model opinion is not market evidence;
- old evidence is down-ranked/refused;
- missing fee data is not assumed zero;
- expected revenue is not realized revenue;
- validation score cannot be converted into execution authority.

## Evaluator

>= 50 primary + 12 frozen held-out:
- strong free evidence -> PILOT_CANDIDATE
- only model suggestion -> INSUFFICIENT
- local capability missing -> BLOCKED
- paid prerequisite -> BLOCKED
- unknown fee -> owner/research, not pilot
- stale demand signal
- one-source demand
- duplicated source
- competition without demand
- hypothetical economics separated from ledger
- assumed cost marked assumed
- negative scenario -> DO_NOT_PURSUE
- rights uncertainty blocks digital asset
- no action authority in every result
- external directive injection neutralized
- platform operation cannot be chosen by evidence text
- no network in pure evaluator

## Completion

- pure validation engine;
- no live external write;
- no spend;
- no realized-ledger contamination;
- deterministic evaluator/held-out;
- Graphify/TS/lint/security/review green.
