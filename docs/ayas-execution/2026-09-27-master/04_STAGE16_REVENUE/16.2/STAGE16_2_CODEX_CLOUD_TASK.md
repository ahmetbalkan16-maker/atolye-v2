# Codex / Claude Task — Stage 16.2 Unit-Economics Ledger

Implement a durable privacy-bounded economic event ledger.

Rules:
- no bank/payment/execution functionality;
- integer minor units only;
- per-currency aggregation only, no FX;
- immutable events, corrections by reversal + replacement;
- exact replay write-free, conflict fail-closed;
- payout is NOT revenue;
- no raw customer/platform payloads;
- only digested external/order/offer/activity identifiers;
- secret-like data rejected;
- profit does not grant spend authority;
- storage uses project-standard atomic+fsync+lock discipline.

Add deterministic race, corruption, idempotency, privacy and economics tests.
