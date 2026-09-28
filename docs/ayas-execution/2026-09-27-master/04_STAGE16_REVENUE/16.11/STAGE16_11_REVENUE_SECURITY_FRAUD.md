# Stage 16.11 — Revenue Security / Fraud / Account Safety

## Goal

Protect AYAS revenue workflows from:
- phishing and fake support/payment messages
- malicious links and attachments
- prompt injection inside marketplace/customer content
- forged webhooks/API payloads
- account-takeover signals
- payment redirection and off-platform scams
- credential/token leakage
- replay/duplicate actions
- fake orders/jobs/reviews
- unsafe files and archive traversal
- social-engineering attempts to bypass owner approval
- cross-platform identity/resource confusion

The default response to unresolved risk is:
`BLOCK + OWNER_REVIEW_REQUIRED`

This stage adds NO autonomous external write or financial authority.

## Proposed files

- `src/lib/ayas/revenue/security/AyasRevenueThreatModel.ts`
- `src/lib/ayas/revenue/security/AyasRevenueRiskClassifier.ts`
- `src/lib/ayas/revenue/security/AyasRevenueContentFirewall.ts`
- `src/lib/ayas/revenue/security/AyasRevenueWebhookVerifier.ts`
- `src/lib/ayas/revenue/security/AyasRevenueFileSafety.ts`
- `src/lib/ayas/revenue/security/AyasRevenueAccountSafety.ts`
- `src/lib/ayas/revenue/security/AyasRevenueActionGuard.ts`
- `scripts/smoke-ayas-revenue-security.ts`
- `scripts/adversarial-ayas-revenue-security.ts`
- `docs/AYAS_REVENUE_SECURITY_FRAUD.md`

## Trust classes

```ts
type AyasRevenueTrustClass =
  | "LOCAL_TRUSTED_CODE"
  | "OWNER_CONFIRMED"
  | "OFFICIAL_PLATFORM_CANONICAL"
  | "OFFICIAL_PLATFORM_NOTIFICATION"
  | "EXTERNAL_UNTRUSTED_TEXT"
  | "EXTERNAL_UNTRUSTED_FILE"
  | "UNKNOWN";
```

Rules:
- customer/client/listing/job/message/review text is always untrusted data;
- webhooks are notification evidence only until signature + canonical reread;
- model output never upgrades trust;
- owner approval is recorded only through the existing explicit owner path.

## Risk classes

```ts
type AyasRevenueRiskCode =
  | "PROMPT_INJECTION"
  | "PHISHING_LINK"
  | "OFF_PLATFORM_PAYMENT_REQUEST"
  | "CREDENTIAL_REQUEST"
  | "MALICIOUS_ATTACHMENT"
  | "ARCHIVE_TRAVERSAL"
  | "EXECUTABLE_ATTACHMENT"
  | "FORGED_WEBHOOK"
  | "REPLAYED_WEBHOOK"
  | "CANONICAL_STATE_MISMATCH"
  | "ACCOUNT_TAKEOVER_SIGNAL"
  | "SESSION_SCOPE_DRIFT"
  | "MFA_OR_AUTH_CHANGE"
  | "UNKNOWN_TOOL_OR_SCOPE"
  | "UNEXPECTED_FINANCIAL_EFFECT"
  | "DUPLICATE_EXTERNAL_WRITE"
  | "RESOURCE_ID_CONFUSION"
  | "SECRET_LEAK"
  | "PII_OVEREXPOSURE"
  | "UNVERIFIED_SUPPORT_REQUEST"
  | "POLICY_BYPASS_DIRECTIVE"
  | "UNKNOWN_RISK";
```

Severity:
`INFO | LOW | MEDIUM | HIGH | BLOCKING`

Unknown risk => BLOCKING for external write or financial flows.

## Content firewall

External text must be neutralized and bounded before it reaches:
- model context
- proposal drafts
- task packets
- revenue memory

Detect:
- "ignore previous instructions"
- requests for secrets/tokens/passwords
- requests to run commands/tools
- approval-bypass claims
- off-platform payment instructions
- credential reset links
- arbitrary file/path references
- requests to upload/download executable content

