import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import {
  assertRuntimeAuthorityGenerationMarkerCompatible,
  describeRuntimeAuthorityIdentity,
  writeRuntimeAuthorityGenerationMarker,
} from "./RuntimeAuthorityGenerationMarker";
import {
  endpointFromIdentityFields,
  nextRuntimeAuthorityTransitionState,
  resolveRuntimeAuthorityTransitionKind,
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  runtimeAuthorityInventoryDigest,
  runtimeAuthorityProjectsContentDigest,
  runtimeAuthorityTransitionSchemaVersion,
  type RuntimeAuthorityEndpoint,
  type RuntimeAuthorityTransitionKind,
  type RuntimeAuthorityTransitionRecord,
  type RuntimeAuthorityTransitionState,
} from "./RuntimeAuthorityTransition";

/**
 * C.2B.9 / C.2B.9b — the operator-driven authority transition orchestrator.
 *
 *   beginTransition        ACTIVE            → quiesce-requested   (kind = relocation)
 *   beginGenesisTransition  legacy default   → quiesce-requested   (kind = genesis, F10)
 *   beginRecoveryTransition abandoned active → quiesce-requested   (kind = recovery, F4)
 *   confirmQuiescence      quiesce-requested → quiesced
 *   prepareTransition      quiesced          → prepared            (freeze source inventory + byte digest)
 *   validateTarget         prepared          → target-validated    (byte-exact copy check, F3)
 *   publishTransition      target-validated  → published           (stamp target marker + CAS active authority)
 *   quarantineSource       published         → old-root-quarantined
 *   failTransition         <pre-publish>     → failed
 *
 * Every step is idempotent on `transitionId` and rejects an out-of-order call
 * (`TRANSITION_ILLEGAL_STATE`). Nothing here executes a pipeline, a worker or a
 * model — the Execution Gate is untouched.
 */

export interface RuntimeAuthorityTransitionContexts {
  readonly sourceContext: RuntimeStorageContext;
  readonly sourceAuthorityGeneration: string;
  readonly targetContext: RuntimeStorageContext;
  readonly targetAuthorityGeneration: string;
}

export interface BeginTransitionInput extends RuntimeAuthorityTransitionContexts {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
}

export function beginTransition(
  input: BeginTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const { store, transitionId } = input;
  const source = endpointFor(input.sourceContext, input.sourceAuthorityGeneration);
  const target = endpointFor(input.targetContext, input.targetAuthorityGeneration);

  if (source.resolverBindingIdentity === target.resolverBindingIdentity) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_IDENTITY_MISMATCH",
      "source and target resolve to the same authority",
    );
  }

  // The source must be a real, stamped authority that is not quarantined.
  const sourceMarker = assertRuntimeAuthorityGenerationMarkerCompatible({
    context: input.sourceContext,
    authorityGeneration: input.sourceAuthorityGeneration,
  });
  if (sourceMarker.status !== "match") {
    throw new RuntimeAuthorityTransitionError("TRANSITION_SOURCE_UNMARKED");
  }
  if (store.readQuarantine(source.resolverBindingIdentity)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_SOURCE_QUARANTINED");
  }
  const active = store.readActiveAuthority();
  if (active && active.resolverBindingIdentity !== source.resolverBindingIdentity) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_ALREADY_ACTIVE_ELSEWHERE");
  }

  return startTransition(store, transitionId, "relocation", source, target);
}

export interface BeginGenesisTransitionInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  /** The legacy in-repo default context (`source === "legacy-default"`). */
  readonly legacySourceContext: RuntimeStorageContext;
  readonly authorityGeneration: string;
  readonly targetContext: RuntimeStorageContext;
}

/**
 * F10 — the one-time transition from the legacy in-repo default to the first
 * external runtime root. The legacy source has no marker and there is no
 * published authority yet.
 */
export function beginGenesisTransition(
  input: BeginGenesisTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const { store, transitionId } = input;

  if (input.legacySourceContext.source !== "legacy-default") {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_INPUT_INVALID",
      "genesis source must be the legacy in-repo default",
    );
  }
  if (input.targetContext.classification !== "explicit-external") {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_INPUT_INVALID",
      "genesis target must be an explicit external runtime root",
    );
  }

  const source = endpointFor(input.legacySourceContext, input.authorityGeneration);
  const target = endpointFor(input.targetContext, input.authorityGeneration);
  if (source.resolverBindingIdentity === target.resolverBindingIdentity) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_IDENTITY_MISMATCH", "source == target");
  }

  // The legacy source must NOT already carry a marker.
  if (
    assertRuntimeAuthorityGenerationMarkerCompatible({
      context: input.legacySourceContext,
      authorityGeneration: input.authorityGeneration,
    }).status !== "absent"
  ) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_SOURCE_MARKED");
  }
  // Genesis is only valid before any authority has ever been published.
  if (store.readActiveAuthority()) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_ALREADY_ACTIVE_ELSEWHERE");
  }
  if (store.readQuarantine(source.resolverBindingIdentity)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_SOURCE_QUARANTINED");
  }
  if (store.readQuarantine(target.resolverBindingIdentity)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_TARGET_QUARANTINED");
  }
  // A foreign marker on the target would have thrown from assert…Compatible.
  assertRuntimeAuthorityGenerationMarkerCompatible({
    context: input.targetContext,
    authorityGeneration: input.authorityGeneration,
  });

  return startTransition(store, transitionId, "genesis", source, target);
}

export interface BeginRecoveryTransitionInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  /** A fresh, non-quarantined root holding the restored data. */
  readonly targetContext: RuntimeStorageContext;
  readonly targetAuthorityGeneration: string;
  /** Why authority is being forcibly moved (audited). */
  readonly reason: string;
}

/**
 * F4 — disaster recovery. The current active authority is abandoned (possibly
 * unreachable / corrupt) and authority is forcibly moved to a restored root.
 * The source endpoint is read from `active-authority.json` — no live source
 * context is required. The abandoned source IS quarantined at the end.
 */
export function beginRecoveryTransition(
  input: BeginRecoveryTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const { store, transitionId } = input;
  const active = store.readActiveAuthority();
  if (!active) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_NO_ACTIVE_AUTHORITY");
  }
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 8 || reason.length > 500) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_INPUT_INVALID",
      "recovery reason must be 8–500 characters",
    );
  }

  const source: RuntimeAuthorityEndpoint = {
    authorityGeneration: active.authorityGeneration,
    authorityIdentity: active.authorityIdentity,
    resolverBindingIdentity: active.resolverBindingIdentity,
  };
  const target = endpointFor(input.targetContext, input.targetAuthorityGeneration);
  if (source.resolverBindingIdentity === target.resolverBindingIdentity) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_IDENTITY_MISMATCH",
      "recovery target is the abandoned authority",
    );
  }
  if (store.readQuarantine(target.resolverBindingIdentity)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_TARGET_QUARANTINED");
  }
  // A foreign / stale marker on the target fails closed here.
  assertRuntimeAuthorityGenerationMarkerCompatible({
    context: input.targetContext,
    authorityGeneration: input.targetAuthorityGeneration,
  });

  const existing = store.readTransition(transitionId);
  if (existing) {
    if (!sameEndpoint(existing.source, source) || !sameEndpoint(existing.target, target)) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_INPUT_INVALID",
        "transitionId already used with different endpoints",
      );
    }
    return existing;
  }
  const now = store.clock();
  return store.writeTransition({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId,
    kind: "recovery",
    state: "quiesce-requested",
    source,
    target,
    recoveryReason: reason,
    createdAt: now,
    updatedAt: now,
    history: [{ state: "quiesce-requested", at: now }],
  });
}

function startTransition(
  store: RuntimeAuthorityTransitionStore,
  transitionId: string,
  kind: RuntimeAuthorityTransitionKind,
  source: RuntimeAuthorityEndpoint,
  target: RuntimeAuthorityEndpoint,
): RuntimeAuthorityTransitionRecord {
  const existing = store.readTransition(transitionId);
  if (existing) {
    if (
      resolveRuntimeAuthorityTransitionKind(existing) !== kind ||
      !sameEndpoint(existing.source, source) ||
      !sameEndpoint(existing.target, target)
    ) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_INPUT_INVALID",
        "transitionId already used with different kind / endpoints",
      );
    }
    return existing;
  }
  const now = store.clock();
  return store.writeTransition({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId,
    kind,
    state: "quiesce-requested",
    source,
    target,
    createdAt: now,
    updatedAt: now,
    history: [{ state: "quiesce-requested", at: now }],
  });
}

export interface ConfirmQuiescenceInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  /** From `getProductionRuntimeStatus().lifecycleState`. Must be down. */
  readonly workerLifecycleState: string;
  /** Aggregate of `ProductionExecutionDurableRecoveryService.scan()` decisions. */
  readonly durableRecovery: "clean" | "recovery-required" | "indeterminate";
}

const WORKER_DOWN = new Set(["created", "stopped"]);

