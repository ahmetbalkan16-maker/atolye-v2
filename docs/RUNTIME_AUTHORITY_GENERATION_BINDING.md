# Runtime Authority-Generation Binding — C.2B.6 / C.2B.6b / C.2B.9 / C.2B.9b

Status: **C.2B.6b + C.2B.9 + C.2B.9b DONE.** The marker is wired into production
startup + recovery bootstrap (C.2B.6b, §5); the versioned authority transition
protocol — quiescence, atomic publish, old-root quarantine, split-brain
prevention, crash recovery — is implemented and enforced (C.2B.9, §6); and the
genesis transition (repo → first external), the operator CLI, byte-exact
materialization enforcement, the split-brain fix, and backup-recovery are done
(C.2B.9b, §7). Master-sprint sessions 2026-09-08. A real project migration is
still gated on a **re-run of the migration readiness audit** + its own approved
sprint; `cutoverAuthorized` stays false.

This is the design + threat model for closing the durable half of the storage
relocation audit's P0 items 2 and 3
(`docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md`):

> 2. no startup-level frozen production runtime authority — recovery and the
>    worker can resolve different roots → split-brain (C.2B.6)
> 3. durable execution adapters (`production-execution/**`) aren't bound to one
>    authority generation — unsafe while a lease/attempt is active (C.2B.6)

---

## 1. What is already closed

### RT1 — one frozen authority at startup

`src/lib/runtime/ProductionRuntimeCompositionRoot.ts` (post C.2B.4):

- resolves **one** `RuntimeStorageContext` at module load
  (`processRuntimeStorageContext = createRuntimeStorageContext()`);
- creates **one** `ProductionRuntimeOperationContext`
  (`processRuntimeOperationContext`) with an explicit
  `authorityGeneration: initialRuntimeAuthorityGeneration`;
- binds that exact context to the singleton `ProductionWorkerLifecycle`
  (`bindRuntimeOperationContext`) **and** passes it to every
  `ProductionExecutionRecoveryBootstrap`;
- `initializeProductionProcessRuntime()` runs the whole initializer inside
  `runWithProductionRuntimeOperationContext(processRuntimeOperationContext, …)`,
  so every `ProjectReader` / storage call underneath resolves against that one
  frozen storage context (`RuntimeOperationScope` binds both).

`runWithProductionRuntimeOperationContext` + `assertProductionRuntimeOperationAuthority`
reject any nested/derived context whose `resolverBindingIdentity` (a digest of
`workspaceRoot | runtimeRoot | projectsRoot | legacyProjectsRoot | authorityRoot`)
differs — a second context resolving a different root throws
`RUNTIME_OPERATION_CONTEXT_MISMATCH`. A request path that establishes no context
throws `RUNTIME_OPERATION_CONTEXT_MISSING` (fail-closed).

**Conclusion:** within a single process, recovery, the worker and request paths
cannot resolve different roots. RT1 is effectively closed; the remaining work is
a regression lock, not a fix.

### D1 — in-flight preparation → execution window

`src/lib/production/ProductionPipelineExecutionFactory.ts` already binds a
durable preparation to its runtime authority **and** to the physical store:

- `prepareProductionPipelineExecution` captures
  `runtime.authority.authorityIdentity`, `runtime.bindingFingerprint`,
  `storeRoot`, a `capturePhysicalStoreAuthority()` digest of the store dir +
  each record file, and a `provenanceFingerprint` into a frozen authority object;
- `readVerifiedCompletedProductionPipelinePreparationFingerprint` re-checks all
  of it before execution: active runtime authority identity + binding equal the
  captured ones, `expectedRoot` recomputed from `storage.projectsRoot` equals
  `completed.storeRoot`, the physical store identity + per-record identities are
  unchanged. Any drift → `WORKER_EXECUTION_COORDINATION_FAILED`.

`authorityIdentity` already encodes `projectsRoot`; `bindingFingerprint` encodes
the full operation context including `authorityGeneration`. So a root or
generation change **between preparation and execution in the same process** is
already rejected.

---

## 2. The residual gap (what is NOT closed)

**Cross-restart durable split-brain.**

1. Process boots under generation *N*, runtime root `R1`. Durable records
   (`attempts/`, `claims/`, `idempotency/`, `reservations/`, leases) are written
   under `R1/projects/<slug>/production-execution/`.
2. An operator changes `ATOLYE_RUNTIME_ROOT` to `R2` (a future relocation) and
   restarts — or copies the tree. The new process resolves generation *N+1*,
   root `R2`.
3. `ProductionExecutionRecoveryBootstrap`, `resolveDurableAttemptOrdinal`,
   `classifyProductionDurableAttemptLineage` and the rest read the on-disk
   records **with no generation check**. They are consumed as if they belong to
   *N+1*. If both roots stay reachable, two processes can hold active
   leases/attempts for the same logical work against two record trees.

The durable records themselves carry no authority-generation stamp, so recovery
cannot tell "this store belongs to a different authority generation — refuse".

This is inherently coupled to **C.2B.9** (the relocation authority + quiescence
protocol): a relocation is only safe offline, with durable state drained and a
*versioned, no-clobber* authority transition. The generation marker is the
fail-closed backstop for the "someone changed the root anyway" case.

---

## 3. Why a durable-record schema field is the wrong fix

Every record kind in `ProductionExecutionPersistence.ts`
(`transaction | journal | idempotency | reservation | claim | attempt`) is
validated with a strict `schemaVersion !== "1"` → `PERSISTENCE_SCHEMA_UNSUPPORTED`
gate and an integrity fingerprint over the whole body.

