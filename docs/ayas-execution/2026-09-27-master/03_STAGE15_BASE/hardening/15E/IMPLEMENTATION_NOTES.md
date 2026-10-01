# Stage 15E — Model / Strategy Lifecycle Manager

Closed GREEN on 2026-10-01 at source `b05283a` (local commits only, not pushed).

Canonical requirement: DISCOVERED → PINNED → QUALIFIED → SHADOW → CANARY →
ACTIVE → DEGRADED → RETIRED for LLMs, coding models, TTS, image/video helpers,
prompts, improvement strategies and evaluator versions; an immutable identity
instead of a mutable tag; promotion only on capability, regression, security,
hardware fit, repeated consistency and held-out evidence; canary on bounded
internal tasks only; a regression leads to a last-known-good rollback or a
proposal. Newer is not better.

## 15E.0 — what already existed

| Subject | How it was identified before | Finding |
| --- | --- | --- |
| AYAS chat and pipeline text model | Ollama tag from `OLLAMA_MODEL` / `AYAS_OLLAMA_MODEL` | a tag is mutable; no digest was recorded |
| Local coding model | `AyasLocalCodingPins` (HF revision and SHA-256), Stage 15A closure | already pinned; real result DEGRADED |
| Phone model | immutable revisions in `phoneLlmModelResources` | already pinned (browser side; not in this registry) |
| Speech to text, wake word, narration voice | local files selected by path | no hash recorded |
| FFmpeg | path from the environment | no hash recorded |
| Hosted narration and image providers | provider name from the environment | cannot be pinned by the caller |
| Prompts, discovery strategy, research experiment, evaluators | source files | no version identity; the Stage 8 evaluator's SHA was tracked by hand |
| Cloud chat model | `CloudAyasProvider` | never selected by the router (proven in the 15D closure audit) |

Nothing chose or promoted a model: selection is the owner's configuration.
There was no runtime engine registration for local coding to bind to.

## What was added

`src/lib/ayas/lifecycle/AyasLifecycle.ts` — the contract. Pure: no import, no
clock, no filesystem.

- The eight states and one table of legal moves. Forward is one step at a
  time. A pinned or later entry can be degraded; a degraded one returns only
  through a new qualification; retired is final.
- An identity is a file SHA-256, a served Ollama digest, a Hugging Face
  revision with its file hash, or a digest over named source files. A tag is
  a label. An unpinned entry cannot leave DISCOVERED.
- An entry's state must be backed by what it records: six passed checks from
  QUALIFIED on, every claimed result pointing at a tracked record, a history
  that starts at DISCOVERED and ends at the state, a cause on record for
  DEGRADED.
- Across the registry: unique ids; one promoted ACTIVE entry per kind and
  role; a rollback target that is another pinned, unretired entry of the same
  role, required whenever a last known good exists; regression evidence that
  names that target; a benchmark version (`measuredBy`) that is an evaluator
  entry.
- `evaluateAyasLifecyclePromotion` says whether a move would be allowed and
  changes nothing. `decideAyasLifecycleRegression` drafts a rollback or a
  degrade proposal. Neither is called by any route, daemon or tool: changing
  the registry is a reviewed source change on the owner approval path.
- `ayasLifecycleMayServe`: promoted ACTIVE serves its kind; CANARY serves
  bounded internal tasks only; SHADOW is compared only; an owner-selected
  entry serves the owner's own interactive use and bounded internal tasks,
  never an external write or autonomous coding; a degraded owner-selected
  entry serves interactive use only; everything else serves nothing. This is
  necessary, not sufficient: the action firewall still decides every dispatch.

`AyasLifecycleRegistry.ts` — the registry of record, a deep-frozen constant
with 15 entries. `AyasLifecycleVerifier.ts` — read-only identity checks.
`scripts/ayas-lifecycle-status.ts` — the operator's view (`--live` asks the
loopback Ollama runtime which digest each tag serves; `--deep` hashes large
files).

