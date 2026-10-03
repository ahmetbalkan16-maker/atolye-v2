# AYAS Etsy revenue adapter — Stage16.4

`createAyasEtsyAdapter(options)` implements the Stage16.0 adapter contract (`{ manifest, read, draft }`) for Etsy. It declares five reads (`ACCOUNT_STATUS_READ`, `ANALYTICS_READ`, `LISTING_LIST_READ`, `ORDER_LIST_READ`, `PAYOUT_LIST_READ`) and the local `LISTING_DRAFT`. Listing create/update and every money operation are not declared, so the Stage16.0 policy never plans them as executable. The production registry stays empty: no Etsy account is connected, and connecting one is the owner's decision after AYAS foundation closure.

## Official surface (re-checked 2026-10-03)

Sources: Etsy's published OpenAPI 3.0.0 document (`https://www.etsy.com/openapi/generated/oas/3.0.0.json`, SHA-256 `b993d52f46afdf87f7687dc6ff8885f2b012589f9b123e1faf14cc54ee73a9ef` on that date; server `openapi.etsy.com`), and the developer pages for authentication (OAuth 2 authorization code with mandatory PKCE, `x-api-key: keystring:shared_secret`, access token 1 hour, refresh token 90 days), rate limits (QPS/QPD sliding window, headers `x-limit-per-second`, `x-remaining-this-second` — documented as `x-remaining-this-secon` —, `x-limit-per-day`, `x-remaining-today`, HTTP 429 with `retry-after`) and webhooks (`order.paid`, `order.canceled`, `order.shipped`, `order.delivered`; `webhook-id`, `webhook-timestamp`, `webhook-signature`; HMAC-SHA256 over `id.timestamp.body` with the base64 part of a `whsec_` secret; payload `event_type`, `resource_url`, `shop_id`).

Endpoints used, all `GET`: `getMe` (`/v3/application/users/me`, `shops_r`), `getShop`, `getListingsByShop` (`listings_r`, limit ≤ 100), `getShopReceipts` and `getShopReceipt` (`transactions_r`, limit ≤ 100), `getShopPaymentByReceiptId`, `getShopPaymentAccountLedgerEntries` (`transactions_r`, `min_created`/`max_created` required). Money is `{ amount, divisor, currency_code }`.

Etsy can change any of this; a later stage that connects a real account re-checks it first.

## Credentials and connection

The adapter never sees a credential. Reads go through an injected transport, managed by a connector or the server, which attaches the OAuth token and API key and refreshes them; a refresh failure reaches the adapter as 401 and fails closed. The adapter hands the transport only `GET`, the fixed host and a path built from a code-owned template with numeric ids, plus a bounded query.

Before any read the Stage16.0A gate must pass for the request: a valid connection for this account, verified within a day, not expired or awaiting re-authorization, with exactly the read scopes `shops_r`, `listings_r`, `transactions_r`. A connection holding any write scope (`listings_w`, `listings_d`, `shops_w`, `transactions_w`, …) is excess and blocked even for reads, and is reported as `CONNECTED_WRITE_SCOPED`: a write-scoped token is never write authority. Other reported states: `UNCONFIGURED`, `CONNECTED_READ_ONLY`, `EXPIRED`, `REVOKED`, `ERROR`.

## Reads

Answers are snapshotted (no getters or proxies), bounded to 2 MiB and validated; 429 is `RATE_LIMITED` and is not retried here, 401/403 are blocked, 5xx is unavailable, any other non-200 is rejected. A page must not be longer than asked; one malformed record invalidates the page. Pages use the Stage16.0 bound cursor (`o<offset>`), at most 100 records and offset 10,000. Single-receipt and payment reads are bound to the requested receipt; account and shop reads to the configured shop.

Normalized facts carry no raw payload and no personal data: receipt buyer and seller emails, names, addresses, messages, gift notes, user ids and shipments are never read; listing URLs and descriptions are dropped; shop policy text is dropped. Returned listing/payment shop ids must match the configured shop; adjustments must name their enclosing payment. Money becomes integer minor units only when the currency is in the closed list and the conversion is exact; otherwise it is null. Payment-account ledger entries are kept as observed with `unitsVerified: false`.

## Ledger mapping

`mapAyasEtsyPaymentsToLedger(result)` accepts only an `OK` canonical `PAYOUT_LIST_READ` / `RECEIPT_PAYMENTS` result of this adapter, never a webhook. It produces Stage16.2 ledger inputs, writes nothing, and reports what it cannot state:

- `GROSS_REVENUE` for a `settled` payment (otherwise unknown);
- `PAYMENT_PROCESSING_FEE` from `amount_fees` (missing: unknown, never zero);
- `REFUND` for each successful adjustment in a two-decimal payment currency (Etsy states adjustment amounts in pennies); returned processing fees are reported unknown;
- platform fees (transaction, listing) are not in a payment record and are reported unknown; payouts are reported unknown until ledger entry types and units are verified against a live account.

Entries carry digests only (`etsy-payment:<id>:…`), an evidence digest of the normalized payment and the adapter identity; repeating the same read replays idempotently in the ledger. Mapping rejects accessors before cloning a bounded snapshot, both mutation flags must be false, and every amount must fit the ledger bound and match its payment currency. Oversized raw adjustment amounts are unknown. This is schema/provenance validation, not cryptographic authentication of a caller-fabricated read envelope; only a trusted collector may supply canonical adapter results.

## Webhooks

`verifyAyasEtsyWebhook(input)` checks, in order: header presence and shape (a header duplicated under another case is refused), body size, the HMAC signature (constant-time; `v1,` prefixes and several signatures are accepted when one matches), a five-minute timestamp window, de-duplication by `webhook-id`, the closed event set, the configured shop, and a `resource_url` that must be `https` on `api.etsy.com` or `openapi.etsy.com` with no port, credentials, query or fragment and a receipt path of the same shop. A verified delivery returns only a pointer and the two canonical reads to make; it keeps no body or secret and writes nothing. Shipping, refunds, messages and listings are never changed because of a webhook.

## Listing draft

`LISTING_DRAFT` is local and never calls the transport. It validates title (≤ 140), description (≤ 5,000), up to 13 distinct tags (≤ 20 characters), taxonomy id, price (closed currency, at least 1 minor unit), quantity (1–999), listing type and up to 10 media digests; links and sensitive data are refused, and contact details are already refused by the Stage16.0 request shape. Missing media, rights evidence or offer revision are listed as issues. The draft is hash-bound (`draftDigest`, canonical JSON); `publication` is `CLOSED`, and the steps any future owner-authorized create must take are listed: connection re-probe, write scope, hash-bound payload, media rights, Stage16.1 fee review, owner approval, idempotent create and read-back before local state changes.

## Evidence

Evaluator: 72 primary + 12 frozen held-out over a fake transport shaped like the official schemas (with personal fields present, so their removal is tested); 89 negative controls in an owned gitless TEMP closure. Source, graders, fixture and this document are forbidden autonomous patch targets. No account, credential, listing or money was involved; public official specification reads are recorded separately.
