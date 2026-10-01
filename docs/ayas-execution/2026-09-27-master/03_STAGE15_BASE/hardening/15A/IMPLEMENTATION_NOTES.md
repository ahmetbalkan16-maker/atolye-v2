# Stage 15A — Local Coding Runtime

Status: 15A.3 CLOSED as `LOCAL_INDEPENDENCE_DEGRADED` on 2026-10-01 (see 15A.3j and QUALIFICATION_CLOSURE.json). The real hard sandbox, sealed evaluator chain and pinned engine work; the pinned local model did not repair the real defect it was run on, and no canonical numeric threshold exists. No backend is registered or active. No fallback to a paid or cloud coding service is active.

## 15A.1 Bounded task contract

`AyasLocalCodingTaskContract` accepts an exact base commit, one or two repo-relative TypeScript source paths, a bounded objective, and at most 80 changed lines. It rejects unknown fields, including backend, command, network, owner approval and validator-script requests. It is a request data shape only: it cannot run a model, select a backend, write source, freeze an artifact, create a proposal or approve execution. The existing patch-safety and owner/execution gates remain authoritative.

The Stage 8 TEMP clone uses environment filtering and a closed proxy, which alone is not an attested network-denied hard sandbox for general agent code. Do not activate a coding backend using that boundary alone. Local `ollama` CLI was unavailable at this checkpoint, so no current-hardware model qualification is claimed.

Next: design and test a provider-neutral local adapter and hard-sandbox admission that fail closed; then deterministic historical/held-out coding qualification, immutable artifact and existing proposal bridge. Any execution must remain disabled until all containment and approval gates pass.

## 15A.2a Provider-neutral local container plan

`AyasLocalCodingContainerPlan` describes a replaceable local image by immutable digest and creates only a fixed probe invocation. It refuses remote/cloud engines, mutable image tags, workspaces outside a dedicated OS TEMP root, symlinks/junctions, `.git`, `node_modules`, `data`, `.env`, absent task files and path traversal. The planned container has no network or image pull, a read-only root and workspace mount, dropped capabilities, bounded PID/memory/CPU, a fixed non-root user and a fixed probe entrypoint. No command comes from task text.

This is a construction check, **not** hard-sandbox admission. It runs no image and grants no execution capability. At this checkpoint `docker` and `podman` are absent; WSL has no accessible distribution. A separate real runtime probe and negative containment observations are required before any backend can be admitted. Local independence remains `LOCAL_INDEPENDENCE_DEGRADED`.

## 15A.2b Engine inspection contract

`AyasLocalCodingContainerInspection` compares local engine `inspect` data to the fixed plan. It rejects image/entrypoint/user/env mismatches, host networking or published ports, writable root/workspace, elevated capabilities, host process namespace, missing resource caps, devices, extra mounts and unsafe tmpfs. Synthetic positive and adversarial fixtures verify the structural comparison only. Neither task/model output nor this comparator can mint an execution permit. An actual locally executed image, engine inspection and independent containment probes remain required.

## 15A.2c Local engine diagnostic harness

`AyasLocalCodingEngineProbe` is a bounded diagnostic sequence: verify locally present image digest, start the pinned probe image without pull/network, wait for its exit, compare engine `inspect` output to the fixed plan, evaluate the fixed probe report, and remove only its randomly named container even after failure. The retained probe requires `AutoRemove=false` during inspection and explicit cleanup; the ordinary plan still requires `AutoRemove=true`. Command failure, missing digest, nonzero probe exit, unsafe engine configuration and incomplete probe report refuse. The production wrapper requires a reviewed absolute local CLI binary/hash and forces the local Docker endpoint with an empty CLI config root.

The reviewed engine registry is intentionally empty on this machine. The harness therefore returns `LOCAL_ENGINE_UNAVAILABLE`; its positive test uses a synthetic runner and is not containment evidence. No execution permit, adapter activation, image installation or model qualification was created. Actual hard-sandbox proof remains pending an owner-reviewed local engine/image; independent Stage 15A benchmark and artifact work can continue.

## 15A.3a Frozen historical qualification seeds

