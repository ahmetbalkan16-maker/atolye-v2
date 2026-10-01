# Stage 15A.3 local image draft

This recipe is reviewable preparation, not a built image or a hard-sandbox probe.
Do not add it to the reviewed engine registry. The current production probe remains
closed; this draft's entrypoint deliberately does not impersonate `/ayas-sandbox-probe`.

Repository toolchain: npm/package-lock.json, Next 16.2.10 requires Node >=20.9.0;
tsx 4.23.1 and TypeScript 5.9.3. The exact Node 24.18.0 linux/amd64 base matches
the host Node version. Linux esbuild and any native dependencies must be prepared
and sealed for Linux; the Windows dependency tree is not a usable payload.
The full application includes ONNX install hooks and must not be copied into this image.

Prepare TWO separate, fresh TEMP build contexts. Inference gets only the exact model,
verified official engine archive and archive-derived binaries/libraries, including licenses.
The evaluator gets the frozen evaluator import closure and sealed Linux TypeScript
toolchain. Never include Git, golden patches, production/private data, credentials,
the host repository, or evaluator internals in an inference payload/prompt.
This separation keeps historical answers outside the model's context.

Each context holds this Containerfile, verify-payload.mjs, BUILD_INPUT.json and payload/.
BUILD_INPUT schema is exactly `{schemaVersion:"1",role:"INFERENCE"|"EVALUATOR",files:
[{path,sizeBytes,sha256}]}`. Every regular payload file must be declared and hash-matched;
links, traversal, missing files, extra files and alternate model/archive pins fail closed.
The engine extraction must separately prove every extracted binary came from the verified
archive, and pass glibc/library compatibility checks; a caller-written manifest is not provenance.
The evaluator payload must separately bind package-lock and frozen blobs. No package install
is permitted in a qualification run. These preparation/compatibility gates are still pending.

After an approved local Podman/WSL2 runtime exists, cache the exact base platform manifest
and confirm its bytes/digest/platform against the official registry. Build only with no
network and pull=never, using the TEMP context. Record the recipe, every payload digest,
base platform manifest and final image content ID. An image label alone proves nothing.
Inspect with the existing image/containment contracts; unsupported Podman inspection
shapes must refuse rather than be guessed from Docker-shaped synthetic fixtures.

Qualification must use network=none, pull=never, read-only root, dropped capabilities,
no-new-privileges, non-root 65534:65534, 2 CPU/4 GiB/64 PID limits and host-enforced
timeouts/cleanup. Mount only a validated Git-free exact baseline TEMP projection read-only;
candidate patches stay in memory or bounded TEMP storage. No external mount, host shell,
runtime socket, package installation or credentials. Model inference can use loopback
inside its network-none container; a host loopback endpoint is HOST_DIAGNOSTIC only.
The 9 GB model cannot fit under the existing 4 GiB probe cap: a separately reviewed
inference resource plan must derive sufficient explicit RAM limits. Do not silently
widen the existing probe plan or claim this draft qualifies inference.

Remaining actual runtime work: fixed probe entrypoint, adversarial containment observations,
retained container inspection, model process supervision, offline evaluator toolchain,
final image content digest, repeated generated candidates and measured telemetry. No final
qualification command is provided before these facts exist. Keep LOCAL_INDEPENDENCE_DEGRADED.
