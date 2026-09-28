# Stage 16.2 — Unit-Economics Ledger

## Goal

Create a durable, privacy-bounded management ledger for revenue economics.

This is NOT a bank/payment system and NOT statutory accounting.
It records evidence-backed economic events and derives per-currency unit economics.
It never moves money.

## Proposed files

- `src/lib/ayas/revenue/AyasRevenueLedger.ts`
- `src/lib/ayas/revenue/AyasRevenueEconomics.ts`
- `scripts/smoke-ayas-revenue-ledger.ts`
- `docs/AYAS_REVENUE_UNIT_ECONOMICS.md`

## Storage

Default:
`data/brain/revenue/ledger.json`

Schema:
```ts
interface AyasRevenueLedgerState {
  schemaVersion: "1";
  revision: number;
  entries: readonly AyasRevenueLedgerEntry[];
}
```

Atomic temp -> file fsync -> rename.
Exclusive writer lock / revision re-read.
Bounded maximum entries with explicit capacity refusal; never silently truncate financial history.
No automatic deletion.

## Entry model

```ts
type AyasRevenueEconomicEvent =
  | "GROSS_REVENUE"
  | "PLATFORM_FEE"
  | "PAYMENT_PROCESSING_FEE"
  | "REFUND"
  | "TAX_WITHHELD"
  | "VARIABLE_DELIVERY_COST"
  | "AD_SPEND"
  | "OTHER_COST"
  | "PAYOUT_OBSERVED"
  | "REVERSAL";

interface AyasRevenueLedgerEntry {
  schemaVersion: "1";
  entryId: string;
  platform: AyasRevenuePlatform;
  event: AyasRevenueEconomicEvent;
  amount: { valueMinor: number; currency: string };
  occurredAt: string;
  recordedAt: string;

  // opaque/hash-only identities — no raw customer name/email/address/message
  externalEventDigest: string;
  orderDigest: string | null;
  offerDigest: string | null;
  activityDigest: string | null;

  evidence: {
    source: "PLATFORM_ADAPTER" | "OWNER_IMPORT" | "SYSTEM_DERIVED";
    adapterId: string | null;
    adapterVersion: number | null;
    observedAt: string;
    evidenceDigest: string;
  };

  reversesEntryId: string | null;
  notesCode: string | null;
}
```

## Idempotency

Identity is derived from trusted normalized fields:
`platform + externalEventDigest + event + amount + occurredAt`

Exact replay is write-free and returns the original entry.
Same external event with materially different economic data => `CONFLICT`, never overwrite.

## Corrections

Existing entries are immutable.

Wrong record:
1. append `REVERSAL` referencing exact old entry;
2. append corrected event as a new entry.

A reversal:
- must reference an existing non-reversed entry;
- same currency;
- exact amount;
- can occur only once;
- cannot reverse another reversal.

## Privacy

Never store:
- customer/client name
- email
- phone
- address
- message body
- payment card/bank details
- access tokens/cookies
- raw platform JSON

External identifiers are SHA-256 digests after bounded normalization.
Secret-like text is rejected.

## Currency

No automatic FX conversion in 16.2.

All aggregates are keyed by currency.
TRY and USD must not be added together.

Future FX conversion requires a separate evidence-backed pricing source and is not part of ledger truth.

## Economic semantics

`PAYOUT_OBSERVED` is cash-flow evidence only.
It does NOT count as revenue again.

Unit economics include:
- Gross Revenue
- Refunds
- Net Revenue
- Platform Fees
- Payment Processing Fees
- Variable Delivery Costs
- Ad Spend
- Other Costs
- Contribution Profit
- Contribution Margin

Per currency:

```text
netRevenue =
  grossRevenue - refunds

variableCosts =
  platformFees
  + paymentProcessingFees
  + variableDeliveryCost
  + adSpend
  + otherCost

contributionProfit =
  netRevenue - variableCosts

contributionMargin =
  netRevenue > 0
    ? contributionProfit / netRevenue
    : null
```

`TAX_WITHHELD` is shown separately and is not silently treated as a business expense or tax advice.

## Grouping

Pure query functions may group by:
- platform
- orderDigest
- offerDigest
- activityDigest
- day/week/month
- currency

A digest is an opaque grouping key, not user-visible PII.

## Evidence quality

Each aggregate reports:
- entryCount
- earliest/latest fact time
- currency
- source coverage
- conflict/reversal count
- incompleteEvidence flag

Unknown/missing fee data means economics are `INCOMPLETE`, not profitable by assumption.

## Relationship to spend gate

Ledger observation does not authorize spend.

A recorded profit cannot bypass Stage 16.1.
Stage 16.9 may later read realized profit as one prerequisite for a separately reviewed reinvestment policy.

## Evaluator

>= 45 primary + 10 held-out:

- exact replay idempotent
- conflicting replay refused
- two-process append race lossless
- atomic write failure leaves canonical intact
- malformed ledger fails closed
- secret-like data refused
- raw PII field impossible/unknown field refused
- currencies aggregate separately
- payout not double-counted
- refund calculation
- fees calculation
- negative amount refused (event carries direction, amount is magnitude)
- unsafe integer refused
- malformed currency
- reversal exact
- double reversal refused
- reversal of reversal refused
- cross-currency reversal refused
- missing evidence => incomplete
- owner import does not gain higher trust automatically
- profit never implies spend permission

## Completion

- durable ledger + pure economics only;
- no platform network;
- no money movement;
- no PII/raw payload storage;
- race/idempotency/reversal tested;
- Graphify/TS/lint/diff/review green.