export function confirmQuiescence(
  input: ConfirmQuiescenceInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "quiesced", [
    "quiesce-requested",
  ]);
  if (record.state === "quiesced") return record;

  // The production worker must be down for every kind of transition.
  if (!WORKER_DOWN.has(input.workerLifecycleState)) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_QUIESCENCE_WORKER_ACTIVE",
      `worker is "${input.workerLifecycleState}"`,
    );
  }
  // `relocation` / `genesis` require a CLEAN source before the copy. `recovery`
  // is abandoning a (possibly corrupt) source — the scan is recorded, not gated.
  if (
    resolveRuntimeAuthorityTransitionKind(record) !== "recovery" &&
    input.durableRecovery !== "clean"
  ) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_QUIESCENCE_NOT_CLEAN",
      `durable recovery is "${input.durableRecovery}"`,
    );
  }

  return advance(input.store, record, "quiesced", {
    quiescence: {
      workerLifecycleState: input.workerLifecycleState,
      durableRecovery: input.durableRecovery,
      confirmedAt: input.store.clock(),
    },
  });
}

export interface PrepareTransitionInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  /** The frozen source `projectsRoot` inventory (directory names). */
  readonly sourceProjectSlugs: readonly string[];
  /**
   * The real source `projectsRoot` path. When given, a per-file SHA-256 digest
   * of the whole tree is frozen and `validateTarget` requires the target to be
   * a byte-exact copy (F3). The operator CLI always passes this.
   */
  readonly sourceProjectsRoot?: string;
}

export function prepareTransition(
  input: PrepareTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "prepared", ["quiesced"]);
  if (record.state === "prepared") return record;

  const slugs = normalizeSlugs(input.sourceProjectSlugs);
  const content = input.sourceProjectsRoot
    ? runtimeAuthorityProjectsContentDigest(input.sourceProjectsRoot)
    : undefined;
  return advance(input.store, record, "prepared", {
    sourceFreeze: {
      projectSlugs: slugs,
      inventoryDigest: runtimeAuthorityInventoryDigest(slugs),
      ...(content
        ? { contentDigest: content.contentDigest, fileCount: content.fileCount }
        : {}),
      frozenAt: input.store.clock(),
    },
  });
}

export interface ValidateTargetInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  readonly targetContext: RuntimeStorageContext;
  readonly targetAuthorityGeneration: string;
  /** The target `projectsRoot` inventory (directory names). */
  readonly targetProjectSlugs: readonly string[];
  /**
   * The real target `projectsRoot` path. Required when `prepareTransition` froze
   * a `contentDigest` — the target must be a byte-exact copy (F3).
   */
  readonly targetProjectsRoot?: string;
}

export function validateTarget(
  input: ValidateTargetInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "target-validated", [
    "prepared",
  ]);
  if (record.state === "target-validated") return record;
  if (!record.sourceFreeze) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_ILLEGAL_STATE", "no source freeze");
  }

  const target = endpointFor(input.targetContext, input.targetAuthorityGeneration);
  if (!sameEndpoint(target, record.target)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_IDENTITY_MISMATCH", "target");
  }

  // Marker must be absent (stamped at publish) or already this exact authority.
  // A different generation / resolver binding would have thrown here already.
  const marker = assertRuntimeAuthorityGenerationMarkerCompatible({
    context: input.targetContext,
    authorityGeneration: input.targetAuthorityGeneration,
  });
  if (marker.status === "written") {
    throw new RuntimeAuthorityTransitionError("TRANSITION_ILLEGAL_STATE", "marker write during validate");
  }

  // The target must hold exactly the frozen source inventory — a controlled
  // relocation copies every project. A populated target that does not match the
  // freeze (or an empty target when the source has data) is a marker-less /
  // partial copy → fail closed.
  const targetSlugs = normalizeSlugs(input.targetProjectSlugs);
  if (!sameStringSet(targetSlugs, record.sourceFreeze.projectSlugs)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_TARGET_INVENTORY_MISMATCH");
  }

  // F3 — when a content digest was frozen, the target must be a byte-exact copy.
  let byteExact = false;
  if (record.sourceFreeze.contentDigest) {
    if (!input.targetProjectsRoot) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_INPUT_INVALID",
        "targetProjectsRoot is required — a byte-exact source digest was frozen",
      );
    }
    const targetContent = runtimeAuthorityProjectsContentDigest(input.targetProjectsRoot);
    if (
      targetContent.contentDigest !== record.sourceFreeze.contentDigest ||
      targetContent.fileCount !== record.sourceFreeze.fileCount
    ) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_TARGET_CONTENT_MISMATCH");
    }
    byteExact = true;
  }

  return advance(input.store, record, "target-validated", {
    targetValidation: {
      markerStatus: marker.status === "match" ? "match" : "absent",
      targetProjectSlugs: targetSlugs,
      byteExact,
      validatedAt: input.store.clock(),
    },
  });
}

export interface PublishTransitionInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  readonly targetContext: RuntimeStorageContext;
  readonly targetAuthorityGeneration: string;
}

