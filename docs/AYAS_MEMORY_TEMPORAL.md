# AYAS Memory Temporal v2

Memory Temporal v2 makes AYAS memory time-aware. A fact can change ("call me Mehmet from now on"),
belong to the past ("I lived in İzmir in 2024") or be a plan ("next month I'll switch computers").
Normal recall now returns what is true **now**. Historical recall, and recall "as of" a date, are
separate and explicit. Nothing is ever rewritten in place, and no date is ever invented.

Code: `src/lib/ayas/memory/AyasMemoryTemporal.ts` (pure semantics), with integration in
`AyasMemoryStore.ts`, `AyasMemoryRetrieval.ts`, `AyasMemoryRecall.ts`, `AyasMemoryCandidate.ts`,
`src/lib/brain/BrainMemoryModel.ts`, `src/types/brainMemory.ts` and `src/lib/ayas/AyasChatStream.ts`.
Tests: `scripts/smoke-ayas-memory-temporal.ts` (TEMP-only). Ground-truth fixtures:
`scripts/fixtures/ayas-memory-temporal-cases.ts`. Tools: `scripts/bench-ayas-memory-temporal.ts`
(pure benchmark) and `scripts/ayas-memory-temporal-dry-run.ts` (read-only analysis of a store copy).

## Schema — the optional `temporal` block

A record without `temporal` is a v1 (legacy) record and stays valid. The block sits outside
`recordId` and `contentFingerprint`, so a v1 reader recomputes the same identity for a v2 record. Its
own `fingerprint` binds the block to its record. The key set is closed: an unknown key, a wrong
`version`, or a fingerprint that does not match makes the record invalid.

| Field | Meaning |
|---|---|
| `version` | `2` |
| `assertion` | `current` (true when said), `historical` (stated as past), `future` (a plan or intent) |
| `provenance` | `direct-user-statement`, `explicit-correction`, `conversation-derived`, `system-observation`, `imported-history` — a class, never text |
| `recordedAt` | when the durable record was written |
| `effectiveFrom` / `effectiveUntil` | start / (exclusive) end of the fact's interval — only when the statement says so |
| `heldFrom` / `heldUntil` | a period the statement names as one in which the fact held at some point; says nothing about its start or end |
| `effectivePrecision` | `instant` / `day` / `month` / `year`; required whenever any bound is present |
| `factKey` / `factValue` | the exclusive slot the record fills (closed registry) and its normalized value; both or neither |

Validation also rejects incoherent intervals: `effectiveUntil <= effectiveFrom`,
`heldUntil <= heldFrom`, a named period that starts after the statement (`heldFrom > observedAt`),
and a historical start after the statement. A `factValue` that contains a secret is rejected like
any other secret.

## Four different times

| | Question it answers | Example: "Ocak'tan beri X kullanıyorum", said on 23 Sep |
|---|---|---|
| `observedAt` | When did AYAS learn it? | 23 Sep |
| `recordedAt` | When was it written? | 23 Sep |
| `effectiveFrom` | Since when is it true? | 1 Jan, `month` precision |
| `effectiveUntil` | Until when was it true? | unknown (open) |

Unknown stays unknown. For a legacy record, `recordedAt` reads as `observedAt` and the effective time is
unknown. "2024'te İzmir'de yaşıyordum" is stored as `historical` with `heldFrom`/`heldUntil` covering
2024, so it is certain for 2024 and only *possible* for 2023 or 2025.

## Fact slots and supersession

Only three slots are exclusive, meaning at most one value is current:
`user.identity.name`, `user.preference.response-length` and `user.preference.voice-length`. A record
without a slot is an independent fact. It never supersedes anything and is never superseded, so two
free-text decisions ("FFmpeg", then "Remotion") both stay current. Measuring that gap is Retrieval
Evaluation's job, and the fixtures mark it explicitly.

Supersession is **derived at read time, never stored**. There are no `supersedes`/`supersededBy`
pointers on disk. The records of one slot form a version chain ordered by observation. Consecutive
same-value observations merge into one version, and each newer value supersedes the one before it.
One append is therefore the whole transaction. A crash cannot half-apply a version change, and no
reference can dangle, cycle or be forged. The derived view exposes `supersededAt` / `supersededBy`.

Resolution rules, in order:

1. Malformed temporal metadata, a future `observedAt` (beyond 5 min) and instruction-shaped text
   take no part (`invalid` / quarantined).
