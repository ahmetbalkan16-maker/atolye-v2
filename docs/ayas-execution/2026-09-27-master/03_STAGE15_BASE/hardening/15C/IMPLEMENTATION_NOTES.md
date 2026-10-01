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

TEMP-only integrity suite: 26 scenarios, including attacks on every text
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