export function publishTransition(
  input: PublishTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "published", [
    "target-validated",
  ]);
  if (record.state === "published" || record.state === "old-root-quarantined") {
    return record;
  }

  const target = endpointFor(input.targetContext, input.targetAuthorityGeneration);
  if (!sameEndpoint(target, record.target)) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_IDENTITY_MISMATCH", "target");
  }

  // 1 — stamp the target marker (idempotent: returns "match" if already stamped).
  writeRuntimeAuthorityGenerationMarker({
    context: input.targetContext,
    authorityGeneration: input.targetAuthorityGeneration,
  });

  // 2 — CAS the single active-authority pointer.
  const active = input.store.readActiveAuthority();
  const expectedPrevious = active ? record.source.resolverBindingIdentity : null;
  const sequence = (active?.transitionSequence ?? 0) + 1;
  input.store.publishActiveAuthority(
    {
      schemaVersion: runtimeAuthorityTransitionSchemaVersion,
      transitionSequence: sequence,
      transitionId: record.transitionId,
      authorityGeneration: target.authorityGeneration,
      authorityIdentity: target.authorityIdentity,
      resolverBindingIdentity: target.resolverBindingIdentity,
      activatedAt: input.store.clock(),
    },
    expectedPrevious,
  );

  // 3 — commit the transition state.
  return advance(input.store, record, "published", {});
}

export interface QuarantineSourceInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
}

export function quarantineSource(
  input: QuarantineSourceInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "old-root-quarantined", [
    "published",
  ]);
  if (record.state === "old-root-quarantined") return record;

  // `genesis` retires the legacy in-repo default via the active-authority
  // pointer only — a `quarantine/<binding>.json` there would also forbid
  // restoring a backup to the repo path. `relocation` / `recovery` quarantine
  // the abandoned source root.
  if (resolveRuntimeAuthorityTransitionKind(record) !== "genesis") {
    input.store.writeQuarantine({
      schemaVersion: runtimeAuthorityTransitionSchemaVersion,
      transitionId: record.transitionId,
      authorityGeneration: record.source.authorityGeneration,
      authorityIdentity: record.source.authorityIdentity,
      resolverBindingIdentity: record.source.resolverBindingIdentity,
      quarantinedAt: input.store.clock(),
    });
  }

  return advance(input.store, record, "old-root-quarantined", {});
}

export interface FailTransitionInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly transitionId: string;
  readonly reason: string;
}

export function failTransition(
  input: FailTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const record = input.store.readTransition(input.transitionId);
  if (!record) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "unknown transitionId");
  }
  if (record.state === "failed") return record;
  if (!nextRuntimeAuthorityTransitionState(record.state, "failed")) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_ILLEGAL_STATE",
      `cannot fail from "${record.state}"`,
    );
  }
  return advance(input.store, record, "failed", {
    failure: {
      reason: String(input.reason).slice(0, 500),
      failedAt: input.store.clock(),
    },
  });
}

/* --------------------------------------------------------------- helpers --- */

function endpointFor(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): RuntimeAuthorityEndpoint {
  return endpointFromIdentityFields(
    describeRuntimeAuthorityIdentity(context, authorityGeneration),
  );
}

function sameEndpoint(
  left: RuntimeAuthorityEndpoint,
  right: RuntimeAuthorityEndpoint,
): boolean {
  return (
    left.authorityGeneration === right.authorityGeneration &&
    left.authorityIdentity === right.authorityIdentity &&
    left.resolverBindingIdentity === right.resolverBindingIdentity
  );
}

function requireState(
  store: RuntimeAuthorityTransitionStore,
  transitionId: string,
  intoState: RuntimeAuthorityTransitionState,
  fromStates: readonly RuntimeAuthorityTransitionState[],
): RuntimeAuthorityTransitionRecord {
  const record = store.readTransition(transitionId);
  if (!record) {
    throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "unknown transitionId");
  }
  if (record.state === intoState) return record;
  if (!fromStates.includes(record.state)) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_ILLEGAL_STATE",
      `${record.state} → ${intoState}`,
    );
  }
  if (!nextRuntimeAuthorityTransitionState(record.state, intoState)) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_ILLEGAL_STATE",
      `${record.state} → ${intoState}`,
    );
  }
  return record;
}

function advance(
  store: RuntimeAuthorityTransitionStore,
  record: RuntimeAuthorityTransitionRecord,
  state: RuntimeAuthorityTransitionState,
  extra: Partial<RuntimeAuthorityTransitionRecord>,
): RuntimeAuthorityTransitionRecord {
  const now = store.clock();
  return store.writeTransition({
    ...record,
    ...extra,
    state,
    updatedAt: now,
    history: [...record.history, { state, at: now }],
  });
}

function normalizeSlugs(slugs: readonly string[]): readonly string[] {
  const filtered = slugs.filter(
    (slug) => typeof slug === "string" && /^[a-zA-Z0-9-_]+$/.test(slug),
  );
  return [...new Set(filtered)].sort();
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((value) => set.has(value));
}
