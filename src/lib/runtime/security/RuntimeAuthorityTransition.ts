import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  assertPathContained,
  validateSafeAncestorChain,
} from "@/lib/runtime/RuntimeStoragePaths";
import { isRuntimeTransientExcludedRelativePath } from "@/lib/runtime/RuntimeTransientArtifactPolicy";
import {
  runtimeAuthorityGenerationMarkerFileName,
  type RuntimeAuthorityIdentityFields,
} from "./RuntimeAuthorityGenerationMarker";

/**
 * C.2B.9 — runtime authority transition control plane.
 *
 * A machine-local, out-of-band record of every controlled authority relocation.
 * It lives under the shared runtime authority root
 * (`<authorityRoot>/authority-transition-v1/`, a sibling of the per-project
 * `.lock` / `.claim.json` coordination files) — **never** in `data/projects`
 * and **never** in a `production-execution` record.
 *
 *   active-authority.json          the single active production authority
 *                                  (absent until the first transition)
 *   transitions/<transitionId>.json a per-transition state record
 *   quarantine/<bindingDigest>.json a read-only quarantine mark for a retired root
 *
 * The state machine is strictly forward:
 *
 *   quiesce-requested → quiesced → prepared → target-validated → published
 *                                                                    → old-root-quarantined
 *
 * `failed` is terminal (reachable from every pre-publish state). After
 * `published` there is no silent rollback and the source root is never made
 * writable again.
 */

export const runtimeAuthorityTransitionSchemaVersion = "1" as const;
export const runtimeAuthorityTransitionDirectoryName = "authority-transition-v1";
const MAX_RECORD_BYTES = 16 * 1024;
const TRANSITION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/;
const BINDING_DIGEST = /^[0-9a-f]{64}$/;

export type RuntimeAuthorityTransitionState =
  | "quiesce-requested"
  | "quiesced"
  | "prepared"
  | "target-validated"
  | "published"
  | "old-root-quarantined"
  | "failed"
  // C.2B.11 — a token-authorized rollback runs as its own record (kind: "rollback"),
  // created directly in `rollback-requested`. It shares this store and the single
  // `active-authority.json` CAS; there is no edge from a forward record into it.
  | "rollback-requested"
  | "rollback-validated"
  | "rollback-published"
  | "former-target-quarantined";

/**
 * `relocation` — external → external (both roots stamped). The source gets a
 *   `quarantine/<binding>.json` mark.
 * `genesis`    — the legacy in-repo default → the first external root. The
 *   legacy source was never a published authority, so it is retired by the
 *   `active-authority.json` pointer alone (no quarantine file — it would also
 *   forbid restoring a backup to the repo).
 * `recovery`   — a disaster path: the current active authority is abandoned
 *   (possibly unreachable / corrupt) and authority is forcibly moved to a
 *   restored root. The abandoned source IS quarantined.
 * `rollback`   — C.2B.11: a single-use, token-authorized reverse transition that
 *   moves authority from the just-published target BACK to the quarantined old
 *   root, only while nothing has mutated on either root since the cutover.
 */
export type RuntimeAuthorityTransitionKind =
  | "relocation"
  | "genesis"
  | "recovery"
  | "rollback";

const FORWARD: Readonly<
  Record<RuntimeAuthorityTransitionState, readonly RuntimeAuthorityTransitionState[]>
> = Object.freeze({
  "quiesce-requested": ["quiesced", "failed"],
  quiesced: ["prepared", "failed"],
  prepared: ["target-validated", "failed"],
  "target-validated": ["published", "failed"],
  published: ["old-root-quarantined"],
  "old-root-quarantined": [],
  failed: [],
  "rollback-requested": ["rollback-validated", "failed"],
  "rollback-validated": ["rollback-published", "failed"],
  "rollback-published": ["former-target-quarantined"],
  "former-target-quarantined": [],
});

/** States in which the SOURCE root must not initialize a new runtime. */
export const runtimeAuthorityTransitionInProgressStates: ReadonlySet<RuntimeAuthorityTransitionState> =
  new Set([
    "quiesce-requested",
    "quiesced",
    "prepared",
    "target-validated",
  ]);

