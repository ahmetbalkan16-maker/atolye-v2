# AYAS local model "unreachable" fallback — root cause and bounded fix — 2026-10-08

Source baseline: `462f9f7dd0b30160853c4ee3cdaca413a0c60a0e`, branch `wip/ayas-graphify-final-execution`, clean, origin 0/0. Owner-reported live screen: AYAS answered "merhaba" with "Anladım." and the chat note said "Yerel modele ulaşılamadı — şu an deterministik özet yanıt veriliyor."

## What was observed

| Check | Result |
| --- | --- |
| Ollama `GET /api/tags` | 200; `qwen2.5:7b` and `qwen2.5:3b` installed |
| Ollama `GET /api/ps` | `qwen2.5:3b` resident (Q4_K_M, context 8192, fully in VRAM) |
| Live origin | single `next start -p 3000` (PID 24324), started 06:45 local |
| Live turn evidence `data/brain/observability/evidence/2026-10-08.jsonl` | 07:51:14Z turn: `outcome: fallback`, `errorCode: null`, model `llm.local-text.qwen2.5-3b` `PINNED`/`MATCH`, `retries: 1`, 6.5 s |

A transport failure records `PROVIDER_FAILURE` and ends with reason `ollama-fetch-failed`. The live turn had no error code and one retry, which is the finalizer's bounded correction call. The model was reachable.

## Reproduction (real local model, isolated)

`streamAyasChat` was called directly against the same local Ollama and model configuration (non-secret model keys only), with an OS-temp memory store and execution-audit root. No paid provider, no repository data and no live process were touched.

Before the fix, 9 greeting turns: 7 ended `fallback / context-quality` with the text "Anladım.", including 3 of 3 "merhaba" turns after earlier conversation turns. 2 of 9 were model replies.

Root cause in `src/lib/ayas/AyasChatStream.ts`, `replyNeedsContextCorrection`:

- With conversation history, any reply starting with "Merhaba/Selam" was rejected, even when the user's own turn was a greeting. A bare "nasıl yardımcı olabilirim?" was rejected the same way.
- The bounded correction prompt then forbids greetings, the small model greets anyway, and the static fallback for a short turn is "Anladım.".

Second defect: the UI note in `BrainConsoleView` treated every `source: fallback` as "model unreachable". It also showed that for guard replacements and for deterministic report/research answers, which do not use the model at all.

## Bounded fix

- **Guard:** a greeting reply is accepted when the user greeted, also mid-conversation. Unprompted re-greetings, bare help offers on non-greeting turns, "sağol" openers and self-introductions are still rejected.
- **Fallback:** a greeting turn whose reply is rejected now gets a mirrored greeting ("Merhaba.", "Selam.", "Günaydın.", "İyi akşamlar.", "İyi geceler.") instead of "Anladım.". Execution-claim, fake-tool and read-only safety fallbacks keep priority.
- **UI note:** the stream's existing `reason` is carried to the chat note (`ayasChatStreamClient` → `BrainCoreConsole`; `askAyas` passes it too). `classifyAyasReplyFallback` (`brainCore.ts`) maps it to one of:
  - `guarded`: model answered, a quality/safety guard replaced the reply.
  - `deterministic`: rule/report answer; no claim about the model.
  - `unreachable`: transport, routing, unavailable model or unknown reason.

  "Yerel modele ulaşılamadı" now appears only for `unreachable`, and for callers that pass no kind. Unknown reasons fail toward `unreachable`.

No layout, navigation, command wiring, voice path, homepage structure or model configuration changed. Only the text of the existing note slot can differ. Execution gate, approval and authority unchanged.

## Verification

| Check | Result |
| --- | --- |
| Same isolated probe after the fix, 15 greeting turns | 15/15 `source: llm`; no "Anladım." |
| New `scripts/smoke-ayas-reply-fallback-truth.ts` (mock model, OS-temp roots) | PASS 11 scenarios; repository `data/brain` fingerprint unchanged |
| Same suite on HEAD's unfixed chat stream (TEMP copy) | FAIL (`fallback` ≠ `llm`); the suite catches the original bug |
| `tsc --noEmit` | PASS |
| ESLint on the changed files | PASS, 0 problems |
| Full declared baseline, 166 suites, uncommitted overlay ([BASELINE_OVERLAY_462f9f7.json](BASELINE_OVERLAY_462f9f7.json)) | 162 PASS / 4 FAIL. `retrieval-evaluation`, `golden-vault-run` and `golden-sandbox-run` are the three preserved raw FAILs, with the same reasons (exact 12 IMPROVED review requests; promotion stopped solely for `golden.memory.retrieval-evaluation`). `action-firewall-closure` also fails on clean HEAD `462f9f7` (F96). Manifest v57 digest unchanged; repository byte-identical during the run |

The live server still runs the build from before this fix. Making it live needs an owner-approved rebuild/restart in the canonical deployment window; none was performed.

## Honest limits

- `qwen2.5:3b` replies are not quality-qualified by this fix. In the post-fix probe it added an unverified status sentence once ("Sisteminiz tam olarak çalışmaktadır.") and some Turkish suffix errors ("AYAS'nın"). No guard covers unverified system-status claims (finding F97).
- The live configuration uses `qwen2.5:3b` although `qwen2.5:7b` is installed. Model selection was not changed.
- Real-phone voice output, the installed PWA and the authenticated live UI were not exercised (NOT_RUN). One probe set is not a general conversation-quality PASS.
