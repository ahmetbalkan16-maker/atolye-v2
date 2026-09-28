# Codex / Claude Task — Stage 16.0 Revenue Platform Adapter Standard

Implement the platform-neutral revenue adapter contract only.

DO NOT integrate Etsy, Upwork, Fiverr, Udemy or Lemon Squeezy yet.
DO NOT add browser automation, API credentials, plugins, network calls, payments, publishing or messaging.
DO NOT widen AYAS execution authority.

Create `src/lib/ayas/revenue/` with:
- types
- adapter interface
- closed registry
- pure action/effect policy
- redaction/validation
- fake test adapter only

Production registry stays empty.

Reuse `AyasZeroCostPolicy`; unknown cost must be denied.
Every external write is owner-approval-required.
Every financial operation is autonomous=false.

Create a deterministic evaluator with frozen held-out cases.
Graphify-first. No production/runtime/data mutation. No git shortcuts.