The host-side qualification vault freezes two real, directly parented one-file Git repairs: `9e51840` explicit computer-plan semantics as PRIMARY and `3367d41` render-tool supersession as HELD_OUT. Each historical source change is 15 lines, inside the existing task contract. The evaluator scripts are bound to Git blob hashes. Only the bounded objective, base HEAD, exact source path and budget are projected to a model; fix HEAD, evaluator path/blob, split and case ID remain host-side. The container plan refuses this vault by name if it appears in a candidate workspace. A future workspace builder must positively allowlist intended context instead of relying on this name check alone.

This is an initial fixture pair, not the required cross-domain qualification suite. No baseline-fail/candidate-pass run, pass@1, pass^k, latency or hardware measurement was performed. Graphify, security, UI, retrieval and TypeScript task coverage still need separate real historical/held-out fixtures. No backend is active.

## 15A.3b Host-side historical oracle

`smoke-ayas-local-coding-qualification-baseline.ts` checks both frozen cases in disposable OS-TEMP Git clones. The evaluator bytes are loaded by their pinned Git blob, then run against the exact historical baseline source, exact fix source, and a deliberately wrong no-op source change. Both cases produce baseline FAIL, historical fix PASS and wrong-candidate FAIL; each baseline and wrong-candidate error is checked for its exact expected fact key. The candidate is the known historical fix, not a generated model response.

The clone is a host-only evaluator surface and shares Git history and local dependencies. It must never be handed to a model: the repository history contains answer commits. Evaluator timing here measures host test execution only. Model pass@1, pass^k, consistency, scope/tool violations, model latency, hardware/resource use, real containment and cross-domain quality remain unmeasured. Local coding remains disabled and `LOCAL_INDEPENDENCE_DEGRADED` remains the honest state.

## 15A.3c Security qualification seed

The vault now includes the real `1c1ab79` bounded-file-write fix from its direct parent. Its single source file changes 57 lines within the 80-line task contract. The frozen evaluator blob adds a second-file commit failure: the old source does not reject/roll back as required, the exact fix passes, and a wrong no-op candidate fails on the same expected rejection assertion. This covers one historical security task only. The evaluated clone is still host-only and cannot be used as a model workspace. Graphify, UI, retrieval and TypeScript task domains and actual local-model measurements remain pending.

## 15A.3d Git-free model workspace projection

`AyasLocalCodingWorkspace` constructs a new OS-TEMP directory from only the task's exact baseline Git blobs. It checks the repository root and baseline ancestry, accepts regular UTF-8 source blobs within a byte limit, and refuses evaluator/fixture paths, symlink Git entries and missing objects. It copies no `.git`, answer commit, evaluator, dependencies or scripts outside the exact task files. Blob IDs and hashes are returned to the host as provenance, never written into the model-facing directory. The directory is compatible with the existing fixed container plan, but this remains a construction check, not containment proof or model admission.

Workspace smoke: three real vault tasks each expose only exact baseline source bytes, not the fix or evaluator; forbidden evaluator/fixture paths, absent baseline and non-owned cleanup are refused (8 cases). TypeScript and changed-file lint pass. The approved engine registry remains empty, Docker/Podman are absent and WSL has no distribution. **BLOCKED_OWNER_ACTION — owner-reviewed local engine/image selection required** for real qualification. `LOCAL_INDEPENDENCE_DEGRADED` remains; no model/engine run occurred.

## 15A.3e Qualification observation contract

`AyasLocalCodingQualificationReport` validates a complete case-by-repeat matrix against frozen case IDs, baseline HEADs, evaluator blob IDs, exact file scope and line budgets. Every attempt must declare the same local engine binary SHA-256, pinned image digest and model digest, plus candidate hash, outcome, regression/negative-control observations, misuse and unauthorized access counts, latency and optional resource measurements. Unknown fields, incomplete/duplicate repeats, invalid paths, mismatched pins and non-finite measurements are refused. The summary calculates **claimed** pass@1, pass^k and held-out pass@1, counts scope and tool/network/file/shell observations, and retains per-attempt latency/CPU/RAM/VRAM values.

The schema does not attest that an engine, container or model ran, that the declared pins match local binaries, or that a candidate passed an evaluator. It always returns `UNVERIFIED_HOST_DIAGNOSTIC`; no threshold or execution gate consumes it. Its 13 smoke scenarios use synthetic attempts only. The separate three-case host historical oracle and eight-case workspace smoke still pass; TypeScript and changed-file lint pass. Model runs and real hardware measurements remain zero. Qualification and Stage 15B remain blocked pending an owner-reviewed local engine/image and actual hard-containment proof.