The repo tracks **~130 `production-execution/**` records** under the milestone
projects (`fatih-…-cfe77fd8/`, etc. — see `docs/PROJECT_STORAGE.md` §5). Adding a
required authority-generation field + bumping the schema would make every one of
those records fail validation → recovery for the milestone projects breaks, and
a large smoke surface turns red. The master sprint forbids touching that data.

So the binding must be **additive and out-of-band**: a single marker file that
sits beside the project directories, never inside a record, never changing a
record schema.

---

## 4. The primitive (built this session)

`src/lib/runtime/security/RuntimeAuthorityGenerationMarker.ts` +
`scripts/smoke-c2b6-authority-generation-marker.ts` (14 scenarios).

- **File:** `<projectsRoot>/.runtime-authority-generation.json` — a sibling of
  the project directories, so `listProjects` (directory-only) ignores it and no
  logical `data/projects/<slug>/…` resolver ever touches it.
- **Contents:** `kind`, `storagePolicyVersion`, `authorityGeneration`,
  `authorityIdentity` (digest of `policyVersion | projectsRoot`),
  `resolverBindingIdentity` (digest of the full resolver binding),
  `logicalProjectsRoot`, `writtenAt`. The identity digests are computed the same
  way as `ProductionRuntimeOperationContext.createAuthorityIdentity`, so the
  wiring in §5 can cross-check the marker against the live operation context.
- **`assertRuntimeAuthorityGenerationMarkerCompatible(context, generation)`** —
  read-only. `absent` (no marker — legacy / not yet stamped, compatible),
  `match`, or throws `RUNTIME_AUTHORITY_GENERATION_MISMATCH` when a marker names
  a different authority / generation / resolver binding / policy. `_UNSAFE` for
  symlink / non-file / oversize; `_INVALID` for corrupt / malformed.
- **`writeRuntimeAuthorityGenerationMarker(...)`** — append-once
  (`flag: "wx"`), read-back verified. Never overwrites in place — a divergent
  marker throws `MISMATCH` (in-place replacement is a C.2B.9 versioned
  transition, not this primitive).

---

## 5. Wiring — DONE (C.2B.6b)

`src/lib/runtime/security/ProductionRuntimeAuthorityGenerationEnforcement.ts` is
the single authoritative validation primitive.
`ProductionRuntimeCompositionRoot.ts` calls it in two places:

1. **Startup** — `enforceProductionRuntimeAuthorityGeneration(processRuntimeStorageContext,
   initialRuntimeAuthorityGeneration)` at the top of
   `initializeProductionProcessRuntime()`, **before**
   `runWithProductionRuntimeOperationContext` (so before any recovery scan,
   worker start or pipeline-execution wiring). Every durable production entry
   point routes through here — `instrumentation.ts`'s `register()`, and every
   `ProductionAcceptanceOrchestrator` path via `evaluateReadiness()`.
   - `NODE_ENV === "production"` + `source === "legacy-default"` (unset
     `ATOLYE_RUNTIME_ROOT`) → `PRODUCTION_RUNTIME_ROOT_REQUIRED`, fail closed.
   - marker `MISMATCH` → propagates, fail closed. The marker is never
     overwritten / repaired, the legacy root is never used as a fallback.
   - marker `absent` on an `explicit-external` root whose `projects/` dir
     already exists → stamped once. `absent` on the legacy default / an
     in-workspace root / a brand-new external root with no `projects/` yet →
     continue unstamped (nothing to protect; legacy default untouched).
2. **Recovery bootstrap** — `assertProductionRuntimeAuthorityGenerationCompatible(...)`
   inside the `createRecoveryBootstrap` factory: the same marker contract,
   **read-only** — it never writes and never repairs a mismatch.

No `production-execution` record schema change; the ~130 tracked milestone
records are untouched. Coverage: `scripts/smoke-c2b6b-authority-generation-enforcement.ts`
(19 scenarios, incl. child-process boots of the real composition root).

---

## 6. Versioned authority transition — DONE (C.2B.9)

The controlled way to move the runtime authority from one root to another. It is
**not** the migration — no `data/projects` is copied by this machinery — it is
the state machine + control plane that makes a copy-then-cutover *safe*.

### Control plane

Machine-local, out of band, under
`<authorityRoot>/authority-transition-v1/` (a sibling of the per-project
`.lock` / `.claim.json` files):

| File | Meaning |
|---|---|
| `active-authority.json` | the single active production authority — `{ transitionSequence, transitionId, authorityGeneration, authorityIdentity, resolverBindingIdentity, activatedAt }`. **Absent until the first transition.** CAS-guarded, monotonic sequence. |
| `transitions/<transitionId>.json` | one per transition; the state record + history. Atomic `temp → fsync → rename`. |
| `quarantine/<resolverBindingIdentity>.json` | append-once read-only mark for a retired root. |

### State machine (`RuntimeAuthorityTransition.ts`)

```
quiesce-requested → quiesced → prepared → target-validated → published → old-root-quarantined
        └──────────────┴──────────┴───────────────┘→ failed   (terminal, pre-publish only)
```

Strictly forward. `published` is the point of no return — no silent rollback,
the source is never made writable again.

### Coordinator (`RuntimeAuthorityTransitionCoordinator.ts`)