export type RuntimeAuthorityTransitionErrorCode =
  | "TRANSITION_INPUT_INVALID"
  | "TRANSITION_RECORD_CORRUPT"
  | "TRANSITION_RECORD_UNSAFE"
  | "TRANSITION_ILLEGAL_STATE"
  | "TRANSITION_IDENTITY_MISMATCH"
  | "TRANSITION_CAS_CONFLICT"
  | "TRANSITION_WRITE_FAILED"
  | "TRANSITION_SOURCE_UNMARKED"
  | "TRANSITION_SOURCE_MARKED"
  | "TRANSITION_SOURCE_QUARANTINED"
  | "TRANSITION_TARGET_QUARANTINED"
  | "TRANSITION_ALREADY_ACTIVE_ELSEWHERE"
  | "TRANSITION_NO_ACTIVE_AUTHORITY"
  | "TRANSITION_QUIESCENCE_WORKER_ACTIVE"
  | "TRANSITION_QUIESCENCE_NOT_CLEAN"
  | "TRANSITION_TARGET_INVENTORY_MISMATCH"
  | "TRANSITION_TARGET_CONTENT_MISMATCH"
  | "TRANSITION_CONTENT_UNSAFE"
  // F17-B — identity-mapped source/target comparison
  | "TRANSITION_SOURCE_IDENTITY_MISSING"
  | "TRANSITION_TARGET_IDENTITY_UNKNOWN"
  | "TRANSITION_IDENTITY_BINDING_MISMATCH"
  // C.2B.11
  | "ROLLBACK_TOKEN_INPUT_INVALID"
  | "ROLLBACK_TOKEN_MISMATCH"
  | "ROLLBACK_TOKEN_ALREADY_ISSUED"
  | "ROLLBACK_TOKEN_ALREADY_CONSUMED"
  | "QUARANTINE_ENFORCEMENT_INPUT_INVALID";

export class RuntimeAuthorityTransitionError extends Error {
  constructor(
    readonly code: RuntimeAuthorityTransitionErrorCode,
    detail?: string,
  ) {
    super(detail ? `${messageFor(code)} — ${detail}` : messageFor(code));
    this.name = "RuntimeAuthorityTransitionError";
    this.stack = undefined;
  }
}

export interface RuntimeAuthorityEndpoint {
  readonly authorityGeneration: string;
  readonly authorityIdentity: string;
  readonly resolverBindingIdentity: string;
}

export interface RuntimeAuthorityTransitionHistoryEntry {
  readonly state: RuntimeAuthorityTransitionState;
  readonly at: string;
}

export interface RuntimeAuthorityTransitionRecord {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly transitionId: string;
  /** Absent on records written before C.2B.9b — treat as `"relocation"`. */
  readonly kind?: RuntimeAuthorityTransitionKind;
  readonly state: RuntimeAuthorityTransitionState;
  readonly source: RuntimeAuthorityEndpoint;
  readonly target: RuntimeAuthorityEndpoint;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly RuntimeAuthorityTransitionHistoryEntry[];
  /** `recovery` only — why authority was forcibly moved. */
  readonly recoveryReason?: string;
  /** `rollback` only — the forward transitionId being reversed + the token used. */
  readonly rollbackOf?: string;
  readonly rollbackTokenId?: string;
  /** Recorded at `prepared` — the frozen source project inventory. */
  readonly sourceFreeze?: {
    readonly projectSlugs: readonly string[];
    readonly inventoryDigest: string;
    /** Per-file SHA-256 digest of the whole projects tree (F3 byte-exact). */
    readonly contentDigest?: string;
    readonly fileCount?: number;
    /**
     * F17-B — the verified `projectId ↔ projectSlug` map (from the migration
     * candidate manifest's `sourceProjectIdentities`), sorted by `projectId`.
     * When present, `validateTarget` compares the target by **logical project
     * identity** rather than physical folder name, and `logicalContentDigest`
     * is the F3 digest computed over identity-canonicalised paths.
     */
    readonly projectIdentities?: readonly { readonly projectId: string; readonly projectSlug: string }[];
    readonly logicalContentDigest?: string;
    readonly logicalFileCount?: number;
    readonly frozenAt: string;
  };
  /** Recorded at `quiesced`. */
  readonly quiescence?: {
    readonly workerLifecycleState: string;
    readonly durableRecovery: string;
    readonly confirmedAt: string;
  };
  /** Recorded at `target-validated`. */
  readonly targetValidation?: {
    readonly markerStatus: "absent" | "match";
    readonly targetProjectSlugs: readonly string[];
    readonly byteExact?: boolean;
    readonly validatedAt: string;
  };
  /** Recorded at `failed`. */
  readonly failure?: { readonly reason: string; readonly failedAt: string };
}

export interface RuntimeAuthorityActiveRecord {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly transitionSequence: number;
  readonly transitionId: string;
  readonly authorityGeneration: string;
  readonly authorityIdentity: string;
  readonly resolverBindingIdentity: string;
  readonly activatedAt: string;
}

export interface RuntimeAuthorityQuarantineRecord {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly transitionId: string;
  readonly authorityGeneration: string;
  readonly authorityIdentity: string;
  readonly resolverBindingIdentity: string;
  readonly quarantinedAt: string;
}

/* --------------------------------------------------- C.2B.11 record types -- */

const ROLLBACK_TOKEN_ID = /^rbt-[0-9a-f]{48}$/;

/**
 * C.2B.11 — the append-once evidence that a retired root's `projects/` tree was
 * put behind an OS read-only barrier (Windows FILE_ATTRIBUTE_READONLY on every
 * regular file). `mode` names the mechanism so a future platform can widen it.
 */
