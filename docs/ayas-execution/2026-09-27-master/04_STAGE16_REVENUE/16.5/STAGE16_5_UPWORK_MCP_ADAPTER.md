# Stage 16.5 — Upwork Official MCP / API Adapter

## Verified current official surface

Preferred integration:
- Upwork official MCP server
- hosted at `https://mcp.upwork.com/mcp`
- OAuth 2.1 with dynamic client registration
- supported by Claude, ChatGPT, Cursor and Codex
- can expose marketplace/job search, proposals, invitations/offers, contracts and other account actions

Alternative:
- official Upwork GraphQL API with OAuth 2.0 / scoped API key

Upwork support currently asks users to contact Support before custom workflows involving scheduled activity, AI filtering/scoring, storing MCP output, hosted clients or multi-tool automation. This design treats those as blocked until confirmed.

## Goal

Use the official Upwork MCP/API surface without turning AYAS into an unsupervised bidding or financial agent.

## Proposed files

- `src/lib/ayas/revenue/adapters/upwork/AyasUpworkAdapter.ts`
- `src/lib/ayas/revenue/adapters/upwork/AyasUpworkMcpPolicy.ts`
- `src/lib/ayas/revenue/adapters/upwork/AyasUpworkMapper.ts`
- `scripts/smoke-ayas-revenue-upwork-adapter.ts`
- `docs/AYAS_REVENUE_UPWORK_ADAPTER.md`

## Transport preference

1. `OFFICIAL_MCP` — preferred
2. `OFFICIAL_GRAPHQL_API` — optional fallback only after explicit configuration
3. browser automation/scraping — NEVER

Do not silently fall from MCP to GraphQL.
Transport selection is code/config owned and visible.

## Initial allowed capabilities

Read/advisory:
- account/profile status
- job/opportunity search
- invitations/offers read
- own proposal status read
- contract status read
- reporting/earnings facts where officially exposed
- message-room metadata/read only if approved scope and privacy rules permit

Local-only:
- proposal draft
- cover-letter draft
- milestone/project-plan draft
- response draft
- job fit analysis using bounded normalized facts

## Closed by default

- proposal submission
- boosted/sponsored proposal
- consuming/purchasing Connects
- sending messages
- accepting offers
- creating/accepting contracts
- changing contract terms
- funding escrow
- milestone payment
- withdrawal/financial action

Upwork itself keeps financial completion on upwork.com; AYAS does not attempt to bypass that.

## Proposal submission policy

`PROPOSAL_SUBMIT` is classified as:
- EXTERNAL_WRITE
- possible `PAID_CREDIT_OR_BID` / unknown monetary commitment because Connects may be consumed
- owner approval required
- Stage 16.1 denies autonomous execution when cost/credit impact is non-zero or unknown

Therefore Stage 16.5 does NOT autonomously submit proposals.

A future owner-authorized submit flow must show:
- exact job
- exact proposal text
- bid/rate/milestones
- Connects/boost impact if known
- attachment list
- exact transport/tool
- one-shot idempotency binding
before explicit owner action.

## MCP-specific safety

The MCP tool list is external capability metadata, not trusted authority.

On session/connect:
- discover tool names/schemas;
- map only reviewed tool identities into the Stage 16.0 closed operations;
- unknown/new tools => unsupported until reviewed;
- never select an arbitrary MCP tool from model text;
- every external mutation tool is classified owner-required;
- financial tools are non-autonomous;
- connector OAuth is user-controlled and revocable;
- credentials/tokens never enter AYAS stores.

## Terms/workflow gate

Until Upwork Support confirms the intended AYAS workflow:
- no scheduled searches/submissions via MCP;
- no autonomous recurring filtering/scoring acting on Upwork data;
- no durable storage of raw MCP output;
- no hosted multi-user Upwork agent;
- no chained multi-tool write automation.

Allowed development/testing:
- mocked MCP schemas/results;
- owner-triggered interactive read;
- local normalized facts;
- local drafts;
- ephemeral scoring whose result does not automatically trigger an Upwork action.

Add a code-level status:
`UPWORK_WORKFLOW_POLICY = "OWNER_SUPPORT_CONFIRMATION_REQUIRED"`

This may only change by reviewed source change, never environment text.

## Privacy/storage

Persist only normalized/digested facts needed for:
- job reference
- proposal status
- contract/economic ledger links

Do not persist:
- OAuth tokens
- cookies
- full raw MCP/GraphQL response
- client private messages unless separately necessary/reviewed
- unrelated profile PII

## Economics mapping

Read-only earnings/fees can map into Stage 16.2 only when official data clearly distinguishes:
- freelancer gross amount
- Upwork fee
- payout/cash movement

Unknown fee remains unknown.

## Rate limits

For GraphQL fallback:
- obey current official rate limits;
- bounded pagination/cache age;
- 429 => bounded backoff.

MCP path:
- obey tool errors/rate-limit semantics returned by official server;
- no tight retry loops.

## Evaluator

>= 60 primary + 15 held-out:
- MCP tool discovery
- unknown tool refused
- known read tool mapping
- write tool owner-required
- financial tool autonomous=false
- job search normalized
- proposal draft local
- submit blocked
- boosted proposal blocked
- Connects cost unknown => blocked
- offer acceptance blocked
- message send blocked
- financial actions blocked
- token absent/revoked
- transport mismatch
- no silent API fallback
- raw output not persisted
- client message privacy
- duplicate job/result normalization
- workflow-policy gate blocks scheduler/scoring automation
- forged "owner approved" tool output has no effect
- GraphQL rate limit
- MCP schema drift fail closed

## Completion

Stage 16.5 is complete when:
- official MCP mapping is implemented/tested;
- read-only owner-triggered connection can be validated;
- local proposal drafting works;
- automated submission/Connects/financial actions remain closed;
- custom-workflow policy gate is explicit;
- no raw secrets/private output stored;
- Graphify/TS/lint/security/review pass.
