# Stage 16.5 — Upwork adapter framework

Source framework implemented; **official tool qualification PENDING_OWNER_OAUTH**. This is not a completed official MCP mapping or live certification. Production catalog and global registry remain empty. The adapter defaults to local `PROPOSAL_DRAFT` only.

The existing Stage16.0 contract stays `{ manifest, read, draft }`. MCP is represented by the existing `PLUGIN` transport and connector-managed credentials. The connector bridge is injected; AYAS does not implement OAuth login, dynamic registration, HTTP, scraping, browser automation or GraphQL fallback. No executor exists. Submit, boost, Connects, messages, offer/contract acceptance and financial operations remain unsupported.

Official facts rechecked on 2026-10-03: [Upwork MCP](https://www.upwork.com/ai/mcp) specifies `https://mcp.upwork.com/mcp`, OAuth2.1/DCR, user confirmation of writes and financial completion on Upwork. Anonymous initialize returned HTTP401 with an empty body; no tools/list, actual scopes, schemas or account output was obtained. [Upwork's plugin repository](https://github.com/upwork/upwork-agent-plugin) describes discovery workflows, not a qualified AYAS schema catalog.

[API & MCP Terms v2.3, effective 2026-08-13](https://www.upwork.com/legal) require task-scoped access and provenance, restrict bulk access, independent agent ranking, model-improvement use and retention. The current [support article](https://support.upwork.com/hc/en-us/articles/55446516654611-How-to-use-Upwork-with-AI-agents-through-MCP) points custom workflows to those terms. The canonical AYAS support-confirmation gate is retained; its original attribution to the current help text is outdated. No scoring is implemented. All evaluation inputs are synthetic; real Upwork output must not enter graders or model-improvement memory. This records conservative implementation boundaries rather than legal advice.

## Reviewed binding boundary

A future reviewed source binding supplies the exact tool identity, canonical input/output/annotation digests, least-privilege scopes, verified zero cost, argument builder and result projector. It must be supplied by trusted application code; discovered metadata, request payloads, environment text and models cannot construct bindings. `AYAS_UPWORK_REVIEWED_TOOLS` is empty until official qualification. The fixture catalog, scopes and projection schema explicitly use synthetic names and make no official compatibility claim.

Before any invocation: validate immutable source pins; require owner-interactive workflow and a trusted owner callback; pass the shared account/scope/expiry gate; enforce one page ≤25 and no cursor; rediscover the exact tool and match all three schema digests and safe read annotations; build arguments with reviewed code; recheck owner authorization and connection freshness after discovery. Unknown tools are inert; duplicate identities or schema drift fail closed. An exact reviewed write/financial pin can be classified for inspection but cannot be registered as a read binding.

The fixed endpoint and frozen arguments go only to the injected connector bridge. 401/403 block; 429/5xx report unavailable; MCP `isError` fails; there is no retry or alternate transport. Raw outputs are descriptor-checked, size/depth-bounded and snapshotted before projection. The internal projection is not an Upwork wire schema. It allows only bounded references and closed states, optional safe job titles and distinct gross/fee/payout observations, retaining attribution, AI-origin and metering. Wrong account/kind, duplicates, private fields and currency/amount ambiguity are refused. Unknown fee remains null; no revenue inference or ledger append occurs.

Normalized results are ephemeral owner-task data with no authority and prohibited model use. These labels do not enforce retention in an external consumer: a future runtime integration must prove task binding, minimal retention/deletion, provenance, privacy and terms compliance before activation. This source has no store, scheduler, ranking or model-memory binding.

## Local proposal drafts

Exact job, cover letter, bid, milestones, attachments and proof digests are validated. Milestone amounts must sum to the bid in one currency. The digest binds the entire proposal; missing rights/offer proof is visible. Publication remains closed and identifies owner review, exact commercial terms, Connects/boost cost verification, connection/schema reprobe, one-shot idempotency and Upwork confirmation as prerequisites. Drafting works without credentials or discovery.

## Qualification and remaining owner work

66 primary +15 held-out synthetic scenarios and50 assertion-caught negative controls cover policy, schema drift, cost, privacy, provenance, scopes, ownership, races, bounds, draft hashes and inert writes. Evaluation manifest v44 declares136 suites/165 unique pins; this declaration is not a full-baseline PASS. Exact source regression/static/Graphify receipts are recorded separately.

After foundation, the owner must authorize the official connector and select the account. A separate reviewed qualification must capture minimal tool identities/schemas/annotations/scopes without raw user output, implement each actual argument/result projection, establish task authorization and cost policy, and test owner-triggered reads. Real outputs must not become evaluation fixtures. Until then, Stage16.5 official mapping remains deferred and unsupported; independent remaining Stage16 source work may continue in canonical order under the user's continuation instruction. Stage16 cannot receive a full completion claim while required qualification is unresolved.