2. `historical` and `future` records are evaluated on their own intervals and never join a chain.
3. In a slot, the strongest source class wins: `reported` > `observed` > `inferred`. A weaker
   record that disagrees is `conflicting`.
4. Among the strongest, only authoritative records form the chain: a direct user statement or an
   explicit correction with `reported` confidence. For a legacy identity record, this also means the
   extractor's identity title.
5. Equally strong values with no defensible order, for example the same instant, are `disputed`.
   Neither is recalled, and no model is asked to pick one.

States: `current`, `superseded`, `historical`, `future`, `disputed`, `conflicting`, `invalid`. A
current fact whose explicit end has passed becomes `historical`. A plan is never auto-activated when
its date passes.

## Recall modes

`retrieveAyasMemory(records, query, { temporal })` and `recallAyasMemoryWithTrace(…, { temporal })`:

- **current** (default, used for every normal chat turn). Only `current` facts are selectable.
  `superseded`, `historical` and `future` records are quarantined with reasons `superseded-fact`,
  `historical-fact` and `not-yet-effective`. Context lines keep the v1 format.
- **current + `includeHistory`** ("Eskiden adım neydi?"). Older versions become selectable, the
  current version is listed first, and each line gets a content-free annotation.
- **as-of** `{ at, until?, knownAt? }`. Returns what held in the window `[at, until)`, graded
  `certain` or `possible`. A plan is at most `possible`. `knownAt` restricts the query to records
  observed and written by then ("what did AYAS know in January"). A malformed as-of query selects
  **nothing**; the current state is never substituted.

The chat path picks the mode with `detectAyasMemoryTemporalQuery`, which is deliberately
conservative. A turn is as-of only when one clause names a month or a year in a real past tense and
asks something. A turn is history mode when a clause asks what something used to be. A clause with a
present cue ("artık", "şimdi", "hâlâ") is always current. Loanwords such as "kritik" and "otomatik"
are not past tense, since the past suffix takes *-t-* only after a voiceless consonant. Model
numbers ("RTX 2000", "Windows 2019") are not years.

Annotations carry dates and a state label only, for example `[o dönemde geçerli olabilir, kesin
değil · güncel · kayıt 2025-09-02 · geçerlilik ? (en geç 2025-09-02) → sürüyor]`. They are not
counted against the 700-character content budget, and relevance is always judged on content only
(`stripAyasMemoryLineAnnotation`).

## Writing: what a statement says about time

`persistAyasMemoryFromTurn` writes every stored candidate as a v2 record with
`buildAyasMemoryTemporalInput`:

- Time is classified per clause, and a message is historical or future only when every clause is.
  "Adım Ahmet, 2020'de taşındım" keeps the name current. A decision is a present commitment whatever
  its tense. A completed past event ("taşındım") leaves its result current. Only a past *state*
  ("yaşıyordum", "İzmir'deydim") is history.
- **Each slot takes its time from its own segment.** In "Ocak'tan beri kısa cevap tercih ederim,
  adım Ahmet", the January date applies to the preference, never the name. Correction provenance is a
  property of the whole turn.
- **Identity is read conservatively. A wrong name is never stored.** Naming forms, in v1 order:
  "beni X olarak hatırla", "adım X" (only at a segment start, after a greeting, or as "benim adım",
  because "adım" is also "step"), "ben X'im", and "bana X diye hitap et/çağır". A name followed by a
  negation, a past copula, a question particle or a conditional is **withdrawn**. The same applies to
  a name after a history adverb. A withdrawn name is never reaffirmed, and no replacement is guessed:
  "Adım Ali değil, Ahmet" fills no slot. Question words and fillers are never names. Non-Turkish
  accents fold to base letters ("José" → `jose`).
- A length cue that is negated ("uzun değil", "kısa cevap verme") states no length. A length stated
  only as past yields to the present one. An identity statement fills only the identity slot.

## Conflicts and the chat identity guard

The chat guard, which answers "adım ne?" with the recalled name when the model misses it, now
follows the resolver:

- It uses the resolver's structured `identityValue` for a line that reached the prompt, displayed as
  the user wrote it. It never re-parses "adım X" from line text.
- It stands down when the name is uncertain. That is the case when a newer or simultaneous identity
  statement the resolver could not read exists (selected or quarantined), when the newest identity
  turn in this conversation withdrew a name, or when the current turn is itself an identity statement.
- It is off for historical and as-of questions.

## Legacy compatibility — no migration

