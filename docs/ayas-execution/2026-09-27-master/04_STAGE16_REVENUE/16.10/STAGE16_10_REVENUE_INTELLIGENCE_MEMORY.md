# Stage 16.10 — Revenue Intelligence + Memory

## Goal

Give AYAS durable, temporal business memory about:
- what is being sold
- where it is being sold
- what was tried
- what actually earned money
- what failed
- what the current plan is
- what follow-up is due

without storing private customer content, credentials, bank/payment data or raw platform payloads.

This is business intelligence, not personal banking or tax memory.

## Reuse

- Stage 16.2 immutable economic ledger = source of realized money truth
- Stage 16.3 free-first validation = opportunity evidence
- Stage 16.0 adapters = platform facts
- Memory Temporal v2 semantics = current/history/supersession model
- Unified Trace = source/read provenance

Do not duplicate ledger truth inside memory.

## Proposed files

- `src/lib/ayas/revenue/AyasRevenueMemory.ts`
- `src/lib/ayas/revenue/AyasRevenueTemporal.ts`
- `src/lib/ayas/revenue/AyasRevenueIntelligence.ts`
- `src/lib/ayas/revenue/AyasRevenueRecall.ts`
- `src/lib/ayas/revenue/AyasRevenueContext.ts`
- `scripts/smoke-ayas-revenue-memory.ts`
- `scripts/smoke-ayas-revenue-intelligence.ts`
- `docs/AYAS_REVENUE_INTELLIGENCE_MEMORY.md`

## Store boundary

Default:
`data/brain/revenue/intelligence/`

Separate from:
- general conversational memory
- immutable Stage 16.2 ledger
- secrets
- raw platform caches

The intelligence store may reference ledger entry ranges/digests, but does not copy raw money events unnecessarily.

## Memory classes

```ts
type AyasRevenueMemoryKind =
  | "OFFER"
  | "PLATFORM_PLAN"
  | "EXPERIMENT"
  | "CHANNEL_DECISION"
  | "PRICING_DECISION"
  | "CUSTOMER_SEGMENT"
  | "CONTENT_PLAN"
  | "DELIVERY_PATTERN"
  | "FOLLOW_UP"
  | "LESSON_LEARNED"
  | "PERFORMANCE_SUMMARY";
```

## Explicit non-storable classes

Never persist:
- API keys/tokens/cookies
- passwords
- payment-card/bank details
- tax IDs
- personal address
- buyer/client email/phone
- raw private message bodies
- full proposals/messages when an opaque draft digest is enough
- raw platform JSON/HTML
- unrelated personal finances

If detected, candidate is rejected or reduced to a non-sensitive digest/fact.

## Fact slots / supersession

Closed exclusive slots where "current" matters:

```ts
revenue.offer.current-platform
revenue.offer.current-price:<offerDigest>:<currency>
revenue.offer.current-status:<offerDigest>
revenue.channel.current-priority:<channel>
revenue.experiment.current-state:<experimentId>
revenue.followup.current-status:<followupId>
revenue.plan.current-primary-offer
```

New trusted current values supersede older values at read time; history remains queryable.

Free text does not automatically create a slot.
A code-owned extractor/producer must choose the slot.

## Truth classes

```ts
type AyasRevenueFactClass =
  | "REALIZED_LEDGER_FACT"
  | "PLATFORM_OBSERVATION"
  | "OWNER_DECISION"
  | "VALIDATION_RESULT"
  | "SYSTEM_DERIVED"
  | "HYPOTHESIS";
```

Trust precedence is explicit by fact type.
A hypothesis can never overwrite realized ledger truth.
A newer model suggestion cannot supersede an owner decision.

## Temporal semantics

Every record carries:
- observedAt
- recordedAt
- effectiveFrom
- effectiveUntil nullable
- factKey nullable
- temporalState derived: current / historical / future / disputed / superseded

Queries:
- current plan
- previous plan
- as-of date
- "what changed?"
- "what worked?"
- "what failed?"
- "what should be followed up?"

Historical queries never overwrite current truth.

## Intelligence read model

Pure derived outputs:

```ts
interface AyasRevenueIntelligenceSnapshot {
  asOf: string;
  currentPrimaryOffer: string | null;
  channels: readonly ChannelSummary[];
  offers: readonly OfferSummary[];
  experiments: readonly ExperimentSummary[];
  realizedEconomicsByCurrency: readonly CurrencySummary[];
  followUps: readonly FollowUpSummary[];
  warnings: readonly RevenueWarning[];
  evidenceFreshness: "CURRENT" | "AGING" | "STALE" | "INCOMPLETE";
}
```

No single overall "success score" decides action authority.

## Revenue warnings

Examples:
- revenue falling while activity rises
- fees incomplete
- repeat refunds
- channel has effort but zero realized sales
- stale market evidence
- offer still planned after owner superseded it
- paid experiment has no closed outcome
- duplicate content/product effort across channels
- unresolved rights/licensing issue
- follow-up overdue

Warnings are advisory only.

## Conversation integration

AYAS chat may receive a compact revenue context block:
- current owner-approved plan
- latest realized economics summary
- active experiments
- next due follow-up
- known blockers

Never inject:
- raw customer messages
- secrets
- all historical records
- bank/payout details not needed for the question

User's current request overrides remembered presentation preferences, not economic truth.

## Recall rules

For questions like:
- "Şu an ne satıyoruz?"
- "Etsy planından vazgeçmiş miydik?"
- "Geçen ay hangi kanal daha çok kazandırdı?"
- "Upwork'ta neyi denedik?"
- "En son hangi teklif üzerinde karar verdik?"

the resolver:
1. detects current/history/as-of intent;
2. selects matching fact slots;
3. uses ledger only for realized economics;
4. rejects stale/superseded current facts;
5. reports uncertainty if evidence incomplete.

## No autonomous business decisions

Intelligence can:
- summarize
- compare
- flag
- suggest owner review
- produce local drafts

It cannot:
- submit
- publish
- message
- spend
- change price
- choose a platform and act

## Evaluator

>= 60 primary + 15 frozen held-out:
- current offer supersession
- historical offer recall
- pricing decision supersession
- owner decision beats hypothesis
- ledger fact beats model estimate
- future plan not current
- disputed facts
- deleted/closed offer not resurrected
- follow-up state
- stale evidence warning
- channel comparison by same currency
- cross-currency no false ranking
- raw PII rejected
- secret rejected
- message body not persisted
- raw platform JSON rejected
- digest linkage
- as-of queries
- Turkish temporal phrasing
- plan correction
- user asks current after historical turn
- model suggestion cannot mutate memory
- duplicate event collapse
- corrupted record fail closed
- bounded context output
- no authority imports

## Completion

- privacy-bounded temporal revenue memory
- ledger remains money source of truth
- current/history/as-of correctness
- no PII/secrets/raw platform payload persistence
- compact chat context integration
- advisory-only intelligence
- Graphify/TS/lint/memory/retrieval/security/review green.
