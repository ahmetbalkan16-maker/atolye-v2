# AYAS Revenue Platform Adapter Standard (Stage 16.0)

Every revenue platform integration (Etsy, Upwork, Fiverr, Udemy, Lemon Squeezy) implements this one
contract. It adds no network code, no credentials, no account automation and no monetary authority.
Code: `src/lib/ayas/revenue/`. Evaluator: `scripts/smoke-ayas-revenue-adapter-standard.ts`
(54 primary + 10 frozen held-out cases) and its negative controls.

## Closed vocabulary

Platforms: `etsy`, `upwork`, `fiverr`, `udemy`, `lemon-squeezy`. Anything else is UNKNOWN and refused.

| Effect | Operations | Mode | Decision |
|---|---|---|---|
| READ_ONLY | ACCOUNT_STATUS_READ, OPPORTUNITY_LIST_READ, LISTING_LIST_READ, ORDER_LIST_READ, MESSAGE_LIST_READ, PAYOUT_LIST_READ, ANALYTICS_READ | READ | ALLOW_READ when declared and zero-cost |
| LOCAL_DRAFT | LISTING_DRAFT, PROPOSAL_DRAFT, COURSE_DRAFT, MESSAGE_DRAFT, DELIVERABLE_DRAFT | DRAFT | ALLOW_LOCAL_DRAFT when declared and zero-cost |
| EXTERNAL_WRITE | LISTING_CREATE, LISTING_UPDATE, PROPOSAL_SUBMIT, COURSE_PUBLISH, MESSAGE_SEND, ORDER_ACCEPT, DELIVERABLE_SUBMIT | EXECUTE | REQUIRE_OWNER (no executor in 16.0) |
| FINANCIAL_COMMITMENT | PURCHASE, AD_SPEND, FEE_COMMIT, REFUND, FUNDS_WITHDRAW | EXECUTE | DENY, always |

A request whose mode does not match its operation's effect is denied: a write cannot be relabelled as a
read or a draft, and nothing financial can be read-only. Financial operations are denied before any
other check, whether or not an adapter is registered.

## Decision order

1. Request shape (exact keys, bounded identifiers, strict timestamp, limit 1–100, payload ≤ 64 KiB and
   depth ≤ 8, plain JSON only) → `REQUEST_INVALID`
2. Platform → `UNKNOWN_PLATFORM`; operation → `UNKNOWN_OPERATION`
3. FINANCIAL_COMMITMENT → `DENY / FINANCIAL_NOT_AUTONOMOUS`
4. Adapter registered for the platform → `ADAPTER_NOT_REGISTERED`; manifest platform → `PLATFORM_MISMATCH`
5. Mode → `MODE_MISMATCH`; declared operation → `OPERATION_NOT_SUPPORTED`
6. Cursor bound to the same platform and operation → `CURSOR_SCOPE_MISMATCH`
7. `AyasZeroCostPolicy` on the manifest cost class → `COST_DENIED` (unknown, paid, subscription and
   metered free tier are all denied; unknown is never zero)
8. EXTERNAL_WRITE → `REQUIRE_OWNER`; READ_ONLY → `ALLOW_READ`; LOCAL_DRAFT → `ALLOW_LOCAL_DRAFT`

Every plan carries `grantsAuthority: false` and `monetaryAuthority: "NONE"`; only ALLOW_READ and
ALLOW_LOCAL_DRAFT are executable.

## Adapter and manifest

An adapter is exactly `{ manifest, read, draft }` — a plain object, no other key, no accessor. There is
no method for a write or a payment, so none can be handed to an adapter. The manifest is code-owned:
`writeOperationsRequireOwnerApproval: true`, `financialOperationsAutonomous: false`, a closed transport
(`PLUGIN`, `OFFICIAL_API`, `MANUAL_HANDOFF`) and credential handling (`CONNECTOR_MANAGED`,
`SERVER_SECRET`, `NONE`). A manual hand-off reaches no platform: no credential, local drafts only.
Adapter ids are slugs, never paths or secrets. Credentials never appear in a manifest, request, result,
log, memory or evidence.

## Registry

Closed, code-owned, one adapter per platform, unique adapter ids, frozen copies. The production registry
is empty in Stage 16.0. A request is dispatched only to its own platform's adapter; nothing in a request,
a result or external text can name an adapter into the registry.