## 15A.3f Historical UI qualification seed

The vault adds one bounded Development Center proposal-view repair as a PRIMARY `UI` case: `ce6652b`→`2a13c34`, with only `AyasApprovalInboxView.ts` in model scope (10 changed lines) and the full `smoke-ayas-development-center.ts` evaluator frozen at Git blob `6ff859f`. The historical commit also changed micro-batch view code, which is **outside this task's scope**; this case asserts only the proposal daily projection and runs the complete frozen development-center evaluator against the one-file fix. Baseline fails on yesterday's stale proposal, the exact one-file historical fix passes the full evaluator, and a wrong no-op candidate fails on that same item. The fourth case does not make the vault cross-domain-complete: Graphify, retrieval and TypeScript refactor tasks remain pending.

Vault binding 4/4, host baseline/fix/wrong oracle 4/4, Git-free workspace leakage smoke 9/9, synthetic report 13/13, container plan 10/10, Stage 15 controlled cycle 19/19, TypeScript, changed-file lint and diff check pass. The prior Graphify case was rejected for unrelated full-evaluator failures and remains excluded. No local model or hard-sandbox run occurred; `LOCAL_INDEPENDENCE_DEGRADED` remains.

## 15A.3g Historical Graphify qualification seed

A separate Windows local Graphify refresh case uses `88d662e`→`0e54633`, the one-file `AyasPostPublicationClosure.ts` patch (9 changed lines), and full frozen Windows launcher evaluator blob `58c7d09`. The baseline and wrong no-op both terminate with the exact `AyasPostPublicationClosureError` code `AYAS_POST_PUBLICATION_GRAPHIFY_REFRESH_FAILED` caused by `spawnSync npx.cmd EINVAL`; the one-file historical fix passes all three frozen evaluator scenarios. The evaluator's temporary Git remote is under the host oracle's disposable run root, and is never exposed to the model workspace. This case is independent of the earlier rejected Graphify daemon case, which remains excluded.

Vault/oracle 5/5, Git-free workspace 10/10, synthetic report 13/13, container plan 10/10, Stage 15 cycle 19/19, TypeScript, changed-file lint and diff check pass. Retrieval and TypeScript refactor domain cases remain; no actual local model/engine or attested hard sandbox has been used.

## 15A.3 remaining qualification gap

The five frozen cases are host-only historical checks, with one held-out memory case. The `309c1fe` retrieval-file change is bounded at 47 lines, but its full frozen memory evaluator also asserts an identity-candidate fix in another source file. A one-file retrieval case would fail that unrelated required assertion, so it was not admitted. Surveyed TypeScript refactors `0ef362c`, `86ad2e2`, `c53ddad` and `0a03cad` exceed the current one/two-file, 80-line task contract or lack a separately frozen complete evaluator. Do not convert a partial target assertion into a green qualification case.

Real model runs, hard-container inspection and adversarial containment probes, pass@1/pass^k, held-out model quality, actual misuse observations and hardware metrics remain pending. The exact external prerequisite is **BLOCKED_OWNER_ACTION — owner-reviewed local engine/image selection required**. Stage 15A stays open, local coding disabled and `LOCAL_INDEPENDENCE_DEGRADED`; Stage 15B stays unopened.

## 15A.3h Owner-selected candidate preparation and additive retrieval oracle

Current entry supersedes the earlier candidate-selection blocker and the one-file retrieval limitation; historical records above stay intact. Owner selected the engine/model. Official exact refs/hash/license/base metadata are verified; the Linux CPU archive additionally passed actual local byte verification and member hashes without execution. See CANDIDATE_PROVENANCE.json and ENGINE_ARCHIVE_MEMBERS.json.

New pin/diagnostic protocol and image-payload contracts have 35/13 offline scenarios. They grant no authority or default transport. A separate two-file/49-line retrieval case passes the full unchanged frozen 29-case evaluator, while baseline, each partial repair and wrong no-op fail at exact assertions. Original five cases/evaluators unchanged. Git-free prompt projection does not reveal host case/fix/evaluator identity.