export interface RuntimeAuthorityQuarantineEnforcementRecord {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly transitionId: string;
  readonly resolverBindingIdentity: string;
  readonly mode: "windows-readonly-attribute";
  readonly readOnlyFileCount: number;
  readonly contentDigest: string;
  readonly enforcedAt: string;
}

/**
 * C.2B.11 — the single-use rollback authorization. Bound to EXACTLY one
 * authority generation, one forward transition, one source (old) root, one
 * target (new) root and one `transitionSequence`. Durable + append-once; it can
 * never be replayed or re-pointed. It authorizes ONLY the reverse transition —
 * not runtime startup, worker execution, candidate consume, or standing in for
 * `active-authority.json` / the generation marker.
 */
export interface RuntimeAuthorityRollbackToken {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly tokenId: string;
  readonly transitionId: string;
  readonly authorityGeneration: string;
  readonly sourceResolverBindingIdentity: string;
  readonly sourceAuthorityIdentity: string;
  readonly targetResolverBindingIdentity: string;
  readonly targetAuthorityIdentity: string;
  readonly transitionSequence: number;
  readonly sourceContentDigest: string;
  readonly issuedAt: string;
}

/** Append-once: the rollback token has been spent by a rollback transition. */
export interface RuntimeAuthorityRollbackTokenConsumption {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly tokenId: string;
  readonly rollbackTransitionId: string;
  readonly consumedAt: string;
}

/** Append-once: a quarantined old root has been re-activated by a valid rollback. */
export interface RuntimeAuthorityQuarantineLiftRecord {
  readonly schemaVersion: typeof runtimeAuthorityTransitionSchemaVersion;
  readonly resolverBindingIdentity: string;
  readonly rollbackTransitionId: string;
  readonly rollbackTokenId: string;
  readonly liftedAt: string;
}

export function isValidRuntimeAuthorityRollbackTokenId(value: unknown): value is string {
  return typeof value === "string" && ROLLBACK_TOKEN_ID.test(value);
}

export function isValidRuntimeAuthorityTransitionId(value: unknown): value is string {
  return typeof value === "string" && TRANSITION_ID.test(value);
}

export function nextRuntimeAuthorityTransitionState(
  current: RuntimeAuthorityTransitionState,
  next: RuntimeAuthorityTransitionState,
): boolean {
  return (FORWARD[current] ?? []).includes(next);
}

export function endpointFromIdentityFields(
  fields: RuntimeAuthorityIdentityFields,
): RuntimeAuthorityEndpoint {
  return {
    authorityGeneration: fields.authorityGeneration,
    authorityIdentity: fields.authorityIdentity,
    resolverBindingIdentity: fields.resolverBindingIdentity,
  };
}

/* --------------------------------------------------------------- store ----- */

export class RuntimeAuthorityTransitionStore {
  private readonly root: string;
  private readonly now: () => string;