v1 records are read in place. No live data was rewritten, and none needs to be. Supersession is
derived, so legacy chains resolve at read time (strategy: v2 writes going forward, v1 read
compatibility). Evidence from a read-only TEMP copy of the live store (28 records, all v1): 22
identity records form 17 versions (1 current, 21 superseded, 0 disputed/conflicting). All 22 derive
exactly the value v1 gave them, the resolved current name matches v1's winner, and 28/28 are readable
without migration. `ayas-memory-temporal-dry-run.ts` repeats this analysis and prints counts only.

A v1 build reading a v2 file keeps working, because `recordId` is unchanged. It drops `revision` when
it writes, which v2 reads as 0. A v2 build fails closed, as the whole store (`AYAS_MEMORY_STORE_INVALID`),
on any record it cannot validate, including a future schema. This is deliberate and matches the
store's existing fail-closed rule.

## Concurrency and atomicity

- Every mutation (`append`, `prune`, `remove`) is one locked read-modify-write. The lock is
  `records.json.lock`, taken with O_EXCL, and it is never waited on: a busy lock is an immediate
  `AYAS_MEMORY_STORE_CONFLICT`, and `persistAyasMemoryFromTurn` retries twice with an async back-off.
- `revision` increments on every write. `expectedRevision` gives CAS: a stale writer gets
  `CONFLICT` instead of overwriting newer state or resurrecting a deleted record.
- Before the rename, the writer re-checks that it still owns the lock and that the revision is the
  one it read. The temp file is written in full and fsynced before `rename`, so the store is always
  the old or the new complete file.
- Abandoned locks (dead pid or older than 30 s) are reclaimed without ever deleting a fresh lock. A
  failed lock release never replaces a write's result.
- Retention (500 records) drops the oldest first, but never a pinned record or the newest record
  holding a slot's current value, so trimming never revives a superseded value.

Two real processes racing 25 corrections each produce no lost write, no corruption and one revision
per acknowledged write (smoke scenario 16).

## Privacy and deletion

- `remove(recordId)` deletes that record only, and no copy survives in the file. Removing the current
  version of a slot restores the previous version as a per-record undo, which matches v1. To forget a
  fact entirely, remove every record of its slot. `remove` and `prune` have no production caller;
  they are operator controls.
- Expiry cannot revive a replaced user value. Supersession is derived from live records, and that is
  safe because user-stated identity and preferences never expire: governance scores them `durable`,
  and smoke scenario 44 pins this. If that rule ever changes, expired successors would need tombstones.
- Nothing temporal widens scope. Records are read only from the store root the caller names, and
  memory remains a context source: it imports nothing from approval, execution or publish code
  (scenario 30; Graphify path check).

## Unified Trace integration

The recall span adds `temporalAsOf` and `temporalHistory`, plus `conflictCount`, `currentCount`,
`historicalCount`, `supersededCount` and `uncertainCount` when the store was readable. The persist
span reports `failedCount` and ends `error` with the store's stable code when a write fails. That
closes the trace sprint's known gap. No body, name, fact value, date, query or user text is ever
recorded. Scenario 22+23 asserts that on a real traced turn. Trace ON and OFF give identical answers
and identical stored memory.

## Performance

`bench-ayas-memory-temporal.ts`, 500 records, 25 warmed repetitions, compared with the same bench
against a clean `git archive HEAD` copy:

- The v1 code path took about 11.0–11.4 ms median per retrieval.
- v2 takes about 12.1–13.3 ms in current, as-of and history modes, roughly +1–2 ms.

Resolution is linear per slot plus one sort per slot, with no quadratic grouping. Each stored
candidate costs one locked write with an fsync.

## Retrieval Evaluation (next stage, deferred)

`scripts/fixtures/ayas-memory-temporal-cases.ts` holds 13 synthetic cases with known ground truth
(expected state per record, expected selection, expected certainty). They cover recency change,
correction, historical fact, future intent, contradiction, identity/preference change and project
decision change. The smoke suite only proves that every case holds; scoring is not implemented here.

## Known limitations

- Free-text facts (decisions, environment notes) have no exclusive slot, so contradictory ones both
  stay current.
- Identity reading is pattern-based. Unusual phrasings fill no slot (null), and in that case the chat
  guard stands down instead of guessing. Multi-word names are not slotted, as in v1.
- A bare withdrawal ("adım Ali değil") does not close the old version; it only makes the guard
  stand down. Closing it would need a retraction marker in the schema.
- In the no-model fallback path, an identity *statement* still gets the "Bunu bilmiyorum…" reply
  (pre-existing behavior).