| Step | From → To | Guards |
|---|---|---|
| `beginTransition` | (active) → `quiesce-requested` | source marker must `match`; source not quarantined; source is the current active authority (or none yet); source ≠ target; idempotent on `transitionId` |
| `confirmQuiescence` | `quiesce-requested` → `quiesced` | `workerLifecycleState ∈ {created, stopped}` **and** aggregate durable-recovery `"clean"` |
| `prepareTransition` | `quiesced` → `prepared` | freezes the source `projectsRoot` inventory + digest |
| `validateTarget` | `prepared` → `target-validated` | target endpoint matches; target marker `absent`/`match` (a `MISMATCH` already threw); **target inventory must equal the frozen source inventory** — a marker-less / partial copy fails closed |
| `publishTransition` | `target-validated` → `published` | 1) stamp target marker (idempotent) 2) CAS `active-authority.json` (first: must be absent; later: exact previous binding + `sequence+1`) 3) commit state |
| `quarantineSource` | `published` → `old-root-quarantined` | append-once `quarantine/<sourceBinding>.json` |
| `failTransition` | `<pre-publish>` → `failed` | rejected from `published`+ |

Every step is idempotent on `transitionId` and rejects an out-of-order call
(`TRANSITION_ILLEGAL_STATE`). Each writes atomically and re-reads state from
disk, so a crash between any two steps is resumed by re-running the step.

### Enforcement integration

`enforceProductionRuntimeAuthorityGeneration` (startup) and
`assertProductionRuntimeAuthorityGenerationCompatible` (recovery) now read the
control plane after the production-root check and before the marker check:

- this root is **quarantined** → `RUNTIME_AUTHORITY_ROOT_QUARANTINED`
- a **transition is in progress** with this root as source →
  `RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS`
- an **active authority** is published and this is a different marked root →
  `RUNTIME_AUTHORITY_NOT_ACTIVE` (the legacy in-repo default never participates)
- `absent` marker + populated `projects/` + no `active-authority.json` and no
  transition target record → `RUNTIME_AUTHORITY_UNBOUND_STATE` (marker-less copy)

**When no transition has ever happened the entire control plane is absent and
every one of these checks is a no-op** — dev, the legacy default, and a first
external deployment are completely unchanged. First boot of an explicit-external
root now creates an empty `projects/` and stamps, so "absent marker + data" can
only be an out-of-band copy.

`AUTHORITY ACTIVE ≠ EXECUTION ENABLED` — a published transition does not open the
Execution Gate.

Coverage: `scripts/smoke-c2b9-authority-transition.ts` (21 scenarios — state
machine, idempotency, ordering, quiescence guards, inventory mismatch, CAS
conflict, enforcement integration, child-process crash-and-resume across every
step, real composition-root boots denied on the quarantined source + mid-flight
and allowed on the target).

### Enforcement integration — F11 update (C.2B.9b)

The `RUNTIME_AUTHORITY_NOT_ACTIVE` check now applies to **every** classification,
including the legacy in-repo default: once `active-authority.json` exists, a
still-present repo `data/projects` booted with `ATOLYE_RUNTIME_ROOT` unset in
`NODE_ENV=development` fails closed instead of running as a second authority.
(Before any transition `active-authority.json` is absent and the check is still
a no-op — dev is unaffected.)

---

## 7. Genesis + operator layer — DONE (C.2B.9b)

Closes the six P1 blockers the migration readiness audit raised.

| # | Blocker | Fix |
|---|---|---|
| F10 | The genesis repo → first-external transition was not implementable — `beginTransition` rejected the unmarked legacy source. | `beginGenesisTransition(legacySourceContext, targetContext)` — `kind: "genesis"`. Preconditions: source `source === "legacy-default"` **and** no marker, no `active-authority.json`, target `explicit-external` + not quarantined. `quarantineSource` for a genesis writes **no** `quarantine/<binding>.json` (so a backup can still be restored to the repo path); the legacy source is retired by the `active-authority.json` pointer + F11. |
| F11 | The `legacy-repository` carve-out let a still-present repo tree boot as a second authority post-genesis. | carve-out removed (see §6 F11 update). |
| F4 | No post-publish rollback / backup-restore authority recovery. | `beginRecoveryTransition(targetContext, reason)` — `kind: "recovery"`. Source is read from `active-authority.json` (no live source needed). `confirmQuiescence` for a recovery records but does **not** gate on the abandoned source's durable scan; still requires the worker down. `quarantineSource` **does** quarantine the abandoned root. A recovery target cannot be a quarantined root, and a stale / foreign marker on it fails closed. |
| F3 | Byte-exact copy was not enforced — only the slug list was checked. | `prepareTransition({ sourceProjectsRoot })` freezes a per-file SHA-256 digest of the whole tree (the `.runtime-authority-generation.json` marker is excluded — it is re-stamped at publish; symlinks / non-regular files → `TRANSITION_CONTENT_UNSAFE`). `validateTarget({ targetProjectsRoot })` requires an exact match (`TRANSITION_TARGET_CONTENT_MISMATCH` on any mutated / missing / extra byte). The operator CLI always passes both roots. |
| F2 | No operator entrypoint. | `scripts/run-authority-transition.ts` + `npm run authority:{status,begin-genesis,begin-relocation,begin-recovery,quiesce,prepare,validate,publish,quarantine,fail}`. Logic in `RuntimeAuthorityTransitionCommand.ts` — strict argument validation (absolute paths, no `..`, symlink-in-chain rejection, transition-id / generation patterns). `quiesce` auto-derives the durable-recovery decision from `ProductionExecutionDurableRecoveryService.scan()` per source project and requires `--assert-worker-stopped`. The CLI **never copies project data** — byte-exact materialization stays a `runtime:backup` + verified-candidate step. |
| F1 | The runbook predated C.2B.9. | Rewritten — `docs/PROJECT_STORAGE.md` §6, 11 steps around the CLI + the verified candidate. |
| F5 | 27 `.partial` files unclassified. | All EXCLUDE-SAFE — `AudioCompensationStore` journal-staging orphans under one gitignored project; `RuntimeBackupInventory` excludes them. **Corrected in F12** — see below. |
| F12 | The F5 "already excluded" conclusion was code-read, not executed. `isAudioCompensationJournalStagingPartialAtProjectPath` only matched the legacy `cleanup/<ref>/.audio-journal-staging/` layout (assumed a `<ref>` dir the real tree lacks; never checked `audio-compensation-recovery`), so `collectRuntimeBackupInventory` actually threw `RuntimeMutationError` on the real tree (97–108-char `.partial` names > 96-char portable ceiling). Found by Sprint 194 C.2B.10 Phase 0. | Classifier now anchors on `production-execution/{audio-compensation-cleanup\|audio-compensation-recovery}` with an **optional** `<ref>` segment, still requiring the exact `.audio-journal-staging/<name>.partial` (or `record/` sub-variant) shape. Both live callers (`RuntimeBackupInventory`, `ProductionCompletedStageRegenerationPlanner`) get the fix. `scripts/smoke-f12-audio-journal-partial-classification.ts` **executes** `collectRuntimeBackupInventory` against the real layout. Real read-only `npm run runtime:backup:inventory` now completes: 2360 inventoried, 28 excluded, 0 remaining path-policy failures. |