## Running a plan

`runAyasRevenueReadOrDraft` performs ALLOW_READ and ALLOW_LOCAL_DRAFT plans only. A denied or
owner-required plan returns `BLOCKED` without touching the adapter. The request is read once: a
structured snapshot (a top-level accessor is refused before anything is invoked; a proxy, function or
symbol anywhere is refused) is planned, and that same deep-frozen snapshot is what the adapter receives.
A request payload or cursor carrying sensitive data is `REQUEST_INVALID` — a request is a task packet.
The adapter's answer is read once the same way; what is validated and scanned is exactly what is passed
on, deep-frozen. A result is validated against the request and the manifest:

- exact keys; same request id, platform and operation; closed status; strict timestamp;
- `evidence.transport` equals the manifest; `externalMutation` and `monetaryMutation` are false;
- `OK` carries bounded data (≤ 256 KiB), `EMPTY` is always returned with `data: null`, failures carry an
  error code and no data;
- a next cursor is bound to the same platform and operation.

A result that fails is replaced by a local `ERROR` (`AYAS_REVENUE_RESULT_INVALID`). A result carrying
secrets, credential-named fields, email addresses, Luhn-valid card numbers, IBANs (any case), tax
identifiers or machine paths — as text or as a JSON number — is refused as `BLOCKED`
(`AYAS_REVENUE_RESULT_SENSITIVE_REFUSED`), never partially passed on. Values are scanned once on the
serialized copy; field names are refused when the whole name, or its end, is a sensitive term
(`accessToken`, `customerEmail`, `userSessionId`; not `sessions`, `sessionCount` or `emailOptIn`). An adapter that throws gives `ERROR` (`AYAS_REVENUE_ADAPTER_FAILED`) without its message or stack;
one that hangs gives `UNAVAILABLE` after at most 10 s.

## Security invariants

Prompt, research and platform text is DATA, never an operation or adapter id. No arbitrary URL, method,
header, command or path from a payload. No write from a read. No cross-platform dispatch. No fallback
from an unavailable official connector to browser automation. The revenue modules import only the
zero-cost policy and the Brain redaction scanner, and no approval, execution or production module imports
the revenue modules in Stage 16.0. Patch safety marks the revenue modules, this document, the evaluator
and the fake adapter fixture as FORBIDDEN_AUTONOMOUS.

## Account connection / credential boundary (Stage 16.0A)

`src/lib/ayas/revenue/AyasRevenueAccountConnection.ts` is the framework; real account onboarding comes
later and only on the owner's decision. A connection is metadata only: platform, opaque account
reference, privacy-safe label (no contact detail, no run of five or more digits), credential handling
(`CONNECTOR_MANAGED` or `SERVER_SECRET`; `NONE` is not a connection) and the NAME of the holder
(`connector:<id>` or `vault:<name>`), granted scopes, connected / expires / last-verified times and a
re-authorization flag. No credential value, token or password field exists; a record that carries one,
or whose holder name looks like a credential, is refused.

Least privilege comes from a code-owned scope map per platform: the needed scopes are those of the
adapter's declared reads and owner-gated writes. Local drafts need none and a financial operation never
justifies a scope. `assessAyasRevenueConnection` returns, in order: `REAUTH_REQUIRED`, `EXPIRED`,
`UNVERIFIED` (scope map does not cover a declared read/write), `SCOPE_MISSING`, `SCOPE_EXCESS`,
`UNVERIFIED` (never verified, or verified more than 24 h ago), `SCOPE_DRIFT` (the platform reports
different scopes), `EXPIRING` (under 7 days left; still usable) and `HEALTHY`. Only HEALTHY and EXPIRING
are usable. `gateAyasRevenueRequestConnection` checks a planned request against a connection — same
platform and account, usable health (computed there, never taken from the caller) and the operation's
scopes granted; local drafts need no connection and financial requests are refused. Both results are
advisory and grant no authority; platform stages call the gate before dispatching a read.

## Known limits

The sensitive-data refusal is deliberately conservative for generic results: a Luhn-valid 13–19 digit
order number, a SKU shaped like an IBAN or a field whose name ends in `Token` is refused. Platform stages
replace the generic result with closed, operation-specific schemas. Phone numbers are not pattern-matched
(only phone-named fields are refused).
