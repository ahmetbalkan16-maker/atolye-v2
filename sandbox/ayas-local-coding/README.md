# Stage 15A.3 local qualification images

Diagnostic recipe for the local coding qualification. Building or running it admits no
engine and qualifies no model: the reviewed production engine registry stays empty and
`LOCAL_INDEPENDENCE_DEGRADED` remains the state until a canonical threshold is met.

## Two separate images

`Containerfile` has two targets built from two separately prepared TEMP contexts.

- `inference`: the exact pinned GGUF model, the verified official llama.cpp Linux CPU
  archive and its archive-derived members. No probe, evaluator, case, toolchain, Git
  history, historical fix or vault.
- `evaluator`: `probe.mjs`, `evaluate.cjs`, the frozen evaluator import closure per case
  and the sealed Linux toolchain. It never receives the model and is never model-facing.

Both are `scratch` plus Node and the Linux runtime libraries of the official
`node:24.18.0-bookworm` linux/amd64 manifest, pinned by digest in `AyasLocalCodingPins`.
The full Debian base (not slim) is required because the pinned `llama-server` needs
`libssl.so.3`. There is no shell, package manager or Git in either image, the user is
`65534:65534`, and nothing is installed at build or run time.

## Sealed evaluator toolchain

`scripts/prepare-ayas-local-coding-image.ts <temp-root> evaluator` reads npm archives that
must already be present in the TEMP root and match the `package-lock.json` SHA-512
integrity: TypeScript, React, ReactDOM, scheduler, tsx, esbuild and `@esbuild/linux-x64`.
The native esbuild member must be an ELF64 x86-64 binary of the lockfile's exact esbuild
version. Frozen evaluator bytes are copied from their pinned Git blob and are never
rewritten; `evaluate.cjs` only loads them. Windows `node_modules` is never a payload.

The frozen temporal evaluator starts child processes through the tsx CLI, which in turn
starts the esbuild service. Unbounded Node/Go thread pools need about 90 tasks, above the
64-task cap, so `evaluate.cjs` bounds the pools (`GOMAXPROCS`, `UV_THREADPOOL_SIZE`,
`--v8-pool-size`). The cap and the evaluator are unchanged; the observed peak is 41.

`verify-payload.mjs` is a build gate and the default entrypoint: every payload file must be
declared in `BUILD_INPUT.json` with matching size and SHA-256. Links, traversal, extra or
missing files, credentials and alternate inference pins refuse. The scoped
`@esbuild/linux-x64` path is accepted for the `EVALUATOR` role only.

## Host runner

`scripts/run-ayas-local-coding-container.ts <temp-root> <phase>` drives rootless Podman:

| Phase | What it records |
| --- | --- |
| `build-evaluator`, `build-inference` | offline build (`--pull=never --network=none`), image ID, recipe and payload digests |
| `matrix` | isolation probes, PID cap, OOM kill, timeout, unexpected-mount refusal |
| `controls` | frozen evaluator in the container: baseline FAIL, historical fix PASS, wrong candidate FAIL |
| `smoke` | real pinned `llama-server` and model liveness and speed |
| `qualify [caseId] [maxAttempts]` | real model attempts through the strict adapter and the frozen evaluator |

Every container runs with `--network=none --pull=never --read-only --cap-drop=ALL
--security-opt=no-new-privileges --pids-limit=64`, explicit memory and CPU limits, a single
read-only bind of a validated TEMP directory at `/workspace`, and a `noexec,nosuid` tmpfs
at `/tmp`. The host repository, user home, credentials and runtime sockets are never
mounted. The evaluator copies a sealed case into its disposable tmpfs and overlays the
candidate there; that copy is the only writable source. Limits are asserted from inside the
container, and the OCI inspection is checked before each start.

## Host protection

The Podman WSL provider does not enforce the machine's configured memory or CPUs: all
distributions share one WSL2 VM sized by WSL defaults. The per-container cgroup limit is
the only real bound, so the inference profile is sized to the measured need (12.5 GiB,
8 CPUs, 64 tasks, no swap) and asserted from inside. Only one heavy workload runs at a
time. A model run starts only if the host would stay under 90 % RAM with the whole limit
resident; otherwise the runner stops with `HOST_PROTECTION_PAUSE` (exit 3) and can be
resumed. Sustained critical host memory or a container OOM kill is recorded as
`RESOURCE_ABORT`, never as a model failure. After each run the container is removed and
the VM page cache is released. No host or WSL global setting is changed. Measurements are
in `HOST_RESOURCE_GUARD_EVIDENCE.json`.

## Durable artifacts

The hash-verified inputs live in `bin/ayas-local-coding/`: gitignored and per-machine, the
same convention as `bin/whisper/` and `bin/piper/`. `ARTIFACT_MANIFEST.json` in that
directory lists every file with its size and SHA-256 and records the re-verification
against `AyasLocalCodingPins` and the `package-lock.json` integrity values. Do not
download anything again while that directory verifies.

| Content | Use |
| --- | --- |
| pinned GGUF, llama.cpp Linux archive | inputs of `prepare … inference` |
| seven npm archives | inputs of `prepare … evaluator` |
| `*-image-id.txt`, inspect and version JSON | image identities the runner reads |
| server logs, raw responses, `candidates/`, `build-manifests/` | evidence the 15A reports refer to |

The built images and the pinned Node base image exist only in the Podman machine's image
store. Removing or resetting that machine, or pruning its images, loses them; a rebuild
then needs the base digest pulled again.

Both scripts still require an owned `%TEMP%\ayas-qualification-<uuid>` root, because a
container may bind only a validated TEMP directory. To run with the existing images,
create a fresh root and copy the two `*-image-id.txt` files into it. To rebuild an image,
also copy the archives that role needs (the 9 GB model only for `inference`), then prepare
and build. Delete the root afterwards. A rebuilt image may get a new ID, and `qualify`
refuses an image whose `controls` and `smoke` evidence was recorded for another ID.

## On-demand lifecycle

The local coding runtime is never a resident service.

- **Idle.** No `llama-server`, no qualification or model container, no model in RAM. The
  Podman machine may be stopped.
- **Task.** Start the Podman machine if it is stopped (`podman machine start`; the runner
  refuses a machine that is not running). Then run one bounded workload: the runner
  creates the inference container, loads the pinned model, takes one answer and runs the
  evaluator container.
- **End of task.** The runner removes each container in a `finally` block and releases
  the VM page cache. When no further task is queued, stop the machine
  (`podman machine stop`) and delete the TEMP root.
- **Windows startup.** Nothing in this repository registers a startup entry, service,
  scheduled task or container restart policy for the model, `llama-server` or an
  inference container.
- One heavy workload at a time, and only while the host stays under 90 % RAM. PC health
  comes before execution speed.

`controls` are host-oracle evidence, not model results. A frozen evaluator that reports
zero scenarios or `skipped` on Linux is recorded as `PLATFORM_UNAVAILABLE`, never as a pass,
and no model candidate for that case is executed on the host.

The model sees only the task objective, the exact baseline source bytes and their hashes.
It has no tool surface: the request asks for one JSON object under an engine-enforced
JSON-schema response format, and the host parses and validates that object strictly.
Evidence is written to `docs/ayas-execution/2026-09-27-master/03_STAGE15_BASE/hardening/15A/`.