  constructor(options: { authorityRoot: string; now?: () => string }) {
    const authorityRoot = path.resolve(options.authorityRoot);
    validateSafeAncestorChain(authorityRoot);
    this.root = path.join(authorityRoot, runtimeAuthorityTransitionDirectoryName);
    assertPathContained(authorityRoot, this.root);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get directory(): string {
    return this.root;
  }

  readActiveAuthority(): RuntimeAuthorityActiveRecord | null {
    const value = this.readJson(path.join(this.root, "active-authority.json"));
    if (value === null) return null;
    if (!isActiveRecord(value)) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_RECORD_CORRUPT",
        "active-authority.json",
      );
    }
    return value;
  }

  readTransition(transitionId: string): RuntimeAuthorityTransitionRecord | null {
    this.requireTransitionId(transitionId);
    const value = this.readJson(this.transitionPath(transitionId));
    if (value === null) return null;
    if (!isTransitionRecord(value)) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_RECORD_CORRUPT",
        `transitions/${transitionId}.json`,
      );
    }
    return value;
  }

  listTransitions(): readonly RuntimeAuthorityTransitionRecord[] {
    const directory = path.join(this.root, "transitions");
    let names: string[];
    try {
      names = fs.readdirSync(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_UNSAFE", "transitions/");
    }
    const records: RuntimeAuthorityTransitionRecord[] = [];
    for (const name of names.sort()) {
      const match = /^([a-zA-Z0-9][a-zA-Z0-9._:-]{7,127})\.json$/.exec(name);
      if (!match) continue;
      const record = this.readTransition(match[1]);
      if (record) records.push(record);
    }
    return records;
  }

  readQuarantine(
    resolverBindingIdentity: string,
  ): RuntimeAuthorityQuarantineRecord | null {
    if (!BINDING_DIGEST.test(resolverBindingIdentity)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "binding digest");
    }
    const value = this.readJson(this.quarantinePath(resolverBindingIdentity));
    if (value === null) return null;
    if (!isQuarantineRecord(value)) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_RECORD_CORRUPT",
        `quarantine/${resolverBindingIdentity}.json`,
      );
    }
    return value;
  }

  /** Create-or-update a transition record atomically (temp → fsync → rename). */
  writeTransition(
    record: RuntimeAuthorityTransitionRecord,
  ): RuntimeAuthorityTransitionRecord {
    this.requireTransitionId(record.transitionId);
    if (!isTransitionRecord(record)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "record shape");
    }
    this.writeJsonAtomic(this.transitionPath(record.transitionId), record);
    const readback = this.readTransition(record.transitionId);
    if (!readback || readback.state !== record.state) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", "readback");
    }
    return readback;
  }

  /** Append-once quarantine mark (`flag: "wx"`). Idempotent for the same transition. */
  writeQuarantine(
    record: RuntimeAuthorityQuarantineRecord,
  ): RuntimeAuthorityQuarantineRecord {
    if (!isQuarantineRecord(record)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "quarantine shape");
    }
    const target = this.quarantinePath(record.resolverBindingIdentity);
    const existing = this.readQuarantine(record.resolverBindingIdentity);
    if (existing) {
      if (existing.transitionId !== record.transitionId) {
        throw new RuntimeAuthorityTransitionError(
          "TRANSITION_CAS_CONFLICT",
          "root already quarantined by a different transition",
        );
      }
      return existing;
    }
    this.ensureDirectory(path.dirname(target));
    try {
      fs.writeFileSync(target, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        return this.readQuarantine(record.resolverBindingIdentity)!;
      }
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", "quarantine");
    }
    return this.readQuarantine(record.resolverBindingIdentity)!;
  }

  /* ------------------------------------------------- C.2B.11 store ops --- */

  readQuarantineEnforcement(
    resolverBindingIdentity: string,
  ): RuntimeAuthorityQuarantineEnforcementRecord | null {
    this.requireBindingDigest(resolverBindingIdentity);
    const value = this.readJson(
      path.join(this.root, "quarantine-enforcement", `${resolverBindingIdentity}.json`),
    );
    if (value === null) return null;
    if (!isQuarantineEnforcementRecord(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", "quarantine-enforcement");
    }
    return value;
  }

  writeQuarantineEnforcement(
    record: RuntimeAuthorityQuarantineEnforcementRecord,
  ): RuntimeAuthorityQuarantineEnforcementRecord {
    if (!isQuarantineEnforcementRecord(record)) {
      throw new RuntimeAuthorityTransitionError("QUARANTINE_ENFORCEMENT_INPUT_INVALID", "shape");
    }
    return this.appendOnce(
      path.join(this.root, "quarantine-enforcement", `${record.resolverBindingIdentity}.json`),
      record,
      (existing) =>
        (existing as RuntimeAuthorityQuarantineEnforcementRecord).transitionId === record.transitionId &&
        (existing as RuntimeAuthorityQuarantineEnforcementRecord).contentDigest === record.contentDigest,
      isQuarantineEnforcementRecord,
      "quarantine-enforcement",
    );
  }

  readQuarantineLift(
    resolverBindingIdentity: string,
  ): RuntimeAuthorityQuarantineLiftRecord | null {
    this.requireBindingDigest(resolverBindingIdentity);
    const value = this.readJson(
      path.join(this.root, "quarantine-lift", `${resolverBindingIdentity}.json`),
    );
    if (value === null) return null;
    if (!isQuarantineLiftRecord(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", "quarantine-lift");
    }
    return value;
  }

  writeQuarantineLift(
    record: RuntimeAuthorityQuarantineLiftRecord,
  ): RuntimeAuthorityQuarantineLiftRecord {
    if (!isQuarantineLiftRecord(record)) {
      throw new RuntimeAuthorityTransitionError("QUARANTINE_ENFORCEMENT_INPUT_INVALID", "lift shape");
    }
    return this.appendOnce(
      path.join(this.root, "quarantine-lift", `${record.resolverBindingIdentity}.json`),
      record,
      (existing) =>
        (existing as RuntimeAuthorityQuarantineLiftRecord).rollbackTokenId === record.rollbackTokenId,
      isQuarantineLiftRecord,
      "quarantine-lift",
    );
  }

  readRollbackToken(tokenId: string): RuntimeAuthorityRollbackToken | null {
    if (!isValidRuntimeAuthorityRollbackTokenId(tokenId)) {
      throw new RuntimeAuthorityTransitionError("ROLLBACK_TOKEN_INPUT_INVALID", "tokenId");
    }
    const value = this.readJson(path.join(this.root, "rollback-tokens", `${tokenId}.json`));
    if (value === null) return null;
    if (!isRollbackToken(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", "rollback-token");
    }
    return value;
  }

  listRollbackTokens(): readonly RuntimeAuthorityRollbackToken[] {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(this.root, "rollback-tokens"));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_UNSAFE", "rollback-tokens/");
    }
    const out: RuntimeAuthorityRollbackToken[] = [];
    for (const name of names.sort()) {
      const match = /^(rbt-[0-9a-f]{48})\.json$/.exec(name);
      if (!match) continue;
      const token = this.readRollbackToken(match[1]);
      if (token) out.push(token);
    }
    return out;
  }

  writeRollbackToken(record: RuntimeAuthorityRollbackToken): RuntimeAuthorityRollbackToken {
    if (!isRollbackToken(record)) {
      throw new RuntimeAuthorityTransitionError("ROLLBACK_TOKEN_INPUT_INVALID", "shape");
    }
    // One token per forward transition — reject a second token for the same transitionId.
    for (const existing of this.listRollbackTokens()) {
      if (existing.transitionId === record.transitionId && existing.tokenId !== record.tokenId) {
        throw new RuntimeAuthorityTransitionError("ROLLBACK_TOKEN_ALREADY_ISSUED", record.transitionId);
      }
    }
    return this.appendOnce(
      path.join(this.root, "rollback-tokens", `${record.tokenId}.json`),
      record,
      () => true,
      isRollbackToken,
      "rollback-token",
    );
  }

  readRollbackTokenConsumption(
    tokenId: string,
  ): RuntimeAuthorityRollbackTokenConsumption | null {
    if (!isValidRuntimeAuthorityRollbackTokenId(tokenId)) {
      throw new RuntimeAuthorityTransitionError("ROLLBACK_TOKEN_INPUT_INVALID", "tokenId");
    }
    const value = this.readJson(
      path.join(this.root, "rollback-tokens", `${tokenId}.consumed.json`),
    );
    if (value === null) return null;
    if (!isRollbackTokenConsumption(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", "rollback-token-consumption");
    }
    return value;
  }

  writeRollbackTokenConsumption(
    record: RuntimeAuthorityRollbackTokenConsumption,
  ): RuntimeAuthorityRollbackTokenConsumption {
    if (!isRollbackTokenConsumption(record)) {
      throw new RuntimeAuthorityTransitionError("ROLLBACK_TOKEN_INPUT_INVALID", "consumption shape");
    }
    return this.appendOnce(
      path.join(this.root, "rollback-tokens", `${record.tokenId}.consumed.json`),
      record,
      (existing) =>
        (existing as RuntimeAuthorityRollbackTokenConsumption).rollbackTransitionId ===
        record.rollbackTransitionId,
      isRollbackTokenConsumption,
      "rollback-token-consumption",
    );
  }

  /**
   * Compare-and-set the single active-authority pointer.
   *
   * `expectedPreviousBindingIdentity`:
   *   - `null` → `active-authority.json` must be ABSENT (first transition ever).
   *   - a digest → the current record's `resolverBindingIdentity` must equal it.
   *
   * Idempotent: if the current record is already exactly `record`
   * (same transitionId + binding), returns it unchanged.
   */
  publishActiveAuthority(
    record: RuntimeAuthorityActiveRecord,
    expectedPreviousBindingIdentity: string | null,
  ): RuntimeAuthorityActiveRecord {
    if (!isActiveRecord(record)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "active record shape");
    }
    const current = this.readActiveAuthority();
    if (
      current &&
      current.transitionId === record.transitionId &&
      current.resolverBindingIdentity === record.resolverBindingIdentity &&
      current.transitionSequence === record.transitionSequence
    ) {
      return current;
    }
    if (expectedPreviousBindingIdentity === null) {
      if (current) {
        throw new RuntimeAuthorityTransitionError(
          "TRANSITION_CAS_CONFLICT",
          "an active authority already exists",
        );
      }
    } else {
      if (
        !current ||
        current.resolverBindingIdentity !== expectedPreviousBindingIdentity
      ) {
        throw new RuntimeAuthorityTransitionError(
          "TRANSITION_CAS_CONFLICT",
          "active authority is not the expected previous authority",
        );
      }
      if (current.transitionSequence + 1 !== record.transitionSequence) {
        throw new RuntimeAuthorityTransitionError(
          "TRANSITION_CAS_CONFLICT",
          "transition sequence is not monotonic",
        );
      }
    }
    this.writeJsonAtomic(path.join(this.root, "active-authority.json"), record);
    const readback = this.readActiveAuthority();
    if (
      !readback ||
      readback.resolverBindingIdentity !== record.resolverBindingIdentity ||
      readback.transitionId !== record.transitionId
    ) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", "active-authority readback");
    }
    return readback;
  }

  clock(): string {
    return this.now();
  }

  /* ---------------------------------------------------------- internals --- */

  private transitionPath(transitionId: string): string {
    return path.join(this.root, "transitions", `${transitionId}.json`);
  }

  private quarantinePath(resolverBindingIdentity: string): string {
    return path.join(this.root, "quarantine", `${resolverBindingIdentity}.json`);
  }

  private requireTransitionId(value: string): void {
    if (!isValidRuntimeAuthorityTransitionId(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "transitionId");
    }
  }

  private requireBindingDigest(value: string): void {
    if (!BINDING_DIGEST.test(value)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_INPUT_INVALID", "binding digest");
    }
  }

  /** Append-once write (`flag: "wx"`); idempotent when the existing record matches. */
  private appendOnce<T>(
    target: string,
    record: T,
    matches: (existing: unknown) => boolean,
    isValid: (value: unknown) => value is T,
    label: string,
  ): T {
    const existing = this.readJson(target);
    if (existing !== null) {
      if (!isValid(existing)) {
        throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", label);
      }
      if (!matches(existing)) {
        throw new RuntimeAuthorityTransitionError(
          "TRANSITION_CAS_CONFLICT",
          `${label} already written with a different binding`,
        );
      }
      return existing;
    }
    this.ensureDirectory(path.dirname(target));
    try {
      fs.writeFileSync(target, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        const raced = this.readJson(target);
        if (isValid(raced) && matches(raced)) return raced;
        throw new RuntimeAuthorityTransitionError("TRANSITION_CAS_CONFLICT", label);
      }
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", label);
    }
    const readback = this.readJson(target);
    if (!isValid(readback) || !matches(readback)) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", `${label} readback`);
    }
    return readback;
  }

  private readJson(filePath: string): unknown {
    let link: fs.Stats;
    try {
      link = fs.lstatSync(filePath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return null;
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_UNSAFE", filePath);
    }
    if (
      link.isSymbolicLink() ||
      !link.isFile() ||
      link.size <= 0 ||
      link.size > MAX_RECORD_BYTES
    ) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_UNSAFE", filePath);
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      throw new RuntimeAuthorityTransitionError("TRANSITION_RECORD_CORRUPT", filePath);
    }
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_RECORD_BYTES) {
      throw new RuntimeAuthorityTransitionError("TRANSITION_WRITE_FAILED", "record too large");
    }
    this.ensureDirectory(path.dirname(filePath));
    const temporary = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      const handle = fs.openSync(temporary, "wx", 0o600);
      try {
        fs.writeFileSync(handle, serialized, "utf8");
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(temporary, filePath);
    } catch (error) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        /* best effort */
      }
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private ensureDirectory(directory: string): void {
    assertPathContained(path.dirname(this.root), this.root);
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_WRITE_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function runtimeAuthorityInventoryDigest(
  projectSlugs: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([...projectSlugs].sort()))
    .digest("hex");
}

