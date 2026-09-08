import { randomBytes } from "node:crypto";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import { describeRuntimeAuthorityIdentity } from "./RuntimeAuthorityGenerationMarker";
import {
  endpointFromIdentityFields,
  nextRuntimeAuthorityTransitionState,
  resolveRuntimeAuthorityTransitionKind,
  runtimeAuthorityProjectsContentDigest,
  runtimeAuthorityTransitionSchemaVersion,
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  type RuntimeAuthorityEndpoint,
  type RuntimeAuthorityRollbackToken,
  type RuntimeAuthorityTransitionRecord,
  type RuntimeAuthorityTransitionState,
} from "./RuntimeAuthorityTransition";
import {
  enforceOldRootReadOnly,
  liftOldRootReadOnly,
  RuntimeAuthorityOldRootQuarantineError,
  verifyOldRootReadOnly,
} from "./RuntimeAuthorityOldRootQuarantine";

/**
 * C.2B.11 — old-root read-only quarantine finalization + the single-use,
 * token-authorized rollback (reverse transition).
 *
 *   finalizeOldRootQuarantine   published/old-root-quarantined  → (read-only barrier
 *                                                                  + durable enforcement
 *                                                                  record + rollback token)
 *   beginTokenAuthorizedRollback  →  rollback-requested   (new record, kind: "rollback")
 *   validateRollback              rollback-requested → rollback-validated
 *   publishRollback               rollback-validated → rollback-published   (CAS active authority
 *                                                                          back to the old root,
 *                                                                          consume the token)
 *   quarantineFormerTarget        rollback-published → former-target-quarantined
 *
 * Invariant: at most ONE live authority. The single `active-authority.json` CAS
 * enforces it; the rollback shares that pointer, it does not fork it. The token
 * authorizes ONLY the reverse transition — never runtime startup, worker
 * execution, candidate consume, or a substitute for `active-authority.json` /
 * the generation marker.
 */

export type RuntimeAuthorityRollbackErrorCode =
  | "ROLLBACK_INPUT_INVALID"
  | "ROLLBACK_NOT_AVAILABLE"
  | "ROLLBACK_TOKEN_NOT_FOUND"
  | "ROLLBACK_TOKEN_MISMATCH"
  | "ROLLBACK_TOKEN_CONSUMED"
  | "ROLLBACK_GENERATION_MISMATCH"
  | "ROLLBACK_TRANSITION_MISMATCH"
  | "ROLLBACK_SEQUENCE_MISMATCH"
  | "ROLLBACK_SOURCE_ROOT_MISMATCH"
  | "ROLLBACK_TARGET_ROOT_MISMATCH"
  | "ROLLBACK_ACTIVE_NOT_FORMER_TARGET"
  | "ROLLBACK_OLD_ROOT_CONTENT_DRIFT"
  | "ROLLBACK_TARGET_DIRTY"
  | "ROLLBACK_ILLEGAL_STATE"
  | "ROLLBACK_QUARANTINE_NOT_ENFORCED";

const messages: Readonly<Record<RuntimeAuthorityRollbackErrorCode, string>> = Object.freeze({
  ROLLBACK_INPUT_INVALID: "Runtime authority rollback input is invalid.",
  ROLLBACK_NOT_AVAILABLE: "The forward transition is not in a rollback-eligible state.",
  ROLLBACK_TOKEN_NOT_FOUND: "No rollback token exists with this id.",
  ROLLBACK_TOKEN_MISMATCH: "The supplied rollback token does not match the stored token.",
  ROLLBACK_TOKEN_CONSUMED: "This rollback token has already been consumed.",
  ROLLBACK_GENERATION_MISMATCH: "The rollback token is bound to a different authority generation.",
  ROLLBACK_TRANSITION_MISMATCH: "The rollback token is bound to a different forward transition.",
  ROLLBACK_SEQUENCE_MISMATCH: "The rollback token is bound to a different transition sequence.",
  ROLLBACK_SOURCE_ROOT_MISMATCH: "The rollback token is bound to a different old (source) root.",
  ROLLBACK_TARGET_ROOT_MISMATCH: "The rollback token is bound to a different new (target) root.",
  ROLLBACK_ACTIVE_NOT_FORMER_TARGET: "The active authority is not the transition target this token reverses.",
  ROLLBACK_OLD_ROOT_CONTENT_DRIFT: "The quarantined old root's data no longer matches the frozen source.",
  ROLLBACK_TARGET_DIRTY: "The new root has been mutated since cutover — rollback requires it untouched.",
  ROLLBACK_ILLEGAL_STATE: "Runtime authority rollback state change is not allowed.",
  ROLLBACK_QUARANTINE_NOT_ENFORCED: "The old root's read-only quarantine is not enforced.",
});

