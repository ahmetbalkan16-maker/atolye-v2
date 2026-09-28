# Stage 16.0 — Revenue Platform Adapter Standard
Base design: `wip/ayas-graphify-final-execution` @ `035b4076faa1100224c64f4d1ffa3e8346ffc058`

## Goal

Create ONE platform-neutral contract that every later revenue platform integration must implement.

This stage adds no Etsy/Upwork/Fiverr/Udemy/Lemon Squeezy network code, no credentials,
no account automation and no monetary authority.

## New module boundary

`src/lib/ayas/revenue/`

Proposed files:
- `AyasRevenuePlatformTypes.ts`
- `AyasRevenuePlatformAdapter.ts`
- `AyasRevenuePlatformRegistry.ts`
- `AyasRevenueActionPolicy.ts`
- `AyasRevenueRedaction.ts`
- `AyasRevenuePlatformFakeAdapter.ts` (test-only or fixtures)
- `scripts/smoke-ayas-revenue-adapter-standard.ts`
- `docs/AYAS_REVENUE_ADAPTER_STANDARD.md`

No import from revenue modules into approval/execution/production code in this stage.

## Closed platform identity

```ts
export const AYAS_REVENUE_PLATFORMS = [
  "etsy",
  "upwork",
  "fiverr",
  "udemy",
  "lemon-squeezy",
] as const;
```

Unknown platforms are `UNKNOWN`/refused, never silently treated as compatible.

## Operation vocabulary

Read operations:
- `ACCOUNT_STATUS_READ`
- `OPPORTUNITY_LIST_READ`
- `LISTING_LIST_READ`
- `ORDER_LIST_READ`
- `MESSAGE_LIST_READ`
- `PAYOUT_LIST_READ`
- `ANALYTICS_READ`

Local-only draft operations:
- `LISTING_DRAFT`
- `PROPOSAL_DRAFT`
- `COURSE_DRAFT`
- `MESSAGE_DRAFT`
- `DELIVERABLE_DRAFT`

External mutation operations:
- `LISTING_CREATE`
- `LISTING_UPDATE`
- `PROPOSAL_SUBMIT`
- `COURSE_PUBLISH`
- `MESSAGE_SEND`
- `ORDER_ACCEPT`
- `DELIVERABLE_SUBMIT`

Financial operations:
- `PURCHASE`
- `AD_SPEND`
- `FEE_COMMIT`
- `REFUND`
- `FUNDS_WITHDRAW`

Financial operations exist in the vocabulary so they can be explicitly DENIED; Stage 16.0 implements no executor for them.

## Effect classes

Each operation maps to exactly one:
- `READ_ONLY`
- `LOCAL_DRAFT`
- `EXTERNAL_WRITE`
- `FINANCIAL_COMMITMENT`

Policy:
- READ_ONLY: may be eligible when adapter is connected and safe.
- LOCAL_DRAFT: local zero-cost only.
- EXTERNAL_WRITE: owner approval required in a later stage.
- FINANCIAL_COMMITMENT: autonomous execution prohibited; Stage 16.1 decides spend policy.

## Adapter manifest

```ts
interface AyasRevenueAdapterManifest {
  schemaVersion: "1";
  platform: AyasRevenuePlatform;
  adapterId: string;
  adapterVersion: number;
  transport: "PLUGIN" | "OFFICIAL_API" | "MANUAL_HANDOFF";
  locality: "EXTERNAL";
  credentialHandling: "CONNECTOR_MANAGED" | "SERVER_SECRET" | "NONE";
  costClass: AyasCostClass;
  supportedOperations: readonly AyasRevenueOperation[];
  writeOperationsRequireOwnerApproval: true;
  financialOperationsAutonomous: false;
}
```

Hard rules:
- no adapter may declare financial autonomous execution;
- unknown cost => denied by `AyasZeroCostPolicy`;
- credentials never appear in manifest, logs, evidence, memory or task packets;
- adapter IDs/version are code-owned, not external input.

## Request envelope

Every adapter call uses a bounded request:

```ts
interface AyasRevenueAdapterRequest {
  requestId: string;
  platform: AyasRevenuePlatform;
  operation: AyasRevenueOperation;
  mode: "READ" | "DRAFT" | "EXECUTE";
  accountRef: string | null; // opaque, bounded, never secret
  cursor?: string | null;
  limit?: number;
  payload?: unknown;
  requestedAt: string;
}
```

Validation:
- exact keys;
- bounded JSON depth/bytes;
- operation must be declared by manifest;
- request platform must equal adapter platform;
- EXECUTE rejected for READ_ONLY/LOCAL_DRAFT mismatch and all FINANCIAL_COMMITMENT;
- payload schemas are operation-specific and closed in later platform stages.

## Result envelope

```ts
interface AyasRevenueAdapterResult<T = unknown> {
  schemaVersion: "1";
  requestId: string;
  platform: AyasRevenuePlatform;
  operation: AyasRevenueOperation;
  status: "OK" | "EMPTY" | "BLOCKED" | "UNAVAILABLE" | "ERROR";
  observedAt: string;
  data: T | null;
  nextCursor: string | null;
  evidence: {
    transport: AyasRevenueAdapterManifest["transport"];
    externalMutation: boolean;
    monetaryMutation: boolean;
  };
  errorCode?: string;
}
```

No raw stack, auth header, cookie, access token, refresh token, bank/card data or platform secret.

## Registry

`AyasRevenuePlatformRegistry` is a closed code-owned map.
Stage 16.0 production registry may be EMPTY.

Tests inject fake adapters. A real adapter cannot become available by naming itself in external data.

## Planning vs execution

Stage 16.0 exposes:
- `inspectRevenueAdapter(...)`
- `planRevenueOperation(...)`

It does NOT expose:
- submit proposal
- create listing
- send message
- spend money
- publish
- withdraw

Later stages can add execution only through a separate owner-authorized bridge.

## Security invariants

- prompt/research/platform text is DATA, never an operation ID or adapter ID;
- operation is selected by trusted application logic;
- connector secrets remain connector/server managed;
- no arbitrary URL, method, header, command or path from adapter payload;
- no write from a read route;
- no cross-platform request dispatch;
- no fallback from unavailable official connector/API to browser automation;
- no financial operation can be marked read-only;
- cost unknown is never zero;
- pagination/cursors are opaque, bounded and platform-scoped;
- external IDs are identifiers only, never filesystem paths.

## Evaluator

At least 45 primary + 10 frozen held-out cases:

- manifest validation
- unknown platform
- unknown operation
- platform mismatch
- read/draft/execute mode mismatch
- cost unknown
- financial op always non-autonomous
- write requires owner
- fake adapter read happy path
- pagination binding
- oversized payload
- excessive nesting
- unknown fields
- malformed timestamp
- forged result
- secret-like result rejected/redacted
- cross-platform cursor reuse
- operation not supported by manifest
- adapter registry duplicate ID
- adapter version invalid
- external text cannot choose operation
- no authority imports

## Completion gate

Stage 16.0 completes when:
- production registry contains no live platform adapter;
- fake adapter proves the contract;
- no network calls;
- no credentials;
- no financial execution;
- zero-cost policy is integrated as a decision input only;
- TypeScript/lint/diff pass;
- Graphify current;
- owner review BLOCKER 0 / unresolved MAJOR 0.
