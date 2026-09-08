import fs from "node:fs";
import path from "node:path";
import {
  ensureSafeContainedDirectory,
  type RuntimeStorageContext,
} from "@/lib/runtime/RuntimeStoragePaths";
import {
  assertRuntimeAuthorityGenerationMarkerCompatible,
  describeRuntimeAuthorityIdentity,
  resolveRuntimeAuthorityGenerationMarkerPath,
  RuntimeAuthorityGenerationMarkerError,
  writeRuntimeAuthorityGenerationMarker,
} from "./RuntimeAuthorityGenerationMarker";
import {
  RuntimeAuthorityTransitionError,
  RuntimeAuthorityTransitionStore,
  runtimeAuthorityTransitionInProgressStates,
} from "./RuntimeAuthorityTransition";

/**
 * C.2B.6b + C.2B.9 — enforce the runtime authority *generation* and *transition
 * state* at production startup and recovery bootstrap.
 *
 * The single authoritative validation primitive between "canonical runtime
 * authority is resolved" and "the runtime is exposed for durable use":
 *
 *   1. Production (`NODE_ENV === "production"`) + `ATOLYE_RUNTIME_ROOT` unset
 *      (`source === "legacy-default"`) → FAIL CLOSED (§5/§6).
 *   2. Authority-transition control plane
 *      (`<authorityRoot>/authority-transition-v1/`):
 *        - this root is **quarantined** → FAIL CLOSED (`RUNTIME_AUTHORITY_ROOT_QUARANTINED`);
 *        - a **transition is in progress** with this root as source → FAIL CLOSED
 *          (`RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS`);
 *        - an **active authority** is published and it is a different root → FAIL
 *          CLOSED (`RUNTIME_AUTHORITY_NOT_ACTIVE`) — this now applies to the
 *          legacy in-repo default too (F11), so a still-present repo tree cannot
 *          run as a second authority after a genesis migration.
 *      When no transition has ever happened the whole control plane is absent
 *      and these checks are no-ops.
 *   3. Authority-generation marker:
 *        - `MISMATCH` → FAIL CLOSED (generation OR resolver binding changed —
 *          this catches a durable state + marker copied to a different root);
 *        - `match` → continue;
 *        - `absent` on an **explicit-external** root:
 *            · `projects/` holds project data and no transition explains it →
 *              FAIL CLOSED (`RUNTIME_AUTHORITY_UNBOUND_STATE`) — a marker-less copy;
 *            · otherwise stamp the marker on this first boot and continue;
 *        - `absent` on the legacy default / an in-workspace root → continue
 *          unstamped (nothing to protect; the legacy default is untouched).
 *
 * `assert…Compatible` is the read-only variant used at recovery bootstrap — it
 * runs the same production-root + control-plane + marker checks but NEVER writes
 * and NEVER repairs.
 */

export type ProductionRuntimeAuthorityEnforcementErrorCode =
  | "PRODUCTION_RUNTIME_ROOT_REQUIRED"
  | "RUNTIME_AUTHORITY_ROOT_QUARANTINED"
  | "RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS"
  | "RUNTIME_AUTHORITY_NOT_ACTIVE"
  | "RUNTIME_AUTHORITY_UNBOUND_STATE";