export class RuntimeAuthorityRollbackError extends Error {
  constructor(readonly code: RuntimeAuthorityRollbackErrorCode, detail?: string) {
    super(detail ? `${messages[code]} — ${detail}` : messages[code]);
    this.name = "RuntimeAuthorityRollbackError";
    this.stack = undefined;
  }
}

/* ============================================ finalize old-root quarantine */

export interface FinalizeOldRootQuarantineInput {
  readonly store: RuntimeAuthorityTransitionStore;
  /** The forward transitionId (state must be `old-root-quarantined`). */
  readonly transitionId: string;
  /** `<oldRoot>/projects` — the retired tree to put behind the read-only barrier. */
  readonly oldRootProjectsRoot: string;
}

export interface FinalizeOldRootQuarantineResult {
  readonly transitionId: string;
  readonly kind: RuntimeAuthorityTransitionRecord["kind"];
  readonly rollbackAvailable: boolean;
  readonly readOnlyFileCount?: number;
  readonly rollbackToken?: RuntimeAuthorityRollbackToken;
}

/**
 * Apply + verify the read-only barrier over the retired root, record the durable
 * enforcement evidence, and issue the single-use rollback token. Idempotent.
 * `genesis` has no retired external root (the repo default stays writable so a
 * backup can be restored there) → no barrier, no token, `rollbackAvailable:false`.
 */
export function finalizeOldRootQuarantine(
  input: FinalizeOldRootQuarantineInput,
): FinalizeOldRootQuarantineResult {
  const record = input.store.readTransition(input.transitionId);
  if (!record) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "unknown transitionId");
  }
  if (record.state !== "old-root-quarantined") {
    throw new RuntimeAuthorityRollbackError(
      "ROLLBACK_NOT_AVAILABLE",
      `state is "${record.state}"`,
    );
  }
  const kind = resolveRuntimeAuthorityTransitionKind(record);
  if (kind === "genesis" || kind === "rollback") {
    return Object.freeze({ transitionId: record.transitionId, kind, rollbackAvailable: false });
  }
  if (!record.sourceFreeze?.contentDigest) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "no frozen source content digest");
  }

  const active = input.store.readActiveAuthority();
  if (
    !active ||
    active.resolverBindingIdentity !== record.target.resolverBindingIdentity ||
    active.transitionId !== record.transitionId
  ) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_ACTIVE_NOT_FORMER_TARGET");
  }

  // 1 — apply + verify the OS read-only barrier over the retired tree.
  let enforcement;
  try {
    enforcement = enforceOldRootReadOnly(input.oldRootProjectsRoot);
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_QUARANTINE_NOT_ENFORCED", error.message);
    }
    throw error;
  }
  if (enforcement.contentDigest !== record.sourceFreeze.contentDigest) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_OLD_ROOT_CONTENT_DRIFT");
  }

  // 2 — durable, append-once enforcement evidence.
  input.store.writeQuarantineEnforcement({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId: record.transitionId,
    resolverBindingIdentity: record.source.resolverBindingIdentity,
    mode: enforcement.mode,
    readOnlyFileCount: enforcement.readOnlyFileCount,
    contentDigest: enforcement.contentDigest,
    enforcedAt: input.store.clock(),
  });

  // 3 — issue the single-use rollback token (idempotent per forward transition).
  const existing = input.store.listRollbackTokens().find((t) => t.transitionId === record.transitionId);
  const token = existing ?? input.store.writeRollbackToken({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    tokenId: `rbt-${randomBytes(24).toString("hex")}`,
    transitionId: record.transitionId,
    authorityGeneration: record.target.authorityGeneration,
    sourceResolverBindingIdentity: record.source.resolverBindingIdentity,
    sourceAuthorityIdentity: record.source.authorityIdentity,
    targetResolverBindingIdentity: record.target.resolverBindingIdentity,
    targetAuthorityIdentity: record.target.authorityIdentity,
    transitionSequence: active.transitionSequence,
    sourceContentDigest: record.sourceFreeze.contentDigest,
    issuedAt: input.store.clock(),
  });

  return Object.freeze({
    transitionId: record.transitionId,
    kind,
    rollbackAvailable: true,
    readOnlyFileCount: enforcement.readOnlyFileCount,
    rollbackToken: token,
  });
}