export function resolveRuntimeAuthorityTransitionKind(
  record: Pick<RuntimeAuthorityTransitionRecord, "kind">,
): RuntimeAuthorityTransitionKind {
  return record.kind ?? "relocation";
}

export interface RuntimeAuthorityProjectsContent {
  readonly contentDigest: string;
  readonly fileCount: number;
}

export interface RuntimeAuthorityProjectsContentOptions {
  /**
   * F17-B — canonicalise the **first path segment** (the project folder name) of
   * every non-top-level file to its logical project identity, so a slug-layout
   * repo source and a `projectId`-layout migration target that hold the SAME
   * logical projects produce the SAME digest.
   *
   * Applied only to directory-first-segments; top-level files (`hunlar.json`, …)
   * are hashed verbatim. It runs AFTER the symlink / non-regular-file rejection
   * and AFTER the F16-A transient exclusion (which use the physical path), so it
   * is never a security or exclusion bypass. Returning the segment unchanged is
   * allowed — the caller's project-identity set check is what fails closed on an
   * unmapped / unknown folder.
   */
  readonly remapProjectFolder?: (folderName: string) => string;
}

/**
 * Deterministic per-file SHA-256 digest of an entire `projects/` tree — the
 * evidence a controlled relocation copied **byte for byte** (F3). Rejects any
 * symlink / junction / non-regular file. Returns a single digest over the
 * sorted list of `relativePosixPath\0sha256\0size` lines plus the file count.
 * With `remapProjectFolder` the `relativePosixPath` is the **logical** one
 * (F17-B), never a physical `slug/…` vs `projectId/…` difference.
 */
