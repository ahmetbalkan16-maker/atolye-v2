# Codex / Claude Task — Stage 16.6 Fiverr Manual-Handoff Adapter

Do NOT invent a Fiverr API.
Implement the adapter with transport `MANUAL_HANDOFF`.

Allowed:
- local Gig drafts
- local message drafts
- local deliverable/delivery drafts
- owner-supplied normalized order/analytics facts
- owner handoff checklists

Forbidden:
- scraping
- browser automation
- cookie/session reuse
- private/unofficial endpoints
- automated Gig publishing
- automated messaging
- automated delivery/order actions
- financial actions

Unsupported external operations must fail explicitly as `UNAVAILABLE_OFFICIAL_TRANSPORT`.