Coverage: `scripts/smoke-c2b9b-genesis-transition.ts` (16 scenarios — genesis
happy path / guards / crash-and-resume; F11 legacy repo boots before + refuses
after genesis (real child boots) + foreign copy; F4 restore does not
auto-activate + recovery transition + recovery guards; F3 byte-exact
mutated/missing/extra + symlink; CLI strict-arg validation + a full genesis run;
existing C.2B.9 regression; static no-execution).

## 8. Old-root read-only quarantine + rollback token — DONE (C.2B.11)

`src/lib/runtime/security/RuntimeAuthorityOldRootQuarantine.ts` +
`RuntimeAuthorityRollback.ts`, driven from the same
`RuntimeAuthorityTransitionStore` (no parallel control plane).

| Contract | How |
|---|---|
| **Old-root read-only** | `finalizeOldRootQuarantine` sets `FILE_ATTRIBUTE_READONLY` (`chmod 0o444`) on every regular file under the retired `<old>/projects`, then **verifies** every file is non-writable. It cannot be applied+verified → `QUARANTINE_NOT_ENFORCED`, hard stop, **no silent fallback**. Advisory (a process can clear the bit — same threat-model boundary as the raw-`fs.write` note below), enough to keep the retired tree out of accidental serving/mutation and to anchor the audit + token. Append-once `quarantine-enforcement/<binding>.json` records the mode, file count and (unchanged) content digest. |
| **Single-authority invariant** | The rollback runs as its own record (`kind: "rollback"`, states `rollback-requested → rollback-validated → rollback-published → former-target-quarantined`) but shares the one `active-authority.json` CAS — it never forks the pointer. `publishRollback` CAS: expected previous = the new-root binding at sequence *N*, next = the old-root binding at *N+1*. |
| **Rollback token** | `RuntimeAuthorityRollbackToken` — `rbt-` + 48 hex crypto-random, durable, append-once, issued once per forward transition. Bound to EXACTLY one `authorityGeneration`, `transitionId`, source (old) binding, target (new) binding, `transitionSequence`, and `sourceContentDigest`. `beginTokenAuthorizedRollback` rejects every mismatch (`ROLLBACK_{GENERATION,SEQUENCE,SOURCE_ROOT,TARGET_ROOT}_MISMATCH`, `ROLLBACK_TOKEN_{NOT_FOUND,MISMATCH,CONSUMED}`). A `rollback-tokens/<id>.consumed.json` marker is written append-once at `publishRollback` → replay → `ROLLBACK_TOKEN_CONSUMED`. |
| **"nothing moved since cutover"** | `validateRollback` requires both `<old>/projects` and `<new>/projects` to be byte-identical to the frozen `sourceContentDigest` — `ROLLBACK_OLD_ROOT_CONTENT_DRIFT` / `ROLLBACK_TARGET_DIRTY` otherwise (roadmap: rollback only if the new root is untouched). |
| **Re-activation** | Enforcement lets a quarantined old root boot **only** when it has a `quarantine-lift/<binding>.json` record (written at `publishRollback`) AND is the current `active-authority.json` binding. Every other quarantined root still `RUNTIME_AUTHORITY_ROOT_QUARANTINED`. |
| **Former target** | `quarantineFormerTarget` applies the read-only barrier to `<new>/projects` and writes its `quarantine/<binding>.json` + enforcement record. |
| **Forward-recovery separation** | `beginRecoveryTransition` (C.2B.9b) is untouched; a rollback token never satisfies a recovery and a recovery never consumes a token. |
| **CLI** | `authority:{finalize-quarantine, rollback-status, begin-rollback, validate-rollback, publish-rollback, quarantine-former-target}` — strict arg validation, explicit token id / generation / roots, no implicit discovery. |
| **Crash safety** | Every step is idempotent on the rollback transitionId and rejects out-of-order (`ROLLBACK_ILLEGAL_STATE`); a crash between `validate` and `publish` leaves the active pointer on the new root and the token unconsumed — restart resumes, never a second authority. |

Coverage: `scripts/smoke-c2b11-old-root-quarantine.ts` (15 scenarios).

### Known limitations

- A raw `fs.write` to the old root's tree, bypassing the runtime entirely, is
  not fully prevented — C.2B.11's read-only barrier is advisory (a process can
  clear the attribute first). The threat model is a second *runtime authority*
  activating, not filesystem ACLs; the runbook also renames the old tree.
- Genesis has no quarantined external old root, so there is no rollback token for
  a genesis — its rollback is a manual backup restore to the repo path.