export function runtimeAuthorityProjectsContentDigest(
  projectsRoot: string,
  options: RuntimeAuthorityProjectsContentOptions = {},
): RuntimeAuthorityProjectsContent {
  const root = path.resolve(projectsRoot);
  validateSafeAncestorChain(root);
  const lines: string[] = [];
  walkContent(root, root, lines, options.remapProjectFolder);
  lines.sort();
  return {
    contentDigest: createHash("sha256").update(lines.join("\n")).digest("hex"),
    fileCount: lines.length,
  };
}

function walkContent(
  root: string,
  dir: string,
  out: string[],
  remapProjectFolder?: (folderName: string) => string,
): void {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    // The authority-generation marker is authority metadata, not project data —
    // it is re-stamped at publish, so it never counts toward the byte digest.
    if (dir === root && entry.name === runtimeAuthorityGenerationMarkerFileName) {
      continue;
    }
    const full = path.join(dir, entry.name);
    assertPathContained(root, full);
    const link = fs.lstatSync(full);
    if (link.isSymbolicLink()) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_CONTENT_UNSAFE",
        `symlink under projects tree: ${path.relative(root, full)}`,
      );
    }
    if (link.isDirectory()) {
      walkContent(root, full, out, remapProjectFolder);
      continue;
    }
    if (!link.isFile()) {
      throw new RuntimeAuthorityTransitionError(
        "TRANSITION_CONTENT_UNSAFE",
        `non-regular file under projects tree: ${path.relative(root, full)}`,
      );
    }
    const segments = path.relative(root, full).split(path.sep);
    const rel = segments.join("/");
    // F16-A — EXCLUDE-SAFE: `.audio-journal-staging/*.partial` atomic-write
    // staging and `.pipeline-jobs.*` process-local coordination files are inert
    // — never authority, never a durable record. `collectRuntimeBackupInventory`
    // (and therefore the backup / candidate / consumed target) excludes them by
    // the same predicate, so the source freeze and the target digest agree.
    // The symlink / non-regular-file rejection above is unaffected. This uses the
    // PHYSICAL path — the F17-B remap below never changes an exclusion decision.
    if (isRuntimeTransientExcludedRelativePath(rel)) {
      continue;
    }
    // F17-B — canonicalise the project folder name to its logical identity.
    const logicalRel = remapProjectFolder && segments.length > 1
      ? [remapProjectFolder(segments[0]), ...segments.slice(1)].join("/")
      : rel;
    const sha = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    out.push(`${logicalRel}\0${sha}\0${link.size}`);
  }
}

