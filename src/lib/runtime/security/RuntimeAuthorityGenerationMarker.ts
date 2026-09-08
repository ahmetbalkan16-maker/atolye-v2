import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  assertPathContained,
  assertTrustedRuntimeStorageContext,
  runtimeStorageLogicalProjectsRoot,
  runtimeStoragePolicyVersion,
  validateSafeAncestorChain,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";

/**
 * Runtime authority-generation marker (C.2B.6 / C.2B.9 foundation).
 *
 * A single, append-once JSON file that stamps a runtime storage root with the
 * authority *generation* it belongs to. It is the primitive a future,
 * independently-reviewed relocation/cutover sprint (C.2B.9) wires into the
 * production composition root + recovery bootstrap so that:
 *
 *   - a process that boots against a runtime root whose marker names a
 *     DIFFERENT generation than the one it resolved fails closed, instead of
 *     silently reading/writing durable execution state (`production-execution/**`)
 *     across an authority boundary — the cross-restart half of the audit's D1
 *     "durable state split-brain" P0 (`docs/PRODUCTION_STORAGE_RELOCATION_AUDIT.md`).
 *
 * This module is deliberately NOT called from any live path yet. It only
 * writes when explicitly asked (operator tooling / the C.2B.9 sprint); an
 * absent marker is always "compatible" so the legacy in-repo default and every
 * existing external root keep working untouched. See
 * `docs/RUNTIME_AUTHORITY_GENERATION_BINDING.md`.
 */

export const runtimeAuthorityGenerationMarkerKind =
  "runtime-authority-generation-marker-v1";
export const runtimeAuthorityGenerationMarkerFileName =
  ".runtime-authority-generation.json";

const MAX_MARKER_BYTES = 4 * 1024;

export type RuntimeAuthorityGenerationMarkerErrorCode =
  | "RUNTIME_AUTHORITY_GENERATION_INVALID"
  | "RUNTIME_AUTHORITY_GENERATION_MISMATCH"
  | "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE"
  | "RUNTIME_AUTHORITY_GENERATION_WRITE_FAILED";

export class RuntimeAuthorityGenerationMarkerError extends Error {
  constructor(readonly code: RuntimeAuthorityGenerationMarkerErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeAuthorityGenerationMarkerError";
    this.stack = undefined;
  }
}

export interface RuntimeAuthorityGenerationMarker {
  readonly kind: typeof runtimeAuthorityGenerationMarkerKind;
  readonly storagePolicyVersion: typeof runtimeStoragePolicyVersion;
  readonly authorityGeneration: string;
  readonly authorityIdentity: string;
  readonly resolverBindingIdentity: string;
  readonly logicalProjectsRoot: typeof runtimeStorageLogicalProjectsRoot;
  readonly writtenAt: string;
}

export type RuntimeAuthorityGenerationMarkerStatus =
  | "written"
  | "match"
  | "absent";

export interface RuntimeAuthorityGenerationMarkerResult {
  readonly status: RuntimeAuthorityGenerationMarkerStatus;
  readonly markerPath: string;
  readonly marker?: RuntimeAuthorityGenerationMarker;
}

export interface RuntimeAuthorityGenerationMarkerInput {
  readonly context: RuntimeStorageContext;
  readonly authorityGeneration: string;
  /** ISO timestamp; injectable for deterministic tests. Defaults to now. */
  readonly now?: string;
}

export type RuntimeAuthorityIdentityFields = Omit<
  RuntimeAuthorityGenerationMarker,
  "writtenAt"
>;

/**
 * The identity a runtime storage context resolves to for a given authority
 * generation — the same fields the marker carries. `authorityIdentity` keys on
 * the projects root; `resolverBindingIdentity` keys on the whole resolver
 * binding (workspace / runtime / projects / legacy / authority roots). Used by
 * the C.2B.9 authority-transition control plane to name source / target
 * authorities without re-deriving the digests.
 */