- C.2B.11's rollback requires the new root to be **byte-identical** to the frozen
  source. An "explicit reverse migration" path (roadmap condition b — roll back
  after real work happened on the new root) is deliberately NOT implemented.
- `confirmQuiescence` refuses while the worker reports active; it does not
  *force-stop* a running runtime. The operator stops the runtime; the
  coordinator then confirms against the durable-recovery scan. The CLI's own
  `getProductionRuntimeStatus()` reflects the CLI process (always down), so the
  `--assert-worker-stopped` flag carries the operator's assertion and the
  durable scan is the substantive gate.
- The transition requires the **same** `ATOLYE_RUNTIME_AUTHORITY_ROOT` for source
  and target (the shared coordination plane).
- After a genesis publish, the target will not boot while `<repo>/data/projects`
  still holds the same slugs (`RUNTIME_STORAGE_DUAL_ROOT_DIVERGENCE`) — a
  deliberate fail-closed; the operator renames the old tree first (runbook step 8).
- A recovery transition to a previously-quarantined root is impossible (the
  quarantine mark is append-once, no un-quarantine) — recovery always goes to a
  fresh root.

## 9. F13 — candidate materialized-path budget — CLOSED (Sprint 202)

Sprint 201's real execution run got a verified 611 MB backup
(`D:\AtolyeBackup\backups\b-fee58282da89`, aggregate `361b47af…`), then
`runtime:migration:candidate:create` failed with `PATH_POLICY_VIOLATION`:
`assertRuntimeBackupMaterializedPath` (limit `materializedPathUtf16 = 259`)
rejected **329 of the 2360 files** (321 `durable-execution` + 8 `other-runtime`)
under `<candidateRoot>\candidates\candidate-<64hex>\payload\projects\<projectId>\…`
(worst 290). The blocker was the **74-char `candidate-<64hex>` directory** + the
`payload/projects/` nesting on top of the 64-hex-hashed durable-record filenames.
The final runtime target (`D:\AtolyeRuntime\projects\<projectId>\…`) was only 194
— always fine; only the intermediate immutable candidate artifact overflowed.

### Fix — shortened, authority-free candidate layout

| Before (Sprint 201) | After (Sprint 202) |
|---|---|
| `<root>/candidates/candidate-<64hex>/payload/projects/<rel>` | `<root>/candidates/c-<24hex>/projects/<rel>` |
| worst 290 (**329 over 259**) | worst **234 (0 over 259)** |

- **Full cryptographic identity is unchanged.** `candidateId` is still
  `candidate-<64hex>` — a content-address of `sourceBackup.manifestSha256` +
  `aggregateFingerprint` + policy versions — recorded verbatim in `candidate.json`
  and re-verified in full by `verifyMigrationCandidate` / `validateManifest` /
  the `reuseExistingCandidate` identity + policy SHA checks. `candidate.sha256`,
  `runtimeMigrationCandidateIdentitySha256`, and every binding are byte-identical.
- The **on-disk directory** is `runtimeMigrationCandidateDirName(candidateId)` =
  `c-` + the first 24 hex (96 bits) of the same digest — a filesystem handle, not
  an identity. A `c-<24hex>` prefix collision (2⁻⁹⁶ per distinct-backup pair) is
  still caught fail-closed: `verifyMigrationCandidate` recomputes the full
  `candidateId` from the manifest, and `createOwnedDirectory` is exclusive.
- The **`payload/` nesting level is removed** — the candidate directory holds
  `candidate.json`, `candidate.sha256`, `projects/` directly. Backups keep
  `payload/projects/` (unchanged). `verifyMigrationCandidate` rejects a stray
  legacy `payload/` entry.
- The 259 budget stays enforced unconditionally (portable-candidate guarantee);
  `LongPathsEnabled` is never consulted. Threaded through service / verifier /
  consumer / create-command / `candidates/.<id>.publish.lock` / conflict scan.
- Coverage: `scripts/smoke-f13-candidate-path-budget.ts` (15 scenarios: F13-A
  the 329 real paths now fit, F13-B all 2360 ≤ 259 / max 234, F13-C target
  0 violations, F13-D 258/259/260 boundary, F13-E UTF-16 Unicode count, F13-F/G
  short-dir ↔ full-identity binding, F13-H/H2 crash-recovery, F13-I idempotent
  reuse, F13-J traversal/symlink reject, F13-K reuse across HEAD commits, F14
  a real v4 backup) + the 3 updated `129-25c-2b-*` / `c2b10a` suites.

### F14 — a `runtime-backup-v4` (authority-bound) backup could not become a candidate

Surfaced only once F13 let the real run reach `buildRuntimeMigrationCandidateManifest`.
`validateManifest` / `asBackupManifest` re-materialised a v4 source's backup shape
with v4 versions, so `validateRuntimeBackupManifest` demanded a
`sourceRuntimeAuthority` stanza — which the candidate, being the **portable
authority-free projection** of the backup, deliberately never carries
(`CANDIDATE_INVALID`). Fix: a v4 source is re-validated against its
`runtime-backup-v3` (path-policy-v3) equivalent — identical files / aggregate /
project identities, minus the source host's authority id. The candidate manifest
still records the true `sourceBackup.formatVersion: "runtime-backup-v4"`; only the
internal file-integrity re-check uses the portable shape.

### Also — a C.2B.12 backup was staled by an unrelated HEAD commit

