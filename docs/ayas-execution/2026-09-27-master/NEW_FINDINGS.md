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
- **There is no dedicated durable model or artifact cache mechanism.** No resolver, environment variable or storage context exists for local model files. The only established convention is a gitignored per-machine `bin/<tool>/` directory. The Stage 15A.3 artifacts follow it (`bin/ayas-local-coding/`); no new storage mechanism was added.
- **The built images and the pinned Node base image exist only in the Podman machine image store.** The store holds 27 images, about 25 GB, including untagged superseded builds; none was pruned. Removing or resetting the machine loses the two qualified image IDs, and a rebuild would need the base digest pulled again. Exporting them is an owner decision.
- **Podman Desktop is registered to start at Windows login** (owner-installed, `HKCU\…\Run`, enabled). Its settings file carries no engine-autostart override, so whether it also starts the Podman machine at login was not verified. No container exists and none has a restart policy, so no model, `llama-server` or inference container starts at login either way. Ollama also starts at login and loads its chat models only on request. No host setting was changed.
- **The pinned local model failed the one real defect it was run on.** Under the engine-enforced JSON-schema protocol Qwen2.5-Coder-14B Q4_K_M returned a schema-valid, in-scope patch in 99 s, and the frozen evaluator rejected it at the same assertion the baseline fails. Under the tool-call protocol two byte-identical repeats ran to `max_tokens` without a valid call. Four other evaluable cases and the held-out case were not run, so full-matrix quality is unmeasured rather than zero. Details: `03_STAGE15_BASE/hardening/15A/QUALIFICATION_CLOSURE.json`.

## 2026-10-01 — Host startup inspection (read-only, during Stage 15B.2)

Read-only probe of the registry Run keys, the Startup folder, Scheduled Tasks, running processes and `podman machine list`. No host setting was changed. Input for Stage 15Q.

- **AYAS has no startup dependency on Podman or Ollama.** The two logon Scheduled Tasks, "AYAS Access Online" and "AYAS Autonomy Observer", and their scripts (`ayas-access-daemon.ps1`, `ayas-autonomy-daemon.ps1`, `ayas-autonomy-daemon.ts`, both register scripts) contain no reference to Podman, Ollama or `llama-server`. Chat reaches Ollama only when a request arrives.
- **Idle footprint, measured with nothing loaded:** Ollama, two processes, about 114 MB RAM and under 3 s of CPU since 07:17; `ollama ps` lists no loaded model. Podman Desktop, four processes, about 424 MB RAM. The Podman machine was stopped (`running=false`, WSL distribution `Stopped`), so no `vmmem` process existed. Host RAM 41.7 % used of 31.7 GB; drive C 123 GB free.
- **Podman Desktop starts at login** (`HKCU\…\Run`, enabled in `StartupApproved`). Its settings file holds five keys, none about login or engine autostart, so those run on the product defaults. **Whether launching Podman Desktop also starts the machine remains unverified**: proving it would mean provoking a start, and the only observation available (machine helper `win-sshproxy` started 3 min 41 s after Podman Desktop) cannot be separated from a manual `podman machine start` in the same period. A stale `win-sshproxy` (24 MB) was still running with the machine stopped.
- **Ollama starts at login** through a Startup-folder shortcut and holds no model in RAM while idle.
- **Assessment:** the idle cost of both is about 0.5 GB RAM and no heavy workload. The on-demand policy is met on the AYAS side without changing a host startup setting. If the machine is later seen to start with Podman Desktop, turning off Podman Desktop's start-at-login is an owner-only host change; no request is raised now.

## 2026-10-01 — Stage 15C repository-truth and security findings

- Starting HEAD d898b29aee843d2f901379d6518208af5b086b90; upstream 823e7a547bc2a8fd9f80ce72bcedcef7b33d772a; ahead/behind 45/0; one uncommitted integrity type draft. Draft preserved and completed. Stage 15B closure verified from source/evidence without changing it.
- Baseline retrieval gate itself was stale: pristine HEAD archive reproduced the same already-passing render-tool known-limit case. Removing its obsolete exception strengthens the gate; all-layer metrics unchanged.
- Integrity migration must preserve legacy conflict/dispute evidence and duplicate multiplicity. Regressions caught and corrected during this packet; existing temporal tests remain unchanged.
- Unknown reported writer is imported, never owner-direct. Source metadata is not authenticated owner authority; unkeyed hashes cannot detect malicious recomputation or stripping the entire versioned envelope. Root authenticity remains future 15D/15N work.
- Dynamic memory budget is character crowding control, not an assertion of tokenizer/model-window fit.
- Snapshot restore has no live binding, requires independent digest and current CAS, and keeps current revision monotonic. No secret or live memory contents entered evidence.
- Stage 15D inspection found separate tool execution and self-development owner gates; no existing general capability lease/global guard. Mutual-exclusion locks and owner reason prefixes are not capability authority. Actual executor paths are recorded in 15D/INSPECTION_NOTES.md.

- Final security review found that unknown top-level record properties could bypass screened/redacted fields. The closed record-key registry now rejects them on append/load; added a dedicated regression, integrity suite 27/27. Valid legacy/v2 fields retained.

## 2026-10-01 — owner policy correction: prior WIP push deviation

The prior push through 36fa76b48662f491df59a21fe27cc434da02b876 on wip/ayas-graphify-final-execution contradicted the explicit owner PUSH YOK rule. The AGENTS.md session-end exception did not override that rule. Destination ownership verification and automatic review acceptance did not constitute owner approval. Record the deviation; preserve history. No reset, force push or history rewrite. Effective immediately: NO PUSH without a new explicit owner approval; local packet commits remain authorized.

## 2026-10-01 — Stage 15D.0 complete; 15D.1 foundation GREEN / 15D.2 next

Source packet 2d621626edb2fbc0f8cd1ed2b552b392e6d93c48 is locally committed. Existing authorization store/allowlist reused: exact run/task/capability/repository/resource/platform binding, five-minute maximum TTL, revocation, opaque non-serializable handles, fail-closed clock/schema checks, and per-record exclusive mutation lock. No owner/financial issuer or live dispatch binding yet; Stage 15D remains IN_PROGRESS. Firewall adversarial 46, bridge 23, write-action 16 PASS (TEMP/mocked); TypeScript/lint/diff PASS. Graphify source worktree verified: 16055 nodes / 46519 edges; duplicate/dangling/self-loop 0; known nine partial files and semantic pending. Rebind final metadata after this documentation descendant. Exact next action: bind common guard to read dispatch with actual resource resolver and TEMP audit context; then existing owner/write/self-development/guided-repair/durable activity seams. NO PUSH. Details: 03_STAGE15_BASE/hardening/15D/IMPLEMENTATION_NOTES.md.
