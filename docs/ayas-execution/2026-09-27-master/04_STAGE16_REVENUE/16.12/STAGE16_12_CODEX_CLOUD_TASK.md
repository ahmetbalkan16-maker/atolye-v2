# Codex / Claude Task — Stage 16.12 Low-Cost Pilot

Implement a bounded revenue pilot framework.

Defaults:
- one platform
- one offer
- one primary metric
- maxExternalWrites=1
- spendBudgetMinor=0
- maxDurationDays=14
- ownerApprovalRequired=true
- executionAuthority=NONE

Pilot must use existing platform adapter policy; it cannot create new write authority.
Metrics/start/stop conditions become immutable once ACTIVE.
Negative/refund evidence cannot be deleted.
PROMISING is advisory only and cannot trigger scaling.

Use Stage 16.2 realized economics and Stage 16.11 security guard.
No FX aggregation, no vanity-metric substitution, no silent extensions.
