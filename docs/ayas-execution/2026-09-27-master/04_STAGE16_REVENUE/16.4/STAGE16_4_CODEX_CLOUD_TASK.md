# Codex / Claude Task — Stage 16.4 Etsy Adapter

Implement Etsy only through the current official Open API v3.
Re-check official API spec/MCP before coding endpoint payloads.

Initial production capability:
- account/shop read
- listing read
- order/payment read
- local listing draft
- optional verified webhook ingestion

Do NOT enable autonomous listing create/update.
A write-scoped OAuth token is capability evidence, not owner authorization.
All possible monetary commitments remain under Stage 16.1 and default denied.
No scraping/browser automation fallback.
Minimize scopes and persist no buyer PII/raw Etsy payloads.

Integrate normalized economic facts into Stage 16.2 only after canonical API read.