export class ProductionRuntimeAuthorityEnforcementError extends Error {
  constructor(readonly code: ProductionRuntimeAuthorityEnforcementErrorCode) {
    super(messageFor(code));
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

  // Rule 2 — authority-transition control plane.
  const controlPlane = assertAuthorityTransitionState(context, authorityGeneration);

  // Rule 3 — authority-generation marker. Throws RUNTIME_AUTHORITY_GENERATION_MISMATCH.
  const compatibility = assertRuntimeAuthorityGenerationMarkerCompatible({
    context,
    authorityGeneration,
  });
  if (compatibility.status === "match") {
    return { mode: "match", markerPath: compatibility.markerPath };
  }

  // absent — only an explicit-external root is a candidate for stamping.
  if (
    context.classification === "explicit-external" &&
    isExistingRealDirectory(context.runtimeRoot)
  ) {
    // First boot creates an empty projects/ so that "absent marker + populated
    // projects/" can only mean an out-of-band copy.
    ensureSafeContainedDirectory(context.runtimeRoot, context.projectsRoot);

    if (hasProjectData(context.projectsRoot) && !controlPlane.transitionTargetHere) {
      if (!controlPlane.activeExists) {
        throw new ProductionRuntimeAuthorityEnforcementError(
          "RUNTIME_AUTHORITY_UNBOUND_STATE",
        );
      }
      // controlPlane already asserted this root IS the active authority; a
      // published transition without a marker means the stamp step was
      // interrupted — finalize it.
    }
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
 * Read-only recovery enforcement. Never writes, never repairs. Same
 * production-root + control-plane + marker checks as the startup gate.
 */
export function assertProductionRuntimeAuthorityGenerationCompatible(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): void {
  assertAuthorityTransitionState(context, authorityGeneration);
  assertRuntimeAuthorityGenerationMarkerCompatible({ context, authorityGeneration });
}

export {
  RuntimeAuthorityGenerationMarkerError,
  RuntimeAuthorityTransitionError,
};

/* --------------------------------------------------------------- internals --- */

interface ControlPlaneVerdict {
  readonly activeExists: boolean;
  readonly activeMatchesHere: boolean;
  readonly transitionTargetHere: boolean;
}

function assertAuthorityTransitionState(
  context: RuntimeStorageContext,
  authorityGeneration: string,
): ControlPlaneVerdict {
  const store = new RuntimeAuthorityTransitionStore({
    authorityRoot: context.authorityRoot,
  });
  const binding = describeRuntimeAuthorityIdentity(
    context,
    authorityGeneration,
  ).resolverBindingIdentity;

  if (store.readQuarantine(binding)) {
    throw new ProductionRuntimeAuthorityEnforcementError(
      "RUNTIME_AUTHORITY_ROOT_QUARANTINED",
    );
  }

  let transitionTargetHere = false;
  for (const record of store.listTransitions()) {
    if (
      record.source.resolverBindingIdentity === binding &&
      runtimeAuthorityTransitionInProgressStates.has(record.state)
    ) {
      throw new ProductionRuntimeAuthorityEnforcementError(
        "RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS",
      );
    }
    if (
      record.target.resolverBindingIdentity === binding &&
      (record.state === "published" || record.state === "old-root-quarantined")
    ) {
      transitionTargetHere = true;
    }
  }

  const active = store.readActiveAuthority();
  const activeMatchesHere = active?.resolverBindingIdentity === binding;
  // F11 — once ANY authority has been published, EVERY root (including the
  // legacy in-repo default) must be the published one. Before any transition
  // `active` is null and this check is skipped, so dev / legacy / a first
  // external deployment are unaffected. After a genesis migration, a
  // still-present repo `data/projects` booted with `ATOLYE_RUNTIME_ROOT` unset
  // now fails closed instead of running as a second authority.
  if (active && !activeMatchesHere) {
    throw new ProductionRuntimeAuthorityEnforcementError(
      "RUNTIME_AUTHORITY_NOT_ACTIVE",
    );
  }

  return {
    activeExists: Boolean(active),
    activeMatchesHere,
    transitionTargetHere,
  };
}

function isExistingRealDirectory(target: string): boolean {
  try {
    const link = fs.lstatSync(path.resolve(target));
    return link.isDirectory() && !link.isSymbolicLink();
  } catch {
    return false;
  }
}

function hasProjectData(projectsRoot: string): boolean {
  try {
    return fs
      .readdirSync(path.resolve(projectsRoot), { withFileTypes: true })
      .some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

function messageFor(
  code: ProductionRuntimeAuthorityEnforcementErrorCode,
): string {
  switch (code) {
    case "PRODUCTION_RUNTIME_ROOT_REQUIRED":
      return "Production requires an explicit ATOLYE_RUNTIME_ROOT; the legacy in-repo default is not permitted in production.";
    case "RUNTIME_AUTHORITY_ROOT_QUARANTINED":
      return "This runtime root is quarantined by a completed authority transition and must not be used.";
    case "RUNTIME_AUTHORITY_TRANSITION_IN_PROGRESS":
      return "An authority transition is in progress for this runtime root; startup is refused until it completes.";
    case "RUNTIME_AUTHORITY_NOT_ACTIVE":
      return "A different runtime root is the active production authority; this root must not initialize.";
    default:
      return "This runtime root holds project data but no authority-generation marker and no transition explains it.";
  }
}
