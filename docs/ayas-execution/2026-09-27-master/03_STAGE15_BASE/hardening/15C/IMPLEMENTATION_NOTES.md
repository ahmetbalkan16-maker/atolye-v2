# Stage 15C — Memory Integrity / Context-Poisoning Firewall

Implemented 2026-10-01. Existing governance, redaction, atomic store, writer
lock, revisions, temporal slots and retrieval remain the primitives. The
incoming uncommitted integrity type draft was preserved and completed.

## Contract and enforcement

- Optional version-1 integrity block, outside the existing content ID. It
  binds the entire record (including temporal metadata) with SHA-256 and binds
  its own canonical metadata separately. Strict closed fields and reason codes.
- Closed producer/source compatibility registry. Source fixes trust in code;
  writers cannot choose their own trust. Chat extraction supplies provenance
  through the existing deterministic temporal builder. Unknown reported legacy
  writers are imported data; recognised legacy statement titles preserve the
  existing compatibility convention. These labels are not authenticated identity.
- Evidence pointers, if supplied, are bounded `turn:`, `source:` or `event:`
  identifiers, never raw evidence text, paths or secrets. Chat has no stable turn
  evidence ID in this interface and does not invent one.
- Screen title, body, tags, links and temporal key/value. Findings cover English
  and Turkish instruction overrides, authority claims, role delimiters and
  hidden control/bidi characters. Recompute at read time, including legacy
  records; persisted clean/admitted labels are not blindly trusted.
- Protected security-policy records and owner constitution, authority, root of
  trust, security, approval, capability, budget and financial key namespaces
  remain quarantine data. No memory value changes those policies.
- External/imported/derived exclusive facts (including identity-tagged records)
  are quarantined. New metadata overrides confidence-only trust ranking.
  Quarantined records cannot supersede reliable current values in the temporal
  resolver or reach recalled prompt lines. Legacy conflict/dispute epistemics
  stay with the existing resolver rather than being erased by a migration.
- Under the existing writer lock, re-screen/reseal new records and evaluate
  rapid change: a fifth different value for one temporal slot within five
  minutes of actual admissions is quarantined. Ordinary correction still works;
  quarantine remains across re-append. No automatic release path.
- Every new store write adds a versioned manifest binding revision, record
  digests and multiplicity. Removing an integrity block/record or editing the
  revision without reconciling the manifest is invalid. Exact legacy duplicates
  remain readable after a manifest-bearing write. Original record validation is
  retained and now also enforced at append (forged base IDs are refused).
- `integritySnapshot()` captures records and a manifest. Operator-only
  `restoreIntegritySnapshot()` requires a separately held expected digest and
  current revision. It validates records, holds the existing writer lock and
  increments revision rather than rewinding it. A corrupted record can be
  repaired if the revision envelope remains readable. No route, daemon, model
  tool or live rollback is bound to this primitive. Snapshots contain private
  memory: callers must keep them in private runtime storage, never source Git.
- Both chat and reasoning prompts frame memory as data, with no approval,
  instruction, budget or execution authority. The dynamic content allowance is
  min(700, remaining space in the existing 8,000-character crowding envelope),
  accounting for request/recent history/state/references/summary/product context.
  Invalid budgets fail closed. This is a memory character budget, not tokenizer
  accuracy or a certification of total model-window fit. Temporal annotations
  retain their existing separate bounded allowance.

## Verification and review

TEMP-only integrity suite: 27 scenarios, including attacks on every text
surface, source spoofing, rehashed policy forgery, protected keys, digest drift,
strict base records, quarantine vs current identity, unknown reported writer,
rapid-change threshold, manifest drift, legacy duplicates, snapshot corruption,
CAS and anchored rollback, crowded context, empty-history chat and a fresh Node
process reading poisoned persisted memory. All model calls mocked; network
guard recorded zero attempts. No real memory contents were read or written.

Regression: memory 30, temporal 52, chat quality 36, context 34, conversation
quality master 37, reasoning 48, Brain Core UI 41, storage hygiene 11 PASS.
Retrieval 74 cases + 4 determinism + 8 error + 8 isolation/privacy + 7 chat
chains PASS, 28 remaining known limitations. Cognitive 54/55, held-out 4/5,
one existing free-text staleness limitation, zero unexpected failures. TypeScript
PASS; full lint zero errors / 13 existing warnings; changed files clean.

