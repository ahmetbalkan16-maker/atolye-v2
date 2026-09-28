# Codex / Claude Task — Stage 16.1 Revenue Zero-Cost / Spend Gate

Implement a pure revenue-domain monetary policy around the existing AyasZeroCostPolicy.

Non-negotiable:
- autonomous/upfront budget stays exactly 0;
- no env/config override can widen it;
- any monetary mutation is denied autonomously;
- unknown, paid, subscription and metered-free-tier cost are denied;
- passive platform fee observations are read-only accounting facts, never authorization;
- expected revenue/profit cannot offset current spend;
- no payment/account/platform executor is added;
- external writes still require a separate owner action gate even if zero-cost.

Add deterministic primary + held-out tests.
Graphify-first, no runtime/data/network mutation.