BLOCKED_OWNER_ACTION — host sandbox runtime installation required. WSL has no distributions; Podman/Docker absent. Image remains DRAFT_ONLY; model bytes, final image, actual containment, runtime process/Podman inspection, sealed Linux toolchain and real repeated quality/telemetry remain pending. TypeScript-refactor domain case remains unfilled; no evaluator/threshold weakening. LOCAL_INDEPENDENCE_DEGRADED and Stage 15B unopened; no canonical push. The full evidence boundaries, validation and exact remaining work are in QUALIFICATION_PREPARATION_REPORT.md.

## 15A.3i Real sandbox, sealed executor chain and engine liveness

Current entry supersedes the runtime-installation blocker above: the owner installed rootless Podman 6.0.2 on WSL2 (HOST_RUNTIME_EVIDENCE.json). The pinned GGUF (8,988,110,272 bytes) and the Linux engine archive match their pins byte for byte; nothing was re-downloaded.

**Images.** `Containerfile` now pins the official full Debian `node:24.18.0-bookworm` linux/amd64 manifest `sha256:4e9cb555…` (index `sha256:5711a0d4…`); the slim base could not load `libssl.so.3` for the verified `llama-server`. Two targets are built offline (`--pull=never --network=none`, no package install) from separately prepared TEMP contexts. The inference image holds only the model and archive-derived engine members; the evaluator image holds the probe, the loader, the frozen evaluator import closure and the sealed toolchain. Image IDs, manifest digests, recipe and payload digests are in IMAGE_BUILD_EVIDENCE.json.

**Sealed executor chain.** The frozen temporal evaluator starts its concurrent writers through the tsx CLI, which needs the Linux esbuild binary. tsx 4.23.1, esbuild 0.28.1 and `@esbuild/linux-x64` 0.28.1 are taken from archives that match the `package-lock.json` SHA-512 integrity; the native member is checked as an ELF64 x86-64 binary of the lockfile's exact version. The payload verifier accepts the scoped `@esbuild/linux-x64` path for the evaluator role only. Frozen evaluator bytes are still loaded from their pinned Git blobs; `controls` recomputes each blob ID from the sealed bytes.

**Root cause of the temporal positive-control failure.** The exact historical fix exited 134 inside the container. Measured cause: the evaluator's process tree (loader, two tsx CLIs, two inner Node processes, two esbuild services) needs about 90 tasks with default thread pools, above the 64-task cap, so the Go runtime failed with `failed to create new OS thread (errno=11)` (`pids.events max 40`). `evaluate.cjs` now bounds the pools (`GOMAXPROCS=2`, `UV_THREADPOOL_SIZE=1`, `--v8-pool-size=1`): the same unchanged evaluator passes 52 scenarios at a peak of 41 tasks with zero cap events. The cap and the evaluator were not changed.

**Disposable overlay.** The evaluator copies the sealed case into its `noexec` tmpfs and overlays the candidate there. The host repository is never mounted; `/workspace` is a read-only bind of one TEMP directory holding `candidate.json`.

**Evidence on the rebuilt evaluator image.** Isolation matrix 23/23 plus OOM kill, timeout stop and unexpected-mount refusal (HARD_SANDBOX_EVIDENCE.json). Frozen controls in the container: five cases each baseline FAIL → exact historical fix PASS → wrong candidate FAIL at the expected assertion. The Windows-only Graphify launcher evaluator reports zero scenarios on Linux and is recorded as `PLATFORM_UNAVAILABLE`, never as a pass (FROZEN_CONTAINER_NEGATIVE_CONTROLS.json). These are host-oracle controls, not model results.

**Engine liveness.** The pinned `llama-server` and model load and answer inside the rootless, network-none inference container with the live boundary asserted from inside (LLAMA_SERVER_SMOKE_EVIDENCE.json). CPU-only speeds are about 25–32 prompt tokens/s and 4–5.5 generated tokens/s.

**Three harness defects found by the first real engine contact**, all in code that had only ever met synthetic transports. None is a model result, and every attempt made under a defective harness is kept as a `supersededAttempts` record that is neither counted nor deleted:

- The in-container HTTP helper used `fetch`, whose client aborts after a fixed 300 s without response headers (`UND_ERR_HEADERS_TIMEOUT`). A non-streamed completion sends its headers only when generation ends, so every generation longer than 300 s was cut while the server was still producing tokens (1,051 at the cut). The helper now uses `node:http` with the bounded socket timeout and reports a single clean `CLIENT_ERROR:` line. Attempts are bound to the exact helper bytes (`transportClientSha256`).