Repository-truth finding: the pristine starting HEAD already failed retrieval's
gate because `seed:project-decision-free-text` passed while still listed as a
mandatory failure. Reproduced from a clean HEAD archive in TEMP, with unchanged
metrics. Removed that obsolete limitation entry: it must now pass all layers,
as every ordinary case does. No evaluator threshold or assertion weakened.

Graphify review analysis: 12 changed sources/tests, score 285, 53 impacted files,
10 communities and 8 bridge nodes. The surfaced memory/chat/prompt primitives
were inspected and their focused suites run. Graphify's generic test-gap hints
do not recognise the script smoke convention; the suite mapping above supplies
the actual evidence. No production-pipeline or approval primitive changed.

## Limits carried forward

SHA digests are tamper/drift detection, not signatures. A hostile process with
arbitrary filesystem write can recompute them or strip the entire manifest to
make an envelope look legacy. Root-of-trust/keyed authenticity belongs to 15D/
15N and cannot be claimed here. Producer/source text never proves owner approval.
The screen is defence in depth, not complete semantic injection detection; the
existing runtime authority gates remain the boundary even for undetected text.
Snapshot retention/backup and human custody of expected digests are operator
responsibilities; no automatic live restoration or new durable store was added.
Rollback refuses malformed/unreadable revision envelopes and oversized or
duplicate snapshots. The rapid-change detector covers explicit temporal slots;
arbitrary free text has no invented exclusive key. Stage 15A.3 stays degraded,
Stage 15B closed, observer restart still an owner activation action.

Final security review follow-up: the inherited record validator accepted unknown
top-level properties, which could persist arbitrary unvalidated data outside
redaction/screened fields. Record keys are now closed at append and load; valid
legacy/v2/integrity fields remain accepted. Unknown-field rejection has its own
TEMP append/load regression. This does not alter IDs or valid stored records.

## Post-freeze addendum section 2 — whole-prompt context budget (2026-10-02)

Design authority: `01_CANONICAL_SPECS/AYAS_POST_FREEZE_DESIGN_ADDENDUM_V1.md`
section 2. The stage stays closed; this is the targeted gap repair the addendum's
retroactive audit asks for. The limit recorded above ("a memory character
budget, not ... total model-window fit") is what it closes.

### What was missing

Nothing compared a finished prompt with the model's context window. With
`OLLAMA_NUM_CTX` unset the Ollama server chose the window and cut a prompt that
did not fit, from the front, where the identity and hard-limit text is.

### What exists now

`src/lib/ayas/context/AyasContextBudget.ts` (pure; no I/O):

- The window is the transport's declared one: `OLLAMA_NUM_CTX` for the local
  model, `AYAS_CLOUD_CONTEXT_TOKENS` for the cloud model, 2,048 to 131,072.
  Unset or invalid is an unknown window. It is never guessed.
- The reply reserve is taken out first (420 tokens for a chat reply, 900 for the
  reasoning call).
- Mandatory text is rendered as it was: identity and hard limits, runtime and
  gate state, the conversation-state block, the studio block, the current
  request, and recalled identity lines (the protected part of memory).
- Everything else is a candidate with a class, trust, provenance and estimate.
  Order of admission: the owner's earlier turns (newest first), then ordinary
  recalled memory (retrieval order), then AYAS's own earlier replies (newest
  first). Quarantined entries are never admitted; a low-trust entry cannot be
  protected or mandatory, and being short gains it nothing.
- The exact rendered prompt is checked again. If it does not fit, the lowest
  admitted candidate is shed and the prompt is rendered again. Mandatory text is
  never shed: if it alone does not fit, the result is `CONTEXT_BUDGET_UNSAFE`
  and no call is made.
- Evidence is ids, classes, reasons and numbers. No entry body is in it.

Where it is enforced:

| Point | Behaviour |
|---|---|
| `streamAyasChat`, after routing | A transport with an unknown window is treated like an unavailable model: no prompt is sent, the deterministic identity answers still work, the owner is told the window is not configured. |
| Direct chat prompt (`buildBudgetedAyasChatPrompt`) | Budgeted as above. When nothing is shed the prompt is byte-identical to the one built before this change. |
| Reasoning call (`runAyasReasoning`) | Same budget; earlier turns are passed as turns so they can be shed. |
| `OllamaAyasProvider.stream`, `CloudAyasProvider.stream` | Every prompt of every caller (chat, reasoning, tool grounding, the one correction retry) is checked before the request. Unknown window or no fit: no request. |
| `OllamaAyasProvider.stream`, after the reply | Ollama reports the prompt size it evaluated (`prompt_eval_count`). If that plus the reserve exceeds the window, the reply is discarded and the turn ends `CONTEXT_BUDGET_UNSAFE`. |
| Phone gateway Worker | No cloud call without a declared window (`cloud-context-window-unknown`); a request that does not fit is refused before any call. |

