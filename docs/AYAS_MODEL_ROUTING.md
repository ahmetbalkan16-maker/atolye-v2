# AYAS model routing (Phase 2 · P0-A)

AYAS is **not locked to one model provider**. Every chat turn (voice or text) goes
through `AyasModelRouter` (`src/lib/ayas/model/`):

```
                    AYAS MODEL ROUTER
                           │
                ┌──────────┴──────────┐
          LOCAL / OLLAMA          CLOUD LLM CONFIG
       (PC on, primary, $0)   (provider abstraction exists;
                               unknown-cost cloud is not selected)
```

## Decision (per turn)

1. `classifyAyasComplexity(text)` → `SIMPLE | NORMAL | COMPLEX | TOOL | REPAIR | RESEARCH`
   (deterministic, Turkish-aware — carried on the decision for Phase D; it does
   **not** change which provider answers).
2. probe the local model — a 2.5 s `GET {OLLAMA_HOST}/api/tags`.
3. **Ollama healthy** → answer with Ollama (`AYAS_OLLAMA_MODEL` or the pipeline model).
   **Ollama unavailable or unconfigured** → the current router returns `no-provider`.
   A configured cloud endpoint still has `unknown-cost`, so the zero-cost policy
   refuses automatic cloud fallback. The user sees an honest sentence with no
   secret detail; text chat's deterministic replies still work.

The router only turns a prompt into text. It runs nothing, touches no gate. The
Execution Gate stays `CLOSED`; `writeActionsEnabled` stays `false`.

## Environment (server-side only — never `NEXT_PUBLIC_*`, never logged, never in git)

| var | default | notes |
|---|---|---|
| `AYAS_OLLAMA_MODEL` | pipeline `OLLAMA_MODEL` | (existing) AYAS-chat-only local model override |
| `AYAS_CLOUD_API_KEY` | *(unset)* | bearer token for the cloud provider abstraction. Presence can make its config valid, but the current AYAS router refuses automatic `unknown-cost` cloud fallback under the zero-cost policy. |
| `AYAS_CLOUD_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base, no trailing slash. Must be `https://` (or `http://127.0.0.1` / `http://localhost` for a local proxy under test). Works with OpenAI, OpenRouter, Groq, Together, vLLM, … |
| `AYAS_CLOUD_MODEL` | `gpt-4o-mini` | cloud model tag |
| `AYAS_CLOUD_TIMEOUT_MS` | `60000` | per-request timeout (1 000–300 000) |
| `OLLAMA_NUM_CTX` | *(unset)* | **required for AYAS chat.** The local model's context window in tokens (2 048–131 072), sent to Ollama as `num_ctx`. Unset or invalid = unknown window: AYAS sends no prompt and answers that the window is not configured. Raising it costs GPU memory. |
| `AYAS_CLOUD_CONTEXT_TOKENS` | *(unset)* | **required before any cloud call.** The context window of `AYAS_CLOUD_MODEL` in tokens (2 048–131 072). Unset or invalid = unknown window: no billed request is made. |

Every AYAS prompt is admitted against the declared window before it is sent
(`src/lib/ayas/context/AyasContextBudget.ts`): identity, limits, runtime state,
the current request and protected memory are always kept; earlier turns and
ordinary recalled memory are shed lowest value first; if the mandatory part does
not fit, no call is made. The size is a deterministic estimate, and when Ollama
reports the prompt size it actually evaluated, that measurement decides.

`resolveAyasCloudConfig()` returns a plain object that is **safe to log/serialise**
— it carries no key. A present-but-invalid value (e.g. a non-https base) leaves
`configured: false` and lists the ignored var name (never the value).

## What this phase does NOT do (feasibility)

**PC fully off → phone AYAS via the cloud model is NOT possible with the current
architecture.** The phone reaches AYAS only through the Cloudflare Quick Tunnel,
which runs *on the PC*; with the PC off, cloudflared, the Next server and Ollama
are all down, so no router code runs anywhere. Delivering PC-off phone AYAS needs
one **off-PC** server-side endpoint (a small proxy that holds the cloud key and
stays up independently). Standing that up is a separate, explicitly-authorised
Architecture Decision — see `AYAS_PHONE_RUNTIME_DECISION.md`. This phase leaves
the provider abstraction ready for it (the cloud provider is a drop-in for such a
proxy) but adds no external service.

**Current behavior:** while the PC is on, AYAS uses healthy local Ollama. If it
is unavailable, deterministic chat fallbacks remain available, but the model
router does not automatically spend through a cloud provider. A future cloud
route must establish an allowed cost class explicitly.
