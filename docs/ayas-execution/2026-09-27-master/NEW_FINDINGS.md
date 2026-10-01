# AYAS new findings

Record only verified, unrelated, non-blocking findings here. No findings at baseline.

## 2026-09-28 — Conversation evaluator scope

- The supplied broad prompt-stage synonym/short-token change made the retrieval evaluator exceed both chat stale-context and contradictory-context ceilings. Narrowing the addition to RAM/bellek restored both rates within their prior ceilings. Other synonym/ranking gaps remain separate work; no broad semantic claim is made.

## 2026-09-28 — Supplied temporal patch schema mismatch

- The supplied computer purchase-plan patch proposes a raw fact value up to 180 characters. The current memory model accepts only a 40-character token, so applying that text verbatim makes records invalid. The validated adaptation uses a 40-character SHA-256 token.
- Current temporal records with no stored `factKey` are deliberately not retyped at read time. The retrieval evaluator's existing PC decision corpus uses that form, so the stale free-text limitation remains. A historical-data transition needs its own authority and compatibility review.

## 2026-10-01 — Stage 15A.3 first real engine contact

- **No canonical numeric qualification threshold exists.** The canonical specs say only "If hardware/model cannot meet the threshold: `LOCAL_INDEPENDENCE_DEGRADED`" and "Activate only one that passes AYAS qualification on the current hardware". No pass@1, pass^k, held-out, repeat-count or latency number is defined anywhere in `01_CANONICAL_SPECS`. None was invented: the qualification summary records `canonicalNumericThreshold: null` and fails closed. Defining the number is an owner decision.
- **The pinned llama.cpp server ignores the OpenAI object form of `tool_choice`.** It logs `Wrong type supplied for parameter 'tool_choice' … type must be string, but is object` and falls back to `auto`. The string form `"required"` is accepted without a warning but is not enforced for this model's template either: the model answered with a fenced JSON block and prose and ran to `max_tokens`. Only a JSON-schema `response_format` is grammar-enforced by this engine. The synthetic adapter tests could not see any of this.
- **The 60 s adapter timeout ceiling was infeasible on the pinned CPU-only engine.** A 1.7k-token prompt alone needs about 71 s. The ceiling is an operational kill bound and is now 30 minutes; it is not a latency threshold, and none is defined canonically.
- **The Podman WSL provider does not enforce the machine's configured memory or CPUs.** With no `.wslconfig`, the shared WSL2 VM takes WSL defaults (about half of host RAM, all logical CPUs). A 14 GiB container cap drove the host to 91 % RAM. Only the per-container cgroup limit bounds usage; a global `.wslconfig` limit is an owner-only setting and was not applied.
- **The frozen Graphify launcher evaluator is Windows-only.** In the Linux container it reports zero scenarios / `skipped`. It is recorded as `PLATFORM_UNAVAILABLE`, is not rewritten, and a model candidate for it is not executed on the host. Local-model coverage of the Graphify domain is therefore unmeasured.
- **The pinned CPU engine archive leaves the RTX A2000 unused.** GPU and VRAM telemetry are `null` by construction. A GPU engine build and GPU passthrough into the rootless container would be a new pin plus a host installation, both owner decisions.
- **The pinned local model failed the one real defect it was run on.** Under the engine-enforced JSON-schema protocol Qwen2.5-Coder-14B Q4_K_M returned a schema-valid, in-scope patch in 99 s, and the frozen evaluator rejected it at the same assertion the baseline fails. Under the tool-call protocol two byte-identical repeats ran to `max_tokens` without a valid call. Four other evaluable cases and the held-out case were not run, so full-matrix quality is unmeasured rather than zero. Details: `03_STAGE15_BASE/hardening/15A/QUALIFICATION_CLOSURE.json`.
