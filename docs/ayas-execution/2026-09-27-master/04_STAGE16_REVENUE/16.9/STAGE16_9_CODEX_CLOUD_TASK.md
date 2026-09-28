# Codex / Claude Task — Stage 16.9 Reinvestment Policy

Implement a pure reinvestment eligibility engine.

The default policy MUST remain:
- enabled=false
- percent=0
- absolute caps empty

Only realized Stage 16.2 ledger profit may be considered.
Expected revenue, pending payout and forecasts are excluded.
Unresolved fees/refunds/reserves force conservative capacity.
No cross-currency netting.

Even an eligible candidate:
- authority NONE
- ownerApprovalRequired=true
- cannot spend
- cannot call platform/payment APIs

Do not add an executor.
