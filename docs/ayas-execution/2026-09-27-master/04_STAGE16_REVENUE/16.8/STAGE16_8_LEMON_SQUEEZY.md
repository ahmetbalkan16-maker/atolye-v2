# Stage 16.8 — Lemon Squeezy Direct Store Adapter

## Verified current official surface

Lemon Squeezy exposes:
- REST API v1
- test mode
- products / variants / prices / files
- orders / order items
- subscriptions / subscription invoices/items
- discounts
- checkouts
- webhooks
- license keys
- official JavaScript SDK
- signed webhook delivery
- documented rate limiting

Implementation must re-check live official docs before merge.

## Goal

Provide a governed direct-store integration for AYAS/Atölye digital products without granting autonomous payment, pricing, discount, checkout or subscription mutation authority.

## Proposed files

- `src/lib/ayas/revenue/adapters/lemon/AyasLemonSqueezyAdapter.ts`
- `src/lib/ayas/revenue/adapters/lemon/AyasLemonSchemas.ts`
- `src/lib/ayas/revenue/adapters/lemon/AyasLemonWebhook.ts`
- `src/lib/ayas/revenue/adapters/lemon/AyasLemonMapper.ts`
- `src/lib/ayas/revenue/adapters/lemon/AyasLemonCheckoutPolicy.ts`
- `scripts/smoke-ayas-revenue-lemon-adapter.ts`
- `docs/AYAS_REVENUE_LEMON_SQUEEZY.md`

## Transport and credentials

- official API only
- HTTPS only
- Bearer API key stays server/connector managed
- webhook signing secret stays server secret
- never persist API keys/secrets in AYAS memory/ledger/proposals/logs
- no client-side key exposure

## Test-mode-first rule

Every mutating integration must first prove itself in Lemon Squeezy Test mode.

Production/live mode starts CLOSED.

The adapter tracks:
`UNCONFIGURED | TEST_CONNECTED | LIVE_READ_ONLY | LIVE_WRITE_SCOPED | REVOKED | ERROR`

`LIVE_WRITE_SCOPED` means credential capability only, not AYAS authorization.

## Stage 16.8 allowed operations

Autonomous/read:
- store read
- product list/read
- variant/price read
- order read
- subscription read
- license-key metadata read where appropriate
- webhook receive/verify/dedupe
- analytics normalization from canonical API facts

Local:
- product draft
- checkout-plan draft
- subscription-plan draft
- license-delivery plan

Closed by default:
- product create/update/delete
- price/variant mutation
- checkout creation
- custom-priced checkout
- discount create/update/delete
- subscription cancel/pause/resume/upgrade/downgrade
- refund
- license mutation
- webhook create/update/delete
- any money movement

## Product draft

Local product draft may contain:
- title
- description
- product class
- deliverable manifest
- version
- rights/license evidence
- hypothetical price
- supported currency
- tax/product classification notes
- fulfillment plan
- update policy
- refund policy reference

No API write occurs from drafting.

## Checkout policy

Creating a checkout is an EXTERNAL_WRITE with possible financial/commercial effect.

Therefore:
- not autonomous
- exact product/variant/price must be current-read verified
- price amount/currency hash-bound
- Stage 16.1 spend gate evaluates any seller-side monetary commitment
- owner approval required before any live checkout link is created
- unknown fee/tax/commercial consequence blocks autonomous creation

Stage 16.8 production should remain read-only until owner separately opens a reviewed write path.

## Webhooks

Webhook route:
1. read raw bounded request body
2. verify signature with server-held secret BEFORE parsing into trusted event
3. event type closed allowlist
4. dedupe delivery/event identity
5. treat webhook as event notification, not all economic truth
6. canonical API re-read for order/subscription state when required
7. normalize only needed facts
8. Stage 16.2 append idempotent economic entries

Do not persist raw webhook body longer than required for verification/troubleshooting.
No customer PII in revenue ledger.

Expected read-side events may include:
- order_created
- order_refunded
- subscription_created/updated/cancelled/resumed/expired
- payment success/failure/recovery
- license-key events

Unknown new event types fail closed or are ignored as unsupported until reviewed.

## Unit economics

Canonical order/invoice facts may map to:
- gross revenue
- refund
- platform/processing fee when explicitly available
- tax withheld/collected only as explicitly represented
- payout observed only from suitable evidence

No inferred missing fee = 0.

## Subscription safety

Even when official API allows subscription mutation:
- AYAS never cancels/pauses/resumes/changes a customer subscription autonomously;
- customer-impacting changes require explicit owner decision;
- duplicate/replayed calls need idempotency and current-state re-read;
- destructive transitions need a fresh confirmation.

## Rate limiting

Current official limit is 300 API calls/minute.
Implementation:
- client limiter below official ceiling;
- parse rate-limit headers;
- 429 bounded backoff;
- no tight retries;
- no blind retry of writes.

No assumption the numeric limit is permanent; code isolates it as configurable observed policy metadata.

## Security

- API host allowlist
- no arbitrary URL fetch
- JSON:API schema validation
- body/response size caps
- secret redaction
- webhook signature verify
- no raw customer PII storage
- no cross-store resource confusion
- store ID bound to adapter config
- test/live mode cannot be silently mixed
- external payload cannot choose operation
- no browser/scraping fallback

## Evaluator

>= 55 primary + 15 held-out:
- test-mode connection
- live/read connection
- product read
- order read
- subscription read
- pagination
- rate-limit
- malformed JSON:API
- cross-store ID mismatch
- test/live confusion
- local product draft
- checkout create blocked
- discount mutation blocked
- refund blocked
- subscription mutation blocked
- webhook valid signature
- invalid signature
- replay webhook
- unknown event
- order canonical re-read
- ledger mapping
- PII stripping
- secret redaction
- raw payload non-persistence
- duplicate economic event idempotency
- API-key exposure prevention
- no write retry
- no arbitrary relationship URL follow

## Completion

- official API read integration
- test-mode proof
- verified/deduped webhook ingestion
- ledger mapping
- production live writes still owner-controlled/closed
- no autonomous financial/customer mutation
- Graphify/TS/lint/security/review green.
