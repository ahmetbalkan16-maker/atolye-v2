# Stage 16.4 — Etsy Revenue Adapter

## Current official surface used by this design

- Etsy Open API v3
- OAuth 2 Authorization Code + PKCE
- API key on requests
- listings read/write scopes (`listings_r`, `listings_w`)
- transactions read scope (`transactions_r`)
- shops read/write scopes
- application QPS/QPD rate limits
- order webhooks (`order.paid`, `order.canceled`, `order.shipped`, `order.delivered`)
- Seller App path for an individual seller's own shop

The implementation must re-check the live Etsy spec before merge.

## Goal

Build an Etsy adapter under Stage 16.0 without granting autonomous listing publication or spend.

Phase A is read-only + local draft.
Phase B owner-authorized external write stays CLOSED until account/app connection and spend policy are explicitly approved.

## Proposed files

- `src/lib/ayas/revenue/adapters/etsy/AyasEtsyAdapter.ts`
- `src/lib/ayas/revenue/adapters/etsy/AyasEtsySchemas.ts`
- `src/lib/ayas/revenue/adapters/etsy/AyasEtsyMapper.ts`
- `src/lib/ayas/revenue/adapters/etsy/AyasEtsyWebhook.ts`
- `scripts/smoke-ayas-revenue-etsy-adapter.ts`
- `docs/AYAS_REVENUE_ETSY_ADAPTER.md`

## Transport and credentials

Preferred:
- official Etsy Open API v3 only;
- no scraping/browser automation fallback;
- OAuth token and API key stay server/connector managed;
- never store credentials in revenue ledger/memory/proposals/logs.

Connection state:
`UNCONFIGURED | CONNECTED_READ_ONLY | CONNECTED_WRITE_SCOPED | EXPIRED | REVOKED | ERROR`

A write-scoped token does NOT itself authorize AYAS to write.

## Supported operations — Stage 16.4

Automatically eligible after connection:
- `ACCOUNT_STATUS_READ`
- `LISTING_LIST_READ`
- `ORDER_LIST_READ`
- `PAYOUT_LIST_READ` / payment-ledger read mapping where supported
- `ANALYTICS_READ` only from official returned shop/order/payment facts
- `LISTING_DRAFT` local only

Not autonomously executable:
- `LISTING_CREATE`
- `LISTING_UPDATE`
- shop-message mutations
- any financial/refund operation

## Read models

Normalize Etsy data into platform-neutral internal models:
- shop identity (opaque ids only)
- listing facts
- order/receipt facts
- payment/fee facts
- webhook fact references

Do not persist raw Etsy payloads.

Customer personal information must be excluded from the revenue ledger.
Buyer email/address/profile fields are never requested unless a later feature proves they are essential and separately reviewed.

## Listing draft model

Local draft may contain:
- title
- description
- tags
- taxonomy/category reference
- price scenario
- quantity scenario
- digital/physical flag
- media asset references
- rights/source evidence
- validation issues

It must not contain:
- OAuth secrets
- arbitrary external URLs chosen by model text
- unsupported variations
- unverified rights claims

## Publication gate

Even though Etsy supports listing writes, AYAS publication is CLOSED by default.

Before any future owner-authorized listing write:
1. current adapter connection is re-probed;
2. required OAuth scope is present;
3. exact listing payload is hash-bound;
4. media rights validation passes;
5. Stage 16.1 evaluates any platform fee/cost commitment;
6. unknown/non-zero commitment is not autonomously allowed;
7. owner sees exact title/price/media/fee implications and explicitly approves;
8. idempotency/replay strategy prevents duplicate listing creation;
9. result is read back from Etsy before local state changes.

Stage 16.4 itself need not open this path.

## Rate limiting

Read adapter must:
- capture official limit/remaining headers when present;
- back off on rate-limit response;
- never retry writes blindly;
- bound page count and records;
- surface `RATE_LIMITED`, not spin.

No hardcoded assumption that current QPS/QPD values remain unchanged.

## Webhooks

Optional read-side integration:
- verify event type against closed set;
- callback route must authenticate/verify according to current Etsy requirements;
- payload is a notification pointer, not canonical order truth;
- fetch referenced resource through authenticated API;
- dedupe delivery;
- order event updates Stage 16.2 ledger only after canonical read/normalization.

Webhook delivery never authorizes shipping/refund/message/listing mutation.

## Unit economics mapping

Map official payment/order facts into Stage 16.2:
- gross revenue
- platform fee
- payment processing fee
- refund
- tax withheld/collected only as explicitly evidenced
- payout observed

Never infer missing fee = 0.

## Security

- official API hosts allowlisted;
- no arbitrary URL fetch except validated Etsy resource references;
- no screen scraping;
- no buyer PII persisted in AYAS revenue store;
- minimum OAuth scopes;
- token refresh failure fails closed;
- write scope presence != write authority;
- webhooks are untrusted until canonical API re-read;
- external listing text cannot select adapter operation.

## Evaluator

>= 50 primary + 12 held-out:
- read-only connect
- missing token
- wrong scopes
- token revoked
- listing pagination
- order pagination
- payments normalization
- fee unknown
- PII stripped
- listing local draft
- attempted create blocked
- attempted update blocked
- write-scoped token still blocked by owner/spend
- rate limit
- malformed limit headers
- hostile resource URL
- webhook unknown event
- duplicate webhook
- webhook pointer canonical re-read
- raw payload not persisted
- duplicate listing prevention plan
- secret redaction
- no scraping fallback

## Completion

Stage 16.4 framework complete when:
- official Etsy adapter read paths work in fixtures;
- local listing draft works;
- production external write remains owner/spend gated;
- no scrape fallback;
- no PII/secret leakage;
- ledger mapping deterministic;
- Graphify/TS/lint/security/review clean.
