# Stage 15A.3h preparation report — 2026-10-01

## Outcome and evidence boundaries

Stage 15A.3 remains IN_PROGRESS / LOCAL_INDEPENDENCE_DEGRADED. The package
prepares qualification without adding model execution, approvals, proposals,
spend, installation, default provider routing or production registry entries.
No model or hard-sandbox run occurred. Stage 15B remains unopened; no push.

Official metadata validates the owner-selected engine and model; the exact Linux CPU
engine archive additionally passed real local byte verification, without execution.
The source artifact verifier only returns LOCAL_BYTES_VERIFIED_NOT_ADMITTED.
The injected model protocol only returns UNVERIFIED_HOST_DIAGNOSTIC. Synthetic
responses, image payload fixtures and historical fixes are not model success.
Actual pass@1, pass^k, hardware usage and unauthorized-activity observations remain
unmeasured. Null resource fields are intentional; host capacity is separate inventory.

## Repository and host truth

Startup HEAD 87fca074cea9c4482c57718e9151b64124e0403d, clean, ahead/behind 34/0;
git pull succeeded. The older ACTIVE_CHECKPOINT currentHead was a docs closure behind
the actual Git truth; this packet reconciles it. Canonical push is explicitly forbidden.

Read-only discovery confirmed WSL 2.7.10.0/kernel 6.18.33.2-2 and no distributions;
Docker and Podman CLI absent. HypervisorPresent=true and vmcompute stopped. CPU
i9-13900, RAM 34,033,348,608 bytes. NVIDIA RTX A2000 12GB reports 12,282 MiB/driver
596.71 through nvidia-smi. Windows CIM AdapterRAM is limited/misleading for the
12 GB board and was not treated as VRAM truth. Reported false CPU virtualization
flags under an active hypervisor do not prove firmware virtualization is unavailable.
No host feature, service, BIOS, installer or reboot change occurred.

**BLOCKED_OWNER_ACTION — host sandbox runtime installation required** replaces the
obsolete engine-candidate-selection blocker: the owner already selected the candidates.
The final image remains to be built and independently verified rather than implicitly approved.

## Official pin verification

See CANDIDATE_PROVENANCE.json for API/source links, immutable refs, digest and size.

- llama.cpp v0.5.0 is annotated tag object c13fcbf684171d5e0bca3fc5c34be6a99174b05f,
  dereferencing to 7fe450e19305b828c199d602c23a8337aaa1f03b. The release API's
  target_commitish differs and must not be used as the release identity.
- The release's nightly-tag pointer says b11146; that exact release/commit is
  7fe450e19305b828c199d602c23a8337aaa1f03b. Official Linux and Windows CPU archives
  are pinned by their published size/digest. MIT license was read at the exact commit.
  The 16,998,357-byte Linux CPU archive was downloaded into owned TEMP and verified
  against its exact published digest with the new artifact verifier. Fifty regular
  members were hashed directly from the verified gzip/tar buffer, without installation
  or execution. llama-server member SHA is
  22de090746c114569367998ec930b28f27f12e078e593ff21175a54b409d26fe. Static symbol
  scans show maximum GLIBC_2.34/GLIBCXX_3.4.30 among regular members; these are not
  complete dynamic dependency/compatibility proof. ENGINE_ARCHIVE_MEMBERS.json
  preserves all member digests/sizes and the evidence class. Windows archive bytes,
  actual runtime compatibility and final image bytes remain unverified.
- Official Qwen immutable ref d0a692ef765eefbf2fabb130b3cb2e8917e3d225 publishes
  the selected single GGUF at 8,988,110,272 bytes and SHA-256
  c1e659736d89ac1065fb495330fb824d94001974a4bfa78e7270e43476a8d940, Apache-2.0.
  Split files are not substituted. No local bytes downloaded, verified or executed.
- Official Node tag 24.18.0-bookworm-slim resolved to an index and an explicit
  linux/amd64 platform manifest. Containerfile pins the platform digest, not the tag.

## Additive architecture

AyasLocalCodingPins holds candidate identity, strict manifests, bounded incremental
file hashing, cancellation and structural runtime/image claims. Files must be plain
absolute paths, with size/hash and stable identity checks. Candidate pins are not
added to REGISTERED_LOCAL_ENGINES and cannot mint a containment/approval permit.

AyasLocalCodingModelAdapter constructs the llama.cpp/OpenAI-compatible request but
has **no default network transport**. Tests inject synthetic responses. Only the
numeric IPv4 loopback endpoint shape is accepted; no DNS, credentials, cloud endpoint,
query or redirect policy is delegated by task text. A future transport must itself
enforce bounded streaming, redirect refusal and container-local endpoint semantics.
Host-loopback responses remain host diagnostics regardless of apparent success.

Only parsed task objective/scope/budget plus exact baseline source bytes/hashes enter
the model request. No Git history, base/fix commit, split/case ID, evaluator, answer,
host manifest, prior response or expected patch is added. Source text is untrusted.
One fixed submit_patch call is accepted; alternate tool names, malformed/truncated
output, model mismatch, extra message fields, stale before-hash, ambiguous search,
outside-scope edits, duplicate paths, no-op edits, bad encoding and oversized context/
patch/line budget are refused. Materialization is in memory; no host source write or
arbitrary tool invocation occurs. Request snapshot, candidate, response and model
digests are retained as diagnostic provenance. Timeout races abort the injected
transport, including an uncooperative Promise; actual model process kill is still pending.

Existing qualification report remains unchanged and validates complete repeated
primary/held-out matrices and claimed pass@1/pass^k, wrong candidates, regression,
scope/file/shell/network/tool observations and optional latency/resources. Neither it
nor a synthetic repeat result becomes measured model/hard-sandbox evidence.

