# AYAS model routing (Phase 2 · P0-A)

AYAS is **not locked to one model provider**. Every chat turn (voice or text) goes
through `AyasModelRouter` (`src/lib/ayas/model/`):

```
                    AYAS MODEL ROUTER
                           │
                ┌──────────┴──────────┐
          LOCAL / OLLAMA          CLOUD LLM
       (PC on, primary, $0)   (PC on but Ollama
                               down → fallback)
```

## Decision (per turn)

1. `classifyAyasComplexity(text)` → `SIMPLE | NORMAL | COMPLEX | TOOL | REPAIR | RESEARCH`
   (deterministic, Turkish-aware — carried on the decision for Phase D; it does
   **not** change which provider answers).
2. probe the local model — a 2.5 s `GET {OLLAMA_HOST}/api/tags`.
3. **Ollama healthy** → answer with Ollama (`AYAS_OLLAMA_MODEL` or the pipeline model).
   **Ollama down + `AYAS_CLOUD_API_KEY` set** → answer with the cloud model. This
   fallback is **visible** — the operational trace records
   `"yerel model kapalı … → bulut modeline geçildi"`, never a silent switch.
   **neither** → no model. The user sees an honest sentence with **no config or
   secret detail**; text chat's deterministic replies still work.

The router only turns a prompt into text. It runs nothing, touches no gate. The
Execution Gate stays `CLOSED`; `writeActionsEnabled` stays `false`.

## Environment (server-side only — never `NEXT_PUBLIC_*`, never logged, never in git)

| var | default | notes |
|---|---|---|
| `AYAS_OLLAMA_MODEL` | pipeline `OLLAMA_MODEL` | (existing) AYAS-chat-only local model override |
| `AYAS_CLOUD_API_KEY` | *(unset)* | bearer token for the cloud fallback. **Presence ⇒ the cloud provider is "configured".** Read only by `getAyasCloudApiKey()`, used only for the `Authorization` header. Put it in `.env.local` (gitignored). |
| `AYAS_CLOUD_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base, no trailing slash. Must be `https://` (or `http://127.0.0.1` / `http://localhost` for a local proxy under test). Works with OpenAI, OpenRouter, Groq, Together, vLLM, … |
| `AYAS_CLOUD_MODEL` | `gpt-4o-mini` | cloud model tag |
| `AYAS_CLOUD_TIMEOUT_MS` | `60000` | per-request timeout (1 000–300 000) |

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

**The value delivered now:** while the PC is on, an Ollama outage (crash, model
swap, thermal throttle, timeout) no longer takes AYAS chat down — the router
falls over to the cloud model, visibly, with the key staying server-side.