- The adapter refused any timeout above 60 s, yet a 1.7k-token prompt alone takes about 71 s on this CPU-only engine, so no real attempt could complete. The ceiling is now `AYAS_LOCAL_CODING_MODEL_MAX_TIMEOUT_MS` = 30 min: an operational kill bound covering a full 16k-token prompt plus the fixed `max_tokens` at the measured speeds. It is not a latency or quality threshold.
- The pinned server ignored the OpenAI object form of `tool_choice` (`Wrong type supplied for parameter 'tool_choice' … type must be string`) and silently fell back to `auto`, so the forced single `submit_patch` call was never enforced and the model answered in prose. The request was changed to the string form `tool_choice: "required"`; section 15A.3j records what the engine did with that.

**PC health guard.** See HOST_RESOURCE_GUARD_EVIDENCE.json. The Podman WSL provider does not enforce the machine's 8 GiB; the per-container limit is the only bound. The inference profile went from 14 GiB to the measured 12.5 GiB, one heavy workload runs at a time, a run starts only if the host stays under 90 % RAM, and resource aborts are never counted as model failures.

New offline regression `smoke-ayas-local-coding-model-boundary.ts` checks all six real cases: the model-facing workspace holds only the exact baseline sources and the request carries no case ID, split, base/fix commit, evaluator identity or any substantial line the historical fix adds.

No engine is registered, no default transport exists, and no approval, proposal or execution authority changed. `LOCAL_INDEPENDENCE_DEGRADED` remains; Stage 15B is unopened; nothing was pushed.

## 15A.3j Real local-model qualification and closure

**Result: Stage 15A.3 is closed as `LOCAL_INDEPENDENCE_DEGRADED`.** The pinned Qwen2.5-Coder-14B Q4_K_M on the pinned CPU llama.cpp engine did not repair the one real historical defect it was run on. No engine is registered and local coding stays disabled. The full record is QUALIFICATION_CLOSURE.json.

Three real model observations were made, all on the security case `historical-atomic-bounded-write` (one source file, 57-line historical fix, frozen 18-scenario evaluator):

| Protocol | Repeat | Outcome | Tokens (prompt / generated) | Generation | Evaluator |
| --- | --- | --- | --- | --- | --- |
| tool call, `tool_choice: "required"` | 1 | `INVALID_OUTPUT` (`finish_reason: length`) | 1,981 / 4,096 | 1,116 s | not reached |
| tool call, `tool_choice: "required"` | 2 | `INVALID_OUTPUT`, byte-identical output | 1,981 / 4,096 | 1,088 s | not reached |
| structured output (JSON schema) | 1 | `FAIL` | 1,706 / 181 | 99 s | exit 1, same assertion as the baseline |

**Tool-call protocol.** Neither repeat is an infrastructure failure: the engine accepted the request, generation ran uninterrupted to the fixed `max_tokens`, and no timeout, OOM, PID-cap or host-protection event occurred. The existing output and the server's `/props` response show why it ran long. The model wrote a complete `submit_patch` object in about 195 tokens, but inside a markdown `json` fence instead of the `<tool_call>` tags its own chat template asks for. The engine reports `supports_tool_calls: true` for the template yet did not constrain generation under `"required"`, so nothing stopped the model: it went on to explain the patch and, at temperature 0, repeated one paragraph until the limit. A third deterministic repeat was not run. Frozen record: LOCAL_MODEL_RUN_EVIDENCE_TOOL_CALL_PROTOCOL.json.

**One narrow protocol correction.** The single-call contract assumed engine enforcement that this engine does not provide for this model. The request now carries no tool surface and asks for `response_format: json_schema` with the same patch schema, which the engine enforces by grammar and which ends when the object closes. The adapter accepts exactly one complete JSON object as content; a truncated answer, any tool call, prose or a fenced block is refused, so the earlier fenced output can never be salvaged. `max_tokens`, the frozen evaluator, the scope limits and the strict in-memory patch validation are unchanged, and the model was given nothing beyond the task and baseline source.

