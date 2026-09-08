import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import {
  assertRuntimeAuthorityGenerationMarkerCompatible,
  describeRuntimeAuthorityIdentity,
  writeRuntimeAuthorityGenerationMarker,
} from "./RuntimeAuthorityGenerationMarker";
import {
  endpointFromIdentityFields,
  nextRuntimeAuthorityTransitionState,
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  runtimeAuthorityInventoryDigest,
  runtimeAuthorityTransitionSchemaVersion,
  type RuntimeAuthorityEndpoint,
  type RuntimeAuthorityTransitionRecord,
  type RuntimeAuthorityTransitionState,
} from "./RuntimeAuthorityTransition";

/**
 * C.2B.9 — the operator-driven authority transition orchestrator.
 *
 *   beginTransition        ACTIVE            → quiesce-requested
 *   confirmQuiescence      quiesce-requested → quiesced        (worker stopped + durable-clean)
 *   prepareTransition      quiesced          → prepared        (freeze the source inventory)
 *   validateTarget         prepared          → target-validated
 *   publishTransition      target-validated  → published       (stamp target marker + CAS active authority)
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

  const existing = store.readTransition(transitionId);
  if (existing) {
    if (
      !sameEndpoint(existing.source, source) ||
      !sameEndpoint(existing.target, target)
    ) {
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

  if (!WORKER_DOWN.has(input.workerLifecycleState)) {
    throw new RuntimeAuthorityTransitionError(
      "TRANSITION_QUIESCENCE_WORKER_ACTIVE",
      `worker is "${input.workerLifecycleState}"`,
    );
  }
  if (input.durableRecovery !== "clean") {
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
}

export function prepareTransition(
  input: PrepareTransitionInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireState(input.store, input.transitionId, "prepared", ["quiesced"]);
  if (record.state === "prepared") return record;

  const slugs = normalizeSlugs(input.sourceProjectSlugs);
  return advance(input.store, record, "prepared", {
    sourceFreeze: {
      projectSlugs: slugs,
      inventoryDigest: runtimeAuthorityInventoryDigest(slugs),
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

  return advance(input.store, record, "target-validated", {
    targetValidation: {
      markerStatus: marker.status === "match" ? "match" : "absent",
      targetProjectSlugs: targetSlugs,
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

  input.store.writeQuarantine({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId: record.transitionId,
    authorityGeneration: record.source.authorityGeneration,
    authorityIdentity: record.source.authorityIdentity,
    resolverBindingIdentity: record.source.resolverBindingIdentity,
    quarantinedAt: input.store.clock(),
  });

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
