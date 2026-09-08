import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  assertPathContained,
  validateSafeAncestorChain,
} from "@/lib/runtime/RuntimeStoragePaths";
import type { RuntimeAuthorityIdentityFields } from "./RuntimeAuthorityGenerationMarker";

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
  | "failed";

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
  | "TRANSITION_SOURCE_QUARANTINED"
  | "TRANSITION_ALREADY_ACTIVE_ELSEWHERE"
  | "TRANSITION_QUIESCENCE_WORKER_ACTIVE"
  | "TRANSITION_QUIESCENCE_NOT_CLEAN"
  | "TRANSITION_TARGET_INVENTORY_MISMATCH";

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
  readonly state: RuntimeAuthorityTransitionState;
  readonly source: RuntimeAuthorityEndpoint;
  readonly target: RuntimeAuthorityEndpoint;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly RuntimeAuthorityTransitionHistoryEntry[];
  /** Recorded at `prepared` — the frozen source project inventory. */
  readonly sourceFreeze?: {
    readonly projectSlugs: readonly string[];
    readonly inventoryDigest: string;
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
    case "TRANSITION_SOURCE_QUARANTINED":
      return "Runtime authority transition source root is already quarantined.";
    case "TRANSITION_ALREADY_ACTIVE_ELSEWHERE":
      return "Runtime authority transition source is not the active production authority.";
    case "TRANSITION_QUIESCENCE_WORKER_ACTIVE":
      return "Runtime authority transition cannot quiesce while the production worker is active.";
    case "TRANSITION_QUIESCENCE_NOT_CLEAN":
      return "Runtime authority transition cannot quiesce while durable recovery is not clean.";
    case "TRANSITION_TARGET_INVENTORY_MISMATCH":
      return "Runtime authority transition target project inventory does not match the frozen source.";
    default:
      return "Runtime authority transition input is invalid.";
  }
}