/* ------------------------------------------------------ rollback status --- */

export interface RollbackAvailabilityStatus {
  readonly transitionId: string;
  readonly forwardState: RuntimeAuthorityTransitionState | null;
  readonly quarantined: boolean;
  readonly readOnlyEnforced: boolean;
  readonly tokenId: string | null;
  readonly tokenConsumed: boolean;
  readonly rollbackAvailable: boolean;
}

export function readRollbackAvailability(
  store: RuntimeAuthorityTransitionStore,
  transitionId: string,
): RollbackAvailabilityStatus {
  const record = store.readTransition(transitionId);
  const source = record?.source.resolverBindingIdentity;
  const quarantined = Boolean(source && store.readQuarantine(source));
  const readOnlyEnforced = Boolean(source && store.readQuarantineEnforcement(source));
  const token = store.listRollbackTokens().find((t) => t.transitionId === transitionId) ?? null;
  const tokenConsumed = Boolean(token && store.readRollbackTokenConsumption(token.tokenId));
  return Object.freeze({
    transitionId,
    forwardState: record?.state ?? null,
    quarantined,
    readOnlyEnforced,
    tokenId: token?.tokenId ?? null,
    tokenConsumed,
    rollbackAvailable: Boolean(
      record?.state === "old-root-quarantined" && quarantined && readOnlyEnforced && token && !tokenConsumed,
    ),
  });
}

/* =============================================== token-authorized rollback */

export interface BeginTokenAuthorizedRollbackInput {
  readonly store: RuntimeAuthorityTransitionStore;
  /** A fresh, unused transitionId for the rollback record. */
  readonly rollbackTransitionId: string;
  /** The stored rollback token id. */
  readonly tokenId: string;
  /** Optionally the full token value — every field must match the stored token. */
  readonly expectedToken?: RuntimeAuthorityRollbackToken;
  /** The retired old root we are returning to. */
  readonly oldRootContext: RuntimeStorageContext;
  readonly oldRootAuthorityGeneration: string;
  readonly oldRootProjectsRoot: string;
  /** The just-published new root we are leaving (its `projects/` must be untouched). */
  readonly formerTargetContext: RuntimeStorageContext;
  readonly formerTargetAuthorityGeneration: string;
  readonly formerTargetProjectsRoot: string;
}

export function beginTokenAuthorizedRollback(
  input: BeginTokenAuthorizedRollbackInput,
): RuntimeAuthorityTransitionRecord {
  const { store } = input;
  const token = loadValidToken(input);

  const forward = store.readTransition(token.transitionId);
  if (!forward || forward.state !== "old-root-quarantined") {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_NOT_AVAILABLE", "forward transition not quarantined");
  }

  const oldEndpoint = endpointFor(input.oldRootContext, input.oldRootAuthorityGeneration);
  const newEndpoint = endpointFor(input.formerTargetContext, input.formerTargetAuthorityGeneration);
  if (oldEndpoint.resolverBindingIdentity !== token.sourceResolverBindingIdentity) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_SOURCE_ROOT_MISMATCH");
  }
  if (newEndpoint.resolverBindingIdentity !== token.targetResolverBindingIdentity) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TARGET_ROOT_MISMATCH");
  }
  if (input.oldRootAuthorityGeneration !== token.authorityGeneration ||
      input.formerTargetAuthorityGeneration !== token.authorityGeneration) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_GENERATION_MISMATCH");
  }

  const active = store.readActiveAuthority();
  if (
    !active ||
    active.resolverBindingIdentity !== token.targetResolverBindingIdentity ||
    active.authorityGeneration !== token.authorityGeneration
  ) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_ACTIVE_NOT_FORMER_TARGET");
  }
  if (active.transitionSequence !== token.transitionSequence) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_SEQUENCE_MISMATCH");
  }

  assertRollbackContentSafe(input, token);

  const existing = store.readTransition(input.rollbackTransitionId);
  if (existing) {
    if (
      resolveRuntimeAuthorityTransitionKind(existing) !== "rollback" ||
      existing.rollbackTokenId !== token.tokenId ||
      existing.rollbackOf !== token.transitionId
    ) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "rollbackTransitionId reused");
    }
    return existing;
  }

  const now = store.clock();
  return store.writeTransition({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId: input.rollbackTransitionId,
    kind: "rollback",
    state: "rollback-requested",
    source: newEndpoint,
    target: oldEndpoint,
    rollbackOf: token.transitionId,
    rollbackTokenId: token.tokenId,
    createdAt: now,
    updatedAt: now,
    history: [{ state: "rollback-requested", at: now }],
  });
}

