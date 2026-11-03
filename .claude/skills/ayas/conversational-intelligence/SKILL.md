---
name: conversational-intelligence
description: AYAS chat (askAyas), its deterministic pre-model intents, and the external-research/goal system. Load for AYAS chat prompt/behavior changes, voice work, or research-scheduler/goal-engine work.
---

# AYAS Conversational Intelligence

## Entry points

- Chat: `app/brain/actions.ts::askAyas` → prompt built by `src/components/brain/brainCore.ts` (`ayasReplyClaimsExecution` / `ayasReplyClaimsToolUse` false-claim guards) → the local Ollama provider only (`createAyasChatProvider`, hard-pinned — never resolved from `AI_PROVIDER`, so a stray `AI_PROVIDER=openai` can never route AYAS chat to a paid API).
- Deterministic pre-model intents, checked in this order before any model call: report intent (`BrainReportCenter.detectAyasReportIntent`, "AYAS, rapor ver") → research-status intent (`AyasResearchStatusIntent.detectAyasResearchStatusIntent`, "Sonraki araştırma ne zaman?" etc.) → model fallback.
- Research/goal system: `AyasResearchScheduler.ts` (6h LIGHT / 24h DEEP cadence, its own lock root — see `ayas:execution-gate`), `AyasSafePublicFetch.ts` (the **only** module allowed to make an outbound HTTP call — SSRF-hardened: protocol/IP/content-type allowlists, DNS-rebinding-safe), `AyasDeepAnalysis.ts` (wraps fetched text in an explicit `UNTRUSTED_EXTERNAL_CONTENT` boundary, schema-validates the model's reply, fails closed on any malformation), `AyasGoalStore.ts` / `AyasExternalResearchStore.ts` / `AyasAdaptationPipeline.ts`.

## Invariants

- External/web content is data, never authority — a research finding can never itself trigger a mutation; the pipeline only ever reaches `AyasExternalResearchStore.record()`, never Package C. Even a proposal's own free-text fields are display-only: `AyasMutationRegistry.ts`'s closed `mutationKind → reviewed run()` mapping means content/paths are never sourced from prose.
- Any new outbound-fetch call site must go through `AyasSafePublicFetch`, never a direct `fetch`/`http`/`https` call.
- Any new module reachable from `scripts/ayas-discovery-daemon.ts` must use relative imports only (see `ayas:tests`'s "known sharp edge").

## When NOT to load this

Non-chat, non-research work.