Runtime binding (`AyasModelRouter`): the health probe reports the digest
served for the configured tag, and the route decision carries the registry
entry, its state and whether the served bytes are the pinned ones. A changed
or unregistered tag is still the owner's choice: used and reported. An entry
the registry withdrew or retired is not used, and that never opens the cloud
path.

## The registry today

| Entry | State | Admission |
| --- | --- | --- |
| qwen2.5:3b, qwen2.5:7b (Ollama digests) | PINNED | owner-selected |
| Qwen2.5-Coder-14B Q4_K_M (local coding) | DEGRADED | none |
| whisper large-v3-turbo, openWakeWord "AYAS", Piper tr_TR-dfki-medium | PINNED | owner-selected |
| hosted narration voice, browser speech synthesis | DISCOVERED (cannot be pinned) | owner-selected |
| FFmpeg 9.0 (this workstation's binary) | PINNED | owner-selected |
| AYAS reasoning prompt | PINNED | owner-selected |
| second-safe-smoke-coverage-v1, exp-memory-render-tool-supersession | PINNED | owner-selected |
| cognitive-quality, research-improvement and retrieval evaluators | PINNED | owner-selected |

Nothing is QUALIFIED or later, and nothing is promoted. That is the honest
state: everything in use was chosen by the owner before a lifecycle existed
and has never been through the six checks. The registry says so in 14 owner
findings instead of calling those entries ACTIVE.

The local coding model is recorded from its real Stage 15A run: capability
FAIL (0 of 1 executed cases passed), held-out and consistency not measured,
sandbox security PASS, CPU-only hardware fit PARTIAL. It may serve nothing
and cannot be promoted without the checks it failed or never ran.

## Evidence

- DETERMINISTIC_TEST: lifecycle 13 scenarios, model router 22 (5 new),
  offline. Regression: model profile 6, chat stream 31, reasoning schema 14,
  agentic routing, cognitive quality 54/55 with held-out 4/5 (unchanged),
  15D closure audit 12, durable recovery 22, foundation acceptance 42, daemon
  authority boundary 23, discovery run firewall 13. TypeScript PASS;
  changed-file lint 0 warnings; diff check PASS.
- Mutation audit in a TEMP overlay: 43/43 caught.
- LIVE_READ_ONLY (this workstation, 2026-10-01): `ayas-lifecycle-status
  --live --deep` reports 13 of 13 pinned identities MATCH, including both
  served Ollama digests, the 1.6 GB speech model, the 9 GB coding model and
  the FFmpeg binary; 0 violations, 0 mismatches.
- No model was loaded or run, nothing was downloaded or installed, and no
  container was started.

## Known limits, carried forward

1. Nothing is qualified. The six checks have never been run for any entry in
   use; the registry records that as findings.
2. No shadow or canary run has ever happened. The states and their serving
   rules exist and are tested; the harness that runs a candidate in shadow or
   canary and records the comparison is built when the first candidate is
   proposed (Continuous Evolution, QUALIFY step).
3. Runtime enforcement covers the local chat model only. For source-defined
   entries (prompt, strategies, evaluators) the control point is the change:
   an edited source no longer matches its digest and the lifecycle suite
   fails until a new entry is recorded.
4. Drift of an owner-selected tag is reported, not blocked.
5. A hosted provider's model has no identity the caller can pin and stays
   DISCOVERED.
6. File and binary identities were read on this workstation. Another machine
   has its own FFmpeg build and must record it (Stage 15S).
7. Only the reasoning prompt is recorded. Prompts built inline inside larger
   modules are not separate entries yet.
8. The phone model pins stay in the browser module and are not mirrored here.
9. Evidence references are checked for existence and tracking, not for what
   they say; one entry's capability FAIL is cross-checked against the Stage
   15A closure file.

## Owner decisions this stage surfaces (none blocks 15F)

- Whether to define frozen benchmarks so the entries in use can be qualified.
- Local coding re-qualification still needs a numeric threshold, a different
  model or engine, or GPU passthrough (unchanged from Stage 15A).
