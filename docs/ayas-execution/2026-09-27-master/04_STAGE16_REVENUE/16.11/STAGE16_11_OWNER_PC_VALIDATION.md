# Stage 16.11 Owner-PC Validation

1. Run all security tests with TEMP stores/files.
2. Prove no real platform account/write is touched.
3. Test prompt-injection and fake-owner-approval cases.
4. Test malicious link/file/archive cases.
5. Test valid/invalid/replayed webhook fixtures.
6. Test token/scope/account identity drift.
7. Test duplicate write/idempotency protection.
8. Prove secrets/PII not persisted.
9. Prove webhook/customer text cannot select operation or spend.
10. Run TypeScript, lint, Stage 9 security, Stage 16.0/16.1 adapter+spend gates,
    ledger, Graphify, diff-check and independent review.