export function describeRuntimeAuthorityIdentity(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): RuntimeAuthorityIdentityFields {
  assertTrustedContext(context);
  return expectedMarkerFields(context, requireGeneration(authorityGeneration));
}

/** The marker path for a runtime root — a sibling of the project directories. */
export function resolveRuntimeAuthorityGenerationMarkerPath(
  context: RuntimeStorageContext,
): string {
  assertTrustedContext(context);
  const projectsRoot = path.resolve(context.projectsRoot);
  const markerPath = path.join(
    projectsRoot,
    runtimeAuthorityGenerationMarkerFileName,
  );
  assertPathContained(projectsRoot, markerPath);
  return markerPath;
}

/**
 * Read-only. Never mutates. Returns:
 *   - `absent` when no marker exists (legacy / not yet stamped — compatible)
 *   - `match` when the marker names this exact authority + generation
 * Throws `RUNTIME_AUTHORITY_GENERATION_MISMATCH` when a marker exists but names
 * a different authority identity, generation, resolver binding or policy.
 */
export function assertRuntimeAuthorityGenerationMarkerCompatible(
  input: RuntimeAuthorityGenerationMarkerInput,
): RuntimeAuthorityGenerationMarkerResult {
  const { context } = input;
  assertTrustedContext(context);
  const authorityGeneration = requireGeneration(input.authorityGeneration);
  const markerPath = resolveRuntimeAuthorityGenerationMarkerPath(context);

  const existing = readMarkerFile(markerPath);
  if (existing === "absent") {
    return { status: "absent", markerPath };
  }

  const expected = expectedMarkerFields(context, authorityGeneration);
  if (
    existing.kind !== runtimeAuthorityGenerationMarkerKind ||
    existing.storagePolicyVersion !== expected.storagePolicyVersion ||
    existing.authorityGeneration !== expected.authorityGeneration ||
    existing.authorityIdentity !== expected.authorityIdentity ||
    existing.resolverBindingIdentity !== expected.resolverBindingIdentity ||
    existing.logicalProjectsRoot !== expected.logicalProjectsRoot
  ) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_MISMATCH",
    );
  }
  return { status: "match", markerPath, marker: existing };
}

/**
 * Append-once. If no marker exists, writes one atomically (create-or-fail) and
 * returns `written`. If a marker already exists and matches, returns `match`.
 * If it exists and diverges, throws `RUNTIME_AUTHORITY_GENERATION_MISMATCH` —
 * a marker is NEVER overwritten in place (that is a C.2B.9 versioned
 * transition, not this primitive).
 */
