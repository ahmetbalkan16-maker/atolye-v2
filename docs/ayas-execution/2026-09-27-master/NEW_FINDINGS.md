# AYAS new findings

Record only verified, unrelated, non-blocking findings here. No findings at baseline.

## 2026-09-28 — Conversation evaluator scope

- The supplied broad prompt-stage synonym/short-token change made the retrieval evaluator exceed both chat stale-context and contradictory-context ceilings. Narrowing the addition to RAM/bellek restored both rates within their prior ceilings. Other synonym/ranking gaps remain separate work; no broad semantic claim is made.

## 2026-09-28 — Supplied temporal patch schema mismatch

- The supplied computer purchase-plan patch proposes a raw fact value up to 180 characters. The current memory model accepts only a 40-character token, so applying that text verbatim makes records invalid. The validated adaptation uses a 40-character SHA-256 token.
- Current temporal records with no stored `factKey` are deliberately not retyped at read time. The retrieval evaluator's existing PC decision corpus uses that form, so the stale free-text limitation remains. A historical-data transition needs its own authority and compatibility review.