/* --------------------------------------------------------------- shapes ---- */

function isEndpoint(value: unknown): value is RuntimeAuthorityEndpoint {
  if (!isRecord(value)) return false;
  return (
    typeof value.authorityGeneration === "string" &&
    typeof value.authorityIdentity === "string" &&
    BINDING_DIGEST.test(String(value.authorityIdentity)) &&
    typeof value.resolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.resolverBindingIdentity))
  );
}

function isTransitionRecord(
  value: unknown,
): value is RuntimeAuthorityTransitionRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    isValidRuntimeAuthorityTransitionId(value.transitionId) &&
    (value.kind === undefined ||
      value.kind === "relocation" ||
      value.kind === "genesis" ||
      value.kind === "recovery" ||
      value.kind === "rollback") &&
    (value.rollbackOf === undefined || isValidRuntimeAuthorityTransitionId(value.rollbackOf)) &&
    (value.rollbackTokenId === undefined ||
      isValidRuntimeAuthorityRollbackTokenId(value.rollbackTokenId)) &&
    typeof value.state === "string" &&
    value.state in FORWARD &&
    isEndpoint(value.source) &&
    isEndpoint(value.target) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.history) &&
    value.history.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.state === "string" &&
        entry.state in FORWARD &&
        typeof entry.at === "string",
    )
  );
}

function isActiveRecord(value: unknown): value is RuntimeAuthorityActiveRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    Number.isSafeInteger(value.transitionSequence) &&
    (value.transitionSequence as number) >= 1 &&
    isValidRuntimeAuthorityTransitionId(value.transitionId) &&
    typeof value.authorityGeneration === "string" &&
    typeof value.authorityIdentity === "string" &&
    BINDING_DIGEST.test(String(value.authorityIdentity)) &&
    typeof value.resolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.resolverBindingIdentity)) &&
    typeof value.activatedAt === "string"
  );
}

function isQuarantineRecord(
  value: unknown,
): value is RuntimeAuthorityQuarantineRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    isValidRuntimeAuthorityTransitionId(value.transitionId) &&
    typeof value.authorityGeneration === "string" &&
    typeof value.authorityIdentity === "string" &&
    BINDING_DIGEST.test(String(value.authorityIdentity)) &&
    typeof value.resolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.resolverBindingIdentity)) &&
    typeof value.quarantinedAt === "string"
  );
}

function isQuarantineEnforcementRecord(
  value: unknown,
): value is RuntimeAuthorityQuarantineEnforcementRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    isValidRuntimeAuthorityTransitionId(value.transitionId) &&
    typeof value.resolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.resolverBindingIdentity)) &&
    value.mode === "windows-readonly-attribute" &&
    Number.isSafeInteger(value.readOnlyFileCount) &&
    (value.readOnlyFileCount as number) >= 0 &&
    typeof value.contentDigest === "string" &&
    BINDING_DIGEST.test(String(value.contentDigest)) &&
    typeof value.enforcedAt === "string"
  );
}

function isQuarantineLiftRecord(
  value: unknown,
): value is RuntimeAuthorityQuarantineLiftRecord {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    typeof value.resolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.resolverBindingIdentity)) &&
    isValidRuntimeAuthorityTransitionId(value.rollbackTransitionId) &&
    isValidRuntimeAuthorityRollbackTokenId(value.rollbackTokenId) &&
    typeof value.liftedAt === "string"
  );
}

