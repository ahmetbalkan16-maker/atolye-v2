# Stage 16.12 — Low-Cost Pilot

## Goal

Run the first real revenue validation as a deliberately tiny, reversible pilot.

Default pilot policy:
- one platform
- one offer
- one acquisition path
- one owner-defined success metric
- autonomous spend = 0
- no paid scaling
- no multi-platform launch
- no automatic external writes
- fixed duration / bounded sample
- evidence-first closure

The pilot is not "launch everything"; it is a controlled experiment.

## Reuse

- Stage 16.0 Adapter Standard
- Stage 16.1 Zero-Cost / Spend Gate
- Stage 16.2 Unit-Economics Ledger
- Stage 16.3 Free-First Validation
- Stage 16.10 Revenue Intelligence
- Stage 16.11 Security/Fraud Guard
- existing owner approval / trace model

## Proposed files

- `src/lib/ayas/revenue/pilot/AyasRevenuePilot.ts`
- `src/lib/ayas/revenue/pilot/AyasRevenuePilotPolicy.ts`
- `src/lib/ayas/revenue/pilot/AyasRevenuePilotEvaluation.ts`
- `src/lib/ayas/revenue/pilot/AyasRevenuePilotStore.ts`
- `src/lib/ayas/revenue/pilot/AyasRevenuePilotHandoff.ts`
- `scripts/smoke-ayas-revenue-low-cost-pilot.ts`
- `docs/AYAS_REVENUE_LOW_COST_PILOT.md`

## Pilot model

```ts
type AyasRevenuePilotState =
  | "DRAFT"
  | "OWNER_REVIEW"
  | "READY"
  | "ACTIVE"
  | "PAUSED"
  | "COMPLETED"
  | "CANCELLED"
  | "INVALIDATED";

interface AyasRevenuePilot {
  schemaVersion: "1";
  pilotId: string;
  platform: AyasRevenuePlatform;
  offerDigest: string;
  validationSnapshotDigest: string;
  objectiveCode: string;
  successMetric: AyasRevenuePilotMetric;
  startAt: string | null;
  stopAt: string | null;
  maxDurationDays: number;
  maxExternalWrites: number;
  spendBudgetMinor: 0;
  currency: string | null;
  state: AyasRevenuePilotState;
  ownerApprovalRequired: true;
  executionAuthority: "NONE";
}
```

## Metric vocabulary

One pilot has one primary metric:

```ts
type AyasRevenuePilotMetric =
  | { kind: "QUALIFIED_LEADS"; target: number }
  | { kind: "OWNER_APPROVED_PROPOSALS"; target: number }
  | { kind: "SALES"; target: number }
  | { kind: "PAID_ORDERS"; target: number }
  | { kind: "COURSE_ENROLLMENTS"; target: number }
  | { kind: "CONVERSION_RATE"; numerator: string; denominator: string; targetBps: number };
```

Supporting metrics may be observed, but cannot move the goalpost after start.

## Pilot admission

A pilot can reach READY only if:
- Stage 16.3 = PILOT_CANDIDATE or owner-reviewed equivalent;
- all known costs are zero or passive platform fees only;
- Stage 16.1 permits zero-cost operation;
- adapter transport is supported;
- Stage 16.11 has no unresolved BLOCKING risk;
- rights/licensing complete;
- offer/deliverable is ready;
- success metric fixed before first external action;
- stop condition fixed;
- exact external actions listed;
- owner explicitly approves the pilot plan.

## External actions

Stage 16.12 itself never invents new platform authority.

Allowed only through the platform adapter's already-reviewed action policy.

Examples:
- owner manually publishes a Fiverr Gig
- owner manually uploads/publishes Udemy course
- owner explicitly approves an Etsy listing publication path if that write path has separately been opened
- owner explicitly submits one Upwork proposal if the Upwork action policy and cost/Connects status permit it
- owner explicitly creates a Lemon Squeezy product/checkout only if its live write path was separately opened

If write path is not open, pilot remains a manual handoff.

## Action budget

Default:
- `maxExternalWrites = 1`
- `spendBudgetMinor = 0`

A pilot cannot silently expand.

Each action has:
- actionId
- exact platform/resource/offer binding
- action digest
- owner decision
- performed evidence
- observed result
- idempotency record

## Duration

Default max duration:
- 14 days

Maximum code ceiling:
- 30 days

Owner can choose shorter.
Extending a pilot creates a reviewed new revision; no silent extension.

## Evidence collection

Allowed observations:
- listing/course/product state
- proposals submitted by owner
- qualified lead count
- orders/sales
- refunds
- platform fees
- support burden
- delivery effort
- realized contribution economics

No vanity metric may substitute for the primary success metric.

Views/clicks/likes may be supporting evidence only.

## Pilot economics

The pilot uses Stage 16.2 realized ledger truth.

Report by currency:
- realized gross
- refunds
- fees
- contribution profit
- effort proxy / delivery count
- success metric result

No FX aggregation.

## Early stop conditions

Automatically recommend PAUSE/BLOCK (not execute destructive action) when:
- fraud/security blocker
- unexpected monetary commitment
- rights/licensing issue
- account restriction
- repeated refund/problem signal
- platform policy concern
- deliverable quality failure
- primary metric becomes invalid/unmeasurable
- canonical evidence source unavailable

Owner may cancel at any time.

## Closure outcomes

```ts
type AyasRevenuePilotVerdict =
  | "PROMISING"
  | "INCONCLUSIVE"
  | "NOT_VALIDATED"
  | "ECONOMICALLY_NEGATIVE"
  | "SECURITY_BLOCKED"
  | "POLICY_BLOCKED"
  | "INVALID_PILOT";
```

No verdict automatically scales.

PROMISING means only:
- metric met or strongly evidenced,
- no safety violation,
- economics complete enough,
- contribution result non-negative,
- no unresolved high risk.

It becomes input to Stage 16.13 only.

## Anti-cherry-picking

- metric cannot change after ACTIVE;
- start/stop times immutable after activation;
- failed actions stay in history;
- refunds remain counted;
- no deletion of negative observations;
- extensions are new revisions;
- duplicate/replay observations deduped by evidence digest.

## Store

Durable pilot records:
`data/brain/revenue/pilots/`

Atomic/fail-closed.
State transition CAS.
Tests use TEMP root only.

## Evaluator

>= 55 primary + 15 held-out:
- one platform only
- one primary metric
- zero spend
- cost unknown blocks
- owner approval required
- max one write default
- no silent budget expansion
- duration ceiling
- immutable active metric
- immutable start
- security early-stop
- fee/refund economics
- incomplete economics => inconclusive
- sales target met
- vanity metric cannot replace sales
- owner cancellation
- duplicate action
- replay result
- cross-currency no aggregation
- pilot verdict no scale authority
- extension creates revision
- negative observations preserved
- raw PII not stored
- no platform action bypass
- no fake owner-completion inference

## Completion

- one bounded zero-spend pilot framework;
- no new platform executor;
- no autonomous external write/spend;
- measurable closure;
- immutable negative evidence;
- Stage 16.13 receives advisory verdict only;
- Graphify/TS/lint/security/review green.