Detected instructions become evidence only.
They never select:
- adapter
- operation
- URL
- command
- file path
- tool
- approval
- payment destination

## Link safety

Allow only:
- canonical platform hostnames already bound to the adapter
- owner-reviewed official support/documentation hosts

Unknown domains:
- never auto-open in action path
- surfaced as `PHISHING_LINK` or `UNKNOWN_RISK`
- owner may inspect manually outside AYAS action authority

Shorteners and redirectors:
- blocked in write/payment/security-sensitive flows

## File safety

Revenue attachments are never trusted.

Reject or quarantine:
- executable/script formats
- double-extension executable disguises
- archive traversal (`../`, absolute paths, drive letters)
- symlinks/junction-like archive entries
- macros when not explicitly required
- oversized/decompression-bomb archives
- secret-containing files
- files with extension/MIME mismatch

Allowed document/media files are read-only and processed in TEMP isolation.

No attachment can become a command or source patch.

## Webhook verification

Generic contract:
1. bounded raw body
2. signature/auth verification using platform-specific server secret
3. timestamp/replay window if supported
4. event id dedupe
5. event-type allowlist
6. resource id validation
7. canonical API reread where required
8. normalized facts only
9. no direct external mutation from webhook

Invalid/unknown event:
`BLOCKED_WEBHOOK`

## Account safety

Maintain read-only account-security observation:

Signals:
- OAuth/token revoked
- scopes changed unexpectedly
- account email/security settings changed
- MFA/security notification observed
- unfamiliar session/device alert if officially available
- unexpected write capability appears
- API tool list/schema changes
- live/test mode changed
- store/shop/account identity changed

Any material drift:
`ACCOUNT_REAUTH_REQUIRED`

No automated password/token rotation by AYAS.

## Payment / scam safety

Block:
- requests to pay outside platform
- gift cards/crypto/wire instructions in customer text
- "verification payment"
- credential/security-code requests
- change of payout/payment destination from untrusted content
- unexpected fee or monetary commitment

A platform fee is accepted only from canonical platform/account evidence.

## Action guard

Every external action passes:

`adapter policy -> zero-cost/spend gate -> revenue security guard -> owner approval -> platform adapter`

The security guard can only:
- ALLOW_READ
- ALLOW_LOCAL_DRAFT
- REQUIRE_OWNER_REVIEW
- BLOCK

It cannot approve or execute.

Financial operations cannot become ALLOW_AUTONOMOUS.

## Replay / idempotency

External writes require:
- action digest
- platform/account binding
- exact resource binding
- one-shot nonce/idempotency key when platform supports it
- current canonical reread before retry
- no blind write retry

## Privacy

Security evidence stores:
- code
- timestamp
- platform
- resource digest
- event digest
- severity
- reason code

Never store:
- raw credentials
- full private messages
- bank/card data
- full customer PII
- raw unredacted malicious payload

## Evaluator

>= 70 primary + 20 frozen held-out/adversarial:
- prompt injection
- fake owner approval claim
- credential request
- phishing domain
- canonical domain
- shortener
- off-platform payment
- gift card/crypto request
- executable attachment
- archive traversal
- MIME mismatch
- oversized archive
- valid webhook
- invalid signature
- replay webhook
- unknown event
- canonical state mismatch
- token revoked
- scope drift
- unexpected write scope
- test/live mode drift
- duplicate write
- action replay
- resource ID mismatch
- secret leakage
- PII leakage
- webhook cannot execute
- external text cannot select operation
- unknown tool blocked
- no browser/scraping fallback
- owner rejection remains terminal for bound action
- model output cannot lower severity
- unknown risk blocks write

## Completion

- fail-closed revenue security guard;
- external content remains data only;
- webhook verification canonicalized;
- attachment isolation;
- account drift detection;
- no autonomous external/financial authority;
- deterministic adversarial suite;
- Graphify/TS/lint/security/review green.
