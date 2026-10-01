# Stage 15A — Local Coding Runtime

Status: IN_PROGRESS. Local independence is `LOCAL_INDEPENDENCE_DEGRADED` until an actual local backend passes qualification inside an attested hard sandbox. No fallback to a paid or cloud coding service is active.

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
