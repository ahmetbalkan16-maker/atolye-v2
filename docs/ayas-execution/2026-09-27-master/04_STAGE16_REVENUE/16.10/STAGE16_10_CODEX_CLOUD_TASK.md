# Codex / Claude Task — Stage 16.10 Revenue Intelligence + Memory

Implement a dedicated revenue intelligence/memory layer.

Critical boundaries:
- Stage 16.2 ledger remains the ONLY realized money truth.
- Do not store credentials, bank/card/tax data, buyer emails/phones/addresses, raw private messages or raw platform payloads.
- Use closed temporal fact slots for current decisions.
- Preserve history/as-of.
- Owner decisions outrank hypotheses/model suggestions.
- Realized ledger facts outrank estimates.
- No cross-currency fake aggregation.
- Chat context must be compact and privacy-bounded.
- Intelligence is advisory only; no platform write/spend authority.

Add Turkish current/history/as-of and correction held-out cases.