export interface RollbackStepInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly rollbackTransitionId: string;
  readonly oldRootProjectsRoot: string;
  readonly formerTargetProjectsRoot: string;
}

export function validateRollback(input: RollbackStepInput): RuntimeAuthorityTransitionRecord {
  const record = requireRollbackState(input.store, input.rollbackTransitionId, "rollback-validated", [
    "rollback-requested",
  ]);
  if (record.state === "rollback-validated") return record;
  const token = requireStoredToken(input.store, record);

  // The old root must still be read-only-enforced and byte-identical.
  try {
    const verify = verifyOldRootReadOnly(input.oldRootProjectsRoot);
    if (verify.contentDigest !== token.sourceContentDigest) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_OLD_ROOT_CONTENT_DRIFT");
    }
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_QUARANTINE_NOT_ENFORCED", error.message);
    }
    throw error;
  }
  assertFormerTargetUntouched(input.formerTargetProjectsRoot, token);

  return advanceRollback(input.store, record, "rollback-validated");
}

export interface PublishRollbackInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly rollbackTransitionId: string;
  readonly oldRootProjectsRoot: string;
}

export function publishRollback(input: PublishRollbackInput): RuntimeAuthorityTransitionRecord {
  const record = requireRollbackState(input.store, input.rollbackTransitionId, "rollback-published", [
    "rollback-validated",
  ]);
  if (record.state === "rollback-published" || record.state === "former-target-quarantined") {
    return record;
  }
  const token = requireStoredToken(input.store, record);

  if (input.store.readRollbackTokenConsumption(token.tokenId)) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TOKEN_CONSUMED");
  }

  // 1 — lift the read-only barrier so the old root can serve again.
  try {
    liftOldRootReadOnly(input.oldRootProjectsRoot);
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_QUARANTINE_NOT_ENFORCED", error.message);
    }
    throw error;
  }

  // 2 — CAS the single active-authority pointer BACK to the old root.
  const active = input.store.readActiveAuthority();
  if (!active || active.resolverBindingIdentity !== token.targetResolverBindingIdentity) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_ACTIVE_NOT_FORMER_TARGET");
  }
  input.store.publishActiveAuthority(
    {
      schemaVersion: runtimeAuthorityTransitionSchemaVersion,
      transitionSequence: active.transitionSequence + 1,
      transitionId: record.transitionId,
      authorityGeneration: token.authorityGeneration,
      authorityIdentity: token.sourceAuthorityIdentity,
      resolverBindingIdentity: token.sourceResolverBindingIdentity,
      activatedAt: input.store.clock(),
    },
    token.targetResolverBindingIdentity,
  );

  // 3 — record the lift + consume the token (both append-once).
  input.store.writeQuarantineLift({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    resolverBindingIdentity: token.sourceResolverBindingIdentity,
    rollbackTransitionId: record.transitionId,
    rollbackTokenId: token.tokenId,
    liftedAt: input.store.clock(),
  });
  input.store.writeRollbackTokenConsumption({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    tokenId: token.tokenId,
    rollbackTransitionId: record.transitionId,
    consumedAt: input.store.clock(),
  });

  return advanceRollback(input.store, record, "rollback-published");
}

export interface QuarantineFormerTargetInput {
  readonly store: RuntimeAuthorityTransitionStore;
  readonly rollbackTransitionId: string;
  readonly formerTargetProjectsRoot: string;
}

export function quarantineFormerTarget(
  input: QuarantineFormerTargetInput,
): RuntimeAuthorityTransitionRecord {
  const record = requireRollbackState(
    input.store,
    input.rollbackTransitionId,
    "former-target-quarantined",
    ["rollback-published"],
  );
  if (record.state === "former-target-quarantined") return record;
  const token = requireStoredToken(input.store, record);

  let enforcement;
  try {
    enforcement = enforceOldRootReadOnly(input.formerTargetProjectsRoot);
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_QUARANTINE_NOT_ENFORCED", error.message);
    }
    throw error;
  }

  input.store.writeQuarantine({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId: record.transitionId,
    authorityGeneration: token.authorityGeneration,
    authorityIdentity: token.targetAuthorityIdentity,
    resolverBindingIdentity: token.targetResolverBindingIdentity,
    quarantinedAt: input.store.clock(),
  });
  input.store.writeQuarantineEnforcement({
    schemaVersion: runtimeAuthorityTransitionSchemaVersion,
    transitionId: record.transitionId,
    resolverBindingIdentity: token.targetResolverBindingIdentity,
    mode: enforcement.mode,
    readOnlyFileCount: enforcement.readOnlyFileCount,
    contentDigest: enforcement.contentDigest,
    enforcedAt: input.store.clock(),
  });

  return advanceRollback(input.store, record, "former-target-quarantined");
}

