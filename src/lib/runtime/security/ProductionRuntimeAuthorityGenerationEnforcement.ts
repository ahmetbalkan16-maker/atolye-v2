import fs from "node:fs";
import path from "node:path";
import type { RuntimeStorageContext } from "@/lib/runtime/RuntimeStoragePaths";
import {
  assertRuntimeAuthorityGenerationMarkerCompatible,
  resolveRuntimeAuthorityGenerationMarkerPath,
  RuntimeAuthorityGenerationMarkerError,
  writeRuntimeAuthorityGenerationMarker,
} from "./RuntimeAuthorityGenerationMarker";

/**
 * C.2B.6b — enforce the runtime authority *generation* at production startup and
 * recovery bootstrap.
 *
 * The single authoritative validation primitive between "canonical runtime
 * authority is resolved" and "the runtime is exposed for durable use". It
 * composes the append-once `RuntimeAuthorityGenerationMarker` primitive with the
 * §5/§6 production-root policy:
 *
 *   1. Production (`NODE_ENV === "production"`) with `ATOLYE_RUNTIME_ROOT` unset
 *      (`source === "legacy-default"`) → FAIL CLOSED. Production must name an
 *      explicit runtime root.
 *   2. Read the marker for `(projectsRoot, authorityGeneration)`:
 *        - `MISMATCH` → FAIL CLOSED (throws from the marker primitive). Startup
 *          does not complete, recovery does not run, durable state is not
 *          consumed, the legacy root is NOT used as a fallback, the marker is
 *          NEVER overwritten.
 *        - `match` → continue.
 *        - `absent` on an **explicit-external** root whose `projects/` dir
 *          already exists (i.e. there is durable state to protect) → stamp it
 *          once, then continue.
 *        - `absent` otherwise (legacy default, in-workspace root, or a brand-new
 *          external root with no `projects/` yet) → continue unstamped; there is
 *          nothing to protect and the legacy default must keep working untouched.
 *
 * `assert…Compatible` is the read-only variant used at recovery bootstrap — it
 * NEVER writes and NEVER repairs a mismatch.
 */

export type ProductionRuntimeAuthorityEnforcementErrorCode =
  "PRODUCTION_RUNTIME_ROOT_REQUIRED";

export class ProductionRuntimeAuthorityEnforcementError extends Error {
  constructor(readonly code: ProductionRuntimeAuthorityEnforcementErrorCode) {
    super(
      "Production requires an explicit ATOLYE_RUNTIME_ROOT; the legacy in-repo default is not permitted in production.",
    );
    this.name = "ProductionRuntimeAuthorityEnforcementError";
    this.stack = undefined;
  }
}

export type ProductionRuntimeAuthorityEnforcementMode =
  | "initialized"
  | "match"
  | "absent-unstamped";

export interface ProductionRuntimeAuthorityEnforcementResult {
  readonly mode: ProductionRuntimeAuthorityEnforcementMode;
  readonly markerPath: string;
}

export interface ProductionRuntimeAuthorityEnforcementOptions {
  /** Injectable for tests; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Full startup enforcement — may stamp the marker on an external root's first
 * boot. Throws (fail-closed) on a production-root violation or a generation
 * mismatch.
 */
export function enforceProductionRuntimeAuthorityGeneration(
  context: RuntimeStorageContext,
  authorityGeneration: string,
  options: ProductionRuntimeAuthorityEnforcementOptions = {},
): ProductionRuntimeAuthorityEnforcementResult {
  const env = options.env ?? process.env;

  // Rule 1 — production must name an explicit runtime root (§5 / §6).
  if (env.NODE_ENV === "production" && context.source === "legacy-default") {
    throw new ProductionRuntimeAuthorityEnforcementError(
      "PRODUCTION_RUNTIME_ROOT_REQUIRED",
    );
  }

  // Rule 2 — authority-generation marker. Throws RUNTIME_AUTHORITY_GENERATION_MISMATCH.
  const compatibility = assertRuntimeAuthorityGenerationMarkerCompatible({
    context,
    authorityGeneration,
  });

  if (compatibility.status === "match") {
    return { mode: "match", markerPath: compatibility.markerPath };
  }

  // absent — stamp only an explicit-external root that already holds project data.
  if (
    context.classification === "explicit-external" &&
    isExistingRealDirectory(context.projectsRoot)
  ) {
    const written = writeRuntimeAuthorityGenerationMarker({
      context,
      authorityGeneration,
    });
    return { mode: "initialized", markerPath: written.markerPath };
  }

  return {
    mode: "absent-unstamped",
    markerPath: resolveRuntimeAuthorityGenerationMarkerPath(context),
  };
}

/**
 * Read-only recovery enforcement. Never writes, never repairs. Throws
 * `RUNTIME_AUTHORITY_GENERATION_MISMATCH` when the marker names a different
 * authority generation; returns silently for `match` and `absent`.
 */
export function assertProductionRuntimeAuthorityGenerationCompatible(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): void {
  assertRuntimeAuthorityGenerationMarkerCompatible({ context, authorityGeneration });
}

export { RuntimeAuthorityGenerationMarkerError };

function isExistingRealDirectory(target: string): boolean {
  try {
    // A "should we stamp?" gate only — the marker write path itself runs the
    // real containment + symlink/junction checks (validateSafeAncestorChain,
    // assertPathContained) before it touches the filesystem.
    const link = fs.lstatSync(path.resolve(target));
    return link.isDirectory() && !link.isSymbolicLink();
  } catch {
    return false;
  }
}
