# Stage 15A — Local Coding Runtime

Status: IN_PROGRESS. Local independence is `LOCAL_INDEPENDENCE_DEGRADED` until an actual local backend passes qualification inside an attested hard sandbox. No fallback to a paid or cloud coding service is active.

## 15A.1 Bounded task contract

`AyasLocalCodingTaskContract` accepts an exact base commit, one or two repo-relative TypeScript source paths, a bounded objective, and at most 80 changed lines. It rejects unknown fields, including backend, command, network, owner approval and validator-script requests. It is a request data shape only: it cannot run a model, select a backend, write source, freeze an artifact, create a proposal or approve execution. The existing patch-safety and owner/execution gates remain authoritative.

The Stage 8 TEMP clone uses environment filtering and a closed proxy, which alone is not an attested network-denied hard sandbox for general agent code. Do not activate a coding backend using that boundary alone. Local `ollama` CLI was unavailable at this checkpoint, so no current-hardware model qualification is claimed.

Next: design and test a provider-neutral local adapter and hard-sandbox admission that fail closed; then deterministic historical/held-out coding qualification, immutable artifact and existing proposal bridge. Any execution must remain disabled until all containment and approval gates pass.

## 15A.2a Provider-neutral local container plan

`AyasLocalCodingContainerPlan` describes a replaceable local image by immutable digest and creates only a fixed probe invocation. It refuses remote/cloud engines, mutable image tags, workspaces outside a dedicated OS TEMP root, symlinks/junctions, `.git`, `node_modules`, `data`, `.env`, absent task files and path traversal. The planned container has no network or image pull, a read-only root and workspace mount, dropped capabilities, bounded PID/memory/CPU, a fixed non-root user and a fixed probe entrypoint. No command comes from task text.

This is a construction check, **not** hard-sandbox admission. It runs no image and grants no execution capability. At this checkpoint `docker` and `podman` are absent; WSL has no accessible distribution. A separate real runtime probe and negative containment observations are required before any backend can be admitted. Local independence remains `LOCAL_INDEPENDENCE_DEGRADED`.
