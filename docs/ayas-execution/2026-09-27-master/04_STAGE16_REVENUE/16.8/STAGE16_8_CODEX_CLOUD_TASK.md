# Codex / Claude Task — Stage 16.8 Lemon Squeezy Adapter

Implement official Lemon Squeezy REST API v1 only.

Phase 1:
- Test mode
- store/product/order/subscription reads
- local product/checkout drafts
- signed webhook verification/dedupe
- canonical read-back
- Stage 16.2 ledger mapping

Do NOT enable autonomous:
- checkout creation
- product/price/discount changes
- refund
- subscription cancel/pause/resume/upgrade/downgrade
- license mutation
- webhook administration
- any financial action

Keep test/live stores cryptographically/logically separated.
API key and signing secret never enter AYAS stores.