The trace's model span carries the window, the reserve, the estimate, the
measured prompt size when the server reported one, the counts kept and shed and
the protected-retained flag (six numeric keys added to the trace's closed set).

The Stage 15C memory envelope is unchanged and still wired: recalled memory
shrinks as the conversation fills the 8,000-character envelope. A new
regression pins that wiring.

### The estimate

A deterministic count, not a tokenizer: one token for each ASCII digit,
punctuation mark and line break; one token per two UTF-8 bytes for letters,
spaces and non-ASCII characters; 64 for the chat template. Parts never estimate
lower than their concatenation, so selection is never more optimistic than the
final check.

Sizes at this workstation's window (8,192), estimate plus reserve:

| Prompt | Characters | Estimate + reserve |
|---|---|---|
| Chat, no history | 5,186 | 3,495 |
| Chat, 12 short turns | 6,466 | 4,248 |
| Chat, about 6,300 characters of history and 700 of memory (the largest the assembly produces) | 13,206 | 8,130 |
| Reasoning, no context | 6,358 | 4,700 |
| Reasoning, 12 short turns | 7,384 | 5,303 |

All of them fit, so ordinary conversations are sent unchanged.

The estimate has not been compared with the real tokenizer: no model was run for
this packet. The measured check after each local reply is what holds if the
estimate is ever low, and the measured size is in the trace, so the first live
turns show how the two compare.

### Verification

- `scripts/smoke-ayas-context-budget.ts`, 21 scenarios, TEMP memory root, fake
  transports, no model or network.
- `scripts/smoke-ayas-context-budget-mutations.ts`, 19 of 19 negative controls
  caught, in a 219-file TEMP overlay that is also the working directory.
- Six chat-path suites produce byte-identical output at committed HEAD and
  with this change (cognitive quality 54/55, held-out 4/5, chat quality 36,
  conversation quality 37, memory temporal 52, chat stream 31, reasoning 48).
  The retrieval evaluation differs only in its timing line and in one more
  scanned file.
- Full declared baseline, 71 suites: no failure. Result and digests:
  `post-freeze-audit/PF15C_RESULT.json`.

### What changed in the tests and why

A turn now reaches a real transport only when its window is declared, so five
smokes that drive the real local provider through a fake `fetch` declare
`OLLAMA_NUM_CTX=8192` (this workstation's value). Suites that inject a provider
double are untouched.

The retrieval evaluator's library (`scripts/lib/AyasRetrievalEvaluation.ts`) is
one of them. It was an owner-selected pinned evaluator, so under the Stage 15E
rule the change is a new lifecycle entry: `evaluator.retrieval.pf15c-v2`
(admission NONE), with the previous identity kept as its rollback target at
revision `09e1c68`. Cases, graders, assertions and known limitations are
unchanged, and the quality lines of its output are identical before and after.
Accepting the new identity is the owner's decision.

### Limits

- The estimate is unmeasured against the tokenizer (see above). The measured
  check covers the local transport only; the cloud path has the estimate alone.
- A server that reports no prompt size leaves the estimate as the only check.
- The budget's id-level evidence is returned in process and on the refusal
  error. What is recorded is the trace's counts, and the trace store is process
  memory; the durable evidence line carries the outcome and the
  `CONTEXT_BUDGET_UNSAFE` code, not the counts.
- Pipeline stages and the research engine call the pipeline's own Ollama
  provider, not this one. They are not budgeted by this guard.
- The studio block and the conversation summary are mandatory. A request whose
  mandatory part alone exceeds the window is refused, not trimmed.

### Owner actions (none blocks the stage)

- `OLLAMA_NUM_CTX` must be set on every machine that runs AYAS chat. This
  workstation has 8192. A machine without it answers every model turn with the
  "window is not configured" reply.
- Before the phone gateway Worker is deployed again, set
  `AYAS_CLOUD_CONTEXT_TOKENS` in `wrangler.toml` to the configured cloud model's
  window. The deployed Worker is unchanged until then.
- Accept or reject `evaluator.retrieval.pf15c-v2`.
