# AYAS V3.2 — Revenue Activity & Owner Reporting Dashboard Addendum

This addendum is mandatory and becomes part of the V3.2 Revenue Center closure criteria.

## New mandatory capability: Revenue Activity & Owner Reporting Dashboard

AYAS must never operate revenue accounts as a black box.

For every connected platform/account, AYAS must show:

- platform name
- connected account identity in privacy-safe form
- current connection/authorization state
- what AYAS did
- when it did it
- why it did it
- what evidence/rule triggered the action
- whether the action was read-only, local draft, external write, financial, or owner-gated
- amount spent
- gross revenue
- fees
- refunds
- realized net profit
- whether owner approval is pending
- exact next action

## Required views

### 1. Live Activity
Shows what AYAS is currently doing per platform.

Example:
- Upwork: scanning opportunities
- Fiverr: preparing Gig revision
- Udemy: generating lesson assets in Atölye
- Lemon Squeezy: checking sales/order state
- Etsy: preparing listing draft

### 2. Owner Approval Queue
Shows only actions that require the owner.

Examples:
- proposal submission that consumes Connects
- external message
- listing/product publication
- paid operation
- price change
- customer delivery
- refund/financial action
- platform/account scope change

Every row must include:
- platform
- operation
- reason
- expected cost
- expected effect
- risk
- exact requested owner decision

### 3. Revenue & Cost
Per platform and consolidated:
- gross revenue
- platform fees
- refunds
- realized expenses
- realized net profit
- pending/unsettled amount
- production reinvestment transfer
- current allowed production allowance

Never mix estimated revenue with realized revenue.

### 4. Historical Audit Timeline
A durable chronological record.

Example:
- 22:14 — Upwork: 43 opportunities read
- 22:16 — 6 passed relevance filter
- 22:18 — 2 passed profitability/fulfillment checks
- 22:20 — 1 proposal draft prepared
- 22:20 — external submission blocked pending owner approval because Connects are required

The owner must be able to ask:
“Why did AYAS prepare/send/reject this action on this date?”
and receive evidence from the durable audit record.

## Platform cards

Each platform card should display at least:

- Pending Opportunities
- Drafts / Pending Actions
- Active Orders / Work
- Today Revenue
- Realized Net Profit
- Owner Approvals Pending

Do not display fabricated percentages or fabricated earnings.

## Brain UI V2 integration

Revenue Center should be accessible from the Brain UI V2 module dock.

The Command Center must support natural-language questions such as:

- “AYAS bugün para kazanmak için ne yaptın?”
- “Hangi platformlarda iş buldun?”
- “Benden hangi onayları bekliyorsun?”
- “Bugünkü toplam harcama ve net gelir nedir?”
- “Upwork’te hazırladığın teklif neden uygun bulundu?”
- “Bu ay hangi platform en fazla net gelir üretti?”

Answers must come from Revenue Center ledger/activity/audit evidence, not model guesses.

## Owner Executive Briefing integration

Stage 15T must include material revenue changes:

- new opportunities worth owner attention
- active work/orders
- completed deliveries
- realized gross revenue
- fees/refunds
- realized net profit
- total spend
- owner approvals waiting
- account/security/terms issues
- meaningful revenue trend changes

Avoid noisy low-value logs.

## Security and privacy

Do not expose:
- access tokens
- bank account numbers
- card details
- tax identifiers
- customer private contact details
- raw platform secrets

Use opaque account identifiers / masked labels.

## Closure requirement

Revenue Center Stage 16.14 cannot be marked REVIEW_READY unless:

- every connected platform emits activity/audit records;
- owner-gated operations appear in the Approval Queue;
- realized money reconciles with the Unit-Economics Ledger;
- estimates are visually/semantically separated from realized figures;
- historical “why did AYAS do this?” reconstruction works;
- Brain UI can summarize current revenue activity without guessing;
- privacy/security tests pass.

This addendum is mandatory for AYAS Master Sprint V3.2.