`preflightRuntimeMigrationCandidate` hard-gated `SOURCE_STALE` on
`backup.sourceHeadCommit !== live.sourceHeadCommit`. After C.2B.12 `data/projects`
is fully git-untracked, so an unrelated commit (e.g. Sprint 201's own checkpoint)
staled a byte-identical source and made `b-fee58282da89` unreusable. Fixed: the
`sourceHeadCommit` equality is enforced only while the backup actually captured
tracked `data/projects` files; otherwise the per-file identity + aggregate
comparison is the sole freshness gate (as the existing code comment already
declared). `scripts/smoke-f13-candidate-path-budget.ts` F13-K.

### Real Sprint 202 result

`npm run runtime:migration:candidate:create` against the preserved
`b-fee58282da89` → **verified candidate**
`candidate-817cdcd9df908176a5559e955a310f9a1f3f416907e6c94b2dc536aa0ae23863`
at `D:\AtolyeCandidate\candidates\c-817cdcd9df908176a5559e95`: 2360 files /
610943674 bytes, aggregate `361b47af…`, manifestSha256 `41c9a5e6…`, max
materialized path **234 / 0 violations**, byte-identical to the backup payload,
`cutoverAuthorized = false`. **No consume, no genesis, no publish.**

## 10. F15 — production-execution derived index missing — CLOSED via F15-A (Sprint 204)

Sprint 203's real migration retry passed INSPECT + candidate re-verification, then
**`runtime:migration:candidate:consume` failed with `DURABLE_RECOVERY_REQUIRED`**
in the consume service's post-copy step (d): `scanDurableRecovery` →
`ProductionExecutionDurableRecoveryService.scan()` per project.

Read-only characterization of the live `data/projects`:

- **11 of 17 projects** (every one with a `production-execution/` store) scan
  `recovery-required`. **`clean` = 0. `indeterminate` = 0.**
- In each, the **only** `recoveryRequired` finding is
  `derived-index / class=missing / RECOVERY_INDEX_MISSING` — the `indexes/`
  directory does not exist. **Every canonical durable record**
  (`attempts` / `claims` / `idempotency` / `reservations` / …) **is `valid`.**
- The derived lookup index is, by this codebase's own contract, a
  *content-addressed, immutable, **rebuildable** derived artifact* built
  deterministically from the canonical records — not an authorization,
  execution, or business-decision source. `ProductionExecutionDurableRecoveryService.rebuildIndex()`
  regenerates it. **No canonical data loss or corruption.**

The migration's byte-integrity is perfect — the candidate is byte-identical to
the backup, and both share the same benign index-missing state — but:

1. `RuntimeMigrationCandidateConsumeService` step (d) treats
   `decision === "recovery-required"` as a hard `DURABLE_RECOVERY_REQUIRED`
   (no bypass flag).
2. The C.2B.9 `authority:quiesce` gate also requires durable-recovery `clean`.
3. The Sprint 202 candidate (immutable, byte-bound) carries no index either, so
   it cannot be consumed without regenerating source + backup + candidate, or
   refining the gate.

Sprint 197's `c2b10a` fixtures never hit this: their projects have a single
`production-execution/a.json` and no `idempotency/`/`reservations/` directory, so
`collectCanonicalRecords` is empty and `inspectIndex` is never called. F15 is the
**third blocker only a real migration reveals** (F13 path budget, F14 v4
authority, F15 missing derived index).

**Resolution needs its own decision** (each beyond Sprint 203's "use existing
infra / invent nothing / stop on uncertainty / do not mutate `data/projects`"
mandate):

- **F15-A** — rebuild the 11 source derived indexes via `rebuildIndex()` (writes
  `data/projects/<slug>/production-execution/indexes/<fingerprint>.json` — a
  rebuildable derived artifact), regenerate the backup + candidate, re-run
  Sprint 203. Makes the durable state genuinely `clean` for the migration *and*
  for the eventual production runtime.
- **F15-B** — refine the durable-recovery gate (consume step d + quiesce) so
  "only a rebuildable derived-index missing, all canonical records valid" is not
  a hard block; the index is rebuilt on the target post-consume or by the
  runtime on first boot.
- **F15-C** — a post-consume index-rebuild step on the target, without changing
  consume's byte-exact materialization contract.

### Sprint 204 — F15 closed via F15-A

`ProductionExecutionDurableRecoveryService.rebuildIndex()` on each of the 11
dynamically-discovered projects (canonical records read → deterministic index →
exclusive no-clobber write of `production-execution/indexes/lookup-<64hex>.json`).
**11/11 → `RECOVERY_RECORD_VALID` / `created=true`; re-scan 11/11 `clean`,
`recovery-required = 0`.** Source delta: **+11 files, all `…/indexes/lookup-*.json`;
`modified: []`, `removed: []`** — zero canonical records touched. New source:
2399 files fs / inventory 2371 / aggregate
`8701419987c94ecd8163fb6e0682d1f668d320566cb2bbccb74e3f76bd763ef4` /
`runtimeAuthorityProjectsContentDigest` `2ec5b9c0…`. New backup
`b-0d971133190c` + new candidate `c-d3743b64c5830509cc380b58` (F13 layout, max
path 234 / 0 violations) both verified. **`runtime:migration:candidate:consume`
→ `D:\AtolyeRuntime` = SUCCESS, `durableRecoveryDecision: "clean"`**, target
byte-exact to candidate/backup, target per-project durable scan 11/11 clean. F15
resolved end to end. Old `b-fee58282da89` / `c-817cdcd9df908176a5559e95` preserved.

## 11. F16 — authority-transition F3 gate is not `.partial`/`.lock` EXCLUDE-SAFE — F16-A done (Sprint 205); genesis still blocked by F17

Sprint 204's real migration reached the genesis authority transition and stopped
at **PHASE 11 (`authority:validate`)** — which would fail deterministically:

- `authority:prepare` freezes `sourceFreeze.contentDigest =
  runtimeAuthorityProjectsContentDigest(sourceProjectsRoot)` and the runbook
  (`docs/PROJECT_STORAGE.md` §6 step 5) passes `--source-projects <repo>/data/projects`.
- **`runtimeAuthorityProjectsContentDigest` skips only the authority-generation
  marker — it does NOT apply the F12/F5 `.partial` + `.pipeline-jobs.lock/**`
  exclusions** that `collectRuntimeBackupInventory` (and therefore the whole
  backup → candidate → consume chain) applies. So it freezes a digest over
  **2399** files (`2ec5b9c0…`).
- `authority:validate` then computes `runtimeAuthorityProjectsContentDigest(<T>/projects)`
  over the correctly-migrated target — **2371** files (`0e46cf6c…`) — and throws
  **`TRANSITION_TARGET_CONTENT_MISMATCH`**.

The 28-file difference is exactly the F12/F5 EXCLUDE-SAFE set: 27
`i-stanbul-un-fethi-1453/production-execution/audio-compensation-{cleanup,recovery}/
.audio-journal-staging/*.json.<uuid>.partial` (abandoned atomic-write staging)
+ 1 `suleymaniye-camii-…/.pipeline-jobs.lock/owner.json` (a stale process-local
mutex; 0 node processes). The migration chain correctly excludes them; the
authority-transition F3 primitive does not, so it rejects the correct target.
`docs/PROJECT_STORAGE.md:193` already flags "the runbook below is not yet executable".

`smoke-c2b9` / `c2b9b` never caught this — their fixtures have source == target
byte-for-byte (no `.partial`/`.lock`), and consume's own post-copy
`runtimeAuthorityProjectsContentDigest` check compares candidate-vs-target
(2371 vs 2371), never source-vs-target. F16 is the **fourth blocker only a real
migration reveals** (F13 path budget, F14 v4 authority, F15 missing index,
F16 F3 not EXCLUDE-SAFE).

**Resolution options (each its own decision):**

- **F16-A** — make `runtimeAuthorityProjectsContentDigest` F12/F5 EXCLUDE-SAFE
  (skip `.partial` staging + `.pipeline-jobs.lock/**`), consistently for
  `prepare`, `validate`, and consume's post-copy check. Moves the filter that
  already exists on the backup side into the F3 primitive.
- **F16-B** — point `authority:prepare --source-projects` at the verified
  candidate's `projects/` (the frozen, verified, byte-exact 2371-file projection
  of the source, already cryptographically bound to it). Diverges from the
  runbook's literal `<repo>/data/projects` and the "source froze it" audit trail.