export function writeRuntimeAuthorityGenerationMarker(
  input: RuntimeAuthorityGenerationMarkerInput,
): RuntimeAuthorityGenerationMarkerResult {
  const { context } = input;
  assertTrustedContext(context);
  const authorityGeneration = requireGeneration(input.authorityGeneration);
  const markerPath = resolveRuntimeAuthorityGenerationMarkerPath(context);

  const projectsRoot = path.resolve(context.projectsRoot);
  validateSafeAncestorChain(projectsRoot);

  const compatibility = assertRuntimeAuthorityGenerationMarkerCompatible(input);
  if (compatibility.status === "match") return compatibility;

  const marker: RuntimeAuthorityGenerationMarker = Object.freeze({
    ...expectedMarkerFields(context, authorityGeneration),
    writtenAt: requireIsoTimestamp(input.now ?? new Date().toISOString()),
  });
  const serialized = `${JSON.stringify(marker)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_MARKER_BYTES) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_WRITE_FAILED",
    );
  }

  try {
    fs.writeFileSync(markerPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      // Lost a race: re-read and let the compatibility check decide.
      return assertRuntimeAuthorityGenerationMarkerCompatible(input);
    }
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_WRITE_FAILED",
    );
  }

  const readback = readMarkerFile(markerPath);
  if (
    readback === "absent" ||
    JSON.stringify(stripWrittenAt(readback)) !==
      JSON.stringify(stripWrittenAt(marker))
  ) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_WRITE_FAILED",
    );
  }
  return { status: "written", markerPath, marker };
}

/* --------------------------------------------------------------- internals --- */

function expectedMarkerFields(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): Omit<RuntimeAuthorityGenerationMarker, "writtenAt"> {
  return {
    kind: runtimeAuthorityGenerationMarkerKind,
    storagePolicyVersion: runtimeStoragePolicyVersion,
    authorityGeneration,
    authorityIdentity: digest(
      [runtimeStoragePolicyVersion, normalizedPath(context.projectsRoot)].join(
        "\0",
      ),
    ),
    resolverBindingIdentity: digest(
      [
        context.policyVersion,
        context.source,
        context.classification,
        normalizedPath(context.workspaceRoot),
        normalizedPath(context.runtimeRoot),
        normalizedPath(context.projectsRoot),
        normalizedPath(context.legacyProjectsRoot),
        normalizedPath(context.authorityRoot),
      ].join("\0"),
    ),
    logicalProjectsRoot: runtimeStorageLogicalProjectsRoot,
  };
}

function readMarkerFile(
  markerPath: string,
): RuntimeAuthorityGenerationMarker | "absent" {
  let link: fs.Stats;
  try {
    link = fs.lstatSync(markerPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "absent";
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE",
    );
  }
  if (link.isSymbolicLink() || !link.isFile() || link.size <= 0 ||
      link.size > MAX_MARKER_BYTES) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_INVALID",
    );
  }
  if (!isMarkerShape(parsed)) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_INVALID",
    );
  }
  return Object.freeze(parsed);
}

function isMarkerShape(value: unknown): value is RuntimeAuthorityGenerationMarker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === runtimeAuthorityGenerationMarkerKind &&
    record.storagePolicyVersion === runtimeStoragePolicyVersion &&
    typeof record.authorityGeneration === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(record.authorityGeneration) &&
    typeof record.authorityIdentity === "string" &&
    /^[0-9a-f]{64}$/.test(record.authorityIdentity) &&
    typeof record.resolverBindingIdentity === "string" &&
    /^[0-9a-f]{64}$/.test(record.resolverBindingIdentity) &&
    record.logicalProjectsRoot === runtimeStorageLogicalProjectsRoot &&
    typeof record.writtenAt === "string" &&
    !Number.isNaN(Date.parse(record.writtenAt))
  );
}

function stripWrittenAt(
  marker: RuntimeAuthorityGenerationMarker,
): Omit<RuntimeAuthorityGenerationMarker, "writtenAt"> {
  return {
    kind: marker.kind,
    storagePolicyVersion: marker.storagePolicyVersion,
    authorityGeneration: marker.authorityGeneration,
    authorityIdentity: marker.authorityIdentity,
    resolverBindingIdentity: marker.resolverBindingIdentity,
    logicalProjectsRoot: marker.logicalProjectsRoot,
  };
}

function assertTrustedContext(
  context: RuntimeStorageContext,
): asserts context is RuntimeStorageContext {
  try {
    assertTrustedRuntimeStorageContext(context);
  } catch {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_INVALID",
    );
  }
}

function requireGeneration(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
  ) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_INVALID",
    );
  }
  return value;
}

function requireIsoTimestamp(value: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RuntimeAuthorityGenerationMarkerError(
      "RUNTIME_AUTHORITY_GENERATION_INVALID",
    );
  }
  return value;
}

function normalizedPath(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function messageFor(code: RuntimeAuthorityGenerationMarkerErrorCode): string {
  switch (code) {
    case "RUNTIME_AUTHORITY_GENERATION_MISMATCH":
      return "Runtime authority generation marker names a different authority.";
    case "RUNTIME_AUTHORITY_GENERATION_MARKER_UNSAFE":
      return "Runtime authority generation marker failed the link/size policy.";
    case "RUNTIME_AUTHORITY_GENERATION_WRITE_FAILED":
      return "Runtime authority generation marker could not be written.";
    default:
      return "Runtime authority generation marker is invalid.";
  }
}