/* --------------------------------------------------------------- helpers --- */

function loadValidToken(
  input: Pick<BeginTokenAuthorizedRollbackInput, "store" | "tokenId" | "expectedToken">,
): RuntimeAuthorityRollbackToken {
  let token;
  try {
    token = input.store.readRollbackToken(input.tokenId);
  } catch (error) {
    if (error instanceof RuntimeAuthorityTransitionError && error.code === "ROLLBACK_TOKEN_INPUT_INVALID") {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "tokenId");
    }
    throw error;
  }
  if (!token) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TOKEN_NOT_FOUND");
  }
  if (input.expectedToken && JSON.stringify(sortedToken(input.expectedToken)) !== JSON.stringify(sortedToken(token))) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TOKEN_MISMATCH");
  }
  if (input.store.readRollbackTokenConsumption(token.tokenId)) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TOKEN_CONSUMED");
  }
  return token;
}

function requireStoredToken(
  store: RuntimeAuthorityTransitionStore,
  record: RuntimeAuthorityTransitionRecord,
): RuntimeAuthorityRollbackToken {
  const token = record.rollbackTokenId ? store.readRollbackToken(record.rollbackTokenId) : null;
  if (!token) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TOKEN_NOT_FOUND");
  }
  return token;
}

function assertRollbackContentSafe(
  input: BeginTokenAuthorizedRollbackInput,
  token: RuntimeAuthorityRollbackToken,
): void {
  try {
    const oldContent = verifyOldRootReadOnly(input.oldRootProjectsRoot);
    if (oldContent.contentDigest !== token.sourceContentDigest) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_OLD_ROOT_CONTENT_DRIFT");
    }
  } catch (error) {
    if (error instanceof RuntimeAuthorityOldRootQuarantineError) {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_QUARANTINE_NOT_ENFORCED", error.message);
    }
    throw error;
  }
  assertFormerTargetUntouched(input.formerTargetProjectsRoot, token);
}

function assertFormerTargetUntouched(
  formerTargetProjectsRoot: string,
  token: RuntimeAuthorityRollbackToken,
): void {
  let content;
  try {
    content = runtimeAuthorityProjectsContentDigest(formerTargetProjectsRoot);
  } catch (error) {
    if (error instanceof RuntimeAuthorityTransitionError && error.code === "TRANSITION_CONTENT_UNSAFE") {
      throw new RuntimeAuthorityRollbackError("ROLLBACK_TARGET_DIRTY", "unsafe path");
    }
    throw error;
  }
  if (content.contentDigest !== token.sourceContentDigest) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_TARGET_DIRTY");
  }
}

function endpointFor(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): RuntimeAuthorityEndpoint {
  return endpointFromIdentityFields(describeRuntimeAuthorityIdentity(context, authorityGeneration));
}

function requireRollbackState(
  store: RuntimeAuthorityTransitionStore,
  rollbackTransitionId: string,
  into: RuntimeAuthorityTransitionState,
  from: readonly RuntimeAuthorityTransitionState[],
): RuntimeAuthorityTransitionRecord {
  const record = store.readTransition(rollbackTransitionId);
  if (!record) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "unknown rollbackTransitionId");
  }
  if (resolveRuntimeAuthorityTransitionKind(record) !== "rollback") {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_INPUT_INVALID", "not a rollback record");
  }
  if (record.state === into) return record;
  if (!from.includes(record.state) || !nextRuntimeAuthorityTransitionState(record.state, into)) {
    throw new RuntimeAuthorityRollbackError("ROLLBACK_ILLEGAL_STATE", `${record.state} → ${into}`);
  }
  return record;
}

function advanceRollback(
  store: RuntimeAuthorityTransitionStore,
  record: RuntimeAuthorityTransitionRecord,
  state: RuntimeAuthorityTransitionState,
): RuntimeAuthorityTransitionRecord {
  const now = store.clock();
  return store.writeTransition({
    ...record,
    state,
    updatedAt: now,
    history: [...record.history, { state, at: now }],
  });
}

function sortedToken(token: RuntimeAuthorityRollbackToken): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(token as unknown as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}
