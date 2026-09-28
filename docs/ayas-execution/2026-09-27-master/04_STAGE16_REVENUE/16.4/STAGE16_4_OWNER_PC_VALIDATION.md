# Stage 16.4 Owner-PC Validation

- Re-check Etsy official v3 spec.
- Use seller/developer test context, never live mutation first.
- Test minimum scopes.
- Read-only fixtures + mocked official responses first.
- Confirm no create/update endpoint is reachable from autonomous execution.
- Confirm secrets/PII absent from stored evidence.
- Confirm rate-limit handling bounded.
- Confirm webhooks do not become canonical without API re-read.
- Confirm ledger mapping and no missing-fee=0.
- TypeScript/lint/security/Graphify/diff/review.