- **F16-C** — quarantine the 28 transient files (`.partial` staging + the stale
  `.pipeline-jobs.lock`) before genesis so source == target == 2371. Contradicts
  "no `data/projects` rename/move/delete".

### Sprint 205 — F16-A done

`src/lib/runtime/RuntimeTransientArtifactPolicy.ts` — one shared predicate
`isRuntimeTransientExcludedRelativePath` (reuses `isAudioCompensationJournalStagingPartialAtProjectPath`
+ the existing `"/.pipeline-jobs."` rule, no second filter). Called from **both**
`collectRuntimeBackupInventory` (behaviour-preserving refactor of its inline
check) and `runtimeAuthorityProjectsContentDigest`'s `walkContent` (applied
**after** the symlink / non-regular-file rejection, so `TRANSITION_CONTENT_UNSAFE`
still fires for a symlink whose name matches an excluded pattern; deterministic
ordering / serialization / marker-skip unchanged). All 5 callers of the F3
primitive — `authority:prepare`, `authority:validate`, `RuntimeAuthorityRollback`,
`RuntimeAuthorityOldRootQuarantine`, and consume's post-copy check — now agree on
the transient set. Backup / candidate identity + aggregate unchanged
(`b-0d971133190c` re-verifies with the same `8701419987…` / `a5654b62…`). Real
source digest `fileCount` dropped 2399 → **2371**, matching the target count.
Coverage: `scripts/smoke-f16-authority-digest-exclude-safe.ts` (7 scenarios).
Regression c2b5/6/6b/8/9/9b/10a/11/12 + f12/f13/f16 + runtime-backup +
migration-candidate + durable-recovery + storage-hygiene + external-runtime-root
all PASS; tsc / eslint (0 err / 22 warn) / next build clean.

## 12. F17 — genesis `validateTarget` compares slug-layout source vs projectId-layout v3 target — CLOSED via F17-B (Sprint 206)

F16-A fixed the **file-count** half of Sprint 204's mismatch, but the real
migration target still does not pass `authority:validate` — for a structural
reason F16-A does not touch:

- The **v3 backup path policy** (`runtime-backup-relative-path-v3`, the current
  default, C.2B.8 PR2 "portable by construction") **remaps `<slug>/…` →
  `<projectId>/…`**. So `<repo>/data/projects` has 17 **slug** folders
  (`i-stanbul-un-fethi-1453`, `atilla-nin-y-kselisi`, …) while the backup →
  candidate → consumed `D:\AtolyeRuntime\projects` has 17 **projectId** folders
  (`1ba3bebf-…`, `0453f0b4-…`, …).
- `validateTarget` (Coordinator) does
  `sameStringSet(normalizeSlugs(targetProjectSlugs), record.sourceFreeze.projectSlugs)`
  — the target's projectId folder names vs the source's slug folder names →
  **`TRANSITION_TARGET_INVENTORY_MISMATCH`** (fires before the content check).
