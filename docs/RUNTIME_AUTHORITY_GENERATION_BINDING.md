# Runtime Authority-Generation Binding — C.2B.6 / C.2B.6b / C.2B.9

Status: **C.2B.6b + C.2B.9 DONE.** The marker is wired into production startup +
recovery bootstrap (C.2B.6b, §5), and the versioned authority transition
protocol — quiescence, atomic publish, old-root quarantine, split-brain
prevention, crash recovery — is implemented and enforced (C.2B.9, §6).
Master-sprint sessions 2026-09-08. A real project migration is still gated on a
separate migration readiness audit; `cutoverAuthorized` stays false.

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

### Known limitations

- A raw `fs.write` to the old root's tree, bypassing the runtime entirely, is
  not prevented — the threat model is a second *runtime authority* activating,
  not filesystem ACLs. The operator's runbook still puts the old tree behind
  read-only OS permissions.
- `confirmQuiescence` refuses while the worker reports active; it does not
  *force-stop* a running runtime. The operator stops the runtime; the
  coordinator then confirms against the durable-recovery scan.
- The transition requires the **same** `ATOLYE_RUNTIME_AUTHORITY_ROOT` for source
  and target (the shared coordination plane). Changing it too invalidates the
  coordination and is an operator error.

### Next → migration readiness audit

C.2B.9 makes the transition *machinery* READY. A real project migration is still
gated on a separate **migration readiness audit** and its own approved sprint.
`cutoverAuthorized` stays false.