## Local image draft

sandbox/ayas-local-coding holds a reviewable Containerfile and offline build payload
verifier. It uses scratch plus the pinned Node/Linux libraries, without a shell,
Git or package manager. Non-root is 65534:65534. No package-install instruction exists.
Build contexts must be freshly prepared TEMP bundles, never the host repository.
Inference and evaluator payloads/images are separate so answers/evaluator internals
cannot enter the model prompt/workspace. Every payload regular file must match a
declared digest/size; extra/missing/tampered files, symlinks/junctions, traversal,
Git metadata, environment/SSH/package credentials and alternate inference pins refuse.
The verifier proves bytes match declarations, not archive extraction provenance or
dependency trust. A reviewed sealed Linux toolchain/import closure is still required.

This is DRAFT_ONLY: no image build, final content digest, runtime-compatible probe,
Podman inspection sample or actual container exists. The default entrypoint merely
re-verifies payload bytes and deliberately cannot pass the existing containment probe.
Qualification requires pull=never/network=none/non-root/read-only root/exact TEMP
workspace/no external mount and explicit limits, host process timeout and deterministic
cleanup. A distinct explicit inference resource plan is required: the existing 4 GiB
probe cap cannot hold the 9 GB model. No existing cap or security authority was widened.

## Additional retrieval case, without changing the original five

The previously rejected retrieval-only source fix is still rejected. A separate case
freezes both historically co-required source repairs from 4fc5b64 to 309c1fe:
AyasMemoryRetrieval.ts (47 lines) and AyasMemoryCandidate.ts (2 lines), total 49 within
the existing two-file/80-line limit. It runs the **whole** frozen memory evaluator
blob 7f621a3992d7fdf46f0e2eab8e4cfe34e1bfd82f, SHA-256
5160c020ba4f2b9f3eb4e2375ed6715babb681422410bf0cf724bea898123fdf (29 scenarios).

Baseline and retrieval-only fix fail exactly at frozen assertion line 92 (identity
candidate missing); identity-only fix fails exactly at line 317 (later equal-trust
correction selects 0 instead of 1); exact historical pair passes 29/29; wrong no-op
fails at line 92. Evaluator bytes are checked before each run and never edited.
Git-free projection contains only both baseline source blobs; prompt excludes hidden
case/split/fix/evaluator identity. No source threshold was enlarged and no partial
target assertion replaced the full evaluator. The original five-case vault, oracle
and evaluators are byte-unchanged. This is a sixth **host oracle**, not a sixth model pass.

## Validation

- Pins/adapter: 35/35 offline scenarios, including cancellation, endpoint/refusal,
  mutation snapshot, unknown tools, wrong/stale/scope candidates and repeat reset.
- Image payload: 13/13 synthetic TEMP filesystem scenarios, including outside junction.
- Added retrieval: full 29-case frozen evaluator and four baseline/partial/wrong negatives.
- Original five-case vault and baseline/fix/wrong oracle: 5/5 each; workspace 10/10.
- Task contract 21/21, plan 10/10, synthetic inspection 23/23, synthetic probe 9/9,
  synthetic report 13/13, controlled evolution/closed-gate cycle 19/19.
- TypeScript --noEmit --incremental false PASS, changed-file ESLint --max-warnings 0
  PASS, full repository ESLint 0 errors/13 pre-existing warnings in unrelated files,
  JS syntax and staged/unstaged diff checks PASS.
- Graphify refreshed after source batches; current source graph 15,781 nodes/45,783
  edges at precommit HEAD 87fca074, stale=false, needs_update=false, duplicate node/edge,
  dangling and self-loop zero. Post-commit HEAD binding is recorded by local closure.
  Known extraction limitations and semantic pending are not hidden as full graph coverage.
- Import and graph review: additions are reached only by their offline tests/host fixture;
  no production daemon/router/execution/approval coupling. Real engine registry unchanged.

## Exact remaining work

1. Continue owner-independent TypeScript-refactor case selection under unchanged limits;
   freeze only a complete independently passing evaluator, never a partial assertion.
2. Seal offline Linux toolchain/import closure from the lockfile, archive-derived engine
   binary provenance/licenses and compatible dependencies. Do not copy Windows node_modules.
3. Complete separate bounded inference/probe supervision and Podman-specific inspection/
   cleanup contracts without activating an unverified engine. Real endpoint/process telemetry
   cannot be inferred from synthetic transport or image labels.
4. Owner installs/configures a compatible Podman Desktop stable/WSL2 runtime or supplies
   an already compatible runtime. Re-discover exact identity/binary/version/backend before use.
5. Verify actual local model/archive bytes; build both pinned local images offline, record
   content digests and prove containment with negative network/write/tool/escape tests.
6. Run unchanged historical plus held-out cross-domain evaluators on repeated generated
   candidates, measuring real pass@1/pass^k, consistency, scope/misuse and resource usage.
7. Close 15A.3 only after every required pin, containment, quality, regression, Graphify and
   durable-evidence threshold passes. Until then DEGRADED; no 15B/cloud fallback/push.

## Superseded by the 2026-10-01 closure

This report describes preparation before any runtime existed. Remaining-work items 2 to 7 were then carried out on the owner-installed rootless Podman/WSL2 runtime: sealed toolchain, offline image builds, isolation matrix, in-container frozen controls, real engine liveness and real model attempts. Item 1 (a TypeScript-refactor case) was not added. Stage 15A.3 closed as `LOCAL_INDEPENDENCE_DEGRADED`. Current truth is IMPLEMENTATION_NOTES.md sections 15A.3i and 15A.3j and QUALIFICATION_CLOSURE.json.
