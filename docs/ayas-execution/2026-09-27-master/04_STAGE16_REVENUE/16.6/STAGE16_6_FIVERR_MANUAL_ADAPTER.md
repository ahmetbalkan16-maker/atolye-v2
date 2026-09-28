# Stage 16.6 — Fiverr Manual-Handoff Adapter

## Current integration posture

No general official seller API/MCP surface was identified in the current official Fiverr sources used for this design.
Therefore production transport is:

`MANUAL_HANDOFF`

No scraping, browser automation, private endpoint reverse engineering, cookie reuse or DOM automation.

Stage 14 technology watch may later detect an official API/MCP; that would require a new reviewed adapter revision.

## Goal

Let AYAS prepare high-quality Fiverr selling work locally while the owner remains the person who performs Fiverr actions.

## Proposed files

- `src/lib/ayas/revenue/adapters/fiverr/AyasFiverrManualAdapter.ts`
- `src/lib/ayas/revenue/adapters/fiverr/AyasFiverrDrafts.ts`
- `src/lib/ayas/revenue/adapters/fiverr/AyasFiverrOwnerHandoff.ts`
- `scripts/smoke-ayas-revenue-fiverr-adapter.ts`
- `docs/AYAS_REVENUE_FIVERR_ADAPTER.md`

## Supported operations

Local/advisory:
- `ACCOUNT_STATUS_READ` only from owner-supplied normalized snapshot
- `LISTING_DRAFT` => Gig draft
- `MESSAGE_DRAFT`
- `DELIVERABLE_DRAFT`
- `ANALYTICS_READ` only from owner-exported/entered bounded facts
- `ORDER_LIST_READ` only from owner-supplied normalized facts

Not supported:
- Gig publish/update via automation
- Inbox read/send via automation
- order accept/start/deliver via automation
- custom offer send
- brief response submit
- follow-up message send
- payment/withdrawal
- any browser/scraping automation

Unsupported operations return `UNAVAILABLE_OFFICIAL_TRANSPORT`, never fall back.

## Gig draft

Local Gig package may include:
- title
- category suggestion
- description
- FAQ
- package structure
- price scenarios
- delivery-time scenarios
- revision scenarios
- requirement questions
- tags/keywords
- media checklist
- rights/licensing checklist
- owner-handoff checklist

Fiverr currently requires/uses platform-specific Gig rules; implementation must re-check current official guidance before owner publication.

## Messaging

AYAS may draft replies only.

Important product behavior:
- Fiverr limits/controls messaging to reduce spam;
- freelancers generally respond to clients/orders rather than cold-contact new clients;
- AYAS must not design unsolicited outreach automation.

Message draft includes:
- purpose
- order/conversation digest
- text
- unresolved questions
- owner-review-required=true

No recipient identity/PII stored beyond opaque digest.

## Order workflow support

AYAS can maintain a local order checklist from owner-supplied facts:
- requirements missing
- in progress
- revision requested
- draft prepared
- delivery prepared
- completed/cancelled (observed)

AYAS never marks Fiverr order status itself.

Delivery preparation:
- local deliverable manifest
- file hashes
- owner-facing delivery message draft
- rights/source checks
- completion checklist

Final "Deliver Work" remains owner action on Fiverr.

## Revenue ledger

Owner can enter/export normalized economic facts:
- completed order gross revenue
- observed platform fee
- clearance/payout state

Facts enter Stage 16.2 only through a strict import schema.
No screenshot OCR or raw page HTML storage.

## Manual handoff artifact

For each external action AYAS produces:

```ts
interface AyasFiverrOwnerHandoff {
  handoffId: string;
  operation: AyasRevenueOperation;
  createdAt: string;
  platform: "fiverr";
  summary: string;
  exactDraftDigest: string;
  checklist: readonly string[];
  monetaryImpact: "NONE" | "UNKNOWN" | "NON_ZERO";
  ownerMustPerform: true;
  completedEvidence: null | {
    observedAt: string;
    externalReferenceDigest: string | null;
  };
}
```

A handoff is not authority and not proof the owner completed it.
Owner completion must be separately recorded.

## Free-first policy

- Gig drafting is local-zero-cost.
- Seller Plus/paid growth tools are not prerequisites.
- paid subscription features are excluded from validation path.
- do not recommend purchase as required to start.
- any paid promotion/tool stays Stage 16.1 denied.

## Security

- no Fiverr credentials/cookies;
- no browser session reuse;
- no unofficial API;
- no scraping;
- no client PII persistence;
- no unsolicited messaging automation;
- no false claim that AYAS published/delivered/sent anything.

## Evaluator

>= 40 primary + 10 held-out:
- Gig draft
- package draft
- message draft
- delivery draft
- manual handoff
- unsupported publish/send/deliver returns unavailable
- no browser fallback
- no cookie/token fields
- owner completion not inferred
- owner-supplied analytics validation
- malformed import refused
- ledger mapping
- client PII rejected
- paid Seller Plus not treated as required
- external text cannot select action
- false "sent" claim guard

## Completion

- manual-only adapter honest about limitations;
- high-quality local draft/handoff workflow;
- no unofficial automation;
- zero-cost start preserved;
- Graphify/TS/lint/security/review green.
