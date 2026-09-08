# Runtime Authority-Generation Binding — C.2B.6 / C.2B.6b / C.2B.9

Status: **C.2B.6b DONE** — the marker is wired into production startup + recovery
bootstrap and fails closed on a generation / resolver-binding mismatch or a
production runtime root that is unset. Master-sprint sessions 2026-09-08.
C.2B.9 (versioned authority transition + quiescence + old-root quarantine) is
still a separate later sprint.

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

### Residual boundary (→ C.2B.9)

C.2B.6b blocks the case where the durable state **and its marker** are moved to
a different root (the marker's `resolverBindingIdentity` no longer matches →
`MISMATCH`) — which is every real relocation path, since `runtime:backup` /
migration-candidate materialization all copy the whole `projectsRoot` subtree.
It does **not** block a brand-new empty external root that is stamped fresh and
then has durable state copied in *without* the marker, nor
`ProductionExecutionDurableRecoveryService` invoked as truly standalone operator
tooling. Those are the old-root-quarantine + versioned-transition concerns of
**C.2B.9**.

Until C.2B.9: **do not relocate the runtime root.** The legacy in-repo default
is unaffected and fully supported.