function isRollbackToken(value: unknown): value is RuntimeAuthorityRollbackToken {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    isValidRuntimeAuthorityRollbackTokenId(value.tokenId) &&
    isValidRuntimeAuthorityTransitionId(value.transitionId) &&
    typeof value.authorityGeneration === "string" &&
    typeof value.sourceResolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.sourceResolverBindingIdentity)) &&
    typeof value.sourceAuthorityIdentity === "string" &&
    BINDING_DIGEST.test(String(value.sourceAuthorityIdentity)) &&
    typeof value.targetResolverBindingIdentity === "string" &&
    BINDING_DIGEST.test(String(value.targetResolverBindingIdentity)) &&
    typeof value.targetAuthorityIdentity === "string" &&
    BINDING_DIGEST.test(String(value.targetAuthorityIdentity)) &&
    Number.isSafeInteger(value.transitionSequence) &&
    (value.transitionSequence as number) >= 1 &&
    typeof value.sourceContentDigest === "string" &&
    BINDING_DIGEST.test(String(value.sourceContentDigest)) &&
    typeof value.issuedAt === "string"
  );
}

function isRollbackTokenConsumption(
  value: unknown,
): value is RuntimeAuthorityRollbackTokenConsumption {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === runtimeAuthorityTransitionSchemaVersion &&
    isValidRuntimeAuthorityRollbackTokenId(value.tokenId) &&
    isValidRuntimeAuthorityTransitionId(value.rollbackTransitionId) &&
    typeof value.consumedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function messageFor(code: RuntimeAuthorityTransitionErrorCode): string {
  switch (code) {
    case "TRANSITION_RECORD_CORRUPT":
      return "Runtime authority transition record is corrupt.";
    case "TRANSITION_RECORD_UNSAFE":
      return "Runtime authority transition record failed the link/size policy.";
    case "TRANSITION_ILLEGAL_STATE":
      return "Runtime authority transition state change is not allowed.";
    case "TRANSITION_IDENTITY_MISMATCH":
      return "Runtime authority transition endpoint identity does not match.";
    case "TRANSITION_CAS_CONFLICT":
      return "Runtime authority transition lost a compare-and-set.";
    case "TRANSITION_WRITE_FAILED":
      return "Runtime authority transition record could not be written.";
    case "TRANSITION_SOURCE_UNMARKED":
      return "Runtime authority transition source root carries no authority-generation marker.";
    case "TRANSITION_SOURCE_MARKED":
      return "Runtime authority genesis transition source root already carries a marker.";
    case "TRANSITION_SOURCE_QUARANTINED":
      return "Runtime authority transition source root is already quarantined.";
    case "TRANSITION_TARGET_QUARANTINED":
      return "Runtime authority transition target root is quarantined.";
    case "TRANSITION_ALREADY_ACTIVE_ELSEWHERE":
      return "Runtime authority transition source is not the active production authority.";
    case "TRANSITION_NO_ACTIVE_AUTHORITY":
      return "Runtime authority recovery transition needs a published active authority to recover from.";
    case "TRANSITION_QUIESCENCE_WORKER_ACTIVE":
      return "Runtime authority transition cannot quiesce while the production worker is active.";
    case "TRANSITION_QUIESCENCE_NOT_CLEAN":
      return "Runtime authority transition cannot quiesce while durable recovery is not clean.";
    case "TRANSITION_TARGET_INVENTORY_MISMATCH":
      return "Runtime authority transition target project inventory does not match the frozen source.";
    case "TRANSITION_TARGET_CONTENT_MISMATCH":
      return "Runtime authority transition target projects tree is not a byte-exact copy of the frozen source.";
    case "TRANSITION_CONTENT_UNSAFE":
      return "Runtime authority transition projects tree contains an unsafe path.";
    case "TRANSITION_SOURCE_IDENTITY_MISSING":
      return "Runtime authority transition source project folder has no entry in the verified project identity map.";
    case "TRANSITION_TARGET_IDENTITY_UNKNOWN":
      return "Runtime authority transition target project folder is not a known project identity.";
    case "TRANSITION_IDENTITY_BINDING_MISMATCH":
      return "Runtime authority transition project identity map does not match the one frozen at prepare.";
    case "ROLLBACK_TOKEN_INPUT_INVALID":
      return "Runtime authority rollback token input is invalid.";
    case "ROLLBACK_TOKEN_MISMATCH":
      return "Runtime authority rollback token does not match the stored token.";
    case "ROLLBACK_TOKEN_ALREADY_ISSUED":
      return "Runtime authority rollback token was already issued for this transition.";
    case "ROLLBACK_TOKEN_ALREADY_CONSUMED":
      return "Runtime authority rollback token has already been consumed.";
    case "QUARANTINE_ENFORCEMENT_INPUT_INVALID":
      return "Runtime authority quarantine enforcement record is invalid.";
    default:
      return "Runtime authority transition input is invalid.";
  }
}
