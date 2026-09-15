import fs from "node:fs";
import path from "node:path";

/**
 * Structural production-root isolation. Package C's `gateRoot` was
 * previously `CALLER_CONVENTION_ONLY` — nothing prevented a caller from
 * passing the real production path. This module makes that a
 * construction-time failure instead: `createAyasIsolatedGateRoot` is the
 * only way to obtain the branded `AyasIsolatedGateRoot` type, and it
 * refuses to return one for the real production root or any path that
 * canonically resolves to it (relative spellings, `.`/`..` segments,
 * trailing slashes, case differences on case-insensitive filesystems, or a
 * symlink/junction pointing at it). This module has no dependency on the
 * approval store, the daemon, the gate, or the execution lock.
 */
export type AyasIsolatedGateRoot = string & { readonly __ayasIsolatedGateRootBrand: unique symbol };

export class AyasGateRootIsolationError extends Error {
  constructor(readonly code: "AYAS_GATE_ROOT_IS_PRODUCTION", message: string) {
    super(message);
    this.name = "AyasGateRootIsolationError";
    this.stack = undefined;
  }
}

/** The real production gate root — the one path Package C development/testing must never be able to use. */
export function resolveAyasProductionGateRoot(): string {
  return path.resolve(process.cwd(), "data", "brain");
}

function canonicalize(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    // Resolves symlinks/junctions too, catching an aliasing attempt via a
    // link that merely points at the production root.
    return fs.realpathSync.native(resolved);
  } catch {
    // The path doesn't exist yet (the common case for a fresh isolated test
    // root) — fall back to the resolved string form. Windows filesystems
    // compare paths case-insensitively by convention.
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }
}

/**
 * The only way to obtain an `AyasIsolatedGateRoot`. Throws
 * `AyasGateRootIsolationError` (fail-closed) if `candidate` canonically
 * resolves to the real production gate root.
 */
export function createAyasIsolatedGateRoot(candidate: string): AyasIsolatedGateRoot {
  const canonicalCandidate = canonicalize(candidate);
  const canonicalProduction = canonicalize(resolveAyasProductionGateRoot());
  if (canonicalCandidate === canonicalProduction) {
    throw new AyasGateRootIsolationError(
      "AYAS_GATE_ROOT_IS_PRODUCTION",
      "refusing to use the real production gate root — Package C development/testing must use an isolated root",
    );
  }
  return path.resolve(candidate) as AyasIsolatedGateRoot;
}