- Even past that, `runtimeAuthorityProjectsContentDigest` hashes
  `<relativePath>\0<sha>\0<size>` lines — the `<slug>/…` prefixes vs the
  `<projectId>/…` prefixes differ, so the source freeze (`090b3455…`, 2371) ≠
  the target digest (`0e46cf6c…`, 2371) → **`TRANSITION_TARGET_CONTENT_MISMATCH`**.
- **`runtimeAuthorityProjectsContentDigest(candidate/projects) ==
  runtimeAuthorityProjectsContentDigest(target/projects)` is TRUE** (`0e46cf6c…`,
  both projectId, both transient-free) — the consume post-copy contract holds.
  The gap is only between the **slug-layout source** and the **projectId-layout
  materialized world**.

`smoke-c2b9b` never caught this — its fixtures `fs.cpSync` the whole `data/projects`
tree verbatim (slug folders on both sides, no v3 remap). C.2B.9b genesis
`validateTarget` was written for a **structurally identical** target; the C.2B.10a
v3 migration candidate is a **portable projectId-remapped** one. F17 is the
**fifth blocker only a real migration reveals** (F13, F14, F15, F16, F17).

**Resolution options (each its own decision):**

- **F17-A** — `authority:prepare` / `validate` operate on the **verified
  candidate** as the frozen source (its `projects/` is the projectId-layout,
  transient-free, cryptographically-bound projection). `prepare` freezes
  `candidate/projects`, `validate` checks `target/projects` — both projectId →
  match. (This is F16-B under a new name; it needs the runbook + audit-trail
  question answered.)
- **F17-B** — teach `validateTarget` the slug↔projectId identity map (the
  candidate manifest already carries `sourceProjectIdentities`): compare the
  target's projectId set against the source slugs *through* that map, and compare
  content digests over a **logical** (identity-normalized) path rather than the
  raw folder name.
- **F17-C** — a genesis mode that treats the verified candidate + consumed target
  as the authoritative pair and only re-checks `target == candidate` byte-exact
  (which consume already proved) plus quiescence + marker absence, without
  re-deriving from `<repo>/data/projects`.

### Sprint 206 — F17 closed via F17-B

`runtimeAuthorityProjectsContentDigest(root, { remapProjectFolder })` canonicalises
the first path segment (the project folder name) of every non-top-level file to
its logical identity — applied AFTER the symlink / non-regular-file rejection and
the F16-A transient exclusion (both on the physical path), so it is never a
security or exclusion bypass; top-level files are hashed verbatim.

`prepareTransition` gains an optional `projectIdentities` (the CLI reads the
migration candidate manifest's already-verified `sourceProjectIdentities` from
`--candidate-directory`): it validates the map (well-formed uuid / slug, no
duplicate id or slug — `TRANSITION_INPUT_INVALID`), asserts every source project
folder has an entry (`TRANSITION_SOURCE_IDENTITY_MISSING`), and freezes
`projectIdentities` + a `logicalContentDigest` / `logicalFileCount` over
`slug→projectId`-remapped paths, alongside the existing raw `projectSlugs` /
`contentDigest`.

`validateTarget`, when a `projectIdentities` freeze exists: an operator-supplied
map must byte-equal the frozen one (`TRANSITION_IDENTITY_BINDING_MISMATCH`); every
target folder must be a known projectId (`TRANSITION_TARGET_IDENTITY_UNKNOWN`);
`sameStringSet(targetProjectIds, frozenProjectIds)`
(`TRANSITION_TARGET_INVENTORY_MISMATCH`); the target's raw digest must equal the
frozen `logicalContentDigest` (`TRANSITION_TARGET_CONTENT_MISMATCH`). With no
freeze, the pre-F17-B structural (folder-name) path is unchanged — `smoke-c2b9` /
`c2b9b` keep passing.

Untouched: candidate / backup identity + aggregate fingerprint, the manifest
format, authority generation binding, protected-root separation, monotonic
transition sequence, CAS `active-authority`, rollback token binding, quarantine
contract. Coverage: `scripts/smoke-f17-authority-identity-mapped-validation.ts`
(12 scenarios). Regression + tsc / eslint (0 err / 22 warn) / next build clean.

### Real Sprint 206 result — the genesis authority chain reached `target-validated`

Against the preserved Sprint 204 artifacts (`b-0d971133190c`,
`c-d3743b64c5830509cc380b58`, the consumed `D:\AtolyeRuntime`):

```
authority:begin-genesis  → s206-genesis-01  quiesce-requested
authority:quiesce        → quiesced        (worker stopped ; source durable recovery "clean")
authority:prepare        → prepared        (raw contentDigest 090b3455… / 2371 ;
                                            projectIdentityCount 17 ;
                                            logicalContentDigest 0e46cf6c… / 2371)
authority:validate       → target-validated  byteExact=true  identityMapped=true
```

`authority:status`: `activeAuthority: null`; the one transition at `target-validated`.
**HARD STOP.** No `authority:publish` / `publishRollback` / `quarantine` /
`finalize-quarantine`; no `.env.local` change; no `ATOLYE_RUNTIME_ROOT` /
`ATOLYE_RUNTIME_AUTHORITY_ROOT`; no legacy `data/projects` rename / move / delete;
no worker / dev start. `cutoverAuthorized` stays `false`; Execution Gate CLOSED.
`data/projects` byte-unchanged this sprint (F17-B is code-only; the chain only
reads the tree): 2399 fs files / 611073169 bytes / inventory aggregate
`8701419987…` / the 11 Sprint-204 F15-A derived indexes intact. `.env.local`
`bf52c74d…` (4051 b, mtime 2026-09-07) unchanged.

**`PUBLISH ONAY` is now the only thing standing between `target-validated` and
the real cutover.**