**Verification run (one, as bounded by the owner).** With the correction the model produced a schema-valid patch that passed the strict adapter (exact file, matching source hash, unique search, 2 changed lines). The frozen evaluator ran it in the container and failed at `Missing expected rejection` (`smoke-ayas-bounded-file-write.ts:115`), the assertion the unrepaired baseline also fails. The candidate is a one-line path-normalisation change that does not add the rollback behaviour the evaluator requires. This is a real capacity result, not a format or harness artefact.

**What was not measured.** Four evaluable cases (memory-temporal primary, UI, two-file retrieval and the held-out render-tool case) were not run with the model: the owner bounded further heavy inference to the minimum needed for the closure decision, and with no canonical numeric threshold more runs could not change it. The Graphify case is `PLATFORM_UNAVAILABLE`. Full-matrix pass@1/pass^k and held-out quality are therefore unmeasured, not zero. GPU and VRAM are `null`: the pinned engine is CPU-only.

**Resources.** About 25–28 prompt tokens/s and 3.9–5.0 generated tokens/s on 8 CPUs; model load about 12 s; container memory at its 12.5 GiB limit with no OOM; 19–23 of 64 tasks; host RAM peak 84.8–87.9 %, back to about 45 % after each run. No resource abort and no host-protection pause.

**Not counted.** Four attempts made under harness defects (two under the ignored object-form `tool_choice`, two cut by the 300 s `fetch` headers timeout) stay in the evidence as `supersededAttempts`.

**Regression at closure.** Pins/adapter 38/38, image payload 17/17, model boundary 12/12, retrieval case full evaluator 29/29 with negatives, host oracle baseline (five cases baseline FAIL → fix PASS → wrong FAIL), vault 5/5, workspace 10/10, task contract 21/21, container plan 10/10, inspection 23/23 and probe 9/9 (synthetic), report 13/13 (synthetic). TypeScript passes; changed-file lint has zero warnings; full lint 0 errors / 13 pre-existing warnings.

Re-qualification needs an owner decision on at least one of: a numeric threshold, a different pinned model or engine, or GPU passthrough into the sandbox. There is no cloud fallback.

## 15A.3k Artifact durability and on-demand runtime policy

The owner accepted the qualification result as recorded and bounded this step to closure work: no further optimisation, model trial, heavy inference, GPU passthrough, threshold or alternative pin. The classification is unchanged.

**Durable artifacts.** The verified inputs sat only in `%TEMP%`, where a cleanup could remove a 9 GB download. The repository has no dedicated model or artifact cache mechanism. Its existing convention for per-machine local AI binaries and models is a gitignored `bin/<tool>/` directory (`bin/whisper/`, `bin/piper/`), so the artifacts now live in `bin/ayas-local-coding/` and one `.gitignore` line covers it. Nothing was downloaded again and nothing is tracked by Git.

- The model was moved by a same-volume rename; the other 56 files were copied and compared hash-equal with their TEMP source.
- Re-verification at the durable path: the model and the Linux engine archive match their pins through `verifyAyasLocalCodingArtifact`; seven npm archives match the `package-lock.json` SHA-512 integrity; the evaluator and inference `BUILD_INPUT.json` match `payloadManifestSha256` in IMAGE_BUILD_EVIDENCE.json; both image ID files match the recorded IDs; the model's `candidate.json` matches the recorded SHA-256.
- `ARTIFACT_MANIFEST.json` in that directory lists 57 files, 9,016,238,513 bytes, each with size and SHA-256.
- Only after that was the TEMP root deleted. Not persisted, because they are derived and regenerable: the three build contexts (one held a second 9 GB copy of the model), the oracle negative-control inputs and the empty probe workspaces. The support files and manifests of all three contexts, including the superseded evaluator context, are kept under `build-manifests/`.

The runner and the preparation script are unchanged and still require an owned `%TEMP%\ayas-qualification-<uuid>` root. The README describes how to stage one from the durable directory.

**On-demand runtime policy.** The local coding runtime is not a resident service. Idle means no `llama-server`, no model or qualification container and no model in RAM. A coding task starts the Podman machine if needed, runs one bounded workload and removes the container; the runner already does the removal and the page-cache release in `finally` blocks. With no task queued the Podman machine is stopped. The repository registers no startup entry, service, scheduled task or container restart policy for the model, `llama-server` or an inference container. One heavy workload at a time, under 90 % host RAM.

State at this closure: zero containers, Podman machine stopped, no `llama-server` process.
